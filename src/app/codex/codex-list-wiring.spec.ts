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

function setup(snapshots: Partial<CodexListSnapshots>) {
  const sb = fakeSupabase((table) => (table.startsWith('codex_') ? { data: DB_ROWS, count: 1, error: null } : { data: [], error: null }));
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
    release();
    await new Promise((r) => setTimeout(r, 0));
    const before = entityCalls(sb.calls).length;
    const second = await svc.listByKind('weapon', {});
    expect(second.rows.map((r) => r.classNameSlug)).toEqual(['W_A', 'W_B']);
    expect(entityCalls(sb.calls).length).toBe(before);
  });
});
