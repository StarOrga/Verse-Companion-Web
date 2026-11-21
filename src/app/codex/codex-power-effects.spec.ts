import { computeKpiSheet, buildDefensivePanel, buildOffensivePanel } from './codex-loadout-stats';
import { computePowerSheet, PowerLevels } from './codex-power';
import { applyPowerToOccupants, bandModifier, computePowerEffects, distributeColumn, powerBands } from './codex-power-effects';
import { RESOURCE_STATS_GROUP } from './codex.types';
import type { SummaryOccupant } from './ship-summary-panels';

// LIVE 4.10.3 records (Supabase codex build 27a182e3, read 2026-11-21):
// SHLD_SECO_S01_WEB_SCItem, KLWE_LaserRepeater_S3, POWR_LPLT_S01_IonBurst.
const BANDS = (high: number) => ({
  'online.powerRanges.low.start': 0,
  'online.powerRanges.low.modifier': 0.699999988079071,
  'online.powerRanges.medium.start': 1,
  'online.powerRanges.medium.modifier': 0.8500000238418579,
  'online.powerRanges.high.start': high,
  'online.powerRanges.high.modifier': 1,
});

function shield(count: number): SummaryOccupant {
  return {
    section: 'shields',
    kind: 'component',
    count,
    payload: {
      className: 'SHLD_SECO_S01_WEB_SCItem',
      kind: 'Shield',
      entityKind: 'component',
      stats: {
        [RESOURCE_STATS_GROUP]: {
          stateNames: 'Online',
          'online.power.consumeSegments': 2,
          'online.power.minFraction': 0.5,
          'online.em.nominal': 750,
          ...BANDS(2),
        },
        SCItemShieldGeneratorParams: { MaxShieldHealth: 2160, MaxShieldRegen: 410, DownedRegenDelay: 10 },
      },
    },
  };
}

function reactor(segments: number): SummaryOccupant {
  return {
    section: 'powerPlants',
    kind: 'component',
    count: 1,
    payload: {
      className: 'POWR_LPLT_S01_IonBurst_SCItem',
      kind: 'PowerPlant',
      entityKind: 'component',
      stats: { [RESOURCE_STATS_GROUP]: { stateNames: 'Online', 'online.power.generateSegments': segments } },
    },
  };
}

function repeaters(count: number): SummaryOccupant {
  return {
    section: 'weapons',
    kind: 'weapon',
    count,
    payload: {
      className: 'KLWE_LaserRepeater_S3',
      entityKind: 'weapon',
      stats: { [RESOURCE_STATS_GROUP]: { stateNames: 'Online', 'online.power.consumeUnits': 1, 'online.power.minFraction': 0 } },
      weaponParams: {
        fireRate: 750,
        'regen.maxAmmoLoad': 75,
        'regen.maxRegenPerSec': 15,
        'regen.regenerationCooldown': 0.74,
      },
    },
    ammoPayload: { impactDamage: { energy: 20 } },
  };
}

const sheetFor = (occ: SummaryOccupant[], levels: PowerLevels = {}, cut: string[] = []) =>
  computePowerSheet({ occupants: occ, schemaVersion: 6, levels, cutGroups: cut as never });

describe('power bands (P3)', () => {
  it('reads the live WEB bands and picks the highest start at or below the segments', () => {
    const bands = powerBands(shield(1).payload);
    expect(bands.map((b) => b.start)).toEqual([0, 1, 2]);
    expect(bandModifier(bands, 1)).toBeCloseTo(0.85, 6);
    expect(bandModifier(bands, 2)).toBe(1);
  });
});

describe('distributeColumn (P1)', () => {
  it('seeds every unit with its minimum, then deals the rest round-robin', () => {
    const units = [0, 1, 2].map(() => ({ segments: 2, minimum: 1 }));
    expect(distributeColumn(units, 6)).toEqual([2, 2, 2]);
    expect(distributeColumn(units, 4)).toEqual([2, 1, 1]);
    expect(distributeColumn(units, 3)).toEqual([1, 1, 1]);
    // below the floors: the third generator stays off
    expect(distributeColumn(units, 2)).toEqual([1, 1, 0]);
    expect(distributeColumn(units, 0)).toEqual([0, 0, 0]);
  });
});

describe('applyPowerToOccupants', () => {
  const occ = [reactor(14), shield(3)];

  it('full shield pips leave HP and regen at the stock values', () => {
    const powered = applyPowerToOccupants(occ, sheetFor(occ, { shields: 6 }));
    const kpi = computeKpiSheet(powered, null);
    expect(kpi.shieldHp).toBe(6480);
    expect(kpi.shieldRegen).toBeCloseTo(1230, 3);
  });

  it('at the minimum every generator runs in the 0.85 band — same HP, slower regen', () => {
    const powered = applyPowerToOccupants(occ, sheetFor(occ, { shields: 3 }));
    const kpi = computeKpiSheet(powered, null);
    expect(kpi.shieldHp).toBe(6480);
    expect(kpi.shieldRegen).toBeCloseTo(3 * 410 * 0.85, 1);
  });

  it('below the minimum one generator drops out: HP and regen fall', () => {
    const sheet = sheetFor(occ, { shields: 2 });
    const powered = applyPowerToOccupants(occ, sheet);
    const kpi = computeKpiSheet(powered, null);
    expect(kpi.shieldHp).toBe(4320);
    expect(kpi.shieldRegen).toBeCloseTo(2 * 410 * 0.85, 1);
    const def = buildDefensivePanel(powered, null, 11900);
    expect(def.shieldHp).toBe(4320);
    expect(def.effectiveHp).toBe(11900 + 4320);
    const fx = computePowerEffects(occ, sheet)!;
    expect(fx.occupants[1]!.units.map((u) => u.online)).toEqual([true, true, false]);
  });

  it('fewer weapon pips shrink the capacitor: burst stays, sustained drops', () => {
    const guns = [reactor(14), repeaters(3)];
    const full = computeKpiSheet(applyPowerToOccupants(guns, sheetFor(guns, { weapons: 3 })), null);
    const one = computeKpiSheet(applyPowerToOccupants(guns, sheetFor(guns, { weapons: 1 })), null);
    expect(full.burstDps).not.toBeNull();
    expect(one.burstDps).toBe(full.burstDps);
    expect(one.sustainedDps!).toBeLessThan(full.sustainedDps!);
  });

  it('zero weapon pips take the energy guns offline', () => {
    const guns = [reactor(14), repeaters(3)];
    const off = applyPowerToOccupants(guns, sheetFor(guns, { weapons: 0 }));
    const panel = buildOffensivePanel(off);
    expect(panel.footerDps ?? 0).toBe(0);
  });

  it('without a power sheet the occupants come back untouched', () => {
    expect(applyPowerToOccupants(occ, null)).toBe(occ);
  });
});
