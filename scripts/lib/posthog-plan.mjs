// ============================================================
// posthog-plan.mjs — the PostHog-as-code planner (pure: no imports, no I/O)
//
// Turns the spec (posthog/dashboards.json + flows + actions + the legacy event
// names) into an ordered list of REST requests. Pure on purpose: the same file
// runs under Node (scripts/posthog-apply.mjs, personal API key) and can be
// pasted into a logged-in PostHog browser tab (session cookie + CSRF header),
// see docs/analytics/posthog-setup.md.
//
//   const existing = await fetchExisting(send);        // GETs only
//   const plan = buildPlan(spec, existing);            // [{method, path, body, kind, name, ref}]
//   await executePlan(plan, send);                     // POST / PATCH, resolves "$ref:" placeholders
//
// `send({ method, path, body? }) => Promise<json>` is the only transport.
// ============================================================

export const ENV_BASE = '/api/environments/@current';
export const PROJECT_BASE = '/api/projects/@current';
export const MAX_DASHBOARDS = 3;

/** Tile kinds that are plain single-event/table reports; everything else follows users across steps/time/flows. */
export const SIMPLE_KINDS = ['trends', 'hogql'];
export const CROSS_KINDS = ['funnel', 'retention', 'paths', 'lifecycle', 'stickiness'];

const eventNode = (s) => {
  const e = typeof s === 'string' ? { event: s } : s;
  const node = { kind: 'EventsNode', event: e.event, name: e.name ?? e.event };
  if (e.math) node.math = e.math;
  if (e.mathProperty) node.math_property = e.mathProperty;
  if (e.filter?.length) {
    node.properties = e.filter.map((f) => ({ key: f.key, value: f.value, operator: f.operator ?? 'exact', type: 'event' }));
  }
  return node;
};

const dateRange = (range, fallback) => ({ date_from: range ?? fallback });

/**
 * Tile descriptor → PostHog `query` object (InsightVizNode / DataVisualizationNode).
 * `flows` maps flow id → { steps: [event | {event}] } (from posthog/flows.json); a funnel tile
 * `{ flow: 'id' }` is built from it, an unknown flow returns null (tile skipped).
 */
export function buildQuery(tile, flows = {}) {
  const viz = (source) => ({ kind: 'InsightVizNode', source });
  switch (tile.type) {
    case 'trends': {
      const source = {
        kind: 'TrendsQuery',
        series: tile.series.map(eventNode),
        dateRange: dateRange(tile.range, '-30d'),
        interval: tile.interval ?? 'day',
        trendsFilter: { display: tile.display ?? 'ActionsLineGraph' },
      };
      if (tile.breakdown) source.breakdownFilter = { breakdown: tile.breakdown, breakdown_type: 'event' };
      if (tile.breakdownHogql) source.breakdownFilter = { breakdown: tile.breakdownHogql, breakdown_type: 'hogql' };
      return viz(source);
    }
    case 'funnel': {
      let steps = tile.steps;
      if (tile.flow) {
        const f = flows[tile.flow];
        if (!f?.steps?.length) return null;
        steps = f.steps.map((s) => (typeof s === 'string' ? s : s.event)).filter(Boolean);
      }
      return viz({
        kind: 'FunnelsQuery',
        series: steps.map(eventNode),
        dateRange: dateRange(tile.range, '-30d'),
        funnelsFilter: { funnelVizType: 'steps', funnelOrderType: 'ordered', funnelWindowInterval: tile.windowDays ?? 14, funnelWindowIntervalUnit: 'day' },
      });
    }
    case 'retention':
      return viz({
        kind: 'RetentionQuery',
        dateRange: dateRange(tile.range, '-8w'),
        retentionFilter: {
          targetEntity: { id: tile.target, type: 'events', name: tile.target },
          returningEntity: { id: tile.returning ?? tile.target, type: 'events', name: tile.returning ?? tile.target },
          period: tile.period ?? 'Week',
          totalIntervals: tile.intervals ?? 8,
          retentionType: 'retention_first_time',
        },
      });
    case 'lifecycle':
      return viz({
        kind: 'LifecycleQuery',
        series: tile.series.map(eventNode),
        dateRange: dateRange(tile.range, '-8w'),
        interval: tile.interval ?? 'week',
        lifecycleFilter: {},
      });
    case 'stickiness':
      return viz({
        kind: 'StickinessQuery',
        series: tile.series.map(eventNode),
        dateRange: dateRange(tile.range, '-30d'),
        interval: tile.interval ?? 'day',
        stickinessFilter: {},
      });
    case 'paths':
      return viz({
        kind: 'PathsQuery',
        dateRange: dateRange(tile.range, '-30d'),
        pathsFilter: {
          includeEventTypes: tile.eventTypes ?? ['$pageview'],
          ...(tile.start ? { startPoint: tile.start } : {}),
          stepLimit: tile.steps ?? 5,
        },
      });
    case 'hogql':
      return { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query: tile.hogql } };
    default:
      throw new Error(`unknown tile type "${tile.type}" (${tile.name})`);
  }
}

/** Every event name a tile refers to (for the catalogue check). Flow tiles resolve through `flows`. */
export function tileEvents(tile, flows = {}) {
  const out = [];
  const add = (s) => out.push(typeof s === 'string' ? s : s.event);
  (tile.series ?? []).forEach(add);
  (tile.steps && Array.isArray(tile.steps) && tile.type === 'funnel' ? tile.steps : []).forEach(add);
  if (tile.flow) (flows[tile.flow]?.steps ?? []).forEach(add);
  if (tile.target) out.push(tile.target);
  if (tile.returning) out.push(tile.returning);
  if (tile.start) out.push(tile.start);
  return out.filter(Boolean);
}

/** Normalises flows.json (array or `{flows: [...]}`) to `{ id → flow }`. */
export function indexFlows(raw) {
  const list = Array.isArray(raw) ? raw : raw?.flows ?? [];
  return Object.fromEntries(list.filter((f) => f?.id).map((f) => [f.id, f]));
}

/** Normalises actions.json (array or `{actions: [...]}`) to action bodies. */
export function workflowActions(raw) {
  const list = Array.isArray(raw) ? raw : raw?.actions ?? [];
  return list.filter((a) => a?.name).map((a) => ({
    name: a.name,
    description: a.description ?? '',
    events: a.events ?? (a.steps ?? []).map((s) => (typeof s === 'string' ? s : s.event)).filter(Boolean),
  }));
}

/** One bridge action per new name that matches the new event OR any of its legacy names. */
export function bridgeActions(legacy = {}) {
  const byNew = new Map();
  for (const [old, next] of Object.entries(legacy)) {
    if (!byNew.has(next)) byNew.set(next, []);
    byNew.get(next).push(old);
  }
  return [...byNew.entries()].map(([next, olds]) => ({
    name: `Bridge: ${next}`,
    description: `Alt und neu in einem: ${next} oder ${olds.join(', ')} (Umbenennung, siehe docs/analytics/event-naming.md).`,
    events: [next, ...olds],
  }));
}

const actionBody = (a) => ({
  name: a.name,
  description: a.description,
  steps: a.events.map((event) => ({ event, properties: [], url: null, url_matching: 'contains' })),
});

const ref = (kind, name) => `$ref:${kind}:${name}`;

/** Tiles of a dashboard that resolve to a query (flow tiles of a missing flow are dropped). */
export function resolvedTiles(spec) {
  const flows = indexFlows(spec.flows);
  const out = [];
  for (const d of spec.dashboards ?? []) {
    for (const tile of d.tiles) {
      const query = buildQuery(tile, flows);
      if (query) out.push({ dashboard: d.name, tile, query });
    }
  }
  return out;
}

/**
 * The idempotent request list. `existing` = `{ dashboards, insights, actions, feature_flags }`, each a
 * `{ name|key → id }` map (fetchExisting); a known name becomes a PATCH, an unknown one a POST.
 * Order: flags, dashboards, actions, insights (insights point at their dashboard by placeholder).
 */
export function buildPlan(spec, existing = {}) {
  const ex = { dashboards: {}, insights: {}, actions: {}, feature_flags: {}, ...existing };
  const steps = [];
  const upsert = (kind, collection, known, name, body, base) => {
    const id = known[name];
    steps.push({
      kind, name, ref: ref(kind, name), body,
      method: id != null ? 'PATCH' : 'POST',
      path: id != null ? `${base}/${collection}/${id}/` : `${base}/${collection}/`,
      ...(id != null ? { id } : {}),
    });
  };

  for (const f of spec.feature_flags ?? []) {
    upsert('feature_flag', 'feature_flags', ex.feature_flags, f.key, {
      key: f.key, name: f.name ?? f.key, active: f.active ?? false,
      filters: f.filters ?? { groups: [{ properties: [], rollout_percentage: 100 }] },
    }, PROJECT_BASE);
  }
  for (const d of spec.dashboards ?? []) {
    upsert('dashboard', 'dashboards', ex.dashboards, d.name, { name: d.name, description: d.description ?? '', pinned: true }, ENV_BASE);
  }
  const actions = [...bridgeActions(spec.legacy), ...workflowActions(spec.actions)];
  for (const a of actions) upsert('action', 'actions', ex.actions, a.name, actionBody(a), PROJECT_BASE);

  for (const { dashboard, tile, query } of resolvedTiles(spec)) {
    const dashRef = ex.dashboards[dashboard] ?? ref('dashboard', dashboard);
    upsert('insight', 'insights', ex.insights, tile.name, {
      name: tile.name, description: tile.desc ?? '', query, saved: true, dashboards: [dashRef],
    }, ENV_BASE);
  }
  return steps;
}

const resolveRefs = (value, ids) => {
  if (typeof value === 'string' && value.startsWith('$ref:')) {
    if (!(value in ids)) throw new Error(`unresolved ${value}`);
    return ids[value];
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, ids)]));
  return value;
};

/** Runs the plan through `send`, filling `$ref:` placeholders from earlier responses. Returns `{ref → id}`. */
export async function executePlan(plan, send, onStep = () => {}) {
  const ids = {};
  for (const step of plan) {
    const res = await send({ method: step.method, path: step.path, body: resolveRefs(step.body, ids) });
    ids[step.ref] = step.id ?? res?.id;
    onStep(step, res);
  }
  return ids;
}

/** GET the four collections and index them by name (flags by key). Read-only. */
export async function fetchExisting(send) {
  const pick = async (path, field) => {
    const out = {};
    let next = `${path}?limit=500`;
    while (next) {
      const page = await send({ method: 'GET', path: next });
      for (const r of page?.results ?? []) if (r[field] != null && !r.deleted) out[r[field]] = r.id;
      next = page?.next ? page.next.replace(/^https?:\/\/[^/]+/, '') : null;
    }
    return out;
  };
  return {
    dashboards: await pick(`${ENV_BASE}/dashboards/`, 'name'),
    insights: await pick(`${ENV_BASE}/insights/`, 'name'),
    actions: await pick(`${PROJECT_BASE}/actions/`, 'name'),
    feature_flags: await pick(`${PROJECT_BASE}/feature_flags/`, 'key'),
  };
}
