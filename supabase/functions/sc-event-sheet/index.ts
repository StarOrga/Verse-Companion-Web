// sc-event-sheet - reads what an event asks, gives and where it applies out of official text and writes the event's
// data sheet (docs/contracts/event-sheet.md), so the HQ never depends on someone typing it in.
//
//   POST {}                         pg_cron (every 6 h): picks the events that need a pass (new comm-link, running
//                                   event once a day, upcoming event, one last pass after the end, and - backfill -
//                                   every event never read by the current extractor), max 4 parallel LLM calls.
//   POST { eventId, force? }        re-extract ONE event; service-role key or a signed-in admin only.
//   POST { backfill: true }         one automatic pass without the 10-min throttle; service-role key or admin only
//                                   (the admin page's "Fehlende auswerten" loops it until `due` is 0).
//   -> { ok, runs: [{ eventId, status, ... }], due }
//
// Flow per event: gather text -> Anthropic tool call with the sheet schema -> sheetFromModel (normalise, sanity-check,
// confidence gate) -> calendar dates for an unknown start/end -> mergeSheets with the stored draft (admin decisions
// stay) -> sc_event_sheet_apply(..., 'ai') = draft + public sheet + one history row. Sources (all best-effort, a failed
// one is skipped): the event's own comm-link by id (sc_events.url) and a title search over ALL comm-links of the
// Comm-Link Wiki API (the newest 200 alone miss every older edition), the newest 200 for weekly-roundup mentions, the
// community wiki page (resolved case-insensitively, this edition's section first), the RSI page's meta tags and CIG staff
// posts on Spectrum (v3; confidence by source authority, see docs/contracts/event-sheet.md). An
// edition without a post of its own (announced later) reads the previous edition's posts as a labelled hint; its
// fields stay <= 0.6 and wait in the admin review. Fields under 0.8 stay unknown publicly. Key only here
// (ANTHROPIC_API_KEY); model override SC_EVENT_SHEET_MODEL. verify_jwt=false (supabase/config.toml): pg_cron has only
// the publishable key; the automatic mode is throttled and capped, the targeted/backfill modes check the caller.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeSheet, type EventSheet } from '../_shared/event-sheet.ts';
import { callClaude } from '../_shared/ai-ledger.ts';
import { effectiveForce } from './_force.ts';
import {
  EXTRACTOR_MAJOR, EXTRACTOR_VERSION, MAX_LLM_CALLS_PER_RUN, SHEET_TOOL_NAME, SHEET_TOOL_SCHEMA,
  actorIdFor, bundleSources, buildPrompt, commLinkIdFromUrl, defaultPrerequisites, editionYears, extractMeta,
  fillDatesFromCalendar, hashText, isSpectrumStaff, mergeSheets, nameStem, parseActorId, parseModelAnswer,
  parseWikiExtract, pickEvents, previousEditionSources, searchTerms, selectSources, selectSpectrum, sheetFromModel,
  wikiEditionText,
  type EventInfo, type LinkInfo, type RunState, type SourceItem, type SpectrumPost, CORS, preflight,
} from './_extract.ts';
import { withPosthog } from '../_shared/posthog.ts';
import { claimRun } from '../_shared/claim-run.ts';
import { safeEqual } from '../_shared/safe-equal.ts';

const MODEL = Deno.env.get('SC_EVENT_SHEET_MODEL') ?? 'claude-sonnet-5-5';
const COMM_LINK_API = 'https://api.star-citizen.wiki/api/comm-links';
const WIKI_API = 'https://starcitizen.tools/api.php';
const USER_AGENT = 'VerseCompanion/1.0 (+sc-event-sheet)';
const GLOBAL_THROTTLE_MS = 10 * 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

async function getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return await res.json();
}

function toLink(raw: unknown): LinkInfo | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.id !== 'number' || typeof r.title !== 'string' || typeof r.rsi_url !== 'string' || typeof r.created_at !== 'string') return null;
  if (!/^https:\/\/(www\.)?robertsspaceindustries\.com\//.test(r.rsi_url) || Number.isNaN(Date.parse(r.created_at))) return null;
  const en = (r.translations as Record<string, unknown> | undefined)?.en_EN;
  return { id: r.id, title: r.title.trim(), url: r.rsi_url, publishedAt: new Date(r.created_at).toISOString(), body: typeof en === 'string' ? en.slice(0, 60000) : '' };
}

const linksOf = (body: unknown): LinkInfo[] => {
  const data = (body as { data?: unknown } | null)?.data;
  return (Array.isArray(data) ? data : data ? [data] : []).map(toLink).filter((l): l is LinkInfo => l !== null);
};

/** The newest 200 comm-links (weekly roundups that mention the running events). */
async function fetchRecentLinks(): Promise<LinkInfo[]> {
  const pages = await Promise.all([1, 2].map((page) =>
    getJson(`${COMM_LINK_API}?page%5Bsize%5D=100&page%5Bnumber%5D=${page}`).then(linksOf).catch((e) => {
      console.warn(`[sc-event-sheet] comm-link page ${page}: ${(e as Error).message}`);
      return [] as LinkInfo[];
    })));
  return pages.flat();
}

/** Every comm-link whose TITLE names the event (all editions, any age) plus its own post by id. */
async function fetchEventLinks(event: EventInfo): Promise<LinkInfo[]> {
  const asks = searchTerms(event.name).map((t) => getJson(`${COMM_LINK_API}?filter%5Btitle%5D=${encodeURIComponent(t)}&page%5Bsize%5D=50`));
  const own = event.source_comm_link_id ?? commLinkIdFromUrl(event.url);
  if (own !== null) asks.push(getJson(`${COMM_LINK_API}/${own}`));
  const got = await Promise.allSettled(asks);
  return got.flatMap((g) => (g.status === 'fulfilled' ? linksOf(g.value) : []));
}

/** The community wiki page for the event, its title resolved case-insensitively ("Pirate Week" lives at "Pirate week"). */
async function fetchWiki(event: EventInfo): Promise<SourceItem | null> {
  for (const term of searchTerms(event.name)) {
    try {
      const found = (await getJson(`${WIKI_API}?action=opensearch&format=json&limit=1&search=${encodeURIComponent(term)}`)) as unknown[] | null;
      const titles: unknown[] = Array.isArray(found) && Array.isArray(found[1]) ? (found[1] as unknown[]) : [];
      const title = typeof titles[0] === 'string' ? titles[0] : null;
      if (!title || title.toLowerCase() !== term.toLowerCase()) continue;
      const text = parseWikiExtract(await getJson(`${WIKI_API}?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`));
      if (text) return { kind: 'wiki', label: `Star Citizen Wiki: ${title} (community)`, url: `https://starcitizen.tools/${encodeURIComponent(title.replace(/ /g, '_'))}`, text: wikiEditionText(text, event) };
    } catch { /* wiki unreachable: fine */ }
  }
  return null;
}

/** The RSI page's meta tags (RSI serves nothing else to a plain fetch). */
async function fetchMeta(event: EventInfo): Promise<SourceItem | null> {
  if (!event.url) return null;
  try {
    const res = await fetch(event.url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const meta = extractMeta((await res.text()).slice(0, 200_000));
    return meta ? { kind: event.url.includes('/spectrum/') ? 'spectrum' : 'rsi-page', label: 'RSI page meta tags', url: event.url, text: meta } : null;
  } catch { return null; /* RSI blocks or serves a shell: fine */ }
}

const SPECTRUM_SEARCH = 'https://robertsspaceindustries.com/api/spectrum/search/content/extended';
/** Spectrum answers ErrThrottleLimit to a burst (4 quick searches were enough): one search at a time, spaced. */
const SPECTRUM_GAP_MS = 1200;
let spectrumQueue: Promise<unknown> = Promise.resolve();

/**
 * Posts and replies of CIG staff about this edition (#364): one relevance search for "<name stem> <in-game year>" in the
 * Star Citizen community (tavern 1); only staff hits are kept (selectSpectrum). Best effort: throttled or down -> [].
 */
function fetchSpectrum(event: EventInfo): Promise<SourceItem[]> {
  const text = `${nameStem(event.name)} ${editionYears(event)[1]}`;
  const run = spectrumQueue.then(async () => {
    try {
      const res = await fetch(SPECTRUM_SEARCH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tavern-id': '1', accept: 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ community_id: '1', text, type: ['op', 'reply'], page: 1, visibility: 'nonerased' }),
        signal: AbortSignal.timeout(12_000),
      });
      const body = (await res.json().catch(() => null)) as { success?: unknown; code?: unknown; data?: { hits?: { hits?: unknown[] } } } | null;
      if (!res.ok || body?.success !== 1) {
        console.warn(`[sc-event-sheet] spectrum search "${text}": ${res.status} ${String(body?.code ?? '')}`);
        return [];
      }
      return selectSpectrum(event, (body.data?.hits?.hits ?? []).map(toSpectrumPost).filter((p): p is SpectrumPost => p !== null));
    } catch (e) {
      console.warn(`[sc-event-sheet] spectrum search "${text}": ${(e as Error).message}`);
      return [];
    } finally {
      await new Promise((r) => setTimeout(r, SPECTRUM_GAP_MS));
    }
  });
  spectrumQueue = run.catch(() => undefined);
  return run;
}

function toSpectrumPost(raw: unknown): SpectrumPost | null {
  const h = raw as { _id?: unknown; _index?: unknown; _source?: Record<string, unknown>; details?: Record<string, Record<string, unknown> | undefined> } | null;
  const s = h?._source;
  const d = h?.details ?? {};
  if (!s || typeof s.body !== 'string' || typeof s.time_created !== 'string') return null;
  const thread = d.thread ?? {};
  const member = d.member as { isGM?: unknown; displayname?: unknown; nickname?: unknown } | undefined;
  const subject = typeof s.subject === 'string' && s.subject ? s.subject : typeof thread.subject === 'string' ? thread.subject : '';
  return {
    id: String(h?._id ?? ''),
    threadSlug: typeof thread.slug === 'string' ? thread.slug : '',
    subject,
    body: s.body.slice(0, 20_000),
    author: typeof member?.displayname === 'string' ? member.displayname : '',
    createdAt: s.time_created,
    staff: isSpectrumStaff(member, s.highlight_role_id),
    reply: String(h?._index ?? '').includes('reply'),
    channel: typeof d.channel?.name === 'string' ? d.channel.name : '',
  };
}

interface Gathered { event: EventInfo; sources: SourceItem[]; own: boolean; bundle: string; hash: string }

async function gather(event: EventInfo, recent: readonly LinkInfo[]): Promise<Gathered> {
  const [eventLinks, wiki, meta, staff] = await Promise.all([fetchEventLinks(event), fetchWiki(event), fetchMeta(event), fetchSpectrum(event)]);
  const seen = new Set<number>();
  const links = [...eventLinks, ...recent].filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
  const posts = selectSources(event, links);
  // Official text of THIS edition: its comm-links or CIG staff posts on Spectrum (the RSI page's meta tags alone are too thin).
  const own = posts.length > 0 || staff.length > 0;
  const sources = [...posts, ...staff, ...(own ? [] : previousEditionSources(event, links)), ...(meta ? [meta] : []), ...(wiki ? [wiki] : [])];
  const bundle = bundleSources(sources);
  return { event, sources, own, bundle, hash: hashText(`${EXTRACTOR_VERSION}\n${bundle}`) };
}

async function askModel(prompt: string, key: string): Promise<unknown> {
  const body = await callClaude<{ content?: unknown }>('sc-event-sheet', key, {
      model: MODEL,
      max_tokens: 6000,
      tools: [{ name: SHEET_TOOL_NAME, description: 'Record the structured data sheet of the event.', input_schema: SHEET_TOOL_SCHEMA }],
      // A forced tool_choice ('tool' / 'any') is refused with 400 by the current models; the prompt demands the tool call
      // and parseModelAnswer falls back to a JSON text block.
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: prompt }],
    }, 90_000);
  return parseModelAnswer(body.content);
}

Deno.serve(withPosthog('sc-event-sheet', async (req) => {
  const pre = preflight(req.method);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const body = (await req.json().catch(() => ({}))) as { eventId?: unknown; force?: unknown; backfill?: unknown };
  const targeted = typeof body.eventId === 'string' && body.eventId.length > 0 ? body.eventId : null;
  const backfill = !targeted && body.backfill === true;

  // Targeted runs, backfill passes and `force`: the service-role key or a signed-in admin. The automatic mode needs no
  // caller trust (throttled + capped); an unprivileged caller's `force` is silently ignored, not rejected.
  let privileged = false;
  if (targeted || backfill || body.force === true) {
    const auth = req.headers.get('authorization') ?? '';
    privileged = !!serviceKey && safeEqual(auth, `Bearer ${serviceKey}`); // an unset key never matches "Bearer "
    if (!privileged && auth) {
      const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { authorization: auth } }, auth: { persistSession: false } });
      const { data } = await user.rpc('is_admin');
      privileged = data === true;
    }
    if (!privileged && (targeted || backfill)) return json({ error: 'forbidden' }, 403);
  }
  const force = effectiveForce(body.force, privileged);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: true, runs: [], status: 'no_key' });

  // Past AI runs: when, on which source text and by which extractor (actor_id = `sc-event-sheet:<major>:<hash>`).
  const { data: hist, error: histErr } = await db.from('sc_event_sheet_history')
    .select('event_id, created_at, actor_id').eq('actor_kind', 'ai').order('created_at', { ascending: false }).limit(500);
  if (histErr) return json({ error: `history: ${histErr.message}` }, 500);
  const state = new Map<string, RunState>();
  for (const h of (hist ?? []) as Array<{ event_id: string; created_at: string; actor_id: string | null }>) {
    if (state.has(h.event_id)) continue;
    const a = parseActorId(h.actor_id);
    state.set(h.event_id, { lastAiAt: h.created_at, lastHash: a.hash, stale: a.major !== EXTRACTOR_MAJOR });
  }
  const newest = (hist ?? [])[0]?.created_at as string | undefined;
  if (!targeted && !backfill && newest && Date.now() - Date.parse(newest) < GLOBAL_THROTTLE_MS) {
    return json({ ok: true, runs: [], status: 'throttled' }, 429);
  }
  // The history row above only exists once a run FINISHED; the claim closes the window between start and first write.
  if (!targeted && !backfill && !(await claimRun(db, 'sc-event-sheet:auto', GLOBAL_THROTTLE_MS))) {
    return json({ ok: true, runs: [], status: 'throttled' }, 429);
  }

  const { data: rows, error: rowsErr } = await db.from('sc_events')
    .select('id, series, name, start_date, end_date, date_status, status, hidden, url, source_comm_link_id, source_published_at');
  if (rowsErr) return json({ error: `events: ${rowsErr.message}` }, 500);
  const events = (rows ?? []) as EventInfo[];

  const recent = await fetchRecentLinks();
  let picked: EventInfo[];
  if (targeted) {
    const one = events.find((e) => e.id === targeted);
    if (!one) return json({ error: 'event not found' }, 404);
    picked = [one];
  } else {
    const latestLinkAt = new Map<string, string>();
    for (const e of events) {
      const newestLink = selectSources(e, recent).map((s) => s.label.match(/\((\d{4}-\d{2}-\d{2})\)$/)?.[1] ?? '').sort().pop();
      if (newestLink) latestLinkAt.set(e.id, `${newestLink}T23:59:59Z`);
    }
    picked = pickEvents(events, state, latestLinkAt, new Date());
  }

  // 1. Sources for every picked event (parallel, network only). 2. Unchanged text needs no model. 3. Up to the cap
  // of LLM calls in parallel - sequential calls would not fit the 150 s wall clock - the rest waits for the next run.
  const gathered = await Promise.all(picked.map((e) => gather(e, recent).catch((err) => ({ event: e, error: (err as Error).message }))));
  const runs: Array<Record<string, unknown>> = [];
  const work: Gathered[] = [];
  for (const g of gathered) {
    if ('error' in g) { runs.push({ eventId: g.event.id, status: 'failed', error: g.error.slice(0, 300) }); continue; }
    const st = state.get(g.event.id);
    if (!force && st && !st.stale && st.lastHash === g.hash) { runs.push({ eventId: g.event.id, status: 'unchanged' }); continue; }
    work.push(g);
  }
  const cap = targeted ? 1 : MAX_LLM_CALLS_PER_RUN;
  const now = work.slice(0, cap);
  for (const g of work.slice(cap)) runs.push({ eventId: g.event.id, status: 'deferred' });

  let calls = 0;
  const results = await Promise.all(now.map(async (g): Promise<Record<string, unknown>> => {
    try {
      // No text at all: no model call; the sheet still gets the calendar dates, and the event counts as read.
      let answer: unknown = { fields: {} };
      if (g.bundle) {
        calls++;
        answer = await askModel(buildPrompt(g.event, g.bundle), key);
        if (!answer) return { eventId: g.event.id, status: 'model_failed' };
      }
      const fresh = sheetFromModel(answer, g.event, { ownSources: g.own, sources: g.sources });
      const dated = defaultPrerequisites(fillDatesFromCalendar(fresh.sheet, g.event));
      const { data: draft } = await db.from('sc_event_sheet_drafts').select('sheet').eq('event_id', g.event.id).maybeSingle();
      const merged: EventSheet = mergeSheets(draft?.sheet ? normalizeSheet(draft.sheet) : null, dated);
      const { error: applyErr } = await db.rpc('sc_event_sheet_apply', {
        p_event_id: g.event.id, p_sheet: merged, p_actor_kind: 'ai', p_actor_id: actorIdFor(g.hash),
      });
      if (applyErr) throw new Error(`apply: ${applyErr.message}`);
      return { eventId: g.event.id, status: 'written', sources: g.sources.length, ownSources: g.own, issues: fresh.issues, extractor: EXTRACTOR_VERSION };
    } catch (e) {
      return { eventId: g.event.id, status: 'failed', error: (e as Error).message.slice(0, 300) };
    }
  }));
  runs.push(...results);
  const due = runs.filter((r) => r.status === 'deferred').length;
  return json({ ok: true, llmCalls: calls, due, runs });
}, { cron: true }));
