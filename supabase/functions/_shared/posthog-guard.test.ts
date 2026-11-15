// node --test supabase/functions/_shared/posthog-guard.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItemBody, canAutoCloseServiceItem, checkSignalSecret, constantTimeEqual, decideBoardAction, funnelSignal, intervalToSec,
  httpFailureNote, lcpSignal, nextHealth, parseBilling, quotaRef, quotaStatus, saverTarget, serviceLevel, serviceTransition, ROUTINE_LINE,
} from './posthog-guard.ts';
import { aiCard, attentionCount, errorsCard, queryReachable, feedbackPrefill, quotaCard, servicesCard, sortCards, type Card } from '../telemetry-overview/_cards.ts';

const NOW = new Date('2026-11-15T12:00:00Z');

test('constant-time compare and secret check', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(checkSignalSecret('s3', 's3'), 'ok');
  assert.equal(checkSignalSecret('x', 's3'), 'unauthorized');
  assert.equal(checkSignalSecret(null, 's3'), 'unauthorized');
  assert.equal(checkSignalSecret('s3', undefined), 'no_key');
});

test('board decision: dedupe, cap, overflow, once per period', () => {
  const base = { existingOpen: false, existingAnyStatus: false, oncePerPeriod: false, newToday: 0 };
  assert.equal(decideBoardAction(base), 'create');
  assert.equal(decideBoardAction({ ...base, newToday: 2 }), 'create');
  assert.equal(decideBoardAction({ ...base, newToday: 3 }), 'overflow');
  assert.equal(decideBoardAction({ ...base, existingOpen: true, newToday: 9 }), 'append');
  assert.equal(decideBoardAction({ ...base, oncePerPeriod: true, existingAnyStatus: true }), 'skip');
  assert.equal(decideBoardAction({ ...base, oncePerPeriod: false, existingAnyStatus: true }), 'create');
});

test('item body carries problem, numbers, link and the routine line', () => {
  const b = buildItemBody({ title: 'T', problem: 'P', numbers: ['a', 'b'], link: 'https://eu.posthog.com/x' });
  assert.match(b, /^T\n\nP\n\n- a\n- b\n\nPostHog: https:\/\/eu\.posthog\.com\/x\n\n/);
  assert.ok(b.endsWith(ROUTINE_LINE));
  assert.ok(!buildItemBody({ title: 'T', problem: 'P' }).includes('PostHog:'));
});

test('lcp signal fires at +25 %', () => {
  const rows = [1, 2, 3, 4].map((d) => ({ day: `2026-11-0${d}`, value: 2000 }));
  assert.equal(lcpSignal([...rows, { day: '2026-11-15', value: 2400 }], '2026-11-15'), null);
  const s = lcpSignal([...rows, { day: '2026-11-15', value: 2500 }], '2026-11-15');
  assert.equal(Math.round(s!.deltaPct), 25);
  assert.equal(lcpSignal([{ day: '2026-11-15', value: 9999 }], '2026-11-15'), null);
});

test('funnel signal fires on a drop above 10 points', () => {
  const rows = [1, 2, 3, 4].map((d) => ({ day: `2026-11-0${d}`, started: 100, done: 80 }));
  assert.equal(funnelSignal([...rows, { day: 'T', started: 100, done: 71 }], 'T'), null);
  const s = funnelSignal([...rows, { day: 'T', started: 100, done: 60 }], 'T');
  assert.equal(Math.round(s!.dropPt), 20);
  assert.equal(funnelSignal([...rows, { day: 'T', started: 3, done: 0 }], 'T'), null);
});

test('quota status: levels, forecast, proposal, saver', () => {
  const p = { periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z', now: NOW };
  const low = quotaStatus({ ...p, usage: 100, limit: 1000 }); // 10 % at day 14.5 of 30
  assert.equal(low.level, 'ok');
  assert.equal(low.proposal, false);
  const fc = quotaStatus({ ...p, usage: 400, limit: 1000 }); // 40 % → forecast ~83 %
  assert.equal(fc.level, 'ok');
  const over = quotaStatus({ ...p, usage: 500, limit: 1000 }); // forecast ~103 %
  assert.equal(over.level, 'warn');
  assert.equal(over.proposal, true);
  assert.equal(over.saver, true);
  assert.equal(quotaStatus({ ...p, usage: 850, limit: 1000 }).level, 'warn');
  assert.equal(quotaStatus({ ...p, usage: 1000, limit: 1000 }).level, 'error');
  assert.equal(quotaStatus({ ...p, usage: 5, limit: 0 }).level, 'unknown');
  // first day of the period: no extrapolation
  assert.equal(quotaStatus({ ...p, now: new Date('2026-11-01T06:00:00Z'), usage: 50, limit: 1000 }).forecastPct, 5);
  assert.equal(quotaRef('replay', '2026-11-01T00:00:00Z'), 'quota:replay:2026-11-01');
});

test('saver target has hysteresis and resets in a new period', () => {
  assert.equal(saverTarget([40, 96], false), true);
  assert.equal(saverTarget([96], true), null);
  assert.equal(saverTarget([90], true), null);
  assert.equal(saverTarget([10, 20], true), false);
  assert.equal(saverTarget([10], false), null);
  assert.equal(saverTarget([], true), false);
});

test('billing parser maps products and tolerates junk', () => {
  const r = parseBilling({
    billing_period: { current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z' },
    products: [
      { type: 'product_analytics', current_usage: 500000, free_allocation: 1000000 },
      { type: 'session_replay', current_usage: 10, usage_limit: 5000 },
      { type: 'data_warehouse', current_usage: 1, free_allocation: 5 },
      { type: 'error_tracking', current_usage: 1 },
    ],
  });
  assert.deepEqual(r!.rows.map((x) => x.product), ['events', 'replay']);
  assert.equal(r!.rows[1].limit, 5000);
  assert.equal(parseBilling({}), null);
});

test('billing parser reads the live free-plan shape (llm_analytics, usage_limit = free allocation)', () => {
  // Shape as GET /api/billing/ returned it for project 226518 on 2026-11-15.
  const r = parseBilling({
    billing_period: { current_period_start: '2026-11-14T15:20:36.128Z', current_period_end: '2026-12-14T15:20:36.128Z', interval: 'month' },
    products: [
      { type: 'product_analytics', current_usage: 81, free_allocation: 1000000, usage_limit: 1000000 },
      { type: 'session_replay', current_usage: 0, free_allocation: 5000, usage_limit: 5000 },
      { type: 'feature_flags', current_usage: 0, free_allocation: 1000000, usage_limit: 1000000 },
      { type: 'error_tracking', current_usage: 2, free_allocation: 100000, usage_limit: 100000 },
      { type: 'llm_analytics', current_usage: 0, free_allocation: 100000, usage_limit: 100000 },
      { type: 'logs_retention_custom', current_usage: 0, free_allocation: 0, usage_limit: null },
    ],
  });
  assert.deepEqual(r!.rows.map((x) => x.product).sort(), ['events', 'exceptions', 'flags', 'llm', 'replay']);
});

test('service level per d-thresh', () => {
  const ok = { consecutiveFailures: 0, errorRate: 0, lastOkAt: NOW.toISOString(), lastCheckAt: NOW.toISOString(), expectedEverySec: 3600, now: NOW };
  assert.equal(serviceLevel(ok), 'ok');
  assert.equal(serviceLevel({ ...ok, errorRate: 0.1 }), 'warn');
  assert.equal(serviceLevel({ ...ok, errorRate: 0.09 }), 'ok');
  assert.equal(serviceLevel({ ...ok, lastCheckAt: '2026-11-15T09:00:00Z' }), 'warn');
  assert.equal(serviceLevel({ ...ok, consecutiveFailures: 2, lastOkAt: '2026-11-15T09:00:00Z' }), 'warn');
  assert.equal(serviceLevel({ ...ok, consecutiveFailures: 3 }), 'error');
  assert.equal(serviceLevel({ ...ok, keyMissing: true }), 'error');
  assert.equal(serviceLevel({ ...ok, lastCheckAt: null }), 'unknown');
});

test('nextHealth counts failures, goes red on the third, recovers on success', () => {
  let row = nextHealth(null, { ok: true }, 'r2', 3600, NOW);
  assert.equal(row.level, 'ok');
  row = nextHealth(row, { ok: false }, 'r2', 3600, NOW);
  assert.equal(row.level, 'ok');
  row = nextHealth(row, { ok: false }, 'r2', 3600, NOW);
  row = nextHealth(row, { ok: false }, 'r2', 3600, NOW);
  assert.equal(row.level, 'error');
  assert.equal(serviceTransition('ok', row.level), 'degraded');
  const back = nextHealth(row, { ok: true }, 'r2', 3600, NOW);
  assert.equal(back.consecutive_failures, 0);
  assert.equal(serviceTransition(row.level, back.level), 'recovered');
  assert.equal(serviceTransition('error', 'error'), 'none');
  assert.equal(nextHealth(null, { ok: false, keyMissing: true }, 'xai', 3600, NOW).level, 'error');
  assert.equal(nextHealth(null, { ok: false, skipped: true }, 'readme', 3600, NOW).level, 'unknown');
  assert.equal(nextHealth(null, { ok: true, passiveErrorRate: 0.3 }, 'claude', 3600, NOW).level, 'warn');
});

test('auto close only for untouched items', () => {
  assert.equal(canAutoCloseServiceItem({ status: 'open', humanMessages: 0 }), true);
  assert.equal(canAutoCloseServiceItem({ status: 'needs_input', humanMessages: 0 }), true);
  assert.equal(canAutoCloseServiceItem({ status: 'open', humanMessages: 1 }), false);
  assert.equal(canAutoCloseServiceItem({ status: 'in_progress', humanMessages: 0 }), false);
});

test('interval parsing', () => {
  assert.equal(intervalToSec('01:00:00'), 3600);
  assert.equal(intervalToSec('1 day'), 86400);
  assert.equal(intervalToSec('3600 seconds'), 3600);
  assert.equal(intervalToSec(null, 7), 7);
});

const card = (id: Card['id'], level: Card['level']): Card => ({ id, level, kpi: { value: 0, display: '0', unitKey: 'x' }, top: [], links: [] });

test('cards sort error → warn → ok → unknown, stable; attention counts warn+error', () => {
  const sorted = sortCards([card('usage', 'ok'), card('ai', 'unknown'), card('quota', 'warn'), card('errors', 'error'), card('services', 'warn'), card('desktop', 'ok')]);
  assert.deepEqual(sorted.map((c) => c.id), ['errors', 'quota', 'services', 'usage', 'desktop', 'ai']);
  assert.equal(attentionCount(sorted), 3);
});

test('quota card: warn carries both CTAs, ok does not, unreachable is unknown', () => {
  const q = (product: 'events' | 'replay', pct: number, forecastPct: number) => ({ product, usage: pct, limit: 100, pct, forecastPct });
  const warn = quotaCard([q('events', 20, 30), q('replay', 85, 120)], true, NOW);
  assert.equal(warn.level, 'warn');
  assert.ok(warn.feedbackCta && warn.upgradeUrl);
  assert.equal(warn.top[0].label, 'Session-Replay');
  assert.ok(warn.top[0].feedback);
  assert.equal(warn.top[1].feedback, undefined);
  const calm = quotaCard([q('events', 20, 30)], true, NOW);
  assert.equal(calm.level, 'ok');
  assert.equal(calm.feedbackCta, undefined);
  const off = quotaCard([], false, NOW);
  assert.equal(off.level, 'unknown');
});

test('errors card shapes top 3 with prefilled feedback and counts boardWaiting', () => {
  const issues = [1, 2, 3, 4].map((n) => ({ id: `i${n}`, name: `E${n}`, count: 5 - n, source: 'web' as const }));
  const c = errorsCard(issues, true, 2, 'https://eu.posthog.com/project/7');
  assert.equal(c.top.length, 3);
  assert.equal(c.level, 'error');
  assert.equal(c.boardWaiting, 2);
  assert.ok(c.top[0].feedback!.body.includes('https://eu.posthog.com/project/7/error_tracking/i1'));
  assert.equal(errorsCard([], true, 0, 'p').level, 'ok');
  assert.equal(errorsCard([], false, 0, 'p').level, 'unknown');
  assert.match(feedbackPrefill('T', 'P', 'L').body, /PostHog: L/);
});

test('services card lists the worst first; ai card forecasts linearly', () => {
  const row = (service: string, level: 'ok' | 'warn' | 'error') => ({ service, level, error_rate: 0, last_ok_at: null, last_check_at: null, expected_every_sec: 3600, consecutive_failures: 0, note: null });
  const s = servicesCard([row('a', 'ok'), row('b', 'warn'), row('c', 'error')], 'p');
  assert.equal(s.level, 'error');
  assert.deepEqual(s.top.map((t) => t.label), ['c', 'b']);
  assert.equal(servicesCard([], 'p').level, 'unknown');
  const a = aiCard({ monthCostUsd: 3, day: 10, daysInMonth: 30, errorRate24h: 0, top: [{ fn: 'f', cost: 2 }], reachable: true }, 'p');
  assert.equal(a.forecast!.display, '$9.00');
});

test('errors card is unknown, not ok, when only the errors query failed (codex review)', () => {
  // PostHog answered (billing / usage worked) but the errors HogQL query returned null.
  const reach = queryReachable(true, null);
  assert.equal(reach, false);
  assert.equal(errorsCard([], reach, 0, 'p').level, 'unknown');
  assert.equal(errorsCard([], queryReachable(true, []), 0, 'p').level, 'ok');
  assert.equal(queryReachable(false, []), false);
});

test('httpFailureNote appends the provider reason, masks keys, ignores HTML', () => {
  assert.equal(
    httpFailureNote(403, JSON.stringify({ code: 'permission-denied', error: 'Your team has no credits. Purchase credits at console.x.ai.' })),
    'HTTP 403 (permission-denied: Your team has no credits. Purchase credits at console.x.ai.)',
  );
  assert.equal(
    httpFailureNote(401, JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })),
    'HTTP 401 (authentication_error: invalid x-api-key)',
  );
  assert.equal(httpFailureNote(400, JSON.stringify({ error: 'bad key xai-abcdef1234567890' })), 'HTTP 400 (bad key ***)');
  assert.equal(httpFailureNote(502, '<html>Bad Gateway</html>'), 'HTTP 502');
  assert.equal(httpFailureNote(500, ''), 'HTTP 500');
  assert.equal(httpFailureNote(500, '{}'), 'HTTP 500');
  assert.ok(httpFailureNote(403, JSON.stringify({ error: 'x'.repeat(500) })).length <= 200);
});
