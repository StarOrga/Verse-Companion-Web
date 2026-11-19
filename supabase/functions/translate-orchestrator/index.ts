// translate-orchestrator — game-string translation job state machine.
// Contract: docs/translation/ARCHITECTURE.md. Operations: docs/translation/OPERATIONS.md.
//
//   POST { op: 'tick', fast? }                       ask every waiting job, run slices of one job or pass
//   POST { op: 'approve' | 'cancel', job_id }        admin
//   POST { op: 'start_full', build_id, lang }        admin: starts a full job; it is estimated in slices and then awaits approval
//   POST { op: 'import_seed', source_id }            admin, starts the import pass of a community pack (licensed|permitted only)
//   POST { op: 'sync_sources' }                      daily pg_cron (publishable key) or admin: starts a pass per changed source
//   POST { op: 'learn', lang }                       admin, starts a learning pass
// import_seed / sync_sources / learn only start a pass (translation_passes); later ticks run it in slices.
//   POST { op: 'draft_outreach', source_id }         admin, maintainer message DRAFT (never sent)
//
// AUTH (verify_jwt = false in config.toml; checked here):
//   * service-role key       -> every op
//   * the project's anon key -> `tick` ONLY (pg_cron has no vault for the service key). Safe:
//                               a tick only advances existing jobs and spends nothing unless
//                               settings.enabled and a job is queued/approved. Concurrent ticks
//                               are harmless: every transition is a compare-and-set.
//   * the anon/publishable key -> also `sync_sources` (daily cron): it only re-imports enabled
//                               licensed|permitted sources whose upstream changed, and a public-key
//                               caller is throttled to one run per 6 h (atomic claim_run) because it
//                               makes outbound GitHub calls with the server token. A `tick` without
//                               `fast` (it asks the provider about every batch) is throttled to one
//                               per 30 s for the same reason; a fast tick only takes the lock.
//   * a signed-in user for whom public.is_admin() is true (approved, not suspended; asked with the
//     CALLER's client, the rpc reads auth.uid()) -> every op
// The Anthropic key is TRANSLATE_ANTHROPIC_API_KEY only; absent -> jobs fail with
// `translate.no_api_key`. It is never the sc-events-sync key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { deleteObject, getObject, listObjects, putObject, r2FromEnv } from '../ingest-skins/_r2.ts';
import { BUILD_ID_RE, LANG_RE } from '../ingest-catalog/_locale-shards.ts';
import { makeLlm } from './_anthropic.ts';
import { makeDb } from './_db.ts';
import { approve, cancel, startFull, tickAll, TranslateError } from './_machine.ts';
import type { Deps } from './_machine.ts';
import type { Store } from './_io.ts';
import { requestLearning } from './_learn_pass.ts';
import { makePassDb, PASS_STEPS } from './_pass_db.ts';
import { draftOutreach, makeSourceDb, startImport, syncSources } from './_sources.ts';
import { writeAlerts } from './_alerts.ts';
import { makeLearnDb } from './_learn_db.ts';
import { withPosthog } from '../_shared/posthog.ts';
import { classifyToken } from './_auth.ts';
import { claimRun } from '../_shared/claim-run.ts';

function logWarn(msg: string, data?: Record<string, unknown>): void {
  console.warn(`translate-orchestrator: ${msg}`, data ? JSON.stringify(data) : '');
}
function logError(msg: string, data?: Record<string, unknown>): void {
  console.error(`translate-orchestrator: ${msg}`, data ? JSON.stringify(data) : '');
}

// sync_sources by a public-key caller (the daily cron): at most one run per 6 h, claimed atomically (claim_run).
const SYNC_SOURCES_PUBLIC_MIN_MS = 6 * 3600_000;
// A full tick by a public-key caller: the cron sends one every 10 minutes, nobody needs more.
const TICK_PUBLIC_MIN_MS = 30_000;
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// The heavy-work lock (lock_claim / lock_release). It is given back when the request has done its slices; the
// time to live only frees it after a request that was killed, so it is as long as the platform lets a request live.
const HEAVY_LOCK = 'translate-orchestrator:heavy';
const HEAVY_LOCK_TTL = '150 seconds';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

Deno.serve(withPosthog('translate-orchestrator', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const op = String(body?.op ?? '');

  // ── auth ──
  const token = bearer(req) || (req.headers.get('apikey') ?? '');
  let actor: string | null = null; // admin user id; null for service role
  let allowed = false;
  const kind = classifyToken(token, op, serviceKey, anonKey);
  const publicKeyCaller = kind === 'public'; // the public key only (no service key, no admin session)
  if (kind === 'service') allowed = true;
  // tick is the pg_cron entry point. The cron job sends the public sb_publishable_* key, which
  // the runtime's SUPABASE_ANON_KEY may not equal (it can still hold the legacy JWT). Both are
  // public, and tick only advances jobs already inside the caps, so either one is enough.
  else if (kind === 'public') allowed = true;
  else if (token) {
    const { data: { user } } = await admin.auth.getUser(token);
    if (user) {
      // is_admin() ignores a stale profiles.role of a suspended or unapproved account; it needs the caller's own client.
      const caller = createClient(supabaseUrl, anonKey, { global: { headers: { authorization: `Bearer ${token}` } }, auth: { autoRefreshToken: false, persistSession: false } });
      const { data: isAdmin } = await caller.rpc('is_admin');
      if (isAdmin === true) {
        allowed = true;
        actor = user.id;
      } else return json({ error: 'forbidden' }, 403);
    }
  }
  if (!allowed) return json({ error: 'unauthorized' }, 401);

  const r2 = r2FromEnv((k) => Deno.env.get(k));
  if (!r2) return json({ error: 'translate.r2_not_configured' }, 503);
  const store: Store = {
    async getJson(key) {
      try {
        return JSON.parse(new TextDecoder().decode(await getObject(r2, key, 128 * 1024 * 1024)));
      } catch (e) {
        if (/HTTP 404/.test(String((e as Error).message))) return null;
        throw e;
      }
    },
    putJson: (key, value) => putObject(r2, key, JSON.stringify(value), 'application/json'),
    putText: (key, text) => putObject(r2, key, text, 'application/json'),
    deleteKey: (key) => deleteObject(r2, key),
    list: async (prefix) => (await listObjects(r2, prefix)).map((o) => o.key),
  };
  const apiKey = (Deno.env.get('TRANSLATE_ANTHROPIC_API_KEY') ?? '').trim();
  const deps: Deps = {
    db: makeDb(admin, () => new Date()),
    store,
    llm: apiKey ? makeLlm(apiKey) : null,
    now: () => new Date(),
    log: (msg, data) => logWarn(msg, data),
    learn: makeLearnDb(admin, () => new Date()),
    alerts: async (lang, buildId, rows) => {
      await writeAlerts(admin, lang, buildId, rows);
    },
    passes: makePassDb(admin, () => new Date()),
    passSteps: PASS_STEPS,
    sources: makeSourceDb(admin, { ghToken: Deno.env.get('GITHUB_TOKEN') ?? undefined }),
    lock: {
      // Fails closed: when the rpc errors nobody slices (a slice that runs twice at once is worse than one that waits).
      claim: async () => {
        const { data, error } = await admin.rpc('lock_claim', { p_name: HEAVY_LOCK, p_ttl: HEAVY_LOCK_TTL });
        if (error) logWarn('lock_claim failed', { error: error.message });
        return typeof data === 'string' && data ? data : null;
      },
      release: async (token) => {
        const { error } = await admin.rpc('lock_release', { p_name: HEAVY_LOCK, p_token: token });
        if (error) logWarn('lock_release failed', { error: error.message });
      },
    },
  };

  try {
    switch (op) {
      case 'tick': {
        const fast = body.fast === true;
        if (publicKeyCaller && !fast && !(await claimRun(admin, 'translate-orchestrator:tick', TICK_PUBLIC_MIN_MS))) {
          return json({ ok: true, throttled: true, jobs: [], passes: [], learned: [], swept: [], heavy: false });
        }
        const work = tickAll(deps, { fast });
        // A tick can outlast the response; the platform keeps the isolate alive for it.
        (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(work.catch(() => {}));
        return json({ ok: true, ...(await work) });
      }
      case 'approve':
        if (!body.job_id) return json({ error: 'job_id_required' }, 400);
        return json({ ok: true, job: await approve(deps, String(body.job_id), actor) });
      case 'cancel':
        if (!body.job_id) return json({ error: 'job_id_required' }, 400);
        return json({ ok: true, job: await cancel(deps, String(body.job_id)) });
      case 'start_full': {
        const build_id = String(body.build_id ?? '');
        const lang = String(body.lang ?? '');
        if (!BUILD_ID_RE.test(build_id) || !LANG_RE.test(lang)) return json({ error: 'bad_params' }, 400);
        return json({ ok: true, job: await startFull(deps, build_id, lang) });
      }
      case 'import_seed': {
        const sourceId = String(body.source_id ?? '');
        if (!SOURCE_ID_RE.test(sourceId)) return json({ error: 'bad_params' }, 400);
        return json({ ok: true, ...(await startImport(deps, sourceId)) });
      }
      case 'sync_sources': {
        if (publicKeyCaller && !(await claimRun(admin, 'translate-orchestrator:sync_sources', SYNC_SOURCES_PUBLIC_MIN_MS))) {
          return json({ ok: true, throttled: true, checked: 0, changed: 0, errors: [] });
        }
        return json({ ok: true, ...(await syncSources(deps)) });
      }
      case 'learn': {
        const lang = String(body.lang ?? '');
        if (!LANG_RE.test(lang)) return json({ error: 'bad_params' }, 400);
        const pass = await requestLearning(deps, lang, 'backfill');
        return json({ ok: true, lang, queued: !!pass, pass_id: pass?.id ?? null });
      }
      case 'draft_outreach': {
        const sourceId = String(body.source_id ?? '');
        if (!SOURCE_ID_RE.test(sourceId)) return json({ error: 'bad_params' }, 400);
        return json({ ok: true, outreach: await draftOutreach(admin, sourceId) });
      }
      default:
        return json({ error: 'unknown_op' }, 400);
    }
  } catch (e) {
    if (e instanceof TranslateError) return json({ error: e.key }, 409);
    // Upstream fetch problems of a community source (not our bug): keep the key, 502.
    const em = String((e as Error)?.message ?? '');
    if (em.startsWith('translate.source_')) return json({ error: em }, 502);
    logError('translate-orchestrator failed', { op, error: String((e as Error)?.message ?? e) });
    return json({ error: 'translate.internal' }, 500);
  }
}, { cron: true }));
