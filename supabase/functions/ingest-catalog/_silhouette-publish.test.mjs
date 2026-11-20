// node --test supabase/functions/ingest-catalog/_silhouette-publish.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ROWS_PER_SHARD,
  ROW_COLUMNS,
  SHAPE_COLUMNS,
  SILHOUETTE_KINDS,
  isSilhouettesIndex,
  namesFileJson,
  orderNames,
  parseNamesFile,
  planShards,
  shardFileJson,
  silhouetteNamesKey,
  silhouetteShardKey,
  silhouettesIndexJson,
  silhouettesIndexKey,
  silhouettesPlanKey,
} from './_silhouette-shards.ts';
import {
  READ_BATCH,
  SLICE_SHARDS,
  commitSilhouettes,
  parseCursor,
  planSilhouettes,
  publishSilhouetteSlice,
  publishSilhouetteStep,
} from './_silhouette-publish.ts';
import { gcLocalePrefixes } from './_locale-gc.ts';

const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const OTHER = '11111111-2222-4333-8444-555555555555';
const NOW = 1_800_000_000_000;

function row(name, shape = name) {
  return {
    class_name: name, channel: 'LIVE', patch_version: '4.10.3', build_number: '13165946',
    view_box: '0 0 100 100', path: `M 0 0 L ${shape.length} 1 Z`, edges: null,
    bbox: { x: 0, y: 0, w: 1, h: 1 }, anchors: [], unresolved: [], meta: { schema: 1, of: name },
    generated_at: '2026-11-19T17:20:11.123456+00:00',
  };
}

describe('silhouette shard layout', () => {
  it('keeps the key shapes of the contract', () => {
    assert.equal(silhouettesIndexKey(BUILD), `codex-silhouettes/${BUILD}/index.json`);
    assert.equal(silhouettesPlanKey(BUILD, 'mgaq1z2k'), `codex-silhouettes/${BUILD}/mgaq1z2k/plan.json`);
    assert.equal(silhouetteNamesKey(BUILD, 'mgaq1z2k', 'ship'), `codex-silhouettes/${BUILD}/mgaq1z2k/ship/names.json`);
    assert.equal(silhouetteShardKey(BUILD, 'mgaq1z2k', 'item', 12), `codex-silhouettes/${BUILD}/mgaq1z2k/item/12.json`);
  });

  it('orders by the catalog list, then the classes the catalog lacks by class name, each once', () => {
    assert.deepEqual(orderNames(['b', 'a', 'Z', 'x'], ['x', 'q', 'a', 'x']), ['x', 'a', 'Z', 'b']);
    assert.deepEqual(orderNames([], ['x']), []);
  });

  it('groups consecutive names into shards', () => {
    assert.deepEqual(planShards(['a', 'b', 'c', 'd', 'e'], 2), [['a', 'b'], ['c', 'd'], ['e']]);
    assert.deepEqual(planShards([], 6), []);
  });

  it('round-trips a names file and refuses another kind or shape', () => {
    const body = JSON.parse(namesFileJson('ship', [['a'], ['b']]));
    assert.deepEqual(parseNamesFile(body, 'ship'), [['a'], ['b']]);
    assert.equal(parseNamesFile(body, 'item'), null);
    assert.equal(parseNamesFile({ v: 1, kind: 'ship', shards: [['a', 3]] }, 'ship'), null);
    assert.equal(parseNamesFile(null, 'ship'), null);
  });

  it('stores a shared shape once and keeps every row in the given order', () => {
    const rows = new Map([['A', row('A', 'same')], ['B', row('B', 'same')], ['C', row('C', 'other!')]]);
    const built = shardFileJson('ship', 3, ['B', 'gone', 'A', 'C'], rows);
    assert.equal(built.rows, 3);
    assert.equal(built.shapes, 2);
    const file = JSON.parse(built.body);
    assert.equal(file.v, 1);
    assert.equal(file.kind, 'ship');
    assert.equal(file.shard, 3);
    assert.deepEqual(file.columns, [...ROW_COLUMNS]);
    assert.deepEqual(file.shapeColumns, [...SHAPE_COLUMNS]);
    assert.deepEqual(file.rows.map((r) => [r[0], r[1]]), [['B', 0], ['A', 0], ['C', 1]]);
    // every database column comes back out of [row, shape]
    const [name, shape, meta, generatedAt, channel, patch, build] = file.rows[2];
    const [viewBox, path, edges, bbox, anchors, unresolved] = file.shapes[shape];
    assert.deepEqual(
      { class_name: name, channel, patch_version: patch, build_number: build, view_box: viewBox, path, edges, bbox, anchors, unresolved, meta, generated_at: generatedAt },
      row('C', 'other!'),
    );
  });

  it('writes the golden shard the client reader is pinned to (codex-silhouette-shards.spec.ts)', () => {
    const shape = {
      view_box: '0 0 100 50', path: 'M 0 0 L 10 0 L 10 10 Z', edges: null, bbox: { x: 0, y: 0, w: 10, h: 10 },
      anchors: [{ portId: 'hardpoint_a', x: 10, y: 20 }], unresolved: [],
    };
    const coords = { channel: 'LIVE', patch_version: '4.10.3', build_number: '13165946', generated_at: '2026-11-19T17:20:11.123456+00:00' };
    const rows = new Map([
      ['A', { class_name: 'A', ...coords, ...shape, meta: { schema: 1 } }],
      ['B', { class_name: 'B', ...coords, ...shape, meta: { schema: 1, toolVersion: '0.61.0' } }],
    ]);
    assert.equal(
      shardFileJson('ship', 0, ['A', 'B'], rows).body,
      '{"v":1,"kind":"ship","shard":0,"columns":["class_name","shape","meta","generated_at","channel","patch_version","build_number"],"shapeColumns":["view_box","path","edges","bbox","anchors","unresolved"],"shapes":[["0 0 100 50","M 0 0 L 10 0 L 10 10 Z",null,{"x":0,"y":0,"w":10,"h":10},[{"portId":"hardpoint_a","x":10,"y":20}],[]]],"rows":[["A",0,{"schema":1},"2026-11-19T17:20:11.123456+00:00","LIVE","4.10.3","13165946"],["B",0,{"schema":1,"toolVersion":"0.61.0"},"2026-11-19T17:20:11.123456+00:00","LIVE","4.10.3","13165946"]]}',
    );
    assert.equal(namesFileJson('ship', [['A', 'B'], ['C']]), '{"v":1,"kind":"ship","shards":[["A","B"],["C"]]}');
  });

  it('does not fold rows that differ only in anchors or edges', () => {
    const a = row('A', 'same');
    const b = { ...row('B', 'same'), anchors: [{ portId: 'p', x: 1, y: 2 }] };
    const c = { ...row('C', 'same'), edges: 'M 0 0 L 1 1' };
    assert.equal(shardFileJson('ship', 0, ['A', 'B', 'C'], new Map([['A', a], ['B', b], ['C', c]])).shapes, 3);
  });

  it('validates an index', () => {
    const idx = JSON.parse(silhouettesIndexJson(BUILD, 'mgaq1z2k', { ship: { count: 1, shards: 1 } }));
    assert.ok(isSilhouettesIndex(idx, BUILD));
    assert.ok(!isSilhouettesIndex(idx, OTHER));
    assert.ok(!isSilhouettesIndex({ ...idx, gen: '../x' }, BUILD));
    assert.ok(!isSilhouettesIndex({ ...idx, kinds: { ship: { count: -1, shards: 0 } } }, BUILD));
  });
});

/** An in-memory bucket plus a table: `have[kind]` = names with a row, `catalog[kind]` = list order. */
function fixture({ have = {}, catalog = {}, usageBlocked = false, existing = [], hidePublic = false, now = NOW } = {}) {
  const store = new Map(existing.map((k) => [k, '"old"']));
  const puts = [];
  const rowReads = [];
  const deleted = [];
  const deps = {
    now: () => now,
    gate: async () => (usageBlocked ? { status: 507, code: 'r2_free_tier_guard', message: 'near limit' } : null),
    readSilhouetteNames: async (build, kind, from, limit) => [...(have[kind] ?? [])].sort().slice(from, from + limit),
    readCatalogNames: async (build, kind, from, limit) => (catalog[kind] ?? []).slice(from, from + limit),
    async readRows(build, kind, names) {
      rowReads.push([kind, names.length]);
      return names.filter((n) => (have[kind] ?? []).includes(n) && !n.startsWith('deleted')).map((n) => row(n, n.slice(0, 3)));
    },
    async putJson(key, body) {
      puts.push(key);
      store.set(key, body);
    },
    readPublic: async (key) => (!hidePublic && store.has(key) ? JSON.parse(store.get(key)) : null),
    readBucket: async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null),
    listKeys: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
    async deleteKey(key) {
      deleted.push(key);
      store.delete(key);
    },
  };
  return { deps, store, puts, rowReads, deleted };
}

/** Runs plan, every slice and the commit the way a caller does; returns every step's result. */
async function runAll(deps) {
  const steps = [await publishSilhouetteStep(BUILD, null, null, deps)];
  for (let next = steps[0].next; next; next = steps.at(-1).next) {
    steps.push(await publishSilhouetteStep(BUILD, steps[0].gen, next, deps));
    assert.ok(steps.length < 100, 'the cursor must advance');
  }
  return steps;
}

const SHIPS = Array.from({ length: 2 * ROWS_PER_SHARD.ship + 1 }, (_, i) => `ship_${String(i).padStart(2, '0')}`);
const ITEMS = Array.from({ length: (SLICE_SHARDS + 2) * ROWS_PER_SHARD.item }, (_, i) => `item_${String(i).padStart(4, '0')}`);

describe('planSilhouettes', () => {
  it('writes a names file per kind with rows, the plan last, and names every kind', async () => {
    const { deps, puts, store, rowReads } = fixture({ have: { ship: SHIPS, item: ITEMS }, catalog: { ship: [...SHIPS].reverse() } });
    const plan = await planSilhouettes(BUILD, deps);
    assert.equal(plan.gen, NOW.toString(36));
    assert.deepEqual(puts, [
      silhouetteNamesKey(BUILD, plan.gen, 'ship'),
      silhouetteNamesKey(BUILD, plan.gen, 'item'),
      silhouettesPlanKey(BUILD, plan.gen),
    ]);
    assert.deepEqual(Object.keys(plan.kinds), [...SILHOUETTE_KINDS]);
    assert.deepEqual(plan.kinds.ship, { count: SHIPS.length, shards: 3 });
    assert.deepEqual(plan.kinds.weapon, { count: 0, shards: 0 });
    assert.deepEqual(plan.kinds.armor, { count: 0, shards: 0 });
    assert.deepEqual(plan.next, { kind: 'ship', from: 0 });
    // the catalog's order decides the shards: ships reversed
    const names = parseNamesFile(JSON.parse(store.get(silhouetteNamesKey(BUILD, plan.gen, 'ship'))), 'ship');
    assert.deepEqual(names.flat(), [...SHIPS].reverse());
    assert.deepEqual(rowReads, [], 'a plan reads no outline');
  });

  it('pages both name reads', async () => {
    const many = Array.from({ length: 2300 }, (_, i) => `i_${String(i).padStart(5, '0')}`);
    const { deps } = fixture({ have: { item: many }, catalog: { item: many } });
    const plan = await planSilhouettes(BUILD, deps);
    assert.equal(plan.kinds.item.count, 2300);
    assert.equal(plan.kinds.item.shards, Math.ceil(2300 / ROWS_PER_SHARD.item));
  });

  it('writes nothing while the usage gate refuses', async () => {
    const { deps, puts } = fixture({ have: { ship: SHIPS }, usageBlocked: true });
    const plan = await planSilhouettes(BUILD, deps);
    assert.equal(plan.blocked.code, 'r2_free_tier_guard');
    assert.equal(plan.gen, null);
    assert.equal(plan.next, null);
    assert.deepEqual(puts, []);
  });

  it('goes straight to the commit for a build without any outline', async () => {
    const { deps } = fixture();
    const steps = await runAll(deps);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].next, 'commit');
    assert.equal(steps[1].index_put, true);
    assert.equal(steps[1].verified, true);
  });
});

describe('publishSilhouetteSlice', () => {
  it('puts the shards of its range, reads rows in small batches and hands on the cursor', async () => {
    const { deps, puts, rowReads, store } = fixture({ have: { ship: SHIPS, item: ITEMS }, catalog: { ship: SHIPS, item: ITEMS } });
    const plan = await planSilhouettes(BUILD, deps);
    puts.length = 0;

    const ship = await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    assert.deepEqual(puts, [0, 1, 2].map((n) => silhouetteShardKey(BUILD, plan.gen, 'ship', n)));
    assert.equal(ship.rows, SHIPS.length);
    assert.deepEqual(ship.next, { kind: 'item', from: 0 });
    assert.ok(ship.bytes > 0);

    const first = await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'item', from: 0 }, deps);
    assert.equal(first.to, SLICE_SHARDS);
    assert.deepEqual(first.next, { kind: 'item', from: SLICE_SHARDS });
    const last = await publishSilhouetteSlice(BUILD, plan.gen, first.next, deps);
    assert.equal(last.to, SLICE_SHARDS + 2);
    assert.equal(last.next, 'commit');
    assert.ok(rowReads.every(([, n]) => n <= READ_BATCH));
    assert.equal(rowReads.filter(([k]) => k === 'item').reduce((s, [, n]) => s + n, 0), ITEMS.length);

    // a shard holds exactly its names, in the plan's order
    const shard = JSON.parse(store.get(silhouetteShardKey(BUILD, plan.gen, 'item', 1)));
    assert.deepEqual(shard.rows.map((r) => r[0]), ITEMS.slice(ROWS_PER_SHARD.item, 2 * ROWS_PER_SHARD.item));
  });

  it('is repeatable: the same slice writes the same bodies', async () => {
    const { deps, store } = fixture({ have: { ship: SHIPS }, catalog: { ship: SHIPS } });
    const plan = await planSilhouettes(BUILD, deps);
    await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    const before = store.get(silhouetteShardKey(BUILD, plan.gen, 'ship', 1));
    await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    assert.equal(store.get(silhouetteShardKey(BUILD, plan.gen, 'ship', 1)), before);
  });

  it('leaves a name out whose row is gone since the plan', async () => {
    const have = ['a', 'deleted_b', 'c'];
    const { deps, store } = fixture({ have: { weapon: have }, catalog: { weapon: have } });
    const plan = await planSilhouettes(BUILD, deps);
    const res = await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'weapon', from: 0 }, deps);
    assert.equal(res.rows, 2);
    const shard = JSON.parse(store.get(silhouetteShardKey(BUILD, plan.gen, 'weapon', 0)));
    assert.deepEqual(shard.rows.map((r) => r[0]), ['a', 'c']);
  });

  it('refuses a generation without a plan and a cursor outside it', async () => {
    const { deps } = fixture({ have: { ship: SHIPS }, catalog: { ship: SHIPS } });
    await assert.rejects(publishSilhouetteSlice(BUILD, 'mgaq1z2k', { kind: 'ship', from: 0 }, deps), /no plan/);
    const plan = await planSilhouettes(BUILD, deps);
    await assert.rejects(publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 3 }, deps), /outside the plan/);
    await assert.rejects(publishSilhouetteSlice(BUILD, plan.gen, { kind: 'weapon', from: 0 }, deps), /outside the plan/);
    await assert.rejects(publishSilhouetteSlice(BUILD, '../x', { kind: 'ship', from: 0 }, deps), /bad generation/);
  });
});

describe('commitSilhouettes', () => {
  it('puts the index last and names every kind, after a read-back through the public path', async () => {
    const { deps, puts, store } = fixture({ have: { ship: SHIPS, item: ITEMS }, catalog: { ship: SHIPS, item: ITEMS } });
    const steps = await runAll(deps);
    const commit = steps.at(-1);
    assert.equal(puts.at(-1), silhouettesIndexKey(BUILD));
    assert.equal(puts.filter((k) => k === silhouettesIndexKey(BUILD)).length, 1);
    assert.equal(commit.verified, true);
    assert.equal(commit.index_put, true);
    assert.equal(commit.missing, 0);
    const index = JSON.parse(store.get(silhouettesIndexKey(BUILD)));
    assert.ok(isSilhouettesIndex(index, BUILD));
    assert.equal(index.gen, steps[0].gen);
    assert.deepEqual(index.kinds.item, { count: ITEMS.length, shards: SLICE_SHARDS + 2 });
    assert.deepEqual(index.kinds.armor, { count: 0, shards: 0 });
  });

  it('writes no index while a shard is missing', async () => {
    const { deps, store } = fixture({ have: { ship: SHIPS }, catalog: { ship: SHIPS } });
    const plan = await planSilhouettes(BUILD, deps);
    await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    store.delete(silhouetteShardKey(BUILD, plan.gen, 'ship', 2));
    const commit = await commitSilhouettes(BUILD, plan.gen, deps);
    assert.equal(commit.missing, 1);
    assert.equal(commit.first_missing, silhouetteShardKey(BUILD, plan.gen, 'ship', 2));
    assert.equal(commit.index_put, false);
    assert.ok(!store.has(silhouettesIndexKey(BUILD)));
  });

  it('writes no index and deletes nothing when the public read misses', async () => {
    const old = `codex-silhouettes/${BUILD}/aaaaaa00/ship/0.json`;
    const { deps, store, deleted } = fixture({ have: { ship: SHIPS }, catalog: { ship: SHIPS }, hidePublic: true, existing: [old] });
    const steps = await runAll(deps);
    assert.equal(steps.at(-1).verified, false);
    assert.equal(steps.at(-1).index_put, false);
    assert.ok(!store.has(silhouettesIndexKey(BUILD)));
    assert.deepEqual(deleted, []);
  });

  it('collects older generations only: never a newer one, never another build', async () => {
    const older = [`codex-silhouettes/${BUILD}/aaaaaa00/ship/0.json`, `codex-silhouettes/${BUILD}/aaaaaa00/plan.json`];
    const newer = `codex-silhouettes/${BUILD}/zzzzzzzz/ship/0.json`;
    const foreign = `codex-silhouettes/${OTHER}/aaaaaa00/ship/0.json`;
    const { deps, store, deleted } = fixture({ have: { ship: SHIPS }, catalog: { ship: SHIPS }, existing: [...older, newer, foreign] });
    const steps = await runAll(deps);
    assert.equal(steps.at(-1).removed_objects, 2);
    assert.deepEqual([...deleted].sort(), [...older].sort());
    assert.ok(store.has(newer) && store.has(foreign));
    assert.ok(store.has(silhouetteShardKey(BUILD, steps[0].gen, 'ship', 0)));
  });

  it('steps back when a newer generation already owns the index', async () => {
    const { deps, store } = fixture({ have: { ship: SHIPS }, catalog: { ship: SHIPS } });
    const plan = await planSilhouettes(BUILD, deps);
    await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    const newerGen = (NOW + 5000).toString(36);
    store.set(silhouettesIndexKey(BUILD), silhouettesIndexJson(BUILD, newerGen, plan.kinds));
    const commit = await commitSilhouettes(BUILD, plan.gen, deps);
    assert.equal(commit.superseded, true);
    assert.equal(commit.index_put, false);
    assert.equal(JSON.parse(store.get(silhouettesIndexKey(BUILD))).gen, newerGen);
  });
});

describe('commitSilhouettes against a table or bucket that moved', () => {
  it('writes no index when a class got its outline after the plan', async () => {
    const have = { ship: [...SHIPS] };
    const { deps, store } = fixture({ have, catalog: { ship: SHIPS } });
    const plan = await planSilhouettes(BUILD, deps);
    await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    have.ship.push('ship_late');
    const commit = await commitSilhouettes(BUILD, plan.gen, deps);
    assert.equal(commit.changed, 'ship');
    assert.equal(commit.index_put, false);
    assert.ok(!store.has(silhouettesIndexKey(BUILD)));
  });

  it('writes no index when a kind without a plan entry got rows, or a planned class lost its row', async () => {
    const have = { ship: [...SHIPS] };
    const { deps, store } = fixture({ have, catalog: { ship: SHIPS } });
    const plan = await planSilhouettes(BUILD, deps);
    await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    have.weapon = ['new_gun'];
    assert.equal((await commitSilhouettes(BUILD, plan.gen, deps)).changed, 'weapon');
    delete have.weapon;
    have.ship.pop();
    assert.equal((await commitSilhouettes(BUILD, plan.gen, deps)).changed, 'ship');
    assert.ok(!store.has(silhouettesIndexKey(BUILD)));
  });

  it('puts a newer publish back in charge when it finished while this index was being written', async () => {
    const { deps, store } = fixture({ have: { ship: SHIPS }, catalog: { ship: SHIPS } });
    const plan = await planSilhouettes(BUILD, deps);
    await publishSilhouetteSlice(BUILD, plan.gen, { kind: 'ship', from: 0 }, deps);
    const newerGen = (NOW + 5000).toString(36);
    const idxKey = silhouettesIndexKey(BUILD);
    const put = deps.putJson;
    deps.putJson = async (key, body) => {
      await put(key, body);
      if (key !== idxKey || JSON.parse(body).gen !== plan.gen) return;
      // The newer publish committed between this commit's index read and its put: its
      // collection removed this generation, and this put has just overwritten its index.
      for (const k of [...store.keys()]) if (k.includes(`/${plan.gen}/`)) store.delete(k);
      store.set(silhouettesPlanKey(BUILD, newerGen), silhouettesIndexJson(BUILD, newerGen, plan.kinds));
      store.set(silhouetteShardKey(BUILD, newerGen, 'ship', 0), '{}');
    };
    const commit = await commitSilhouettes(BUILD, plan.gen, deps);
    assert.equal(commit.superseded, true);
    assert.equal(commit.index_put, false);
    assert.equal(commit.removed_objects, 0);
    assert.equal(JSON.parse(store.get(idxKey)).gen, newerGen);
    assert.ok(store.has(silhouetteShardKey(BUILD, newerGen, 'ship', 0)), 'the newer generation is untouched');
  });
});

describe('publishSilhouetteStep / parseCursor', () => {
  it('reads a cursor from a request body', () => {
    assert.equal(parseCursor('commit'), 'commit');
    assert.deepEqual(parseCursor({ kind: 'item', from: 16, extra: 1 }), { kind: 'item', from: 16 });
    assert.equal(parseCursor({ kind: 'blueprint', from: 0 }), null);
    assert.equal(parseCursor({ kind: 'item', from: -1 }), null);
    assert.equal(parseCursor({ kind: 'item', from: 1.5 }), null);
    assert.equal(parseCursor(undefined), null);
  });

  it('a generation without a cursor is an error, not a second plan', async () => {
    const { deps } = fixture();
    assert.throws(() => publishSilhouetteStep(BUILD, 'mgaq1z2k', null, deps), /needs a cursor/);
  });
});

describe('locale_gc over codex-silhouettes', () => {
  it('selects the prefixes of builds that are gone, dry run by default', async () => {
    const keys = [
      `codex-silhouettes/${BUILD}/index.json`,
      `codex-silhouettes/${BUILD}/mgaq1z2k/ship/0.json`,
      `codex-silhouettes/${OTHER}/index.json`,
      `codex-silhouettes/${OTHER}/mgaq1z2k/item/names.json`,
    ];
    const deleted = [];
    const deps = {
      liveBuildIds: async () => [BUILD],
      listKeys: async (prefix) => keys.filter((k) => k.startsWith(prefix)),
      deleteKey: async (k) => void deleted.push(k),
    };
    const dry = await gcLocalePrefixes(deps, { dryRun: true, root: 'codex-silhouettes' });
    assert.deepEqual(dry.orphan_builds, [{ build_id: OTHER, objects: 2 }]);
    assert.deepEqual(deleted, []);
    const real = await gcLocalePrefixes(deps, { dryRun: false, root: 'codex-silhouettes' });
    assert.equal(real.objects_deleted, 2);
    assert.ok(deleted.every((k) => k.includes(OTHER)));
  });
});
