// Publishes one build's catalog lists to R2 (layout: _list-snapshots.ts).
// The tables stay the source and the client's fallback: nothing is deleted
// from the database here.
//
// Order, each step only after the previous one succeeded:
//   1. per kind: read the rows in pages, build ONE file, PUT it, drop it
//      (never two kinds' rows at once - this function has died of OOM, 546)
//   2. facets.json from the facet RPC
//   3. read one file of the NEW generation back through the PUBLIC Worker (not the
//      index: it is cached for 5 min); a miss stops here - no index, no GC
//   4. index.json LAST, so a reader never sees an index pointing at missing files
//   5. read the index back from R2 itself (the bucket, not the Worker)
//   6. GC: delete only generations OLDER than this publish's own that the index
//      read back does not name. newGen() is base-36 milliseconds, so numeric order
//      is time order; a concurrent publish's newer generation is never touched.
// A failure before step 4 leaves the old index and the old generation alone.

import {
  FACET_KINDS,
  LIST_FILES,
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

export const LIST_PAGE = 1000;

export interface GateBlock {
  status: number;
  code: string;
  message: string;
}

export interface ListPublishDeps {
  /** One page of one kind's rows in list order (selectFor shape), `from` offset. */
  readRows(buildId: string, kind: ListName, from: number, limit: number): Promise<ListRow[]>;
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
  blocked?: GateBlock;
}

export async function publishLists(buildId: string, deps: ListPublishDeps): Promise<ListsPublishResult> {
  const blocked = await deps.gate();
  if (blocked) {
    return { build: buildId, gen: null, files: {}, verified: false, index_put: false, removed_objects: 0, blocked };
  }
  const gen = newGen(deps.now ? deps.now() : Date.now());
  const files: ListsIndex['files'] = {};
  let sample: { key: string; body: string } | null = null;

  for (const kind of LIST_FILES) {
    const pageSize = kind === 'ship-rank' ? RANK_PAGE : LIST_PAGE;
    let rows: unknown[][] = [];
    for (let from = 0;; from += pageSize) {
      const page = await deps.readRows(buildId, kind, from, pageSize);
      for (const r of page) rows.push(rowToArray(kind, r));
      if (page.length < pageSize) break;
    }
    const body = kindFileJson(kind, rows);
    const count = rows.length;
    rows = [];
    await deps.putJson(listsFileKey(buildId, gen, kind), body);
    files[kind] = { rows: count, bytes: body.length };
    // Keep one small file for the read-back comparison; never a big one.
    if (!sample && body.length < 200_000) sample = { key: listsFileKey(buildId, gen, kind), body };
  }

  const kinds: Record<string, unknown> = {};
  for (const kind of FACET_KINDS) kinds[kind] = await deps.facetValues(buildId, kind);
  const facetsBody = facetsFileJson(kinds);
  const facetsKey = listsFileKey(buildId, gen, 'facets');
  await deps.putJson(facetsKey, facetsBody);
  files.facets = { rows: FACET_KINDS.length, bytes: facetsBody.length };
  sample ??= { key: facetsKey, body: facetsBody };

  // The new generation must be readable through the public path BEFORE the index points at it.
  const back = await deps.readPublic(sample.key);
  const verified = !!back && JSON.stringify(back) === sample.body;
  if (!verified) return { build: buildId, gen, files, verified: false, index_put: false, removed_objects: 0 };

  const idxKey = listsIndexKey(buildId);
  await deps.putJson(idxKey, indexJson(buildId, gen, files));

  // GC only on the bucket's own word about which generation is live.
  const live = await deps.readBucket(idxKey);
  if (!isListsIndex(live, buildId)) return { build: buildId, gen, files, verified, index_put: true, removed_objects: 0 };
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
  return { build: buildId, gen, files, verified, index_put: true, removed_objects: stale.length };
}

/** Time order of a generation (base-36 milliseconds). */
function genOrder(gen: string): number {
  return Number.parseInt(gen, 36);
}
