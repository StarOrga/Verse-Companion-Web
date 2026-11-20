// The Holotable "Einordnung" stayed empty on load (holodeck walkthrough
// 2026-10-08): the fleet-wide payload read can lose a chunk to a statement
// timeout, getEntityPayloads swallowed that, and the half-fleet cohort was
// CACHED for the whole build. Now: one retry, never a cached partial cohort,
// and a still-incomplete read is an error the page offers a retry for.
import { TestBed } from '@angular/core/testing';
import { CodexService, FetchReport } from './codex.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { cohortCacheKey, readCohortCache } from './codex-rank';
import { LIST_SNAPSHOT_BASE, LIST_SNAPSHOT_FETCH } from './codex-list-snapshots';
import { RANK_AMMO_KEYS, RANK_PART_KEYS } from './codex-rank-parts';

const BUILD = { id: 'build-cohort-spec', channel: 'LIVE', patchVersion: '4.3' };

function service(): CodexService {
  TestBed.configureTestingModule({
    providers: [CodexService, { provide: SupabaseClientProvider, useValue: { client: {} } }],
  });
  const svc = TestBed.inject(CodexService);
  vi.spyOn(svc, 'loadCurrentBuild').mockResolvedValue(BUILD as never);
  vi.spyOn(svc as unknown as { allShipRows: () => Promise<unknown[]> }, 'allShipRows').mockResolvedValue([
    { classNameSlug: 'AEGS_Gladius', nameLocalized: 'Gladius', role: null, payload: { defaultLoadout: [{ itemPortName: 'gun', entityClassName: 'GUN' }] } },
  ]);
  vi.spyOn(svc, 'getAmmoPayloads').mockResolvedValue(new Map());
  return svc;
}

describe('CodexService.getRankCohort — incomplete reads', () => {
  const key = cohortCacheKey(BUILD.id, 'all');
  beforeEach(() => localStorage.removeItem(key));
  afterEach(() => {
    localStorage.removeItem(key);
    TestBed.resetTestingModule();
  });

  it('retries a failed payload chunk once and caches the complete cohort', async () => {
    const svc = service();
    let call = 0;
    const payloads = vi.spyOn(svc, 'getEntityPayloads').mockImplementation(async (_names: string[], report?: FetchReport) => {
      call++;
      if (call === 1 && report) report.failed++;
      return new Map([['GUN', { kind: 'weapon' as const, payload: {} }]]);
    });
    const cohort = await svc.getRankCohort();
    expect(payloads).toHaveBeenCalledTimes(2);
    expect(cohort.length).toBe(1);
    expect(readCohortCache(key)?.length).toBe(1);
  });

  it('still incomplete after the retry: throws and caches NOTHING', async () => {
    const svc = service();
    vi.spyOn(svc, 'getEntityPayloads').mockImplementation(async (_names: string[], report?: FetchReport) => {
      if (report) report.failed++;
      return new Map();
    });
    await expect(svc.getRankCohort()).rejects.toThrow();
    expect(readCohortCache(key)).toBeNull();
  });
});

// The parts of the cohort come from the build's rank-parts file when it is
// published (before: the full payload of every part from the database, 116
// requests and 26.5 MB on a cold browser). The file answers only what the
// database would have answered; everything else falls back to the old reads.
describe('CodexService.getRankCohort — parts from the build file', () => {
  const BASE = 'https://assets.test';
  const GEN = 'mgaq1z2k';
  const CUT = '\u0000';
  const key = cohortCacheKey(BUILD.id, 'all');

  /** What the database holds: the full payloads. */
  const FULL: Record<string, { kind: 'weapon' | 'component' | 'item'; payload: Record<string, unknown> }> = {
    GUN: {
      kind: 'weapon',
      payload: {
        className: 'GUN',
        entityKind: 'weapon',
        description: 'a text no rank reads',
        weaponParams: { fireRate: 600 },
        stats: { SEntityPhysicsControllerParams: { 'PhysType.Mass': 120 }, SHealthComponentParams: { Health: 500 } },
      },
    },
    SHLD: {
      kind: 'component',
      payload: {
        className: 'SHLD',
        entityKind: 'component',
        kind: 'Shield',
        stats: {
          SCItemShieldGeneratorParams: { MaxShieldHealth: 4000, MaxShieldRegen: 100 },
          SEntityPhysicsControllerParams: { 'PhysType.Mass': 80 },
          SDistortionParams: { Maximum: 5 },
        },
      },
    },
  };
  const FULL_AMMO: Record<string, unknown> = {
    GUN_AMMO: { impactDamage: { physical: 10 }, speed: 700, raw: { projectileParams: { damage: { DamagePhysical: 10 } }, lightPoolParams: { a: 1 } } },
  };
  const SHIP = {
    classNameSlug: 'AEGS_Gladius',
    nameLocalized: 'Gladius',
    role: null,
    payload: {
      defaultLoadout: [
        { itemPortName: 'hardpoint_weapon_gun', entityClassName: 'GUN' },
        { itemPortName: 'hardpoint_shield_generator', entityClassName: 'SHLD' },
        { itemPortName: 'hardpoint_seat', entityClassName: 'GHOST' },
      ],
    },
  };

  interface PartsFile {
    payloadKeys: string[];
    absent: string[];
    rows: unknown[][];
  }

  /** The file the publisher writes for FULL (supabase/functions/ingest-catalog/_rank-parts.ts). */
  function partsFile(change: (f: PartsFile) => void = () => undefined): PartsFile {
    const payloadKeys = [...RANK_PART_KEYS];
    const cut = (stats: Record<string, unknown>, keep: string[]) =>
      Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, keep.some((h) => k.toLowerCase().includes(h)) ? v : CUT]));
    // The slice of a payload: the carried keys it has, `stats` cut to the kept structs.
    const slice = (payload: Record<string, unknown>) =>
      Object.fromEntries(
        payloadKeys
          .filter((k) => k in payload)
          .map((k) => [k, k === 'stats' ? cut(payload[k] as Record<string, unknown>, ['physics', 'shield']) : payload[k]]),
      );
    const f = {
      v: 1,
      kind: 'rank-parts',
      payloadKeys,
      ammoKeys: [...RANK_AMMO_KEYS],
      absent: ['GHOST'],
      rows: Object.entries(FULL).map(([cn, hit]) => [cn, hit.kind, slice(hit.payload)]),
      ammo: [['GUN_AMMO', { impactDamage: { physical: 10 }, raw: { projectileParams: { damage: { DamagePhysical: 10 } }, lightPoolParams: CUT } }]],
    };
    change(f);
    return f;
  }

  const fullPayloads = (names: string[]) => new Map(names.filter((n) => FULL[n]).map((n) => [n, FULL[n]] as const));

  /** A service whose list files come from `files` (name → body); the database reads are spies over FULL. */
  function serviceWith(files: Record<string, unknown>) {
    const fetched: string[] = [];
    const fetchFn = (async (url: string) => {
      fetched.push(url);
      const dir = `${BASE}/codex-lists/${BUILD.id}/`;
      if (url === `${dir}index.json`) {
        const listed = Object.fromEntries(Object.keys(files).map((n) => [n, { rows: 1, bytes: 1 }]));
        return Response.json({ v: 1, build: BUILD.id, gen: GEN, files: listed });
      }
      for (const [name, body] of Object.entries(files)) if (url === `${dir}${GEN}/${name}.json`) return Response.json(body);
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    TestBed.configureTestingModule({
      providers: [
        CodexService,
        { provide: SupabaseClientProvider, useValue: { client: {} } },
        { provide: LIST_SNAPSHOT_FETCH, useValue: fetchFn },
        { provide: LIST_SNAPSHOT_BASE, useValue: BASE },
      ],
    });
    const svc = TestBed.inject(CodexService);
    vi.spyOn(svc, 'loadCurrentBuild').mockResolvedValue({ ...BUILD, schemaVersion: 6 } as never);
    vi.spyOn(svc as unknown as { allShipRows: () => Promise<unknown[]> }, 'allShipRows').mockResolvedValue([SHIP]);
    const entityReads = vi.spyOn(svc, 'getEntityPayloads').mockImplementation(async (names: string[]) => fullPayloads(names));
    const ammoReads = vi
      .spyOn(svc, 'getAmmoPayloads')
      .mockImplementation(async (names: string[]) => new Map(names.filter((n) => n in FULL_AMMO).map((n) => [n, FULL_AMMO[n]] as const)));
    return { svc, entityReads, ammoReads, fetched };
  }

  /** The cohort the database path yields: what every file answer has to equal. */
  async function databaseCohort() {
    const { svc } = serviceWith({});
    const cohort = await svc.getRankCohort();
    localStorage.removeItem(key);
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    return cohort;
  }

  beforeEach(() => localStorage.removeItem(key));
  afterEach(() => {
    localStorage.removeItem(key);
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('scores from the file: no part payload is read from the database, the cohort is the same', async () => {
    const expected = await databaseCohort();
    // The fixture really scores something, so "the same" is not two empty sheets.
    expect(expected[0].sheet.shieldHp).toBe(4000);
    expect(expected[0].sheet.alpha).toBe(10);

    const { svc, entityReads, ammoReads, fetched } = serviceWith({ 'rank-parts': partsFile() });
    const cohort = await svc.getRankCohort();
    expect(cohort).toEqual(expected);
    expect(entityReads).not.toHaveBeenCalled();
    expect(ammoReads).not.toHaveBeenCalled();
    expect(fetched.filter((u) => u.endsWith('/rank-parts.json')).length).toBe(1);
    expect(readCohortCache(key)).toEqual(expected);
  });

  it('reads the database when the build has no rank-parts file', async () => {
    const expected = await databaseCohort();
    const { svc, entityReads, ammoReads, fetched } = serviceWith({ weapon: {} });
    expect(await svc.getRankCohort()).toEqual(expected);
    expect(entityReads).toHaveBeenCalledWith(['GUN', 'SHLD', 'GHOST'], expect.anything());
    expect(ammoReads).toHaveBeenCalledTimes(1);
    // The index does not list the file, so it is never asked for.
    expect(fetched.some((u) => u.endsWith('/rank-parts.json'))).toBe(false);
  });

  it('reads the database for a file published before a key the cohort reads existed', async () => {
    const expected = await databaseCohort();
    const older = partsFile((f) => {
      f.payloadKeys.splice(f.payloadKeys.indexOf('stats'), 1);
      for (const r of f.rows) delete (r[2] as Record<string, unknown>)['stats'];
    });
    const { svc, entityReads } = serviceWith({ 'rank-parts': older });
    expect(await svc.getRankCohort()).toEqual(expected);
    expect(entityReads).toHaveBeenCalledWith(['GUN', 'SHLD', 'GHOST'], expect.anything());
  });

  it('declines the whole file when a read reaches something it cut', async () => {
    const expected = await databaseCohort();
    // As if a publisher had kept fewer structs: the shield generator's own struct is cut.
    const thin = partsFile((f) => {
      const stats = (f.rows[1][2] as { stats: Record<string, unknown> }).stats;
      stats['SCItemShieldGeneratorParams'] = CUT;
    });
    const { svc, entityReads, ammoReads } = serviceWith({ 'rank-parts': thin });
    const cohort = await svc.getRankCohort();
    expect(cohort).toEqual(expected);
    expect(cohort[0].sheet.shieldHp).toBe(4000);
    expect(entityReads).toHaveBeenCalledWith(['GUN', 'SHLD', 'GHOST'], expect.anything());
    expect(ammoReads).toHaveBeenCalledTimes(1);
  });

  it('declines the file when a read outside it was caught on the way and never reached the cohort', async () => {
    const expected = await databaseCohort();
    const { svc, entityReads, ammoReads } = serviceWith({ 'rank-parts': partsFile() });
    // A helper on the scoring path that reads a key the file does not carry and swallows the
    // failure: its default would be scored and cached as if the database had answered.
    type Occupants = { payload: Record<string, unknown> }[];
    const inner = svc as unknown as { cohortOccupantsFor: (...a: unknown[]) => Occupants };
    const occupantsFor = inner.cohortOccupantsFor.bind(svc);
    vi.spyOn(inner, 'cohortOccupantsFor').mockImplementation((...a: unknown[]) => {
      const occupants = occupantsFor(...a);
      try {
        void occupants[0]?.payload['description'];
      } catch {
        /* swallowed, as a defensive helper would */
      }
      return occupants;
    });
    expect(await svc.getRankCohort()).toEqual(expected);
    expect(entityReads).toHaveBeenCalledWith(['GUN', 'SHLD', 'GHOST'], expect.anything());
    expect(ammoReads).toHaveBeenCalledTimes(1);
  });

  it('reads the database when scoring from the file fails for any other reason', async () => {
    const expected = await databaseCohort();
    const { svc, entityReads } = serviceWith({ 'rank-parts': partsFile() });
    const inner = svc as unknown as { scoreCohort: (...a: unknown[]) => Promise<unknown> };
    const score = inner.scoreCohort.bind(svc);
    let call = 0;
    vi.spyOn(inner, 'scoreCohort').mockImplementation((...a: unknown[]) =>
      ++call === 1 ? Promise.reject(new TypeError('a proxy this code cannot handle')) : score(...a),
    );
    expect(await svc.getRankCohort()).toEqual(expected);
    expect(call).toBe(2);
    expect(entityReads).toHaveBeenCalledWith(['GUN', 'SHLD', 'GHOST'], expect.anything());
    expect(readCohortCache(key)).toEqual(expected);
  });

  it('reads from the database only the class name the file does not know', async () => {
    const expected = await databaseCohort();
    // No GUN row, and GUN is not listed as absent.
    const partial = partsFile((f) => void f.rows.splice(0, 1));
    const { svc, entityReads, ammoReads } = serviceWith({ 'rank-parts': partial });
    expect(await svc.getRankCohort()).toEqual(expected);
    expect(entityReads).toHaveBeenCalledTimes(1);
    expect(entityReads).toHaveBeenCalledWith(['GUN'], expect.anything());
    expect(ammoReads).not.toHaveBeenCalled();
  });

  it('uses the database path, with its retry, when that one read fails', async () => {
    const expected = await databaseCohort();
    const partial = partsFile((f) => void f.rows.splice(0, 1));
    const { svc, entityReads } = serviceWith({ 'rank-parts': partial });
    let call = 0;
    entityReads.mockImplementation(async (names: string[], report?: FetchReport) => {
      if (++call === 1 && report) report.failed++;
      return fullPayloads(names);
    });
    expect(await svc.getRankCohort()).toEqual(expected);
    expect(entityReads.mock.calls.map((c) => c[0])).toEqual([['GUN'], ['GUN', 'SHLD', 'GHOST']]);
  });
});
