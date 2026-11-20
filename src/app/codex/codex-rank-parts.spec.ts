import { findStat } from '../hangar/loadout-stats';
import { RANK_AMMO_KEYS, RANK_PART_KEYS, SnapshotCut, parseRankParts } from './codex-rank-parts';

/** The publisher's placeholder for a cut object (_rank-parts.ts CUT). */
const CUT = '\u0000';

/** One row in the order of `keys`: `[class_name, table, ...values]`, null where the part has no value. */
const row = (keys: readonly string[], className: string, table: string, values: Record<string, unknown>): unknown[] => [
  className,
  table,
  ...keys.map((k) => values[k] ?? null),
];

function file(extra: Record<string, unknown> = {}, keys: readonly string[] = RANK_PART_KEYS): Record<string, unknown> {
  return {
    v: 1,
    kind: 'rank-parts',
    payloadKeys: keys,
    ammoKeys: RANK_AMMO_KEYS,
    absent: ['GHOST'],
    rows: [
      row(keys, 'GUN', 'weapon', {
        entityKind: 'weapon',
        weaponParams: { fireRate: 600 },
        stats: { SHealthComponentParams: CUT, SEntityPhysicsControllerParams: { 'PhysType.Mass': 120 }, flag: 1 },
      }),
      row(keys, 'SHLD', 'component', { kind: 'shield', stats: { SCItemShieldGeneratorParams: { MaxShieldHealth: 4000 } } }),
    ],
    ammo: [['GUN_AMMO', { physical: 10 }, null, { size: 1, lightPoolParams: CUT, projectileParams: { damage: { DamagePhysical: 10 } } }]],
    ...extra,
  };
}

type Stats = Record<string, Record<string, unknown>>;
const payloadOf = (parts: ReturnType<typeof parseRankParts>, className: string) =>
  parts!.entities.get(className)!.payload as Record<string, unknown>;

describe('parseRankParts', () => {
  it('hands out each part with its table and the carried payload keys', () => {
    const parts = parseRankParts(file())!;
    expect([...parts.entities.keys()]).toEqual(['GUN', 'SHLD']);
    expect(parts.entities.get('GUN')!.kind).toBe('weapon');
    expect(parts.entities.get('SHLD')!.kind).toBe('component');
    expect([...parts.absent]).toEqual(['GHOST']);
    const gun = payloadOf(parts, 'GUN');
    expect(gun['entityKind']).toBe('weapon');
    expect(gun['weaponParams']).toEqual({ fireRate: 600 });
    // No value in the file = no key, like a `payload->key` read that came back null.
    expect(gun['kind']).toBeUndefined();
    expect('kind' in gun).toBe(false);
    expect('weaponParams' in gun).toBe(true);
    const shot = parts.ammo.get('GUN_AMMO') as Record<string, unknown>;
    expect(shot['impactDamage']).toEqual({ physical: 10 });
    expect((shot['raw'] as { projectileParams: unknown }).projectileParams).toEqual({ damage: { DamagePhysical: 10 } });
  });

  it('declines a read of a payload key the file does not carry', () => {
    const gun = payloadOf(parseRankParts(file()), 'GUN');
    expect(() => gun['description']).toThrow(SnapshotCut);
    expect(() => 'itemPorts' in gun).toThrow(SnapshotCut);
    expect(() => Object.keys(gun)).toThrow(SnapshotCut);
    expect(() => ({ ...gun })).toThrow(SnapshotCut);
    expect(() => Object.prototype.hasOwnProperty.call(gun, 'size')).toThrow(SnapshotCut);
    // What every object answers, and a promise probing its value, stay quiet.
    expect(typeof gun['toString']).toBe('function');
    expect(gun['then']).toBeUndefined();
  });

  it('declines any look inside an object the publisher cut, and only there', () => {
    const parts = parseRankParts(file())!;
    const stats = payloadOf(parts, 'GUN')['stats'] as Stats;
    // The struct names stay, in the file's order: a scan sees the same structs as in the full payload.
    expect(Object.keys(stats)).toEqual(['SHealthComponentParams', 'SEntityPhysicsControllerParams', 'flag']);
    expect(stats['SEntityPhysicsControllerParams']['PhysType.Mass']).toBe(120);
    expect(stats['flag']).toBe(1);
    const cut = stats['SHealthComponentParams'];
    expect(typeof cut).toBe('object');
    expect(() => cut['Health']).toThrow(SnapshotCut);
    expect(() => Object.keys(cut)).toThrow(SnapshotCut);
    expect(() => 'Health' in cut).toThrow(SnapshotCut);
    const raw = (parts.ammo.get('GUN_AMMO') as { raw: Record<string, Record<string, unknown>> }).raw;
    expect(raw['size']).toBe(1);
    expect(() => raw['lightPoolParams']['x']).toThrow(SnapshotCut);
  });

  it('findStat answers from a kept struct and declines when its hint reaches a cut one', () => {
    const parts = parseRankParts(file())!;
    const gun = payloadOf(parts, 'GUN')['stats'] as Stats;
    expect(findStat(gun, 'physics', ['PhysType.Mass'])).toBe(120);
    expect(() => findStat(gun, 'health', ['Health'])).toThrow(SnapshotCut);
    // No hint scans every struct, the cut one included.
    expect(() => findStat(gun, null, ['PhysType.Mass'])).toThrow(SnapshotCut);
    expect(findStat(payloadOf(parts, 'SHLD')['stats'] as Stats, 'shield', ['MaxShieldHealth'])).toBe(4000);
  });

  it('declines a file published before a key the cohort reads existed', () => {
    const older = RANK_PART_KEYS.filter((k) => k !== 'stats');
    expect(parseRankParts(file({}, older))).toBeNull();
    expect(parseRankParts(file({ ammoKeys: ['impactDamage', 'weaponParams'] }))).toBeNull();
  });

  it('reads a newer file: keys are looked up by name, added keys and fields do not matter', () => {
    const newer = ['size', ...[...RANK_PART_KEYS].reverse(), 'grade'];
    const parts = parseRankParts(file({ note: 'added later', ammoKeys: [...RANK_AMMO_KEYS, 'speed'], ammo: [['A', null, null, null, 9]] }, newer))!;
    const gun = payloadOf(parts, 'GUN');
    expect(gun['entityKind']).toBe('weapon');
    expect(gun['weaponParams']).toEqual({ fireRate: 600 });
    expect((parts.ammo.get('A') as Record<string, unknown>)['speed']).toBe(9);
  });

  it('keeps the first row of a class name', () => {
    const rows = [row(RANK_PART_KEYS, 'X', 'weapon', { kind: 'first' }), row(RANK_PART_KEYS, 'X', 'item', { kind: 'second' })];
    const parts = parseRankParts(file({ rows }))!;
    expect(parts.entities.get('X')!.kind).toBe('weapon');
    expect(payloadOf(parts, 'X')['kind']).toBe('first');
  });

  it('declines an unexpected shape', () => {
    const bad: unknown[] = [
      null,
      'x',
      file({ v: 2 }),
      file({ kind: 'weapon' }),
      file({ payloadKeys: 'stats' }),
      file({ absent: [1] }),
      file({ rows: {} }),
      file({ rows: [['GUN', 'weapon']] }),
      file({ rows: [row(RANK_PART_KEYS, 'GUN', 'ship', {})] }),
      file({ rows: [[1, 'weapon', ...RANK_PART_KEYS.map(() => null)]] }),
      file({ ammo: [['A']] }),
      file({ ammo: [[1, null, null, null]] }),
    ];
    for (const body of bad) expect(parseRankParts(body)).toBeNull();
  });
});
