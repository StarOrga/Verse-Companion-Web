import { TestBed } from '@angular/core/testing';
import { CodexService } from './codex.service';
import { CodexListSnapshots, LIST_SNAPSHOT_BASE, LIST_SNAPSHOT_FETCH } from './codex-list-snapshots';
import { ListSnapshot, ListSnapshotName, SNAPSHOT_COLUMNS, makeSnapshot } from './codex-list-engine';
import { SupabaseClientProvider } from '../core/supabase.client';

const BUILD_ID = 'b77f1586-d1fe-4be9-a359-f397266acb86';
const BUILD_ROW = { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true };

interface Call {
  table: string;
  ops: string[];
}

/** A PostgREST builder double: every filter chains, awaiting it answers `answer(table)`. */
function fakeSupabase(answer: (table: string) => { data: unknown; count?: number | null; error: unknown }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'neq', 'or', 'not', 'in', 'gte', 'lte', 'order', 'range', 'filter', 'limit', 'like', 'ilike', 'is']) {
      chain[op] = (...args: unknown[]) => {
        call.ops.push(`${op}(${args.map((a) => JSON.stringify(a)).join(',')})`);
        return chain;
      };
    }
    chain['maybeSingle'] = () => Promise.resolve({ data: BUILD_ROW, error: null });
    chain['then'] = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve(answer(table)).then(ok, fail);
    return chain;
  };
  const rpc = vi.fn(async () => ({ data: null, error: { message: 'rpc not in this spec' }, status: 400 }));
  return { calls, provider: { client: { from, rpc } } };
}

const entityCalls = (calls: Call[]) => calls.filter((c) => c.table !== 'codex_builds' && c.table !== 'p4k_bundles_public_stats');

const CARD = ['name', 'previewImage', 'manufacturer'];
function weaponSnapshot(): ListSnapshot {
  const row = (cn: string, extra: Record<string, unknown> = {}) => [
    ...SNAPSHOT_COLUMNS.weapon.map((c) => ({ class_name: cn, name_localized: cn, is_variant: false, weapon_class: 'FPS', ...extra })[c] ?? null),
    { en: cn },
    null,
    null,
  ];
  return makeSnapshot('weapon', SNAPSHOT_COLUMNS.weapon, CARD, [row('W_A'), row('W_B'), row('W_Var', { is_variant: true })]);
}

const DB_ROWS = [{ class_name: 'FROM_DB', name_localized: 'From DB', is_variant: false }];

const defaultAnswer = (table: string) => (table.startsWith('codex_') ? { data: DB_ROWS, count: 1, error: null } : { data: [], error: null });

function setup(snapshots: Partial<CodexListSnapshots>, answer: Parameters<typeof fakeSupabase>[0] = defaultAnswer) {
  const sb = fakeSupabase(answer);
  TestBed.configureTestingModule({
    providers: [
      CodexService,
      { provide: CodexListSnapshots, useValue: snapshots },
      { provide: SupabaseClientProvider, useValue: sb.provider },
    ],
  });
  return { svc: TestBed.inject(CodexService), calls: sb.calls };
}

describe('CodexService list reads: snapshot first, database as the exact fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  const hit = (snap: ListSnapshot) => ({
    rows: vi.fn(async (_b: string, name: ListSnapshotName) => (name === snap.name ? snap : null)),
    facets: vi.fn(async () => null),
  });

  it('answers listByKind from the file: no list query reaches the database', async () => {
    const { svc, calls } = setup(hit(weaponSnapshot()));
    const out = await svc.listByKind('weapon', { limit: 1 });
    expect(out.count).toBe(2);
    expect(out.rows.map((r) => r.classNameSlug)).toEqual(['W_A']);
    expect(out.rows[0].payload).toEqual({ name: { en: 'W_A' } });
    expect(entityCalls(calls)).toEqual([]);
  });

  it('answers countByKind, weaponFacets and listFpsCatalog from the file', async () => {
    const { svc, calls } = setup(hit(weaponSnapshot()));
    expect(await svc.countByKind('weapon', { includeVariants: true })).toBe(3);
    expect((await svc.weaponFacets()).length).toBe(3);
    const fps = await svc.listFpsCatalog('weapon');
    expect(fps.map((r) => r.classNameSlug)).toEqual(['W_A', 'W_B']);
    expect(fps[0].payload).toEqual({ name: { en: 'W_A' }, previewImage: null, manufacturer: null });
    expect(entityCalls(calls)).toEqual([]);
  });

  const fallbacks: [string, Partial<CodexListSnapshots>][] = [
    ['the build is not published (null)', { rows: async () => null, facets: async () => null }],
    ['the reader rejects', { rows: async () => Promise.reject(new Error('boom')), facets: async () => null }],
  ];
  for (const [label, reader] of fallbacks) {
    it(`runs the old query when ${label}`, async () => {
      const { svc, calls } = setup(reader);
      const out = await svc.listByKind('weapon', {});
      expect(out.rows.map((r) => r.classNameSlug)).toEqual(['FROM_DB']);
      expect(out.count).toBe(1);
      expect(entityCalls(calls).map((c) => c.table)).toEqual(['codex_weapons']);
    });
  }

  it('runs the old query when the engine declines (full payload)', async () => {
    const { svc, calls } = setup(hit(weaponSnapshot()));
    const out = await svc.listByKind('weapon', { payload: 'full' });
    expect(out.rows.map((r) => r.classNameSlug)).toEqual(['FROM_DB']);
    expect(entityCalls(calls).map((c) => c.table)).toEqual(['codex_weapons']);
  });

  it('runs the old query when the engine declines (untranslatable regex)', async () => {
    const { svc, calls } = setup(hit(weaponSnapshot()));
    expect(await svc.countByKind('weapon', { classNameMatch: '(a|b)' })).toBe(1);
    expect(entityCalls(calls).map((c) => c.table)).toEqual(['codex_weapons']);
  });

  it('runs the old query when the engine throws (logged once)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = weaponSnapshot();
    Object.defineProperty(broken, 'rows', {
      get() {
        throw new Error('engine bug');
      },
    });
    const { svc, calls } = setup(hit(broken));
    const out = await svc.listByKind('weapon', {});
    expect(out.rows.map((r) => r.classNameSlug)).toEqual(['FROM_DB']);
    expect(await svc.countByKind('weapon', {})).toBe(1);
    expect((await svc.weaponFacets()).length).toBe(1);
    expect(entityCalls(calls).map((c) => c.table)).toEqual(['codex_weapons', 'codex_weapons', 'codex_weapons']);
    expect(warn).toHaveBeenCalledTimes(3); // once per read kind (list, count, weapon facets)
    await svc.listByKind('weapon', {});
    expect(warn).toHaveBeenCalledTimes(3);
  });

  describe('search counts', () => {
    const row = (cn: string, name: string) => [
      ...SNAPSHOT_COLUMNS.weapon.map((c) => ({ class_name: cn, name_localized: name, is_variant: false })[c] ?? null),
      null,
      null,
      null,
    ];
    // ILIKE `*p4_ar*` lets "P4XAR" through; the shared matcher drops it.
    const searchSnap = () =>
      makeSnapshot('weapon', SNAPSHOT_COLUMNS.weapon, CARD, [row('BEHR_P4AR', 'P4-AR Rifle'), row('KLWE_P4XAR', 'P4XAR Thing')]);
    const onlyFalseHits = () => makeSnapshot('weapon', SNAPSHOT_COLUMNS.weapon, CARD, [row('KLWE_P4XAR', 'P4XAR Thing')]);

    it('countSearchMatches counts what listByKind lists for the same term', async () => {
      const { svc } = setup(hit(searchSnap()));
      const list = await svc.listByKind('weapon', { search: 'p4ar' });
      const counts = await svc.countSearchMatches('p4ar', ['weapon']);
      expect(list.count).toBe(1);
      expect(counts.get('weapon')).toBe(list.count);
    });

    it('asks the German names exactly when the post-matcher result is empty', async () => {
      const empty = setup(hit(onlyFalseHits()));
      const res = await empty.svc.listByKind('weapon', { search: 'p4ar' });
      expect(res).toEqual({ rows: [], count: 0 });
      const rpc = (TestBed.inject(SupabaseClientProvider) as unknown as { client: { rpc: ReturnType<typeof vi.fn> } }).client.rpc;
      expect(rpc.mock.calls.map((c) => c[0])).toEqual(['codex_search']);
      TestBed.resetTestingModule();

      const found = setup(hit(searchSnap()));
      await found.svc.listByKind('weapon', { search: 'p4ar' });
      const rpc2 = (TestBed.inject(SupabaseClientProvider) as unknown as { client: { rpc: ReturnType<typeof vi.fn> } }).client.rpc;
      expect(rpc2).not.toHaveBeenCalled();
    });
  });

  describe('cohort files (missile, weapon-rank, component-rank)', () => {
    const MISSILE_ROWS = [
      { class_name: 'MISL_A', name_localized: 'Arrow', sub_type: 'Missile', size: 2, attach_type: 'Missile', payload: { damage: { physical: 10 } } },
      { class_name: 'MISL_B', name_localized: 'Bolt', sub_type: 'Rocket', size: 1, attach_type: 'Missile', payload: null },
    ];
    const missileSnap = () =>
      makeSnapshot('missile', SNAPSHOT_COLUMNS.missile, [], MISSILE_ROWS.map((r) => SNAPSHOT_COLUMNS.missile.map((c) => (r as Record<string, unknown>)[c] ?? null)));
    const WEAPON_DB = [
      { class_name: 'GUN_A', name_localized: 'Gun A', sub_type: 'Gun', size: 2, wp: { fireRate: 600 } },
      { class_name: 'GUN_B', name_localized: 'Gun B', sub_type: 'Gun', size: 3, wp: null },
    ];
    const weaponRank = () =>
      makeSnapshot('weapon-rank', SNAPSHOT_COLUMNS['weapon-rank'], ['weaponParams'], [
        ['GUN_A', 'Gun A', 'Gun', 2, { fireRate: 600 }],
        ['GUN_X', '!Placeholder', 'Gun', 2, null],
        ['GUN_B', 'Gun B', 'Gun', 3, null],
      ]);
    const COMP_DB = [{ class_name: 'SHLD_A', name_localized: 'Shield A', sub_type: 'x', size: 1, ck: 'Shield', stats: { hp: 5 } }];
    const componentRank = () =>
      makeSnapshot('component-rank', SNAPSHOT_COLUMNS['component-rank'], ['kind', 'stats'], [
        ['COOL_A', 'Cooler A', 'x', 1, 'Cooler', {}],
        ['SHLD_A', 'Shield A', 'x', 1, 'Shield', { hp: 5 }],
        ['SHLD_X', '!Shield', 'x', 1, 'Shield', {}],
      ]);
    const files = (...snaps: ListSnapshot[]) => ({
      rows: vi.fn(async (_b: string, name: ListSnapshotName) => snaps.find((s) => s.name === name) ?? null),
      facets: vi.fn(async () => null),
    });
    const dbAnswer = (table: string) =>
      table === 'codex_items'
        ? { data: MISSILE_ROWS, error: null }
        : table === 'codex_weapons'
          ? { data: WEAPON_DB, error: null }
          : table === 'codex_components'
            ? { data: COMP_DB, error: null }
            : { data: [], error: null };
    const tables = (calls: Call[]) => entityCalls(calls).map((c) => c.table).filter((t) => t !== 'codex_silhouettes');

    it('answers all three from the files: no table read, the same records as the database path', async () => {
      const file = setup(files(missileSnap(), weaponRank(), componentRank()), dbAnswer);
      const fromFile = {
        missile: await file.svc.getMissileCohort(),
        weapon: await file.svc.getItemRankCohort('weapon'),
        shield: await file.svc.getItemRankCohort('Shield'),
      };
      expect(tables(file.calls)).toEqual([]);
      TestBed.resetTestingModule();

      const db = setup(files(), dbAnswer);
      const fromDb = {
        missile: await db.svc.getMissileCohort(),
        weapon: await db.svc.getItemRankCohort('weapon'),
        shield: await db.svc.getItemRankCohort('Shield'),
      };
      expect(tables(db.calls)).toEqual(['codex_items', 'codex_weapons', 'codex_components']);
      expect(fromFile).toEqual(fromDb);
      expect(fromFile.weapon.map((r) => r.className)).toEqual(['GUN_A', 'GUN_B']);
      expect(fromFile.shield.map((r) => r.className)).toEqual(['SHLD_A']);
      expect(fromFile.missile.map((r) => r.className)).toEqual(['MISL_A', 'MISL_B']);
    });

    it('uses the database when the engine throws on a file (logged once per read)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const broken = (s: ListSnapshot) => {
        Object.defineProperty(s, 'rows', {
          get() {
            throw new Error('engine bug');
          },
        });
        return s;
      };
      const { svc, calls } = setup(files(broken(missileSnap()), broken(weaponRank())), dbAnswer);
      expect((await svc.getMissileCohort()).length).toBe(2);
      expect((await svc.getItemRankCohort('weapon')).length).toBe(2);
      expect(tables(calls)).toEqual(['codex_items', 'codex_weapons']);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('a file the index does not name → that read alone uses the database', async () => {
      const fileBody = {
        v: 1,
        kind: 'weapon-rank',
        columns: SNAPSHOT_COLUMNS['weapon-rank'],
        payloadKeys: ['weaponParams'],
        rows: weaponRank().rows,
      };
      const fetchFn = (async (url: string) => {
        if (url.endsWith('index.json')) {
          return Response.json({ v: 1, build: BUILD_ID, gen: 'mgaq1z2k', files: { 'weapon-rank': { rows: 3, bytes: 1 } } });
        }
        if (url.endsWith('/weapon-rank.json')) return Response.json(fileBody);
        return new Response('nope', { status: 404 });
      }) as unknown as typeof fetch;
      const sb = fakeSupabase(dbAnswer);
      TestBed.configureTestingModule({
        providers: [
          CodexService,
          { provide: LIST_SNAPSHOT_FETCH, useValue: fetchFn },
          { provide: LIST_SNAPSHOT_BASE, useValue: 'https://assets.test' },
          { provide: SupabaseClientProvider, useValue: sb.provider },
        ],
      });
      const svc = TestBed.inject(CodexService);
      expect((await svc.getItemRankCohort('weapon')).map((r) => r.className)).toEqual(['GUN_A', 'GUN_B']);
      expect((await svc.getMissileCohort()).length).toBe(2);
      expect((await svc.getItemRankCohort('Shield')).length).toBe(1);
      expect(tables(sb.calls)).toEqual(['codex_items', 'codex_components']);
    });
  });

  describe('German-name search from names-de', () => {
    const row = (cn: string, name: string, extra: Record<string, unknown> = {}) => [
      ...SNAPSHOT_COLUMNS.weapon.map((c) => ({ class_name: cn, name_localized: name, is_variant: false, ...extra })[c] ?? null),
      { en: name },
      null,
      null,
    ];
    const weapons = () =>
      makeSnapshot('weapon', SNAPSHOT_COLUMNS.weapon, CARD, [
        row('BEHR_Rifle', 'Rifle'),
        row('BEHR_Rifle_Var', 'Rifle', { is_variant: true }),
        row('KLWE_Pistol', 'Pistol'),
      ]);
    const NAMES = new Map([['weapon', new Map([['BEHR_Rifle', 'Großes Schießeisen'], ['BEHR_Rifle_Var', 'Großes Schießeisen'], ['KLWE_Pistol', 'Knallbüchse']])]]);
    const reader = (namesDe: () => Promise<unknown>) => ({
      rows: vi.fn(async (_b: string, name: ListSnapshotName) => (name === 'weapon' ? weapons() : null)),
      facets: vi.fn(async () => null),
      namesDe: vi.fn(namesDe) as unknown as CodexListSnapshots['namesDe'],
    });
    const rpcOf = () => (TestBed.inject(SupabaseClientProvider) as unknown as { client: { rpc: ReturnType<typeof vi.fn> } }).client.rpc;

    it('matches German names locally: no RPC, no table read, list filters kept', async () => {
      const { svc, calls } = setup(reader(async () => NAMES));
      const out = await svc.listByKind('weapon', { search: 'grosses schiesseisen' });
      expect(out.rows.map((r) => r.classNameSlug)).toEqual(['BEHR_Rifle']);
      expect(out.count).toBe(1);
      expect(out.rows[0].payload).toEqual({ name: { en: 'Rifle' } });
      expect(rpcOf()).not.toHaveBeenCalled();
      expect(entityCalls(calls)).toEqual([]);
      expect((await svc.listByKind('weapon', { search: 'knallbuchse' })).rows.map((r) => r.classNameSlug)).toEqual(['KLWE_Pistol']);
    });

    it('no German match → the empty result, still without the RPC', async () => {
      const { svc, calls } = setup(reader(async () => NAMES));
      expect(await svc.listByKind('weapon', { search: 'zahnrad' })).toEqual({ rows: [], count: 0 });
      expect(rpcOf()).not.toHaveBeenCalled();
      expect(entityCalls(calls)).toEqual([]);
    });

    const fallbacks: [string, () => Promise<unknown>][] = [
      ['names-de is not published', async () => null],
      ['names-de lacks the kind', async () => new Map()],
      ['the reader rejects', async () => Promise.reject(new Error('boom'))],
    ];
    for (const [label, namesDe] of fallbacks) {
      it(`asks the codex_search RPC when ${label}`, async () => {
        const { svc } = setup(reader(namesDe));
        await svc.listByKind('weapon', { search: 'schiesseisen' });
        expect(rpcOf().mock.calls.map((c) => c[0])).toEqual(['codex_search']);
      });
    }

    it('asks the codex_search RPC when the engine throws (logged)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const broken = {
        get() {
          throw new Error('engine bug');
        },
      };
      const { svc } = setup(reader(async () => broken));
      await svc.listByKind('weapon', { search: 'schiesseisen' });
      expect(rpcOf().mock.calls.map((c) => c[0])).toEqual(['codex_search']);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it('answers the skin siblings from the kind file, the database above the limit', async () => {
    const row = (cn: string) => [...SNAPSHOT_COLUMNS.weapon.map((c) => ({ class_name: cn, is_variant: true })[c] ?? null), null, null, null];
    const family = makeSnapshot('weapon', SNAPSHOT_COLUMNS.weapon, CARD, [
      row('gmni_pistol_ballistic_01_cen01'),
      row('gmni_pistol_ballistic_01'),
      row('gmni_rifle_ballistic_01'),
    ]);
    const { svc, calls } = setup(hit(family));
    const out = await svc.listSkinSiblings('weapon', 'gmni_pistol_ballistic_01_cen01');
    expect(out.map((r) => r.classNameSlug)).toEqual(['gmni_pistol_ballistic_01', 'gmni_pistol_ballistic_01_cen01']);
    expect(out[0].payload).toEqual({});
    expect(entityCalls(calls)).toEqual([]);

    TestBed.resetTestingModule();
    const many = makeSnapshot('weapon', SNAPSHOT_COLUMNS.weapon, CARD, Array.from({ length: 201 }, (_, i) => row(`gmni_pistol_ballistic_${i}`)));
    const big = setup(hit(many));
    expect((await big.svc.listSkinSiblings('weapon', 'gmni_pistol_ballistic_01')).map((r) => r.classNameSlug)).toEqual(['FROM_DB']);
  });

  it('uses the database when the file is still loading after 3 s, and the file on the next call', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fileBody = {
      v: 1,
      kind: 'weapon',
      columns: SNAPSHOT_COLUMNS.weapon,
      payloadKeys: CARD,
      rows: weaponSnapshot().rows,
    };
    const fetchFn = (async (url: string) => {
      if (url.endsWith('index.json')) {
        return Response.json({ v: 1, build: BUILD_ID, gen: 'mgaq1z2k', files: { weapon: { rows: 3, bytes: 1 } } });
      }
      await gate;
      return Response.json(fileBody);
    }) as unknown as typeof fetch;
    const sb = fakeSupabase((table) => (table.startsWith('codex_') ? { data: DB_ROWS, count: 1, error: null } : { data: [], error: null }));
    TestBed.configureTestingModule({
      providers: [
        CodexService,
        { provide: LIST_SNAPSHOT_FETCH, useValue: fetchFn },
        { provide: LIST_SNAPSHOT_BASE, useValue: 'https://assets.test' },
        { provide: SupabaseClientProvider, useValue: sb.provider },
      ],
    });
    const svc = TestBed.inject(CodexService);
    await svc.loadCurrentBuild();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const first = svc.listByKind('weapon', {});
      for (let i = 0; i < 20; i++) await Promise.resolve(); // until the reader has armed its wait
      await vi.advanceTimersByTimeAsync(2999);
      expect(entityCalls(sb.calls)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect((await first).rows.map((r) => r.classNameSlug)).toEqual(['FROM_DB']);
    } finally {
      vi.useRealTimers();
    }
    // While the same download still runs, the next call does not wait again.
    const again = await svc.listByKind('weapon', {});
    expect(again.rows.map((r) => r.classNameSlug)).toEqual(['FROM_DB']);
    release();
    const reader = TestBed.inject(CodexListSnapshots);
    for (let i = 0; i < 50 && !(await reader.rows(BUILD_ID, 'weapon', 10)); i++) await new Promise((r) => setTimeout(r, 5));
    const before = entityCalls(sb.calls).length;
    const second = await svc.listByKind('weapon', {});
    expect(second.rows.map((r) => r.classNameSlug)).toEqual(['W_A', 'W_B']);
    expect(entityCalls(sb.calls).length).toBe(before);
  });
});
