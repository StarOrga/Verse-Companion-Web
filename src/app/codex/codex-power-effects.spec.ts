import { computeKpiSheet, buildDefensivePanel, buildOffensivePanel } from './codex-loadout-stats';
import { computePowerSheet, PowerLevels, withReserveShields } from './codex-power';
import { applyPowerToOccupants, poweredPayloadQueues, bandModifier, computePowerEffects, distributeColumn, powerBands } from './codex-power-effects';
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

describe('quantum drive: all or nothing', () => {
  const qd = (): SummaryOccupant => ({
    section: 'quantum',
    kind: 'component',
    count: 1,
    payload: {
      className: 'QDRV_TEST',
      kind: 'QuantumDrive',
      entityKind: 'component',
      stats: { [RESOURCE_STATS_GROUP]: { stateNames: 'Online', 'online.power.consumeSegments': 2, 'online.power.minFraction': 0.5 } },
    },
  });
  it('never runs at 1 of 2 segments in NAV, whatever the pin', () => {
    const occ = [reactor(14), qd()];
    for (const level of [1, 2]) {
      const sheet = computePowerSheet({ occupants: occ, schemaVersion: 6, mode: 'nav', levels: { quantum: level } });
      expect(sheet.groups.find((g) => g.key === 'quantum')!.allocated).toBe(2);
    }
    const tight = computePowerSheet({ occupants: [reactor(1), qd()], schemaVersion: 6, mode: 'nav' });
    expect(tight.groups.find((g) => g.key === 'quantum')!.allocated).not.toBe(1);
  });
});

describe('withReserveShields', () => {
  it('keeps two generators active, the rest reserve', () => {
    const marked = withReserveShields([shield(3)]);
    expect(marked.map((o) => o.passive === true)).toEqual([false, false, true]);
  });
  it('leaves a two-generator ship alone', () => {
    const two = [shield(1), shield(1)];
    expect(withReserveShields(two)).toBe(two);
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
  // The live Nomad: three WEB generators, two run, the third is reserve.
  const occ = [reactor(14), shield(3)];

  it('runs two generators and keeps the third as pool HP only (erkul: 6 480 HP, 820/s)', () => {
    const sheet = sheetFor(occ, { shields: 4 });
    expect(sheet.groups.find((g) => g.key === 'shields')!.capacity).toBe(4);
    const kpi = computeKpiSheet(applyPowerToOccupants(occ, sheet), null);
    expect(kpi.shieldHp).toBe(6480);
    expect(kpi.shieldRegen).toBeCloseTo(820, 3);
  });

  it('at the minimum both active generators run in the 0.85 band — same HP, slower regen', () => {
    const kpi = computeKpiSheet(applyPowerToOccupants(occ, sheetFor(occ, { shields: 2 })), null);
    expect(kpi.shieldHp).toBe(6480);
    expect(kpi.shieldRegen).toBeCloseTo(2 * 410 * 0.85, 1);
  });

  it('below the minimum only that generator drops out: HP and regen fall', () => {
    const sheet = sheetFor(occ, { shields: 1 });
    const powered = applyPowerToOccupants(occ, sheet);
    const kpi = computeKpiSheet(powered, null);
    expect(kpi.shieldHp).toBe(4320); // one active + the reserve
    expect(kpi.shieldRegen).toBeCloseTo(410 * 0.85, 1);
    const def = buildDefensivePanel(powered, null, 11900);
    expect(def.shieldHp).toBe(4320);
    expect(def.effectiveHp).toBe(11900 + 4320);
  });

  it('queues one powered payload per hardpoint for the loadout cards', () => {
    const q = poweredPayloadQueues(occ, sheetFor(occ, { shields: 1 })).get('SHLD_SECO_S01_WEB_SCItem')!;
    const read = (p: unknown, f: string) =>
      (p as { stats: Record<string, Record<string, number>> }).stats['SCItemShieldGeneratorParams'][f];
    expect(q.map((p) => read(p.payload, 'MaxShieldHealth'))).toEqual([2160, 0, 2160]);
    expect(q.map((p) => read(p.payload, 'MaxShieldRegen'))[2]).toBe(0); // the reserve never regenerates
  });

  it('fewer weapon pips shrink the capacitor: burst stays, sustained drops', () => {
    const guns = [reactor(14), repeaters(3)];
    const full = computeKpiSheet(applyPowerToOccupants(guns, sheetFor(guns, { weapons: 3 })), null);
    const one = computeKpiSheet(applyPowerToOccupants(guns, sheetFor(guns, { weapons: 1 })), null);
    expect(full.burstDps).not.toBeNull();
    expect(one.burstDps).toBe(full.burstDps);
    expect(one.sustainedDps!).toBeLessThan(full.sustainedDps!);
  });

  it('splits the damage by source: the pilot holds all three repeaters', () => {
    const panel = buildOffensivePanel([repeaters(3)]);
    expect(panel.sources.map((s) => s.key)).toEqual(['pilot', 'remoteTurrets', 'mannedTurrets']);
    expect(panel.sources[0].weapons).toBe(3);
    expect(panel.sources[0].alpha).toBeCloseTo(60, 6);
    expect(panel.sources[0].burstDps).toBeCloseTo(panel.footerDps!, 6);
    expect(panel.sources[1].weapons).toBe(0);
    expect(panel.sources[1].alpha).toBeNull();
  });

  it('zero weapon pips take the energy guns offline', () => {
    const guns = [reactor(14), repeaters(3)];
    const off = applyPowerToOccupants(guns, sheetFor(guns, { weapons: 0 }));
    const panel = buildOffensivePanel(off);
    expect(panel.footerDps ?? 0).toBe(0);
  });

  it('without a power sheet only the reserve rule applies', () => {
    const guns = [reactor(14), repeaters(3)];
    expect(applyPowerToOccupants(guns, null)).toBe(guns);
    const kpi = computeKpiSheet(applyPowerToOccupants(occ, null), null);
    expect(kpi.shieldRegen).toBeCloseTo(820, 3);
  });
});
