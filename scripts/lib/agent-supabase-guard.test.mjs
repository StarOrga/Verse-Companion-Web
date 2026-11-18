/**
 * Tests for scripts/lib/agent-supabase-guard.cjs: the catalog cache and the
 * request throttle of Claude's own browsers.
 * Run: npm run test:gate
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const guard = require('./agent-supabase-guard.cjs');

const SUPABASE = 'https://proj.supabase.co';
const BUILD = '0b9f1a52-4c1e-4c3a-9f0e-1d2c3b4a5f60';
const OTHER_BUILD = '11111111-2222-4333-8444-555555555555';
const shipList = (build = BUILD) => `${SUPABASE}/rest/v1/codex_ships?select=class_name&build_id=eq.${build}&order=class_name.asc`;

function scratch(name) {
  return fs.mkdtempSync(join(tmpdir(), `sc-guard-test-${name}-`));
}

/** A JWT-shaped token; only the payload matters to the guard. */
function token(payload) {
  return `Bearer h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
}

describe('cacheKey', () => {
  const get = (url, extra = {}) => guard.cacheKey({ method: 'GET', url, ...extra });

  it('caches a catalog read of one build', () => {
    assert.match(get(shipList()), /^[0-9a-f]{64}$/);
    assert.notEqual(get(shipList()), get(shipList(OTHER_BUILD)));
  });

  it('caches the facet RPC by its body', () => {
    const rpc = (body) => guard.cacheKey({ method: 'POST', url: `${SUPABASE}/rest/v1/rpc/codex_facet_values`, body });
    const ship = rpc(JSON.stringify({ p_build_id: BUILD, p_kind: 'ship' }));
    assert.match(ship, /^[0-9a-f]{64}$/);
    assert.notEqual(ship, rpc(JSON.stringify({ p_build_id: BUILD, p_kind: 'weapon' })));
    assert.equal(rpc('{}'), null);
    assert.equal(rpc('not json'), null);
  });

  it('lets everything else reach the database', () => {
    const live = [
      `${SUPABASE}/rest/v1/codex_builds?select=id&is_current=eq.true`,
      `${SUPABASE}/rest/v1/codex_builds?build_id=eq.${BUILD}`,
      `${SUPABASE}/rest/v1/codex_ships?select=class_name`,
      `${SUPABASE}/rest/v1/codex_ships?build_id=in.(${BUILD})`,
      `${SUPABASE}/rest/v1/codex_ships?build_id=eq.not-a-uuid`,
      `${SUPABASE}/rest/v1/hangar_ships?build_id=eq.${BUILD}`,
      `${SUPABASE}/rest/v1/profiles?id=eq.${BUILD}`,
    ];
    for (const url of live) assert.equal(get(url), null, url);
    assert.equal(guard.cacheKey({ method: 'POST', url: shipList() }), null);
    assert.equal(guard.cacheKey({ method: 'PATCH', url: shipList() }), null);
    assert.equal(
      guard.cacheKey({ method: 'POST', url: `${SUPABASE}/rest/v1/rpc/codex_search`, body: JSON.stringify({ p_build_id: BUILD }) }),
      null,
    );
    assert.equal(get('no url'), null);
  });

  it('keeps answers apart that PostgREST would give differently', () => {
    const plain = get(shipList());
    assert.notEqual(plain, get(shipList(), { headers: { range: '0-99' } }));
    assert.notEqual(plain, get(shipList(), { headers: { prefer: 'count=exact' } }));
    assert.notEqual(plain, get(shipList(), { namespace: '20261118000000_x.sql' }));
  });

  it('shares an answer between sessions of one user, not between users', () => {
    const asUser = (payload) => get(shipList(), { headers: { authorization: token(payload) } });
    assert.equal(asUser({ sub: 'u1', exp: 1 }), asUser({ sub: 'u1', exp: 2 }));
    assert.notEqual(asUser({ sub: 'u1' }), asUser({ sub: 'u2' }));
    assert.notEqual(asUser({ sub: 'u1' }), get(shipList()));
    // A publishable key or an anon JWT is nobody in particular.
    assert.equal(get(shipList(), { headers: { authorization: 'Bearer sb_publishable_x' } }), get(shipList()));
    assert.equal(asUser({ role: 'anon' }), get(shipList()));
  });
});

describe('identityOf', () => {
  it('reads the user id and nothing else', () => {
    assert.equal(guard.identityOf(token({ sub: 'u1' })), 'u1');
    assert.equal(guard.identityOf(undefined), 'anon');
    assert.equal(guard.identityOf('Bearer a.%%%.c'), 'anon');
    assert.equal(guard.identityOf(token({ sub: 7 })), 'anon');
  });
});

describe('schemaStamp', () => {
  it('names the newest migration of a checkout', () => {
    const cwd = scratch('stamp');
    assert.equal(guard.schemaStamp(cwd), '');
    fs.mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true });
    for (const n of ['20260101000000_a.sql', '20261117203000_b.sql', 'README.md']) {
      fs.writeFileSync(join(cwd, 'supabase', 'migrations', n), '');
    }
    assert.equal(guard.schemaStamp(cwd), '20261117203000_b.sql');
  });
});

describe('cache entries', () => {
  const answer = { status: 200, headers: { 'content-type': 'application/json', 'Content-Encoding': 'gzip', 'content-range': '0-1/2' }, body: Buffer.from('[1,2]') };

  it('round-trips an answer without its transfer headers', () => {
    const dir = scratch('entry');
    assert.equal(guard.writeEntry(dir, 'k', answer), true);
    const hit = guard.readEntry(dir, 'k');
    assert.equal(hit.status, 200);
    assert.equal(hit.body.toString(), '[1,2]');
    assert.deepEqual(hit.headers, { 'content-type': 'application/json', 'content-range': '0-1/2' });
    assert.equal(guard.readEntry(dir, 'other'), null);
  });

  it('keeps successful answers only', () => {
    const dir = scratch('status');
    assert.equal(guard.writeEntry(dir, 'e', { ...answer, status: 500 }), false);
    assert.equal(guard.writeEntry(dir, 'e', { ...answer, status: 304 }), false);
    assert.equal(guard.writeEntry(dir, 'p', { ...answer, status: 206 }), true);
    assert.equal(guard.writeEntry(dir, 'big', { ...answer, body: Buffer.alloc(8 * 1024 * 1024 + 1) }), false);
    assert.equal(guard.readEntry(dir, 'e'), null);
  });

  it('expires an entry and removes it', () => {
    const dir = scratch('ttl');
    guard.writeEntry(dir, 'k', answer, 1_000);
    assert.ok(guard.readEntry(dir, 'k', 1_000 + guard.CACHE_TTL_MS));
    assert.equal(guard.readEntry(dir, 'k', 1_001 + guard.CACHE_TTL_MS), null);
    assert.equal(fs.existsSync(join(dir, 'k.json')), false);
  });

  it('prunes what is older than the lifetime', () => {
    const dir = scratch('prune');
    guard.writeEntry(dir, 'old', answer);
    guard.writeEntry(dir, 'new', answer);
    const past = new Date(Date.now() - guard.CACHE_TTL_MS - 60_000);
    fs.utimesSync(join(dir, 'old.json'), past, past);
    assert.equal(guard.pruneCache(dir), 1);
    assert.deepEqual(fs.readdirSync(dir), ['new.json']);
    assert.equal(guard.pruneCache(join(dir, 'missing')), 0);
  });
});

describe('acquireSlot', () => {
  it('hands out the slots and takes a released one again', async () => {
    const dir = scratch('slots');
    const a = await guard.acquireSlot({ dir, slots: 2 });
    const b = await guard.acquireSlot({ dir, slots: 2 });
    assert.equal(a.waitedOut || b.waitedOut, false);
    assert.equal(fs.readdirSync(dir).length, 2);
    a.release();
    a.release();
    const c = await guard.acquireSlot({ dir, slots: 2, waitMs: 0 });
    assert.equal(c.waitedOut, false);
  });

  it('waits for a slot, then lets the request through', async () => {
    const dir = scratch('full');
    const held = await guard.acquireSlot({ dir, slots: 1 });
    let clock = 0;
    const sleeps = [];
    const waiting = await guard.acquireSlot({
      dir,
      slots: 1,
      waitMs: 100,
      pollMs: 40,
      now: () => clock,
      staleMs: Number.POSITIVE_INFINITY,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    assert.equal(waiting.waitedOut, true);
    assert.deepEqual(sleeps, [40, 40, 40]);
    waiting.release();
    assert.equal(fs.readdirSync(dir).length, 1, 'a waited-out request never frees another one’s slot');
    held.release();
  });

  it('gets the slot as soon as it is released', async () => {
    const dir = scratch('handover');
    const held = await guard.acquireSlot({ dir, slots: 1 });
    const next = guard.acquireSlot({ dir, slots: 1, waitMs: 5_000, pollMs: 5 });
    setTimeout(() => held.release(), 30);
    assert.equal((await next).waitedOut, false);
  });

  it('takes over a slot whose browser died', async () => {
    const dir = scratch('stale');
    await guard.acquireSlot({ dir, slots: 1 });
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(join(dir, 'slot-0.lock'), past, past);
    const next = await guard.acquireSlot({ dir, slots: 1, staleMs: 30_000, waitMs: 1_000, pollMs: 5 });
    assert.equal(next.waitedOut, false);
  });
});

/** A fake BrowserContext and Route, recording what the guard does with a request. */
function fakeContext() {
  const ctx = { routes: [], listeners: {} };
  ctx.route = async (predicate, handler) => ctx.routes.push({ predicate, handler });
  ctx.on = (event, fn) => {
    ctx.listeners[event] = fn;
  };
  return ctx;
}

function fakeRoute({ method = 'GET', url, headers = {}, body = null, answer, fail = false }) {
  const route = { fetched: 0, fulfilled: null, aborted: null };
  route.request = () => ({ method: () => method, url: () => url, headers: () => headers, postData: () => body });
  route.fetch = async () => {
    route.fetched++;
    if (fail) throw new Error('net::ERR_FAILED');
    return { status: () => answer.status, headers: () => answer.headers, body: async () => answer.body };
  };
  route.fulfill = async (response) => {
    route.fulfilled = response;
  };
  route.abort = async (reason) => {
    route.aborted = reason;
  };
  return route;
}

describe('installSupabaseGuard', () => {
  const ok = { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('[{"class_name":"a"}]') };

  async function install(options = {}) {
    const context = fakeContext();
    const lines = [];
    const dirs = { cacheDir: scratch('cache'), slotDir: scratch('slot') };
    const installed = await guard.installSupabaseGuard(context, {
      supabaseUrl: SUPABASE,
      cwd: dirs.cacheDir,
      env: {},
      logLine: (l) => lines.push(l),
      ...dirs,
      ...options,
    });
    return { context, lines, installed, ...dirs, handle: (route) => context.routes[0].handler(route) };
  }

  it('is off without a Supabase URL or when switched off', async () => {
    assert.equal((await install({ supabaseUrl: undefined })).installed, false);
    const off = await install({ env: { SC_AGENT_SUPABASE_GUARD: 'OFF' } });
    assert.equal(off.installed, false);
    assert.equal(off.context.routes.length, 0);
  });

  it('watches the REST API of this project only', async () => {
    const { context, installed } = await install();
    assert.equal(installed, true);
    const { predicate } = context.routes[0];
    assert.equal(predicate(new URL(shipList())), true);
    assert.equal(predicate(new URL(`${SUPABASE}/auth/v1/token`)), false);
    assert.equal(predicate(new URL(`${SUPABASE}/functions/v1/news`)), false);
    assert.equal(predicate(new URL(`${SUPABASE}/storage/v1/object/x`)), false);
    assert.equal(predicate(new URL('https://other.supabase.co/rest/v1/codex_ships')), false);
  });

  it('asks the database once, then answers a catalog read from the cache', async () => {
    const { handle, cacheDir, slotDir } = await install();
    const first = fakeRoute({ url: shipList(), answer: ok });
    await handle(first);
    assert.equal(first.fetched, 1);
    assert.ok(first.fulfilled.response, 'the first answer is passed on as it came');
    assert.equal(fs.readdirSync(slotDir).length, 0, 'the slot is free again');

    const second = fakeRoute({ url: shipList(), answer: ok });
    await handle(second);
    assert.equal(second.fetched, 0);
    assert.equal(second.fulfilled.status, 200);
    assert.equal(second.fulfilled.body.toString(), ok.body.toString());

    // A second browser on this machine starts with the same cache.
    const other = await install({ cacheDir, slotDir });
    const third = fakeRoute({ url: shipList(), answer: ok });
    await other.handle(third);
    assert.equal(third.fetched, 0);
  });

  it('throttles every other request without caching it', async () => {
    const { handle, cacheDir } = await install();
    const url = `${SUPABASE}/rest/v1/hangar_ships?select=id`;
    for (const method of ['GET', 'GET', 'POST', 'PATCH']) {
      const route = fakeRoute({ method, url, answer: ok });
      await handle(route);
      assert.equal(route.fetched, 1, method);
      assert.ok(route.fulfilled.response, method);
    }
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  });

  it('does not keep a failed answer', async () => {
    const { handle } = await install();
    await handle(fakeRoute({ url: shipList(), answer: { ...ok, status: 500 } }));
    const again = fakeRoute({ url: shipList(), answer: ok });
    await handle(again);
    assert.equal(again.fetched, 1);
  });

  it('fails the request and frees the slot when the network fails', async () => {
    const { handle, slotDir } = await install();
    const route = fakeRoute({ url: shipList(), fail: true });
    await handle(route);
    assert.equal(route.aborted, 'failed');
    assert.equal(route.fulfilled, null);
    assert.equal(fs.readdirSync(slotDir).length, 0);
  });

  it('lets a request through when the queue stays full', async () => {
    const { handle, slotDir, lines, context } = await install({ slotOptions: { slots: 1, waitMs: 0 } });
    fs.writeFileSync(join(slotDir, 'slot-0.lock'), '');
    const route = fakeRoute({ url: `${SUPABASE}/rest/v1/profiles?select=id`, answer: ok });
    await handle(route);
    assert.equal(route.fetched, 1);
    assert.equal(fs.existsSync(join(slotDir, 'slot-0.lock')), true);
    context.listeners.close();
    assert.match(lines.at(-1), /1 requests, 0 from the catalog cache, 0 stored, 1 passed a full queue/);
  });
});

/** A fake of the mobile gate's CDP client: records commands, lets a test fire events. */
function fakeCdp({ body = '[{"class_name":"a"}]', base64Encoded = false, failOn = null } = {}) {
  const cdp = { sent: [], handlers: new Map() };
  cdp.send = async (method, params, sessionId) => {
    cdp.sent.push({ method, params, sessionId });
    if (method === failOn) throw new Error(`${method} failed`);
    if (method === 'Fetch.getResponseBody') return { body, base64Encoded };
    return {};
  };
  cdp.on = (sessionId, event, handler) => cdp.handlers.set(`${sessionId}|${event}`, handler);
  cdp.pause = async (params) => {
    cdp.handlers.get('s1|Fetch.requestPaused')(params);
    // The handler is fire-and-forget, as with a real socket: let it settle.
    await new Promise((r) => setTimeout(r, 15));
  };
  cdp.commands = (method) => cdp.sent.filter((c) => c.method === method);
  return cdp;
}

describe('installSupabaseGuardCdp (the mobile gate)', () => {
  const request = (extra = {}) => ({
    method: 'GET',
    url: shipList(),
    headers: { Origin: 'http://127.0.0.1:4310', Prefer: 'count=exact' },
    ...extra,
  });
  const answerHeaders = [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Content-Range', value: '0-0/1' },
    { name: 'Content-Encoding', value: 'br' },
    { name: 'Access-Control-Allow-Origin', value: 'http://localhost:4200' },
  ];

  async function install(cdp, options = {}) {
    const dirs = { cacheDir: options.cacheDir ?? scratch('cdp-cache'), slotDir: options.slotDir ?? scratch('cdp-slot') };
    const handle = await guard.installSupabaseGuardCdp(cdp, 's1', {
      supabaseUrl: SUPABASE,
      cwd: dirs.cacheDir,
      env: {},
      ...options,
      ...dirs,
    });
    return { handle, ...dirs };
  }

  it('is off when switched off and enables nothing', async () => {
    const cdp = fakeCdp();
    assert.equal(
      await guard.installSupabaseGuardCdp(cdp, 's1', { supabaseUrl: SUPABASE, env: { SC_AGENT_SUPABASE_GUARD: 'off' } }),
      null,
    );
    assert.equal(await guard.installSupabaseGuardCdp(cdp, 's1', { env: {} }), null);
    assert.equal(cdp.sent.length, 0);
  });

  it('pauses the REST API of this project at both stages', async () => {
    const cdp = fakeCdp();
    await install(cdp);
    const [enable] = cdp.commands('Fetch.enable');
    assert.equal(enable.sessionId, 's1');
    assert.deepEqual(enable.params.patterns, [
      { urlPattern: `${SUPABASE}/rest/v1/*`, requestStage: 'Request' },
      { urlPattern: `${SUPABASE}/rest/v1/*`, requestStage: 'Response' },
    ]);
  });

  it('stores a catalog answer and gives it to the next device with its own origin allowed', async () => {
    const cdp = fakeCdp();
    const { handle, cacheDir, slotDir } = await install(cdp);
    await cdp.pause({ requestId: 'r1', request: request() });
    assert.equal(cdp.commands('Fetch.continueRequest').length, 1);
    assert.equal(fs.readdirSync(slotDir).length, 1, 'the request holds a slot while it is on the network');
    await cdp.pause({ requestId: 'r1', request: request(), responseStatusCode: 200, responseHeaders: answerHeaders });
    assert.equal(cdp.commands('Fetch.getResponseBody').length, 1);
    assert.equal(cdp.commands('Fetch.continueRequest').length, 2, 'the paused answer is let through');
    assert.equal(fs.readdirSync(slotDir).length, 0);

    const next = fakeCdp();
    const second = await install(next, { cacheDir, slotDir });
    await next.pause({
      requestId: 'r9',
      request: request({ headers: { origin: 'http://127.0.0.1:4311', prefer: 'count=exact' } }),
    });
    assert.equal(next.commands('Fetch.continueRequest').length, 0);
    const [fulfilled] = next.commands('Fetch.fulfillRequest');
    assert.equal(fulfilled.params.responseCode, 200);
    assert.equal(Buffer.from(fulfilled.params.body, 'base64').toString(), '[{"class_name":"a"}]');
    const headers = Object.fromEntries(fulfilled.params.responseHeaders.map((h) => [h.name, h.value]));
    assert.deepEqual(headers, {
      'content-type': 'application/json',
      'content-range': '0-0/1',
      'access-control-allow-origin': 'http://127.0.0.1:4311',
    });
    assert.match(handle.summary(), /1 database requests, 0 from the catalog cache, 1 stored/);
    assert.match(second.handle.summary(), /1 database requests, 1 from the catalog cache, 0 stored/);
  });

  it('keeps the count read without asking for a body', async () => {
    const cdp = fakeCdp();
    const { cacheDir } = await install(cdp);
    await cdp.pause({ requestId: 'h1', request: request({ method: 'HEAD' }) });
    await cdp.pause({
      requestId: 'h1',
      request: request({ method: 'HEAD' }),
      responseStatusCode: 206,
      responseHeaders: answerHeaders,
    });
    assert.equal(cdp.commands('Fetch.getResponseBody').length, 0);
    assert.equal(fs.readdirSync(cacheDir).length, 1);
  });

  it('queues other requests, caches nothing and lets preflights straight through', async () => {
    const cdp = fakeCdp();
    const { cacheDir, slotDir } = await install(cdp);
    const profiles = { method: 'GET', url: `${SUPABASE}/rest/v1/profiles?select=id`, headers: {} };
    await cdp.pause({ requestId: 'o1', request: { ...profiles, method: 'OPTIONS' } });
    assert.equal(fs.readdirSync(slotDir).length, 0);
    await cdp.pause({ requestId: 'p1', request: profiles });
    assert.equal(fs.readdirSync(slotDir).length, 1);
    await cdp.pause({ requestId: 'p1', request: profiles, responseStatusCode: 200, responseHeaders: answerHeaders });
    assert.equal(fs.readdirSync(slotDir).length, 0);
    assert.equal(cdp.commands('Fetch.getResponseBody').length, 0);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
    assert.equal(cdp.commands('Fetch.continueRequest').length, 3);
  });

  it('does not key an RPC whose body Chrome did not hand over', async () => {
    const cdp = fakeCdp();
    const { cacheDir } = await install(cdp);
    const rpc = { method: 'POST', url: `${SUPABASE}/rest/v1/rpc/codex_facet_values`, headers: {}, hasPostData: true };
    await cdp.pause({ requestId: 'f1', request: rpc });
    await cdp.pause({ requestId: 'f1', request: rpc, responseStatusCode: 200, responseHeaders: answerHeaders });
    assert.deepEqual(fs.readdirSync(cacheDir), []);
    const withBody = { ...rpc, postData: JSON.stringify({ p_build_id: BUILD, p_kind: 'ship' }) };
    await cdp.pause({ requestId: 'f2', request: withBody });
    await cdp.pause({ requestId: 'f2', request: withBody, responseStatusCode: 200, responseHeaders: answerHeaders });
    assert.equal(fs.readdirSync(cacheDir).length, 1);
  });

  it('frees the slot on a failed request, a lost answer and at teardown', async () => {
    const cdp = fakeCdp();
    const { handle, slotDir } = await install(cdp, { holdMs: 20 });
    await cdp.pause({ requestId: 'e1', request: request() });
    await cdp.pause({ requestId: 'e1', request: request(), responseErrorReason: 'Failed' });
    assert.equal(fs.readdirSync(slotDir).length, 0);
    assert.equal(cdp.commands('Fetch.getResponseBody').length, 0);

    await cdp.pause({ requestId: 'lost', request: request() });
    assert.equal(fs.readdirSync(slotDir).length, 1);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(fs.readdirSync(slotDir).length, 0, 'an answer that never came gives the slot back');

    await cdp.pause({ requestId: 'open', request: { method: 'GET', url: `${SUPABASE}/rest/v1/profiles`, headers: {} } });
    handle.dispose();
    assert.equal(fs.readdirSync(slotDir).length, 0);
  });

  it('never fails a request when its own bookkeeping fails', async () => {
    const cdp = fakeCdp({ failOn: 'Fetch.getResponseBody' });
    const { cacheDir } = await install(cdp);
    await cdp.pause({ requestId: 'b1', request: request() });
    await cdp.pause({ requestId: 'b1', request: request(), responseStatusCode: 200, responseHeaders: answerHeaders });
    assert.deepEqual(fs.readdirSync(cacheDir), []);
    assert.equal(cdp.commands('Fetch.continueRequest').length, 2);
  });
});
