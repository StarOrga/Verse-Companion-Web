import { missionById } from './codex-mission';
import {
  KpiSheet,
  SummaryOccupant,
  buildDefensivePanel,
  buildKpiCells,
  buildOffensivePanel,
  computeKpiDelta,
  computeKpiSheet,
  crossSectionAxes,
  findArmorPayload,
  quantumRangeGm,
} from './codex-loadout-stats';

function gun(opts: {
  className?: string;
  size?: number;
  fireRate?: number;
  damage?: number;
  speed?: number;
  lifetime?: number;
  count?: number;
  section?: 'weapons' | 'remoteTurrets';
  cycle?: Record<string, number>;
}): SummaryOccupant {
  return {
    section: opts.section ?? 'weapons',
    kind: 'weapon',
    payload: {
      entityKind: 'weapon',
      className: opts.className ?? 'KLWE_LaserRepeater_S3',
      size: opts.size ?? 3,
      weaponParams: { ...(opts.fireRate != null ? { fireRate: opts.fireRate } : {}), ...(opts.cycle ?? {}) },
    },
    ammoPayload: {
      impactDamage: { physical: opts.damage ?? 40 },
      speed: opts.speed,
      lifetime: opts.lifetime,
    },
    count: opts.count ?? 1,
  };
}

function missile(opts: { className?: string; size?: number; damage?: number; lockTime?: number; range?: number }): SummaryOccupant {
  return {
    section: 'missiles',
    kind: 'item',
    payload: {
      entityKind: 'item',
      className: opts.className ?? 'MISL_S02_IR_NOVP_Rattler',
      attachType: 'Missile',
      subType: 'Missile',
      size: opts.size ?? 2,
      stats: {
        SCItemMissileParams: {
          ...(opts.damage != null ? { 'explosionParams.damage.DamagePhysical': opts.damage } : {}),
          ...(opts.lockTime != null ? { 'targetingParams.lockTime': opts.lockTime } : {}),
          ...(opts.range != null ? { 'targetingParams.lockRangeMax': opts.range } : {}),
        },
      },
    },
    count: 1,
  };
}

function shield(opts: { hp?: number; regen?: number; delayDamaged?: number; delayDowned?: number; className?: string; count?: number }): SummaryOccupant {
  return {
    section: 'shields',
    kind: 'component',
    payload: {
      entityKind: 'component',
      kind: 'Shield',
      className: opts.className ?? 'AEGS_ShieldGenerator_S1',
      stats: {
        SCItemShieldGeneratorParams: {
          MaxShieldHealth: opts.hp ?? 1000,
          MaxShieldRegen: opts.regen ?? 50,
          DamagedRegenDelay: opts.delayDamaged ?? 3,
          DownedRegenDelay: opts.delayDowned ?? 5,
        },
      },
    },
    ammoPayload: undefined,
    count: opts.count ?? 1,
  };
}

describe('codex-loadout-stats — computeKpiSheet', () => {
  it('sums alpha and DPS across all fitted guns, once a fireRate is present', () => {
    const sheet = computeKpiSheet(
      [gun({ damage: 40, fireRate: 60 }), gun({ damage: 40, fireRate: 60 })],
      null,
    );
    expect(sheet.alpha).toBe(80);
    expect(sheet.burstDps).toBe(80); // 40dmg * 60rpm/60s * 2 guns
  });

  it('sustained DPS counts the energy regen pause, never copies burst (#343)', () => {
    // 60 rpm = 1 shot/s, pool 10 → 10 s firing; 0.5 s cooldown + 10/2 = 5 s refill.
    const cycle = { 'regen.maxAmmoLoad': 10, 'regen.requestedRegenPerSec': 2, 'regen.regenerationCooldown': 0.5 };
    const sheet = computeKpiSheet(
      [gun({ damage: 40, fireRate: 60, cycle }), gun({ damage: 40, fireRate: 60, cycle })],
      null,
    );
    expect(sheet.burstDps).toBe(80);
    expect(sheet.sustainedDps).toBeCloseTo(80 * 10 / 15.5, 1); // 51.61
  });

  it('leaves sustained DPS a gap when one gun has no known fire cycle', () => {
    const cycle = { 'regen.maxAmmoLoad': 10, 'regen.requestedRegenPerSec': 2 };
    const sheet = computeKpiSheet([gun({ damage: 40, fireRate: 60, cycle }), gun({ damage: 40, fireRate: 60 })], null);
    expect(sheet.burstDps).toBe(80);
    expect(sheet.sustainedDps).toBeNull();
  });

  it('leaves DPS a gap when no gun carries a fireRate, but keeps alpha', () => {
    const sheet = computeKpiSheet([gun({ damage: 40 })], null);
    expect(sheet.alpha).toBe(40);
    expect(sheet.sustainedDps).toBeNull();
  });

  it('never invents hull HP, cargo or effective HP', () => {
    const sheet = computeKpiSheet([], null);
    expect(sheet.hullHp).toBeNull();
    expect(sheet.cargo).toBeNull();
    expect(sheet.effectiveHp).toBeNull();
  });

  it('sums shield HP/regen across fitted generators', () => {
    const sheet = computeKpiSheet([shield({ hp: 1000, regen: 50 }), shield({ hp: 500, regen: 20 })], null);
    expect(sheet.shieldHp).toBe(1500);
    expect(sheet.shieldRegen).toBe(70);
  });

  it('reads scm/max speed straight from ship.flight', () => {
    const sheet = computeKpiSheet([], { flight: { scmSpeed: 180, maxSpeed: 700 } });
    expect(sheet.scm).toBe(180);
    expect(sheet.maxSpeed).toBe(700);
  });

  it('takes the MAXIMUM of the three cross-section axes as the KPI value (Nomad-shaped fixture)', () => {
    const sheet = computeKpiSheet([], {
      stats: {
        SSCSignatureSystemParams: {
          'crossSection.x': 6604.0,
          'crossSection.y': 3302.0,
          'crossSection.z': 9712.0,
        },
      },
    });
    expect(sheet.crossSection).toBe(9712.0);
  });

  it('never invents ship IR/EM — the extract carries no scalar field for them', () => {
    const sheet = computeKpiSheet([], {
      stats: { SSCSignatureSystemParams: { 'crossSection.x': 1, 'crossSection.y': 1, 'crossSection.z': 1 } },
    });
    expect(sheet.ir).toBeNull();
    expect(sheet.emIdle).toBeNull();
    expect(sheet.emLoad).toBeNull();
  });
});

describe('codex-loadout-stats — crossSectionAxes', () => {
  it('exposes all three axes for the Schiff panel, independent of the KPI max', () => {
    const axes = crossSectionAxes({
      SSCSignatureSystemParams: {
        'crossSection.x': 6604.0,
        'crossSection.y': 3302.0,
        'crossSection.z': 9712.0,
      },
    });
    expect(axes).toEqual({ x: 6604.0, y: 3302.0, z: 9712.0 });
  });

  it('returns nulls, never invented zeros, when the struct is absent', () => {
    expect(crossSectionAxes(undefined)).toEqual({ x: null, y: null, z: null });
    expect(crossSectionAxes({})).toEqual({ x: null, y: null, z: null });
  });
});

describe('codex-loadout-stats — computeKpiDelta (03-rules §3.5)', () => {
  it('renders nothing for an exact ±0 change', () => {
    expect(computeKpiDelta('shieldHp', 1000, 1000)).toBeNull();
  });

  it('renders nothing when either side is a gap', () => {
    expect(computeKpiDelta('shieldHp', null, 1000)).toBeNull();
    expect(computeKpiDelta('shieldHp', 1000, null)).toBeNull();
  });

  it('drops the % suffix under 0.5% relative change but still reports direction', () => {
    const delta = computeKpiDelta('shieldHp', 10000, 10040); // 0.4%
    expect(delta).not.toBeNull();
    expect(delta!.direction).toBe('up');
    expect(delta!.pctText).toBeNull();
  });

  it('keeps the % suffix at/above 0.5%', () => {
    const delta = computeKpiDelta('shieldHp', 1000, 1010); // 1%
    expect(delta!.pctText).toBe('+1%');
  });

  it('flags mass DOWN as the good direction (03-rules: mass down=better)', () => {
    const lighter = computeKpiDelta('mass', 1000, 900);
    expect(lighter!.direction).toBe('down');
    expect(lighter!.good).toBe(true);

    const heavier = computeKpiDelta('mass', 1000, 1100);
    expect(heavier!.direction).toBe('up');
    expect(heavier!.good).toBe(false);
  });

  it('flags shieldHp UP as good (the default direction)', () => {
    const stronger = computeKpiDelta('shieldHp', 1000, 1100);
    expect(stronger!.good).toBe(true);
  });
});

describe('codex-loadout-stats — buildKpiCells', () => {
  const sheet = (over: Partial<KpiSheet> = {}): KpiSheet => ({
    alpha: null,
    burstDps: null,
    sustainedDps: null,
    missiles: null,
    shieldHp: null,
    shieldRegen: null,
    hullHp: null,
    effectiveHp: null,
    cargo: null,
    mass: null,
    boost: null,
    agility: null,
    armorHp: null,
    scm: null,
    maxSpeed: null,
    quantumSpeed: null,
    quantumRange: null,
    spool: null,
    ir: null,
    emIdle: null,
    emLoad: null,
    emMax: null,
    emQuantum: null,
    crossSection: null,
    ...over,
  });

  it('emits exactly six cells for combat, the first one accented', () => {
    const cells = buildKpiCells(missionById('combat'), sheet(), sheet({ alpha: 100 }));
    expect(cells.length).toBe(6);
    expect(cells[0].key).toBe('alpha');
    expect(cells[0].accent).toBe(true);
    expect(cells.slice(1).every((c) => !c.accent)).toBe(true);
  });

  it('names the gap key when a mission KPI has no value', () => {
    const cells = buildKpiCells(missionById('travel'), sheet(), sheet());
    const quantumRangeCell = cells.find((c) => c.key === 'quantumRange')!;
    expect(quantumRangeCell.value).toBeNull();
    expect(quantumRangeCell.gapKey).toBe('codex.summary.gap.noQuantum');
  });

  it('carries a real delta from stock to current for the same KPI', () => {
    const cells = buildKpiCells(missionById('combat'), sheet({ shieldHp: 1000 }), sheet({ shieldHp: 1200 }));
    const shieldCell = cells.find((c) => c.key === 'shieldHp')!;
    expect(shieldCell.delta?.direction).toBe('up');
    expect(shieldCell.delta?.good).toBe(true);
  });
});

describe('codex-loadout-stats — buildOffensivePanel', () => {
  it('omits the missile section entirely when nothing is fitted', () => {
    const panel = buildOffensivePanel([gun({})]);
    expect(panel.missileCount).toBe(0);
    expect(panel.missileSalvoDamage).toBeNull();
  });

  // feedback #350: the warhead lives in SCItemMissileParams, not in an impact record
  it('reads every carried missile, collapses identical ones and sums the salvo', () => {
    const rack: SummaryOccupant = {
      section: 'missiles',
      kind: 'weapon',
      payload: { entityKind: 'weapon', className: 'MRCK_S04_CNOU_Quad_S02', attachType: 'MissileLauncher', size: 4 },
      count: 1,
    };
    const panel = buildOffensivePanel([
      gun({}),
      rack,
      missile({ className: 'MISL_S02_IR_NOVP_Rattler', size: 2, damage: 1370, lockTime: 2.5, range: 5000 }),
      missile({ className: 'MISL_S02_IR_NOVP_Rattler', size: 2, damage: 1370, lockTime: 2.5, range: 5000 }),
      missile({ className: 'MISL_S03_CS_FSKI_Tempest', size: 3, damage: 2500, lockTime: 3, range: 7000 }),
    ]);
    expect(panel.missileCount).toBe(3);
    expect(panel.missileRows).toEqual([
      { className: 'MISL_S03_CS_FSKI_Tempest', size: 3, category: 'missile', signal: 'cs', count: 1, damage: 2500, totalDamage: 2500 },
      { className: 'MISL_S02_IR_NOVP_Rattler', size: 2, category: 'missile', signal: 'ir', count: 2, damage: 1370, totalDamage: 2740 },
    ]);
    expect(panel.missileSalvoDamage).toBe(5240);
    expect(panel.missileSalvoPartial).toBe(false);
    expect(panel.missileLockTime).toBe(3);
    expect(panel.missileRange).toBe(5000);
    expect(panel.missileSignalTypes.sort()).toEqual(['cs', 'ir']);
    // guns stay guns: the salvo never lands in the gun alpha
    expect(panel.footerAlpha).toBe(40);
  });

  it('counts missiles without warhead data but leaves them out of the salvo', () => {
    const panel = buildOffensivePanel([
      missile({ className: 'MISL_S02_IR_NOVP_Rattler', size: 2, damage: 1370 }),
      missile({ className: 'MISL_S02_EM_TALN_Dominator' }),
    ]);
    expect(panel.missileCount).toBe(2);
    expect(panel.missileSalvoDamage).toBe(1370);
    expect(panel.missileSalvoPartial).toBe(true);
    expect(panel.missileRows.find((r) => r.signal === 'em')?.damage).toBeNull();

    const bare = buildOffensivePanel([missile({ className: 'MISL_S02_EM_TALN_Dominator' })]);
    expect(bare.missileCount).toBe(1);
    expect(bare.missileSalvoDamage).toBeNull();
    expect(bare.missileSalvoPartial).toBe(false);
  });

  it('feeds the missile KPI from the same warhead figure', () => {
    const sheet = computeKpiSheet([missile({ damage: 1370 }), missile({ damage: 1370 })], null);
    expect(sheet.missiles).toBe(2740);
  });

  it('takes the MINIMUM range across guns as the effective range, noting the outlier', () => {
    const panel = buildOffensivePanel([
      gun({ className: 'ShortGun', speed: 1000, lifetime: 1 }), // 1000m
      gun({ className: 'LongGun', speed: 1000, lifetime: 2 }), // 2000m
    ]);
    expect(panel.effectiveRange).toBe(1000);
    expect(panel.longestRangeGun).toBe('LongGun');
  });

  it('flags a mixed-range warning only once the longest gun exceeds 115% of the effective range', () => {
    const justUnder = buildOffensivePanel([
      gun({ className: 'A', speed: 1000, lifetime: 1 }), // 1000
      gun({ className: 'B', speed: 1000, lifetime: 1.1 }), // 1100 = 110%
    ]);
    expect(justUnder.mixedRangeWarning).toBe(false);

    const over = buildOffensivePanel([
      gun({ className: 'A', speed: 1000, lifetime: 1 }), // 1000
      gun({ className: 'B', speed: 1000, lifetime: 1.2 }), // 1200 = 120%
    ]);
    expect(over.mixedRangeWarning).toBe(true);
  });

  it('takes the MINIMUM projectile speed across guns', () => {
    const panel = buildOffensivePanel([
      gun({ className: 'Slow', speed: 800, lifetime: 1 }),
      gun({ className: 'Fast', speed: 1600, lifetime: 1 }),
    ]);
    expect(panel.projectileSpeed).toBe(800);
  });

  it('reports the noStockGuns gap when nothing resolves to a real gun', () => {
    const panel = buildOffensivePanel([]);
    expect(panel.gapKeys).toContain('codex.summary.gap.noStockGuns');
  });
});

describe('codex-loadout-stats — buildDefensivePanel', () => {
  it('sums HP/regen across ALL fitted generators (active/passive split is cut)', () => {
    const panel = buildDefensivePanel([shield({ hp: 1000, regen: 50 }), shield({ hp: 500, regen: 20 })], null);
    expect(panel.shieldHp).toBe(1500);
    expect(panel.shieldRegen).toBe(70);
  });

  it('reads delay figures from the STRONGEST generator', () => {
    const panel = buildDefensivePanel(
      [
        shield({ hp: 2000, regen: 50, delayDamaged: 4, delayDowned: 6 }),
        shield({ hp: 500, regen: 20, delayDamaged: 1, delayDowned: 2 }),
      ],
      null,
    );
    expect(panel.regenDelay).toBe(4);
    expect(panel.downedDelay).toBe(6);
  });

  it('flags a mixed-generator note when more than one distinct class is fitted', () => {
    const mixed = buildDefensivePanel(
      [shield({ className: 'A_Shield_S1' }), shield({ className: 'B_Shield_S1' })],
      null,
    );
    expect(mixed.mixedGeneratorNote).toBe(true);

    const uniform = buildDefensivePanel(
      [shield({ className: 'A_Shield_S1' }), shield({ className: 'A_Shield_S1' })],
      null,
    );
    expect(uniform.mixedGeneratorNote).toBe(false);
  });

  it('names the hull-HP gap only on an extract without hull HP', () => {
    const panel = buildDefensivePanel([shield({})], null);
    expect(panel.hullHp).toBeNull();
    expect(panel.effectiveHp).toBeNull();
    expect(panel.gapKeys).toContain('codex.summary.gap.noHullMass');
  });

  it('takes the hull HP from the ship payload and adds the shields for effective HP', () => {
    const panel = buildDefensivePanel([shield({ hp: 1000, regen: 50 })], null, 84200);
    expect(panel.hullHp).toBe(84200);
    expect(panel.effectiveHp).toBe(85200);
    expect(panel.gapKeys).not.toContain('codex.summary.gap.noHullMass');
    // No shield: the hull is known, the effective sum is not.
    expect(buildDefensivePanel([], null, 84200).effectiveHp).toBeNull();
  });

  it('computes armor reduction % as (1 - multiplier) when the extract carries it', () => {
    // Real key names, VERIFIED against the live `ARMR_CNOU_Nomad` projection
    // (dataforge_extract.py `_component_stats`/`_add_vehicle_armor_depth2`).
    const armorPayload = {
      className: 'ARMR_Test_S1',
      stats: {
        SCItemVehicleArmorParams: {
          'damageMultiplier.DamagePhysical': 0.7,
          'damageMultiplier.DamageEnergy': 0.85,
        },
      },
    };
    const panel = buildDefensivePanel([], armorPayload);
    expect(panel.armor?.reductionPhysicalPct).toBeCloseTo(30, 5);
    expect(panel.armor?.reductionEnergyPct).toBeCloseTo(15, 5);
    expect(panel.gapKeys).not.toContain('codex.summary.gap.noArmorStats');
  });

  it('passes penetration/deflection through as absolute values, not multipliers', () => {
    const armorPayload = {
      className: 'ARMR_Test_S1',
      stats: {
        SCItemVehicleArmorParams: {
          'armorPenetrationResistance.basePenetrationReduction': 0.2,
          'armorDeflection.deflectionValue.DamagePhysical': 10.0,
          'armorDeflection.deflectionValue.DamageEnergy': 9.0,
        },
      },
    };
    const panel = buildDefensivePanel([], armorPayload);
    // NOT run through (1 - x) * 100 — these are absolute numbers already.
    expect(panel.armor?.penetrationReduction).toBe(0.2);
    expect(panel.armor?.deflectionPhysical).toBe(10.0);
    expect(panel.armor?.deflectionEnergy).toBe(9.0);
    expect(panel.gapKeys).not.toContain('codex.summary.gap.noArmorStats');
  });

  it('names the armor gap with the exact spec sentence key when the extract has no armor stats', () => {
    const panel = buildDefensivePanel([], null);
    expect(panel.gapKeys).toContain('codex.summary.gap.noArmorStats');
  });

  it('finds the ship ARMR_ item among resolved occupants by className prefix', () => {
    const occ: SummaryOccupant = {
      section: 'structure',
      kind: 'item',
      payload: { className: 'ARMR_Nomad_S1' },
      ammoPayload: undefined,
      count: 1,
    };
    expect(findArmorPayload([occ])).toEqual(occ.payload);
    expect(findArmorPayload([])).toBeNull();
  });
});

const FLT_MAX = 3.4028230607370965e38;

function drive(fuelRequirement: number, jumpRange: number = FLT_MAX): SummaryOccupant {
  return {
    section: 'quantum',
    kind: 'component',
    payload: {
      entityKind: 'component',
      kind: 'QuantumDrive',
      className: 'QDRV_TEST',
      stats: { quantum: { 'params.quantumFuelRequirement': fuelRequirement, 'params.driveSpeed': 392090592, jumpRange } },
    },
    ammoPayload: undefined,
    count: 1,
  };
}

describe('codex-loadout-stats — quantum range from fuel and drive use', () => {
  it('reproduces the published 4.10 ranges (SCU ÷ SCU per Gm)', () => {
    // C2 Hercules, 20.9 SCU, stock Kama 0.03864 -> 541 Gm; Gladius, 0.6 SCU, Beacon 0.01862 -> 32 Gm.
    expect(quantumRangeGm(20.9, 0.03864)!).toBeCloseTo(541, -1);
    expect(quantumRangeGm(0.6, 0.01862)!).toBeCloseTo(32, 0);
  });

  it('is a gap, never a guess, without both inputs', () => {
    expect(quantumRangeGm(null, 0.03864)).toBeNull();
    expect(quantumRangeGm(20.9, undefined)).toBeNull();
    expect(quantumRangeGm(0, 0.03864)).toBeNull();
    expect(quantumRangeGm(20.9, 0)).toBeNull();
    expect(quantumRangeGm(Number.NaN, 0.03864)).toBeNull();
  });

  it('fills the KPI sheet in the km unit the Gm formatter expects, ignoring the FLT_MAX jumpRange', () => {
    const sheet = computeKpiSheet([drive(0.03864)], { fuelQuantum: 20.9 });
    expect(sheet.quantumRange! / 1_000_000).toBeCloseTo(541, -1);
  });

  it('follows a swapped drive (the Werk comparison)', () => {
    const stock = computeKpiSheet([drive(0.03864)], { fuelQuantum: 20.9 }).quantumRange!;
    const swapped = computeKpiSheet([drive(0.12236)], { fuelQuantum: 20.9 }).quantumRange!;
    expect(swapped).toBeLessThan(stock);
    expect(swapped / 1_000_000).toBeCloseTo(170.8, 0);
  });

  it('stays empty without a tank, and falls back to a real finite jumpRange only', () => {
    expect(computeKpiSheet([drive(0.03864)], {}).quantumRange).toBeNull();
    expect(computeKpiSheet([drive(0.03864, 583_000_000)], {}).quantumRange).toBe(583_000_000);
  });
});
