// A job between its estimate and its publish: batches are created, awaited, read and checked.
//
// A plan is cut into batch groups of GROUP_PARTS plan parts (at most 30 requests, ~3 000 strings):
// one batch per group. A group is what one request can create, and later read and check, whatever
// the size of the job - a delta has one group, the whole gap of a language a few dozen.
//
//   submitted     submitting    one batch per slice (the intent protocol below)
//                 running       wait: every batch has ended?
//   validating    results       one group per slice: read its batch, QA -> `r/res-<g>`, judge candidates
//                 judge_plan    the judge sample from all groups -> `r/judge`
//                 judge_submitting / judge (wait) / judge_read
//                 pe_plan       one group per slice: judge verdicts into its results, the post-edit
//                               requests of what failed -> `r/pe-<g>`
//   post_editing  submitting    one post-edit batch per slice
//                 running       wait
//                 results       one group per slice: the second attempt replaces the first
//
// Creating a batch. The provider has no idempotency key or metadata for a batch, so a create cannot
// be made repeatable. What keeps a batch from being created twice:
// - Every create is preceded by a compare-and-set that records the intent (`stats.submit`). Of two
//   requests that reach the same group only one wins it; the other stops before it creates anything.
// - A request that finds an intent it did not write leaves it alone until it is older than
//   STALE_SUBMIT_MS: the request that wrote it may still be waiting for the provider's answer.
// What remains: a kill between the provider's answer and the write of the batch id (one DB round
// trip), or a create whose answer never arrived. The next request finds the stale intent, creates
// that group again and counts it in `stats.resubmits` - the first batch, if it exists, is paid for
// and never read.

import { buildChunks } from './_chunk.ts';
import type { Chunk, ChunkItem } from './_chunk.ts';
import { usageCostUsd } from './_cost.ts';
import { TranslateError } from './_errors.ts';
import { extractJudgeTerms, mergeGlossary } from './_glossary.ts';
import {
  addStats, groupsOf, jobKey, JUDGE_CAP, JUDGE_MODEL, JUDGE_THRESHOLD, LostRace, MAX_RESUBMITS, monthOf, must, partsOfGroup, requireLlm,
  round4, slice, STALE_SUBMIT_MS,
} from './_job.ts';
import type { BatchRef, Deps, Job, QaStats, Stats } from './_job.ts';
import { readPlan, readPlanPart } from './_job_estimate.ts';
import type { PlanHead } from './_job_estimate.ts';
import { addJudgeCandidates } from './_learn.ts';
import { mask, unmask } from './_mask.ts';
import { judgeParams, postEditMessage, requestParams, userMessage } from './_prompt.ts';
import type { BatchParams, GlossaryRow } from './_prompt.ts';
import { qaCheck, qaIndex } from './_qa.ts';
import type { QaIndex } from './_qa.ts';

/** One translated text as it stands (after the first attempt, the judge and the post-edit). */
export interface Res {
  /** Restored text. */
  t: string;
  /** Raw masked model output. */
  raw: string;
  ok: boolean;
  reasons: string[];
  /** Model that wrote it. */
  m: string;
}
export type ResMap = Record<string, Res>;

/** A text the judge may be asked about. */
interface JudgeCand {
  h: string;
  key: string;
  en: string;
  t: string;
}
interface JudgeSample extends JudgeCand {
  g: number;
}
interface JudgeOut {
  /** Hash -> score, for the sampled texts the judge failed. */
  fails: Record<string, number>;
}

export const resKey = (jobId: string, g: number) => jobKey(jobId, `r/res-${g}`);
const candKey = (jobId: string, g: number) => jobKey(jobId, `r/jc-${g}`);
const judgeKeyOf = (jobId: string) => jobKey(jobId, 'r/judge');
const judgeOutKey = (jobId: string) => jobKey(jobId, 'r/judge-out');
const peKey = (jobId: string, g: number) => jobKey(jobId, `r/pe-${g}`);

const batchesOf = (job: Job, kind: BatchRef['kind']) => job.batch_ids.filter((b) => b.kind === kind);
const shape = (job: Job) => job.stats?.plan ?? { parts: 0, chunks: 0 };

/** Books the spend of one batch once: `ref` names the batch within this run of the job. */
async function ledger(deps: Deps, job: Job, ref: string, usd: number): Promise<void> {
  const run = job.stats?.run;
  if (usd > 0) await deps.db.addLedger(job.id, monthOf(deps.now()), round4(usd), run ? `${ref}#${run}` : ref);
}

async function groupChunks(deps: Deps, job: Job, g: number): Promise<{ chunks: Chunk[]; requests: { custom_id: string; params: BatchParams }[] }> {
  const head = await readPlan(deps, job);
  const chunks: Chunk[] = [];
  const requests: { custom_id: string; params: BatchParams }[] = [];
  for (const p of partsOfGroup(g, shape(job).parts)) {
    const part = await readPlanPart(deps, job, p);
    for (const c of part.chunks) {
      chunks.push(c);
      requests.push({ custom_id: c.id, params: requestParams(c.model, c.maxTokens, head.system, userMessage(c, part.fewShot[c.id], part.notes ?? {})) });
    }
  }
  return { chunks, requests };
}

/** Is an intent for another create in the way? `wait` = leave the job alone for now. */
export function intentVerdict(job: Job, nowMs: number): 'none' | 'wait' | 'stale' {
  const left = job.stats?.submit;
  if (!left) return 'none';
  const at = Date.parse(left.at);
  return Number.isFinite(at) && nowMs - at < STALE_SUBMIT_MS ? 'wait' : 'stale';
}

/**
 * Creates one batch behind the intent protocol (see the header) and writes `done` with its id.
 * Returns null when the job is to be left alone (a young intent of another request).
 */
async function createBatch(
  deps: Deps, job: Job, kind: BatchRef['kind'], g: number, requests: () => Promise<{ custom_id: string; params: BatchParams }[]>,
  done: Partial<Stats>,
): Promise<Job | null> {
  const llm = requireLlm(deps);
  const v = intentVerdict(job, deps.now().getTime());
  if (v === 'wait') return null;
  const again = v === 'stale';
  if (again) {
    deps.log('translate batch may exist twice', { job: job.id, kind, group: g, since: job.stats!.submit!.at });
    if ((job.stats?.resubmits ?? 0) >= MAX_RESUBMITS) throw new TranslateError('translate.resubmit_limit');
  }
  const cur = must(await deps.db.cas(job, {
    stats: addStats(job, {
      submit: { kind, g, at: deps.now().toISOString() },
      resubmits: again ? (job.stats?.resubmits ?? 0) + 1 : job.stats?.resubmits,
    }),
  }));
  const reqs = await requests();
  let id: string;
  try {
    ({ id } = await llm.createBatch(reqs));
  } catch (e) {
    // A 4xx means the provider answered and refused: nothing was created, so the retry is not a
    // possible duplicate. Anything else (timeout, dropped connection, 5xx, 529) may have gone
    // through, and the intent stays so the retry is counted.
    const status = (e as { status?: unknown })?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      await deps.db.cas(cur, { stats: addStats(cur, { submit: undefined }) });
    }
    throw e;
  }
  try {
    return await slice(deps, cur, { ...done, submit: undefined }, { batch_ids: [...cur.batch_ids, { id, kind }] });
  } catch (e) {
    // The job was ended while the provider answered (cancelled by an admin, failed): nobody will read
    // this batch and no cancel knows its id, so it is stopped here.
    if (e instanceof LostRace) await llm.cancel(id).catch(() => {});
    throw e;
  }
}

async function allEnded(deps: Deps, job: Job, kind: BatchRef['kind']): Promise<boolean> {
  const llm = requireLlm(deps);
  for (const b of batchesOf(job, kind)) if (!(await llm.isEnded(b.id))) return false;
  return true;
}

function parseT(text: string | undefined): string[] | null {
  try {
    const o = JSON.parse(text ?? '');
    return Array.isArray(o?.t) && o.t.every((x: unknown) => typeof x === 'string') ? o.t : null;
  } catch {
    return null;
  }
}

/** Streams the results of one batch, QA-checks them, returns results and real spend. */
async function collect(deps: Deps, batchId: string, chunks: Chunk[], glossary: QaIndex): Promise<{ res: ResMap; usd: number }> {
  const llm = requireLlm(deps);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const res: ResMap = {};
  let usd = 0;
  const failAll = (c: Chunk, reason: string, model: string) => {
    for (const it of c.items) {
      if (!res[it.h] || !res[it.h].ok) res[it.h] = { t: '', raw: '', ok: false, reasons: [reason], m: model };
    }
  };
  const seen = new Set<string>();
  for await (const r of llm.results(batchId)) {
    const c = byId.get(r.custom_id);
    // Paid is paid: a result no request of the plan stands for still counts.
    if (r.usage && (r.model ?? c?.model)) usd += usageCostUsd((r.model ?? c?.model)!, r.usage);
    if (!c) continue;
    seen.add(c.id);
    const model = r.model ?? c.model;
    if (r.type !== 'succeeded') {
      failAll(c, `request:${r.type}`, model);
      continue;
    }
    if (r.stop_reason === 'max_tokens' || r.stop_reason === 'refusal') {
      failAll(c, `request:${r.stop_reason}`, model);
      continue;
    }
    const t = parseT(r.text);
    if (!t || t.length !== c.items.length) {
      failAll(c, 'length_mismatch', model);
      continue;
    }
    c.items.forEach((it, i) => {
      const original = unmask(it.m, it.toks);
      const q = qaCheck(original, t[i], it.toks, glossary);
      res[it.h] = { t: q.text, raw: t[i], ok: q.ok, reasons: q.reasons, m: model };
    });
  }
  for (const c of chunks) if (!seen.has(c.id)) failAll(c, 'request:missing', c.model);
  return { res, usd };
}

export function qaStats(res: ResMap, dropped?: number): QaStats {
  const reasons: Record<string, number> = {};
  let ok = 0;
  let failed = 0;
  for (const r of Object.values(res)) {
    if (r.ok) ok++;
    else {
      failed++;
      for (const x of r.reasons) reasons[x.split(':')[0]] = (reasons[x.split(':')[0]] ?? 0) + 1;
    }
  }
  return dropped === undefined ? { ok, failed, reasons } : { ok, failed, reasons, dropped };
}

/** The QA of the job: the sum over its groups. */
export function sumQa(qg: Record<string, QaStats>): QaStats {
  const out: QaStats = { ok: 0, failed: 0, reasons: {} };
  let dropped: number | undefined;
  for (const q of Object.values(qg)) {
    out.ok += q.ok;
    out.failed += q.failed;
    for (const [k, n] of Object.entries(q.reasons)) out.reasons[k] = (out.reasons[k] ?? 0) + n;
    if (q.dropped !== undefined) dropped = (dropped ?? 0) + q.dropped;
  }
  return dropped === undefined ? out : { ...out, dropped };
}

async function glossaryIndex(deps: Deps, job: Job, head: PlanHead): Promise<QaIndex> {
  const db: GlossaryRow[] = await deps.db.listGlossary(job.lang);
  return qaIndex(mergeGlossary(db, head.newGlossary));
}

/** How many texts the judge sees: 5 %, at least 5 (or all), at most JUDGE_CAP. */
export const judgeCount = (ok: number) => (ok ? Math.min(JUDGE_CAP, Math.max(Math.min(5, ok), Math.ceil(ok * 0.05))) : 0);

// ── steps ────────────────────────────────────────────────────────────────────

export async function stepQueued(deps: Deps, job: Job): Promise<void> {
  const settings = await deps.db.getSettings();
  if (!settings.enabled) return;
  if (!job.stats?.plan?.chunks) {
    // Planned under an older layout of the plan, or without one: nothing was sent yet, so the job is
    // estimated again instead of submitting requests it cannot read.
    await deps.db.cas(job, { status: 'estimating', stats: addStats(job, { est: undefined, plan: undefined, hold: undefined }) });
    return;
  }
  requireLlm(deps);
  if (!job.approved_by && job.mode !== 'full') {
    const committed = await deps.db.monthCommitted(monthOf(deps.now()), job.id);
    if (committed + (job.estimate_usd ?? 0) > settings.monthly_cap_usd) {
      await deps.db.cas(job, { status: 'awaiting_approval', stats: addStats(job, { hold: 'monthly_cap' }) });
      return;
    }
  }
  await deps.db.cas(job, { status: 'submitted', stats: addStats(job, { phase: 'submitting', pos: 0 }) });
}

export async function stepSubmitted(deps: Deps, job: Job): Promise<void> {
  if (job.stats?.phase === 'submitting') {
    const g = batchesOf(job, 'main').length;
    if (g >= groupsOf(shape(job).parts)) {
      await slice(deps, job, { phase: 'running', pos: undefined });
      return;
    }
    const last = g + 1 >= groupsOf(shape(job).parts);
    await createBatch(deps, job, 'main', g, async () => (await groupChunks(deps, job, g)).requests,
      last ? { phase: 'running', pos: undefined } : { pos: g + 1 });
    return;
  }
  if (!(await allEnded(deps, job, 'main'))) return;
  await deps.db.cas(job, { status: 'validating', stats: addStats(job, { phase: 'results', pos: 0, qg: {} }) });
}

export async function stepValidating(deps: Deps, job: Job): Promise<void> {
  const { store } = deps;
  const phase = job.stats?.phase ?? 'results';
  const groups = groupsOf(shape(job).parts);
  const pos = job.stats?.pos ?? 0;

  if (phase === 'results') {
    const batch = batchesOf(job, 'main')[pos];
    if (!batch) throw new TranslateError('translate.results_missing');
    const head = await readPlan(deps, job);
    const { chunks } = await groupChunks(deps, job, pos);
    const { res, usd } = await collect(deps, batch.id, chunks, await glossaryIndex(deps, job, head));
    await store.putJson(resKey(job.id, pos), res);
    // The smallest hashes that passed: the judge sample is the smallest of all groups.
    const items = new Map<string, ChunkItem>();
    for (const c of chunks) for (const it of c.items) items.set(it.h, it);
    const cands: JudgeCand[] = Object.keys(res).filter((h) => res[h].ok).sort().slice(0, JUDGE_CAP).map((h) => {
      const it = items.get(h)!;
      return { h, key: it.key, en: unmask(it.m, it.toks), t: res[h].t };
    });
    await store.putJson(candKey(job.id, pos), cands);
    await ledger(deps, job, `main:${pos}`, usd);
    const qg = { ...(job.stats?.qg ?? {}), [pos]: qaStats(res) };
    await slice(deps, job, { qg, qa: sumQa(qg), ...(pos + 1 < groups ? { pos: pos + 1 } : { phase: 'judge_plan', pos: 0 }) }, {
      spent_usd: round4(job.spent_usd + usd),
    });
    return;
  }

  if (phase === 'judge_plan') {
    const all: JudgeSample[] = [];
    for (let g = 0; g < groups; g++) {
      const part = (await store.getJson(candKey(job.id, g))) as JudgeCand[] | null;
      if (!part) throw new TranslateError('translate.results_missing');
      for (const c of part) all.push({ ...c, g });
    }
    all.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
    const sample = all.slice(0, judgeCount(job.stats?.qa?.ok ?? 0));
    await store.putJson(judgeKeyOf(job.id), sample);
    await slice(deps, job, sample.length ? { phase: 'judge_submitting', pos: 0 } : { phase: 'pe_plan', pos: 0, judge: null });
    return;
  }

  if (phase === 'judge_submitting') {
    if (batchesOf(job, 'judge').length) {
      await slice(deps, job, { phase: 'judge', pos: undefined });
      return;
    }
    await createBatch(deps, job, 'judge', 0, async () => {
      const sample = ((await store.getJson(judgeKeyOf(job.id))) ?? []) as JudgeSample[];
      return [{ custom_id: 'j0', params: judgeParams(job.lang, JUDGE_MODEL, sample.map((s) => ({ key: s.key, en: s.en, t: s.t }))) }];
    }, { phase: 'judge', pos: undefined });
    return;
  }

  if (phase === 'judge') {
    if (!(await allEnded(deps, job, 'judge'))) return;
    await deps.db.cas(job, { stats: addStats(job, { phase: 'judge_read', pos: 0 }) });
    return;
  }

  if (phase === 'judge_read') {
    const llm = requireLlm(deps);
    const sample = ((await store.getJson(judgeKeyOf(job.id))) ?? []) as JudgeSample[];
    let usd = 0;
    let scores: number[] | null = null;
    let terms: ReturnType<typeof extractJudgeTerms> = [];
    for (const b of batchesOf(job, 'judge')) {
      for await (const r of llm.results(b.id)) {
        if (r.usage) usd += usageCostUsd(r.model ?? JUDGE_MODEL, r.usage);
        if (r.type !== 'succeeded') continue;
        try {
          const o = JSON.parse(r.text ?? '');
          if (Array.isArray(o?.r) && o.r.length === sample.length) {
            scores = o.r.map((x: { score: number }) => Number(x.score));
            // C5: term corrections become glossary candidates (the learning step votes on them).
            terms = extractJudgeTerms(o.r, sample.map((s) => s.en));
          }
        } catch { /* judge output unusable: no scores */ }
      }
    }
    if (terms.length) await addJudgeCandidates(store, job.lang, terms, job.id).catch(() => {});
    const out: JudgeOut = { fails: {} };
    let judge: Stats['judge'] = null;
    if (scores) {
      scores.forEach((s, i) => {
        if (Number.isFinite(s) && s < JUDGE_THRESHOLD) out.fails[sample[i].h] = s;
      });
      const valid = scores.filter((s) => Number.isFinite(s));
      judge = { n: valid.length, mean: round4(valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length)) };
    }
    await store.putJson(judgeOutKey(job.id), out);
    await ledger(deps, job, 'judge', usd);
    await slice(deps, job, { judge, phase: 'pe_plan', pos: 0 }, { spent_usd: round4(job.spent_usd + usd) });
    return;
  }

  if (phase === 'pe_plan') {
    if (pos >= groups) {
      await afterPlan(deps, job);
      return;
    }
    const res = (await store.getJson(resKey(job.id, pos))) as ResMap | null;
    if (!res) throw new TranslateError('translate.results_missing');
    const out = ((await store.getJson(judgeOutKey(job.id))) ?? { fails: {} }) as JudgeOut;
    for (const [h, s] of Object.entries(out.fails)) {
      const r = res[h];
      if (r && r.ok) res[h] = { ...r, ok: false, reasons: [...r.reasons, `judge:${s}`] };
    }
    const failing = Object.keys(res).filter((h) => !res[h].ok);
    const pe = [...(job.stats?.pe ?? [])].filter((g) => g !== pos);
    if (failing.length) {
      const { chunks } = await groupChunks(deps, job, pos);
      const model = new Map<string, string>();
      const byHash = new Map<string, ChunkItem>();
      for (const c of chunks) {
        for (const it of c.items) {
          byHash.set(it.h, it);
          model.set(it.h, c.model);
        }
      }
      const items: ChunkItem[] = [];
      for (const h of failing) {
        const it = byHash.get(h);
        if (it) items.push({ ...it, prev: res[h].raw || mask(res[h].t).m, reason: res[h].reasons });
      }
      const peChunks = buildChunks(items, (it) => [it.key], {
        lang: job.lang, maxItems: 50, idPrefix: `p${pos}_`, modelOf: (it) => model.get(it.h),
      });
      await store.putJson(peKey(job.id, pos), { chunks: peChunks });
      if (peChunks.length) pe.push(pos);
    }
    await store.putJson(resKey(job.id, pos), res);
    const qg = { ...(job.stats?.qg ?? {}), [pos]: qaStats(res) };
    const next = await slice(deps, job, { qg, qa: sumQa(qg), pe, pos: pos + 1 });
    if (pos + 1 >= groups) await afterPlan(deps, next);
    return;
  }
  throw new TranslateError('translate.phase_unknown');
}

/** Every group is planned: post-edit what failed, or publish. */
async function afterPlan(deps: Deps, job: Job): Promise<void> {
  const pe = job.stats?.pe ?? [];
  if (pe.length) await slice(deps, job, { phase: 'submitting', pos: 0 }, { status: 'post_editing' });
  else await slice(deps, job, { phase: 'route', pos: 0 }, { status: 'publishing' });
}

export async function stepPostEditing(deps: Deps, job: Job): Promise<void> {
  const { store } = deps;
  const pe = job.stats?.pe ?? [];
  const phase = job.stats?.phase ?? 'submitting';

  if (phase === 'submitting') {
    const i = batchesOf(job, 'postedit').length;
    if (i >= pe.length) {
      await slice(deps, job, { phase: 'running', pos: undefined });
      return;
    }
    const g = pe[i];
    await createBatch(deps, job, 'postedit', i, async () => {
      const head = await readPlan(deps, job);
      const plan = (await store.getJson(peKey(job.id, g))) as { chunks: Chunk[] } | null;
      if (!plan) throw new TranslateError('translate.plan_missing');
      return plan.chunks.map((c) => ({ custom_id: c.id, params: requestParams(c.model, c.maxTokens, head.system, postEditMessage(c)) }));
    }, i + 1 >= pe.length ? { phase: 'running', pos: undefined } : { pos: i + 1 });
    return;
  }

  if (phase === 'running') {
    if (!(await allEnded(deps, job, 'postedit'))) return;
    await deps.db.cas(job, { stats: addStats(job, { phase: 'results', pos: 0 }) });
    return;
  }

  if (phase === 'results') {
    const i = job.stats?.pos ?? 0;
    const g = pe[i];
    const batch = batchesOf(job, 'postedit')[i];
    if (g === undefined || !batch) throw new TranslateError('translate.results_missing');
    const head = await readPlan(deps, job);
    const plan = (await store.getJson(peKey(job.id, g))) as { chunks: Chunk[] } | null;
    const prior = (await store.getJson(resKey(job.id, g))) as ResMap | null;
    if (!plan || !prior) throw new TranslateError('translate.results_missing');
    const { res: edited, usd } = await collect(deps, batch.id, plan.chunks, await glossaryIndex(deps, job, head));
    const merged: ResMap = { ...prior, ...edited };
    await store.putJson(resKey(job.id, g), merged);
    await ledger(deps, job, `postedit:${g}`, usd);
    // What still fails after the second attempt is dropped: the key stays untranslated.
    const qg = { ...(job.stats?.qg ?? {}), [g]: qaStats(merged, Object.values(merged).filter((r) => !r.ok).length) };
    const last = i + 1 >= pe.length;
    await slice(deps, job, { qg, qa: sumQa(qg), ...(last ? { phase: 'route', pos: 0 } : { pos: i + 1 }) }, {
      spent_usd: round4(job.spent_usd + usd), ...(last ? { status: 'publishing' as const } : {}),
    });
    return;
  }
  throw new TranslateError('translate.phase_unknown');
}
