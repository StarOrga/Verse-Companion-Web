// Publishes one build's silhouettes to R2 (layout: _silhouette-shards.ts). The
// table stays the source and the client's fallback: nothing is deleted from it.
//
// One build is ~53 MB of JSON to read and ~31 MB to write. An edge worker has
// 2 s of CPU for its whole life and 256 MB (the finalize worker was already at
// 1.76 s on 2026-11-19), so the publish is THREE kinds of small calls, each one
// request of its own, and no state outside R2:
//
//   plan    gate, a new generation, per kind: the class names that have a row and
//           the catalog's list order -> names.json; plan.json LAST (a slice or a
//           commit without it refuses, so a half-written plan is never used)
//   slice   SLICE_SHARDS shards of one kind: read their rows in batches of
//           READ_BATCH names, build one shard, PUT it, drop it. Idempotent - a
//           repeated slice writes the same keys again
//   commit  every key the plan names must be in the bucket; the table must still
//           hold exactly the planned class names (`changed` otherwise - a name
//           missing from names.json would read as "no outline"); one shard read
//           back through the PUBLIC Worker; a newer generation in the bucket's
//           index stops here (`superseded`); index.json LAST; the index read back
//           from the bucket; then only generations OLDER than this one that the
//           index does not name are deleted. Two commits of one build can still
//           interleave (no conditional put): when this generation's files are gone
//           right after its index went in, a newer publish finished in between -
//           its index is put back from its plan (`superseded`)
//
// Each answer carries `next` (a cursor, 'commit' or null). The caller drives:
// scripts/codex-silhouettes-to-r2.mjs one call at a time, or - after finalize -
// the function calls itself with `chain` (index.ts). A broken chain leaves no
// index, so clients keep reading the table; the next publish's commit collects
// the unfinished generation.

import {
  GEN_RE,
  ROWS_PER_SHARD,
  SILHOUETTE_KINDS,
  type SilhouetteKind,
  type SilhouetteRow,
  type SilhouettesIndex,
  isSilhouetteKind,
  isSilhouettesIndex,
  namesFileJson,
  newGen,
  orderNames,
  parseNamesFile,
  planShards,
  shardFileJson,
  silhouetteNamesKey,
  silhouetteShardKey,
  silhouettesDir,
  silhouettesIndexJson,
  silhouettesIndexKey,
  silhouettesPlanKey,
} from './_silhouette-shards.ts';

/** Rows per page of the two name reads (one short string a row). */
export const NAMES_PAGE = 1000;
/** Class names per row read: 50 outlines are 0.35-0.9 MB, and the URL stays short. */
export const READ_BATCH = 50;
/** Shards per slice call: at most 256 rows, ~1.8 MB read and written. */
export const SLICE_SHARDS = 16;

export interface GateBlock {
  status: number;
  code: string;
  message: string;
}

export type SliceCursor = { kind: SilhouetteKind; from: number };
export type NextStep = SliceCursor | 'commit' | null;

export interface SilhouettePublishDeps {
  /** Fails closed while R2 usage is unknown or over budget; null = writes may go ahead. */
  gate(): Promise<GateBlock | null>;
  /** One page of the class names that have a silhouette of `kind`, class_name order (`from` offset). */
  readSilhouetteNames(buildId: string, kind: SilhouetteKind, from: number, limit: number): Promise<string[]>;
  /** One page of the kind's catalog table in list order (name asc nulls last, class_name asc). */
  readCatalogNames(buildId: string, kind: SilhouetteKind, from: number, limit: number): Promise<string[]>;
  /** The silhouette rows of the given class names (SILHOUETTE_SELECT), any order. */
  readRows(buildId: string, kind: SilhouetteKind, classNames: string[]): Promise<SilhouetteRow[]>;
  putJson(key: string, body: string): Promise<void>;
  /** The object as the public Worker serves it, parsed; null on any miss. */
  readPublic(key: string): Promise<unknown>;
  /** The object read from the bucket itself, parsed; null on a miss. */
  readBucket(key: string): Promise<unknown>;
  listKeys(prefix: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
  now?(): number;
}

interface Plan {
  v: 1;
  build: string;
  gen: string;
  kinds: SilhouettesIndex['kinds'];
}

function isPlan(v: unknown, buildId: string, gen: string): v is Plan {
  return isSilhouettesIndex(v, buildId) && v.gen === gen && SILHOUETTE_KINDS.every((k) => !!v.kinds[k]);
}

/** The step after shard `to` of `kind` (exclusive): the same kind, the next kind with shards, or the commit. */
function stepAfter(kinds: SilhouettesIndex['kinds'], kind: SilhouetteKind | null, to: number): NextStep {
  if (kind && to < kinds[kind].shards) return { kind, from: to };
  const start = kind ? SILHOUETTE_KINDS.indexOf(kind) + 1 : 0;
  for (const k of SILHOUETTE_KINDS.slice(start)) {
    if (kinds[k].shards > 0) return { kind: k, from: 0 };
  }
  return 'commit';
}

async function allPages(read: (from: number, limit: number) => Promise<string[]>): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0;; from += NAMES_PAGE) {
    const page = await read(from, NAMES_PAGE);
    for (const name of page) out.push(name);
    if (page.length < NAMES_PAGE) return out;
  }
}

export interface PlanResult {
  build: string;
  gen: string | null;
  kinds: SilhouettesIndex['kinds'];
  next: NextStep;
  blocked?: GateBlock;
}

/** Step 1: a new generation with its names files and plan. Reads names only, never an outline. */
export async function planSilhouettes(buildId: string, deps: SilhouettePublishDeps): Promise<PlanResult> {
  const blocked = await deps.gate();
  if (blocked) return { build: buildId, gen: null, kinds: {}, next: null, blocked };
  const gen = newGen(deps.now ? deps.now() : Date.now());
  const kinds: SilhouettesIndex['kinds'] = {};
  for (const kind of SILHOUETTE_KINDS) {
    const have = await allPages((from, limit) => deps.readSilhouetteNames(buildId, kind, from, limit));
    if (have.length === 0) {
      kinds[kind] = { count: 0, shards: 0 };
      continue;
    }
    const catalog = await allPages((from, limit) => deps.readCatalogNames(buildId, kind, from, limit));
    const shards = planShards(orderNames(have, catalog), ROWS_PER_SHARD[kind]);
    await deps.putJson(silhouetteNamesKey(buildId, gen, kind), namesFileJson(kind, shards));
    kinds[kind] = { count: have.length, shards: shards.length };
  }
  await deps.putJson(silhouettesPlanKey(buildId, gen), silhouettesIndexJson(buildId, gen, kinds));
  return { build: buildId, gen, kinds, next: stepAfter(kinds, null, 0) };
}

async function readPlan(buildId: string, gen: string, deps: SilhouettePublishDeps): Promise<Plan> {
  if (!GEN_RE.test(gen)) throw new Error('silhouettes: bad generation');
  const plan = await deps.readBucket(silhouettesPlanKey(buildId, gen));
  if (!isPlan(plan, buildId, gen)) throw new Error(`silhouettes: generation ${gen} of build ${buildId} has no plan`);
  return plan;
}

export interface SliceResult {
  build: string;
  gen: string;
  kind: SilhouetteKind;
  from: number;
  to: number;
  rows: number;
  shapes: number;
  bytes: number;
  next: NextStep;
}

/** Step 2: shards [from, from + SLICE_SHARDS) of one kind. */
export async function publishSilhouetteSlice(
  buildId: string,
  gen: string,
  cursor: SliceCursor,
  deps: SilhouettePublishDeps,
): Promise<SliceResult> {
  const plan = await readPlan(buildId, gen, deps);
  const { kind, from } = cursor;
  if (!isSilhouetteKind(kind) || !Number.isInteger(from) || from < 0 || from >= plan.kinds[kind].shards) {
    throw new Error('silhouettes: cursor outside the plan');
  }
  const names = parseNamesFile(await deps.readBucket(silhouetteNamesKey(buildId, gen, kind)), kind);
  if (!names || names.length !== plan.kinds[kind].shards) throw new Error(`silhouettes: names of ${kind} do not match the plan`);
  const to = Math.min(from + SLICE_SHARDS, names.length);

  let rows = 0;
  let shapes = 0;
  let bytes = 0;
  // Rows arrive in batches that follow the shard order; a shard is built and put as soon
  // as its last name's batch is in, and its rows are dropped with it.
  const wanted = names.slice(from, to).flat();
  const got = new Map<string, SilhouetteRow>();
  let read = 0;
  let end = 0;
  for (let n = from; n < to; n++) {
    end += names[n].length;
    while (read < end) {
      const batch = wanted.slice(read, read + READ_BATCH);
      for (const row of await deps.readRows(buildId, kind, batch)) got.set(String(row['class_name']), row);
      read += batch.length;
    }
    const built = shardFileJson(kind, n, names[n], got);
    await deps.putJson(silhouetteShardKey(buildId, gen, kind, n), built.body);
    rows += built.rows;
    shapes += built.shapes;
    bytes += built.body.length;
    for (const name of names[n]) got.delete(name);
  }
  return { build: buildId, gen, kind, from, to, rows, shapes, bytes, next: stepAfter(plan.kinds, kind, to) };
}

export interface CommitResult {
  build: string;
  gen: string;
  kinds: SilhouettesIndex['kinds'];
  /** Keys the plan names that the bucket lacks; the index is not written while there are any. */
  missing: number;
  first_missing?: string;
  /** A kind whose class names in the table are no longer the planned ones; no index is written. */
  changed?: SilhouetteKind;
  verified: boolean;
  index_put: boolean;
  removed_objects: number;
  superseded?: boolean;
  next: null;
}

/** Time order of a generation (base-36 milliseconds). */
function genOrder(gen: string): number {
  return Number.parseInt(gen, 36);
}

/** Step 3: check, verify through the Worker, switch the index, collect older generations. */
export async function commitSilhouettes(buildId: string, gen: string, deps: SilhouettePublishDeps): Promise<CommitResult> {
  const plan = await readPlan(buildId, gen, deps);
  const base = { build: buildId, gen, kinds: plan.kinds, next: null } as const;
  const dir = silhouettesDir(buildId);

  const present = new Set(await deps.listKeys(`${dir}${gen}/`));
  const expected: string[] = [];
  for (const kind of SILHOUETTE_KINDS) {
    if (plan.kinds[kind].shards === 0) continue;
    expected.push(silhouetteNamesKey(buildId, gen, kind));
    for (let n = 0; n < plan.kinds[kind].shards; n++) expected.push(silhouetteShardKey(buildId, gen, kind, n));
  }
  const missing = expected.filter((k) => !present.has(k));
  if (missing.length > 0) {
    return { ...base, missing: missing.length, first_missing: missing[0], verified: false, index_put: false, removed_objects: 0 };
  }

  // The files must say what the table says NOW: a class that got its row after the plan is
  // not in names.json, and the client would answer "no outline" for it.
  for (const kind of SILHOUETTE_KINDS) {
    const have = await allPages((from, limit) => deps.readSilhouetteNames(buildId, kind, from, limit));
    const planned = plan.kinds[kind].shards === 0
      ? []
      : (parseNamesFile(await deps.readBucket(silhouetteNamesKey(buildId, gen, kind)), kind) ?? []).flat();
    const want = new Set(planned);
    if (have.length !== want.size || have.some((name) => !want.has(name))) {
      return { ...base, missing: 0, changed: kind, verified: false, index_put: false, removed_objects: 0 };
    }
  }

  // The new generation must be readable through the public path BEFORE the index points at it.
  // A build without any outline has nothing to read back.
  let verified = true;
  const sampleKey = expected.find((k) => !k.endsWith('/names.json'));
  if (sampleKey) {
    const [mine, served] = await Promise.all([deps.readBucket(sampleKey), deps.readPublic(sampleKey)]);
    verified = !!mine && !!served && JSON.stringify(mine) === JSON.stringify(served);
  }
  if (!verified) return { ...base, missing: 0, verified: false, index_put: false, removed_objects: 0 };

  const idxKey = silhouettesIndexKey(buildId);
  // A publish that started later but finished first owns the index: its collection has
  // deleted this (older) generation, so an index written now would name files that are gone.
  const current = await deps.readBucket(idxKey);
  if (isSilhouettesIndex(current, buildId) && genOrder(current.gen) > genOrder(gen)) {
    return { ...base, missing: 0, verified, index_put: false, removed_objects: 0, superseded: true };
  }
  await deps.putJson(idxKey, silhouettesIndexJson(buildId, gen, plan.kinds));

  // Collect only on the bucket's own word about which generation is live.
  const live = await deps.readBucket(idxKey);
  if (!isSilhouettesIndex(live, buildId)) return { ...base, missing: 0, verified, index_put: true, removed_objects: 0 };
  const mine = genOrder(gen);
  const all = await deps.listKeys(dir);
  if (sampleKey && !all.includes(sampleKey)) {
    // This generation's files went while its index was being written: a newer publish
    // committed in between and collected them. Its index is the right one - put it back.
    const newer = all
      .map((k) => k.slice(dir.length).split('/'))
      .filter((p) => p.length === 2 && p[1] === 'plan.json' && GEN_RE.test(p[0]) && genOrder(p[0]) > mine)
      .map((p) => p[0])
      .sort((a, b) => genOrder(b) - genOrder(a));
    for (const g of newer) {
      const theirs = await deps.readBucket(silhouettesPlanKey(buildId, g));
      if (!isPlan(theirs, buildId, g)) continue;
      await deps.putJson(idxKey, silhouettesIndexJson(buildId, g, theirs.kinds));
      break;
    }
    return { ...base, missing: 0, verified, index_put: false, removed_objects: 0, superseded: true };
  }
  const stale = all.filter((k) => {
    if (k === idxKey) return false;
    const g = k.slice(dir.length).split('/', 1)[0];
    return GEN_RE.test(g) && g !== live.gen && genOrder(g) < mine;
  });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, stale.length) }, async () => {
    while (next < stale.length) await deps.deleteKey(stale[next++]);
  }));
  return { ...base, missing: 0, verified, index_put: true, removed_objects: stale.length };
}

export type StepResult = PlanResult | SliceResult | CommitResult;

/** A cursor as it arrives in a request body, or null when it is not one. */
export function parseCursor(v: unknown): SliceCursor | 'commit' | null {
  if (v === 'commit') return 'commit';
  const c = v as { kind?: unknown; from?: unknown } | null;
  if (!c || typeof c !== 'object' || !isSilhouetteKind(c.kind)) return null;
  return Number.isInteger(c.from) && (c.from as number) >= 0 ? { kind: c.kind, from: c.from as number } : null;
}

/**
 * One call of the publish: no `gen` plans, a cursor runs that slice, 'commit'
 * commits. The caller repeats with the answer's `gen` and `next` until `next`
 * is null.
 */
export function publishSilhouetteStep(
  buildId: string,
  gen: string | null,
  cursor: SliceCursor | 'commit' | null,
  deps: SilhouettePublishDeps,
): Promise<StepResult> {
  if (gen === null) return planSilhouettes(buildId, deps);
  if (cursor === 'commit') return commitSilhouettes(buildId, gen, deps);
  if (!cursor) throw new Error('silhouettes: a generation needs a cursor');
  return publishSilhouetteSlice(buildId, gen, cursor, deps);
}
