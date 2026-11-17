import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildPlan, executePlan, fetchExisting } from './posthog-apply.mjs';
import { tileEvents, indexFlows, resolvedTiles, bridgeActions, CROSS_KINDS, SIMPLE_KINDS, MAX_DASHBOARDS } from './lib/posthog-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dash = JSON.parse(readFileSync(path.join(ROOT, 'posthog', 'dashboards.json'), 'utf8'));
const { EVENTS, EVENT_AREAS, LEGACY_EVENT_NAMES } = await import(pathToFileURL(path.join(ROOT, 'src/app/core/analytics/events.ts')).href);

// Events PostHog or the servers send that are not in the web catalogue.
const BUILT_IN_AND_SERVER = new Set([
  '$pageview', '$pageleave', '$exception', '$web_vitals', '$ai_generation',
  'server:cron_run_finish', 'server:api',
  'desktop:usage_metric', 'desktop:extract_abort', 'desktop:job_diagnostics_report',
]);

const flowsFile = path.join(ROOT, 'posthog', 'flows.json');
const flows = existsSync(flowsFile) ? JSON.parse(readFileSync(flowsFile, 'utf8')) : null;
const spec = { ...dash, flows, actions: null, legacy: LEGACY_EVENT_NAMES };

test('at most three dashboards, named as agreed', () => {
  assert.ok(dash.dashboards.length <= MAX_DASHBOARDS);
  assert.deepEqual(dash.dashboards.map((d) => d.name), ['Läuft es?', 'Wird es genutzt?', 'Was kostet es?']);
});

test('names are unique across dashboards, insights, actions and flags', () => {
  const plan = buildPlan(spec);
  for (const kind of ['dashboard', 'insight', 'action', 'feature_flag']) {
    const names = plan.filter((s) => s.kind === kind).map((s) => s.name);
    assert.equal(new Set(names).size, names.length, `duplicate ${kind} name`);
  }
});

test('every event a tile uses is in the catalogue or the server / built-in list', () => {
  const known = new Set([...Object.keys(EVENTS), ...BUILT_IN_AND_SERVER]);
  const flowMap = indexFlows(flows);
  for (const d of dash.dashboards) {
    for (const tile of d.tiles) {
      for (const e of tileEvents(tile, flowMap)) assert.ok(known.has(e), `${d.name} / ${tile.name}: unknown event ${e}`);
    }
  }
});

test('about 30 % simple reports, about 70 % cross-flow reports', () => {
  const all = dash.dashboards.flatMap((d) => d.tiles);
  for (const t of all) assert.ok([...SIMPLE_KINDS, ...CROSS_KINDS].includes(t.type), `${t.name}: type ${t.type}`);
  const cross = all.filter((t) => CROSS_KINDS.includes(t.type)).length / all.length;
  assert.ok(cross >= 0.6 && cross <= 0.8, `cross-flow share ${(cross * 100).toFixed(0)} %`);
});

test('every catalogue area is reachable: an area breakdown table or a tile on one of its events', () => {
  const tiles = dash.dashboards.flatMap((d) => d.tiles);
  const breakdown = tiles.some((t) => t.type === 'hogql' && /splitByString\(':', event\)\[1\]/.test(t.hogql));
  assert.ok(breakdown, 'no area breakdown table');
  const catalogueAreas = new Set(Object.values(EVENTS).map((e) => e.area));
  for (const a of catalogueAreas) assert.ok(EVENT_AREAS.includes(a));
});

test('the eight flows are referenced by id, in the agreed order', () => {
  const ids = dash.dashboards.flatMap((d) => d.tiles).filter((t) => t.flow).map((t) => t.flow);
  assert.deepEqual(ids, ['onboard', 'codex', 'error', 'hangar', 'feedback', 'desktop', 'verse', 'wish']);
});

test('a missing flows file only skips the flow tiles', () => {
  const without = resolvedTiles({ ...spec, flows: null });
  const withFlows = resolvedTiles({
    ...spec,
    flows: { flows: ['onboard', 'codex', 'error', 'hangar', 'feedback', 'desktop', 'verse', 'wish'].map((id) => ({ id, steps: ['$pageview', '$exception'] })) },
  });
  assert.equal(withFlows.length - without.length, 8);
});

test('the plan is idempotent by name: known names PATCH, new ones POST', () => {
  const fresh = buildPlan(spec);
  assert.ok(fresh.every((s) => s.method === 'POST'));
  const again = buildPlan(spec, {
    dashboards: { 'Läuft es?': 11 },
    feature_flags: { 'telemetry-saver': 5 },
    insights: { 'Lebenszyklus der Nutzer': 99 },
  });
  const find = (kind, name) => again.find((s) => s.kind === kind && s.name === name);
  assert.equal(find('dashboard', 'Läuft es?').method, 'PATCH');
  assert.equal(find('dashboard', 'Läuft es?').path, '/api/environments/@current/dashboards/11/');
  assert.equal(find('feature_flag', 'telemetry-saver').path, '/api/projects/@current/feature_flags/5/');
  assert.equal(find('insight', 'Lebenszyklus der Nutzer').method, 'PATCH');
  assert.equal(find('dashboard', 'Wird es genutzt?').method, 'POST');
});

test('telemetry-saver is created inactive, insights carry a query and a dashboard reference', () => {
  const plan = buildPlan(spec);
  assert.equal(plan.find((s) => s.kind === 'feature_flag').body.active, false);
  for (const s of plan.filter((x) => x.kind === 'insight')) {
    assert.ok(s.body.query?.kind, s.name);
    assert.match(String(s.body.dashboards[0]), /^\$ref:dashboard:/);
  }
});

test('legacy bridge: one action per new name matching old and new', () => {
  const bridges = bridgeActions(LEGACY_EVENT_NAMES);
  assert.equal(bridges.length, new Set(Object.values(LEGACY_EVENT_NAMES)).size);
  const signIn = bridges.find((b) => b.name === 'Bridge: auth:user_sign_in');
  assert.deepEqual(signIn.events, ['auth:user_sign_in', 'user_signed_in', 'user_signed_in_with_google', 'user_signed_in_with_discord']);
  const plan = buildPlan(spec);
  assert.equal(plan.filter((s) => s.kind === 'action').length, bridges.length);
});

test('executePlan resolves dashboard placeholders from earlier responses', async () => {
  const sent = [];
  let next = 100;
  const send = async (req) => {
    sent.push(req);
    return { id: next++ };
  };
  const plan = buildPlan({ dashboards: [{ name: 'D', tiles: [{ name: 'T', type: 'trends', series: ['$pageview'] }] }] });
  await executePlan(plan, send);
  const insight = sent.find((r) => r.path.endsWith('/insights/'));
  assert.deepEqual(insight.body.dashboards, [100]);
});

test('fetchExisting indexes by name and follows pagination', async () => {
  const pages = {
    '/api/environments/@current/dashboards/?limit=500': { results: [{ id: 1, name: 'A' }], next: 'https://eu.posthog.com/api/environments/@current/dashboards/?limit=500&offset=500' },
    '/api/environments/@current/dashboards/?limit=500&offset=500': { results: [{ id: 2, name: 'B' }], next: null },
  };
  const send = async ({ path: p }) => pages[p] ?? { results: [], next: null };
  const ex = await fetchExisting(send);
  assert.deepEqual(ex.dashboards, { A: 1, B: 2 });
});
