// node --test supabase/functions/ingest-catalog/_list-publish.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LIST_COLUMNS,
  LIST_FILES,
  RANK_PAGE,
  SHIP_RANK_PAYLOAD_KEYS,
  NAME_RE,
  PAYLOAD_KEYS,
  SHIP_PAYLOAD_KEYS,
  indexJson,
  isListsIndex,
  kindFileJson,
  listsFileKey,
  listsIndexKey,
  rowToArray,
  selectFor,
} from './_list-snapshots.ts';
import { LIST_PAGE, publishLists } from './_list-publish.ts';
import { gcLocalePrefixes } from './_locale-gc.ts';

const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('list snapshot builders', () => {
  it('keeps the key shapes of the contract', () => {
    assert.equal(listsIndexKey(BUILD), `codex-lists/${BUILD}/index.json`);
    assert.equal(listsFileKey(BUILD, 'mgaq1z2k', 'ship'), `codex-lists/${BUILD}/mgaq1z2k/ship.json`);
    assert.ok(NAME_RE.test('facets') && NAME_RE.test('blueprint') && NAME_RE.test('ship-rank'));
    assert.ok(!NAME_RE.test('ship-rankx'));
    assert.ok(!NAME_RE.test('shipx') && !NAME_RE.test('../ship') && !NAME_RE.test('codex_ships'));
  });

  it('lists the columns of LIST_SELECT in order, ships with the extra payload keys', () => {
    assert.deepEqual(LIST_COLUMNS.ship, ['class_name', 'guid', 'name_localized', 'manufacturer_code', 'role', 'crew_size', 'is_variant']);
    assert.deepEqual(LIST_COLUMNS.blueprint, ['class_name', 'name_localized', 'category', 'tier', 'craft_time_seconds', 'dismantle_time_seconds']);
    assert.deepEqual(PAYLOAD_KEYS.item, ['name', 'previewImage', 'manufacturer']);
    assert.deepEqual(SHIP_PAYLOAD_KEYS, ['name', 'previewImage', 'manufacturer', 'sizeClass', 'career', 'dimensions']);
  });

  it('ship-rank mirrors the ship columns and the client rank keys', () => {
    assert.deepEqual(LIST_COLUMNS['ship-rank'], LIST_COLUMNS.ship);
    assert.deepEqual(SHIP_RANK_PAYLOAD_KEYS, ['career', 'defaultLoadout', 'flight', 'hull', 'armorHp', 'cargoScu', 'stats']);
    const file = JSON.parse(kindFileJson('ship-rank', []));
    assert.equal(file.kind, 'ship-rank');
    assert.deepEqual(file.payloadKeys, SHIP_RANK_PAYLOAD_KEYS);
    assert.match(selectFor('ship-rank'), /p_stats:payload->stats$/);
  });

  it('selects payload slices server-side, never the whole payload', () => {
    const s = selectFor('manufacturer');
    assert.equal(s, 'class_name, name_localized, manufacturer_code, p_name:payload->name, p_previewImage:payload->previewImage, p_manufacturer:payload->manufacturer');
    assert.ok(!/(^|, )payload($|,)/.test(s));
  });

  it('turns a row into columns then payload entries, null when absent', () => {
    const row = { class_name: 'A', name_localized: 'Alpha', manufacturer_code: 'AEGS', p_name: { en: 'Alpha' } };
    assert.deepEqual(rowToArray('manufacturer', row), ['A', 'Alpha', 'AEGS', { en: 'Alpha' }, null, null]);
    const file = JSON.parse(kindFileJson('manufacturer', [rowToArray('manufacturer', row)]));
    assert.equal(file.v, 1);
    assert.equal(file.kind, 'manufacturer');
    assert.equal(file.rows[0].length, file.columns.length + file.payloadKeys.length);
  });

  it('validates an index', () => {
    const idx = JSON.parse(indexJson(BUILD, 'mgaq1z2k', { ship: { rows: 1, bytes: 2 } }));
    assert.ok(isListsIndex(idx, BUILD));
    assert.ok(!isListsIndex(idx, OTHER));
  });
});

function fixture({ failOn, usageBlocked, existing = [], hideFiles = false, foreignIndexGen = null } = {}) {
  const log = [];
  const store = new Map(existing.map((k) => [k, 'old']));
  const reads = [];
  const deps = {
    now: () => 1_800_000_000_000,
    gate: async () => (usageBlocked ? { status: 507, code: 'r2_free_tier_guard', message: 'near limit' } : null),
    async readRows(build, kind, from, limit) {
      reads.push([kind, from, limit]);
      const total = kind === 'item' ? LIST_PAGE + 5 : kind === 'ship-rank' ? RANK_PAGE + 1 : kind === 'weapon' ? 0 : 2;
      const n = Math.max(0, Math.min(limit, total - from));
      return Array.from({ length: n }, (_, i) => ({ class_name: `${kind}_${from + i}`, name_localized: `N${from + i}` }));
    },
    facetValues: async (build, kind) => ({ manufacturers: [{ code: kind }], sizes: [], grades: [], componentKinds: [] }),
    async putJson(key, body) {
      if (failOn && key.includes(failOn)) throw new Error('put failed');
      log.push(key);
      store.set(key, body);
    },
    readPublic: async (key) => (!hideFiles && store.has(key) && store.get(key) !== 'old' ? JSON.parse(store.get(key)) : null),
    async readBucket(key) {
      if (foreignIndexGen) return { v: 1, build: BUILD, gen: foreignIndexGen, files: {} };
      return store.has(key) && store.get(key) !== 'old' ? JSON.parse(store.get(key)) : null;
    },
    listKeys: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
    deleteKey: async (key) => void store.delete(key),
  };
  return { deps, log, store, reads };
}

describe('publishLists', () => {
  it('puts every kind, then facets, then the index last, and verifies through the public read', async () => {
    const { deps, log, reads } = fixture();
    const res = await publishLists(BUILD, deps);
    const gen = res.gen;
    assert.deepEqual(log, [...LIST_FILES.map((k) => listsFileKey(BUILD, gen, k)), listsFileKey(BUILD, gen, 'facets'), listsIndexKey(BUILD)]);
    assert.equal(res.verified, true);
    assert.equal(res.files.item.rows, LIST_PAGE + 5);
    assert.equal(res.files.weapon.rows, 0);
    assert.equal(res.files.facets.rows, 4);
    assert.ok(res.files.ship.bytes > 0);
    assert.equal(res.files['ship-rank'].rows, RANK_PAGE + 1);
    assert.deepEqual(log.slice(0, 3).map((k) => k.split('/').pop()), ['ship.json', 'ship-rank.json', 'weapon.json']);
    assert.deepEqual(reads.filter(([k]) => k === 'ship-rank'), [['ship-rank', 0, RANK_PAGE], ['ship-rank', RANK_PAGE, RANK_PAGE]]);
    // paging: item needed two pages, weapon one empty page
    assert.deepEqual(reads.filter(([k]) => k === 'item').map((r) => r[1]), [0, LIST_PAGE]);
  });

  it('stores the facet RPC results unchanged', async () => {
    const { deps, store } = fixture();
    const res = await publishLists(BUILD, deps);
    const facets = JSON.parse(store.get(listsFileKey(BUILD, res.gen, 'facets')));
    assert.deepEqual(Object.keys(facets.kinds), ['ship', 'weapon', 'component', 'item']);
    assert.deepEqual(facets.kinds.ship, { manufacturers: [{ code: 'ship' }], sizes: [], grades: [], componentKinds: [] });
  });

  it('a put failure leaves the old generation and the old index untouched', async () => {
    const old = [`codex-lists/${BUILD}/index.json`, `codex-lists/${BUILD}/a0000001/ship.json`];
    const { deps, store } = fixture({ failOn: '/item.json', existing: old });
    await assert.rejects(publishLists(BUILD, deps), /put failed/);
    for (const k of old) assert.equal(store.get(k), 'old', k);
  });

  it('GC removes only older generations of this build', async () => {
    const other = `codex-lists/${OTHER}/a0000001/ship.json`;
    const { deps, store } = fixture({
      existing: [`codex-lists/${BUILD}/a0000001/ship.json`, `codex-lists/${BUILD}/a0000001/facets.json`, other],
    });
    const res = await publishLists(BUILD, deps);
    assert.equal(res.removed_objects, 2);
    assert.ok(!store.has(`codex-lists/${BUILD}/a0000001/ship.json`));
    assert.ok(store.has(other));
    assert.ok(store.has(listsIndexKey(BUILD)));
    assert.ok(store.has(listsFileKey(BUILD, res.gen, 'ship')));
  });

  it('a failed public verification puts no index and deletes nothing', async () => {
    const old = [`codex-lists/${BUILD}/index.json`, `codex-lists/${BUILD}/a0000001/ship.json`];
    const { deps, store, log } = fixture({ hideFiles: true, existing: old });
    const res = await publishLists(BUILD, deps);
    assert.equal(res.verified, false);
    assert.equal(res.index_put, false);
    assert.ok(!log.includes(listsIndexKey(BUILD)));
    for (const k of old) assert.equal(store.get(k), 'old', k);
  });

  it('keeps a newer foreign generation the index names', async () => {
    const newer = 'zzzzzzzz';
    const { deps, store } = fixture({
      foreignIndexGen: newer,
      existing: [`codex-lists/${BUILD}/${newer}/ship.json`, `codex-lists/${BUILD}/a0000001/ship.json`],
    });
    const res = await publishLists(BUILD, deps);
    assert.ok(store.has(`codex-lists/${BUILD}/${newer}/ship.json`));
    assert.ok(!store.has(`codex-lists/${BUILD}/a0000001/ship.json`));
    assert.equal(res.removed_objects, 1);
  });

  it('keeps an older generation the index still names', async () => {
    const { deps, store } = fixture({
      foreignIndexGen: 'a0000001',
      existing: [`codex-lists/${BUILD}/a0000001/ship.json`, `codex-lists/${BUILD}/a0000000/ship.json`],
    });
    await publishLists(BUILD, deps);
    assert.ok(store.has(`codex-lists/${BUILD}/a0000001/ship.json`));
    assert.ok(!store.has(`codex-lists/${BUILD}/a0000000/ship.json`));
  });

  it('GC does nothing when the index cannot be read back from the bucket', async () => {
    const { deps, store } = fixture({ existing: [`codex-lists/${BUILD}/a0000001/ship.json`] });
    deps.readBucket = async () => null;
    const res = await publishLists(BUILD, deps);
    assert.equal(res.removed_objects, 0);
    assert.ok(store.has(`codex-lists/${BUILD}/a0000001/ship.json`));
  });

  it('writes nothing when the usage gate blocks', async () => {
    const { deps, log } = fixture({ usageBlocked: true });
    const res = await publishLists(BUILD, deps);
    assert.equal(log.length, 0);
    assert.equal(res.blocked.status, 507);
    assert.equal(res.blocked.code, 'r2_free_tier_guard');
    assert.equal(res.gen, null);
  });
});

describe('gc covers codex-lists', () => {
  it('deletes the prefix of a dropped build, keeps live ones', async () => {
    const keys = [`codex-lists/${BUILD}/index.json`, `codex-lists/${OTHER}/g/ship.json`, `codex-lists/${OTHER}/index.json`];
    const deleted = [];
    const res = await gcLocalePrefixes({
      liveBuildIds: async () => [BUILD],
      listKeys: async () => keys,
      deleteKey: async (k) => void deleted.push(k),
    }, { dryRun: false, root: 'codex-lists' });
    assert.deepEqual(deleted.sort(), [`codex-lists/${OTHER}/g/ship.json`, `codex-lists/${OTHER}/index.json`].sort());
    assert.equal(res.objects_deleted, 2);
  });
});
