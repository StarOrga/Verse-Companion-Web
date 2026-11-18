// Publishes one build's catalog lists to R2 (layout: _list-snapshots.ts).
// The tables stay the source and the client's fallback: nothing is deleted
// from the database here.
//
// Order, each step only after the previous one succeeded:
//   1. per kind: read the rows in pages, build ONE file, PUT it, drop it
//      (never two kinds' rows at once - this function has died of OOM, 546)
//   2. facets.json from the facet RPC
//   3. index.json LAST, so a reader never sees an index pointing at missing files
//   4. read the index and one file back through the PUBLIC Worker
//   5. delete older generations of this build
// A failure before step 3 leaves the old index and the old generation alone.

import {
  FACET_KINDS,
  LIST_FILES,
  type ListName,
  type ListRow,
  type ListsIndex,
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

export interface ListPublishDeps {
  /** One page of one kind's rows in list order (selectFor shape), `from` offset. */
  readRows(buildId: string, kind: ListName, from: number, limit: number): Promise<ListRow[]>;
  /** Verbatim result of rpc codex_facet_values(p_build_id, p_kind). */
  facetValues(buildId: string, kind: string): Promise<unknown>;
  /** Fails closed while R2 usage is unknown or over budget; null = writes may go ahead. */
  gate(): Promise<{ code: string; message: string } | null>;
  putJson(key: string, body: string): Promise<void>;
  readPublic(key: string): Promise<unknown>;
  listKeys(prefix: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
  now?(): number;
}

export interface ListsPublishResult {
  build: string;
  gen: string | null;
  files: ListsIndex['files'];
  verified: boolean;
  removed_objects: number;
  blocked?: string;
}

export async function publishLists(buildId: string, deps: ListPublishDeps): Promise<ListsPublishResult> {
  const blocked = await deps.gate();
  if (blocked) {
    return { build: buildId, gen: null, files: {}, verified: false, removed_objects: 0, blocked: `${blocked.code}: ${blocked.message}` };
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

  const idxKey = listsIndexKey(buildId);
  await deps.putJson(idxKey, indexJson(buildId, gen, files));

  const served = await deps.readPublic(idxKey);
  let verified = isListsIndex(served, buildId) && served.gen === gen;
  if (verified) {
    const back = await deps.readPublic(sample.key);
    verified = !!back && JSON.stringify(back) === sample.body;
  }

  // Older generations only: everything under the build dir except this gen and the index.
  const keep = `${listsDir(buildId)}${gen}/`;
  const stale = (await deps.listKeys(listsDir(buildId))).filter((k) => k !== idxKey && !k.startsWith(keep));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, stale.length) }, async () => {
    while (next < stale.length) await deps.deleteKey(stale[next++]);
  }));
  return { build: buildId, gen, files, verified, removed_objects: stale.length };
}
