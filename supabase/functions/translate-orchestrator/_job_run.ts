// A job between its estimate and its publish: batches are created, awaited, read and checked.
//
// A plan is cut into batch groups of GROUP_PARTS plan parts (at most 30 requests, ~3 000 strings):
// one batch per group. A group is what one request can create, and later read and check, whatever
// the size of the job - a delta has one group, the whole gap of a language a few dozen.
//
//   submitted     submitting    one batch per slice (the intent protocol below)
//                 probe         wait (jobs of several groups): the first batch has ended?
//                 probe_read    its bill against its estimate decides whether the others are sent
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
//
// Spending. Caps and approvals are given for an estimate; what a job really costs is known batch by
// batch. So the real figures are asked again wherever a decision is still open:
// - A job of several groups sends its first group alone and reads what it cost (`probe`). When that
//   is more than PROBE_SHARE above its estimate, the job stops there and waits for approval with the
//   corrected estimate - one group is paid, not all of them.
// - The estimate covers the first attempts. Before the judge batch and before every post-edit batch
//   the job asks `spendStop`: its real spend plus what it has sent plus the next batch against its
//   budget, and - for a job no person approved - the month's ledger against the monthly cap. A step
//   that is refused is left out, with everything after it: the job publishes what passed, the texts
//   without a second attempt stay untranslated (the next job takes them), and `stats.capped` says so.
// A job of one group has nothing to probe: its first attempts are one batch, paid when it is sent.

import { buildChunks } from './_chunk.ts';
import type { Chunk, ChunkItem } from './_chunk.ts';
import { billedModel, estimateTokens, OPUS_THINKING_FACTOR, priceOf, usageCostUsd } from './_cost.ts';
import { TranslateError } from './_errors.ts';
import { extractJudgeTerms, mergeGlossary } from './_glossary.ts';
import {
  addStats, budgetOf, groupsOf, jobKey, JUDGE_CAP, JUDGE_MODEL, JUDGE_THRESHOLD, LostRace, MAX_RESUBMITS, monthOf, must, partsOfGroup,
  PROBE_SHARE, requireLlm, round4, slice, STALE_SUBMIT_MS,
} from './_job.ts';
import type { BatchRef, Deps, Job, QaStats, Stats } from './_job.ts';
import { readPlan, readPlanPart, requestsEstimateUsd } from './_job_estimate.ts';
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

/** The requests of batch group `g` with what each carries, and what a set of them is estimated to cost. */
async function groupRequests(deps: Deps, job: Job, g: number): Promise<{ byId: Map<string, Chunk>; estimate(ids: Set<string>): number }> {
  const head = await readPlan(deps, job);
  const byId = new Map<string, Chunk>();
  const shots = new Map<string, number>();
  for (const p of partsOfGroup(g, shape(job).parts)) {
    const part = await readPlanPart(deps, job, p);
    for (const c of part.chunks) {
      byId.set(c.id, c);
      shots.set(c.id, part.fewShot[c.id]?.length ?? 0);
    }
  }
  const estimate = (ids: Set<string>) => {
    const chunks = [...byId.values()].filter((c) => ids.has(c.id));
    return requestsEstimateUsd(job.lang, head.system.length, chunks, chunks.reduce((a, c) => a + (shots.get(c.id) ?? 0), 0));
  };
  return { byId, estimate };
}

/** What the judge batch is estimated to cost: the sample in, a back-translation and a score per text out. */
function judgeEstimateUsd(sample: { key: string; en: string; t: string }[]): number {
  const p = priceOf(JUDGE_MODEL);
  const inTok = estimateTokens(1200 + sample.reduce((a, s) => a + s.key.length + s.en.length + s.t.length + 24, 0));
  const outTok = sample.reduce((a, s) => a + s.en.length * 0.3 + 30, 0) * OPUS_THINKING_FACTOR;
  return (inTok * p.in + outTok * p.out) / 1e6;
}

export type SpendStop = { reason: 'job_budget' | 'monthly_cap'; spent: number; limit: number };

/**
 * May the job pay for a batch of about `next` USD beyond its first attempts? null = yes.
 * `sent` is the estimated spend of batches it has sent and not read yet. Real figures on both sides:
 * `spent_usd` is what its batches were billed, the ledger what the month was billed.
 */
export async function spendStop(deps: Deps, job: Job, sent: number, next: number): Promise<SpendStop | null> {
  const spent = round4(job.spent_usd + sent);
  const budget = budgetOf(job);
  if (spent + next > budget) return { reason: 'job_budget', spent, limit: budget };
  // A person approved this job (or it is a full run, which only starts approved): the month's cap was
  // theirs to exceed by this job, and the job's own budget bounds by how much.
  if (job.approved_by || job.mode === 'full') return null;
  const settings = await deps.db.getSettings();
  const committed = await deps.db.monthCommitted(monthOf(deps.now()), job.id);
  // The ledger already holds what this job was billed; `committed` leaves its reserve out.
  if (committed + sent + next > settings.monthly_cap_usd) return { reason: 'monthly_cap', spent: round4(committed + sent), limit: settings.monthly_cap_usd };
  return null;
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
    const paid = billedModel(r.model, c?.model);
    if (r.usage && paid) usd += usageCostUsd(paid, r.usage);
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
    // What the job has paid already is in the ledger and in its estimate: it counts once.
    if (committed + Math.max(0, (job.estimate_usd ?? 0) - job.spent_usd) > settings.monthly_cap_usd) {
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
    // Several groups: the first one is read before the others are sent (see `probe` below).
    const probe = g === 0 && !last && !job.stats?.probe;
    await createBatch(deps, job, 'main', g, async () => (await groupChunks(deps, job, g)).requests,
      last ? { phase: 'running', pos: undefined } : probe ? { phase: 'probe', pos: undefined } : { pos: g + 1 });
    return;
  }
  if (job.stats?.phase === 'probe') {
    // A wait, asked by the 10-minute tick. The read is a slice of its own (stamped, counted, behind the lock).
    const first = batchesOf(job, 'main')[0];
    if (!first) await slice(deps, job, { phase: 'submitting', pos: 0 });
    else if (await requireLlm(deps).isEnded(first.id)) await deps.db.cas(job, { stats: addStats(job, { phase: 'probe_read' }) });
    return;
  }
  if (job.stats?.phase === 'probe_read') {
    await stepProbe(deps, job);
    return;
  }
  if (!(await allEnded(deps, job, 'main'))) return;
  await deps.db.cas(job, { status: 'validating', stats: addStats(job, { phase: 'results', pos: 0, qg: {} }) });
}

/**
 * The first batch group has ended: what was it billed against what it was estimated at? The whole job
 * is expected to follow that ratio. Up to PROBE_SHARE above the estimate the other groups are sent;
 * beyond it the job waits for approval with the corrected estimate, and only this one group is paid.
 *
 * The ratio is taken over the requests that were billed: one that expired or failed costs nothing and
 * says nothing, and counting its estimate would hide what the others cost. A batch that billed nothing
 * at all says nothing about the price of the rest, and the job goes on.
 *
 * The bill goes into the ledger under the ref the read of the group uses later (`main:0`) and into
 * `spent_usd`, both here: it is booked once whichever comes first - also when the job is cancelled
 * while it waits - and the read of group 0 adds only what this slice did not see.
 */
async function stepProbe(deps: Deps, job: Job): Promise<void> {
  const llm = requireLlm(deps);
  const first = batchesOf(job, 'main')[0];
  if (!first) {
    await slice(deps, job, { phase: 'submitting', pos: 0 });
    return;
  }
  const group = await groupRequests(deps, job, 0);
  const billed = new Set<string>();
  let usd = 0;
  for await (const r of llm.results(first.id, { record: false })) {
    const model = billedModel(r.model, group.byId.get(r.custom_id)?.model);
    if (!r.usage || !model) continue;
    usd += usageCostUsd(model, r.usage);
    if (group.byId.has(r.custom_id)) billed.add(r.custom_id);
  }
  await ledger(deps, job, 'main:0', usd);
  const est = group.estimate(billed);
  const ratio = est > 0 && usd > 0 ? usd / est : 1;
  const probe = { est: round4(est), usd: round4(usd), ratio: Math.round(ratio * 1000) / 1000 };
  const spent_usd = round4(job.spent_usd + usd);
  if (ratio <= 1 + PROBE_SHARE) {
    await slice(deps, job, { probe, phase: 'submitting', pos: 1 }, { spent_usd });
    return;
  }
  const projected = round4((job.estimate_usd ?? 0) * ratio);
  deps.log('translate job above its estimate', { job: job.id, estimate: job.estimate_usd, projected, ...probe });
  // The approval it had was for the old figure. Approved again, it goes on with the second group.
  await slice(deps, job, { probe, hold: 'overrun', phase: 'submitting', pos: 1 }, {
    status: 'awaiting_approval', estimate_usd: projected, approved_by: null, spent_usd,
  });
}

/** The texts of the given groups that still fail stay untranslated: their QA says so (`dropped`). */
function dropFailing(job: Job, groups: number[]): { qg: Record<string, QaStats>; qa: QaStats; texts: number } {
  const qg = { ...(job.stats?.qg ?? {}) };
  let texts = 0;
  for (const g of groups) {
    const q = qg[g];
    if (!q) continue;
    qg[g] = { ...q, dropped: q.failed };
    texts += q.failed;
  }
  return { qg, qa: sumQa(qg), texts };
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
    // The probe booked the first group when it read its bill: only what it did not see is added here.
    const seen = pos === 0 ? job.stats?.probe?.usd ?? 0 : 0;
    const qg = { ...(job.stats?.qg ?? {}), [pos]: qaStats(res) };
    await slice(deps, job, { qg, qa: sumQa(qg), ...(pos + 1 < groups ? { pos: pos + 1 } : { phase: 'judge_plan', pos: 0 }) }, {
      spent_usd: round4(job.spent_usd + Math.max(0, usd - seen)),
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
    const v = intentVerdict(job, deps.now().getTime());
    if (v === 'wait') return;
    const sample = ((await store.getJson(judgeKeyOf(job.id))) ?? []) as JudgeSample[];
    const next = judgeEstimateUsd(sample);
    // A stale intent: the create before this one may have gone through, so it counts as sent.
    const sent = v === 'stale' ? next : 0;
    const stop = await spendStop(deps, job, sent, next);
    if (stop) {
      // No sample: what passed the checks is taken as it is, as for a job too small to have one.
      await slice(deps, job, { phase: 'pe_plan', pos: 0, judge: null, submit: undefined, capped: { ...stop, judge: true, texts: 0 } });
      return;
    }
    await createBatch(deps, job, 'judge', 0, async () => (
      [{ custom_id: 'j0', params: judgeParams(job.lang, JUDGE_MODEL, sample.map((s) => ({ key: s.key, en: s.en, t: s.t }))) }]
    ), { phase: 'judge', pos: undefined, judgeSent: round4(sent + next) });
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
        if (r.usage) usd += usageCostUsd(billedModel(r.model, JUDGE_MODEL)!, r.usage);
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
    const head = await readPlan(deps, job);
    const plan = (await store.getJson(peKey(job.id, g))) as { chunks: Chunk[] } | null;
    if (!plan) throw new TranslateError('translate.plan_missing');
    const v = intentVerdict(job, deps.now().getTime());
    if (v === 'wait') return;
    const next = requestsEstimateUsd(job.lang, head.system.length, plan.chunks);
    // A stale intent: the create before this one may have gone through, so it counts as sent.
    const sent = round4((job.stats?.peSent ?? 0) + (v === 'stale' ? next : 0));
    const stop = await spendStop(deps, job, sent, next);
    if (stop) {
      // This group and the ones after it get no second attempt. What was sent is still read.
      const left = dropFailing(job, pe.slice(i));
      const capped = { ...stop, judge: job.stats?.capped?.judge === true, texts: left.texts };
      const stats = { qg: left.qg, qa: left.qa, capped, peSent: sent, submit: undefined };
      if (i === 0) await slice(deps, job, { ...stats, pe: [], phase: 'route', pos: 0 }, { status: 'publishing' });
      else await slice(deps, job, { ...stats, pe: pe.slice(0, i), phase: 'running', pos: undefined });
      return;
    }
    await createBatch(deps, job, 'postedit', i, async () => (
      plan.chunks.map((c) => ({ custom_id: c.id, params: requestParams(c.model, c.maxTokens, head.system, postEditMessage(c)) }))
    ), { peSent: round4(sent + next), ...(i + 1 >= pe.length ? { phase: 'running', pos: undefined } : { pos: i + 1 }) });
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
