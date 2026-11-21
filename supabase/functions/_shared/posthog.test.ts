// node --test supabase/functions/_shared/posthog.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRON_RUN_EVENT, INGEST_TIMEOUT_EVENT, buildAiGeneration, buildCapture, buildCronRun, buildException, buildHttpException, fingerprintPart, readErrorCode, redactText, reportAs, serverDistinctId, withPosthog } from './posthog.ts';
import { PRICES } from '../translate-orchestrator/_cost.ts';
import { LIST_PRICES, costUsd, priceFor } from './ai-pricing.ts';

test('server distinct id is per function', () => {
  assert.equal(serverDistinctId('api'), 'server:api');
});

test('every server event is person-less and marked as server', () => {
  const e = buildCapture('cron:run_finished', { ok: true, $process_person_profile: true }, { fn: 'sc-events-sync' });
  assert.equal(e.distinct_id, 'server:sc-events-sync');
  assert.equal(e.properties.$process_person_profile, false);
  assert.equal(e.properties.source, 'server');
  assert.equal(e.properties.function, 'sc-events-sync');
});

test('redaction strips queries, bearer, jwt, mail and keys', () => {
  const t = 'fail https://x.test/a?apikey=SECRET&b=1 Bearer abc.def eyJhbGciOi.eyJzdWIi.sig mail a.b@example.com sk-ant-1234567890abcdefgh';
  const r = redactText(t);
  assert.ok(!r.includes('SECRET') && !r.includes('abc.def') && !r.includes('eyJhbGciOi'));
  assert.ok(!r.includes('example.com') && !r.includes('sk-ant-1234567890'));
  assert.equal(redactText('x'.repeat(900)).length, 500);
});

test('exception carries $exception_list, redacted, no profile', () => {
  const err = new Error('boom for me@example.com');
  const e = buildException('api', err, { http_status: 500, handled: false });
  assert.equal(e.event, '$exception');
  const list = e.properties.$exception_list as { type: string; value: string; mechanism: { handled: boolean } }[];
  assert.equal(list[0].type, 'Error');
  assert.equal(list[0].value, 'boom for ***');
  assert.equal(list[0].mechanism.handled, false);
  assert.equal(e.properties.http_status, 500);
  assert.equal(e.properties.$process_person_profile, false);
});

test('non-Error throwables become exceptions too', () => {
  const e = buildException('api', 'plain string');
  assert.equal((e.properties.$exception_list as { value: string }[])[0].value, 'plain string');
});

test('ai generation holds metadata only, never text', () => {
  const e = buildAiGeneration({
    fn: 'patch-teaser', model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 5, costUsd: 0.001,
    latencyMs: 1500, ok: false, status: 529, error: 'HTTP 529', traceId: 't1',
  });
  assert.equal(e.event, '$ai_generation');
  assert.equal(e.properties.$ai_latency, 1.5);
  assert.equal(e.properties.$ai_is_error, true);
  assert.equal(e.properties.$ai_total_cost_usd, 0.001);
  assert.equal(e.properties.$ai_provider, 'anthropic');
  for (const k of Object.keys(e.properties)) assert.ok(!/input$|output$|prompt|content/.test(k) || k.endsWith('tokens'), k);
});

test('withPosthog passes responses through and rethrows', async () => {
  const ok = withPosthog('t', () => Promise.resolve(new Response('x', { status: 200 })));
  assert.equal((await ok(new Request('http://x.test'))).status, 200);
  // fetch is stubbed so no network is touched
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch;
  try {
    const bad = withPosthog('t', () => Promise.reject(new Error('x')));
    await assert.rejects(() => bad(new Request('http://x.test')), /x/);
    const five = withPosthog('t', () => Promise.resolve(new Response('no', { status: 503 })));
    assert.equal((await five(new Request('http://x.test'))).status, 503);
    await new Promise((r) => setTimeout(r, 10)); // the 5xx report goes out in the background
  } finally {
    globalThis.fetch = real;
  }
});

test('exception fingerprint defaults to function and type, a caller may set its own', () => {
  assert.equal(buildException('api', new TypeError('x')).properties.$exception_fingerprint, 'server:api:TypeError');
  assert.equal(buildException('api', 'x', { fingerprint: 'custom:1' }).properties.$exception_fingerprint, 'custom:1');
  assert.ok(!('fingerprint' in buildException('api', 'x', { fingerprint: 'custom:1' }).properties));
  assert.equal(fingerprintPart('a b/c:d'), 'a_b_c_d');
  assert.equal(fingerprintPart(''), 'none');
  assert.equal(fingerprintPart('x'.repeat(100)).length, 64);
});

test('readErrorCode takes only the string error field, redacted and capped', async () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 500, headers: { 'content-type': 'application/json' } });
  assert.equal(await readErrorCode(json({ error: 'sign_failed', detail: 'secret stuff' })), 'sign_failed');
  assert.equal(await readErrorCode(json({ error: 42 })), null);
  assert.equal(await readErrorCode(json([1, 2])), null);
  assert.equal(await readErrorCode(json({ error: 'mail a@b.example now' })), 'mail *** now');
  assert.equal((await readErrorCode(json({ error: 'y'.repeat(200) })))?.length, 64);
  assert.equal(await readErrorCode(new Response('{broken', { status: 500, headers: { 'content-type': 'application/json' } })), null);
  assert.equal(await readErrorCode(new Response('plain', { status: 500 })), null);
});

test('5xx becomes an HttpError fingerprinted by function, status and code', () => {
  const e = buildHttpException('ingest-skins', 500, 'commit_failed', 'POST');
  const list = e.properties.$exception_list as { type: string; value: string; stacktrace?: unknown }[];
  assert.equal(list[0].type, 'HttpError');
  assert.equal(list[0].value, 'ingest-skins: HTTP 500 commit_failed');
  assert.equal(list[0].stacktrace, undefined);
  assert.equal(e.properties.$exception_fingerprint, 'server:ingest-skins:500:commit_failed');
  assert.equal(e.properties.error_code, 'commit_failed');
  assert.equal(e.properties.http_status, 500);
  const none = buildHttpException('uex-proxy', 504, null, 'GET');
  assert.equal((none.properties.$exception_list as { value: string }[])[0].value, 'uex-proxy: HTTP 504');
  assert.equal(none.properties.$exception_fingerprint, 'server:uex-proxy:504:none');
});

test('withPosthog sends the 5xx code without touching the response body', async () => {
  const real = globalThis.fetch;
  const sent: { batch: { properties: Record<string, unknown> }[] }[] = [];
  let done!: () => void;
  const arrived = new Promise<void>((r) => { done = r; });
  globalThis.fetch = ((_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    done();
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  try {
    const h = withPosthog('ingest-skins', () => new Response(JSON.stringify({ error: 'prune_failed' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    }));
    const res = await h(new Request('http://x.test', { method: 'POST' }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'prune_failed' });
    await arrived;
    assert.equal(sent[0].batch[0].properties.$exception_fingerprint, 'server:ingest-skins:503:prune_failed');
  } finally {
    globalThis.fetch = real;
  }
});

test('list prices are exactly twice the orchestrator batch prices', () => {
  for (const [m, p] of Object.entries(PRICES)) {
    assert.equal(LIST_PRICES[m].in, p.in * 2, m);
    assert.equal(LIST_PRICES[m].out, p.out * 2, m);
  }
});

test('cost: tokens, cache, batch discount, dated model ids, unknown model', () => {
  assert.equal(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 24);
  assert.equal(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }, { batch: true }), 12);
  assert.equal(costUsd('claude-haiku-4-5', { input_tokens: 2000, output_tokens: 200 }), 0.003);
  assert.equal(priceFor('claude-haiku-4-5-20251001').in, 1);
  assert.equal(priceFor('mystery').out, 40);
  assert.equal(costUsd('claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000 }), 0.4);
});

test('cron run outcome: 429 throttle is healthy, 5xx and a throw are failures', () => {
  const ok = buildCronRun('sc-events-sync', 429, 12.4);
  assert.equal(ok.event, CRON_RUN_EVENT);
  assert.equal(ok.properties.ok, true);
  assert.equal(ok.properties.duration_ms, 12);
  assert.equal(buildCronRun('x', 503, 1).properties.ok, false);
  const thrown = buildCronRun('x', null, 1, new Error('boom'));
  assert.equal(thrown.properties.ok, false);
  assert.equal(thrown.properties.error, 'boom');
});

test('a 5xx marked with reportAs goes out as its own event, not as $exception, and the response stays untouched', async () => {
  const real = globalThis.fetch;
  const sent: { batch: { event: string; properties: Record<string, unknown> }[] }[] = [];
  let done!: () => void;
  const arrived = new Promise<void>((r) => { done = r; });
  globalThis.fetch = ((_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    done();
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  try {
    const h = withPosthog('ingest-catalog', () => reportAs(new Response(JSON.stringify({ error: 'ingest_timeout' }), {
      status: 503, headers: { 'content-type': 'application/json', 'retry-after': '2' },
    }), INGEST_TIMEOUT_EVENT, { op: 'upsert', table: 'codex_items_rows', rows: 500 }));
    const res = await h(new Request('http://x.test', { method: 'POST' }));
    assert.equal(res.status, 503);
    assert.deepEqual([...res.headers.keys()].sort(), ['content-type', 'retry-after']);
    assert.deepEqual(await res.json(), { error: 'ingest_timeout' });
    await arrived;
    assert.equal(sent.length, 1);
    const [e] = sent[0].batch;
    assert.equal(sent[0].batch.length, 1);
    assert.equal(e.event, 'server:ingest_timeout');
    assert.equal(e.properties.op, 'upsert');
    assert.equal(e.properties.table, 'codex_items_rows');
    assert.equal(e.properties.rows, 500);
    assert.equal(e.properties.http_status, 503);
    assert.equal(e.properties.function, 'ingest-catalog');
    assert.equal(e.properties.$process_person_profile, false);
    assert.ok(!('$exception_list' in e.properties));
  } finally {
    globalThis.fetch = real;
  }
});
