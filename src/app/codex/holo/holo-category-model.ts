// Data layer of the Holotable's four categories (Offensive, Verteidigung,
// Bewegung, Signatur & Kühlung) — pure functions, no UI.
// -----------------------------------------------------------------------------
// One call, `buildHoloCategoryModels`, returns a typed model per category:
// lead value + rank + class median, the derived values and the per-part share
// of the category total. The renderers of waves 2 and 3 only read it.
//
// Hard rule of the codex data layer holds: NEVER invent a number. A value the
// extract does not carry is `null` and the renderer draws a marked gap.
// Known gaps: acceleration (no data), fuel (no data), cooler output as a share
// of the class (the cohort sheets carry no coolant figure).
//
// Assumptions the numbers rest on (also in the wave-1 report):
//  * Detection distance in km = signature value / {@link SIGNATURE_UNITS_PER_KM}.
//    The game files carry no sensor model; this linear scale is the working
//    assumption of the concept (EM 50,1 km ≙ 50 100 model units).
//  * Effective HP per damage type: shield HP / (1 − shield resistance) +
//    armour HP / armour damage multiplier + hull HP. The armour multiplier is
//    applied to the armour pool only.
//  * "Schild weg in" = shield HP / class-median sustained DPS; regeneration is
//    left out (it would exceed the median DPS on most ships).

import { alphaDamage, countermeasureStats, damagePerSecond } from '../codex-equipped-stats';
import { countermeasureKind, decoysToOutshine, isCountermeasureLauncher } from '../codex-countermeasure';
import {
  DefensivePanel,
  KpiShipInput,
  KpiSheet,
  buildDefensivePanel,
  computeKpiSheet,
  crossSectionAxes,
  findArmorPayload,
  armorSignalMultipliers,
  kpiLowerIsBetter,
} from '../codex-loadout-stats';
import {
  PowerColumnKey,
  PowerLevels,
  PowerSheet,
  FlightMode,
  PowerGroupRow,
  computePowerSheet,
  occupantDraw,
  withPowerSignature,
} from '../codex-power';
import { scaledSignature } from '../codex-em-model';
import { RANK_MIN_GROUP, RankShipInput, median, percentileOf } from '../codex-rank';
import {
  SustainedCycleInfo,
  SustainedLimit,
  sustainedCycles,
  sustainedDps,
  weaponParamsOf,
} from '../codex-sustained-dps';
import { KpiKey } from '../codex-mission';
import type { SummaryOccupant } from '../ship-summary-panels';
import { STANDARD_UNITS_PER_SEGMENT } from '../codex.types';
import { findStat, toFiniteNumber } from '../../hangar/loadout-stats';

export type HoloCategoryId = 'offensive' | 'defensive' | 'movement' | 'signature';
export const HOLO_CATEGORY_IDS: readonly HoloCategoryId[] = ['offensive', 'defensive', 'movement', 'signature'];

/** The KPI that is the lead number of each category, unless the caller picks another. */
export const HOLO_LEAD_KEY: Readonly<Record<HoloCategoryId, KpiKey>> = {
  offensive: 'sustainedDps',
  defensive: 'shieldHp',
  movement: 'scm',
  signature: 'emLoad',
};

/**
 * Model units per km of detection distance (see the header — an assumption).
 * The live stats strip (`codex-holo-strip.component.ts` `fmtKm`) divides by the
 * same 1000, so both places show the same km.
 */
export const SIGNATURE_UNITS_PER_KM = 1000;

// ── generic helpers ──────────────────────────────────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Signature (model units) → detection distance in km, one decimal. Null stays null. */
export function signatureToKm(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return round1(value / SIGNATURE_UNITS_PER_KM);
}

export interface ClassShare {
  /** value / class maximum, 0..1; null without a class or a positive maximum. */
  shareOfMax: number | null;
  /** value / class median clamped to 0..1; null without a class or a positive median. */
  shareOfMedian: number | null;
}

/** A unit-less value (IR/EM nominal, cooler output, fuel) as a share of its class. */
export function classShare(value: number | null | undefined, classValues: readonly number[]): ClassShare {
  const none: ClassShare = { shareOfMax: null, shareOfMedian: null };
  if (value == null || !Number.isFinite(value) || classValues.length === 0) return none;
  const max = Math.max(...classValues);
  const med = median(classValues);
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
  return {
    shareOfMax: max > 0 ? clamp(value / max) : null,
    shareOfMedian: med !== null && med > 0 ? clamp(value / med) : null,
  };
}

/** One part's share of a category total (0..1, three decimals). */
export interface HoloPart {
  id: string;
  value: number;
  /** value / Σ values of the category; null when the total is 0. */
  share: number | null;
}

export function partShares(parts: readonly { id: string; value: number }[]): HoloPart[] {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return parts.map((p) => ({ ...p, share: total > 0 ? Math.round((p.value / total) * 1000) / 1000 : null }));
}

// ── lead value, rank, median ─────────────────────────────────────────────────

export interface HoloLead {
  key: KpiKey;
  value: number | null;
  /** Percentile 0..100 inside the cohort (higher = better); null when thin or a gap. */
  rank: number | null;
  /** The class's median of the same key. */
  median: number | null;
  cohortSize: number;
  /** true when the cohort has fewer than {@link RANK_MIN_GROUP} ships with a value. */
  thin: boolean;
  lowerIsBetter: boolean;
}

export function cohortValues(cohort: readonly RankShipInput[] | null | undefined, key: KpiKey): number[] {
  return (cohort ?? [])
    .map((c) => (c.sheet as Partial<KpiSheet>)[key])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

export function buildLead(
  key: KpiKey,
  value: number | null,
  cohort: readonly RankShipInput[] | null | undefined,
): HoloLead {
  const values = cohortValues(cohort, key);
  const lowerIsBetter = kpiLowerIsBetter(key);
  const thin = values.length < RANK_MIN_GROUP;
  return {
    key,
    value,
    rank: value !== null && !thin ? percentileOf(value, values, lowerIsBetter) : null,
    median: median(values),
    cohortSize: values.length,
    thin,
    lowerIsBetter,
  };
}

// ── (a)(b) fire timeline ─────────────────────────────────────────────────────

/** One weapon row (a className at one mount type), numbers already × count. */
export interface HoloWeapon {
  className: string;
  section: SummaryOccupant['section'];
  /** true for manned turrets — their fire needs a gunner. */
  manned: boolean;
  count: number;
  burstDps: number;
  /** Cycle-averaged DPS; null when the payload carries no fire cycle. */
  sustainedDps: number | null;
  /** The binding limiter, null without a cycle. */
  limiter: SustainedLimit | null;
  /** Seconds of full fire before the BINDING limiter stops the gun. */
  fireTime: number | null;
  downtime: number | null;
  /** All limit cycles, shortest burst first. */
  cycles: SustainedCycleInfo[];
  /** true when the gun carries a magazine / ammo count (ballistic); energy guns have none. */
  ballistic: boolean;
}

/** One step of the timeline: fire at `dps` until `untilSec`, then the next phase. */
export interface FirePhase {
  dps: number;
  /** End time in seconds; null = the phase never ends (guns with no known limit). */
  untilSec: number | null;
  /** What ends the phase (the first gun to give out); null for an open phase. */
  limiter: SustainedLimit | null;
}

export interface FireTimeline {
  phases: FirePhase[];
  /** The final "then X sustained" number; null unless EVERY gun's cycle is known. */
  sustainedDps: number | null;
  complete: boolean;
  /** (a) how long full fire lasts: end of the first phase; null without any limit. */
  fullFireSec: number | null;
  firstLimiter: SustainedLimit | null;
}

export function buildFireTimeline(weapons: readonly HoloWeapon[]): FireTimeline {
  const burstTotal = weapons.reduce((s, w) => s + w.burstDps, 0);
  const complete = weapons.length > 0 && weapons.every((w) => w.sustainedDps !== null);
  const sustained = complete ? round2(weapons.reduce((s, w) => s + (w.sustainedDps ?? 0), 0)) : null;
  const limited = weapons.filter((w) => w.fireTime !== null).sort((a, b) => a.fireTime! - b.fireTime!);
  const phases: FirePhase[] = [];
  let dps = burstTotal;
  for (let i = 0; i < limited.length; ) {
    const t = limited[i].fireTime!;
    let j = i;
    while (j < limited.length && Math.abs(limited[j].fireTime! - t) < 1e-9) j++;
    phases.push({ dps: round2(dps), untilSec: round2(t), limiter: limited[i].limiter });
    for (let k = i; k < j; k++) dps -= limited[k].burstDps;
    i = j;
  }
  if (dps > 1e-6 || phases.length === 0) {
    if (burstTotal > 0) phases.push({ dps: round2(Math.max(0, dps)), untilSec: null, limiter: null });
  }
  return {
    phases,
    sustainedDps: sustained,
    complete,
    fullFireSec: phases.length > 0 ? phases[0].untilSec : null,
    firstLimiter: phases.length > 0 ? phases[0].limiter : null,
  };
}

export interface HoloOffensive {
  weapons: HoloWeapon[];
  /** The whole loadout. */
  timeline: FireTimeline;
  /** One timeline per mount type that carries guns. */
  groups: { section: SummaryOccupant['section']; timeline: FireTimeline }[];
  /** (b) share of sustained DPS that needs gunners (manned turrets), 0..1; null if sustained is incomplete. */
  gunnerShare: number | null;
  /** The same on burst DPS — always available when any gun has a burst figure. */
  gunnerShareBurst: number | null;
  /** Burst DPS per weapon row as a share of the total. */
  parts: HoloPart[];
  missileDamage: number | null;
}

const GUN_SECTIONS = new Set<SummaryOccupant['section']>(['weapons', 'remoteTurrets', 'mannedTurrets']);

export function holoWeapons(occupants: readonly SummaryOccupant[]): HoloWeapon[] {
  const out: HoloWeapon[] = [];
  for (const o of occupants) {
    const payload = o.payload as { entityKind?: string; className?: string } | null | undefined;
    if (!GUN_SECTIONS.has(o.section) || (payload?.entityKind ?? o.kind ?? '') !== 'weapon') continue;
    const alpha = alphaDamage(o.ammoPayload) ?? alphaDamage(o.payload);
    if (alpha === null) continue;
    const params = weaponParamsOf(o.payload);
    const fireRate = toFiniteNumber(params?.['fireRate'] ?? null);
    const dps = damagePerSecond(alpha, fireRate);
    if (dps === null) continue;
    const sus = sustainedDps(dps, fireRate, params);
    out.push({
      className: payload?.className ?? '',
      section: o.section,
      manned: o.section === 'mannedTurrets',
      count: o.count,
      burstDps: dps * o.count,
      sustainedDps: sus.value === null ? null : sus.value * o.count,
      limiter: sus.limit,
      fireTime: sus.fireTime,
      downtime: sus.downtime,
      cycles: sustainedCycles(dps, fireRate, params),
      ballistic:
        (toFiniteNumber(params?.['ammoCapacity'] ?? null) ?? 0) > 0 ||
        sustainedCycles(dps, fireRate, params).some((c) => c.limit === 'magazine'),
    });
  }
  return out;
}

/** (b) gunner share of the DPS — manned weapons / all weapons; null when `pick` misses on any gun. */
export function gunnerShare(
  weapons: readonly HoloWeapon[],
  pick: (w: HoloWeapon) => number | null,
): number | null {
  if (weapons.length === 0) return null;
  let total = 0;
  let manned = 0;
  for (const w of weapons) {
    const v = pick(w);
    if (v === null) return null;
    total += v;
    if (w.manned) manned += v;
  }
  return total > 0 ? Math.round((manned / total) * 1000) / 1000 : null;
}

export function buildOffensive(occupants: readonly SummaryOccupant[], sheet: KpiSheet): HoloOffensive {
  const weapons = holoWeapons(occupants);
  const sections = [...new Set(weapons.map((w) => w.section))];
  return {
    weapons,
    timeline: buildFireTimeline(weapons),
    groups: sections.map((section) => ({
      section,
      timeline: buildFireTimeline(weapons.filter((w) => w.section === section)),
    })),
    gunnerShare: gunnerShare(weapons, (w) => w.sustainedDps),
    gunnerShareBurst: gunnerShare(weapons, (w) => w.burstDps),
    parts: partShares(weapons.map((w) => ({ id: w.className, value: w.burstDps }))),
    missileDamage: sheet.missiles,
  };
}

// ── (c)(d) defence ───────────────────────────────────────────────────────────

export type DamageType = 'physical' | 'energy' | 'distortion';
export const DAMAGE_TYPES: readonly DamageType[] = ['physical', 'energy', 'distortion'];

export interface EffectiveHp {
  type: DamageType;
  shield: number | null;
  armor: number | null;
  hull: number | null;
  /** Shield + armour + hull. Null unless shield AND hull are known. */
  total: number | null;
  /** false when armour HP or its multiplier is missing — `armor` is then null and not in `total`. */
  armorKnown: boolean;
}

const clampResist = (pct: number): number => Math.max(-500, Math.min(99, pct));

/** (c) effective HP per damage type, shield → armour → hull with resistances. */
export function effectiveHpByType(
  panel: DefensivePanel,
  armorHp: number | null | undefined,
): EffectiveHp[] {
  return DAMAGE_TYPES.map((type) => {
    const resistPct = panel.resistances.find((r) => r.channel === type)?.pct ?? 0;
    const shield = panel.shieldHp !== null ? panel.shieldHp / (1 - clampResist(resistPct) / 100) : null;
    const reduction =
      type === 'physical'
        ? panel.armor?.reductionPhysicalPct
        : type === 'energy'
          ? panel.armor?.reductionEnergyPct
          : panel.armor?.reductionDistortionPct;
    const mult = reduction == null ? 1 : Math.max(0.01, 1 - reduction / 100);
    const armorKnown = armorHp != null && armorHp > 0;
    const armor = armorKnown ? armorHp! / mult : null;
    const hull = panel.hullHp;
    const total =
      shield !== null && hull !== null ? Math.round(shield + (armor ?? 0) + hull) : null;
    return {
      type,
      shield: shield === null ? null : Math.round(shield),
      armor: armor === null ? null : Math.round(armor),
      hull,
      total,
      armorKnown,
    };
  });
}

/** (d) seconds until the shield is gone under the class-median sustained DPS; null without both. */
export function shieldDownIn(shieldHp: number | null, classMedianSustainedDps: number | null): number | null {
  if (shieldHp == null || classMedianSustainedDps == null) return null;
  if (!(shieldHp > 0) || !(classMedianSustainedDps > 0)) return null;
  return round1(shieldHp / classMedianSustainedDps);
}

export interface HoloDefensive {
  panel: DefensivePanel;
  effectiveHp: EffectiveHp[];
  shieldDownInSec: number | null;
  /** Regeneration as numbers only: delay after a hit, delay after going down, seconds to full. */
  regen: { delaySec: number | null; downedDelaySec: number | null; timeToFullSec: number | null };
  armorHp: number | null;
  /** Shield / armour / hull share of the physical effective HP. */
  parts: HoloPart[];
}

export function buildDefensive(
  occupants: readonly SummaryOccupant[],
  ship: KpiShipInput | null | undefined,
  medianSustained: number | null,
): HoloDefensive {
  const panel = buildDefensivePanel(occupants, findArmorPayload(occupants), ship?.hull?.hp ?? null);
  const armorHp = toFiniteNumber(ship?.armorHp ?? null);
  const ehp = effectiveHpByType(panel, armorHp);
  const phys = ehp[0];
  const parts = [
    { id: 'shield', value: phys.shield },
    { id: 'armor', value: phys.armor },
    { id: 'hull', value: phys.hull },
  ].filter((p): p is { id: string; value: number } => p.value !== null);
  return {
    panel,
    effectiveHp: ehp,
    shieldDownInSec: shieldDownIn(panel.shieldHp, medianSustained),
    regen: { delaySec: panel.regenDelay, downedDelaySec: panel.downedDelay, timeToFullSec: panel.fullInSeconds },
    armorHp,
    parts: partShares(parts),
  };
}

// ── per-row shares (the calm part cards' bars) ──────────────────────────────

/**
 * The value a part row's bar is measured in. Each kind is normalised on its own
 * (shield generators among shield generators), because HP, speed and EM do not add.
 */
export type RowShareKind = 'shieldHp' | 'driveSpeed' | 'plantEm' | 'coolerRate' | 'radarEm';

export interface RowShareGroup {
  kind: RowShareKind;
  category: HoloCategoryId;
  /** Σ of the rows' values — what the bars refer to. */
  total: number;
  /** One part per className with a positive value; a row without data is absent (no bar, never 0 %). */
  parts: HoloPart[];
}

const classNameOf = (o: SummaryOccupant): string => (o.payload as { className?: string } | null | undefined)?.className ?? '';

function rowGroup(category: HoloCategoryId, kind: RowShareKind, rows: { id: string; value: number }[]): RowShareGroup | null {
  const m = new Map<string, number>();
  for (const r of rows) if (r.id && r.value > 0 && Number.isFinite(r.value)) m.set(r.id, (m.get(r.id) ?? 0) + r.value);
  if (m.size === 0) return null;
  const parts = partShares([...m].map(([id, value]) => ({ id, value })));
  return { kind, category, total: parts.reduce((t, x) => t + x.value, 0), parts };
}

/**
 * Per-row shares for Verteidigung, Bewegung and Signatur & Kühlung:
 *  * shield generators — shield HP × count;
 *  * quantum drive — drive speed (the one number the data offers);
 *  * power plant — its EM emission (`em.nominal`);
 *  * coolers — coolant generated (cooling rate);
 *  * radar — EM emission.
 * Armour, countermeasures, structure, life support: no per-row number, no bar.
 */
export function buildRowShareGroups(occupants: readonly SummaryOccupant[]): RowShareGroup[] {
  const shield: { id: string; value: number }[] = [];
  const drive: { id: string; value: number }[] = [];
  const plant: { id: string; value: number }[] = [];
  const cooler: { id: string; value: number }[] = [];
  const radar: { id: string; value: number }[] = [];
  for (const o of occupants) {
    if (!o.payload) continue;
    const id = classNameOf(o);
    const kind = ((o.payload as { kind?: string }).kind ?? '').trim();
    const stats = (o.payload as { stats?: Record<string, Record<string, unknown>> }).stats;
    const stat = (cat: string, keys: string[]): number | null => {
      const n = toFiniteNumber((stats ? findStat(stats, cat, keys) : null) ?? null);
      return n !== null && n > 0 && n < 1e30 ? n : null;
    };
    if (kind === 'Shield') {
      const hp = stat('shield', ['MaxShieldHealth']);
      if (hp !== null) shield.push({ id, value: hp * Math.max(1, o.count) });
    } else if (kind === 'QuantumDrive') {
      const v = stat('quantum', ['params.driveSpeed', 'driveSpeed']);
      if (v !== null) drive.push({ id, value: v });
    } else {
      const d = occupantDraw(o);
      if (d.missing) continue;
      if (d.generateSegments > 0) plant.push({ id, value: d.emNominal });
      else if (d.group === 'coolers') cooler.push({ id, value: d.coolantGenerate });
      else if (d.group === 'radar') radar.push({ id, value: d.emNominal });
    }
  }
  return [
    rowGroup('defensive', 'shieldHp', shield),
    rowGroup('movement', 'driveSpeed', drive),
    rowGroup('movement', 'plantEm', plant),
    rowGroup('signature', 'coolerRate', cooler),
    rowGroup('signature', 'radarEm', radar),
  ].filter((g): g is RowShareGroup => g !== null);
}

// ── movement ─────────────────────────────────────────────────────────────────

export interface HoloMovement {
  scm: number | null;
  maxSpeed: number | null;
  boost: number | null;
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
  quantumSpeed: number | null;
  quantumRange: number | null;
  spoolSec: number | null;
  /** No data in the extract — always null, the UI draws a marked gap. */
  acceleration: null;
}

export function buildMovement(ship: KpiShipInput | null | undefined, sheet: KpiSheet): HoloMovement {
  const num = (v: number | null | undefined): number | null => {
    const n = toFiniteNumber(v ?? null);
    return n !== null && n > 0 ? n : null;
  };
  return {
    scm: sheet.scm,
    maxSpeed: sheet.maxSpeed,
    boost: sheet.boost,
    pitch: num(ship?.flight?.pitch),
    yaw: num(ship?.flight?.yaw),
    roll: num(ship?.flight?.roll),
    quantumSpeed: sheet.quantumSpeed,
    quantumRange: sheet.quantumRange,
    spoolSec: sheet.spool,
    acceleration: null,
  };
}

// ── (e)(f) signature ─────────────────────────────────────────────────────────

export type EmSource = 'generator' | 'shields' | 'weapons' | 'coolers' | 'rest';
export const EM_SOURCES: readonly EmSource[] = ['generator', 'shields', 'weapons', 'coolers', 'rest'];

export interface EmSourcePart extends HoloPart {
  id: EmSource;
  /** Detection distance this source alone would have, km. */
  km: number | null;
}

function groupShare(sheet: PowerSheet, group: string): number {
  const rows = sheet.groups.filter((g) => g.group === group);
  if (rows.length === 0) return 0;
  if (sheet.budgetTotal === null) return rows.some((r) => !r.cut) ? 1 : 0;
  const demand = rows.reduce((s, r) => s + r.demand, 0);
  const allocated = rows.reduce((s, r) => s + (r.state === 'noChannel' || r.cut ? 0 : r.allocated), 0);
  if (rows.every((r) => r.state === 'noChannel' || r.cut)) return 0;
  return demand > 0 ? Math.min(1, allocated / demand) : 1;
}

/**
 * (f) EM by source at the allocation of `sheet`: generator / shields / weapons /
 * coolers / rest, each already scaled by the hull armour's EM factor. Their sum
 * equals the power sheet's EM fact up to rounding (thrusters are left out in both).
 */
export function emBySource(occupants: readonly SummaryOccupant[], sheet: PowerSheet): EmSourcePart[] {
  const armor = armorSignalMultipliers(findArmorPayload(occupants));
  const factor = armor?.em ?? 1;
  const sums: Record<EmSource, number> = { generator: 0, shields: 0, weapons: 0, coolers: 0, rest: 0 };
  let load = 0;
  let capacity = 0;
  let plantEm = 0;
  for (const o of occupants) {
    if (!o.payload) continue;
    const d = occupantDraw(o);
    if (d.missing) continue;
    if (d.generateSegments > 0) {
      capacity += d.generateSegments;
      plantEm += d.emNominal;
      continue;
    }
    const segments = d.consumeSegments + d.consumeUnits / STANDARD_UNITS_PER_SEGMENT;
    if (d.group === 'thrusters' && segments === 0) continue;
    const share = d.group === null ? 1 : groupShare(sheet, d.group);
    if (share <= 0) continue;
    load += segments * share;
    const em = scaledSignature(d.emNominal, segments, segments * share, d.minFraction);
    const source: EmSource =
      d.group === 'shields' ? 'shields' : d.group === 'weapons' ? 'weapons' : d.group === 'coolers' ? 'coolers' : 'rest';
    sums[source] += em;
  }
  if (capacity > 0) sums.generator = plantEm * (Math.min(load, capacity) / capacity);
  const parts = partShares(EM_SOURCES.map((id) => ({ id, value: Math.round(sums[id] * factor) })));
  return parts.map((p) => ({ ...p, id: p.id as EmSource, km: signatureToKm(p.value) }));
}

export interface DecoyNeed {
  ir: number | null;
  em: number | null;
  crossSection: number | null;
}

/** (e) decoys needed to outshine the ship per channel; the round's own signature comes from the first decoy launcher. */
export function decoysNeeded(
  occupants: readonly SummaryOccupant[],
  ship: { ir: number | null; em: number | null; crossSection: number | null },
): DecoyNeed {
  const launcher = occupants.find((o) => {
    if (!isCountermeasureLauncher(o.payload)) return false;
    const cn = (o.payload as { className?: string }).className;
    return countermeasureKind(cn, o.ammoPayload) === 'decoy';
  });
  const none: DecoyNeed = { ir: null, em: null, crossSection: null };
  if (!launcher) return none;
  const stats = new Map(countermeasureStats(launcher.ammoPayload ?? null, launcher.payload).map((s) => [s.labelKey, s.value]));
  return {
    ir: decoysToOutshine(ship.ir, stats.get('codex.equipped.cmInfrared')),
    em: decoysToOutshine(ship.em, stats.get('codex.equipped.cmElectromagnetic')),
    crossSection: decoysToOutshine(ship.crossSection, stats.get('codex.equipped.cmCrossSection')),
  };
}

export interface HoloSignature {
  /** Detection distance in km. */
  irKm: number | null;
  emKm: number | null;
  crossSectionKm: number | null;
  /** Raw model units behind the km values. */
  ir: number | null;
  em: number | null;
  crossSection: number | null;
  /** IR / EM as a 0..1 share of the class maximum / median (null without a cohort). */
  irClass: ClassShare;
  emClass: ClassShare;
  coolingLoadPct: number | null;
  /** Total coolant generated; unit-less, no cohort figure exists. */
  coolerOutput: number | null;
  coolerOutputClass: ClassShare;
  /** No data in the extract. */
  fuel: null;
  emSources: EmSourcePart[];
  decoys: DecoyNeed;
  parts: HoloPart[];
}

// ── (g) energy ───────────────────────────────────────────────────────────────

/** The consumer groups of the energy view, in display order. */
export const ENERGY_GROUPS = ['weapons', 'shields', 'thrusters', 'quantum', 'radar', 'life'] as const;

export interface EnergySegments {
  key: PowerColumnKey;
  labelKey: string;
  labelParams?: Readonly<Record<string, number>>;
  /** Segments in use. */
  used: number;
  /** Segments the group could draw at most. */
  max: number;
  minimum: number;
  present: boolean;
  cut: boolean;
  state: PowerGroupRow['state'];
}

export interface HoloEnergyInput {
  occupants: readonly SummaryOccupant[];
  shipStats?: Record<string, Record<string, unknown>> | null;
  schemaVersion?: number | null;
  mode?: FlightMode;
  cutGroups?: Iterable<PowerColumnKey>;
  levels?: PowerLevels | null;
}

export interface HoloEnergy {
  /** weapons, shields, thrusters, quantum, radar, cooler 1..n, life support — tractor only when fitted. */
  segments: EnergySegments[];
  generator: { used: number; available: number | null };
  em: number | null;
  ir: number | null;
  emKm: number | null;
  irKm: number | null;
  coolingLoadPct: number | null;
  sheet: PowerSheet;
}

const SEGMENT_ORDER: readonly string[] = ['weapons', 'shields', 'thrusters', 'quantum', 'radar', 'coolers', 'life', 'tractor'];

export function buildEnergy(input: HoloEnergyInput, previous?: PowerSheet | null): HoloEnergy {
  const sheet = computePowerSheet({
    occupants: input.occupants,
    shipStats: input.shipStats,
    schemaVersion: input.schemaVersion,
    mode: input.mode,
    cutGroups: input.cutGroups,
    levels: input.levels,
    previous,
  });
  const rows = sheet.groups.filter((g) => g.group !== 'tractor' || g.state !== 'absent');
  rows.sort((a, b) => SEGMENT_ORDER.indexOf(a.group) - SEGMENT_ORDER.indexOf(b.group) || (a.unit ?? 0) - (b.unit ?? 0));
  const fact = (k: string) => sheet.facts.find((f) => f.key === k)?.value ?? null;
  return {
    segments: rows.map((g) => ({
      key: g.key,
      labelKey: g.labelKey,
      labelParams: g.labelParams,
      used: g.allocated,
      max: g.capacity,
      minimum: g.minimum,
      present: g.state !== 'absent',
      cut: g.cut,
      state: g.state,
    })),
    generator: { used: sheet.budgetUsed, available: sheet.budgetTotal },
    em: fact('em'),
    ir: fact('ir'),
    emKm: signatureToKm(fact('em')),
    irKm: signatureToKm(fact('ir')),
    coolingLoadPct: sheet.coolant.percent,
    sheet,
  };
}

/**
 * The input after the pilot sets ONE group's bar to `segments`: 0 cuts the
 * group, anything else pins its level (and lifts a cut). Never mutates.
 */
export function withGroupSegments(input: HoloEnergyInput, key: PowerColumnKey, segments: number): HoloEnergyInput {
  const cut = new Set<PowerColumnKey>(input.cutGroups ?? []);
  const levels: Partial<Record<PowerColumnKey, number>> = { ...(input.levels ?? {}) };
  if (!(segments > 0)) cut.add(key);
  else {
    cut.delete(key);
    levels[key] = Math.floor(segments);
  }
  return { ...input, cutGroups: cut, levels };
}

export interface EnergyConsequences {
  energy: HoloEnergy;
  emKm: number | null;
  irKm: number | null;
  coolingLoadPct: number | null;
  /** The Offensive lead number after the change: scaled with the weapons column, 0 when cut. */
  offensiveLead: number | null;
  /** New − old, null where either side is a gap. */
  delta: { emKm: number | null; irKm: number | null; coolingLoadPct: number | null; offensiveLead: number | null };
}

/**
 * The Offensive lead after the weapons column changed: 0 segments → 0.
 * Approximation, not the game's exact curve: energy weapons (no magazine in
 * their data) scale their DPS with assigned / max weapon segments, ballistic
 * weapons (with ammo) keep their DPS until the column is at 0. The lead is
 * split by each gun's share of the DPS; without any weapon data everything
 * scales linearly.
 */
export function scaledOffensiveLead(occupants: readonly SummaryOccupant[], sheet: PowerSheet, baseLead: number): number {
  if (sheet.weaponsCut) return 0;
  const row = sheet.groups.find((g) => g.group === 'weapons' && g.key === 'weapons');
  if (!row || !(row.capacity > 0)) return baseLead;
  const ratio = Math.max(0, Math.min(1, row.allocated / row.capacity));
  const weapons = holoWeapons(occupants);
  const dps = (w: HoloWeapon): number => w.sustainedDps ?? w.burstDps;
  const total = weapons.reduce((s, w) => s + dps(w), 0);
  if (total <= 0) return round1(baseLead * ratio);
  const ballistic = weapons.filter((w) => w.ballistic).reduce((s, w) => s + dps(w), 0) / total;
  return round1(baseLead * (ballistic + (1 - ballistic) * ratio));
}

/**
 * Recomputes signature (EM km, IR km), cooling load and the Offensive lead
 * number when one group's segments change (e.g. weapons set to 0).
 * Offensive lead: see {@link scaledOffensiveLead}.
 */
export function recomputeEnergy(
  base: HoloEnergyInput,
  key: PowerColumnKey,
  segments: number,
  baseLead: number | null,
): EnergyConsequences {
  const before = buildEnergy(base);
  const energy = buildEnergy(withGroupSegments(base, key, segments), before.sheet);
  const offensiveLead = baseLead === null ? null : scaledOffensiveLead(base.occupants, energy.sheet, baseLead);
  const diff = (a: number | null, b: number | null): number | null =>
    a === null || b === null || a === b ? null : round1(a - b);
  return {
    energy,
    emKm: energy.emKm,
    irKm: energy.irKm,
    coolingLoadPct: energy.coolingLoadPct,
    offensiveLead,
    delta: {
      emKm: diff(energy.emKm, before.emKm),
      irKm: diff(energy.irKm, before.irKm),
      coolingLoadPct: diff(energy.coolingLoadPct, before.coolingLoadPct),
      offensiveLead: baseLead === null ? null : diff(offensiveLead, baseLead),
    },
  };
}

// ── the model ────────────────────────────────────────────────────────────────

export interface HoloCategoryBase<Id extends HoloCategoryId, T> {
  id: Id;
  lead: HoloLead;
  /** Per-part share of the category total (empty where the category has no parts). */
  parts: HoloPart[];
  detail: T;
}

export type HoloOffensiveModel = HoloCategoryBase<'offensive', HoloOffensive>;
export type HoloDefensiveModel = HoloCategoryBase<'defensive', HoloDefensive>;
export type HoloMovementModel = HoloCategoryBase<'movement', HoloMovement>;
export type HoloSignatureModel = HoloCategoryBase<'signature', HoloSignature>;

export interface HoloCategoryModel {
  offensive: HoloOffensiveModel;
  defensive: HoloDefensiveModel;
  movement: HoloMovementModel;
  signature: HoloSignatureModel;
  energy: HoloEnergy;
  /** Per-row shares of the Verteidigung / Bewegung / Signatur columns (Offensive uses `offensive.parts`). */
  rowShares: RowShareGroup[];
  /** The full sheet (hull, armour, cargo, signature included) the numbers come from. */
  sheet: KpiSheet;
}

export interface HoloCategoryInput {
  occupants: readonly SummaryOccupant[];
  ship: KpiShipInput | null | undefined;
  schemaVersion?: number | null;
  /** Ships of the chosen comparison group (use `filterCohort`); null = no rank / median. */
  cohort?: readonly RankShipInput[] | null;
  /** Another KPI as a category's lead number (the chosen deployment decides it). */
  leadKeys?: Partial<Record<HoloCategoryId, KpiKey>>;
  energy?: Pick<HoloEnergyInput, 'mode' | 'cutGroups' | 'levels'>;
}

export function buildHoloCategoryModels(input: HoloCategoryInput): HoloCategoryModel {
  const { occupants, ship, cohort = null } = input;
  const sheet = withPowerSignature(
    computeKpiSheet(occupants, ship),
    occupants,
    ship?.stats ?? null,
    input.schemaVersion,
  );
  const leadKey = (id: HoloCategoryId): KpiKey => input.leadKeys?.[id] ?? HOLO_LEAD_KEY[id];
  const lead = (id: HoloCategoryId): HoloLead => buildLead(leadKey(id), sheet[leadKey(id)], cohort);

  const energy = buildEnergy({
    occupants,
    shipStats: ship?.stats ?? null,
    schemaVersion: input.schemaVersion,
    ...input.energy,
  });

  const offensive = buildOffensive(occupants, sheet);
  const medianSustained = median(cohortValues(cohort, 'sustainedDps'));
  const defensive = buildDefensive(occupants, ship, medianSustained);
  const movement = buildMovement(ship, sheet);

  const cs = crossSectionAxes(ship?.stats);
  const csMax = [cs.x, cs.y, cs.z].filter((v): v is number => v !== null);
  const armor = armorSignalMultipliers(findArmorPayload(occupants));
  const crossSection =
    csMax.length > 0 ? Math.round(Math.max(...csMax) * (armor?.crossSection ?? 1)) : null;
  const factValue = (k: string) => energy.sheet.facts.find((f) => f.key === k)?.value ?? null;
  const ir = sheet.ir ?? factValue('ir');
  const em = sheet.emLoad ?? factValue('em');
  const emSources = emBySource(occupants, energy.sheet);
  const coolerOutput = energy.sheet.coolant.total;
  const signature: HoloSignature = {
    irKm: signatureToKm(ir),
    emKm: signatureToKm(em),
    crossSectionKm: signatureToKm(crossSection),
    ir,
    em,
    crossSection,
    irClass: classShare(ir, cohortValues(cohort, 'ir')),
    emClass: classShare(em, cohortValues(cohort, 'emLoad')),
    coolingLoadPct: energy.coolingLoadPct,
    coolerOutput,
    coolerOutputClass: classShare(coolerOutput, []),
    fuel: null,
    emSources,
    decoys: decoysNeeded(occupants, { ir, em, crossSection }),
    parts: emSources,
  };

  return {
    offensive: { id: 'offensive', lead: lead('offensive'), parts: offensive.parts, detail: offensive },
    defensive: { id: 'defensive', lead: lead('defensive'), parts: defensive.parts, detail: defensive },
    movement: { id: 'movement', lead: lead('movement'), parts: [], detail: movement },
    signature: { id: 'signature', lead: lead('signature'), parts: signature.parts, detail: signature },
    energy,
    rowShares: buildRowShareGroups(occupants),
    sheet,
  };
}
