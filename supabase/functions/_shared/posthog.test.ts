// node --test supabase/functions/_shared/posthog.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAiGeneration, buildCapture, buildException, redactText, serverDistinctId, withPosthog } from './posthog.ts';
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
