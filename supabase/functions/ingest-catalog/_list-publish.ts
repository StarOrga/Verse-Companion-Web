// Publishes one build's catalog lists to R2 (layout: _list-snapshots.ts).
// The tables stay the source and the client's fallback: nothing is deleted
// from the database here.
//
// Order, each step only after the previous one succeeded:
//   1. per kind: read the rows in pages, build ONE file, PUT it, drop it
//      (never two kinds' rows at once - this function has died of OOM, 546)
//   2. facets.json from the facet RPC
//   2b. missile, weapon-rank, component-rank, names-de: same one-file-at-a-time rule, but a
//      failure of one only logs, leaves the name out of the index and lists it in
//      `failed` (the client treats a missing name as "not published" -> database)
//   3. read one file of the NEW generation back through the PUBLIC Worker (not the
//      index: it is cached for 5 min); a miss stops here - no index, no GC
//   4. index.json LAST, so a reader never sees an index pointing at missing files
//   5. read the index back from R2 itself (the bucket, not the Worker)
//   6. GC: delete only generations OLDER than this publish's own that the index
//      read back does not name. newGen() is base-36 milliseconds, so numeric order
//      is time order; a concurrent publish's newer generation is never touched.
// A failure before step 4 leaves the old index and the old generation alone.

import {
  EXTRA_ROW_FILES,
  FACET_KINDS,
  LIST_FILES,
  LIST_KINDS,
  NAMES_DE,
  RANK_PAGED,
  germanNameOf,
  namesDeFileJson,
  type FileName,
  type ListKind,
  type ListName,
  type ListRow,
  type ListsIndex,
  GEN_RE,
  facetsFileJson,
  indexJson,
  isListsIndex,
  kindFileJson,
  listsDir,
  listsFileKey,
  listsIndexKey,
  newGen,
  rowToArray,
} from './_list-snapshots.ts';

import { RANK_PAGE } from './_list-snapshots.ts';

/** Rows per page of names-de (two short strings a row). */
export const NAMES_PAGE = 1000;

export const LIST_PAGE = 1000;

export interface GateBlock {
  status: number;
  code: string;
  message: string;
}

export interface ListPublishDeps {
  /** One page of one kind's rows in list order (selectFor shape), `from` offset. */
  readRows(buildId: string, kind: ListName, from: number, limit: number): Promise<ListRow[]>;
  /**
   * One page of one kind's records for names-de, ordered by class_name (`from` offset):
   * name_localized and the raw payload->name->>de (null when absent). Unfiltered.
   */
  readNames(buildId: string, kind: ListKind, from: number, limit: number): Promise<{ class_name: string; name_localized: string | null; de: string | null }[]>;
  /** Verbatim result of rpc codex_facet_values(p_build_id, p_kind). */
  facetValues(buildId: string, kind: string): Promise<unknown>;
  /** Fails closed while R2 usage is unknown or over budget; null = writes may go ahead. */
  gate(): Promise<GateBlock | null>;
  putJson(key: string, body: string): Promise<void>;
  readPublic(key: string): Promise<unknown>;
  /** The object read from the bucket itself (not the Worker), parsed; null on a miss. */
  readBucket(key: string): Promise<unknown>;
  listKeys(prefix: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
  now?(): number;
}

export interface ListsPublishResult {
  build: string;
  gen: string | null;
  files: ListsIndex['files'];
  verified: boolean;
  index_put: boolean;
  removed_objects: number;
  /** New files whose build failed; they are not in `files` and not in the index. */
  failed: string[];
  blocked?: GateBlock;
}

export async function publishLists(buildId: string, deps: ListPublishDeps): Promise<ListsPublishResult> {
  const blocked = await deps.gate();
  if (blocked) {
    return { build: buildId, gen: null, files: {}, verified: false, index_put: false, removed_objects: 0, failed: [], blocked };
  }
  const gen = newGen(deps.now ? deps.now() : Date.now());
  const files: ListsIndex['files'] = {};
  const failed: string[] = [];
  let sample: { key: string; body: string } | null = null;

  for (const kind of LIST_FILES) {
    const built = await buildRowFile(buildId, kind, deps);
    await deps.putJson(listsFileKey(buildId, gen, kind), built.body);
    files[kind] = { rows: built.count, bytes: built.body.length };
    // Keep one small file for the read-back comparison; never a big one.
    if (!sample && built.body.length < 200_000) sample = { key: listsFileKey(buildId, gen, kind), body: built.body };
  }

  const kinds: Record<string, unknown> = {};
  for (const kind of FACET_KINDS) kinds[kind] = await deps.facetValues(buildId, kind);
  const facetsBody = facetsFileJson(kinds);
  const facetsKey = listsFileKey(buildId, gen, 'facets');
  await deps.putJson(facetsKey, facetsBody);
  files.facets = { rows: FACET_KINDS.length, bytes: facetsBody.length };
  sample ??= { key: facetsKey, body: facetsBody };

  // The added files: one at a time, each isolated from the base publish.
  for (const name of [...EXTRA_ROW_FILES, NAMES_DE]) {
    try {
      const built = name === NAMES_DE ? await buildNamesFile(buildId, deps) : await buildRowFile(buildId, name as ListName, deps);
      await deps.putJson(listsFileKey(buildId, gen, name as FileName), built.body);
      files[name] = { rows: built.count, bytes: built.body.length };
    } catch (e) {
      failed.push(name);
      console.error(`[ingest-catalog] list file ${name} of build ${buildId} not published: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // The new generation must be readable through the public path BEFORE the index points at it.
  const back = await deps.readPublic(sample.key);
  const verified = !!back && JSON.stringify(back) === sample.body;
  if (!verified) return { build: buildId, gen, files, verified: false, index_put: false, removed_objects: 0, failed };

  const idxKey = listsIndexKey(buildId);
  await deps.putJson(idxKey, indexJson(buildId, gen, files));

  // GC only on the bucket's own word about which generation is live.
  const live = await deps.readBucket(idxKey);
  if (!isListsIndex(live, buildId)) return { build: buildId, gen, files, verified, index_put: true, removed_objects: 0, failed };
  const dir = listsDir(buildId);
  const mine = genOrder(gen);
  const stale = (await deps.listKeys(dir)).filter((k) => {
    if (k === idxKey) return false;
    const g = k.slice(dir.length).split('/', 1)[0];
    return GEN_RE.test(g) && g !== live.gen && genOrder(g) < mine;
  });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, stale.length) }, async () => {
    while (next < stale.length) await deps.deleteKey(stale[next++]);
  }));
  return { build: buildId, gen, files, verified, index_put: true, removed_objects: stale.length, failed };
}

/** Time order of a generation (base-36 milliseconds). */
function genOrder(gen: string): number {
  return Number.parseInt(gen, 36);
}

/** Reads one row file's pages and builds its body; the rows live only inside this call. */
async function buildRowFile(buildId: string, kind: ListName, deps: ListPublishDeps): Promise<{ body: string; count: number }> {
  const pageSize = RANK_PAGED.includes(kind) ? RANK_PAGE : LIST_PAGE;
  const rows: unknown[][] = [];
  for (let from = 0;; from += pageSize) {
    const page = await deps.readRows(buildId, kind, from, pageSize);
    for (const r of page) rows.push(rowToArray(kind, r));
    if (page.length < pageSize) break;
  }
  return { body: kindFileJson(kind, rows), count: rows.length };
}

/** names-de: one kind at a time (pages of NAMES_PAGE, class_name order), only records with a searchable German name. */
async function buildNamesFile(buildId: string, deps: ListPublishDeps): Promise<{ body: string; count: number }> {
  const kinds: Record<string, [string, string][]> = {};
  let count = 0;
  for (const kind of LIST_KINDS) {
    const list: [string, string][] = [];
    for (let from = 0;; from += NAMES_PAGE) {
      const page = await deps.readNames(buildId, kind, from, NAMES_PAGE);
      for (const r of page) {
        const de = germanNameOf(r.name_localized, r.de);
        if (de !== null) list.push([r.class_name, de]);
      }
      if (page.length < NAMES_PAGE) break;
    }
    kinds[kind] = list;
    count += list.length;
  }
  return { body: namesDeFileJson(kinds), count };
}
