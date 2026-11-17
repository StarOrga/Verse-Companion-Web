/**
 * The beta holotable's interior (concept 20261117-1810, B1–B10): pure rules
 * over `ShipPayload.interior` — validation, the element groups and their
 * chips, the role presets with their start deck, the deck filter's SCU, the
 * cargo gap, the Bauteile overview, a room's contents and the mini search.
 *
 * Nothing here touches Angular or storage: the stage holds the state, and
 * every open starts from the role preset again (r2-remember = none).
 */
import type {
  ShipCargoGrid,
  ShipDoorKind,
  ShipInterior,
  ShipInteriorCat,
  ShipInteriorGroup,
  ShipInteriorPoi,
  ShipLift,
} from '../codex.types';
import { foldText, fuzzyScore } from './codex-holo-fuzzy';

/** The chips in their row order (r1-scope + doors). */
export const INTERIOR_GROUPS: readonly ShipInteriorGroup[] = ['cargo', 'ways', 'med', 'weapons', 'lockers', 'fire', 'tech', 'living', 'doors'];

export const GROUP_OF_CAT: Readonly<Record<ShipInteriorCat, ShipInteriorGroup>> = {
  lift: 'ways', stairs: 'ways', ladder: 'ways', ramp: 'ways', airlock: 'ways', dockingTube: 'ways', escapePod: 'ways',
  medBed: 'med', respawn: 'med',
  weaponRack: 'weapons', locker: 'lockers',
  fireExt: 'fire',
  relay: 'tech', powerPlant: 'tech', cooler: 'tech', shield: 'tech', quantumDrive: 'tech', jumpDrive: 'tech',
  lifeSupport: 'tech', radar: 'tech', fuelTank: 'tech', maintenance: 'tech', turret: 'tech', computer: 'tech',
  bed: 'living', head: 'living',
  door: 'doors',
};

/** Row order of the categories inside a group (the overview lists them in this order). */
const CAT_ORDER = Object.keys(GROUP_OF_CAT) as ShipInteriorCat[];
const DOOR_KINDS: readonly ShipDoorKind[] = ['room', 'inner', 'lift', 'hangar', 'bow', 'airlock', 'ramp', 'cell'];

export function isInteriorCat(v: unknown): v is ShipInteriorCat {
  return typeof v === 'string' && Object.hasOwn(GROUP_OF_CAT, v);
}

/** Glyph per category: a 24×24 path drawn inside the icon's ring (the mocks' `ipi-*` set). */
export type InteriorGlyph = 'lift' | 'stairs' | 'ladder' | 'gun' | 'locker' | 'fire' | 'med' | 'bed' | 'drop' | 'bolt' | 'comp' | 'wrench' | 'door' | 'way';
export const GLYPH_PATHS: Readonly<Record<InteriorGlyph, { d: string; fill: boolean }>> = {
  lift: { d: 'M8 7h8v10H8z M12 8.5l-2 2h4z M12 15.5l-2-2h4z', fill: true },
  stairs: { d: 'M6 17h4v-3h4v-3h4V7', fill: false },
  ladder: { d: 'M9 6v12M15 6v12M9 9h6M9 12h6M9 15h6', fill: false },
  gun: { d: 'M5 11h11l2-1v3H11l-1 3H8l1-3H5z', fill: true },
  locker: { d: 'M8 6h8v12H8zM12 6v12', fill: false },
  fire: { d: 'M12 5c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 2 1 2 0-3 1-4 1-6z', fill: true },
  med: { d: 'M10.5 6h3v4.5H18v3h-4.5V18h-3v-4.5H6v-3h4.5z', fill: true },
  bed: { d: 'M5 15V9M5 13h14v3M8 13v-2h4v2', fill: false },
  drop: { d: 'M12 5l4 6a4 4 0 1 1-8 0z', fill: true },
  bolt: { d: 'M13 5l-6 8h4l-1 6 6-8h-4z', fill: true },
  comp: { d: 'M12 6l5 3v6l-5 3-5-3V9z', fill: false },
  wrench: { d: 'M14.5 6.5a3 3 0 0 0-3.8 3.8L6 15l3 3 4.7-4.7a3 3 0 0 0 3.8-3.8l-2 2-2-.5-.5-2z', fill: true },
  door: { d: 'M8 11h8v2H8z', fill: true },
  way: { d: 'M6 12h10M13 8l4 4-4 4', fill: false },
};
const CAT_GLYPH: Readonly<Record<ShipInteriorCat, InteriorGlyph>> = {
  lift: 'lift', stairs: 'stairs', ladder: 'ladder', ramp: 'way', airlock: 'way', dockingTube: 'way', escapePod: 'way',
  medBed: 'med', respawn: 'med', weaponRack: 'gun', locker: 'locker', fireExt: 'fire',
  relay: 'bolt', powerPlant: 'comp', cooler: 'comp', shield: 'comp', quantumDrive: 'comp', jumpDrive: 'comp',
  lifeSupport: 'comp', radar: 'comp', fuelTank: 'comp', maintenance: 'wrench', turret: 'gun', computer: 'comp',
  bed: 'bed', head: 'drop', door: 'door',
};
export function glyphOf(cat: ShipInteriorCat): InteriorGlyph {
  return CAT_GLYPH[cat];
}
/** The chip's glyph per group. */
export const GROUP_GLYPH: Readonly<Record<ShipInteriorGroup, InteriorGlyph>> = {
  cargo: 'comp', ways: 'lift', med: 'med', weapons: 'gun', lockers: 'locker', fire: 'fire', tech: 'bolt', living: 'bed', doors: 'door',
};

// ── Validation ─────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length >= n && v.slice(0, n).every(isNum);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * The interior of a payload, validated like the deck plan: a malformed element
 * is dropped, never patched. Null when the payload carries none (every build
 * before the interior extract) — the UI then shows no interior, never zeros.
 */
export function readInterior(raw: unknown): ShipInterior | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ShipInterior>;
  const pois: ShipInteriorPoi[] = (Array.isArray(r.pois) ? r.pois : []).filter(
    (p): p is ShipInteriorPoi => !!p && isInteriorCat(p.cat) && isVec(p.pos, 3) && isStr(p.deck),
  );
  const cargoGrids: ShipCargoGrid[] = (Array.isArray(r.cargoGrids) ? r.cargoGrids : []).filter(
    (g): g is ShipCargoGrid => !!g && isVec(g.pos, 3) && isVec(g.dims, 3) && isNum(g.scu) && isStr(g.deck),
  );
  const lifts: ShipLift[] = (Array.isArray(r.lifts) ? r.lifts : []).filter(
    (l): l is ShipLift => !!l && isVec(l.at, 2) && Array.isArray(l.stops) && l.stops.every(isNum) && Array.isArray(l.decks),
  );
  const cargoGaps = (Array.isArray(r.cargoGaps) ? r.cargoGaps : []).filter((g) => !!g && isStr(g.port));
  if (pois.length === 0 && cargoGrids.length === 0 && lifts.length === 0) return null;
  const located = isNum(r.cargoScuLocated) ? r.cargoScuLocated : cargoGrids.reduce((s, g) => s + g.scu, 0);
  return { pois, cargoGrids, lifts, cargoScuLocated: located, cargoGaps };
}

// ── Role presets (B8) ──────────────────────────────────────────────────────

export type RolePreset = 'combat' | 'cargo' | 'medical' | 'industry' | 'other';
export const PRESET_GROUPS: Readonly<Record<RolePreset, readonly ShipInteriorGroup[]>> = {
  combat: ['weapons', 'doors', 'ways', 'med'],
  cargo: ['cargo', 'ways', 'doors'],
  medical: ['med', 'ways', 'doors'],
  industry: ['cargo', 'tech', 'ways'],
  other: ['ways', 'doors'],
};

/** Keyword → preset, checked in this order on the role key, then on the career. */
const ROLE_RULES: readonly [RegExp, RolePreset][] = [
  [/medic|medical|ambulance|rescue|hospital/, 'medical'],
  [/salvage|mining|miner|refin|industr|resource|repair|construct|craft|tow|fuel|harvest/, 'industry'],
  [/freight|cargo|hauler|haul|transport|courier|logistic|trade|merchant|container/, 'cargo'],
  [/fight|frigate|destroyer|corvette|gunship|bomber|combat|carrier|capital|interdict|military|interceptor|dropship|snub|cruiser|torpedo|missile|stealth|patrol|militia|assault|gunboat/, 'combat'],
];

function roleToken(key: string | null | undefined): string {
  return (key ?? '').trim().toLowerCase().replace(/^@/, '').replace(/^(vehicle_class_|vehicle_focus_|item_shipfocus_)/, '').replace(/[_\s-]+/g, '');
}

/** The preset group of a ship: its role key (`@vehicle_class_MediumFreight`), else its career; unknown → `other`. */
export function rolePresetOf(role: string | null | undefined, career?: string | null): RolePreset {
  for (const key of [role, career]) {
    const t = roleToken(key);
    if (!t) continue;
    for (const [re, preset] of ROLE_RULES) if (re.test(t)) return preset;
  }
  return 'other';
}

/** SCU per deck key, from the located grids. */
export function scuByDeck(interior: ShipInterior | null): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const g of interior?.cargoGrids ?? []) out.set(g.deck, (out.get(g.deck) ?? 0) + g.scu);
  return out;
}

/**
 * The deck a preset opens on: for a cargo preset the deck with the most SCU;
 * else the deck with the most elements of the preset's groups (doors only
 * count when nothing else does — they are everywhere); else the first deck.
 * Only decks in `deckKeys` (the ones the filter offers) qualify.
 */
export function startDeckOf(interior: ShipInterior | null, preset: RolePreset, deckKeys: readonly string[]): string | null {
  if (deckKeys.length === 0) return null;
  const offered = new Set(deckKeys);
  const best = (score: ReadonlyMap<string, number>): string | null => {
    let key: string | null = null;
    let top = 0;
    for (const k of deckKeys) {
      const v = score.get(k) ?? 0;
      if (v > top) {
        top = v;
        key = k;
      }
    }
    return key;
  };
  const groups = PRESET_GROUPS[preset];
  if (groups.includes('cargo')) {
    const byScu = best(scuByDeck(interior));
    if (byScu) return byScu;
  }
  const count = (withDoors: boolean) => {
    const m = new Map<string, number>();
    for (const p of interior?.pois ?? []) {
      const g = GROUP_OF_CAT[p.cat];
      if (!offered.has(p.deck) || !groups.includes(g) || (g === 'doors') !== withDoors) continue;
      m.set(p.deck, (m.get(p.deck) ?? 0) + 1);
    }
    return m;
  };
  return best(count(false)) ?? best(count(true)) ?? deckKeys[0];
}

// ── Cargo gap (B10) ────────────────────────────────────────────────────────

/** Located vs ship SCU when the extract placed less than the ship holds; null = no gap to report. */
export function cargoGapOf(shipScu: number | null | undefined, interior: ShipInterior | null): { located: number; total: number } | null {
  if (!interior || !isNum(shipScu) || shipScu <= 0) return null;
  const located = Math.round(interior.cargoScuLocated);
  const total = Math.round(shipScu);
  return located < total ? { located, total } : null;
}

// ── Overview (B6) and room contents (B5) ──────────────────────────────────

/** One overview row: one category (doors: one kind), with the elements behind it. */
export interface InteriorRow {
  id: string;
  group: ShipInteriorGroup;
  cat: ShipInteriorCat | 'grid';
  doorKind: ShipDoorKind | null;
  /** Indices into `interior.pois`, or into `interior.cargoGrids` for `grid`. */
  items: number[];
  /** SCU of the grids behind a `grid` row. */
  scu: number;
}

export interface InteriorGroupBlock {
  group: ShipInteriorGroup;
  rows: InteriorRow[];
  count: number;
}

/**
 * Every element by group and type, counted — for one deck (`deck`) or the
 * whole ship (null). `room` narrows to one room. Groups without an element
 * are left out; the groups come in chip order.
 */
export function interiorOverview(interior: ShipInterior | null, deck: string | null, room: string | null = null): InteriorGroupBlock[] {
  if (!interior) return [];
  const rows = new Map<string, InteriorRow>();
  const take = (p: { deck: string; room?: string }) => (deck === null || p.deck === deck) && (room === null || p.room === room);
  interior.cargoGrids.forEach((g, i) => {
    if (!take(g)) return;
    const row = rows.get('grid') ?? { id: 'grid', group: 'cargo' as const, cat: 'grid' as const, doorKind: null, items: [], scu: 0 };
    row.items.push(i);
    row.scu += g.scu;
    rows.set('grid', row);
  });
  interior.pois.forEach((p, i) => {
    if (!take(p)) return;
    const kind = p.cat === 'door' ? p.door?.kind ?? 'room' : null;
    const id = kind ? `door:${kind}` : p.cat;
    const row = rows.get(id) ?? { id, group: GROUP_OF_CAT[p.cat], cat: p.cat, doorKind: kind, items: [], scu: 0 };
    row.items.push(i);
    rows.set(id, row);
  });
  const rank = (r: InteriorRow) => (r.cat === 'grid' ? -1 : r.doorKind ? CAT_ORDER.length + DOOR_KINDS.indexOf(r.doorKind) : CAT_ORDER.indexOf(r.cat));
  return INTERIOR_GROUPS.map((group) => {
    const list = [...rows.values()].filter((r) => r.group === group).sort((a, b) => rank(a) - rank(b));
    return { group, rows: list, count: list.reduce((s, r) => s + r.items.length, 0) };
  }).filter((b) => b.rows.length > 0);
}

/** What a picked room holds (B5): its elements, its grids and their SCU. */
export interface RoomContents {
  blocks: InteriorGroupBlock[];
  grids: number[];
  scu: number;
  elements: number;
}
export function roomContents(interior: ShipInterior | null, room: string | null): RoomContents | null {
  if (!interior || !room) return null;
  const blocks = interiorOverview(interior, null, room);
  const grids = interior.cargoGrids.flatMap((g, i) => (g.room === room ? [i] : []));
  const scu = grids.reduce((s, i) => s + interior.cargoGrids[i].scu, 0);
  return { blocks, grids, scu, elements: blocks.reduce((s, b) => s + b.count, 0) };
}

/** `hardpoint_relay_messhall_left` → "Messhall Left" (the relay's readable part). */
export function relayLabel(port: string): string {
  const core = port.replace(/^hardpoint_/i, '').replace(/^relay_?/i, '').replace(/_?relay$/i, '');
  const words = core.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return port;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── Selection ──────────────────────────────────────────────────────────────

/** A picked element: a POI or a cargo grid, by index. */
export interface InteriorPick {
  kind: 'poi' | 'grid';
  index: number;
}

/** The deck an element stands on. */
export function deckOfPick(interior: ShipInterior | null, pick: InteriorPick | null): string | null {
  if (!interior || !pick) return null;
  return (pick.kind === 'grid' ? interior.cargoGrids[pick.index] : interior.pois[pick.index])?.deck ?? null;
}

/** The first element of a row, preferring the deck on the table. */
export function firstOfRow(interior: ShipInterior, row: InteriorRow, deck: string | null): InteriorPick | null {
  const kind = row.cat === 'grid' ? 'grid' : 'poi';
  const list = kind === 'grid' ? interior.cargoGrids : interior.pois;
  const onDeck = row.items.find((i) => list[i]?.deck === deck);
  const index = onDeck ?? row.items[0];
  return index === undefined ? null : { kind, index };
}

// ── Mini search (B7) ──────────────────────────────────────────────────────

export type SearchScope = 'outer' | 'inner' | 'both';

/** One thing the search can find. `terms` are what it matches on (translated labels, class names). */
export interface SearchEntry<T> {
  id: string;
  side: 'outer' | 'inner';
  label: string;
  terms: readonly string[];
  /** How many elements stand behind it (a row of 71 doors), 1 for a single part or room. */
  count: number;
  target: T;
}

/**
 * The entries matching `query`, best first; empty for a query under two letters. The label
 * counts in full, every further term (group, type, class name) a little less: "Tür" finds the
 * doors before a turret whose type merely starts the same way.
 */
export function searchEntries<T>(query: string, entries: readonly SearchEntry<T>[], max = 30): SearchEntry<T>[] {
  const q = foldText(query);
  if (q.length < 2) return [];
  // Folding drops the umlaut ("tür" would equal "tur" of "Turret"): a label that holds the query as typed ranks first.
  const typed = query.trim().toLocaleLowerCase();
  const score = (e: SearchEntry<T>) => {
    const s = Math.max(fuzzyScore(q, e.label), ...e.terms.map((t) => (t === e.label ? fuzzyScore(q, t) : fuzzyScore(q, t) - 15)), 0);
    return s > 0 && e.label.toLocaleLowerCase().includes(typed) ? s + 12 : s;
  };
  return entries
    .map((e, i) => ({ e, i, s: score(e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.e);
}

/** Which sides the hits came from — the `codex:parts_search` scope. */
export function searchScopeOf(hits: readonly { side: 'outer' | 'inner' }[]): SearchScope {
  const outer = hits.some((h) => h.side === 'outer');
  const inner = hits.some((h) => h.side === 'inner');
  return outer && inner ? 'both' : inner ? 'inner' : 'outer';
}
