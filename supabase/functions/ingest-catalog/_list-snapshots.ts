// Codex catalog lists as immutable files per build (concept supabase-io-last,
// item "d-cache"). Every list read of the catalog costs the 0.5 GB instance swap
// IO, so each build's lists are published once as plain files in the R2 assets
// bucket and read through the public Worker with a permanent cache.
//
// Keys:
//   codex-lists/<build_id>/index.json                  (short cache, names the gen)
//   codex-lists/<build_id>/<gen>/<name>.json           (immutable)
// `<name>` is a kind (one file with ALL rows of the kind in the build, in the
// database list order) or `facets`. The client never sorts, so file order IS
// list order. Columnar: one array per row - the kind's list columns in the
// order of LIST_COLUMNS, then one entry per `payloadKeys` (the JSON value of
// that top-level payload key, null when absent).
//
// Plain, erasable TypeScript: the edge function and the node tests import it as is.

import { BUILD_ID_RE, newGen } from './_locale-shards.ts';

export { BUILD_ID_RE, newGen };

export const LISTS_ROOT = 'codex-lists';

export const LIST_KINDS = ['ship', 'weapon', 'component', 'item', 'ammunition', 'manufacturer', 'blueprint'] as const;
export type ListKind = (typeof LIST_KINDS)[number];
/** Kinds `codex_facet_values` answers with real values (the others return empty lists). */
export const FACET_KINDS = ['ship', 'weapon', 'component', 'item'] as const;
/** A list file built from table rows: a kind, or the ship rank slice. */
export type ListName = ListKind | 'ship-rank';
/** Publish order of the row files: ship-rank right after ship. */
export const LIST_FILES: readonly ListName[] = ['ship', 'ship-rank', 'weapon', 'component', 'item', 'ammunition', 'manufacturer', 'blueprint'];
export const FILE_NAMES = [...LIST_FILES, 'facets'] as const;
export type FileName = (typeof FILE_NAMES)[number];

export const NAME_RE = /^(ship-rank|ship|weapon|component|item|ammunition|manufacturer|blueprint|facets)$/;
export const GEN_RE = /^[0-9a-z]{6,16}$/;

export const LIST_TABLES: Record<ListName, string> = {
  ship: 'codex_ships',
  'ship-rank': 'codex_ships',
  weapon: 'codex_weapons',
  component: 'codex_components',
  item: 'codex_items',
  ammunition: 'codex_ammunition',
  manufacturer: 'codex_manufacturers',
  blueprint: 'codex_blueprints',
};

/** LIST_SELECT of codex.service.ts without `payload`; the order is the row layout. */
const SHIP_COLUMNS = ['class_name', 'guid', 'name_localized', 'manufacturer_code', 'role', 'crew_size', 'is_variant'] as const;
export const LIST_COLUMNS: Record<ListName, readonly string[]> = {
  ship: SHIP_COLUMNS,
  'ship-rank': SHIP_COLUMNS,
  weapon: ['class_name', 'name_localized', 'manufacturer_code', 'weapon_class', 'attach_type', 'sub_type', 'size', 'grade', 'is_variant'],
  component: ['class_name', 'name_localized', 'manufacturer_code', 'kind', 'attach_type', 'sub_type', 'size', 'grade', 'is_variant'],
  item: ['class_name', 'name_localized', 'manufacturer_code', 'attach_type', 'sub_type', 'size', 'grade', 'is_variant'],
  ammunition: ['class_name', 'name_localized', 'speed', 'lifetime', 'size'],
  manufacturer: ['class_name', 'name_localized', 'manufacturer_code'],
  blueprint: ['class_name', 'name_localized', 'category', 'tier', 'craft_time_seconds', 'dismantle_time_seconds'],
};

/** CARD_PAYLOAD_KEYS of codex.service.ts: what a list card reads. */
export const CARD_PAYLOAD_KEYS: readonly string[] = ['name', 'previewImage', 'manufacturer'];

/**
 * Ship payload slice: the card keys plus what the browse filters read. The
 * rank-cohort keys (defaultLoadout, flight, hull, armorHp, cargoScu, stats;
 * `career` is in) hold the stock loadout tree and the stats sheet - several kB
 * per ship, several MB for the whole file - so they stay out; the client reads
 * them from the table as before. Shorten this one list to shrink the file.
 */
export const SHIP_PAYLOAD_KEYS: readonly string[] = [...CARD_PAYLOAD_KEYS, 'sizeClass', 'career', 'dimensions'];

/**
 * Payload keys of the rank cohort file. Must equal RANK_PAYLOAD_KEYS in
 * src/app/codex/codex.service.ts (same keys, same order): the client reads this
 * file instead of `allShipRows`.
 */
export const SHIP_RANK_PAYLOAD_KEYS: readonly string[] = ['career', 'defaultLoadout', 'flight', 'hull', 'armorHp', 'cargoScu', 'stats'];

/** Rows per page of ship-rank: each row carries several kB (allShipRows pages by 200). */
export const RANK_PAGE = 200;

export const PAYLOAD_KEYS: Record<ListName, readonly string[]> = {
  ship: SHIP_PAYLOAD_KEYS,
  'ship-rank': SHIP_RANK_PAYLOAD_KEYS,
  weapon: CARD_PAYLOAD_KEYS,
  component: CARD_PAYLOAD_KEYS,
  item: CARD_PAYLOAD_KEYS,
  ammunition: CARD_PAYLOAD_KEYS,
  manufacturer: CARD_PAYLOAD_KEYS,
  blueprint: CARD_PAYLOAD_KEYS,
};

export const PAYLOAD_ALIAS = 'p_';

/** PostgREST select of one kind: list columns plus server-side payload slices. */
export function selectFor(kind: ListName): string {
  return [...LIST_COLUMNS[kind], ...PAYLOAD_KEYS[kind].map((k) => `${PAYLOAD_ALIAS}${k}:payload->${k}`)].join(', ');
}

export type ListRow = Record<string, unknown>;

/** One database row (as PostgREST returns it with selectFor) to the columnar array. */
export function rowToArray(kind: ListName, row: ListRow): unknown[] {
  const out: unknown[] = [];
  for (const c of LIST_COLUMNS[kind]) out.push(row[c] ?? null);
  for (const k of PAYLOAD_KEYS[kind]) out.push(row[`${PAYLOAD_ALIAS}${k}`] ?? null);
  return out;
}

/** The file body of one kind. `rows` are already arrays (see rowToArray). */
export function kindFileJson(kind: ListName, rows: unknown[][]): string {
  return JSON.stringify({
    v: 1,
    kind,
    columns: LIST_COLUMNS[kind],
    payloadKeys: PAYLOAD_KEYS[kind],
    rows,
  });
}

/** facets.json: each RPC result stored unchanged. */
export function facetsFileJson(kinds: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, kinds });
}

export interface ListsIndex {
  v: 1;
  build: string;
  gen: string;
  files: Record<string, { rows: number; bytes: number }>;
}

export function indexJson(buildId: string, gen: string, files: ListsIndex['files']): string {
  const index: ListsIndex = { v: 1, build: buildId, gen, files };
  return JSON.stringify(index);
}

export function listsDir(buildId: string): string {
  return `${LISTS_ROOT}/${buildId}/`;
}

export function listsIndexKey(buildId: string): string {
  return `${listsDir(buildId)}index.json`;
}

export function listsFileKey(buildId: string, gen: string, name: FileName): string {
  return `${listsDir(buildId)}${gen}/${name}.json`;
}

export function isListsIndex(v: unknown, buildId: string): v is ListsIndex {
  const i = v as ListsIndex | null;
  return !!i && i.v === 1 && i.build === buildId && typeof i.gen === 'string' && GEN_RE.test(i.gen) &&
    !!i.files && typeof i.files === 'object';
}
