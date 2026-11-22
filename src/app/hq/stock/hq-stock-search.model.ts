// #354 storage search (concept d83b72d8, round 4 step 1): the pure part of the Lager search (fields Gegenstand, Ort, Menge).
import { normalizeSearch } from '../../codex/codex-search';
import { formatLocationName } from '../now/hq-live.util';
import { groupPlaces, placeInfo } from './hq-stock-places';

const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export type OrtKind = 'none' | 'place' | 'area' | 'text';

/** What the field Ort holds: nothing, one storage place, a planet / system, or free text. */
export interface OrtValue {
  kind: OrtKind;
  /** The typed text, trimmed. */
  text: string;
}

const AREAS = (): string[] => {
  const out = new Set<string>();
  for (const g of groupPlaces([], new Map())) {
    if (g.system) out.add(g.system);
    for (const b of g.bodies) if (b.body) out.add(b.body);
  }
  return [...out];
};

/** Place names of the catalogue plus the reader's own locations (display names, unique). */
export function placeNames(known: readonly string[]): string[] {
  const names = new Map<string, string>();
  for (const g of groupPlaces(known, new Map())) for (const b of g.bodies) for (const p of b.places) names.set(fold(p.name), p.name);
  return [...names.values()];
}

/**
 * Suggestions for the field Ort (or the Standort picker): places, then planets and systems, starting matches first.
 * Empty text lists everything up to `max`.
 */
export function placeSuggestions(known: readonly string[], text: string, opts: { placesOnly?: boolean; max?: number } = {}): string[] {
  const t = fold(text);
  const pool = [...placeNames(known), ...(opts.placesOnly ? [] : AREAS())];
  const scored = pool
    .map((n) => ({ n, f: fold(n) }))
    .filter((x) => !t || x.f.includes(t))
    .sort((a, b) => Number(!a.f.startsWith(t)) - Number(!b.f.startsWith(t)) || a.n.localeCompare(b.n));
  const seen = new Set<string>();
  return scored.filter((x) => (seen.has(x.f) ? false : (seen.add(x.f), true))).slice(0, opts.max ?? 8).map((x) => x.n);
}

export function parseOrt(text: string, known: readonly string[]): OrtValue {
  const t = text.trim();
  if (!t) return { kind: 'none', text: '' };
  const f = fold(t);
  if (placeNames(known).some((n) => fold(n) === f)) return { kind: 'place', text: t };
  if (AREAS().some((n) => fold(n) === f)) return { kind: 'area', text: t };
  return { kind: 'text', text: t };
}

/** Does a stored location lie in what the field Ort names (a place, its planet or system, or part of the name)? */
export function locationMatches(location: string, ort: OrtValue): boolean {
  if (ort.kind === 'none') return true;
  const info = placeInfo(location);
  const f = fold(ort.text);
  if (ort.kind === 'place') return fold(info.name) === f || fold(formatLocationName(location)) === f;
  if (ort.kind === 'area') return fold(info.body ?? '') === f || fold(info.system ?? '') === f;
  return fold(`${info.name}${info.body ?? ''}${info.system ?? ''}`).includes(f);
}

/** Two stored strings for the same place ("Area18" typed, "Stanton3_Area18" logged) are one place. */
export function samePlace(a: string, b: string): boolean {
  return fold(placeInfo(a).name) === fold(placeInfo(b).name);
}

export interface SearchRow {
  location: string;
  name: string;
  qty: number;
  unit: 'pcs' | 'scu';
}

export interface SearchGroup {
  name: string;
  unit: 'pcs' | 'scu';
  total: number;
  rows: SearchRow[];
}

/**
 * Rows matching the item text (every word somewhere in the name; the text may also name a place) and the field Ort,
 * one group per item and unit, most stock first. An empty item text with an Ort lists everything stored there.
 */
export function searchStock(rows: readonly SearchRow[], itemText: string, ort: OrtValue): SearchGroup[] {
  const words = normalizeSearch(itemText.trim()).split(/\s+/).filter(Boolean);
  if (!words.length && ort.kind === 'none') return [];
  const hit = rows.filter((r) => {
    if (r.qty <= 0 || !locationMatches(r.location, ort)) return false;
    if (!words.length) return true;
    const hay = normalizeSearch(`${r.name} ${formatLocationName(r.location)} ${placeInfo(r.location).body ?? ''} ${placeInfo(r.location).system ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
  const groups = new Map<string, SearchGroup>();
  for (const r of hit) {
    const key = `${r.name}\u0000${r.unit}`;
    const g = groups.get(key) ?? { name: r.name, unit: r.unit, total: 0, rows: [] };
    g.total += r.qty;
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** The known item name the text names exactly (case and accents ignored), else null — Einlagern books only known names. */
export function knownItem(rows: readonly SearchRow[], text: string): SearchRow | null {
  const t = normalizeSearch(text.trim());
  if (!t) return null;
  return rows.find((r) => normalizeSearch(r.name) === t) ?? null;
}

/** Distinct item names fitting the text, most stock first (suggestions of the first field). */
export function itemSuggestions(rows: readonly SearchRow[], text: string, max = 8): string[] {
  const t = normalizeSearch(text.trim());
  const totals = new Map<string, number>();
  for (const r of rows) if (!t || normalizeSearch(r.name).includes(t)) totals.set(r.name, (totals.get(r.name) ?? 0) + r.qty);
  return [...totals.entries()]
    .filter(([n]) => normalizeSearch(n) !== t)
    .sort((a, b) => Number(!normalizeSearch(a[0]).startsWith(t)) - Number(!normalizeSearch(b[0]).startsWith(t)) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([n]) => n);
}
