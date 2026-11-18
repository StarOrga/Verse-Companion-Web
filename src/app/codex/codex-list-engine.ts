import type { CodexKind, CodexListFilters, ListPayload } from './codex.service';
import { ilikeTokenGroups, searchMatcher } from './codex-search';

/**
 * Answers Codex list reads from a build's list snapshot (codex-lists/<build>/…
 * in R2, written by supabase/functions/ingest-catalog/_list-snapshots.ts) with
 * exactly the rows the PostgREST query of `CodexService` would return. Pure:
 * no Angular, no I/O. Every function answers `null` ("decline") when it cannot
 * be sure of the same answer — the caller then runs the database query.
 *
 * Semantics mirrored from SQL/PostgREST:
 *  - `eq` / `in` never match NULL; `gte` / `lte` neither;
 *  - `like` / `ilike`: `*` (PostgREST) = `%`, `_` = one character, anchored;
 *    `ilike` case-insensitive;
 *  - `payload->>key` is the JSON value as text (a string unquoted);
 *  - `match` is a case-sensitive POSIX regex — only a small subset that means
 *    the same in a JS RegExp is translated, anything else declines.
 */

/** Payload keys a list card reads (browse, search hits, hangar/HQ ship cards). */
export const CARD_PAYLOAD_KEYS: readonly string[] = ['name', 'previewImage', 'manufacturer'];

/**
 * Ship-table records that are no ship a player can own or fly (salvage
 * wrecks, orbital sentries, comm probes) — see applyDefaultBrowseFilters.
 */
export const NON_SHIP_VEHICLE_PREFIXES = ['SalvageableDebris', 'Orbital_Sentry', 'probe_'] as const;

/**
 * `codex_items.attach_type` values that are engine plumbing, never a player
 * item (measured on LIVE 4.10.0, 2026-10-07: ~6 000 of 23 600 item rows).
 * Hidden from every list, count and search; a detail page reached through a
 * ship's port list still opens.
 */
export const INTERNAL_ITEM_ATTACH_TYPES: readonly string[] = [
  'AIModule', 'AirTrafficController', 'AmmoBox', 'AttachedPart', 'Audio', 'Button',
  'CapacitorAssignmentController', 'Char_Accessory_Head', 'Char_Body', 'Char_Flair', 'Char_Hair_Color',
  'Char_Hair_Prop', 'Char_Head', 'Char_Head_Beard', 'Char_Head_Eyebrow', 'Char_Head_Eyelash',
  'Char_Head_Eyes', 'Char_Head_Hair', 'Char_Head_Piercings', 'Char_Head_Stubble', 'Char_Lens',
  'Char_Skin_Color', 'CommsController', 'Container', 'ControlPanel', 'CoolerController', 'Debris',
  'Decal', 'DockingAnimator', 'DockingCollar', 'Door', 'DoorController', 'Display', 'Elevator',
  'EnergyController', 'FPS_Radar', 'FuelController', 'Hangar', 'LandingGear', 'LandingSystem',
  'LifeSupportVent', 'Light', 'LightController', 'Lightgroup', 'MiningController', 'MissileController',
  'NOITEM_Player', 'NOITEM_Vehicle', 'PersistentHab', 'Player', 'Relay', 'RemoteConnection', 'Room',
  'SalvageController', 'SalvageFieldEmitter', 'SalvageFieldSupporter', 'SalvageFillerStation',
  'SalvageInternalStorage', 'Seat', 'SeatAccess', 'SeatDashboard', 'Sensor', 'ShieldController',
  'ShopDisplay', 'StatusScreen', 'TargetSelector', 'Thumbnail', 'Visor', 'WeaponController',
  'WheeledController',
];

/** A list file name: a kind, or the ship rank slice. */
export type ListSnapshotName = CodexKind | 'ship-rank';

const SHIP_COLUMNS = ['class_name', 'guid', 'name_localized', 'manufacturer_code', 'role', 'crew_size', 'is_variant'] as const;
/**
 * The list columns of each file, in row order — the `LIST_SELECT` of
 * codex.service.ts without `payload` (codex-list-engine.spec pins the two
 * together). A file whose `columns` do not start with these is not used.
 */
export const SNAPSHOT_COLUMNS: Record<ListSnapshotName, readonly string[]> = {
  ship: SHIP_COLUMNS,
  'ship-rank': SHIP_COLUMNS,
  weapon: ['class_name', 'name_localized', 'manufacturer_code', 'weapon_class', 'attach_type', 'sub_type', 'size', 'grade', 'is_variant'],
  component: ['class_name', 'name_localized', 'manufacturer_code', 'kind', 'attach_type', 'sub_type', 'size', 'grade', 'is_variant'],
  item: ['class_name', 'name_localized', 'manufacturer_code', 'attach_type', 'sub_type', 'size', 'grade', 'is_variant'],
  ammunition: ['class_name', 'name_localized', 'speed', 'lifetime', 'size'],
  manufacturer: ['class_name', 'name_localized', 'manufacturer_code'],
  blueprint: ['class_name', 'name_localized', 'category', 'tier', 'craft_time_seconds', 'dismantle_time_seconds'],
};

/** Payload keys of the ship card file (must match SHIP_PAYLOAD_KEYS of the publisher). */
const SHIP_FILE_PAYLOAD_KEYS: readonly string[] = [...CARD_PAYLOAD_KEYS, 'sizeClass', 'career', 'dimensions'];

/** One parsed list file, indexed for lookups. */
export interface ListSnapshot {
  name: ListSnapshotName;
  columns: readonly string[];
  payloadKeys: readonly string[];
  /** All rows of the kind in the build, in list order. */
  rows: readonly (readonly unknown[])[];
  /** Column name → index into a row. */
  col: ReadonlyMap<string, number>;
  /** Payload key → index into a row. */
  key: ReadonlyMap<string, number>;
}

export function makeSnapshot(
  name: ListSnapshotName,
  columns: readonly string[],
  payloadKeys: readonly string[],
  rows: readonly (readonly unknown[])[],
): ListSnapshot {
  const col = new Map(columns.map((c, i) => [c, i] as const));
  const key = new Map(payloadKeys.map((k, i) => [k, columns.length + i] as const));
  return { name, columns, payloadKeys, rows, col, key };
}

/** Every filter key the engine understands; any other key declines. */
const KNOWN_FILTERS: ReadonlySet<string> = new Set<keyof CodexListFilters>([
  'payload', 'search', 'manufacturer', 'size', 'grade', 'componentKind', 'weaponClass', 'subType',
  'subTypeIn', 'subTypeNotIn', 'attachType', 'attachTypeIn', 'attachTypeNotIn', 'includeVariants',
  'category', 'blueprintCategoryIn', 'classNameIn', 'classNameMatch', 'classNameNotMatch', 'careerIn',
  'crewMin', 'crewMax', 'limit', 'offset',
]);

/** The payload keys a read asks for, or `null` for the full payload (never in a snapshot). */
export function payloadKeysOf(payload: ListPayload | undefined): readonly string[] | null {
  if (payload === 'full') return null;
  if (payload === undefined || payload === 'card') return CARD_PAYLOAD_KEYS;
  if (payload === 'none') return [];
  return payload;
}

/**
 * Which file answers a read of `kind` with this payload: the ship card file
 * unless the keys only exist in the rank slice. `null` = no file can.
 */
export function snapshotNameFor(kind: CodexKind, payload: ListPayload | undefined): ListSnapshotName | null {
  const keys = payloadKeysOf(payload);
  if (!keys) return null;
  if (kind !== 'ship' || keys.every((k) => SHIP_FILE_PAYLOAD_KEYS.includes(k))) return kind;
  return 'ship-rank';
}

/** `payload->>key`: the JSON value as Postgres text, NULL for absent/null. */
export function jsonTextOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Objects/arrays: Postgres spaces its jsonb text differently, but no filter
  // here compares them with anything that could equal a JSON object.
  return JSON.stringify(v);
}

/** A PostgREST like/ilike pattern (`*` and `%` = any run, `_` = one character) as an anchored RegExp. */
export function likeRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  let body = '';
  for (const ch of pattern) {
    if (ch === '*' || ch === '%') body += '.*';
    else if (ch === '_') body += '.';
    else body += ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  }
  return new RegExp(`^${body}$`, caseInsensitive ? 'isu' : 'su');
}

/**
 * A POSIX regex (`class_name ~ pattern`) as a JS RegExp, or `null` when the
 * pattern leaves the subset whose meaning is the same in both dialects:
 * ASCII letters/digits/`_`/`-`, bracket classes of those and their ranges,
 * the quantifiers `+ * ?`, `^` at the start and `$` at the end. Today's only
 * caller is VEHICLE_AMMO_PATTERN (`_S[0-9]+_`, codex-area-taxonomy).
 */
export function posixRegExp(pattern: string): RegExp | null {
  const atom = '(?:[A-Za-z0-9_-]|\\[(?:[A-Za-z0-9]-[A-Za-z0-9]|[A-Za-z0-9_])+\\])[+*?]?';
  const subset = new RegExp(`^\\^?(?:${atom})+\\$?$`);
  if (!subset.test(pattern)) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

type Predicate = (row: readonly unknown[]) => boolean;

/** How a read applies its search term. */
export type SearchMode =
  /** listByKind: the server's ILIKE token groups, then `searchMatcher`. */
  | 'list'
  /** countSearchMatches: only the server's ILIKE token groups. */
  | 'tokens'
  /** countByKind / non-search reads: the term is ignored, like filteredListQuery does. */
  | 'ignore';

/**
 * The predicates of `filteredListQuery` + `applyDefaultBrowseFilters` (and the
 * search per `mode`) over a snapshot, or `null` to decline.
 */
function predicates(snap: ListSnapshot, kind: CodexKind, filters: CodexListFilters, mode: SearchMode): Predicate[] | null {
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && !KNOWN_FILTERS.has(k)) return null;
  }
  const out: Predicate[] = [];
  let declined = false;
  const colIdx = (c: string): number => {
    const i = snap.col.get(c);
    // A column the table lacks makes PostgREST fail: the database gives that answer.
    if (i === undefined) declined = true;
    return i ?? -1;
  };
  const keyIdx = (k: string): number => {
    const i = snap.key.get(k);
    if (i === undefined) declined = true;
    return i ?? -1;
  };
  const eq = (c: string, value: unknown) => {
    const i = colIdx(c);
    out.push((r) => r[i] !== null && r[i] !== undefined && r[i] === value);
  };
  const inList = (c: string, values: readonly unknown[]) => {
    const i = colIdx(c);
    const set = new Set(values);
    out.push((r) => r[i] !== null && r[i] !== undefined && set.has(r[i]));
  };
  const notInOrNull = (c: string, values: readonly string[]) => {
    const i = colIdx(c);
    const set = new Set(values.map((v) => v.replace(/"/g, '')));
    out.push((r) => r[i] === null || r[i] === undefined || !set.has(r[i] as string));
  };

  // applyDefaultBrowseFilters
  if (!filters.includeVariants) {
    if (kind !== 'ammunition' && kind !== 'manufacturer' && kind !== 'blueprint') {
      const v = colIdx('is_variant');
      const n = colIdx('name_localized');
      out.push((r) => r[v] === false);
      out.push((r) => r[n] === null || r[n] === undefined || !String(r[n]).startsWith('!'));
    }
    if (kind === 'ship') {
      const c = colIdx('class_name');
      const res = NON_SHIP_VEHICLE_PREFIXES.map((p) => likeRegExp(`${p}*`, true));
      out.push((r) => typeof r[c] === 'string' && !res.some((re) => re.test(r[c] as string)));
    }
    if (kind === 'item') {
      const n = colIdx('name_localized');
      out.push((r) => r[n] !== null && r[n] !== undefined);
      notInOrNull('attach_type', INTERNAL_ITEM_ATTACH_TYPES);
    }
  }

  // filteredListQuery
  if (filters.manufacturer) eq('manufacturer_code', filters.manufacturer);
  if (filters.size != null) {
    if (kind === 'ship') {
      const i = keyIdx('sizeClass');
      const want = String(filters.size);
      out.push((r) => jsonTextOf(r[i]) === want);
    } else eq('size', filters.size);
  }
  if (filters.grade) eq('grade', filters.grade);
  if (filters.componentKind && kind === 'component') eq('kind', filters.componentKind);
  if (filters.weaponClass && kind === 'weapon') eq('weapon_class', filters.weaponClass);
  if (filters.subType) eq('sub_type', filters.subType);
  if (filters.subTypeIn?.length) inList('sub_type', filters.subTypeIn);
  if (filters.subTypeNotIn?.length) notInOrNull('sub_type', filters.subTypeNotIn);
  if (filters.attachType && (kind === 'item' || kind === 'weapon')) eq('attach_type', filters.attachType);
  if (filters.attachTypeIn?.length && (kind === 'item' || kind === 'weapon')) inList('attach_type', filters.attachTypeIn);
  if (filters.attachTypeNotIn?.length && (kind === 'item' || kind === 'weapon'))
    notInOrNull('attach_type', filters.attachTypeNotIn);
  if (filters.category && kind === 'blueprint') eq('category', filters.category);
  if (filters.blueprintCategoryIn?.length && kind === 'blueprint') inList('category', filters.blueprintCategoryIn);
  if (filters.classNameIn) inList('class_name', filters.classNameIn.length ? filters.classNameIn : ['-']);
  if (filters.classNameMatch) {
    const re = posixRegExp(filters.classNameMatch);
    if (!re) return null;
    const c = colIdx('class_name');
    out.push((r) => typeof r[c] === 'string' && re.test(r[c] as string));
  }
  if (filters.classNameNotMatch) {
    const re = posixRegExp(filters.classNameNotMatch);
    if (!re) return null;
    const c = colIdx('class_name');
    out.push((r) => typeof r[c] === 'string' && !re.test(r[c] as string));
  }
  if (kind === 'ship') {
    if (filters.careerIn?.length) {
      const i = keyIdx('career');
      const set = new Set(filters.careerIn);
      out.push((r) => {
        const t = jsonTextOf(r[i]);
        return t !== null && set.has(t);
      });
    }
    const crew = colIdx('crew_size');
    const { crewMin, crewMax } = filters;
    if (crewMin != null) out.push((r) => typeof r[crew] === 'number' && (r[crew] as number) >= crewMin);
    if (crewMax != null) out.push((r) => typeof r[crew] === 'number' && (r[crew] as number) <= crewMax);
  }

  // Search
  if (filters.search && mode !== 'ignore') {
    const n = colIdx('name_localized');
    const c = colIdx('class_name');
    // applySearchTokens: every token group AND-ed, inside a group any pattern
    // over name_localized OR class_name (ILIKE; NULL never matches).
    const groups = ilikeTokenGroups(filters.search).map((g) => g.map((p) => likeRegExp(p, true)));
    const hit = (v: unknown, re: RegExp) => typeof v === 'string' && re.test(v);
    for (const group of groups) out.push((r) => group.some((re) => hit(r[n], re) || hit(r[c], re)));
    if (mode === 'list') {
      // listByKind then drops the server's false hits with the shared matcher.
      const matches = searchMatcher(filters.search);
      if (matches) out.push((r) => matches((r[n] as string | null) ?? null, r[c] as string));
    }
  }
  return declined ? null : out;
}

/** The rows of `snap` matching the read, in list order, or `null` to decline. */
export function matchRows(
  snap: ListSnapshot,
  kind: CodexKind,
  filters: CodexListFilters,
  mode: SearchMode,
): (readonly unknown[])[] | null {
  const preds = predicates(snap, kind, filters, mode);
  if (!preds) return null;
  return snap.rows.filter((r) => preds.every((p) => p(r)));
}

/**
 * One snapshot row as the raw record PostgREST returns for
 * `listSelect(kind, payload)`: the list columns plus one `p_<key>` per payload
 * key (null when absent) — so `mapListRow` maps it unchanged.
 */
export function toRecord(snap: ListSnapshot, row: readonly unknown[], keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const columns = SNAPSHOT_COLUMNS[snap.name];
  for (const c of columns) out[c] = row[snap.col.get(c)!] ?? null;
  for (const k of keys) out[`p_${k}`] = row[snap.key.get(k)!] ?? null;
  return out;
}

export interface SnapshotListResult {
  records: Record<string, unknown>[];
  /**
   * Rows surviving every filter AND the search matcher. The database path
   * estimates this per page (`count - dropped`); here it is exact — the
   * intended improvement, never fewer than the rows shown.
   */
  count: number;
}

/**
 * listByKind's answer (before the German-name fallback): the window
 * `offset … offset+limit-1` of the matching rows plus their total, or `null`
 * to decline (`payload: 'full'`, a payload key the file lacks, an
 * untranslatable regex, an unknown filter, a column the table lacks).
 */
export function listFromSnapshot(
  snap: ListSnapshot,
  kind: CodexKind,
  filters: CodexListFilters,
  limit: number,
  offset: number,
): SnapshotListResult | null {
  const keys = payloadKeysOf(filters.payload);
  if (!keys || !keys.every((k) => snap.key.has(k))) return null;
  const rows = matchRows(snap, kind, filters, 'list');
  if (!rows) return null;
  return {
    records: rows.slice(offset, offset + limit).map((r) => toRecord(snap, r, keys)),
    count: rows.length,
  };
}

/** A head-only count of the read (search per `mode`), or `null` to decline. */
export function countFromSnapshot(
  snap: ListSnapshot,
  kind: CodexKind,
  filters: CodexListFilters,
  mode: SearchMode,
): number | null {
  const rows = matchRows(snap, kind, filters, mode);
  return rows ? rows.length : null;
}
