// node --test supabase/functions/ingest-catalog/_self-call.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { SELF_CALL_RETRY_MS, WORKER_ID, callOwnOp } from './_self-call.ts';

const URL_BASE = 'https://proj.supabase.co';
const KEY = 'service-key-value';
const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const AGAIN = { retryThrown: true };
const ONCE = { retryThrown: false };

/** Deps that answer each call from `answers` in order (a function throws like a network error). */
function fake(answers) {
  const calls = [];
  const waits = [];
  const logs = [];
  let cancelled = 0;
  return {
    calls,
    waits,
    logs,
    cancelled: () => cancelled,
    deps: {
      fetch: async (url, init) => {
        calls.push({ url, init });
        const a = answers[calls.length - 1];
        if (typeof a === 'function') return a();
        return {
          ok: a.status >= 200 && a.status < 300,
          status: a.status,
          text: async () => a.text ?? '',
          body: { cancel: async () => { cancelled++; if (a.cancelFails) throw new Error('stream locked'); } },
        };
      },
      wait: async (ms) => { waits.push(ms); },
      log: (m) => logs.push(m),
    },
  };
}

describe('callOwnOp', () => {
  it('posts the body to the function with the service key in both headers', async () => {
    const f = fake([{ status: 202 }]);
    const ok = await callOwnOp(URL_BASE, KEY, { op: 'lists_publish', build_id: BUILD, detach: true }, ONCE, f.deps);
    assert.equal(ok, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `${URL_BASE}/functions/v1/ingest-catalog`);
    assert.equal(f.calls[0].init.method, 'POST');
    assert.deepEqual(f.calls[0].init.headers, {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      apikey: KEY,
    });
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { op: 'lists_publish', build_id: BUILD, detach: true });
    assert.equal(f.cancelled(), 1, 'the unread answer is released');
    assert.deepEqual(f.waits, []);
    assert.deepEqual(f.logs, []);
  });

  it('retries once after a pause when the first answer is an error', async () => {
    const f = fake([{ status: 503, text: 'boot error' }, { status: 200 }]);
    const ok = await callOwnOp(URL_BASE, KEY, { op: 'silhouettes_publish', build_id: BUILD, chain: true }, AGAIN, f.deps);
    assert.equal(ok, true);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.waits, [SELF_CALL_RETRY_MS]);
    assert.equal(f.logs.length, 1);
    assert.match(f.logs[0], /silhouettes_publish .*HTTP 503 boot error/);
  });

  it('retries once when the request itself fails and the op may run twice', async () => {
    const f = fake([() => { throw new Error('connection reset'); }, { status: 200 }]);
    assert.equal(await callOwnOp(URL_BASE, KEY, { op: 'lists_publish', build_id: BUILD }, AGAIN, f.deps), true);
    assert.equal(f.calls.length, 2);
    assert.match(f.logs[0], /failed: connection reset/);
  });

  it('gives up after the second failure and says so', async () => {
    const f = fake([{ status: 500, text: 'x'.repeat(500) }, { status: 546, text: 'resource limit' }]);
    assert.equal(await callOwnOp(URL_BASE, KEY, { op: 'lists_publish', build_id: BUILD }, AGAIN, f.deps), false);
    assert.equal(f.calls.length, 2, 'no third attempt');
    assert.deepEqual(f.waits, [SELF_CALL_RETRY_MS], 'no pause after the last attempt');
    assert.equal(f.logs.length, 2);
    assert.ok(f.logs[0].length < 300, 'an error body is cut');
  });

  it('does not send a request again that threw when the op must not run twice', async () => {
    const f = fake([() => { throw new Error('connection reset'); }, { status: 202 }]);
    assert.equal(await callOwnOp(URL_BASE, KEY, { op: 'lists_publish', build_id: BUILD, detach: true }, ONCE, f.deps), false);
    assert.equal(f.calls.length, 1, 'the request may have arrived: no second publish');
    assert.deepEqual(f.waits, []);
    assert.match(f.logs[0], /failed: connection reset/);
  });

  it('still retries a refusal when the op must not run twice (nothing ran)', async () => {
    const f = fake([{ status: 503, text: 'boot error' }, { status: 202 }]);
    assert.equal(await callOwnOp(URL_BASE, KEY, { op: 'lists_publish', build_id: BUILD, detach: true }, ONCE, f.deps), true);
    assert.equal(f.calls.length, 2);
  });

  it('an accepted call stays accepted when releasing its answer fails', async () => {
    const f = fake([{ status: 202, cancelFails: true }, { status: 202 }]);
    assert.equal(await callOwnOp(URL_BASE, KEY, { op: 'lists_publish', build_id: BUILD, detach: true }, AGAIN, f.deps), true);
    assert.equal(f.calls.length, 1, 'no second call after a 2xx');
    assert.deepEqual(f.logs, []);
  });

  it('names its worker with a short id', () => {
    assert.match(WORKER_ID, /^[0-9a-f]{8}$/);
  });

  it('never logs the service key', async () => {
    const f = fake([{ status: 401, text: 'bad jwt' }, () => { throw new Error('down'); }]);
    await callOwnOp(URL_BASE, KEY, { op: 'lists_publish', build_id: BUILD }, AGAIN, f.deps);
    for (const line of f.logs) assert.ok(!line.includes(KEY), line);
  });
});

// index.ts is the Deno entry and cannot be imported here; its wiring is read as text.
describe('finalize wiring (index.ts)', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const start = src.indexOf("if (op === 'finalize') {");
  const end = src.indexOf("if (op === 'locale_publish') {");
  const finalize = src.slice(start, end);

  it('finds the finalize branch', () => {
    assert.ok(start > 0 && end > start);
  });

  it('starts the lists publish as a call of its own, before the locale publish', () => {
    const lists = finalize.indexOf('callListsPublish(supabaseUrl, serviceKey, buildId)');
    const locale = finalize.indexOf('publishBuildLocales(');
    assert.ok(lists > 0, 'finalize calls callListsPublish');
    assert.ok(locale > lists, 'the lists call is started first');
  });

  it('no longer publishes the lists on the finalize worker', () => {
    assert.ok(!finalize.includes('publishLists('), 'publishLists runs only in lists_publish');
  });

  it('sends the lists call once, the silhouette step again after a lost answer', () => {
    assert.ok(src.includes("{ op: 'lists_publish', build_id: buildId, detach: true }, { retryThrown: false })"));
    assert.ok(src.includes("op: 'silhouettes_publish', chain: true }, { retryThrown: true })"));
  });

  it('lets only the service key detach a lists publish', () => {
    const op = src.slice(src.indexOf("if (op === 'lists_publish') {"), src.indexOf("if (op === 'silhouettes_publish') {"));
    assert.match(op, /body\.detach === true && !!authHeader && safeEqual\(authHeader, `Bearer \$\{serviceKey\}`\)/);
    assert.match(op, /started: true \}, 202\)/);
  });
});
