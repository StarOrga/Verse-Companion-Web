// Crafting quality — what a crafted component's quality does to its stats.
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE. Source: the blueprint record the extractor stores raw
// under `codex_blueprints.payload.raw` (LIVE 4.10.3, 1 632 blueprints, 497 of
// them for ship weapons and components). Every recipe slot is a
// `CraftingCost_Select` whose `context` carries the stats that slot's material
// quality scales:
//
//   CraftingGameplayPropertyModifierValueRange_Linear
//     startQuality 0 → modifierAtStart 0.9
//     endQuality 1000 → modifierAtEnd 1.1        (Panther frame → max health)
//
//   modifier(q) = start + (end − start) × (q − qStart) / (qEnd − qStart)
//
// Quality 500 is the middle of the range, ±0 % on every symmetric slot. Several
// slots may scale the same stat (the Panther's emitter AND thermal sink both
// scale weapon damage): their modifiers multiply. A stock item is NOT crafted —
// the page applies a modifier only where the pilot set a quality.

import { toFiniteNumber } from '../hangar/loadout-stats';
import type { SummaryOccupant } from './ship-summary-panels';

/** Lowest / highest quality the recipes use (all 1 632 records: 0 … 1000). */
export const CRAFT_QUALITY_MIN = 0;
export const CRAFT_QUALITY_MAX = 1000;
/** The neutral middle: ±0 % on every symmetric range. */
export const CRAFT_QUALITY_DEFAULT = 500;
/** The quick picks of the dialog. */
export const CRAFT_QUALITY_PRESETS: readonly number[] = [0, 500, 750, 900, 1000];

/** The gameplay properties a ship item can carry (`GPP_` stripped). */
export type CraftStat =
  | 'Weapon_Damage'
  | 'Weapon_FireRate'
  | 'Health_MaxHealth'
  | 'Shield_MaxHealth'
  | 'ItemResource_CoolantGeneration'
  | 'ItemResource_PowerGeneration'
  | 'Radar_MinAimAssistDistance'
  | 'Radar_MaxAimAssistDistance'
  | 'Quantum_Speed'
  | 'Quantum_FuelRequirement'
  | 'Weapon_Tractor_Force'
  | 'Weapon_Tractor_MaxDist'
  | 'Weapon_Tractor_FullStrengthDist'
  | 'Weapon_Tractor_MaxVolume'
  | string;

export interface CraftRange {
  stat: CraftStat;
  startQuality: number;
  endQuality: number;
  modifierAtStart: number;
  modifierAtEnd: number;
}

export interface CraftIngredient {
  /** resource or item class name (`Agricium`, `Harvestable_Mineral_1H_Hadanite`). */
  className: string;
  /** SCU for a resource, a count for an item. */
  quantity: number | null;
  unit: 'scu' | 'count';
}

export interface CraftSlot {
  /** the recipe slot (`REINFORCED FRAME`) — data, shown as written. */
  name: string;
  /** game loc key of the slot name, when present. */
  nameKey: string | null;
  ingredients: CraftIngredient[];
  ranges: CraftRange[];
}

export interface CraftRecipe {
  blueprintClassName: string;
  outputClassName: string | null;
  slots: CraftSlot[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function recordStat(ref: unknown): string | null {
  const name = isObj(ref) ? ref['_RecordName_'] : null;
  if (typeof name !== 'string') return null;
  const m = /GPP_(\w+)$/.exec(name);
  return m ? m[1] : null;
}

function resourceName(ref: unknown): string | null {
  const name = isObj(ref) ? ref['_RecordName_'] : null;
  if (typeof name !== 'string') return null;
  return name.replace(/^ResourceType\./, '').replace(/^EntityClassDefinition\./, '');
}

function parseRanges(context: unknown[]): CraftRange[] {
  const out: CraftRange[] = [];
  for (const c of context) {
    if (!isObj(c)) continue;
    const list = isObj(c['gameplayPropertyModifiers']) ? arr(c['gameplayPropertyModifiers']['gameplayPropertyModifiers']) : [];
    for (const m of list) {
      if (!isObj(m)) continue;
      const stat = recordStat(m['gameplayPropertyRecord']);
      if (!stat) continue;
      for (const r of arr(m['valueRanges'])) {
        if (!isObj(r)) continue;
        const startQuality = toFiniteNumber(r['startQuality']);
        const endQuality = toFiniteNumber(r['endQuality']);
        const modifierAtStart = toFiniteNumber(r['modifierAtStart']);
        const modifierAtEnd = toFiniteNumber(r['modifierAtEnd']);
        if (startQuality === null || endQuality === null || modifierAtStart === null || modifierAtEnd === null) continue;
        if (endQuality <= startQuality) continue;
        out.push({ stat, startQuality, endQuality, modifierAtStart, modifierAtEnd });
      }
    }
  }
  return out;
}

function parseIngredient(o: unknown): CraftIngredient | null {
  if (!isObj(o)) return null;
  if (o['_Type_'] === 'CraftingCost_Resource') {
    const className = resourceName(o['resource']);
    const q = isObj(o['quantity']) ? toFiniteNumber(o['quantity']['standardCargoUnits']) : null;
    return className ? { className, quantity: q, unit: 'scu' } : null;
  }
  if (o['_Type_'] === 'CraftingCost_Item') {
    const className = resourceName(o['entityClass']);
    return className ? { className, quantity: toFiniteNumber(o['quantity']), unit: 'count' } : null;
  }
  return null;
}

/** The recipe of a blueprint payload (`payload.raw`), or null when it has none. */
export function parseCraftRecipe(payload: unknown): CraftRecipe | null {
  const p = isObj(payload) ? payload : null;
  const raw = p && isObj(p['raw']) ? p['raw'] : null;
  const blueprint = raw && isObj(raw['blueprint']) ? raw['blueprint'] : null;
  const tier = blueprint ? arr(blueprint['tiers'])[0] : null;
  const recipe = isObj(tier) && isObj(tier['recipe']) ? tier['recipe'] : null;
  const costs = recipe && isObj(recipe['costs']) ? recipe['costs'] : null;
  const mandatory = costs && isObj(costs['mandatoryCost']) ? costs['mandatoryCost'] : null;
  if (!mandatory) return null;
  const slots: CraftSlot[] = [];
  for (const opt of arr(mandatory['options'])) {
    if (!isObj(opt)) continue;
    const info = isObj(opt['nameInfo']) ? opt['nameInfo'] : {};
    const name = typeof info['debugName'] === 'string' ? info['debugName'] : '';
    const nameKey = typeof info['displayName'] === 'string' ? info['displayName'] : null;
    const ingredients = arr(opt['options']).map(parseIngredient).filter((i): i is CraftIngredient => i !== null);
    slots.push({ name, nameKey, ingredients, ranges: parseRanges(arr(opt['context'])) });
  }
  if (slots.length === 0) return null;
  const outputs = arr(p?.['outputs']);
  const out0 = isObj(outputs[0]) ? outputs[0]['className'] : null;
  return {
    blueprintClassName: typeof p?.['className'] === 'string' ? (p['className'] as string) : '',
    outputClassName: typeof out0 === 'string' ? out0 : null,
    slots,
  };
}

/** One range's modifier at `quality`, clamped to the range. */
export function rangeModifier(range: CraftRange, quality: number): number {
  const q = Math.max(range.startQuality, Math.min(range.endQuality, quality));
  const t = (q - range.startQuality) / (range.endQuality - range.startQuality);
  return range.modifierAtStart + (range.modifierAtEnd - range.modifierAtStart) * t;
}

/** A slot's quality, clamped to 0 … 1000 and rounded to a whole number. */
export function clampQuality(q: unknown): number {
  const n = typeof q === 'number' ? q : Number(q);
  if (!Number.isFinite(n)) return CRAFT_QUALITY_DEFAULT;
  return Math.round(Math.max(CRAFT_QUALITY_MIN, Math.min(CRAFT_QUALITY_MAX, n)));
}

/** Σ multipliers per stat for the chosen slot qualities (missing quality = default). */
export function craftMultipliers(recipe: CraftRecipe, qualities: readonly number[]): Map<CraftStat, number> {
  const out = new Map<CraftStat, number>();
  recipe.slots.forEach((slot, i) => {
    const q = clampQuality(qualities[i] ?? CRAFT_QUALITY_DEFAULT);
    for (const r of slot.ranges) out.set(r.stat, (out.get(r.stat) ?? 1) * rangeModifier(r, q));
  });
  return out;
}

/** The headline quality of a crafted item: the mean of its slots, rounded. */
export function overallQuality(qualities: readonly number[], slots: number): number {
  if (slots <= 0) return CRAFT_QUALITY_DEFAULT;
  let sum = 0;
  for (let i = 0; i < slots; i++) sum += clampQuality(qualities[i] ?? CRAFT_QUALITY_DEFAULT);
  return Math.round(sum / slots);
}

// ── applying the multipliers to an item ──────────────────────────────────────

function scaleKeys(target: Obj, keys: readonly string[], m: number): boolean {
  let touched = false;
  for (const [k, v] of Object.entries(target)) {
    if (!keys.some((w) => w.toLowerCase() === k.toLowerCase())) continue;
    const n = toFiniteNumber(v);
    if (n === null) continue;
    target[k] = n * m;
    touched = true;
  }
  return touched;
}

/** Scale fields inside `payload.stats[*]` whose struct name contains `hint`. */
function scaleStats(payload: unknown, hint: string, keys: readonly string[], m: number): unknown {
  if (!isObj(payload) || !isObj(payload['stats']) || m === 1) return payload;
  const stats: Record<string, unknown> = { ...(payload['stats'] as Obj) };
  let touched = false;
  for (const [struct, fields] of Object.entries(stats)) {
    if (!struct.toLowerCase().includes(hint) || !isObj(fields)) continue;
    const copy = { ...fields };
    if (scaleKeys(copy, keys, m)) {
      stats[struct] = copy;
      touched = true;
    }
  }
  return touched ? { ...payload, stats } : payload;
}

function scaleDamage(ammo: unknown, m: number): unknown {
  if (!isObj(ammo) || m === 1) return ammo;
  const next: Obj = { ...ammo };
  if (isObj(ammo['impactDamage'])) {
    const d = { ...(ammo['impactDamage'] as Obj) };
    scaleKeys(d, Object.keys(d), m);
    next['impactDamage'] = d;
  }
  const raw = isObj(ammo['raw']) ? ammo['raw'] : null;
  const pp = raw && isObj(raw['projectileParams']) ? raw['projectileParams'] : null;
  if (pp && isObj(pp['damage'])) {
    const d = { ...(pp['damage'] as Obj) };
    scaleKeys(d, Object.keys(d), m);
    next['raw'] = { ...raw, projectileParams: { ...pp, damage: d } };
  }
  return next;
}

/**
 * The occupant as a crafted item of the given multipliers. Each stat lands on
 * the field the rest of the page already reads, so the KPI band, the analysis
 * and the card follow without knowing about crafting.
 */
export function applyCraftMultipliers(o: SummaryOccupant, mult: ReadonlyMap<CraftStat, number>): SummaryOccupant {
  if (mult.size === 0) return o;
  const get = (s: CraftStat): number => mult.get(s) ?? 1;
  let payload = o.payload;
  let ammoPayload = o.ammoPayload;

  ammoPayload = scaleDamage(ammoPayload, get('Weapon_Damage'));
  if (isObj(payload) && isObj(payload['impactDamage'])) payload = scaleDamage(payload, get('Weapon_Damage'));
  if (get('Weapon_FireRate') !== 1 && isObj(payload) && isObj(payload['weaponParams'])) {
    const wp = { ...(payload['weaponParams'] as Obj) };
    scaleKeys(wp, ['fireRate'], get('Weapon_FireRate'));
    payload = { ...payload, weaponParams: wp };
  }
  payload = scaleStats(payload, 'health', ['Health', 'MaxHealth'], get('Health_MaxHealth'));
  payload = scaleStats(payload, 'shieldgenerator', ['MaxShieldHealth'], get('Shield_MaxHealth'));
  payload = scaleStats(payload, 'itemresource', ['online.coolant.generate'], get('ItemResource_CoolantGeneration'));
  payload = scaleStats(payload, 'radar', ['aimAssistMinRangeM'], get('Radar_MinAimAssistDistance'));
  payload = scaleStats(payload, 'radar', ['aimAssistRangeM'], get('Radar_MaxAimAssistDistance'));
  payload = scaleStats(payload, 'quantum', ['params.driveSpeed', 'driveSpeed'], get('Quantum_Speed'));
  payload = scaleStats(payload, 'quantum', ['params.quantumFuelRequirement', 'quantumFuelRequirement'], get('Quantum_FuelRequirement'));
  // Power generation is whole segments in the game — a crafted plant rounds down.
  if (get('ItemResource_PowerGeneration') !== 1 && isObj(payload) && isObj(payload['stats'])) {
    const m = get('ItemResource_PowerGeneration');
    const stats: Obj = { ...(payload['stats'] as Obj) };
    for (const [struct, fields] of Object.entries(stats)) {
      if (!struct.toLowerCase().includes('itemresource') || !isObj(fields)) continue;
      const copy = { ...fields };
      for (const [k, v] of Object.entries(copy)) {
        if (!/power\.generateSegments$/i.test(k)) continue;
        const n = toFiniteNumber(v);
        if (n !== null) copy[k] = Math.floor(n * m + 1e-9);
      }
      stats[struct] = copy;
    }
    payload = { ...payload, stats };
  }
  return payload === o.payload && ammoPayload === o.ammoPayload ? o : { ...o, payload, ammoPayload };
}

/** i18n key of a stat label (falls back to the generic one for unknown stats). */
export function craftStatLabelKey(stat: CraftStat): string {
  const known: Record<string, string> = {
    Weapon_Damage: 'damage',
    Weapon_FireRate: 'fireRate',
    Health_MaxHealth: 'health',
    Shield_MaxHealth: 'shieldHp',
    ItemResource_CoolantGeneration: 'coolant',
    ItemResource_PowerGeneration: 'power',
    Radar_MinAimAssistDistance: 'radarMin',
    Radar_MaxAimAssistDistance: 'radarMax',
    Quantum_Speed: 'quantumSpeed',
    Quantum_FuelRequirement: 'quantumFuel',
    Weapon_Tractor_Force: 'tractorForce',
    Weapon_Tractor_MaxDist: 'tractorRange',
    Weapon_Tractor_FullStrengthDist: 'tractorFull',
    Weapon_Tractor_MaxVolume: 'tractorVolume',
  };
  return `codex.craft.stat.${known[stat] ?? 'other'}`;
}

/** Quantum fuel use reads better when LOWER — the one stat whose + is bad. */
export function craftStatLowerIsBetter(stat: CraftStat): boolean {
  return stat === 'Quantum_FuelRequirement';
}
