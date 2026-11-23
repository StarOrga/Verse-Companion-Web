// sc-events-sync — keeps public.sc_events (the Star Citizen event timeline the
// desktop app reads via the `sc_events_feed()` RPC) in step with official RSI
// Comm-Links, without anyone touching it.
//
// Sources: the Star Citizen Wiki API (api.star-citizen.wiki/api/comm-links),
// a public mirror of RSI Comm-Links incl. body text, and — because that mirror
// lags RSI by days to weeks (feedback #400: the whole IAE 2956 run was missing
// three weeks in) — RSI's own comm-link hub list plus the article pages of
// event-titled posts the mirror does not have yet (rsi-pages.ts). The same
// article pages give every running/upcoming event its official picture
// (`extra.image`: the edition's schedule artwork, else the post's og:image).
//
// Robustness contract (the reason this exists as a scheduled job):
//   * Every response is schema-checked; a changed shape or an empty parse marks
//     the run `degraded` and writes NOTHING — last-known-good data stays.
//   * Writes are idempotent upserts through sc_events_upsert_scraped(), which
//     enforces in SQL: locked rows untouched, confirmed never downgraded,
//     names/summaries of curated rows kept. Nothing is ever deleted.
//   * Every run is logged in sc_events_scrape_runs (status, counts, changes,
//     needs_review, error, parser_version) → sc_events_health().
//   * AI is a fallback only: event-family title but no parseable dates, and only
//     with ANTHROPIC_API_KEY / OPENAI_API_KEY set (that order). Accepts confidence >= 0.8 and
//     validated dates; otherwise the item is logged as needs_review.
//   * Self-throttled (one run per hour, atomic claim_run; pg_cron calls it every 6 h) so the public URL cannot be used to
//     hammer the wiki API. verify_jwt=false: pg_cron calls it with the
//     publishable key, like patch-stability-sample.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { callClaude, recordAiCall } from '../_shared/ai-ledger.ts';
import { costUsd } from '../_shared/ai-pricing.ts';
import {
  type Candidate, type CommLink, type EventRow, FAMILIES, PARSER_VERSION, type Unsure,
  familyForTitle, isIsoDate, isPlausible, matchCommLinks, parseCommLink, planUpserts,
} from './matcher.ts';
import {
  type ArticleImage, type EventImage, type HubItem, RSI_BASE, articleBodyUrl, articleImages, articlePriority, bodyText,
  ogImage, parseHubItems, pickEventImage, titleYear,
} from './rsi-pages.ts';
import { withPosthog } from '../_shared/posthog.ts';
import { claimRun } from '../_shared/claim-run.ts';

const API = 'https://api.star-citizen.wiki/api/comm-links';
const PAGES = 3; // 3 x 100 newest Comm-Links ≈ 4–6 months of posts
const FETCH_TIMEOUT_MS = 15_000;
const AI_TIMEOUT_MS = 25_000;
const AI_MAX_CALLS = 5;
// One run per hour: unsure items go back to the AI on every run (up to AI_MAX_CALLS), so the interval is what bounds
// the spend an anonymous caller can force. The cron (every 6 h) is far inside it.
const THROTTLE_MS = 60 * 60_000;
const USER_AGENT = 'VerseCompanion/1.0 (+sc-events-sync)';
const HUB_API = `${RSI_BASE}/api/hub/getCommlinkItems`;
/** 4 × 20 newest RSI posts ≈ 3–4 weeks — the window the wiki mirror lags by. */
const HUB_PAGES = 4;
/** Event-titled RSI posts the mirror lacks, read per run (2 requests each). */
const MAX_HUB_ARTICLES = 8;
/** Article reads per run for event pictures (2 requests each), across all events. */
const MAX_IMAGE_ARTICLES = 10;
const PAGE_TIMEOUT_MS = 12_000;
/** An event's picture is looked up again at most this often. */
const IMAGE_RECHECK_MS = 20 * 60 * 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCommLinks(): Promise<{ links: CommLink[]; rawCount: number; invalid: number; errors: string[] }> {
  const links: CommLink[] = [];
  const errors: string[] = [];
  let rawCount = 0;
  let invalid = 0;
  for (let page = 1; page <= PAGES; page++) {
    const url = `${API}?page%5Bsize%5D=100&page%5Bnumber%5D=${page}`;
    let body: unknown = null;
    for (let attempt = 0; attempt < 2 && body === null; attempt++) {
      try {
        body = await fetchJson(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      } catch (e) {
        if (attempt === 1) errors.push(`page ${page}: ${(e as Error).message}`);
      }
    }
    if (body === null) continue;
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      errors.push(`page ${page}: response shape changed (no data[])`);
      continue;
    }
    rawCount += data.length;
    for (const item of data) {
      const link = parseCommLink(item);
      if (link) links.push(link);
      else invalid++;
    }
  }
  return { links, rawCount, invalid, errors };
}

// ------------------------------------------------------------------ RSI pages (rsi-pages.ts)

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = PAGE_TIMEOUT_MS): Promise<string> {
  const headers = { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined) };
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return await res.text();
}

/** The newest RSI comm-links from RSI's own hub list. Best-effort: a failure is reported, never fatal. */
async function fetchHub(errors: string[]): Promise<HubItem[]> {
  const out: HubItem[] = [];
  for (let page = 1; page <= HUB_PAGES; page++) {
    try {
      const body = JSON.parse(await fetchText(HUB_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ channel: '', series: '', type: '', text: '', sort: 'publish_new', page }),
      })) as { data?: unknown };
      if (typeof body.data !== 'string') { errors.push(`rsi hub page ${page}: response shape changed`); break; }
      const items = parseHubItems(body.data, Date.now());
      if (!items.length) break;
      out.push(...items);
    } catch (e) {
      errors.push(`rsi hub page ${page}: ${(e as Error).message}`);
      break;
    }
  }
  return out;
}

interface Article { url: string; og: string | null; images: ArticleImage[]; text: string }

/** One RSI article: page (og:image + body url) → body (text + pictures). Memoized per run; null on any failure. */
function articleReader(): (url: string) => Promise<Article | null> {
  const memo = new Map<string, Promise<Article | null>>();
  return (url) => {
    let p = memo.get(url);
    if (!p) {
      p = (async () => {
        try {
          const page = await fetchText(url, { headers: { Accept: 'text/html' } });
          const bodyUrl = articleBodyUrl(page);
          const body = bodyUrl ? await fetchText(bodyUrl, { headers: { Accept: 'text/html' } }).catch(() => '') : '';
          return { url, og: ogImage(page), images: articleImages(body), text: bodyText(body) };
        } catch {
          return null;
        }
      })();
      memo.set(url, p);
    }
    return p;
  };
}

interface ImageRow {
  id: string; series: string; start_date: string; end_date: string; url: string;
  hidden: boolean; locked: boolean; extra: Record<string, unknown> | null;
}

/**
 * Gives every running or soon upcoming event its official picture (`extra.image`). The edition's posts are the
 * mirror's and the hub's comm-links whose title names the family and the in-game year: the event's own post first,
 * then the ones that usually carry the schedule; reading stops at the first schedule artwork. A picture an admin set
 * (`kind: 'admin'`) is never replaced; a locked row only gets one when it has none.
 */
async function resolveImages(
  db: ReturnType<typeof createClient>, rows: ImageRow[], titles: Array<{ title: string; url: string; id: number }>,
  read: (url: string) => Promise<Article | null>, today: string,
): Promise<Array<{ id: string; kind: string; from: string }>> {
  const horizon = new Date(Date.parse(today) + 120 * 86_400_000).toISOString().slice(0, 10);
  const recent = new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10);
  const done: Array<{ id: string; kind: string; from: string }> = [];
  let budget = MAX_IMAGE_ARTICLES;
  const due = rows
    .filter((r) => !r.hidden && r.end_date >= recent && r.start_date <= horizon)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (const row of due) {
    if (budget <= 0) break;
    const extra = row.extra ?? {};
    const current = extra.image as { url?: string; kind?: string } | undefined;
    if (current?.kind === 'admin') continue;
    if (row.locked && current?.url) continue;
    const checked = Date.parse(String(extra.image_checked_at ?? ''));
    if (Number.isFinite(checked) && Date.now() - checked < IMAGE_RECHECK_MS) continue;
    const year = Number(row.start_date.slice(0, 4)) + 930;
    const edition = titles
      .filter((t) => t.url !== row.url && familyForTitle(t.title)?.series === row.series && titleYear(t.title) === year)
      .sort((a, b) => articlePriority(a.title) - articlePriority(b.title) || b.id - a.id)
      .map((t) => t.url);
    const urls = [...new Set([...(row.url ? [row.url] : []), ...edition])];
    if (!urls.length) continue;
    const articles: Article[] = [];
    for (const url of urls) {
      if (budget <= 0) break;
      budget--;
      const a = await read(url);
      if (!a) continue;
      articles.push(a);
      if (pickEventImage([a])?.kind === 'schedule') break;
    }
    if (!articles.length) continue;
    const image: EventImage | null = pickEventImage(articles);
    const next = { ...extra, image_checked_at: new Date().toISOString(), ...(image ? { image } : {}) };
    const { error } = await db.from('sc_events').update({ extra: next }).eq('id', row.id);
    if (!error && image && image.url !== current?.url) done.push({ id: row.id, kind: image.kind, from: image.from });
  }
  return done;
}

// ------------------------------------------------------------------ AI fallback

interface AiVerdict { matches_event_family: boolean; start: string | null; end: string | null; confidence: number }

function aiPrompt(u: Unsure): string {
  return [
    'You extract Star Citizen in-game event dates from an official RSI Comm-Link.',
    `Event family: "${FAMILIES.find((f) => f.series === u.series)?.name ?? u.series}".`,
    `Comm-Link title: "${u.title}" (published ${u.publishedAt.slice(0, 10)}).`,
    `Excerpt: """${u.excerpt}"""`,
    'Answer with ONLY a JSON object, no prose:',
    '{"matches_event_family": boolean, "start": "YYYY-MM-DD"|null, "end": "YYYY-MM-DD"|null, "confidence": number 0..1}',
    'Use real-world calendar dates (not in-game year 29xx). If the text does not state the event dates, set start/end null and confidence 0.',
  ].join('\n');
}

function parseVerdict(text: string): AiVerdict | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    if (typeof v.matches_event_family !== 'boolean' || typeof v.confidence !== 'number') return null;
    return { matches_event_family: v.matches_event_family, start: v.start ?? null, end: v.end ?? null, confidence: v.confidence };
  } catch {
    return null;
  }
}

async function askAi(u: Unsure): Promise<AiVerdict | null> {
  const anthropic = Deno.env.get('ANTHROPIC_API_KEY');
  const openai = Deno.env.get('OPENAI_API_KEY');
  if (anthropic) {
    const res = await callClaude('sc-events-sync', anthropic, {
      model: Deno.env.get('SC_EVENTS_AI_MODEL') ?? 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: aiPrompt(u) }],
    }, AI_TIMEOUT_MS);
    return parseVerdict(res.content?.find((c) => c.type === 'text')?.text ?? '');
  }
  if (openai) {
    const endpoint = 'https://api.openai.com/v1/chat/completions';
    const model = Deno.env.get('SC_EVENTS_AI_MODEL') ?? 'gpt-4o-mini';
    const provider = 'openai';
    const started = Date.now();
    let res: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      res = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${openai}` },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: aiPrompt(u) }],
        }),
      }, AI_TIMEOUT_MS) as typeof res;
    } catch (e) {
      await recordAiCall({ function: 'sc-events-sync', model, provider, latency_ms: Date.now() - started, ok: false, error: (e as Error).message });
      throw e;
    }
    const usage = { input_tokens: res.usage?.prompt_tokens, output_tokens: res.usage?.completion_tokens };
    await recordAiCall({
      function: 'sc-events-sync', model, provider, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      cost_usd: res.usage ? costUsd(model, usage) : undefined, latency_ms: Date.now() - started, ok: true,
    });
    return parseVerdict(res.choices?.[0]?.message?.content ?? '');
  }
  return null;
}

async function resolveUnsure(unsure: Unsure[], knownIds: Set<number>): Promise<{ candidates: Candidate[]; review: Array<Unsure & { ai?: string }> }> {
  const candidates: Candidate[] = [];
  const review: Array<Unsure & { ai?: string }> = [];
  const hasKey = Boolean(Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('OPENAI_API_KEY'));
  let calls = 0;
  for (const u of unsure) {
    if (knownIds.has(u.commLinkId)) continue; // already applied from this post earlier
    if (!hasKey || calls >= AI_MAX_CALLS) { review.push({ ...u, ai: hasKey ? 'call budget exhausted' : 'no AI key' }); continue; }
    calls++;
    try {
      const v = await askAi(u);
      const fam = FAMILIES.find((f) => f.series === u.series)!;
      const ok = v && v.matches_event_family && v.confidence >= 0.8 && isIsoDate(v.start) && isIsoDate(v.end)
        && isPlausible(fam, { start: v.start!, end: v.end! }, new Date(u.publishedAt));
      if (ok) {
        candidates.push({ series: u.series, start: v!.start!, end: v!.end!, url: u.url, commLinkId: u.commLinkId, publishedAt: u.publishedAt, source: 'ai', freeFly: fam.freeFly });
      } else {
        review.push({ ...u, ai: v ? `rejected (confidence ${v.confidence}, ${v.start}..${v.end})` : 'unparseable answer' });
      }
    } catch (e) {
      review.push({ ...u, ai: `error: ${(e as Error).message}` });
    }
  }
  return { candidates, review: review.map(({ excerpt: _e, ...r }) => r as Unsure & { ai?: string }) };
}

// ------------------------------------------------------------------ handler

Deno.serve(withPosthog('sc-events-sync', async (req) => {
  // POST only: pg_cron posts, and a GET would let any link or <img> on the web start a run.
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const startedMs = Date.now();

  // Reap runs that died mid-flight (worker killed → stuck "running").
  await db.from('sc_events_scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: 'run did not finish (worker killed or timed out)' })
    .eq('status', 'running').lt('started_at', new Date(Date.now() - 30 * 60_000).toISOString());
  // Atomic claim (claim_run, one statement): N parallel POSTs cannot all pass a read-then-insert check any more.
  if (!(await claimRun(db, 'sc-events-sync', THROTTLE_MS))) return json({ skipped: 'throttled: a run started less than an hour ago' }, 429);

  const { data: run, error: runErr } = await db.from('sc_events_scrape_runs')
    .insert({ source: 'star-citizen-wiki:comm-links', status: 'running', parser_version: PARSER_VERSION }).select('id').single();
  if (runErr || !run) return json({ error: `cannot open run log: ${runErr?.message}` }, 500);

  const finish = async (fields: Record<string, unknown>) => {
    await db.from('sc_events_scrape_runs').update({ ...fields, finished_at: new Date().toISOString(), duration_ms: Date.now() - startedMs }).eq('id', run.id);
    return json({ runId: run.id, parserVersion: PARSER_VERSION, ...fields });
  };

  try {
    const { links, rawCount, invalid, errors } = await fetchCommLinks();
    // RSI's own list fills what the mirror has not picked up yet: event-titled posts only, their bodies read from RSI.
    const rsiErrors: string[] = [];
    const hub = await fetchHub(rsiErrors);
    const read = articleReader();
    const mirrored = new Set(links.map((l) => l.id));
    const rsiOnly = hub.filter((h) => !mirrored.has(h.id) && familyForTitle(h.title)).slice(0, MAX_HUB_ARTICLES);
    const rsiLinks: CommLink[] = [];
    for (const h of rsiOnly) {
      const a = await read(h.url);
      if (a?.text) rsiLinks.push({ id: h.id, title: h.title, url: h.url, publishedAt: h.publishedAt, body: a.text });
    }
    const shapeBroken = rawCount > 0 && invalid / rawCount > 0.5;
    if (links.length === 0 || shapeBroken) {
      return await finish({
        status: 'degraded', parsed_count: links.length, matched_count: 0,
        error: [shapeBroken ? `schema check failed for ${invalid}/${rawCount} items` : 'parsed 0 comm-links', ...errors].join('; '),
      });
    }

    const { data: rows, error: rowsErr } = await db.from('sc_events')
      .select('id, series, kind, name, start_date, end_date, date_status, status, free_fly, url, locked, hidden, source, source_comm_link_id, source_published_at, extra');
    if (rowsErr) throw new Error(`read sc_events: ${rowsErr.message}`);

    const { candidates, unsure } = matchCommLinks([...links, ...rsiLinks]);
    const knownIds = new Set((rows as EventRow[]).map((r) => r.source_comm_link_id).filter((x): x is number => x !== null));
    const ai = await resolveUnsure(unsure, knownIds);
    const today = new Date().toISOString().slice(0, 10);
    const plan = planUpserts(rows as EventRow[], [...candidates, ...ai.candidates], today);

    let written = 0;
    if (plan.upserts.length) {
      const { data: n, error: upErr } = await db.rpc('sc_events_upsert_scraped', { p_events: plan.upserts });
      if (upErr) throw new Error(`upsert: ${upErr.message}`);
      written = Number(n ?? 0);
    }

    // Pictures, on the rows as they stand after this run (a newly confirmed post brings its url).
    const before = rows as ImageRow[];
    const upserted = new Map(plan.upserts.map((u) => [u.id, u]));
    const imageRows: ImageRow[] = [
      ...before.map((r) => ({ ...r, url: upserted.get(r.id)?.url ?? r.url ?? '' })),
      ...plan.upserts.filter((u) => !before.some((r) => r.id === u.id)).map((u) => ({
        id: u.id, series: u.series, start_date: u.start_date, end_date: u.end_date, url: u.url, hidden: false, locked: false, extra: {},
      })),
    ];
    const titles = [...new Map([...hub, ...rsiLinks, ...links].map((l) => [l.id, { id: l.id, title: l.title, url: l.url }])).values()];
    const images = await resolveImages(db, imageRows, titles, read, today).catch((e) => {
      rsiErrors.push(`images: ${(e as Error).message}`);
      return [];
    });

    return await finish({
      status: errors.length || invalid / rawCount > 0.1 ? 'degraded' : 'ok',
      parsed_count: links.length,
      matched_count: candidates.length + ai.candidates.length,
      written_count: written,
      changes: [...plan.changes, ...images.map((i) => ({ id: i.id, action: 'image', to: i.kind, source: 'rsi-page', url: i.from }))],
      needs_review: ai.review,
      skipped: plan.skipped,
      error: [...errors, ...rsiErrors, invalid ? `${invalid}/${rawCount} items failed the schema check` : ''].filter(Boolean).join('; ') || null,
    });
  } catch (e) {
    return await finish({ status: 'failed', error: (e as Error).message.slice(0, 2000) });
  }
}, { cron: true }));
