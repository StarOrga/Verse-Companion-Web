// Codex silhouettes as immutable shard files per build (R2, read through the
// public Worker). Every list view used to read its rows' outlines from
// codex_silhouettes (ships 0.9 MB a page) and nothing kept them across sessions;
// one build holds ~53 MB of them (ships 6.5 MB, weapons 5.3, components 10.3,
// items 31), too much for one file per kind.
//
// Keys:
//   codex-silhouettes/<build_id>/index.json                  (short cache, names the gen)
//   codex-silhouettes/<build_id>/<gen>/<kind>/names.json     (immutable)
//   codex-silhouettes/<build_id>/<gen>/<kind>/<n>.json       (immutable)
//   codex-silhouettes/<build_id>/<gen>/plan.json             (publisher only, not served)
//
// Why not hashed shards like the locale strings: a list page asks for the 60
// rows on screen, and a hash would spread them over 60 shards (and four of five
// item rows have no outline at all, yet would still cost a shard each). So the
// shards follow the LIST ORDER of the kind's catalog table (name asc nulls
// last, then class_name - the order of codex-lists/<kind>.json): a page's rows
// sit next to each other and need 2-10 shards, a detail page one. names.json
// lists every class name that has an outline, shard by shard, so the client
// knows a name's shard - and that a name has none - without asking.
//
// A shard holds ROWS_PER_SHARD rows (about 110 kB of JSON before rows that share
// one shape are folded: a ship and its variants, one door mesh on many ships).
// Rows, not bytes, on purpose: the split is then known from the names alone, so
// the publish can run in small independent slices (_silhouette-publish.ts).
//
// Plain, erasable TypeScript: the edge function and the node tests import it as
// is. The client's reader is src/app/codex/codex-silhouette-shards.ts.

import { BUILD_ID_RE, newGen } from './_locale-shards.ts';

export { BUILD_ID_RE, newGen };

export const SILHOUETTES_ROOT = 'codex-silhouettes';

/** The kinds a silhouette row may carry (DB check constraint; holo-silhouette.ts). */
export const SILHOUETTE_KINDS = ['ship', 'weapon', 'component', 'item', 'armor'] as const;
export type SilhouetteKind = (typeof SILHOUETTE_KINDS)[number];

export function isSilhouetteKind(v: unknown): v is SilhouetteKind {
  return typeof v === 'string' && (SILHOUETTE_KINDS as readonly string[]).includes(v);
}

/** The catalog table whose list order a kind's shards follow. */
export const SILHOUETTE_TABLES: Record<SilhouetteKind, string> = {
  ship: 'codex_ships',
  weapon: 'codex_weapons',
  component: 'codex_components',
  item: 'codex_items',
  armor: 'codex_items',
};

/** Rows per shard: a ship outline is ~18 kB, every other kind ~7 kB (measured 2026-11-20). */
export const ROWS_PER_SHARD: Record<SilhouetteKind, number> = {
  ship: 6,
  weapon: 16,
  component: 16,
  item: 16,
  armor: 16,
};

export const GEN_RE = /^[0-9a-z]{6,16}$/;

/** The columns CodexService reads from codex_silhouettes (silhouetteColumns), without `kind`. */
export const SILHOUETTE_SELECT =
  'class_name, channel, patch_version, build_number, view_box, path, edges, bbox, anchors, unresolved, meta, generated_at';

/** One row of a shard: its own columns, `shape` is an index into the shard's `shapes`. */
export const ROW_COLUMNS = ['class_name', 'shape', 'meta', 'generated_at', 'channel', 'patch_version', 'build_number'] as const;
/** One shape of a shard: the part rows share (codex_payloads body). */
export const SHAPE_COLUMNS = ['view_box', 'path', 'edges', 'bbox', 'anchors', 'unresolved'] as const;

export type SilhouetteRow = Record<string, unknown>;

export interface SilhouettesIndex {
  v: 1;
  build: string;
  gen: string;
  /** Every kind of SILHOUETTE_KINDS; `count` 0 = the build has no outline of that kind. */
  kinds: Record<string, { count: number; shards: number }>;
}

export function silhouettesDir(buildId: string): string {
  return `${SILHOUETTES_ROOT}/${buildId}/`;
}

export function silhouettesIndexKey(buildId: string): string {
  return `${silhouettesDir(buildId)}index.json`;
}

export function silhouettesPlanKey(buildId: string, gen: string): string {
  return `${silhouettesDir(buildId)}${gen}/plan.json`;
}

export function silhouetteNamesKey(buildId: string, gen: string, kind: SilhouetteKind): string {
  return `${silhouettesDir(buildId)}${gen}/${kind}/names.json`;
}

export function silhouetteShardKey(buildId: string, gen: string, kind: SilhouetteKind, n: number): string {
  return `${silhouettesDir(buildId)}${gen}/${kind}/${n}.json`;
}

/**
 * The shard order of one kind: the names that have an outline in the catalog's
 * list order, then every outline whose class the catalog table lacks, by class
 * name (code units). Each name once.
 */
export function orderNames(silhouetteNames: readonly string[], catalogOrder: readonly string[]): string[] {
  const left = new Set(silhouetteNames);
  const out: string[] = [];
  for (const name of catalogOrder) {
    if (left.delete(name)) out.push(name);
  }
  const rest = [...left].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...out, ...rest];
}

/** Consecutive groups of `perShard` names. */
export function planShards(names: readonly string[], perShard: number): string[][] {
  const size = Math.max(1, Math.floor(perShard));
  const out: string[][] = [];
  for (let i = 0; i < names.length; i += size) out.push(names.slice(i, i + size));
  return out;
}

export function namesFileJson(kind: SilhouetteKind, shards: string[][]): string {
  return JSON.stringify({ v: 1, kind, shards });
}

/** names.json → its shards, or null when it is not one this code wrote for `kind`. */
export function parseNamesFile(v: unknown, kind: SilhouetteKind): string[][] | null {
  const f = v as { v?: unknown; kind?: unknown; shards?: unknown } | null;
  if (!f || f.v !== 1 || f.kind !== kind || !Array.isArray(f.shards)) return null;
  for (const s of f.shards) {
    if (!Array.isArray(s) || !s.every((n) => typeof n === 'string')) return null;
  }
  return f.shards as string[][];
}

/** What rows may share: everything of a row but its name, meta, stamp and build coordinates. */
function shapeKey(row: SilhouetteRow): string {
  return `${String(row['view_box'])}\n${String(row['path'])}\n${JSON.stringify([
    row['edges'] ?? null, row['bbox'] ?? null, row['anchors'] ?? null, row['unresolved'] ?? null,
  ])}`;
}

/**
 * One shard's body: the rows of `names` in that order, each shape once. A name
 * without a row (deleted since the plan) is left out - the client then answers
 * "no outline", which is what the table says too.
 */
export function shardFileJson(
  kind: SilhouetteKind,
  n: number,
  names: readonly string[],
  rows: ReadonlyMap<string, SilhouetteRow>,
): { body: string; rows: number; shapes: number } {
  const shapeIndex = new Map<string, number>();
  const shapes: unknown[][] = [];
  const out: unknown[][] = [];
  for (const name of names) {
    const row = rows.get(name);
    if (!row) continue;
    const key = shapeKey(row);
    let at = shapeIndex.get(key);
    if (at === undefined) {
      at = shapes.length;
      shapeIndex.set(key, at);
      shapes.push(SHAPE_COLUMNS.map((c) => row[c] ?? null));
    }
    out.push(ROW_COLUMNS.map((c) => (c === 'shape' ? at : c === 'class_name' ? name : (row[c] ?? null))));
  }
  const body = JSON.stringify({ v: 1, kind, shard: n, columns: ROW_COLUMNS, shapeColumns: SHAPE_COLUMNS, shapes, rows: out });
  return { body, rows: out.length, shapes: shapes.length };
}

export function silhouettesIndexJson(buildId: string, gen: string, kinds: SilhouettesIndex['kinds']): string {
  const index: SilhouettesIndex = { v: 1, build: buildId, gen, kinds };
  return JSON.stringify(index);
}

export function isSilhouettesIndex(v: unknown, buildId: string): v is SilhouettesIndex {
  const i = v as SilhouettesIndex | null;
  if (!i || i.v !== 1 || i.build !== buildId || typeof i.gen !== 'string' || !GEN_RE.test(i.gen)) return false;
  if (!i.kinds || typeof i.kinds !== 'object' || Array.isArray(i.kinds)) return false;
  return Object.values(i.kinds).every((k) =>
    !!k && Number.isInteger(k.count) && k.count >= 0 && Number.isInteger(k.shards) && k.shards >= 0);
}
