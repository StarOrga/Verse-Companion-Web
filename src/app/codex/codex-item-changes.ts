// Patch changes of one non-ship record: its payload in two builds, diffed leaf by leaf.
// Pure and framework-free. The ship's Änderungen tab compares KPI sheets; an item has no such
// sheet, but its payload is the same JSON in every build (codex_* tables are keyed by build), so
// the numeric leaves of the two payloads are the comparable stats.
import { humanizeKey, isNoiseKey, unitForField } from './codex-format';

/** One stat that differs between two builds. */
export interface ItemChange {
  /** The dotted payload path — a stable track key. */
  readonly path: string;
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly unit?: string;
  /** `worse` is drawn in --sc-warning (a comparison is not an error), `better` in the accent, `neutral` plain. */
  readonly tone: 'better' | 'worse' | 'neutral';
}

const HIGHER_BETTER = /(damage|dps|health|hp|capacity|fire ?rate|rate of fire|range|velocity|speed|regen|rating|ammo|magazine|zoom|armor|resist|absorption|output|energy|pool|power ?(output|generation))/i;
const LOWER_BETTER = /(recoil|spread|heat|mass|weight|cooldown|reload|draw|consumption|delay|signature|decay|drain|price|cost|jitter|kick|deviation|noise)/i;

/** Whether a higher value of this stat is better: true / false, or null when it has no polarity. */
export function higherIsBetter(key: string): boolean | null {
  const k = humanizeKey(key);
  // Lower-better words win: "recoil per shot" must not read as "shot ⇒ more is better".
  if (LOWER_BETTER.test(k)) return false;
  if (HIGHER_BETTER.test(k)) return true;
  return null;
}

const MAX_DEPTH = 6;

function leaves(node: unknown, path: string[], out: Map<string, { key: string; parent: string; value: number }>, depth: number): void {
  if (depth > MAX_DEPTH || node === null || node === undefined) return;
  if (typeof node === 'number') {
    const key = path[path.length - 1];
    if (Number.isFinite(node) && key && !path.some((p) => isNoiseKey(p))) {
      out.set(path.join('.'), { key, parent: path[path.length - 2] ?? '', value: node });
    }
    return;
  }
  // Arrays are positional lists (ports, tiers): an index shift is not a stat change.
  if (typeof node !== 'object' || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) leaves(v, [...path, k], out, depth + 1);
}

/** What changed from `before` to `after` (both are one record's payload); stats on only one side are not changes. */
export function diffItemPayloads(before: unknown, after: unknown): ItemChange[] {
  const a = new Map<string, { key: string; parent: string; value: number }>();
  const b = new Map<string, { key: string; parent: string; value: number }>();
  leaves(before, [], a, 0);
  leaves(after, [], b, 0);
  const changed: { path: string; key: string; parent: string; from: number; to: number }[] = [];
  for (const [path, now] of b) {
    const was = a.get(path);
    if (!was || was.value === now.value) continue;
    changed.push({ path, key: now.key, parent: now.parent, from: was.value, to: now.value });
  }
  const seen = new Map<string, number>();
  for (const c of changed) seen.set(humanizeKey(c.key), (seen.get(humanizeKey(c.key)) ?? 0) + 1);
  return changed.map((c) => {
    const base = humanizeKey(c.key);
    const label = (seen.get(base) ?? 0) > 1 && c.parent ? `${humanizeKey(c.parent)} · ${base}` : base;
    const better = higherIsBetter(c.key);
    const up = c.to > c.from;
    const tone: ItemChange['tone'] = better === null ? 'neutral' : up === better ? 'better' : 'worse';
    return { path: c.path, label, from: c.from, to: c.to, unit: unitForField(c.key), tone };
  });
}
