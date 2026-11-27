import { sustainedCycles } from '../codex-sustained-dps';
import { NOMAD_SHIP_STATS, nomadOccupants } from '../testing/nomad-power.fixture';
import type { RankShipInput } from '../codex-rank';
import type { SummaryOccupant } from '../ship-summary-panels';
import { computeKpiSheet } from '../codex-loadout-stats';
import {
  EM_SOURCES,
  buildEnergy,
  buildFireTimeline,
  buildHoloCategoryModels,
  buildLead,
  buildMovement,
  classShare,
  decoysNeeded,
  effectiveHpByType,
  gunnerShare,
  holoWeapons,
  partShares,
  recomputeEnergy,
  shieldDownIn,
  signatureToKm,
  type HoloWeapon,
} from './holo-category-model';

function gun(opts: {
  className: string;
  section?: 'weapons' | 'mannedTurrets';
  fireRate?: number;
  damage?: number;
  count?: number;
  cycle?: Record<string, number>;
}): SummaryOccupant {
  return {
    section: opts.section ?? 'weapons',
    kind: 'weapon',
    payload: {
      entityKind: 'weapon',
      className: opts.className,
      weaponParams: { fireRate: opts.fireRate ?? 60, ...(opts.cycle ?? {}) },
    },
    ammoPayload: { impactDamage: { physical: opts.damage ?? 40 } },
    count: opts.count ?? 1,
  };
}

// 1 shot/s. Heat: headroom 10 / (1 per shot) = 10 s, fix 10 s.
const HEAT = { heatPerShot: 1, 'heat.overheatTemperature': 10, 'heat.overheatFixTime': 10 };
// Magazine 30 → 30 s, reload 30 s.
const MAG = { ammoCapacity: 30, reloadTime: 30 };

function weapon(partial: Partial<HoloWeapon>): HoloWeapon {
  return {
    className: 'W',
    section: 'weapons',
    manned: false,
    count: 1,
    burstDps: 100,
    sustainedDps: 50,
    limiter: 'heat',
    fireTime: 10,
    downtime: 10,
    cycles: [],
    ...partial,
  };
}

describe('sustainedCycles', () => {
  it('lists every limit, shortest burst first, with each limit’s own DPS', () => {
    const c = sustainedCycles(40, 60, { ...HEAT, ...MAG });
    expect(c.map((x) => x.limit)).toEqual(['heat', 'magazine']);
    expect(c[0]).toMatchObject({ fireTime: 10, downtime: 10, value: 20 });
    expect(c[1]).toMatchObject({ fireTime: 30, downtime: 30, value: 20 });
  });
  it('is empty without a burst, a rate or a cycle', () => {
    expect(sustainedCycles(null, 60, HEAT)).toEqual([]);
    expect(sustainedCycles(40, null, HEAT)).toEqual([]);
    expect(sustainedCycles(40, 60, {})).toEqual([]);
  });
});

describe('holoWeapons / fire timeline', () => {
  const occ = [
    gun({ className: 'HOT', cycle: HEAT, count: 2 }),
    gun({ className: 'MAG', cycle: MAG, section: 'mannedTurrets' }),
  ];

  it('reads burst, limiter and fire time per weapon row, scaled by count', () => {
    const w = holoWeapons(occ);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ className: 'HOT', burstDps: 80, sustainedDps: 40, limiter: 'heat', fireTime: 10 });
    expect(w[1]).toMatchObject({ className: 'MAG', manned: true, limiter: 'magazine', fireTime: 30 });
  });

  it('steps down as each limiter gives out and ends on the sustained figure', () => {
    const t = buildFireTimeline(holoWeapons(occ));
    expect(t.phases).toEqual([
      { dps: 120, untilSec: 10, limiter: 'heat' },
      { dps: 40, untilSec: 30, limiter: 'magazine' },
    ]);
    expect(t.fullFireSec).toBe(10);
    expect(t.firstLimiter).toBe('heat');
    expect(t.complete).toBe(true);
    expect(t.sustainedDps).toBe(60); // 40 + 20
  });

  it('keeps a gun without a known cycle firing in an open phase and hides sustained', () => {
    const t = buildFireTimeline(holoWeapons([...occ, gun({ className: 'NOCYCLE' })]));
    expect(t.complete).toBe(false);
    expect(t.sustainedDps).toBeNull();
    expect(t.phases.at(-1)).toEqual({ dps: 40, untilSec: null, limiter: null });
  });

  it('has no phase end for a loadout without any limiter', () => {
    const t = buildFireTimeline(holoWeapons([gun({ className: 'A' })]));
    expect(t.phases).toEqual([{ dps: 40, untilSec: null, limiter: null }]);
    expect(t.fullFireSec).toBeNull();
  });

  it('is empty for no weapons', () => {
    expect(buildFireTimeline([])).toMatchObject({ phases: [], fullFireSec: null, sustainedDps: null });
  });
});

describe('gunnerShare', () => {
  it('is the manned share of sustained DPS', () => {
    const w = [weapon({ sustainedDps: 30 }), weapon({ manned: true, sustainedDps: 10 })];
    expect(gunnerShare(w, (x) => x.sustainedDps)).toBe(0.25);
  });
  it('is null when any gun lacks the figure, or there is none', () => {
    expect(gunnerShare([weapon({ sustainedDps: null })], (x) => x.sustainedDps)).toBeNull();
    expect(gunnerShare([], (x) => x.burstDps)).toBeNull();
  });
});

describe('effectiveHpByType', () => {
  const panel = {
    shieldHp: 1000,
    resistances: [{ channel: 'physical', pct: 50 }],
    armor: { reductionPhysicalPct: 20, reductionEnergyPct: null, reductionDistortionPct: null },
    hullHp: 3000,
  } as never;

  it('runs shield → armour → hull with the resistances of each type', () => {
    const [phys, energy] = effectiveHpByType(panel, 400);
    expect(phys).toMatchObject({ type: 'physical', shield: 2000, armor: 500, hull: 3000, total: 5500, armorKnown: true });
    expect(energy).toMatchObject({ type: 'energy', shield: 1000, armor: 400, total: 4400 });
  });
  it('drops the armour stage, flagged, when its HP is unknown', () => {
    const [phys] = effectiveHpByType(panel, null);
    expect(phys).toMatchObject({ armor: null, armorKnown: false, total: 5000 });
  });
  it('has no total without shield or hull', () => {
    const [phys] = effectiveHpByType({ ...(panel as object), hullHp: null } as never, 0);
    expect(phys.total).toBeNull();
  });
});

describe('shieldDownIn', () => {
  it('divides shield HP by the class median sustained DPS', () => {
    expect(shieldDownIn(1000, 400)).toBe(2.5);
  });
  it('is null without both numbers', () => {
    expect(shieldDownIn(null, 400)).toBeNull();
    expect(shieldDownIn(1000, null)).toBeNull();
    expect(shieldDownIn(1000, 0)).toBeNull();
  });
});

describe('signatureToKm / classShare / partShares', () => {
  it('converts model units to km with one decimal; gaps stay gaps', () => {
    expect(signatureToKm(50_149)).toBe(50.1);
    expect(signatureToKm(null)).toBeNull();
    expect(signatureToKm(-1)).toBeNull();
  });
  it('gives unit-less values as 0..1 of the class maximum and median', () => {
    expect(classShare(50, [25, 100, 200])).toEqual({ shareOfMax: 0.25, shareOfMedian: 0.5 });
    expect(classShare(500, [25, 100, 200])).toEqual({ shareOfMax: 1, shareOfMedian: 1 });
    expect(classShare(5, [])).toEqual({ shareOfMax: null, shareOfMedian: null });
  });
  it('shares add up to 1 and are null on a zero total', () => {
    expect(partShares([{ id: 'a', value: 1 }, { id: 'b', value: 3 }]).map((p) => p.share)).toEqual([0.25, 0.75]);
    expect(partShares([{ id: 'a', value: 0 }])[0].share).toBeNull();
  });
});

describe('buildLead', () => {
  const cohort = (values: (number | null)[]): RankShipInput[] =>
    values.map((v, i) => ({ className: `S${i}`, sizeClass: 1, career: null, sheet: { sustainedDps: v, ir: v } }));

  it('ranks inside a cohort of at least 8 and reports the median', () => {
    const lead = buildLead('sustainedDps', 80, cohort([10, 20, 30, 40, 50, 60, 70, 90]));
    expect(lead).toMatchObject({ thin: false, cohortSize: 8, median: 45 });
    expect(lead.rank).toBe(87.5);
  });
  it('mirrors lower-is-better keys', () => {
    expect(buildLead('ir', 5, cohort([10, 20, 30, 40, 50, 60, 70, 90])).rank).toBe(100);
  });
  it('gives the median but no rank for a thin cohort or a gap', () => {
    const lead = buildLead('sustainedDps', 80, cohort([10, 20, 30]));
    expect(lead).toMatchObject({ thin: true, rank: null, median: 20 });
    expect(buildLead('sustainedDps', null, cohort([1, 2, 3, 4, 5, 6, 7, 8])).rank).toBeNull();
  });
  it('has nothing without a cohort', () => {
    expect(buildLead('scm', 100, null)).toMatchObject({ rank: null, median: null, cohortSize: 0 });
  });
});

describe('decoysNeeded', () => {
  it('is all gaps without a decoy launcher', () => {
    expect(decoysNeeded([], { ir: 100, em: 100, crossSection: 100 })).toEqual({ ir: null, em: null, crossSection: null });
  });
});

describe('energy', () => {
  const occupants = nomadOccupants();
  const base = { occupants, shipStats: NOMAD_SHIP_STATS, schemaVersion: 3 };

  it('lists segments per consumer group and the generator total', () => {
    const e = buildEnergy(base);
    const keys = e.segments.map((s) => s.key);
    expect(keys.slice(0, 3)).toEqual(['weapons', 'shields', 'thrusters']);
    expect(keys).toContain('cooler1');
    expect(e.generator.available).toBe(14);
    expect(e.generator.used).toBeLessThanOrEqual(14);
    const weapons = e.segments.find((s) => s.key === 'weapons')!;
    expect(weapons.used).toBeLessThanOrEqual(weapons.max);
    expect(e.emKm).toBe(signatureToKm(e.em));
  });

  it('weapons set to 0 cuts the group, lowers the signature and zeroes the Offensive lead', () => {
    const r = recomputeEnergy(base, 'weapons', 0, 506);
    const w = r.energy.segments.find((s) => s.key === 'weapons')!;
    expect(w.used).toBe(0);
    expect(w.cut).toBe(true);
    expect(r.offensiveLead).toBe(0);
    expect(r.delta.offensiveLead).toBe(-506);
    expect(r.energy.generator.used).toBeLessThan(buildEnergy(base).generator.used);
  });

  it('a pinned level keeps the Offensive lead and never mutates the input', () => {
    const cut = new Set<never>();
    const r = recomputeEnergy({ ...base, cutGroups: cut }, 'weapons', 1, 506);
    expect(r.offensiveLead).toBe(506);
    expect(cut.size).toBe(0);
  });

  it('keeps a missing lead missing', () => {
    expect(recomputeEnergy(base, 'weapons', 0, null).offensiveLead).toBeNull();
  });
});

describe('buildHoloCategoryModels', () => {
  const occupants = [...nomadOccupants(), gun({ className: 'HOT', cycle: HEAT, count: 2 })];
  const ship = {
    flight: { scmSpeed: 200, maxSpeed: 1000, boostSpeed: 300, pitch: 60, yaw: 55, roll: 90 },
    hull: { hp: 21500, mass: 78000 },
    armorHp: null,
    cargoScu: 24,
    stats: NOMAD_SHIP_STATS,
  };

  const model = buildHoloCategoryModels({ occupants, ship, schemaVersion: 3 });

  it('fills the four categories from one call', () => {
    expect(model.offensive.lead.key).toBe('sustainedDps');
    expect(model.offensive.detail.timeline.fullFireSec).toBe(10);
    expect(model.defensive.detail.effectiveHp).toHaveLength(3);
    expect(model.movement.detail).toMatchObject({ scm: 200, pitch: 60, acceleration: null });
    expect(model.signature.detail.fuel).toBeNull();
  });

  it('passes hull HP through to the sheet', () => {
    expect(model.sheet.hullHp).toBe(21500);
  });

  it('shows signature as km and EM by source that adds up to the EM value', () => {
    const sig = model.signature.detail;
    expect(sig.emKm).toBe(signatureToKm(sig.em));
    expect(sig.emSources.map((p) => p.id)).toEqual([...EM_SOURCES]);
    const sum = sig.emSources.reduce((s, p) => s + p.value, 0);
    expect(Math.abs(sum - (sig.em ?? 0))).toBeLessThanOrEqual(EM_SOURCES.length);
    expect(sig.emSources.find((p) => p.id === 'generator')!.value).toBeGreaterThan(0);
  });

  it('has no rank or class share without a cohort', () => {
    expect(model.offensive.lead.rank).toBeNull();
    expect(model.signature.detail.emClass.shareOfMax).toBeNull();
    expect(model.defensive.detail.shieldDownInSec).toBeNull();
  });

  it('uses the cohort median for "Schild weg in"', () => {
    const cohort: RankShipInput[] = Array.from({ length: 8 }, (_, i) => ({
      className: `S${i}`,
      sizeClass: 1,
      career: null,
      sheet: { sustainedDps: 100 * (i + 1) },
    }));
    const withCohort = buildHoloCategoryModels({ occupants, ship, schemaVersion: 3, cohort });
    const shield = withCohort.defensive.detail.panel.shieldHp;
    expect(shield).not.toBeNull();
    expect(withCohort.defensive.detail.shieldDownInSec).toBe(Math.round((shield! / 450) * 10) / 10);
  });
});

describe('buildMovement — quantum range (Reisen lead)', () => {
  it('carries the derived range of the C2 into the Holotisch movement column', () => {
    const ship = { fuelQuantum: 20.9 };
    const qd: SummaryOccupant = {
      section: 'quantum',
      kind: 'component',
      payload: {
        entityKind: 'component',
        kind: 'QuantumDrive',
        className: 'QDRV_JUST_S03_Kama_SCItem',
        stats: { quantum: { 'params.quantumFuelRequirement': 0.03864, jumpRange: 3.4028230607370965e38 } },
      },
      ammoPayload: undefined,
      count: 1,
    };
    const m = buildMovement(ship, computeKpiSheet([qd], ship));
    expect(m.quantumRange! / 1_000_000).toBeCloseTo(541, -1);
  });
});
