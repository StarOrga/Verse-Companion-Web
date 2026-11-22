import { alphaDamage } from './codex-equipped-stats';
import {
  applyCraftMultipliers,
  craftMultipliers,
  overallQuality,
  parseCraftRecipe,
  rangeModifier,
} from './codex-crafting';
import type { SummaryOccupant } from './ship-summary-panels';

// Trimmed from LIVE 4.10.3 `BP_CRAFT_KLWE_LaserRepeater_S3` (codex_blueprints.payload).
const range = (gpp: string, a: number, b: number) => ({
  _Type_: 'CraftingCostContext_ResultGameplayPropertyModifiers',
  gameplayPropertyModifiers: {
    gameplayPropertyModifiers: [
      {
        valueRanges: [{ _Type_: 'CraftingGameplayPropertyModifierValueRange_Linear', startQuality: 0, endQuality: 1000, modifierAtStart: a, modifierAtEnd: b }],
        gameplayPropertyRecord: { _RecordName_: `CraftingGameplayPropertyDef.GPP_${gpp}` },
      },
    ],
  },
});
const PANTHER_BP = {
  className: 'BP_CRAFT_KLWE_LaserRepeater_S3',
  outputs: [{ className: 'KLWE_LaserRepeater_S3' }],
  raw: {
    blueprint: {
      tiers: [
        {
          recipe: {
            costs: {
              mandatoryCost: {
                options: [
                  {
                    nameInfo: { debugName: 'REINFORCED FRAME', displayName: '@crafting_ui_slotname_reinforcedframe' },
                    context: [range('Health_MaxHealth', 0.8999999761581421, 1.100000023841858)],
                    options: [{ _Type_: 'CraftingCost_Resource', resource: { _RecordName_: 'ResourceType.Agricium' }, quantity: { standardCargoUnits: 1.16 } }],
                  },
                  {
                    nameInfo: { debugName: 'EMITTER' },
                    context: [range('Weapon_Damage', 0.949999988079071, 1.0499999523162842)],
                    options: [{ _Type_: 'CraftingCost_Item', entityClass: { _RecordName_: 'EntityClassDefinition.Harvestable_Mineral_1H_Hadanite' }, quantity: 23 }],
                  },
                  {
                    nameInfo: { debugName: 'THERMAL SINK' },
                    context: [range('Weapon_Damage', 0.949999988079071, 1.0499999523162842)],
                    options: [{ _Type_: 'CraftingCost_Resource', resource: { _RecordName_: 'ResourceType.Pressurized_Ice' }, quantity: { standardCargoUnits: 0.46 } }],
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

const gun = (): SummaryOccupant => ({
  section: 'weapons',
  kind: 'weapon',
  count: 1,
  payload: {
    className: 'KLWE_LaserRepeater_S3',
    weaponParams: { fireRate: 750 },
    stats: { SHealthComponentParams: { Health: 1500 } },
  },
  ammoPayload: { impactDamage: { energy: 43.65, physical: null } },
});

describe('codex-crafting', () => {
  const recipe = parseCraftRecipe(PANTHER_BP)!;

  it('reads the three slots, their materials and their ranges', () => {
    expect(recipe.outputClassName).toBe('KLWE_LaserRepeater_S3');
    expect(recipe.slots.map((s) => s.name)).toEqual(['REINFORCED FRAME', 'EMITTER', 'THERMAL SINK']);
    expect(recipe.slots[0].ingredients[0]).toEqual({ className: 'Agricium', quantity: 1.16, unit: 'scu' });
    expect(recipe.slots[1].ingredients[0]).toEqual({ className: 'Harvestable_Mineral_1H_Hadanite', quantity: 23, unit: 'count' });
    expect(recipe.slots[1].ranges[0].stat).toBe('Weapon_Damage');
  });

  it('is linear over 0 … 1000 with ±0 % at 500', () => {
    const r = recipe.slots[0].ranges[0];
    expect(rangeModifier(r, 0)).toBeCloseTo(0.9, 6);
    expect(rangeModifier(r, 500)).toBeCloseTo(1, 6);
    expect(rangeModifier(r, 1000)).toBeCloseTo(1.1, 6);
    expect(rangeModifier(r, 2000)).toBeCloseTo(1.1, 6);
  });

  it('multiplies two slots that scale the same stat', () => {
    const m = craftMultipliers(recipe, [500, 1000, 1000]);
    expect(m.get('Weapon_Damage')!).toBeCloseTo(1.05 * 1.05, 5);
    expect(m.get('Health_MaxHealth')!).toBeCloseTo(1, 6);
  });

  it('lands on the fields the page reads: alpha, health', () => {
    const crafted = applyCraftMultipliers(gun(), craftMultipliers(recipe, [1000, 1000, 1000]));
    expect(alphaDamage(crafted.ammoPayload)!).toBeCloseTo(43.65 * 1.05 * 1.05, 3);
    expect((crafted.payload as { stats: Record<string, Record<string, number>> }).stats['SHealthComponentParams']['Health']).toBeCloseTo(1650, 2);
    const stock = applyCraftMultipliers(gun(), craftMultipliers(recipe, [500, 500, 500]));
    expect(alphaDamage(stock.ammoPayload)!).toBeCloseTo(43.65, 3);
  });

  it('reports the mean quality of the slots', () => {
    expect(overallQuality([1000, 500, 0], 3)).toBe(500);
    expect(overallQuality([], 3)).toBe(500);
  });

  it('returns null for a payload without a recipe', () => {
    expect(parseCraftRecipe({ raw: {} })).toBeNull();
  });
});
