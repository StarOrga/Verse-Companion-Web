// node --test supabase/functions/ingest-telemetry/_forward.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, mapEvent, isJobDiagnostics, logTextOf, type WireContext } from './_forward.ts';
import { capLog, diagKey, diagKeyDate, expiresAt, isExpired, MAX_LOG_BYTES } from '../_shared/diag-key.ts';

const ctx = (over: Partial<WireContext> = {}): WireContext => ({
  type: 'crash', appVersion: '1.2.3', buildId: 'b1', channel: 'beta', product: 'starscape',
  os: 'win32', osRelease: '10', arch: 'x64', role: 'host', installHash: 'inst-hash', sessionHash: 'sess-hash',
  now: '2026-11-15T10:00:00.000Z', ...over,
});

test('crash becomes a person-less $exception with desktop source and the install hash', () => {
  const e = mapEvent(ctx(), { errorType: 'uncaught', name: 'TypeError', message: 'bad for a@b.example', stack: 'at x (file.js:1)' });
  assert.equal(e.event, '$exception');
  assert.equal(e.distinct_id, 'inst-hash');
  assert.equal(e.timestamp, '2026-11-15T10:00:00.000Z');
  assert.equal(e.properties.$process_person_profile, false);
  assert.equal(e.properties.source, 'desktop');
  assert.equal(e.properties.product, 'starscape');
  assert.equal(e.properties.channel, 'beta');
  assert.equal(e.properties.os, 'win32');
  assert.equal(e.properties.app_version, '1.2.3');
  const list = e.properties.$exception_list as { type: string; value: string; stacktrace: { raw: string } }[];
  assert.equal(list[0].type, 'TypeError');
  assert.equal(list[0].value, 'bad for ***');
  assert.equal(list[0].stacktrace.raw, 'at x (file.js:1)');
});

test('distinct id falls back to session hash, then a per-product bucket', () => {
  assert.equal(mapEvent(ctx({ installHash: null }), {}).distinct_id, 'sess-hash');
  assert.equal(mapEvent(ctx({ installHash: null, sessionHash: null }), {}).distinct_id, 'desktop:starscape');
  assert.equal(mapEvent(ctx({ installHash: null, sessionHash: null, product: null }), {}).distinct_id, 'desktop:unknown');
});

test('product defaults to scc-app for legacy clients', () => {
  assert.equal(mapEvent(ctx({ product: null }), {}).properties.product, 'scc-app');
});

test('usage keeps metric + value', () => {
  const e = mapEvent(ctx({ type: 'usage' }), { metric: 'extract_ms', value: 1234, detail: { a: 1 } });
  assert.equal(e.event, 'desktop:usage_metric');
  assert.equal(e.properties.metric, 'extract_ms');
  assert.equal(e.properties.metric_value, 1234);
  assert.deepEqual(e.properties.detail, { a: 1 });
});

test('extract aborts are not crashes', () => {
  const e = mapEvent(ctx(), { errorType: 'extract-aborted', message: 'user cancelled', extra: { reason: 'cancel' } });
  assert.equal(e.event, 'desktop:extract_abort');
  assert.deepEqual(e.properties.detail, { reason: 'cancel' });
});

test('job diagnostics carry log_url and log_bytes, never the transcript', () => {
  const ev = { errorType: 'job-diagnostics', message: 'extract finished (ok) with 2 warning(s)', stack: '[warn] 00:01 secret transcript', extra: { kind: 'extract' } };
  assert.ok(isJobDiagnostics('crash', ev));
  assert.ok(!isJobDiagnostics('usage', ev));
  assert.equal(logTextOf(ev), '[warn] 00:01 secret transcript');
  const e = mapEvent(ctx(), ev, { url: 'r2://b/diag/2026-11-15/' + 'a'.repeat(32) + '.log', bytes: 31 });
  assert.equal(e.event, 'desktop:job_diagnostics_report');
  assert.equal(e.properties.log_bytes, 31);
  assert.ok(String(e.properties.log_url).startsWith('r2://'));
  assert.ok(!JSON.stringify(e).includes('transcript'));
  const noLog = mapEvent(ctx(), ev, null);
  assert.equal(noLog.properties.log_url, undefined);
});

test('oversized detail is replaced by the marker like before', () => {
  const e = mapEvent(ctx({ type: 'usage' }), { metric: 'm', detail: { s: 'x'.repeat(5000) } });
  assert.deepEqual(e.properties.detail, { _truncated: true, bytes: 5008 });
});

test('rate limiter counts per key inside the window and recovers', () => {
  const r = new RateLimiter(10, 1000);
  assert.ok(r.take('ip', 6, 0));
  assert.ok(r.take('ip', 4, 10));
  assert.ok(!r.take('ip', 1, 20));
  assert.ok(r.take('other', 10, 20));
  assert.ok(r.take('ip', 5, 1500));
});

test('diag keys: dated, parseable, 30-day expiry', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const key = diagKey(now, 'ab'.repeat(8));
  assert.equal(key, 'diag/2026-11-15/abababababababab.log');
  assert.equal(diagKeyDate(key)?.toISOString(), '2026-11-15T00:00:00.000Z');
  assert.ok(!isExpired(key, new Date('2026-12-14T00:00:00Z')));
  assert.ok(isExpired(key, new Date('2026-12-16T00:00:00Z')));
  assert.ok(!isExpired('ship-skins/x/y.glb', new Date('2030-01-01T00:00:00Z')));
  assert.equal(expiresAt(now), '2026-12-15T12:00:00.000Z');
  assert.throws(() => diagKey(now, '../etc'));
});

test('log cap cuts at the byte limit and reports the original size', () => {
  const small = capLog('hello');
  assert.deepEqual(small, { text: 'hello', bytes: 5, truncated: false });
  const big = capLog('ä'.repeat(MAX_LOG_BYTES));
  assert.ok(big.truncated);
  assert.equal(big.bytes, MAX_LOG_BYTES * 2);
  assert.ok(new TextEncoder().encode(big.text).length <= MAX_LOG_BYTES + 12);
});
