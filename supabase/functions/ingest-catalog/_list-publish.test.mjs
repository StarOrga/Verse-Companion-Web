// node --test supabase/functions/ingest-catalog/_list-publish.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LIST_COLUMNS,
  LIST_FILES,
  LIST_KINDS,
  germanNameOf,
  namesDeFileJson,
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
import {
  AMMO_PAGE,
  AMMO_PAYLOAD_KEYS,
  CUT,
  PART_NAMES_PER_READ,
  PART_PAYLOAD_KEYS,
  STAT_KEEP,
  ammoRowJson,
  cutChildren,
  loadoutClassNames,
  PART_SELECT,
  partRowJson,
  payloadSlice,
  rankPartsFileJson,
} from './_rank-parts.ts';
import { gcLocalePrefixes } from './_locale-gc.ts';

const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const OTHER = '11111111-2222-4333-8444-555555555555';

const LOADOUT = [
  { itemPortName: 'hardpoint_gun', entityClassName: 'MOUNT', entries: [{ itemPortName: 'gun', entityClassName: ' GUN ' }] },
  { itemPortName: 'hardpoint_shield', entityClassName: 'SHIELD' },
  { itemPortName: 'hardpoint_seat', entityClassName: 'GHOST' },
];
/** Rows of the part tables (PART_SELECT shape). GUN sits in two tables: the weapon one wins. */
const PARTS = {
  weapon: [{ class_name: 'GUN', payload: { entityKind: 'weapon', subType: null, description: 'never published', weaponParams: { fireRate: 600 }, stats: { SEntityPhysicsControllerParams: { 'PhysType.Mass': 50 }, SHealthComponentParams: { Health: 9 } } } }],
  component: [
    { class_name: 'GUN', payload: { kind: 'never read' } },
    { class_name: 'SHIELD', payload: { kind: 'Shield', stats: { SCItemShieldGeneratorParams: { MaxShieldHealth: 4000 }, SDistortionParams: { Maximum: 1 }, flag: 1 } } },
  ],
  item: [{ class_name: 'MOUNT', payload: { attachType: 'Turret', guid: 'x' } }],
};

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
    // #402: the item-like files carry the model render as an optional card key at the end.
    for (const k of ['item', 'weapon', 'component']) assert.deepEqual(PAYLOAD_KEYS[k], ['name', 'previewImage', 'manufacturer', 'renderImage']);
    assert.deepEqual(PAYLOAD_KEYS.ammunition, ['name', 'previewImage', 'manufacturer']);
    assert.deepEqual(SHIP_PAYLOAD_KEYS, ['name', 'previewImage', 'manufacturer', 'sizeClass', 'career', 'dimensions']);
  });

  it('ship-rank mirrors the ship columns and the client rank keys', () => {
    assert.deepEqual(LIST_COLUMNS['ship-rank'], LIST_COLUMNS.ship);
    // RANK_PAYLOAD_KEYS of the client first, then what the landing's class comparison adds (COHORT_SHIP_KEYS).
    assert.deepEqual(SHIP_RANK_PAYLOAD_KEYS, ['career', 'defaultLoadout', 'flight', 'hull', 'armorHp', 'cargoScu', 'stats', 'crew', 'dimensions']);
    const file = JSON.parse(kindFileJson('ship-rank', []));
    assert.equal(file.kind, 'ship-rank');
    assert.deepEqual(file.payloadKeys, SHIP_RANK_PAYLOAD_KEYS);
    assert.match(selectFor('ship-rank'), /p_stats:payload->stats, p_crew:payload->crew, p_dimensions:payload->dimensions$/);
  });

  it('the rank files carry every key the landing class comparison reads by class name', () => {
    // COHORT_SHIP_KEYS / COHORT_STAT_KEYS of src/app/codex/landing/codex-landing-data.service.ts
    for (const k of ['flight', 'hull', 'armorHp', 'cargoScu', 'crew', 'dimensions', 'defaultLoadout']) {
      assert.ok(PAYLOAD_KEYS['ship-rank'].includes(k), k);
    }
    for (const name of ['weapon-rank', 'component-rank']) {
      for (const k of ['weaponParams', 'stats']) assert.ok(PAYLOAD_KEYS[name].includes(k), `${name} ${k}`);
    }
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

function fixture({ failReadOn, failOn, usageBlocked, existing = [], hideFiles = false, foreignIndexGen = null } = {}) {
  const log = [];
  const store = new Map(existing.map((k) => [k, 'old']));
  const reads = [];
  const deps = {
    now: () => 1_800_000_000_000,
    gate: async () => (usageBlocked ? { status: 507, code: 'r2_free_tier_guard', message: 'near limit' } : null),
    async readRows(build, kind, from, limit) {
      reads.push([kind, from, limit]);
      if (failReadOn === kind) throw new Error('read failed');
      const total = kind === 'item' ? LIST_PAGE + 5 : kind === 'ship-rank' ? RANK_PAGE + 1 : kind === 'weapon' ? 0 : 2;
      const n = Math.max(0, Math.min(limit, total - from));
      return Array.from({ length: n }, (_, i) => ({
        class_name: `${kind}_${from + i}`,
        name_localized: `N${from + i}`,
        // The first ship's stock loadout: a mount with a gun in it, a shield, and a class no table holds.
        ...(kind === 'ship-rank' && from + i === 0 ? { p_defaultLoadout: LOADOUT } : {}),
      }));
    },
    async readParts(build, table, names) {
      reads.push(['parts:' + table, names]);
      if (failReadOn === 'rank-parts') throw new Error('parts read failed');
      return (PARTS[table] ?? []).filter((r) => names.includes(r.class_name));
    },
    async readAmmoParts(build, from, limit) {
      reads.push(['parts:ammunition', from, limit]);
      return [{ class_name: 'GUN_AMMO', payload: { speed: 700, impactDamage: { physical: 5 }, raw: { size: 1, projectileParams: { damage: {} }, lightPoolParams: { a: 1 } } } }].slice(from, from + limit);
    },
    async readNames(build, kind, from, limit) {
      reads.push(['names:' + kind, from, limit]);
      if (failReadOn === 'names-de') throw new Error('names read failed');
      const rows = kind === 'ship'
        ? [
            { class_name: 'A', name_localized: 'Alpha', de: 'Älpha' },
            { class_name: 'B', name_localized: 'Beta', de: 'beta' },
            { class_name: 'C', name_localized: 'Gamma', de: '@loc_c' },
            { class_name: 'D', name_localized: 'Delta', de: null },
            { class_name: 'E', name_localized: 'Eps', de: 'TRANSLATION NOT FOUND x' },
            { class_name: 'F', name_localized: null, de: 'Ohne Englisch' },
          ]
        : [];
      return rows.slice(from, from + limit);
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
    assert.deepEqual(log, [
      ...LIST_FILES.map((k) => listsFileKey(BUILD, gen, k)),
      ...['facets', 'missile', 'weapon-rank', 'component-rank', 'names-de'].map((k) => listsFileKey(BUILD, gen, k)),
      listsIndexKey(BUILD),
      // rank-parts comes after the publish is live, then the index once more with its entry.
      listsFileKey(BUILD, gen, 'rank-parts'),
      listsIndexKey(BUILD),
    ]);
    assert.deepEqual(res.failed, []);
    assert.deepEqual(Object.keys(res.files).slice(-6), ['facets', 'missile', 'weapon-rank', 'component-rank', 'names-de', 'rank-parts']);
    assert.equal(res.files['names-de'].rows, 2);
    // missile and component-rank page by RANK_PAGE, weapon-rank by LIST_PAGE
    assert.deepEqual(reads.filter(([k]) => k === 'missile'), [['missile', 0, RANK_PAGE]]);
    assert.deepEqual(reads.filter(([k]) => k === 'component-rank'), [['component-rank', 0, RANK_PAGE]]);
    assert.deepEqual(reads.filter(([k]) => k === 'weapon-rank'), [['weapon-rank', 0, LIST_PAGE]]);
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

  it('a publish overtaken by a newer one puts no index and deletes nothing', async () => {
    // The newer publish finished first: the bucket's index names its generation and its GC
    // has removed this one's files. Writing an index now would point at nothing.
    const newer = 'zzzzzzzz';
    const { deps, store, log } = fixture({
      foreignIndexGen: newer,
      existing: [`codex-lists/${BUILD}/${newer}/ship.json`, `codex-lists/${BUILD}/a0000001/ship.json`],
    });
    const res = await publishLists(BUILD, deps);
    assert.equal(res.superseded, true);
    assert.equal(res.index_put, false);
    assert.equal(res.removed_objects, 0);
    assert.ok(!log.some((k) => k.endsWith('/index.json')));
    assert.ok(store.has(`codex-lists/${BUILD}/${newer}/ship.json`));
    assert.ok(store.has(`codex-lists/${BUILD}/a0000001/ship.json`));
  });

  it('GC keeps a newer generation that is not in the index yet', async () => {
    const newer = 'zzzzzzzz';
    const { deps, store } = fixture({
      existing: [`codex-lists/${BUILD}/${newer}/ship.json`, `codex-lists/${BUILD}/a0000001/ship.json`],
    });
    const res = await publishLists(BUILD, deps);
    assert.equal(res.index_put, true);
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

describe('added files', () => {
  it('a failure of one new file keeps the other files and the index, names it in failed', async () => {
    for (const bad of ['missile', 'component-rank', 'names-de', 'rank-parts']) {
      const { deps, store, log } = fixture({ failReadOn: bad });
      const res = await publishLists(BUILD, deps);
      assert.deepEqual(res.failed, [bad]);
      assert.ok(!(bad in res.files), bad);
      assert.equal(res.verified, true);
      assert.equal(res.index_put, true);
      const idx = JSON.parse(store.get(listsIndexKey(BUILD)));
      assert.ok(!(bad in idx.files));
      assert.equal(log.at(-1), listsIndexKey(BUILD));
      assert.ok(!log.includes(listsFileKey(BUILD, res.gen, bad)));
      assert.ok('ship' in idx.files && 'facets' in idx.files);
    }
  });

  it('a put failure of a new file is isolated too, a put failure of a base file still aborts', async () => {
    const { deps } = fixture({ failOn: '/weapon-rank.json' });
    const res = await publishLists(BUILD, deps);
    assert.deepEqual(res.failed, ['weapon-rank']);
    assert.ok(res.index_put);
  });

  it('missile carries the whole payload as its last column', async () => {
    assert.deepEqual(LIST_COLUMNS.missile, ['class_name', 'name_localized', 'sub_type', 'size', 'attach_type', 'payload']);
    assert.deepEqual(PAYLOAD_KEYS.missile, []);
    assert.equal(selectFor('missile'), 'class_name, name_localized, sub_type, size, attach_type, payload');
    const file = JSON.parse(kindFileJson('missile', [rowToArray('missile', { class_name: 'M', payload: { a: 1 } })]));
    assert.deepEqual(file.rows[0], ['M', null, null, null, null, { a: 1 }]);
  });

  it('weapon-rank and component-rank select their payload slices', () => {
    assert.equal(
      selectFor('weapon-rank'),
      'class_name, name_localized, sub_type, size, p_weaponParams:payload->weaponParams, p_stats:payload->stats',
    );
    assert.equal(
      selectFor('component-rank'),
      'class_name, name_localized, sub_type, size, p_kind:payload->kind, p_stats:payload->stats, p_weaponParams:payload->weaponParams',
    );
    assert.deepEqual(PAYLOAD_KEYS['component-rank'], ['kind', 'stats', 'weaponParams']);
  });

  it('names-de keeps only German names codex_search would search, in kind order', async () => {
    const { deps, store } = fixture();
    const res = await publishLists(BUILD, deps);
    const f = JSON.parse(store.get(listsFileKey(BUILD, res.gen, 'names-de')));
    assert.equal(f.v, 1);
    assert.equal(f.lang, 'de');
    assert.deepEqual(Object.keys(f.kinds), [...LIST_KINDS]);
    assert.deepEqual(f.kinds.ship, [['A', 'Älpha'], ['F', 'Ohne Englisch']]);
    assert.deepEqual(f.kinds.weapon, []);
    assert.equal(germanNameOf('Alpha', 'ALPHA'), null);
    assert.equal(germanNameOf('Alpha', ''), null);
    assert.equal(namesDeFileJson({ ship: [['A', 'B']] }), '{"v":1,"lang":"de","kinds":{"ship":[["A","B"]]}}');
  });
});

describe('rank-parts', () => {
  it('holds the parts of the stock loadouts, each from the first table that owns it', async () => {
    const { deps, store, reads } = fixture();
    const res = await publishLists(BUILD, deps);
    const f = JSON.parse(store.get(listsFileKey(BUILD, res.gen, 'rank-parts')));
    assert.equal(f.v, 1);
    assert.equal(f.kind, 'rank-parts');
    assert.deepEqual(f.payloadKeys, PART_PAYLOAD_KEYS);
    assert.deepEqual(f.ammoKeys, AMMO_PAYLOAD_KEYS);
    assert.deepEqual(f.rows.map((r) => [r[0], r[1]]), [['GUN', 'weapon'], ['SHIELD', 'component'], ['MOUNT', 'item']]);
    assert.ok(f.rows.every((r) => r.length === 3));
    assert.deepEqual(f.absent, ['GHOST']);
    assert.equal(res.files['rank-parts'].rows, 3);
    // Every name of the tree, trimmed and sorted; a table is only asked for what no earlier one held.
    assert.deepEqual(reads.filter(([k]) => String(k).startsWith('parts:')), [
      ['parts:weapon', ['GHOST', 'GUN', 'MOUNT', 'SHIELD']],
      ['parts:component', ['GHOST', 'MOUNT', 'SHIELD']],
      ['parts:item', ['GHOST', 'MOUNT']],
      ['parts:ammunition', 0, AMMO_PAGE],
    ]);
    // stats: kept structs whole, the others cut in place, scalars untouched.
    // The slice: the carried keys the payload HAS (a JSON null stays, an absent key stays absent), nothing else.
    assert.deepEqual(f.rows[0][2], {
      entityKind: 'weapon',
      subType: null,
      weaponParams: { fireRate: 600 },
      stats: { SEntityPhysicsControllerParams: { 'PhysType.Mass': 50 }, SHealthComponentParams: CUT },
    });
    assert.deepEqual(f.rows[2][2], { attachType: 'Turret' });
    assert.deepEqual(Object.entries(f.rows[1][2].stats), [
      ['SCItemShieldGeneratorParams', { MaxShieldHealth: 4000 }],
      ['SDistortionParams', CUT],
      ['flag', 1],
    ]);
    // ammunition: every row; of raw only the projectile survives.
    assert.deepEqual(f.ammo, [['GUN_AMMO', { impactDamage: { physical: 5 }, raw: { size: 1, projectileParams: { damage: {} }, lightPoolParams: CUT } }]]);
    // The index names the file only after it is in the bucket.
    assert.ok('rank-parts' in JSON.parse(store.get(listsIndexKey(BUILD))).files);
  });

  it('a newer publish that took the index meanwhile keeps it: no second index, the file is listed as failed', async () => {
    const { deps, store, log } = fixture();
    const readBucket = deps.readBucket;
    let indexReads = 0;
    // The third index read is the one before the second put.
    deps.readBucket = async (key) => (++indexReads === 3 ? { v: 1, build: BUILD, gen: 'zzzzzzzz', files: {} } : readBucket(key));
    const res = await publishLists(BUILD, deps);
    assert.deepEqual(res.failed, ['rank-parts']);
    assert.ok(!('rank-parts' in res.files));
    assert.equal(res.index_put, true);
    assert.equal(log.filter((k) => k === listsIndexKey(BUILD)).length, 1);
    assert.ok(!('rank-parts' in JSON.parse(store.get(listsIndexKey(BUILD))).files));
  });

  it('is not built when the publish itself did not go live', async () => {
    const { deps, reads, log } = fixture({ hideFiles: true });
    const res = await publishLists(BUILD, deps);
    assert.equal(res.index_put, false);
    assert.equal(reads.filter(([k]) => String(k).startsWith('parts:')).length, 0);
    assert.ok(!log.some((k) => k.endsWith('/rank-parts.json')));
  });

  it('reads the names in chunks of PART_NAMES_PER_READ', async () => {
    const { deps, reads } = fixture();
    const many = Array.from({ length: PART_NAMES_PER_READ + 1 }, (_, i) => ({ entityClassName: `N${String(i).padStart(4, '0')}` }));
    const readRows = deps.readRows;
    deps.readRows = async (build, kind, from, limit) =>
      (await readRows(build, kind, from, limit)).map((r) => (r.p_defaultLoadout ? { ...r, p_defaultLoadout: many } : r));
    await publishLists(BUILD, deps);
    assert.deepEqual(reads.filter(([k]) => k === 'parts:weapon').map(([, names]) => names.length), [PART_NAMES_PER_READ, 1]);
  });

  it('a build without stock loadouts still publishes the (empty) file', async () => {
    const { deps, store, reads } = fixture();
    const readRows = deps.readRows;
    deps.readRows = async (...a) => (await readRows(...a)).map(({ p_defaultLoadout: _drop, ...r }) => r);
    const res = await publishLists(BUILD, deps);
    const f = JSON.parse(store.get(listsFileKey(BUILD, res.gen, 'rank-parts')));
    assert.deepEqual(f.rows, []);
    assert.deepEqual(f.absent, []);
    assert.equal(f.ammo.length, 1);
    assert.equal(reads.filter(([k]) => /^parts:(weapon|component|item)$/.test(k)).length, 0);
  });
});

describe('rank-parts builders', () => {
  it('collects every class name of a loadout tree, trimmed', () => {
    const names = new Set();
    loadoutClassNames([{ entityClassName: 'A', entries: [{ entityClassName: ' B ', entries: [{ entityClassName: 'C' }] }, { entries: [{ entityClassName: 'D' }] }] }, null, { entityClassName: '' }], names);
    assert.deepEqual([...names], ['A', 'B', 'C', 'D']);
    loadoutClassNames(null, names);
    loadoutClassNames({ entityClassName: 'X' }, names);
    assert.equal(names.size, 4);
  });

  it('cuts only plain objects outside the keep hints and keeps the key order', () => {
    const stats = { B_Health: { a: 1 }, ItemResourceComponentParams: { b: 2 }, list: [{ c: 3 }], n: 5, z: null, SCItemShieldEmitterParams: {} };
    assert.deepEqual(Object.entries(cutChildren(stats, STAT_KEEP)), [
      ['B_Health', CUT],
      ['ItemResourceComponentParams', { b: 2 }],
      ['list', [{ c: 3 }]],
      ['n', 5],
      ['z', null],
      ['SCItemShieldEmitterParams', {}],
    ]);
    assert.equal(cutChildren(null, STAT_KEEP), null);
    assert.deepEqual(cutChildren([1], STAT_KEEP), [1]);
    assert.equal(CUT, '\u0000');
  });

  it('keeps the structs the cohort reads by findStat hint or by name', () => {
    for (const struct of [
      'ItemResourceComponentParams', 'SEntityPhysicsControllerParams', 'SCItemShieldGeneratorParams',
      'SCItemQuantumDriveParams', 'SCItemVehicleArmorParams', 'SCItemMissileParams',
    ]) {
      assert.deepEqual(cutChildren({ [struct]: { x: 1 } }, STAT_KEEP), { [struct]: { x: 1 } }, struct);
    }
  });

  it('slices the whole payload: a JSON null stays, an absent key stays absent', () => {
    // A `payload->key` select answers null for both, and the full payload the client used to read tells them apart.
    assert.equal(PART_SELECT, 'class_name, payload');
    assert.deepEqual(payloadSlice({ kind: null, subType: 'x', guid: 'g' }, ['kind', 'subType', 'grade']), { kind: null, subType: 'x' });
    assert.deepEqual(payloadSlice(null, ['kind']), {});
    assert.deepEqual(payloadSlice({ stats: { A: { x: 1 } }, raw: { projectileParams: {}, other: {} } }, ['stats', 'raw']), {
      stats: { A: CUT },
      raw: { projectileParams: {}, other: CUT },
    });
  });

  it('builds a parseable file from row texts', () => {
    const row = partRowJson('item', { class_name: 'A', payload: { kind: 'x' } });
    const f = JSON.parse(rankPartsFileJson([row, row], ['G'], [ammoRowJson({ class_name: 'AM' })]));
    assert.deepEqual(Object.keys(f), ['v', 'kind', 'payloadKeys', 'ammoKeys', 'absent', 'rows', 'ammo']);
    assert.equal(f.rows.length, 2);
    assert.deepEqual(f.rows[0], ['A', 'item', { kind: 'x' }]);
    assert.deepEqual(f.ammo, [['AM', {}]]);
    assert.deepEqual(JSON.parse(rankPartsFileJson([], [], [])).rows, []);
    assert.ok(NAME_RE.test('rank-parts') && !NAME_RE.test('rank-partsx') && !NAME_RE.test('rank'));
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
