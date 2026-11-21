// What the energy dock's pips DO to the ship — the power-effects layer.
// -----------------------------------------------------------------------------
// PURE DOMAIN MODULE. `codex-power.ts` decides how many segments each dock
// column gets; this module turns that allocation into the item-level state
// every other surface reads (KPI band, Offensive/Defensive analysis, Schiff
// facts, Einordnung). It does so by returning POWERED OCCUPANTS: copies of the
// loadout whose payloads carry the numbers the items deliver at the current
// pips. Every consumer of the occupant list therefore follows the dock without
// a power-specific branch of its own — "change a pip, see it everywhere".
//
// ── The rules, each from the game files or labelled as a model ────────────────
// P1  Distribution inside a column. A column's segments go to its items in
//     hardpoint order: first every item gets its own minimum
//     (⌈segments × minFraction⌉) while the column can afford it — an item that
//     cannot reach its minimum stays OFF and its share moves on; the rest is
//     dealt one segment at a time, round-robin, up to each item's full draw.
// P2  Online. An item that draws power is online when it holds at least its
//     minimum and at least one segment. An item that draws nothing (the
//     passive shield generator, a resource-less gun) is always online.
// P3  Performance band — DATA. `<state>.powerRanges.{low,medium,high}` carry
//     a `start` (segments) and a `modifier` (LIVE 4.10.3 WEB shield: 0 → 0.7,
//     1 → 0.85, 2 → 1.0). The band with the highest start ≤ the assigned
//     segments applies. No ranges in the data → 1.
// P4  Shields — DATA + band. An offline generator contributes neither HP nor
//     regen (Nomad: 3 → 2 generators = 6 480 → 4 320 HP). An online one keeps
//     its full `MaxShieldHealth` (more pips never add HP) and regenerates at
//     `MaxShieldRegen × band modifier`. The regen delays carry no power curve
//     in the data and stay as they are.
// P5  Energy weapons — MODEL (erkul's rule, the only published one): the
//     capacitor (`regen.maxAmmoLoad`, shots) and its refill
//     (`regen.maxRegenPerSec`) scale with weapon pips ÷ pips the guns can use.
//     Fewer pips → fewer shots before the pause → lower sustained DPS; the
//     burst DPS (alpha × fire rate) stays, because the files carry no
//     power-dependent fire rate. 0 weapon pips → every powered gun is offline.
//     A gun without a regen block (ballistic) is untouched unless offline.
// P6  Radar — DATA: aim-assist range runs from `aimAssistMinRangeM` at the
//     radar's minimum to `aimAssistRangeM` at full draw, linear in between.
// P7  Coolers: handled in `codex-power.ts` (F4), which already scales the
//     coolant they produce with their pips.
//
// A number the data does not carry is never invented: such an item simply
// keeps its stock value.

import { findStat, toFiniteNumber } from '../hangar/loadout-stats';
import { minimumSegments } from './codex-em-model';
import {
  PowerColumnKey,
  PowerSheet,
  classifyPowerGroup,
  coolerUnitKey,
  occupantDraw,
} from './codex-power';
import { RESOURCE_STATS_GROUP, STANDARD_UNITS_PER_SEGMENT, resolveResourceState, resourceKey } from './codex.types';
import type { SummaryOccupant } from './ship-summary-panels';

/** One installed unit's power state. */
export interface UnitPower {
  /** full draw in segments (standard units converted). */
  segments: number;
  /** what the unit cannot run below (P1). */
  minimum: number;
  /** segments it holds right now. */
  assigned: number;
  online: boolean;
  /** the performance band's modifier (P3); 0 when offline. */
  modifier: number;
}

/** Per occupant: one entry per unit (`count` identical hardpoints → `count` units). */
export interface OccupantPower {
  key: PowerColumnKey | null;
  units: UnitPower[];
}

export interface PowerEffects {
  /** same order as the occupants passed in; null = no power column (reactor, armor, …). */
  occupants: (OccupantPower | null)[];
  /** weapon pips ÷ the pips the guns can use (P5); null without a weapons column. */
  weaponRatio: number | null;
  /** the weapons column runs at 0 (cut, or pinned to zero). */
  weaponsOffline: boolean;
}

function statsOf(payload: unknown): Record<string, Record<string, unknown>> | undefined {
  const s = (payload as { stats?: unknown } | null | undefined)?.stats;
  return s && typeof s === 'object' ? (s as Record<string, Record<string, unknown>>) : undefined;
}

interface Band {
  start: number;
  modifier: number;
}

/** The item's performance bands (P3), sorted by start; empty when absent. */
export function powerBands(payload: unknown): Band[] {
  const stats = statsOf(payload);
  const state = resolveResourceState(payload);
  if (!stats || state === null) return [];
  const bands: Band[] = [];
  for (const name of ['low', 'medium', 'high']) {
    const start = findStat(stats, RESOURCE_STATS_GROUP, [resourceKey(`powerRanges.${name}.start`, state)]);
    const modifier = findStat(stats, RESOURCE_STATS_GROUP, [resourceKey(`powerRanges.${name}.modifier`, state)]);
    if (start !== null && modifier !== null && modifier > 0) bands.push({ start, modifier });
  }
  return bands.sort((a, b) => a.start - b.start);
}

/** The modifier at `assigned` segments: highest band start ≤ assigned (P3). */
export function bandModifier(bands: readonly Band[], assigned: number): number {
  let m: number | null = null;
  for (const b of bands) if (b.start <= assigned + 1e-9) m = b.modifier;
  return m ?? (bands.length > 0 ? bands[0].modifier : 1);
}

/**
 * P1 — deal `allocated` segments over units of `segments` / `minimum` each.
 * Returns the assigned segments per unit, in order.
 */
export function distributeColumn(
  units: readonly { segments: number; minimum: number }[],
  allocated: number,
): number[] {
  const out = units.map(() => 0);
  let left = Math.max(0, Math.floor(allocated + 1e-9));
  units.forEach((u, i) => {
    if (u.segments <= 0) return;
    const need = Math.max(1, u.minimum);
    if (left >= need) {
      out[i] = need;
      left -= need;
    }
  });
  let progress = true;
  while (left > 0 && progress) {
    progress = false;
    units.forEach((u, i) => {
      if (left <= 0 || out[i] === 0 || out[i] >= u.segments) return;
      out[i] += 1;
      left -= 1;
      progress = true;
    });
  }
  return out;
}

/** Which dock column every occupant charges to, cooler units split (F1d). */
function columnKeys(occupants: readonly SummaryOccupant[]): (PowerColumnKey[] | null)[] {
  let coolerUnit = 0;
  return occupants.map((o) => {
    const group = classifyPowerGroup(o);
    if (group === null) return null;
    const count = Math.max(1, o.count || 1);
    if (group !== 'coolers') return Array.from({ length: count }, () => group);
    return Array.from({ length: count }, () => coolerUnitKey(++coolerUnit));
  });
}

/** The whole effects sheet for one allocation. */
export function computePowerEffects(
  occupants: readonly SummaryOccupant[],
  sheet: PowerSheet | null | undefined,
): PowerEffects | null {
  if (!sheet || !sheet.available) return null;
  const keys = columnKeys(occupants);
  // Build every unit with its column, then deal each column (P1).
  const units: { occ: number; key: PowerColumnKey; segments: number; minimum: number }[] = [];
  occupants.forEach((o, i) => {
    const ks = keys[i];
    if (!ks) return;
    const d = occupantDraw({ ...o, count: 1 });
    const segments = d.consumeSegments + d.consumeUnits / STANDARD_UNITS_PER_SEGMENT;
    const minimum = d.consumeSegments > 0 ? minimumSegments(d.consumeSegments, d.minFraction) : 0;
    for (const key of ks) units.push({ occ: i, key, segments, minimum });
  });

  const assigned = new Map<number, number>();
  const byColumn = new Map<PowerColumnKey, number[]>();
  units.forEach((u, idx) => {
    const list = byColumn.get(u.key) ?? [];
    list.push(idx);
    byColumn.set(u.key, list);
  });
  for (const [key, idxs] of byColumn) {
    const row = sheet.groups.find((g) => g.key === key);
    const allocated = row ? row.allocated : 0;
    // Standard-unit consumers (guns) share fractional segments: they are dealt
    // as a pool, never as whole segments per gun (P5 handles them).
    const fractional = idxs.every((i) => units[i].minimum === 0 && units[i].segments < 1);
    if (fractional) {
      const total = idxs.reduce((s, i) => s + units[i].segments, 0);
      const share = total > 0 ? Math.min(1, allocated / total) : 0;
      for (const i of idxs) assigned.set(i, units[i].segments * share);
      continue;
    }
    const dealt = distributeColumn(idxs.map((i) => units[i]), allocated);
    idxs.forEach((i, n) => assigned.set(i, dealt[n]));
  }

  const result: (OccupantPower | null)[] = occupants.map(() => null);
  units.forEach((u, idx) => {
    const a = assigned.get(idx) ?? 0;
    const draws = u.segments > 0;
    const online = !draws || (a > 0 && a + 1e-9 >= u.minimum);
    const modifier = !online ? 0 : draws ? bandModifier(powerBands(occupants[u.occ].payload), a) : 1;
    const entry = result[u.occ] ?? { key: u.key, units: [] };
    entry.units.push({ segments: u.segments, minimum: u.minimum, assigned: a, online, modifier });
    result[u.occ] = entry;
  });

  const weapons = sheet.groups.find((g) => g.key === 'weapons');
  const usable = weapons ? weapons.capacity : 0;
  const weaponRatio = weapons && weapons.state !== 'absent' && usable > 0 ? Math.min(1, weapons.allocated / usable) : null;
  const weaponsOffline = !!weapons && weapons.state !== 'absent' && weapons.demand > 0 && weapons.allocated === 0;
  return { occupants: result, weaponRatio, weaponsOffline };
}

// ── payload patching ─────────────────────────────────────────────────────────

/** Copy `payload.stats[struct]` with `fields` overwritten (case-insensitive struct hint). */
function patchStats(payload: unknown, hint: string, patch: (fields: Record<string, unknown>) => void): unknown {
  const p = payload as { stats?: Record<string, Record<string, unknown>> } | null;
  if (!p?.stats) return payload;
  const stats: Record<string, Record<string, unknown>> = { ...p.stats };
  let touched = false;
  for (const [struct, fields] of Object.entries(stats)) {
    if (!struct.toLowerCase().includes(hint) || !fields || typeof fields !== 'object') continue;
    const copy = { ...fields };
    patch(copy);
    stats[struct] = copy;
    touched = true;
  }
  return touched ? { ...p, stats } : payload;
}

function setNumeric(fields: Record<string, unknown>, name: string, fn: (v: number) => number): void {
  const key = Object.keys(fields).find((k) => k.toLowerCase() === name.toLowerCase());
  if (key === undefined) return;
  const v = toFiniteNumber(fields[key]);
  if (v !== null) fields[key] = fn(v);
}

/** Split an occupant into one occupant per distinct unit state, so a 3× shield
 * row with one generator offline becomes 2× online + 1× offline. */
function groupUnits(units: readonly UnitPower[]): { unit: UnitPower; count: number }[] {
  const out: { unit: UnitPower; count: number }[] = [];
  for (const u of units) {
    const same = out.find((g) => g.unit.online === u.online && Math.abs(g.unit.modifier - u.modifier) < 1e-9);
    if (same) same.count += 1;
    else out.push({ unit: u, count: 1 });
  }
  return out;
}

function poweredShield(payload: unknown, unit: UnitPower): unknown {
  return patchStats(payload, 'shieldgenerator', (f) => {
    if (!unit.online) {
      setNumeric(f, 'MaxShieldHealth', () => 0);
      setNumeric(f, 'MaxShieldRegen', () => 0);
    } else {
      setNumeric(f, 'MaxShieldRegen', (v) => v * unit.modifier);
    }
  });
}

function poweredRadar(payload: unknown, unit: UnitPower): unknown {
  if (!unit.online) return payload;
  return patchStats(payload, 'radar', (f) => {
    const keyMax = Object.keys(f).find((k) => k.toLowerCase() === 'aimassistrangem');
    const keyMin = Object.keys(f).find((k) => k.toLowerCase() === 'aimassistminrangem');
    if (!keyMax || !keyMin) return;
    const max = toFiniteNumber(f[keyMax]);
    const min = toFiniteNumber(f[keyMin]);
    if (max === null || min === null || unit.segments <= unit.minimum) return;
    const t = Math.max(0, Math.min(1, (unit.assigned - unit.minimum) / (unit.segments - unit.minimum)));
    f[keyMax] = min + (max - min) * t;
  });
}

function poweredWeapon(payload: unknown, ratio: number | null, offline: boolean): unknown {
  const p = payload as { weaponParams?: Record<string, unknown> } | null;
  const wp = p?.weaponParams;
  if (!wp) return payload;
  if (offline) return { ...p, weaponParams: { ...wp, fireRate: 0 } };
  if (ratio === null || ratio >= 1) return payload;
  const next = { ...wp };
  for (const k of ['regen.maxAmmoLoad', 'regen.maxRegenPerSec', 'regen.requestedAmmoLoad', 'regen.requestedRegenPerSec']) {
    const v = toFiniteNumber(next[k]);
    if (v !== null) next[k] = v * ratio;
  }
  return { ...p, weaponParams: next };
}

function drawsWeaponPower(o: SummaryOccupant): boolean {
  const d = occupantDraw({ ...o, count: 1 });
  return d.consumeUnits > 0 || d.consumeSegments > 0;
}

/**
 * The loadout as the current pips leave it: the same occupants, with payloads
 * that carry what each item delivers right now (P4–P6). Returns the input
 * array itself when there is no power sheet, so the stock view is untouched.
 */
export function applyPowerToOccupants(
  occupants: readonly SummaryOccupant[],
  sheet: PowerSheet | null | undefined,
): readonly SummaryOccupant[] {
  const effects = computePowerEffects(occupants, sheet);
  if (!effects) return occupants;
  const out: SummaryOccupant[] = [];
  occupants.forEach((o, i) => {
    const power = effects.occupants[i];
    const group = power ? classifyPowerGroup(o) : null;
    if (!power || !group) {
      out.push(o);
      return;
    }
    if (group === 'weapons') {
      const offline = effects.weaponsOffline && drawsWeaponPower(o);
      out.push({ ...o, payload: poweredWeapon(o.payload, offline ? null : effects.weaponRatio, offline) });
      return;
    }
    if (group === 'shields' || group === 'radar') {
      for (const { unit, count } of groupUnits(power.units)) {
        const payload = group === 'shields' ? poweredShield(o.payload, unit) : poweredRadar(o.payload, unit);
        out.push({ ...o, count, payload });
      }
      return;
    }
    out.push(o);
  });
  return out;
}

/**
 * The powered payload of every installed UNIT, queued per class name in
 * hardpoint order — what a loadout card reads, one hardpoint at a time. A
 * card takes the next entry for its class; a class the dock does not touch has
 * no queue and the card keeps its stock payload.
 */
export function poweredPayloadQueues(
  occupants: readonly SummaryOccupant[],
  sheet: PowerSheet | null | undefined,
): Map<string, unknown[]> {
  const queues = new Map<string, unknown[]>();
  const effects = computePowerEffects(occupants, sheet);
  if (!effects) return queues;
  occupants.forEach((o, i) => {
    const power = effects.occupants[i];
    const group = power ? classifyPowerGroup(o) : null;
    const className = (o.payload as { className?: string } | null)?.className;
    if (!power || !group || !className) return;
    const list = queues.get(className) ?? [];
    for (const unit of power.units) {
      if (group === 'weapons') {
        const offline = effects.weaponsOffline && drawsWeaponPower(o);
        list.push(poweredWeapon(o.payload, offline ? null : effects.weaponRatio, offline));
      } else if (group === 'shields') list.push(poweredShield(o.payload, unit));
      else if (group === 'radar') list.push(poweredRadar(o.payload, unit));
      else list.push(o.payload);
    }
    queues.set(className, list);
  });
  return queues;
}

/** Shield generators online / installed under the allocation (for the "2 von 3" line). */
export function shieldGeneratorsOnline(effects: PowerEffects | null, occupants: readonly SummaryOccupant[]): { online: number; total: number } | null {
  if (!effects) return null;
  let online = 0;
  let total = 0;
  occupants.forEach((o, i) => {
    if (classifyPowerGroup(o) !== 'shields') return;
    for (const u of effects.occupants[i]?.units ?? []) {
      total += 1;
      if (u.online) online += 1;
    }
  });
  return total > 0 ? { online, total } : null;
}
