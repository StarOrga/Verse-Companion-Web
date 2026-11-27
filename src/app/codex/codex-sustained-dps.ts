// Sustained DPS — the one source of truth (feedback #343).
// -----------------------------------------------------------------------------
// Burst DPS is alpha × fire rate: the gun firing without a pause. Sustained DPS
// averages a whole fire cycle, pauses included:
//
//   sustained = burst × fireTime / (fireTime + downtime)
//
// One cycle per limit the payload carries, and the binding (lowest) one wins:
//
//   energy pool  fireTime = (pool / costPerShot) / shotsPerSecond
//                downtime = regen cooldown + pool / regenPerSecond
//                (the pool drains, regen waits for the cooldown, then refills)
//   magazine     fireTime = ammoCapacity / shotsPerSecond
//                downtime = reload time
//   heat         fireTime = (overheat − start temperature) / (heatPerShot × shotsPerSecond)
//                downtime = overheat fix time
//
// Never invented: a weapon whose payload carries none of the three cycles
// gets `null` — the caller renders a gap with its own wording, it does NOT
// fall back to the burst number (that was the bug: both KPI cells showed the
// same figure). The only defaults are neutral ones that can lengthen nothing:
// cost per shot 1, cooldown 0, start temperature = min temperature or 0.
//
// Field names: the extractor (dataforge_extract.py `_weapon_cycle_params`)
// copies the regen-consumer and simplified-heat structs verbatim under
// `regen.` / `heat.`; candidates below cover the known DataCore spellings.

import { toFiniteNumber } from '../hangar/loadout-stats';

export type SustainedLimit = 'energyPool' | 'magazine' | 'heat';

export interface SustainedDpsResult {
  /** Damage per second over a full cycle, or null when no cycle is known. */
  value: number | null;
  /** Which limit produced `value` (the binding one), null with no value. */
  limit: SustainedLimit | null;
  fireTime: number | null;
  downtime: number | null;
}

const NONE: SustainedDpsResult = { value: null, limit: null, fireTime: null, downtime: null };

type Params = Record<string, unknown> | null | undefined;

function pick(p: Params, keys: readonly string[]): number | null {
  if (!p) return null;
  for (const k of keys) {
    const v = toFiniteNumber(p[k]);
    if (v !== null) return v;
  }
  return null;
}

function positive(v: number | null): number | null {
  return v !== null && v > 0 && v < 1e30 ? v : null;
}

const POOL = ['regen.maxAmmoLoad', 'regen.requestedAmmoLoad', 'regen.ammoLoad'];
const REGEN_PER_SEC = ['regen.requestedRegenPerSec', 'regen.regenPerSec', 'regen.maxRegenPerSec'];
const REGEN_COOLDOWN = ['regen.regenerationCooldown', 'regen.cooldown'];
const COST_PER_SHOT = ['regen.regenerationCostPerBullet', 'regen.costPerBullet', 'regen.costPerShot'];
const MAGAZINE = ['ammoCapacity'];
const RELOAD = ['reloadTime', 'reloadDuration', 'reload.time'];
const HEAT_PER_SHOT = ['heatPerShot'];
const OVERHEAT = ['heat.overheatTemperature', 'heat.maxTemperature'];
const START_TEMP = ['heat.temperatureAfterOverheatFix', 'heat.minTemperature'];
const OVERHEAT_FIX = ['heat.overheatFixTime', 'heat.overheatTime'];

interface Cycle {
  limit: SustainedLimit;
  fireTime: number;
  downtime: number;
}

/**
 * The weapon regen struct carries TWO consistent pairs, in different units
 * (LIVE 4.10.3, KLWE_LaserRepeater_S3):
 *   * `maxAmmoLoad` 75 / `maxRegenPerSec` 15 — SHOTS (the capacitor the pilot
 *     sees; star-citizen.wiki prints exactly these as "max ammo / regen");
 *   * `requestedAmmoLoad` 18187 / `requestedRegenPerSec` 3031 — ENERGY units,
 *     drained at `regenerationCostPerBullet` 48.5 per shot.
 * Mixing them (75 shots ÷ 48.5 per shot) collapsed the fire time to 1.5 shots
 * and the sustained DPS to a seventh of the burst. A complete pair always wins;
 * only a payload with neither pair falls back to the loose candidate lists.
 */
function energyPair(p: Params): { pool: number; regen: number; cost: number } | null {
  const shots = positive(pick(p, ['regen.maxAmmoLoad']));
  const shotsRegen = positive(pick(p, ['regen.maxRegenPerSec']));
  if (shots !== null && shotsRegen !== null) return { pool: shots, regen: shotsRegen, cost: 1 };
  const energy = positive(pick(p, ['regen.requestedAmmoLoad']));
  const energyRegen = positive(pick(p, ['regen.requestedRegenPerSec']));
  if (energy !== null && energyRegen !== null) {
    return { pool: energy, regen: energyRegen, cost: positive(pick(p, COST_PER_SHOT)) ?? 1 };
  }
  return null;
}

function energyCycle(p: Params, sps: number): Cycle | null {
  const pair = energyPair(p);
  if (pair) {
    const cooldown = Math.max(0, pick(p, REGEN_COOLDOWN) ?? 0);
    return { limit: 'energyPool', fireTime: pair.pool / pair.cost / sps, downtime: cooldown + pair.pool / pair.regen };
  }
  const pool = positive(pick(p, POOL));
  const regen = positive(pick(p, REGEN_PER_SEC));
  if (pool === null || regen === null) return null;
  const cost = positive(pick(p, COST_PER_SHOT)) ?? 1;
  const cooldown = Math.max(0, pick(p, REGEN_COOLDOWN) ?? 0);
  return { limit: 'energyPool', fireTime: pool / cost / sps, downtime: cooldown + pool / regen };
}

function magazineCycle(p: Params, sps: number): Cycle | null {
  const mag = positive(pick(p, MAGAZINE));
  const reload = positive(pick(p, RELOAD));
  if (mag === null || reload === null) return null;
  return { limit: 'magazine', fireTime: mag / sps, downtime: reload };
}

function heatCycle(p: Params, sps: number): Cycle | null {
  const perShot = positive(pick(p, HEAT_PER_SHOT));
  const overheat = positive(pick(p, OVERHEAT));
  const fix = positive(pick(p, OVERHEAT_FIX));
  if (perShot === null || overheat === null || fix === null) return null;
  const start = Math.max(0, pick(p, START_TEMP) ?? 0);
  const headroom = overheat - start;
  if (headroom <= 0) return null;
  return { limit: 'heat', fireTime: headroom / (perShot * sps), downtime: fix };
}

/**
 * Sustained DPS of ONE weapon from its burst DPS, fire rate (rounds/min) and
 * `weaponParams`. See the header for the formula and what counts as missing.
 */
export function sustainedDps(
  burstDps: number | null,
  fireRateRpm: number | null,
  weaponParams: Params,
): SustainedDpsResult {
  if (burstDps === null || !(burstDps > 0)) return NONE;
  const rpm = positive(fireRateRpm);
  if (rpm === null) return NONE;
  const sps = rpm / 60;
  let best: { cycle: Cycle; value: number } | null = null;
  for (const cycle of [energyCycle(weaponParams, sps), magazineCycle(weaponParams, sps), heatCycle(weaponParams, sps)]) {
    if (!cycle) continue;
    const value = (burstDps * cycle.fireTime) / (cycle.fireTime + cycle.downtime);
    if (!best || value < best.value) best = { cycle, value };
  }
  if (!best) return NONE;
  return {
    value: Math.round(best.value * 100) / 100,
    limit: best.cycle.limit,
    fireTime: best.cycle.fireTime,
    downtime: best.cycle.downtime,
  };
}

/** One limit's cycle of a weapon, with the DPS that limit alone would give. */
export interface SustainedCycleInfo {
  limit: SustainedLimit;
  /** Seconds of uninterrupted fire before this limit stops the gun. */
  fireTime: number;
  /** Seconds the gun is down afterwards. */
  downtime: number;
  /** Cycle-averaged DPS if only this limit applied. */
  value: number;
}

/**
 * EVERY limit cycle a weapon carries, shortest burst first — the data the
 * fire timeline draws ("until 3,4 s (heat), until 12 s (magazine)").
 * {@link sustainedDps} stays the one source for the sustained number; the
 * binding cycle there is the one with the lowest `value` here.
 */
export function sustainedCycles(
  burstDps: number | null,
  fireRateRpm: number | null,
  weaponParams: Params,
): SustainedCycleInfo[] {
  if (burstDps === null || !(burstDps > 0)) return [];
  const rpm = positive(fireRateRpm);
  if (rpm === null) return [];
  const sps = rpm / 60;
  const out: SustainedCycleInfo[] = [];
  for (const c of [energyCycle(weaponParams, sps), magazineCycle(weaponParams, sps), heatCycle(weaponParams, sps)]) {
    if (!c) continue;
    out.push({
      limit: c.limit,
      fireTime: c.fireTime,
      downtime: c.downtime,
      value: Math.round(((burstDps * c.fireTime) / (c.fireTime + c.downtime)) * 100) / 100,
    });
  }
  return out.sort((a, b) => a.fireTime - b.fireTime);
}

/** `weaponParams` of a weapon payload, or undefined. */
export function weaponParamsOf(payload: unknown): Record<string, unknown> | undefined {
  const wp = (payload as { weaponParams?: unknown } | null | undefined)?.weaponParams;
  return wp && typeof wp === 'object' ? (wp as Record<string, unknown>) : undefined;
}
