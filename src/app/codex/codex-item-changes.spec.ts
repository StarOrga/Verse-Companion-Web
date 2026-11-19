import { describe, expect, it } from 'vitest';
import { curatedStat, diffItemPayloads, higherIsBetter } from './codex-item-changes';

describe('diffItemPayloads', () => {
  it('lists changed curated stats old to new, with the shared label key and unit', () => {
    const before = { weaponParams: { fireRate: 300, heatPerShot: 2, ammoCapacity: 30, ammoClassName: 'x' } };
    const after = { weaponParams: { fireRate: 360, heatPerShot: 3, ammoCapacity: 30, ammoClassName: 'y' } };
    const out = diffItemPayloads(before, after);
    expect(out.map((c) => c.path)).toEqual(['weaponParams.fireRate', 'weaponParams.heatPerShot']);
    expect(out[0]).toMatchObject({ labelKey: 'codex.equipped.fireRate', unit: 'rpm', from: 300, to: 360, tone: 'better' });
    expect(out[1]).toMatchObject({ labelKey: 'codex.detail.changes.stat.heatPerShot', from: 2, to: 3, tone: 'worse' });
  });

  it('drops keys that are not curated instead of showing their raw name', () => {
    const out = diffItemPayloads(
      { stats: { SomeParams: { zzzQuux: 1, internalTuning: 5, health: 10 } } },
      { stats: { SomeParams: { zzzQuux: 2, internalTuning: 6, health: 12 } } },
    );
    expect(out.map((c) => c.path)).toEqual(['stats.SomeParams.health']);
    expect(diffItemPayloads({ zzzQuux: 1 }, { zzzQuux: 2 })).toEqual([]);
  });

  it('is empty for identical payloads and ignores arrays and one-sided stats', () => {
    expect(diffItemPayloads({ mass: 1, l: [1] }, { mass: 1, l: [2] })).toEqual([]);
    expect(diffItemPayloads(null, { mass: 1 })).toEqual([]);
    expect(diffItemPayloads({}, { mass: 2 })).toEqual([]);
  });

  it('reads flat dotted extractor keys and nested damage channels', () => {
    const out = diffItemPayloads(
      { stats: { SCItemVehicleArmorParams: { 'damageMultiplier.DamagePhysical': 0.7 } }, weaponParams: { impactDamage: { physical: 10 } } },
      { stats: { SCItemVehicleArmorParams: { 'damageMultiplier.DamagePhysical': 0.6 } }, weaponParams: { impactDamage: { physical: 12 } } },
    );
    const byKey = Object.fromEntries(out.map((c) => [c.labelKey, c.tone]));
    // Armour lets less through: a lower multiplier is better.
    expect(byKey['codex.detail.changes.stat.taken.physical']).toBe('better');
    expect(byKey['codex.detail.changes.stat.damage.physical']).toBe('better');
  });
});

describe('direction per key', () => {
  it('higher is better for damage, rate of fire, ammo, range, durability, capacity', () => {
    for (const k of ['fireRate', 'ammoCapacity', 'maxRange', 'Health', 'MaxShieldHealth', 'capacity', 'jumpRange']) {
      expect(higherIsBetter([k]), k).toBe(true);
    }
    expect(higherIsBetter(['impactDamage', 'energy'])).toBe(true);
  });

  it('lower is better for mass, spread, recoil, heat, power draw, reload time, delays', () => {
    for (const k of ['mass', 'spread', 'recoil', 'heatPerShot', 'reloadTime', 'DamagedRegenDelay', 'spoolUpTime']) {
      expect(higherIsBetter([k]), k).toBe(false);
    }
    expect(higherIsBetter(['online.power.consumeSegments'])).toBe(false);
  });

  it('is neutral for trade-offs and null for unmapped keys', () => {
    expect(higherIsBetter(['tractorBeam.maxSpeed'])).toBeNull();
    expect(curatedStat(['tractorBeam.maxSpeed'])?.dir).toBe('neutral');
    expect(higherIsBetter(['zzzQuux'])).toBeNull();
    expect(curatedStat(['zzzQuux'])).toBeNull();
    const out = diffItemPayloads({ weaponParams: { tractorBeam: { maxAngle: 10 } } }, { weaponParams: { tractorBeam: { maxAngle: 20 } } });
    expect(out[0].tone).toBe('neutral');
  });

  it('turns a rise into worse for a lower-is-better stat and a drop into better', () => {
    expect(diffItemPayloads({ mass: 2 }, { mass: 3 })[0].tone).toBe('worse');
    expect(diffItemPayloads({ mass: 3 }, { mass: 2 })[0].tone).toBe('better');
  });
});
