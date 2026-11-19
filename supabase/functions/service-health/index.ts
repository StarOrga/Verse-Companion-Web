// service-health - hourly, token-free probes of the external services (I2/I4/I5/I6).
//
// pg_cron (hourly :13) POSTs here. Probes (all free, no LLM tokens): Anthropic GET /v1/models (ANTHROPIC_API_KEY and
// TRANSLATE_ANTHROPIC_API_KEY), PostHog GET /api/projects/@current/ (personal key; without it only ingest reachability),
// Supabase (own DB read), R2 worker HEAD, UEX GET /categories, RSI status index.json,
// readme.io GET dash.readme.com/api/v1 (README_IO_API_KEY). A missing key is "error" for claude/uex (they are required),
// "unknown" (skipped) for readme/posthog-without-key (optional integrations). The claude row also folds in the
// passive ai_calls error rate of the last 24 h. Levels follow d-thresh (posthog-guard.ts serviceLevel).
// A service turning red files an origin='service' board item (same cap/dedupe as posthog-signal); turning ok again posts
// a system message and sets the item to shipped ("Dienst wieder erreichbar") only while no human touched it.
// verify_jwt=false (config.toml): pg_cron has only the publishable key; the run is throttled via guard_runs (50 min),
// header x-signal-secret = POSTHOG_SIGNAL_SECRET bypasses the throttle. No user data, no outputs beyond levels.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fileFinding, throttled, type Db } from '../_shared/guard-board.ts';
import { pingProject, personalKey } from '../_shared/posthog-api.ts';
import { captureServerException, withPosthog } from '../_shared/posthog.ts';
import {
  SERVICES, buildItemBody, canAutoCloseServiceItem, checkSignalSecret, fromDbHealth, httpFailureNote, nextHealth, serviceTransition, toDbHealth,
  type HealthRow, type ProbeResult, type ServiceName,
} from '../_shared/posthog-guard.ts';

const FN = 'service-health';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const R2_BASE = (Deno.env.get('ASSETS_PUBLIC_URL') ?? 'https://sc-assets.sc-assets-worker.workers.dev').replace(/\/+$/, '');
const EXPECTED_EVERY_SEC = 3600;

async function http(url: string, init: RequestInit = {}, okIf: (s: number) => boolean = (s) => s >= 200 && s < 300): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (okIf(res.status)) { await res.body?.cancel(); return { ok: true }; }
    const body = await res.text().catch(() => '');
    return { ok: false, note: httpFailureNote(res.status, body.slice(0, 4000)) };
  } catch (e) {
    return { ok: false, note: `nicht erreichbar (${(e as Error).name})` };
  }
}

const anthropic = (key: string) => http('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });


async function probe(service: ServiceName, db: Db): Promise<ProbeResult> {
  switch (service) {
    case 'claude': {
      const keys = [Deno.env.get('ANTHROPIC_API_KEY'), Deno.env.get('TRANSLATE_ANTHROPIC_API_KEY')].filter((k): k is string => !!k);
      if (!Deno.env.get('ANTHROPIC_API_KEY')) return { ok: false, keyMissing: true, note: 'ANTHROPIC_API_KEY fehlt' };
      const results = await Promise.all([...new Set(keys)].map(anthropic));
      const bad = results.find((r) => !r.ok);
      // Passive: error rate of real calls over 24 h (needs >= 5 calls; ai_calls may not exist yet).
      let passive: number | null = null;
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const rows = await db.from('ai_calls').select('ok').eq('probe', false).gte('at', since).limit(5000);
      if (!rows.error && (rows.data?.length ?? 0) >= 5) passive = rows.data!.filter((r: { ok: boolean }) => !r.ok).length / rows.data!.length;
      return { ok: !bad, note: bad?.note, passiveErrorRate: passive };
    }
    case 'posthog':
      if (!personalKey()) {
        const r = await http('https://eu.i.posthog.com/', {}, (s) => s < 500);
        return { ...r, note: r.ok ? undefined : r.note };
      }
      return (await pingProject()) ? { ok: true } : { ok: false, note: 'PostHog-API nicht erreichbar' };
    case 'supabase': {
      const r = await db.from('service_health').select('service').limit(1);
      return r.error ? { ok: false, note: 'Datenbank-Abfrage fehlgeschlagen' } : { ok: true };
    }
    case 'r2':
      return http(`${R2_BASE}/`, { method: 'HEAD' }, (s) => s < 500);
    case 'uex': {
      const token = Deno.env.get('UEX_API_TOKEN');
      if (!token) return { ok: false, keyMissing: true, note: 'UEX_API_TOKEN fehlt' };
      return http('https://api.uexcorp.uk/2.0/categories', { headers: { authorization: `Bearer ${token}` } });
    }
    case 'rsi':
      return http('https://status.robertsspaceindustries.com/index.json');
    case 'readme': {
      const key = Deno.env.get('README_IO_API_KEY');
      if (!key) return { ok: false, skipped: true, note: 'README_IO_API_KEY nicht gesetzt' };
      return http('https://dash.readme.com/api/v1', { headers: { authorization: `Basic ${btoa(`${key}:`)}` } });
    }
  }
}

const OPEN = ['open', 'in_progress', 'needs_input'];

async function onTransition(db: Db, t: 'degraded' | 'recovered', row: HealthRow) {
  if (t === 'degraded') {
    await fileFinding(db, {
      origin: 'service', ref: row.service,
      body: buildItemBody({
        title: `Dienst ${row.service} ist ausgefallen`,
        problem: `Die stündliche Prüfung von ${row.service} ist mehrfach in Folge fehlgeschlagen oder der Zugangsschlüssel fehlt.`,
        numbers: [`Fehlversuche in Folge: ${row.consecutive_failures}`, `Hinweis: ${row.note ?? 'keiner'}`, `zuletzt erreichbar: ${row.last_ok_at ?? 'nie'}`],
      }),
      line: `${row.service}: ${row.note ?? 'ausgefallen'}`,
    });
    return;
  }
  const found = await db.from('admin_feedback').select('id, status').eq('external_ref', row.service).in('status', OPEN).limit(1);
  const item = found.data?.[0] as { id: string; status: string } | undefined;
  if (!item) return;
  await db.from('admin_feedback_messages').insert({ feedback_id: item.id, author_id: null, is_system: true, body: `Dienst ${row.service} ist wieder erreichbar.` });
  const humans = await db.from('admin_feedback_messages').select('id', { count: 'exact', head: true }).eq('feedback_id', item.id).eq('is_system', false);
  if (canAutoCloseServiceItem({ status: item.status, humanMessages: humans.count ?? 0 })) {
    await db.from('admin_feedback').update({ status: 'shipped', processing_note: 'Dienst wieder erreichbar', shipped_at: new Date().toISOString() }).eq('id', item.id);
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) { console.warn(`[${FN}] service role not configured`); return json({ ok: true, skipped: 'no_key' }); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const forced = checkSignalSecret(req.headers.get('x-signal-secret'), Deno.env.get('POSTHOG_SIGNAL_SECRET')) === 'ok';
  if (!forced && (await throttled(db, 'health', 50 * 60_000))) return json({ ok: true, skipped: 'throttled' });

  try {
    const now = new Date();
    const prevRows = await db.from('service_health').select('*');
    const prev = new Map<string, HealthRow>(((prevRows.data ?? []) as Record<string, unknown>[]).map((d) => [String(d.service), fromDbHealth(d)]));
    const results = await Promise.all(SERVICES.map(async (s) => ({ s, p: await probe(s, db).catch((e): ProbeResult => ({ ok: false, note: String((e as Error).message) })) })));
    const summary: Record<string, string> = {};
    for (const { s, p } of results) {
      const before = prev.get(s) ?? null;
      const row = nextHealth(before, p, s, EXPECTED_EVERY_SEC, now);
      await db.from('service_health').upsert(toDbHealth(row));
      summary[s] = row.level;
      const t = serviceTransition(before?.level ?? null, row.level);
      if (t !== 'none') await onTransition(db, t, row);
    }
    return json({ ok: true, services: summary });
  } catch (e) {
    await captureServerException(FN, e);
    console.warn(`[${FN}] ${(e as Error).message}`);
    return json({ ok: false, error: 'internal' });
  }
};

Deno.serve(withPosthog(FN, handler, { cron: true }));
