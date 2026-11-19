// Patch changes of one non-ship record: its payload in two builds, diffed leaf by leaf.
// Pure and framework-free. The ship's Änderungen tab compares KPI sheets; an item has no such
// sheet, but its payload is the same JSON in every build (codex_* tables are keyed by build), so
// the numeric leaves of the two payloads are the comparable stats.
//
// Only CURATED stats are listed: every payload key worth showing is in STAT_MAP with its label
// (an i18n key, the same word the Werte tab and the equipped stats use where the stat is shown
// there), its unit and an explicit direction. A key that is not in the map (engine internals,
// ids, geometry numbers, tuning constants) is dropped, never shown under its raw name.

type Dir = 'up' | 'down' | 'neutral';

interface StatDef {
  /** i18n key of the label. */
  readonly label: string;
  readonly unit?: string;
  /** `up`: higher is better, `down`: lower is better, `neutral`: a trade-off, no verdict. */
  readonly dir: Dir;
}

/** One stat that differs between two builds. */
export interface ItemChange {
  /** The dotted payload path, a stable track key. */
  readonly path: string;
  /** i18n key of the curated stat name. */
  readonly labelKey: string;
  readonly from: number;
  readonly to: number;
  readonly unit?: string;
  /** `worse` is drawn in --sc-warning (a comparison is not an error), `better` in the accent, `neutral` plain. */
  readonly tone: 'better' | 'worse' | 'neutral';
}

const EQ = 'codex.equipped.';
const CH = 'codex.detail.changes.stat.';
const SEP = '\u0000';

const DAMAGE_CHANNELS = ['physical', 'energy', 'distortion', 'thermal', 'biochemical', 'stun'] as const;

/**
 * Curated stats, keyed lower-case by the payload key. A flat extractor key is matched whole
 * (`regen.maxAmmoLoad`, `damageMultiplier.DamagePhysical`); a nested one by `parent.key`.
 */
const STAT_MAP: Readonly<Record<string, StatDef>> = (() => {
  const m: Record<string, StatDef> = {
    // Weapons (weaponParams)
    'firerate': { label: `${EQ}fireRate`, unit: 'rpm', dir: 'up' },
    'projectilespeed': { label: `${EQ}projectileSpeed`, unit: 'm/s', dir: 'up' },
    'muzzlevelocity': { label: `${EQ}projectileSpeed`, unit: 'm/s', dir: 'up' },
    'ammocapacity': { label: `${CH}ammoCapacity`, dir: 'up' },
    'reloadtime': { label: `${CH}reloadTime`, unit: 's', dir: 'down' },
    'heatpershot': { label: `${CH}heatPerShot`, dir: 'down' },
    'maxrange': { label: `${EQ}range`, unit: 'm', dir: 'up' },
    'range': { label: `${EQ}range`, unit: 'm', dir: 'up' },
    'spread': { label: `${CH}spread`, dir: 'down' },
    'minspread': { label: `${CH}spread`, dir: 'down' },
    'maxspread': { label: `${CH}spread`, dir: 'down' },
    'recoil': { label: `${CH}recoil`, dir: 'down' },
    // Energy weapons: the pool a gun fires from and how it refills.
    'regen.maxammoload': { label: `${CH}energyPool`, dir: 'up' },
    'regen.requestedregenpersec': { label: `${CH}energyRegen`, unit: '/s', dir: 'up' },
    'regen.regenerationcooldown': { label: `${CH}regenCooldown`, unit: 's', dir: 'down' },
    'regen.regenerationcostperbullet': { label: `${CH}shotCost`, dir: 'down' },
    'heat.overheatfixtime': { label: `${CH}overheatFix`, unit: 's', dir: 'down' },
    // Tractor beam (weaponParams.tractorBeam.*): reach and pull are better with more; the
    // speed band and the cone are a design trade-off.
    'tractorbeam.maxdistance': { label: `${EQ}tractorRange`, unit: 'm', dir: 'up' },
    'tractorbeam.fullstrengthdistance': { label: `${EQ}tractorFullStrengthRange`, unit: 'm', dir: 'up' },
    'tractorbeam.maxforce': { label: `${EQ}tractorForce`, unit: 'N', dir: 'up' },
    'tractorbeam.maxangle': { label: `${EQ}tractorAngle`, unit: '°', dir: 'neutral' },
    'tractorbeam.tetherbreaktime': { label: `${EQ}tractorTetherBreak`, unit: 's', dir: 'up' },
    'tractorbeam.maxspeed': { label: `${EQ}tractorSpeed`, unit: 'm/s', dir: 'neutral' },
    // Components (stats.<struct>.<field>)
    'health': { label: `${EQ}health`, unit: 'HP', dir: 'up' },
    'sdistortionparams.maximum': { label: `${EQ}distortion`, dir: 'up' },
    'maxshieldhealth': { label: `${EQ}shieldHp`, unit: 'HP', dir: 'up' },
    'maxshieldregen': { label: `${EQ}shieldRegen`, unit: 'HP/s', dir: 'up' },
    'damagedregendelay': { label: `${EQ}regenDelay`, unit: 's', dir: 'down' },
    'downedregendelay': { label: `${EQ}downedDelay`, unit: 's', dir: 'down' },
    'jumprange': { label: `${EQ}jumpRange`, dir: 'up' },
    'drivespeed': { label: `${EQ}driveSpeed`, unit: 'm/s', dir: 'up' },
    'spooluptime': { label: `${EQ}spoolTime`, unit: 's', dir: 'down' },
    'cooldowntime': { label: `${EQ}cooldown`, unit: 's', dir: 'down' },
    'quantumfuelrequirement': { label: `${EQ}fuelRate`, dir: 'down' },
    'coolingrate': { label: `${EQ}coolingRate`, dir: 'up' },
    'online.power.consumesegments': { label: `${EQ}powerDraw`, dir: 'down' },
    'online.power.generatesegments': { label: `${EQ}powerOutput`, dir: 'up' },
    'online.em.nominal': { label: `${EQ}emSignature`, dir: 'down' },
    'online.ir.nominal': { label: `${EQ}irSignature`, dir: 'down' },
    // Items (armour, backpacks, attachments)
    'mass': { label: `${CH}mass`, dir: 'down' },
    'capacity': { label: `${CH}capacity`, dir: 'up' },
    'storagecapacity': { label: `${CH}capacity`, dir: 'up' },
    'inventorycapacity': { label: `${CH}capacity`, dir: 'up' },
    'temperaturemin': { label: `${CH}temperatureMin`, unit: '°C', dir: 'neutral' },
    'temperaturemax': { label: `${CH}temperatureMax`, unit: '°C', dir: 'neutral' },
  };
  // Damage a weapon deals per channel, and the damage armour lets through (a multiplier: lower is better).
  for (const ch of DAMAGE_CHANNELS) {
    m[`impactdamage.${ch}`] = { label: `${CH}damage.${ch}`, dir: 'up' };
    m[`damagemultiplier.damage${ch}`] = { label: `${CH}taken.${ch}`, dir: 'down' };
  }
  return m;
})();

const MAX_DEPTH = 6;

/** The curated stat a payload path stands for, or null (the row is dropped). Tries the last 3, 2, 1 segments. */
export function curatedStat(path: readonly string[]): StatDef | null {
  const low = path.map((p) => p.toLowerCase());
  for (let n = Math.min(3, low.length); n >= 1; n--) {
    const def = STAT_MAP[low.slice(low.length - n).join('.')];
    if (def) return def;
  }
  return null;
}

/** Whether a higher value of this stat is better: true / false, or null for a trade-off or an unmapped key. */
export function higherIsBetter(path: readonly string[]): boolean | null {
  const dir = curatedStat(path)?.dir;
  return dir === 'up' ? true : dir === 'down' ? false : null;
}

function leaves(node: unknown, path: string[], out: Map<string, number>, depth: number): void {
  if (depth > MAX_DEPTH || node === null || node === undefined) return;
  if (typeof node === 'number') {
    if (Number.isFinite(node) && path.length > 0 && curatedStat(path)) out.set(path.join(SEP), node);
    return;
  }
  // Arrays are positional lists (ports, tiers): an index shift is not a stat change.
  if (typeof node !== 'object' || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) leaves(v, [...path, k], out, depth + 1);
}

/** What changed from `before` to `after` (both are one record's payload); stats on only one side or not curated are not changes. */
export function diffItemPayloads(before: unknown, after: unknown): ItemChange[] {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  leaves(before, [], a, 0);
  leaves(after, [], b, 0);
  const out: ItemChange[] = [];
  for (const [joined, to] of b) {
    const from = a.get(joined);
    if (from === undefined || from === to) continue;
    const parts = joined.split(SEP);
    const def = curatedStat(parts);
    if (!def) continue;
    const better = def.dir === 'up' ? true : def.dir === 'down' ? false : null;
    const tone: ItemChange['tone'] = better === null ? 'neutral' : to > from === better ? 'better' : 'worse';
    out.push({ path: parts.join('.'), labelKey: def.label, from, to, unit: def.unit, tone });
  }
  return out;
}
