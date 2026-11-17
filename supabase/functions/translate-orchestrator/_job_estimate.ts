// Estimating a job in slices: what must be translated, in which requests, and what it will cost.
//
//   adm       delta only, once per language: the admin entries of the TM, one hash digit per slice
//             (the override alerts of the rows walk need them, and nothing else of the TM)
//   rows      SCAN_SHARDS English shards per slice: rows by hash digit (_rows.ts), override alerts
//   diff      one hash digit per slice against its sixteenth of the TM: counts, the texts to translate
//             (routed to the segment of their key), reference pairs for the prompts, CIG label pairs
//   prep      glossary + system prompt -> `plan`
//   chunk     one segment (or several small ones) per slice: the requests -> `plan-<n>`, PART_CHUNKS each
//   shots     one plan part per slice (or the requests of it that SHOT_POOLS pools serve): reference
//             pairs and reviewer notes
//   clean     the work files of the estimate
//   complete  the estimate, caps and holds -> queued | awaiting_approval | publishing | skipped
//
// Every slice is a compare-and-set that keeps its position in `stats.est`. The size of a slice does
// not depend on the size of the job: a delta of 500 strings and the whole gap of a language (~70k
// texts) walk the same phases, the second one just has more segments and plan parts.
//
// A text is a hash, so all keys with the same English meet in one digit: the diff decides it once.
// The requests, however, must be in KEY order - strings of one family (`pu_mission_x_*`) belong in
// one request, the model translates them better together. `segmentsOf` is the bridge: a partition
// of the keys that keeps families together and is known before the first slice.

import { fnv1a, keyGroup } from '../ingest-catalog/_locale-shards.ts';
import type { LocaleIndex } from '../ingest-catalog/_locale-shards.ts';
import { detectOverrideAlerts } from './_alerts.ts';
import { loadNotes } from './_cards.ts';
import { buildChunks, familyOf, isLoreKey, toChunkItem } from './_chunk.ts';
import type { Chunk, ChunkItem } from './_chunk.ts';
import { estimateFromTotals, estimateOutputTokens, estimateTokens } from './_cost.ts';
import type { DiffCounts, TmEntry, UniqueText } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import { deriveCigLabels, LABEL_KEY_RE, mergeGlossary, newRows } from './_glossary.ts';
import { inPool, loadTmAdmin, mergeTmAdmin, sweepPrefix } from './_io.ts';
import type { Store } from './_io.ts';
import { jobKey, jobPrefix, monthOf, PART_CHUNKS, round4, slice } from './_job.ts';
import type { Deps, EstState, Job, Stats } from './_job.ts';
import { buildFewShotIndex, buildSystem, pickSimilar } from './_prompt.ts';
import type { CigPair, GlossaryRow } from './_prompt.ts';
import { diffRows, DIGITS, F_CIG, HEX, loadKeySlice, loadRows, loadTmDigit, openRowReaders, rowsOf, tableMark, writeRows } from './_rows.ts';
import { SCAN_SHARDS } from './_scan.ts';
import { cigTableFor } from './_sources.ts';

/** Todo items one chunk slice takes at least (small segments are chunked together). */
export const SEG_ITEMS = 1500;
/** Todo items one chunk slice takes at most (a segment beyond that is chunked in several slices). */
export const MAX_SEG_ITEMS = 6000;
/** Pairs a few-shot pool keeps per key head, and the size of the pool for heads without their own. */
export const POOL_PAIRS = 2500;
const POOL_BUCKETS = 16;
/**
 * Pools of reference pairs one `shots` slice reads besides the common one. A pool is up to a few MB
 * (every key head of its bucket, POOL_PAIRS each); requests are in key order, so a plan part
 * rarely needs more than two - a part that does is finished by the next slice.
 */
export const SHOT_POOLS = 2;
const CLEAN_KEYS = 150;
const READ_CONCURRENCY = 12;

/** Head of the plan: what every request of the job shares. The requests are in `plan-<n>`. */
export interface PlanHead {
  v: 2;
  build_id: string;
  lang: string;
  mode: 'delta' | 'full';
  system: string;
  /** Glossary rows flagged for retranslation when the job was estimated, and their terms. */
  forceIds: string[];
  forceTerms: string[];
  newGlossary: GlossaryRow[];
}

/** PART_CHUNKS requests of the plan with what goes into their prompts. */
export interface PlanPart {
  chunks: Chunk[];
  /** Reference pairs per request id. */
  fewShot: Record<string, CigPair[]>;
  /** Admin card notes for keys of these requests (key -> hint). */
  notes: Record<string, string>;
}

export const planKey = (jobId: string) => jobKey(jobId, 'plan');
export const planPartKey = (jobId: string, n: number) => jobKey(jobId, `plan-${n}`);
const workPrefix = (jobId: string) => `${jobPrefix(jobId)}e/`;
const work = (jobId: string, name: string) => `${workPrefix(jobId)}${name}.json`;

export async function readPlan(deps: Deps, job: Job): Promise<PlanHead> {
  const p = await deps.store.getJson(planKey(job.id)) as PlanHead | null;
  if (!p) throw new TranslateError('translate.plan_missing');
  return p;
}

export async function readPlanPart(deps: Deps, job: Job, n: number): Promise<PlanPart> {
  const p = await deps.store.getJson(planPartKey(job.id, n)) as PlanPart | null;
  if (!p) throw new TranslateError('translate.plan_missing');
  return p;
}

// ── segments ─────────────────────────────────────────────────────────────────

export interface Segments {
  count: number;
  of(key: string): number;
}

/**
 * A partition of the keys of a table into segments of about `per` shards, from its index alone.
 * A key group with at least `per` shards is split by the hash of the key's family (the key up to its
 * last `_`), so a family stays in one segment; smaller groups share segments in name order; keys
 * without a group of their own are split by family like one large group.
 */
export function segmentsOf(index: Pick<LocaleIndex, 'groups' | 'misc'>, per = SCAN_SHARDS): Segments {
  const big = new Map<string, { base: number; n: number }>();
  const small = new Map<string, number>();
  let next = 0;
  let shared = -1;
  let room = 0;
  for (const g of Object.keys(index.groups).sort()) {
    const s = index.groups[g];
    if (s >= per) {
      const n = Math.ceil(s / per);
      big.set(g, { base: next, n });
      next += n;
      continue;
    }
    if (shared < 0 || room < s) {
      shared = next++;
      room = per;
    }
    small.set(g, shared);
    room -= s;
  }
  const misc = { base: next, n: Math.max(1, Math.ceil(Math.max(1, index.misc) / per)) };
  next += misc.n;
  return {
    count: next,
    of(key) {
      const g = keyGroup(key);
      const own = g ? small.get(g) : undefined;
      if (own !== undefined) return own;
      const b = (g ? big.get(g) : undefined) ?? misc;
      return b.base + (fnv1a(familyOf(key)) % b.n);
    },
  };
}

// ── few-shot pools ───────────────────────────────────────────────────────────

const headOf = (key: string) => key.split('_', 1)[0].toLowerCase();
const poolBucket = (head: string) => fnv1a(head) % POOL_BUCKETS;

/**
 * How the reference pairs are thinned so that no pool outgrows POOL_PAIRS, known from the index alone:
 * a head with more keys than that keeps every n-th pair (by the hash of the key), and the pool for
 * heads without enough pairs of their own is every n-th pair of the whole table.
 */
export function poolSampling(index: Pick<LocaleIndex, 'groups' | 'misc' | 'count'>): { ofHead(head: string): number; all: number } {
  const shards = Object.values(index.groups).reduce((a, n) => a + n, 0) + Math.max(1, index.misc);
  const perShard = index.count / Math.max(1, shards);
  return {
    ofHead: (head) => Math.max(1, Math.ceil(((index.groups[head] ?? 0) * perShard) / POOL_PAIRS)),
    all: Math.max(1, Math.ceil(index.count / POOL_PAIRS)),
  };
}

const poolKey = (jobId: string, bucket: number | 'all', digit: number) => work(jobId, `fs-${bucket}-${HEX[digit]}`);

async function loadPool(store: Store, jobId: string, bucket: number | 'all'): Promise<CigPair[]> {
  const out: CigPair[] = [];
  const parts: CigPair[][] = new Array(DIGITS).fill(null);
  await inPool(Array.from({ length: DIGITS }, (_, d) => d), READ_CONCURRENCY, async (d) => {
    parts[d] = ((await store.getJson(poolKey(jobId, bucket, d))) ?? []) as CigPair[];
  });
  for (const p of parts) for (const x of p) out.push(x);
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

// ── the slices ───────────────────────────────────────────────────────────────

interface Ctx {
  dbGlossary: GlossaryRow[];
  cig: string | null;
}

async function context(deps: Deps, job: Job): Promise<Ctx> {
  const language = await deps.db.getLanguage(job.lang);
  if (!language) throw new TranslateError('translate.lang_unknown');
  return { dbGlossary: await deps.db.listGlossary(job.lang), cig: await cigTableFor(deps, job.lang) };
}

const emptyCounts = (): DiffCounts => ({ keys: 0, cig: 0, blank: 0, tm: 0, forced: 0, todo: 0, unchanged: 0 });

const est = (_job: Job, e: EstState, more: Partial<Stats> = {}): Partial<Stats> => ({ est: e, ...more });

/** One slice of the estimate. Returns the job after its compare-and-set (LostRace when it lost). */
export async function estimateSlice(deps: Deps, job: Job): Promise<Job> {
  const { store } = deps;
  const e: EstState = job.stats?.est ?? { phase: job.mode === 'delta' && deps.alerts ? 'adm' : 'rows', cursor: 0, total: 0 };

  if (e.phase === 'adm') {
    const have = await loadTmAdmin(store, job.lang);
    if (have.full) return slice(deps, job, est(job, { ...e, phase: 'rows', cursor: 0 }));
    const { tm } = await loadTmDigit(store, job.lang, e.cursor);
    const found: Record<string, string> = {};
    for (const [h, x] of Object.entries(tm)) if (x.o === 'admin') found[h] = x.t;
    const last = e.cursor + 1 >= DIGITS;
    await mergeTmAdmin(store, job.lang, found, last);
    return slice(deps, job, est(job, last ? { ...e, phase: 'rows', cursor: 0 } : { ...e, cursor: e.cursor + 1 }));
  }

  if (e.phase === 'rows') {
    const { dbGlossary, cig } = await context(deps, job);
    if (job.mode === 'delta' && !job.base_build_id) throw new TranslateError('translate.no_base_build');
    const readers = await openRowReaders(store, job.build_id, cig, job.mode === 'delta' ? job.base_build_id : null);
    if (!readers.en.index || !readers.en.index.count) throw new TranslateError('translate.english_missing');
    if (job.mode === 'delta' && (!readers.base?.index || !readers.base.index.count)) throw new TranslateError('translate.base_build_missing');
    const total = readers.en.names().length;
    const mark = tableMark(readers);
    // A table was published again since the walk began: its shards are other shards now.
    const cursor = e.total === total && e.mark === mark ? e.cursor : 0;
    const ks = await loadKeySlice(readers, cursor);
    const r = rowsOf(ks);
    await writeRows(store, workPrefix(job.id), cursor, r.byDigit);
    if (ks.baseEn && deps.alerts) {
      // B4: advice for the admin, never a reason to fail the job (idempotent per key).
      try {
        const admin = (await loadTmAdmin(store, job.lang)).entries;
        const tm: Record<string, TmEntry> = {};
        for (const [h, t] of Object.entries(admin)) tm[h] = { t, o: 'admin' };
        const alerts = await detectOverrideAlerts({
          baseEn: ks.baseEn, en: ks.en, baseCig: ks.baseCig, cig: ks.cig, tm, adminGlossary: dbGlossary,
        });
        if (alerts.length) await deps.alerts(job.lang, job.build_id, alerts);
      } catch (err) {
        deps.log('translate override alerts failed', { lang: job.lang, error: String((err as Error)?.message ?? err) });
      }
    }
    const next = cursor + SCAN_SHARDS;
    const blank = (cursor === 0 ? 0 : e.blank ?? 0) + r.blank;
    return slice(deps, job, est(job, next >= total
      ? { phase: 'diff', cursor: 0, total, blank, ix: { groups: readers.en.index.groups, misc: readers.en.index.misc, count: readers.en.index.count } }
      : { phase: 'rows', cursor: next, total, mark, blank }, cursor === 0 ? { counts: undefined } : {}));
  }

  if (e.phase === 'diff') {
    const rows = e.ix ? await loadRows(store, workPrefix(job.id), e.cursor, e.total) : null;
    if (!rows || !e.ix) return slice(deps, job, est(job, { phase: 'rows', cursor: 0, total: 0 }));
    // From the layout the rows were walked with, not from the table as it is now (EstState.ix).
    const segs = segmentsOf(e.ix);
    const sampling = poolSampling(e.ix);
    const { tm, nonEmpty } = await loadTmDigit(store, job.lang, e.cursor);
    // The flagged terms as they stand when the diff begins. A term flagged while the digits are walked
    // would force some digits and not others; it waits for the next job.
    let force = e.force;
    if (e.cursor === 0 || !force) {
      const flagged = (await deps.db.listGlossary(job.lang)).filter((g) => g.needs_retranslate);
      force = { ids: flagged.map((g) => g.id!).filter(Boolean), terms: flagged.map((g) => g.source_term) };
    }
    const forceTerms = force.terms;
    const diff = await diffRows(rows, tm, { mode: job.mode, forceTerms });

    // The texts to translate, with the segment of their smallest key.
    const bySeg = new Map<number, UniqueText[]>();
    let strings = 0;
    for (const u of diff.todo) {
      const s = segs.of(u.keys[0]);
      const list = bySeg.get(s);
      if (list) list.push(u);
      else bySeg.set(s, [u]);
      strings += u.keys.length;
    }
    await inPool([...bySeg], READ_CONCURRENCY, async ([s, list]) => {
      await store.putJson(work(job.id, `todo-${s}-${HEX[e.cursor]}`), list);
    });

    // C4: reference pairs from CIG's lines and the whole TM (admin > cig > community > ai), by key head.
    const pools: CigPair[][] = Array.from({ length: POOL_BUCKETS }, () => []);
    const all: CigPair[] = [];
    const labels: [string, string, string][] = [];
    for (const [k, h, en, c, f] of rows) {
      if ((f & F_CIG) && en.length <= 40 && LABEL_KEY_RE.test(k)) labels.push([k, en, c]);
      if (en.length > 300) continue;
      let pair: CigPair | null = null;
      if (f & F_CIG) pair = { key: k, en, t: c, o: 'cig' };
      else if (nonEmpty) {
        const hit = Object.hasOwn(tm, h) ? tm[h] : undefined;
        if (hit && hit.o !== 'cig') pair = { key: k, en, t: hit.t, o: hit.o };
      }
      if (!pair) continue;
      const fp = fnv1a(k);
      const head = headOf(k);
      if (fp % sampling.ofHead(head) === 0) pools[poolBucket(head)].push(pair);
      if (fp % sampling.all === 0) all.push(pair);
    }
    await inPool(pools.map((p, b) => ({ p, b })), READ_CONCURRENCY, async ({ p, b }) => {
      await store.putJson(poolKey(job.id, b, e.cursor), p);
    });
    await store.putJson(poolKey(job.id, 'all', e.cursor), all);
    await store.putJson(work(job.id, `lab-${HEX[e.cursor]}`), labels);

    const counts = e.cursor === 0 ? emptyCounts() : { ...emptyCounts(), ...(job.stats?.counts ?? {}) };
    for (const k of Object.keys(counts) as (keyof DiffCounts)[]) counts[k] += diff.counts[k] ?? 0;
    const seg = e.cursor === 0 ? {} : { ...(e.seg ?? {}) };
    const sd = e.cursor === 0 ? {} : { ...(e.sd ?? {}) };
    for (const [s, list] of bySeg) {
      seg[s] = (seg[s] ?? 0) + list.length;
      sd[s] = (sd[s] ?? '') + HEX[e.cursor];
    }
    const state: EstState = { ...e, seg, sd, force, strings: (e.cursor === 0 ? 0 : e.strings ?? 0) + strings };
    if (e.cursor + 1 < DIGITS) return slice(deps, job, est(job, { ...state, cursor: e.cursor + 1 }, { counts }));
    // Blank English has no row: the rows walk counted it.
    counts.keys += e.blank ?? 0;
    counts.blank += e.blank ?? 0;
    return slice(deps, job, est(job, { ...state, phase: 'prep', cursor: 0 }, { counts }));
  }

  if (e.phase === 'prep') {
    const { dbGlossary } = await context(deps, job);
    const labelEn: Record<string, string> = {};
    const labelCig: Record<string, string> = {};
    for (let d = 0; d < DIGITS; d++) {
      const part = (await store.getJson(work(job.id, `lab-${HEX[d]}`))) as [string, string, string][] | null;
      if (!part) return slice(deps, job, est(job, { phase: 'diff', cursor: 0, total: e.total, blank: e.blank, ix: e.ix }));
      for (const [k, en, t] of part) {
        labelEn[k] = en;
        labelCig[k] = t;
      }
    }
    const flagged = dbGlossary.filter((g) => g.needs_retranslate);
    const force = e.force ?? { ids: flagged.map((g) => g.id!).filter(Boolean), terms: flagged.map((g) => g.source_term) };
    const derived = deriveCigLabels(labelEn, labelCig);
    const notes = await loadNotes(store, job.lang);
    const style = deps.learn ? await deps.learn.getStyle(job.lang).catch(() => null) : null;
    const system = buildSystem(job.lang, mergeGlossary(dbGlossary, derived), { style, notes });
    const head: PlanHead = {
      v: 2, build_id: job.build_id, lang: job.lang, mode: job.mode, system,
      forceIds: force.ids, forceTerms: force.terms,
      newGlossary: newRows(dbGlossary, derived),
    };
    await store.putJson(planKey(job.id), head);
    return slice(deps, job, est(job, { ...e, phase: 'chunk', cursor: 0, off: 0, cost: {}, shots: 0 }, { plan: { parts: 0, chunks: 0 } }));
  }

  if (e.phase === 'chunk') {
    if (!e.ix) return slice(deps, job, est(job, { phase: 'rows', cursor: 0, total: 0 }));
    const count = segmentsOf(e.ix).count;
    const seg = e.seg ?? {};
    // This slice: segments from the cursor on until SEG_ITEMS texts are together (always at least one).
    let from = e.cursor;
    while (from < count && !(seg[from] > 0)) from++;
    if (from >= count) {
      const shape = job.stats?.plan ?? { parts: 0, chunks: 0 };
      return slice(deps, job, est(job, { ...e, phase: shape.parts ? 'shots' : 'clean', cursor: 0, off: 0 }));
    }
    let to = from + 1;
    let n = seg[from];
    while (to < count && n + (seg[to] ?? 0) <= SEG_ITEMS) n += seg[to++] ?? 0;
    const files: string[] = [];
    for (let s = from; s < to; s++) for (const x of e.sd?.[s] ?? '') files.push(work(job.id, `todo-${s}-${x}`));
    const lists: UniqueText[][] = new Array(files.length).fill(null);
    await inPool(files.map((f, i) => ({ f, i })), READ_CONCURRENCY, async ({ f, i }) => {
      const part = (await store.getJson(f)) as UniqueText[] | null;
      if (!part) throw new TranslateError('translate.plan_missing');
      lists[i] = part;
    });
    const settings = await deps.db.getSettings();
    const loreModel = settings.lore_model || undefined;
    const restModel = settings.rest_model || undefined;
    const lore = new Set<string>();
    let items: ChunkItem[] = [];
    for (const list of lists) {
      for (const u of list) {
        if (u.keys.some(isLoreKey)) lore.add(u.h);
        items.push(toChunkItem(u));
      }
    }
    const keysOf = (it: ChunkItem) => (lore.has(it.h) ? ['pu_'] : [it.key]);
    // A segment too large for one slice (one huge key family) is taken in windows of the request order.
    const off = e.off ?? 0;
    let more = false;
    if (items.length > MAX_SEG_ITEMS) {
      items = buildChunks(items, keysOf, { lang: job.lang, loreModel, restModel, maxItems: Number.MAX_SAFE_INTEGER, maxInputTokens: Number.MAX_SAFE_INTEGER })
        .flatMap((c) => c.items);
      more = off + MAX_SEG_ITEMS < items.length;
      items = items.slice(off, off + MAX_SEG_ITEMS);
    }
    const shape = job.stats?.plan ?? { parts: 0, chunks: 0 };
    const chunks = buildChunks(items, keysOf, { lang: job.lang, loreModel, restModel, idStart: shape.chunks });
    const cost = { ...(e.cost ?? {}) };
    for (const c of chunks) {
      const m = (cost[c.model] = { ...(cost[c.model] ?? { requests: 0, inTok: 0, outTok: 0 }) });
      m.requests++;
      m.inTok += estimateTokens(c.inputChars);
      m.outTok += estimateOutputTokens(job.lang, { model: c.model, enChars: c.enChars, strings: c.items.length });
    }
    let parts = shape.parts;
    for (let i = 0; i < chunks.length; i += PART_CHUNKS) {
      const part: PlanPart = { chunks: chunks.slice(i, i + PART_CHUNKS), fewShot: {}, notes: {} };
      await store.putJson(planPartKey(job.id, parts++), part);
    }
    return slice(deps, job, est(job, more ? { ...e, cursor: from, off: off + MAX_SEG_ITEMS, cost } : { ...e, cursor: to, off: 0, cost }, {
      plan: { parts, chunks: shape.chunks + chunks.length },
    }));
  }

  if (e.phase === 'shots') {
    const part = await readPlanPart(deps, job, e.cursor);
    const notes = await loadNotes(store, job.lang);
    const all = buildFewShotIndex(await loadPool(store, job.id, 'all')).all;
    const pools = new Map<number, ReturnType<typeof buildFewShotIndex>>();
    let shots = 0;
    let i = e.off ?? 0;
    for (; i < part.chunks.length; i++) {
      const c = part.chunks[i];
      if (!c.items.length) continue;
      const b = poolBucket(headOf(c.items[0].key));
      let index = pools.get(b);
      if (!index) {
        if (pools.size >= SHOT_POOLS) break;
        index = buildFewShotIndex(await loadPool(store, job.id, b));
        index.all = all;
        pools.set(b, index);
      }
      part.fewShot[c.id] = pickSimilar(index, c.items, 8);
      shots += part.fewShot[c.id].length;
      for (const it of c.items) if (notes.byKey[it.key]) part.notes[it.key] = notes.byKey[it.key];
    }
    await store.putJson(planPartKey(job.id, e.cursor), part);
    const parts = job.stats?.plan?.parts ?? 0;
    const state: EstState = { ...e, shots: (e.cursor === 0 && !e.off ? 0 : e.shots ?? 0) + shots };
    if (i < part.chunks.length) return slice(deps, job, est(job, { ...state, off: i }));
    return slice(deps, job, est(job, e.cursor + 1 < parts ? { ...state, cursor: e.cursor + 1, off: 0 } : { ...state, phase: 'clean', cursor: 0, off: 0 }));
  }

  if (e.phase === 'clean') {
    const swept = await sweepPrefix(store, workPrefix(job.id), CLEAN_KEYS);
    return slice(deps, job, est(job, swept ? { ...e, phase: 'complete', cursor: 0 } : { ...e, cursor: e.cursor + 1 }));
  }

  return await complete(deps, job, e);
}

/** The estimate, caps and holds. The spending rules are the ones the unsliced estimate had. */
async function complete(deps: Deps, job: Job, e: EstState): Promise<Job> {
  const { db } = deps;
  const settings = await db.getSettings();
  const shape = job.stats?.plan ?? { parts: 0, chunks: 0 };
  const counts = { ...emptyCounts(), ...(job.stats?.counts ?? {}) };
  const done: Partial<Stats> = { est: undefined, phase: undefined, pos: undefined, hold: undefined };

  if (!shape.chunks) {
    // Nothing to translate. What the TM already holds for this build still has to become its overlay.
    if (counts.tm > 0) {
      return slice(deps, job, { ...done, phase: 'route', pos: 0 }, { status: 'publishing', string_count: 0, estimate_usd: 0 });
    }
    return slice(deps, job, { ...done, sweep: true }, { status: 'skipped', error: 'translate.nothing_to_do', string_count: 0, estimate_usd: 0 });
  }

  const head = await deps.store.getJson(planKey(job.id)) as PlanHead | null;
  if (!head) throw new TranslateError('translate.plan_missing');
  const estimate = estimateFromTotals(e.cost ?? {}, estimateTokens(head.system.length));
  // The few-shot pairs ride in the (uncached) user message.
  estimate.usd += ((e.shots ?? 0) * 60 * 0.9 * 3) / 1e6;
  // Against the glossary as it is now: another job of the language may have added some of them since `prep`.
  const fresh = head.newGlossary.length ? newRows(await db.listGlossary(job.lang), head.newGlossary) : [];
  if (fresh.length) await db.insertGlossary(job.lang, fresh);

  let hold: string | undefined;
  if (job.mode === 'full') hold = 'full';
  else {
    const others = await db.buildEstimateSum(job.build_id, job.id);
    if (others + estimate.usd > settings.upload_cap_usd) hold = 'upload_cap';
    else {
      const committed = await db.monthCommitted(monthOf(deps.now()), job.id);
      if (committed + estimate.usd > settings.monthly_cap_usd) hold = 'monthly_cap';
    }
  }
  return slice(deps, job, { ...done, estimate, hold }, {
    status: hold ? 'awaiting_approval' : 'queued', string_count: e.strings ?? 0, estimate_usd: round4(estimate.usd),
  });
}
