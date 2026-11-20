// rank-parts.json: what the "Einordnung" rank cohort (getRankCohort of
// src/app/codex/codex.service.ts) reads of the parts in the ships' stock loadouts.
// Before this file a cold browser read the FULL payload of every such part from the
// database: 116 requests, 26.5 MB (LIVE 4.10.3, 2026-11-20). The cohort reads nine
// top-level payload keys and, of `stats` (20 of those 26.5 MB), six structs.
//
//   { v: 1, kind: 'rank-parts',
//     payloadKeys: [...],   rows: [[class_name, table, ...payloadKeys]],
//     absent: [class names of the loadouts that no table holds],
//     ammoKeys: [...],      ammo: [[class_name, ...ammoKeys]] }
//
// `rows`: one row per class name found anywhere in a ship's stock loadout, from the
// first of codex_weapons / codex_components / codex_items that holds it (the lookup
// order of getEntityPayloads); `table` is 'weapon' | 'component' | 'item'.
// `ammo`: ALL rows of codex_ammunition, so the publisher never has to derive which
// ammunition a weapon names. A payload key that is absent or JSON null is null.
//
// Cut values: inside `stats` and `raw` a child that is a plain object and whose
// lower-cased key contains none of the keep hints is replaced IN PLACE (key order
// kept, findStat scans in that order) by the string CUT. jsonb cannot hold U+0000,
// so CUT is never real data. The client turns every CUT into an object that throws
// on any read: reaching for something this file left out makes the client decline
// and read the database, it never yields a different value. Scalars and arrays are
// never cut (a reader could tell them from the placeholder without reading it).
//
// Plain, erasable TypeScript: the edge function and the node tests import it as is.

export const RANK_PARTS = 'rank-parts';

/** Lookup order of getEntityPayloads: the first table that owns a class name wins. */
export const PART_TABLES = ['weapon', 'component', 'item'] as const;
export type PartTable = (typeof PART_TABLES)[number];

/**
 * Top-level payload keys of a part. A reader looks keys up by name, so a key added
 * at the end never breaks an older client; a client that needs a key the file lacks
 * declines. (`impactDamage` / `raw` exist on ammunition; alphaDamage also tries them
 * on the weapon itself.)
 */
export const PART_PAYLOAD_KEYS: readonly string[] = [
  'entityKind', 'kind', 'subType', 'attachType', 'className', 'weaponParams', 'impactDamage', 'raw', 'stats',
];
export const AMMO_PAYLOAD_KEYS: readonly string[] = ['impactDamage', 'weaponParams', 'raw'];

/**
 * `stats` structs kept whole: lower-cased substrings, the same test findStat's struct
 * hint uses, so a struct a hint would scan is kept or cut as a whole group. They are
 * the hints of the cohort's reads: the resource network (codex-power), mass
 * ('physics'), shields, quantum drive, hull armor, missiles.
 */
export const STAT_KEEP: readonly string[] = ['itemresourcecomponentparams', 'physics', 'shield', 'quantum', 'armor', 'missile'];
/** `raw` children kept whole: the projectile's damage (alphaDamage). */
export const RAW_KEEP: readonly string[] = ['projectileparams'];

export const CUT = '\u0000';

/** Class names per `in (...)` read, like the client's payload reads. */
export const PART_NAMES_PER_READ = 200;
/** Ammunition rows per page (about 4 kB a row). */
export const AMMO_PAGE = 200;

const ALIAS = 'p_';

/** PostgREST select: class_name plus one server-side slice per payload key. */
export function partSelect(keys: readonly string[]): string {
  return ['class_name', ...keys.map((k) => `${ALIAS}${k}:payload->${k}`)].join(', ');
}

/**
 * Adds every class name of a stock loadout tree (`payload.defaultLoadout`) to `into`:
 * all levels, trimmed. A superset of what the client asks for
 * (stockLoadoutClassNames of src/app/codex/stock-loadout.ts stops at depth 8); a
 * name the client asks for and this file does not know is read from the database.
 */
export function loadoutClassNames(entries: unknown, into: Set<string>): void {
  if (!Array.isArray(entries)) return;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const name = (e as { entityClassName?: unknown }).entityClassName;
    if (typeof name === 'string' && name.trim()) into.add(name.trim());
    loadoutClassNames((e as { entries?: unknown }).entries, into);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** `obj` with every plain-object child outside `keep` replaced by CUT, keys in their order. */
export function cutChildren(obj: unknown, keep: readonly string[]): unknown {
  if (!isPlainObject(obj)) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    out[k] = isPlainObject(v) && !keep.some((h) => lower.includes(h)) ? CUT : v;
  }
  return out;
}

type Row = Record<string, unknown>;

function sliced(row: Row, keys: readonly string[]): unknown[] {
  return keys.map((k) => {
    const v = row[`${ALIAS}${k}`] ?? null;
    return k === 'stats' ? cutChildren(v, STAT_KEEP) : k === 'raw' ? cutChildren(v, RAW_KEEP) : v;
  });
}

/** JSON text of one part row (partSelect(PART_PAYLOAD_KEYS) shape). Text, so no row object outlives its page. */
export function partRowJson(table: PartTable, row: Row): string {
  return JSON.stringify([row['class_name'], table, ...sliced(row, PART_PAYLOAD_KEYS)]);
}

/** JSON text of one ammunition row (partSelect(AMMO_PAYLOAD_KEYS) shape). */
export function ammoRowJson(row: Row): string {
  return JSON.stringify([row['class_name'], ...sliced(row, AMMO_PAYLOAD_KEYS)]);
}

/** The file body from row texts (partRowJson / ammoRowJson). */
export function rankPartsFileJson(rows: readonly string[], absent: readonly string[], ammo: readonly string[]): string {
  const head = JSON.stringify({ v: 1, kind: RANK_PARTS, payloadKeys: PART_PAYLOAD_KEYS, ammoKeys: AMMO_PAYLOAD_KEYS, absent });
  return `${head.slice(0, -1)},"rows":[${rows.join(',')}],"ammo":[${ammo.join(',')}]}`;
}
