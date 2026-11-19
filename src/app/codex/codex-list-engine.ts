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

/** A list file name: a kind, or one of the slice files (ship rank, missile and item rank cohorts). */
export type ListSnapshotName = CodexKind | 'ship-rank' | 'missile' | 'weapon-rank' | 'component-rank';

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
  // The cohort slices (LIST_COLUMNS of the publisher): missile carries the whole payload as its last column.
  missile: ['class_name', 'name_localized', 'sub_type', 'size', 'attach_type', 'payload'],
  'weapon-rank': ['class_name', 'name_localized', 'sub_type', 'size'],
  'component-rank': ['class_name', 'name_localized', 'sub_type', 'size'],
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
  // Only the syntax characters (and `/`) may be escaped under the `u` flag; `\-` is a SyntaxError there.
  const literal = (ch: string): string => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let body = '';
  let escaped = false;
  for (const ch of pattern) {
    // A backslash is LIKE's escape character: the character after it stands for itself.
    if (escaped) {
      body += literal(ch);
      escaped = false;
    } else if (ch === '\\') escaped = true;
    else if (ch === '*' || ch === '%') body += '.*';
    else if (ch === '_') body += '.';
    else body += literal(ch);
  }
  if (escaped) body += literal('\\');
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

/**
 * The sibling reads (`listSkinSiblings` / `listEditionSiblings`): every row of
 * the build — variants included, no browse filters — whose class name matches
 * the ILIKE pattern `<escapedPrefix>%`, as `listSelect(kind, 'none')` records,
 * sorted by class name. `null` (decline) when more than `limit` rows match:
 * which rows the database cuts at the limit depends on its collation order,
 * which a code-unit sort does not reproduce. Below the limit the set is the
 * same; the only callers (resolveSkinGroup / resolveEditionGroup) sort their
 * own output and do not depend on the row order.
 */
export function prefixRowsFromSnapshot(
  snap: ListSnapshot,
  escapedPrefix: string,
  limit: number,
): Record<string, unknown>[] | null {
  const c = snap.col.get('class_name');
  if (c === undefined) return null;
  const re = likeRegExp(`${escapedPrefix}%`, true);
  const rows = snap.rows.filter((r) => typeof r[c] === 'string' && re.test(r[c] as string));
  if (rows.length > limit) return null;
  return rows
    .map((r) => toRecord(snap, r, []))
    .sort((a, b) => {
      const x = a['class_name'] as string;
      const y = b['class_name'] as string;
      return x < y ? -1 : x > y ? 1 : 0;
    });
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

// ── cohort slices ────────────────────────────────────────────────────────────

/** True when `snap` is the file `name` with every column (and payload key) a cohort read needs. */
function hasLayout(snap: ListSnapshot, name: ListSnapshotName, keys: readonly string[]): boolean {
  return snap.name === name && SNAPSHOT_COLUMNS[name].every((c) => snap.col.has(c)) && keys.every((k) => snap.key.has(k));
}

/**
 * getMissileCohort's rows from `missile.json`: the records of
 * `select class_name, name_localized, sub_type, size, attach_type, payload`
 * with `attach_type = 'Missile'` and a name (the publisher's filter, checked
 * again here), in the file's list order. `null` (decline) for another layout.
 */
export function missileRowsFromSnapshot(snap: ListSnapshot): Record<string, unknown>[] | null {
  if (!hasLayout(snap, 'missile', [])) return null;
  const at = snap.col.get('attach_type')!;
  const n = snap.col.get('name_localized')!;
  return snap.rows
    .filter((r) => r[at] === 'Missile' && r[n] !== null && r[n] !== undefined)
    .map((r) => toRecord(snap, r, []));
}

/**
 * getItemRankCohort's rows from `weapon-rank.json` / `component-rank.json`,
 * shaped like its select (`wp` = payload->weaponParams; `ck` = payload->>kind
 * as text, `stats` = payload->stats). The publisher already keeps only named,
 * un-varianted records; this applies the rest of the query:
 * `name_localized not like '!%'` and, for components, `payload->>kind = kind`.
 * `null` (decline) when the file is not the expected one.
 */
export function itemRankRowsFromSnapshot(snap: ListSnapshot, kind: string): Record<string, unknown>[] | null {
  const weapon = kind === 'weapon';
  const name: ListSnapshotName = weapon ? 'weapon-rank' : 'component-rank';
  if (!hasLayout(snap, name, weapon ? ['weaponParams'] : ['kind', 'stats'])) return null;
  const n = snap.col.get('name_localized')!;
  const named = (r: readonly unknown[]) => typeof r[n] === 'string' && !(r[n] as string).startsWith('!');
  const base = (r: readonly unknown[]) => ({
    class_name: r[snap.col.get('class_name')!] ?? null,
    name_localized: r[n] ?? null,
    sub_type: r[snap.col.get('sub_type')!] ?? null,
    size: r[snap.col.get('size')!] ?? null,
  });
  if (weapon) {
    const wp = snap.key.get('weaponParams')!;
    return snap.rows.filter(named).map((r) => ({ ...base(r), wp: r[wp] ?? null }));
  }
  const ck = snap.key.get('kind')!;
  const st = snap.key.get('stats')!;
  return snap.rows
    .filter((r) => named(r) && jsonTextOf(r[ck]) === kind)
    .map((r) => ({ ...base(r), ck: jsonTextOf(r[ck]), stats: r[st] ?? null }));
}

// ── German-name search (mirror of the codex_search RPC) ──────────────────────

/**
 * Postgres `lower(extensions.unaccent(s))` as far as the catalog needs it:
 * lower-case, strip combining marks (NFD), ß → ss, and the letters unaccent
 * maps that do not decompose (ø, æ, œ, ł, đ). Other unaccent.rules entries
 * (ligatures like ﬁ, typographic quotes/dashes, symbols like ½) are not
 * mirrored.
 */
export function foldSearchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd');
}

/** Postgres `btrim(s)`: spaces only, not other whitespace. */
const btrim = (s: string) => s.replace(/^ +| +$/g, '');

/** `%token%` with `\`, `%`, `_` literal and `*` as the wildcard, unanchored. */
function containsRegExp(token: string, caseInsensitive: boolean): RegExp {
  let body = '';
  for (const ch of token) body += ch === '*' ? '[\\s\\S]*' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(body, caseInsensitive ? 'iu' : 'u');
}

/**
 * The row test of `codex_search(p_kind, p_build, p_tokens)`
 * (migration 20261102100000): at most 8 tokens, each folded like the stored
 * `search_text`, space-trimmed and cut to 60 characters; a token of nothing
 * but `*`/spaces is skipped. A row matches when EVERY token's `%token%` hits
 * the search text (LIKE) or the class name (ILIKE). `null` = the RPC returns
 * nothing (no token left, or none with 3+ characters besides `*`).
 *
 * The test takes the English name, the German name as stored in names-de
 * (already filtered like `codex_search_text`: absent = null) and the class name.
 */
export function germanSearchMatcher(
  tokens: readonly string[],
): ((en: string | null, de: string | null, className: string) => boolean) | null {
  const tests: { text: RegExp; cls: RegExp }[] = [];
  let indexable = false;
  for (const raw of tokens.slice(0, 8)) {
    const tok = Array.from(btrim(foldSearchText(`${raw} `))).slice(0, 60).join('');
    if (tok.replace(/[* ]/g, '') === '') continue;
    if (Array.from(tok.replace(/\*/g, '')).length >= 3) indexable = true;
    tests.push({ text: containsRegExp(tok, false), cls: containsRegExp(tok, true) });
  }
  if (tests.length === 0 || !indexable) return null;
  return (en, de, className) => {
    const text = foldSearchText(`${en ?? ''} ${de ?? ''}`);
    return tests.every((t) => t.text.test(text) || t.cls.test(className));
  };
}

/**
 * listByKind's German-name fallback from the kind file plus `names-de`
 * (class name → German name of this kind): the rows that pass every
 * non-search filter of the list (like `filteredListQuery`) AND match the
 * tokens per {@link germanSearchMatcher}, paged, with their exact count.
 * `null` (decline) on the same grounds as {@link listFromSnapshot}.
 *
 * Unlike the RPC this does not rank by `word_similarity` and cut at 100 class
 * names (that cut only kept the `class_name=in.(…)` URL short): a term with
 * more than 100 German matches now returns all of them, in list order.
 */
export function germanListFromSnapshot(
  snap: ListSnapshot,
  kind: CodexKind,
  filters: CodexListFilters,
  namesDe: ReadonlyMap<string, string>,
  tokens: readonly string[],
  limit: number,
  offset: number,
): SnapshotListResult | null {
  const keys = payloadKeysOf(filters.payload);
  if (!keys || !keys.every((k) => snap.key.has(k))) return null;
  const c = snap.col.get('class_name');
  const n = snap.col.get('name_localized');
  if (c === undefined || n === undefined) return null;
  const rows = matchRows(snap, kind, filters, 'ignore');
  if (!rows) return null;
  const matches = germanSearchMatcher(tokens);
  const hits = matches
    ? rows.filter((r) => {
        const cn = r[c];
        if (typeof cn !== 'string') return false;
        return matches(typeof r[n] === 'string' ? (r[n] as string) : null, namesDe.get(cn) ?? null, cn);
      })
    : [];
  return { records: hits.slice(offset, offset + limit).map((r) => toRecord(snap, r, keys)), count: hits.length };
}
