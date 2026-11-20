/**
 * Keeps Claude's own browsers from load-testing the live database.
 *
 * Why: the Supabase instance has 0.5 GB of RAM and pays for every request with
 * disk IO from swap (.claude/deep-knowledge/supabase.md, "The instance swaps").
 * On 2026-11-15 it took 201 137 API requests, 142 871 of them from headless
 * browsers of agent runs. Each of those browsers starts with an empty profile
 * (PLAYWRIGHT_MCP_ISOLATED, see test-session.cjs), so each one loaded the whole
 * catalog again, and several ran at once.
 *
 * What this does for every browser context the test session prepares:
 *
 *   1. Catalog cache. A read that is a pure function of a build id is answered
 *      from a cache on disk that all of Claude's browsers on this machine share:
 *      GET /rest/v1/codex_<x>?…build_id=eq.<uuid>… and the facet RPC. A re-upload
 *      is a new build, so a build id names fixed rows; what can still change in
 *      place (a translated name, a view after a migration) is bounded by the
 *      12-hour lifetime of an entry and by the schema stamp below. The cache
 *      holds public catalog rows only - never a session, never a token.
 *   2. Queue. Every other request to /rest/v1/ waits for one of two slots that
 *      all of Claude's browsers on this machine share, so five sessions loading
 *      a page at once reach the database two requests at a time. A request
 *      never waits longer than SLOT_WAIT_MS: a full queue lets it through, so a
 *      test cannot hang on it - the limit is soft by design.
 *
 * Auth, storage, functions and realtime are not touched.
 *
 * When the cache is in the way (you changed catalog data or a catalog view and
 * want to see it now):
 *   SC_AGENT_SUPABASE_GUARD=off          no cache, no throttle for that session
 *   node scripts/lib/agent-supabase-guard.cjs --clear    empty the cache
 * A checkout with a newer migration than the cache was filled under reads past
 * it on its own (schema stamp = newest file in supabase/migrations).
 */
'use strict';

const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CACHE_DIR = join(tmpdir(), 'sc-agent-catalog-cache');
const SLOT_DIR = join(tmpdir(), 'sc-agent-supabase-slots');

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
/**
 * Requests of all agent browsers on this machine that may be in flight at once.
 * Two, not one: a strict queue would turn one slow answer into a timeout in
 * every waiting test (the app gives a read 20 s).
 */
const SLOTS = 2;
/** A slot older than this belongs to a browser that died; the app's own read deadline is 20 s. */
const SLOT_STALE_MS = 30_000;
const SLOT_WAIT_MS = 6_000;
const SLOT_POLL_MS = 40;
const STATS_EVERY = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Catalog views and tables whose rows belong to one build. `codex_builds` itself must stay live. */
const CATALOG_PATH = /^\/rest\/v1\/codex_(?!builds$)[a-z0-9_]+$/;
/** Read-only RPCs that are a pure function of (build id, fixed arguments). */
const CACHED_RPCS = new Set(['/rest/v1/rpc/codex_facet_values']);
/** Request headers that change what PostgREST answers. */
const VARY_HEADERS = ['range', 'range-unit', 'prefer', 'accept', 'accept-profile'];
/** Response headers that describe the transfer, not the content. */
const DROP_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

function isSupabaseRest(url, supabaseUrl) {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    return u.origin === new URL(supabaseUrl).origin && u.pathname.startsWith('/rest/v1/');
  } catch {
    return false;
  }
}

function buildIdOfQuery(url) {
  const value = url.searchParams.get('build_id') ?? '';
  const id = value.startsWith('eq.') ? value.slice(3) : '';
  return UUID.test(id) ? id.toLowerCase() : null;
}

function buildIdOfBody(body) {
  try {
    const id = JSON.parse(body ?? '')?.p_build_id;
    return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Who asks: the user id of a signed-in session, else 'anon'. Row-level security
 * may answer two users differently (a staged build only an admin sees), so an
 * answer is shared between browsers of the same user only. Every test-account
 * browser is the same user, whatever its token.
 */
function identityOf(authorization) {
  const part = String(authorization ?? '')
    .replace(/^Bearer\s+/i, '')
    .split('.')[1];
  if (!part) return 'anon';
  try {
    const sub = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))?.sub;
    return typeof sub === 'string' && sub ? sub : 'anon';
  } catch {
    return 'anon';
  }
}

/** The newest migration of a checkout: answers cached under an older schema are not reused. */
function schemaStamp(cwd) {
  try {
    const names = fs.readdirSync(join(cwd, 'supabase', 'migrations')).filter((n) => n.endsWith('.sql'));
    return names.sort().at(-1) ?? '';
  } catch {
    return '';
  }
}

/**
 * The cache key of a request, or null when it must reach the database.
 * @param {{ method: string, url: string, headers?: Record<string, string>, body?: string | null, namespace?: string }} req
 */
function cacheKey(req) {
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  const method = req.method.toUpperCase();
  let build = null;
  // HEAD is the count read of the same list (`Prefer: count=exact`, answer in content-range).
  if ((method === 'GET' || method === 'HEAD') && CATALOG_PATH.test(url.pathname)) build = buildIdOfQuery(url);
  else if (method === 'POST' && CACHED_RPCS.has(url.pathname)) build = buildIdOfBody(req.body);
  if (!build) return null;
  const headers = req.headers ?? {};
  const vary = VARY_HEADERS.map((h) => `${h}=${headers[h] ?? ''}`).join('\n');
  return createHash('sha256')
    .update(
      [req.namespace ?? '', identityOf(headers.authorization), method, url.pathname + url.search, req.body ?? '', vary].join('\n'),
    )
    .digest('hex');
}

function entryPath(dir, key) {
  return join(dir, `${key}.json`);
}

/** A stored answer that is still fresh, or null. An expired one is removed. */
function readEntry(dir, key, now = Date.now(), ttlMs = CACHE_TTL_MS) {
  const file = entryPath(dir, key);
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (now - entry.storedAt > ttlMs) {
      fs.rmSync(file, { force: true });
      return null;
    }
    return { status: entry.status, headers: entry.headers, body: Buffer.from(entry.body, 'base64') };
  } catch {
    return null;
  }
}

/** Stores an answer; false when it is not worth or not possible to keep. */
function writeEntry(dir, key, { status, headers, body }, now = Date.now()) {
  if ((status !== 200 && status !== 206) || body.length > MAX_ENTRY_BYTES) return false;
  const kept = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!DROP_HEADERS.has(name.toLowerCase())) kept[name] = value;
  }
  const file = entryPath(dir, key);
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ storedAt: now, status, headers: kept, body: body.toString('base64') }));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    fs.rmSync(tmp, { force: true });
    return false;
  }
}

/** Removes expired entries and abandoned temp files; returns how many went. */
function pruneCache(dir, now = Date.now(), ttlMs = CACHE_TTL_MS) {
  let removed = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const file = join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > ttlMs) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {
      /* gone meanwhile */
    }
  }
  return removed;
}

/**
 * Takes one of the machine-wide request slots. Resolves with a release function
 * that is safe to call twice; `waitedOut` is true when the queue stayed full for
 * `waitMs` and the request goes through without a slot.
 */
async function acquireSlot({
  dir = SLOT_DIR,
  slots = SLOTS,
  staleMs = SLOT_STALE_MS,
  waitMs = SLOT_WAIT_MS,
  pollMs = SLOT_POLL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return { release() {}, waitedOut: true };
  }
  const started = now();
  for (;;) {
    for (let i = 0; i < slots; i++) {
      const file = join(dir, `slot-${i}.lock`);
      try {
        fs.closeSync(fs.openSync(file, 'wx'));
        let held = true;
        return {
          release() {
            if (!held) return;
            held = false;
            fs.rmSync(file, { force: true });
          },
          waitedOut: false,
        };
      } catch (e) {
        if (e.code !== 'EEXIST') return { release() {}, waitedOut: true };
        try {
          if (now() - fs.statSync(file).mtimeMs > staleMs) fs.rmSync(file, { force: true });
        } catch {
          /* released meanwhile: the next pass takes it */
        }
      }
    }
    if (now() - started >= waitMs) return { release() {}, waitedOut: true };
    await sleep(pollMs);
  }
}

/**
 * Registers the guard on a browser context. Returns false when it is switched
 * off or there is no Supabase URL to guard.
 */
async function installSupabaseGuard(
  context,
  {
    supabaseUrl,
    cwd = process.cwd(),
    env = process.env,
    logLine = () => {},
    cacheDir = CACHE_DIR,
    slotDir = SLOT_DIR,
    slotOptions = {},
  } = {},
) {
  if (!supabaseUrl || String(env.SC_AGENT_SUPABASE_GUARD ?? '').toLowerCase() === 'off') return false;
  pruneCache(cacheDir);
  const namespace = schemaStamp(cwd);
  const stats = { requests: 0, cached: 0, stored: 0, waitedOut: 0 };
  const summary = () =>
    `guard: ${stats.requests} requests, ${stats.cached} from the catalog cache, ${stats.stored} stored, ${stats.waitedOut} passed a full queue`;

  await context.route(
    (url) => isSupabaseRest(url, supabaseUrl),
    async (route) => {
      const request = route.request();
      const key = cacheKey({
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        body: request.postData(),
        namespace,
      });
      stats.requests++;
      if (stats.requests % STATS_EVERY === 0) logLine(summary());
      if (key) {
        const hit = readEntry(cacheDir, key);
        if (hit) {
          stats.cached++;
          // The stored answer was given to some page of ours, maybe on another origin (a dev server,
          // the gate's static server): PostgREST echoes the asking origin, so this page needs its own
          // allowed or the browser blocks the cached answer (seen on live, 2026-11-20).
          const headers = { ...hit.headers, 'access-control-allow-origin': request.headers().origin ?? '*' };
          // The page may be gone by now; a rejection here would be unhandled in the MCP server's process.
          return route.fulfill({ status: hit.status, headers, body: hit.body }).catch(() => {});
        }
      }
      const slot = await acquireSlot({ dir: slotDir, ...slotOptions });
      if (slot.waitedOut) stats.waitedOut++;
      try {
        // fetch + fulfill, not continue: the slot is held until the answer is there.
        const response = await route.fetch();
        if (key) {
          const answer = { status: response.status(), headers: response.headers(), body: await response.body() };
          if (writeEntry(cacheDir, key, answer)) stats.stored++;
        }
        await route.fulfill({ response });
      } catch {
        // The page went away or the network failed: the page sees a failed request, as it would without the guard.
        await route.abort('failed').catch(() => {});
      } finally {
        slot.release();
      }
    },
  );
  if (typeof context.on === 'function') context.on('close', () => logLine(`${summary()} (context closed)`));
  logLine(`guard: catalog cache + ${slotOptions.slots ?? SLOTS} request slots for ${new URL(supabaseUrl).host}`);
  return true;
}

/**
 * The same guard for a browser driven over raw CDP (scripts/mobile-gate.mjs has
 * no Playwright context): the Fetch domain pauses every request to /rest/v1/
 * twice. At the request stage a cached catalog read is answered at once, any
 * other request takes a slot and goes on; at the response stage the slot is
 * freed and a catalog answer is stored. `cdp` needs `send(method, params,
 * sessionId)` and `on(sessionId, event, handler)`.
 *
 * Returns `{ summary }` or null when switched off. A failure in here never
 * fails a request: whatever goes wrong, the request continues untouched.
 */
async function installSupabaseGuardCdp(
  cdp,
  sessionId,
  {
    supabaseUrl,
    cwd = process.cwd(),
    env = process.env,
    cacheDir = CACHE_DIR,
    slotDir = SLOT_DIR,
    slotOptions = {},
    holdMs = SLOT_STALE_MS,
  } = {},
) {
  if (!supabaseUrl || String(env.SC_AGENT_SUPABASE_GUARD ?? '').toLowerCase() === 'off') return null;
  const origin = new URL(supabaseUrl).origin;
  pruneCache(cacheDir);
  const namespace = schemaStamp(cwd);
  const stats = { requests: 0, cached: 0, stored: 0, waitedOut: 0 };
  /** requestId → what a request that went on to the network holds until its answer is there. */
  const onNetwork = new Map();
  const send = (method, params) => cdp.send(method, params, sessionId).catch(() => {}); // the tab may be gone
  const settle = (requestId) => {
    const held = onNetwork.get(requestId);
    if (!held) return null;
    onNetwork.delete(requestId);
    clearTimeout(held.timer);
    held.slot.release();
    return held;
  };

  async function atResponse(p) {
    const held = settle(p.requestId);
    const status = p.responseStatusCode;
    if (held?.key && (status === 200 || status === 206)) {
      try {
        let body = Buffer.alloc(0);
        if (held.method !== 'HEAD') {
          const got = await cdp.send('Fetch.getResponseBody', { requestId: p.requestId }, sessionId);
          body = Buffer.from(got.body ?? '', got.base64Encoded ? 'base64' : 'utf8');
        }
        const headers = Object.fromEntries((p.responseHeaders ?? []).map((h) => [h.name.toLowerCase(), h.value]));
        if (writeEntry(cacheDir, held.key, { status, headers, body })) stats.stored++;
      } catch {
        /* no body to keep: the answer still reaches the page below */
      }
    }
    // Without overrides this lets the paused response through as it came.
    return send('Fetch.continueRequest', { requestId: p.requestId });
  }

  async function atRequest(p) {
    const { requestId, request } = p;
    const method = String(request.method).toUpperCase();
    // A CORS preflight never reaches Postgres; nothing to cache or to queue.
    if (method === 'OPTIONS') return send('Fetch.continueRequest', { requestId });
    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([n, v]) => [n.toLowerCase(), v]));
    // A body Chrome did not hand over (hasPostData without postData) cannot be keyed.
    const body = request.postData ?? null;
    const key = request.hasPostData && body === null ? null : cacheKey({ method, url: request.url, headers, body, namespace });
    stats.requests++;
    if (key) {
      const hit = readEntry(cacheDir, key);
      if (hit) {
        stats.cached++;
        // The stored answer was given to some page of ours; this page needs its own origin allowed.
        const answer = { ...hit.headers, 'access-control-allow-origin': headers.origin ?? '*' };
        return send('Fetch.fulfillRequest', {
          requestId,
          responseCode: hit.status,
          responseHeaders: Object.entries(answer).map(([name, value]) => ({ name, value: String(value) })),
          body: hit.body.toString('base64'),
        });
      }
    }
    const slot = await acquireSlot({ dir: slotDir, ...slotOptions });
    if (slot.waitedOut) stats.waitedOut++;
    // A request whose answer never comes (the tab navigated away) must not keep its slot.
    const timer = setTimeout(() => settle(requestId), holdMs);
    timer.unref?.();
    onNetwork.set(requestId, { key, method, slot, timer });
    return send('Fetch.continueRequest', { requestId });
  }

  cdp.on(sessionId, 'Fetch.requestPaused', (p) => {
    const stage = p.responseStatusCode !== undefined || p.responseErrorReason !== undefined ? atResponse : atRequest;
    stage(p).catch(() => {
      settle(p.requestId);
      return send('Fetch.continueRequest', { requestId: p.requestId });
    });
  });
  await cdp.send(
    'Fetch.enable',
    {
      patterns: [
        { urlPattern: `${origin}/rest/v1/*`, requestStage: 'Request' },
        { urlPattern: `${origin}/rest/v1/*`, requestStage: 'Response' },
      ],
    },
    sessionId,
  );
  return {
    summary: () =>
      `${stats.requests} database requests, ${stats.cached} from the catalog cache, ${stats.stored} stored, ${stats.waitedOut} passed a full queue`,
    /** Frees whatever is still held; call before the tab goes. */
    dispose() {
      for (const requestId of [...onNetwork.keys()]) settle(requestId);
    },
  };
}

module.exports = {
  CACHE_DIR,
  CACHE_TTL_MS,
  SLOT_DIR,
  SLOTS,
  acquireSlot,
  cacheKey,
  identityOf,
  installSupabaseGuard,
  installSupabaseGuardCdp,
  isSupabaseRest,
  pruneCache,
  readEntry,
  schemaStamp,
  writeEntry,
};

if (require.main === module) {
  if (process.argv.includes('--clear')) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    process.stdout.write(`cleared ${CACHE_DIR}\n`);
  } else {
    let entries = 0;
    try {
      entries = fs.readdirSync(CACHE_DIR).filter((n) => n.endsWith('.json')).length;
    } catch {
      /* no cache yet */
    }
    process.stdout.write(`${CACHE_DIR}: ${entries} entries (--clear empties it)\n`);
  }
}
