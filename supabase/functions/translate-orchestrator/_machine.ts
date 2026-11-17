// The job state machine: the driver. The steps live in _job_estimate.ts, _job_run.ts and
// _job_publish.ts; types and helpers in _job.ts. Pure of Deno/network: everything external comes in
// through Deps, so the transitions are unit-tested with fakes.
//
// estimating -> queued | awaiting_approval | publishing | skipped
// queued -> submitted -> validating -> (post_editing) -> publishing -> published
// any open state -> failed | cancelled
//
// Every transition is a compare-and-set on (id, status, updated_at); a second tick racing the
// first loses the CAS and does nothing. Work in progress lives in R2 (`translation-work/<job>/`)
// and in `stats` (phase, position), so a crash at any point resumes where it stopped.
//
// A step is either a WAIT (is the batch done? - cheap, every waiting job is asked on the 10-minute
// tick) or a SLICE of work (read one batch, write one hash digit of the TM). Slices are sized to an
// edge request and run one at a time behind a lock; see `tickAll`.

import { runVerdict, WORKER_LIMIT_KEY } from './_attempts.ts';
import { TranslateError } from './_errors.ts';
import { sweepPrefix } from './_io.ts';
import { addStats, jobPrefix, LostRace, MAX_ATTEMPTS, OPEN_STATUSES, TERMINAL_STATUSES } from './_job.ts';
import type { Deps, Job, Status } from './_job.ts';
import { estimateSlice } from './_job_estimate.ts';
import { stepPublishing } from './_job_publish.ts';
import { intentVerdict, stepPostEditing, stepQueued, stepSubmitted, stepValidating } from './_job_run.ts';
import { resumeLearning } from './_learn.ts';
import { advancePass } from './_pass.ts';
import type { PassOutcome } from './_pass.ts';

export { TranslateError };
export { JUDGE_MODEL, JUDGE_THRESHOLD, MAX_ATTEMPTS, OPEN_STATUSES, STALE_SUBMIT_MS } from './_job.ts';
export type { BatchRef, BatchResult, Db, Deps, EstState, Job, JobPatch, Llm, Settings, Stats, Status } from './_job.ts';

/** Work files of an ended job deleted per slice. */
const SWEEP_KEYS = 150;

/**
 * Is the next step of this job a slice of work (true) or a wait (false)? Told from status and phase
 * alone, so nothing has to be kept in step with it - `translation_work_pending()` in SQL reads the same.
 */
export function isHeavy(job: Pick<Job, 'status' | 'stats'>): boolean {
  const phase = job.stats?.phase;
  switch (job.status) {
    case 'estimating':
    case 'publishing':
      return true;
    case 'submitted':
      return phase === 'submitting';
    case 'validating':
      return (phase ?? 'results') !== 'judge';
    case 'post_editing':
      return (phase ?? 'submitting') !== 'running';
    default:
      return false;
  }
}

export async function fail(deps: Deps, job: Job, key: string): Promise<void> {
  await cancelBatches(deps, job);
  await deps.db.cas(job, { status: 'failed', error: key, stats: addStats(job, { sweep: true, run_at: undefined }) });
}

async function cancelBatches(deps: Deps, job: Job): Promise<void> {
  if (!deps.llm) return;
  for (const b of job.batch_ids) await deps.llm.cancel(b.id).catch(() => {});
}

async function stepEstimating(deps: Deps, job: Job): Promise<void> {
  try {
    await estimateSlice(deps, job);
  } catch (e) {
    if (e instanceof TranslateError && (e.key === 'translate.no_base_build' || e.key === 'translate.base_build_missing')) {
      const cur = (await deps.db.getJob(job.id)) ?? job;
      await deps.db.cas(cur, { status: 'skipped', error: e.key, stats: addStats(cur, { est: undefined, run_at: undefined, dead: undefined, sweep: true }) });
      return;
    }
    throw e;
  }
}

/** One step of one job: a wait is asked, a slice is run. Returns the status afterwards. */
export async function advance(deps: Deps, job: Job): Promise<Status> {
  let cur = job;
  const marked = isHeavy(job);
  if (marked) {
    // A stamp left by a run that never ended means the runtime killed it (546): count it, and after
    // MAX_DEAD_ATTEMPTS in a row fail the job instead of repeating the same death every tick.
    const v = runVerdict(job.stats, deps.now().getTime());
    if (v.kind === 'busy') return job.status;
    if (v.kind === 'fail') {
      deps.log('translate job killed repeatedly', { job: job.id, status: job.status, phase: job.stats?.phase, dead: v.dead });
      await fail(deps, job, WORKER_LIMIT_KEY);
      return (await deps.db.getJob(job.id))?.status ?? job.status;
    }
    const stamped = await deps.db.cas(job, { stats: addStats(job, { run_at: deps.now().toISOString(), dead: v.dead || undefined }) });
    if (!stamped) return job.status;
    cur = stamped;
  }
  try {
    switch (cur.status) {
      case 'estimating': await stepEstimating(deps, cur); break;
      case 'queued': await stepQueued(deps, cur); break;
      case 'submitted': await stepSubmitted(deps, cur); break;
      case 'validating': await stepValidating(deps, cur); break;
      case 'post_editing': await stepPostEditing(deps, cur); break;
      case 'publishing': await stepPublishing(deps, cur); break;
    }
  } catch (e) {
    if (e instanceof LostRace) return (await deps.db.getJob(job.id))?.status ?? cur.status;
    if (e instanceof TranslateError) {
      await fail(deps, (await deps.db.getJob(job.id)) ?? cur, e.key);
    } else {
      const fresh = (await deps.db.getJob(job.id)) ?? cur;
      const attempts = (fresh.stats?.attempts ?? 0) + 1;
      deps.log('translate step error', { job: job.id, status: fresh.status, phase: fresh.stats?.phase, error: String((e as Error)?.message ?? e) });
      if (attempts >= MAX_ATTEMPTS) await fail(deps, fresh, 'translate.internal');
      else await deps.db.cas(fresh, { stats: addStats(fresh, { attempts, run_at: undefined }) });
    }
  }
  const after = (await deps.db.getJob(job.id)) ?? cur;
  if (marked && after.stats?.run_at && OPEN_STATUSES.includes(after.status)) {
    // The step ended without a slice of its own (it had nothing to do yet): give the stamp back.
    await deps.db.cas(after, { stats: addStats(after, { run_at: undefined }) });
  }
  return after.status;
}

export interface TickSummary {
  id: string;
  lang: string;
  from: Status;
  to: Status;
}

export interface TickOptions {
  /** Wall-clock budget of the whole request. */
  budgetMs?: number;
  /** Fast-lane call (every 10 s while work is pending): only slices, no asking of batches. */
  fast?: boolean;
  /** How long a request keeps taking further slices of the unit it works on. */
  sliceBudgetMs?: number;
}

export interface TickResult {
  jobs: TickSummary[];
  passes: PassOutcome[];
  /** Languages whose finished learning batches were applied in this tick. */
  learned: string[];
  /** Ended jobs whose work files were deleted (a slice of them). */
  swept: string[];
  /** false = another request holds the heavy-work lock, so this one ran no slice. */
  heavy: boolean;
}

/**
 * A request goes on with further slices of the same job or pass while it has used less than this.
 * The platform retires a worker that has used about a second of CPU and kills one at about two, so
 * a request must stay well under one second whatever worker it lands on: wall time is an upper
 * bound of CPU time, and one slice is sized to a few hundred milliseconds.
 */
export const SLICE_BUDGET_MS = 400;
/** Slices per request at most (a guard for clocks that do not move). */
const MAX_SLICES = 400;
/** The 10-minute tick waits this long for the lock a fast-lane request holds for a moment. */
const LOCK_WAIT_MS = 2_500;
const LOCK_TRIES = 8;

/** Where a job stands, as far as "did the last step get anywhere" is concerned. */
function mark(job: Job): string {
  const s = job.stats ?? {};
  return [job.status, s.phase, s.pos, s.est?.phase, s.est?.cursor, s.est?.off, job.batch_ids.length, s.pub?.rejoins].join('|');
}

async function claimLock(deps: Deps, patient: boolean): Promise<string | null | undefined> {
  if (!deps.lock) return undefined;
  for (let i = 0; ; i++) {
    const token = await deps.lock.claim();
    if (token || !patient || i + 1 >= LOCK_TRIES) return token;
    await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
  }
}

/**
 * One tick.
 *
 * 1. Every job that waits is asked (not on a fast-lane call).
 * 2. Behind the lock, ONE unit of heavy work gets this request: the learning batches that have ended
 *    (not on a fast-lane call), else a job, else the work files of an ended job, else a background
 *    pass. The request takes slice after slice of that unit until SLICE_BUDGET_MS is used.
 *
 * One unit, behind a lock, because the CPU limit belongs to the worker, not to the request: two
 * requests that slice at the same time add up, and they could rewrite the same TM shard.
 */
export async function tickAll(deps: Deps, opts: TickOptions = {}): Promise<TickResult> {
  const perf = deps.perfNow ?? (() => performance.now());
  const t0 = perf();
  const left = () => perf() - t0 <= (opts.budgetMs ?? 110_000);
  const sliceLeft = () => perf() - t0 < (opts.sliceBudgetMs ?? SLICE_BUDGET_MS);
  const settings = await deps.db.getSettings();
  const res: TickResult = { jobs: [], passes: [], learned: [], swept: [], heavy: true };
  const nowMs = () => deps.now().getTime();
  // A job that cannot take a slice right now (one is in flight or was just killed, or a batch create
  // of another request is under way) must not hold the slot while other work waits.
  const ready = (job: Job) => runVerdict(job.stats, nowMs()).kind !== 'busy' && intentVerdict(job, nowMs()) !== 'wait';
  // A full run is the admin's own order: it is estimated (which costs nothing) even while the pipeline is off.
  const paused = (job: Job) => !settings.enabled && ((job.status === 'estimating' && job.mode !== 'full') || job.status === 'queued');

  // The jobs of one upload share their created_at, so the list order is arbitrary. A publish goes
  // first: it is the last step of work already paid for. The sort is stable.
  const jobs = await deps.db.listOpenJobs();
  jobs.sort((a, b) => Number(b.status === 'publishing') - Number(a.status === 'publishing'));
  const heavyJobs: Job[] = [];
  for (const job of jobs) {
    if (!left()) break;
    if (paused(job)) continue;
    if (isHeavy(job)) {
      if (ready(job)) heavyJobs.push(job);
      continue;
    }
    // A fast-lane call asks no batch. A queued job only changes its status, so it is taken there too:
    // an approved job starts within seconds, not at the next 10-minute tick.
    if (opts.fast && job.status !== 'queued') continue;
    const to = await advance(deps, job);
    res.jobs.push({ id: job.id, lang: job.lang, from: job.status, to });
    // A wait that ended leaves a slice behind: it can go on in this request.
    const now = await deps.db.getJob(job.id);
    if (now && isHeavy(now) && ready(now)) heavyJobs.push(now);
  }

  const passes = deps.passes && deps.passSteps ? await deps.passes.listOpen() : [];
  const sweeps = deps.db.listSweepJobs ? await deps.db.listSweepJobs() : [];
  const resume = !opts.fast && !!deps.learn;
  if (!heavyJobs.length && !passes.length && !sweeps.length && !resume) return res;
  const token = await claimLock(deps, !opts.fast);
  if (token === null) return { ...res, heavy: false };
  try {
    let taken = false;
    // Learning batches started earlier (arbiter, Haiku, align, web): one language's results per tick.
    // First, and only on the 10-minute tick: behind the slices of a long pass they would wait for hours.
    if (resume && left()) {
      try {
        for (const lang of await deps.learn!.listApprovedLangs()) {
          if (!left()) break;
          if ((await resumeLearning(deps, lang)).applied) {
            res.learned.push(lang);
            taken = true;
            break;
          }
        }
      } catch (e) {
        deps.log('translate learning resume failed', { error: String((e as Error)?.message ?? e) });
      }
    }

    for (const job of heavyJobs) {
      if (taken || !left()) break;
      let cur = job;
      let to = job.status;
      for (let n = 0; n < MAX_SLICES; n++) {
        to = await advance(deps, cur);
        const next = await deps.db.getJob(job.id);
        if (!next || mark(next) === mark(cur) || !isHeavy(next) || !ready(next) || !sliceLeft()) break;
        cur = next;
      }
      res.jobs.push({ id: job.id, lang: job.lang, from: job.status, to });
      // A job that ended without doing work (failed, skipped) leaves the slot to the next one.
      if (!['failed', 'skipped', 'cancelled'].includes(to)) taken = true;
    }

    for (const job of sweeps) {
      if (taken || !left()) break;
      try {
        let cur: Job | null = job;
        for (let n = 0; cur && n < MAX_SLICES; n++) {
          const done = await sweepPrefix(deps.store, jobPrefix(cur.id), SWEEP_KEYS);
          if (done) {
            await deps.db.cas(cur, { stats: addStats(cur, { sweep: undefined }) });
            break;
          }
          if (!sliceLeft()) break;
          cur = await deps.db.getJob(job.id);
        }
        res.swept.push(job.id);
        taken = true;
      } catch (e) {
        deps.log('translate job sweep failed', { job: job.id, error: String((e as Error)?.message ?? e) });
      }
    }

    for (const pass of passes) {
      if (taken || !left()) break;
      try {
        let cur = pass;
        let o = await advancePass(deps, cur, deps.passSteps!);
        for (let n = 1; o.ran && n < MAX_SLICES && sliceLeft(); n++) {
          const next = await deps.passes!.get(pass.id);
          if (!next || next.status !== 'open' || `${next.phase}:${next.pos}` === `${cur.phase}:${cur.pos}`) break;
          cur = next;
          const more = await advancePass(deps, cur, deps.passSteps!);
          o = { ...more, from: o.from };
        }
        res.passes.push(o);
        if (o.ran) taken = true;
      } catch (e) {
        deps.log('translate pass failed', { pass: pass.id, kind: pass.kind, error: String((e as Error)?.message ?? e) });
      }
    }
  } finally {
    if (token) await deps.lock!.release(token).catch(() => {});
  }
  return res;
}

export async function tick(deps: Deps, budgetMs = 110_000): Promise<TickSummary[]> {
  return (await tickAll(deps, { budgetMs })).jobs;
}

export async function approve(deps: Deps, jobId: string, userId: string | null): Promise<Job> {
  const job = await deps.db.getJob(jobId);
  if (!job) throw new TranslateError('translate.job_not_found');
  if (job.status !== 'awaiting_approval') throw new TranslateError('translate.not_awaiting_approval');
  const next = await deps.db.cas(job, { status: 'queued', approved_by: userId, stats: addStats(job, { hold: undefined }) });
  if (!next) throw new TranslateError('translate.conflict');
  return next;
}

export async function cancel(deps: Deps, jobId: string): Promise<Job> {
  const job = await deps.db.getJob(jobId);
  if (!job) throw new TranslateError('translate.job_not_found');
  if (job.status !== 'awaiting_approval' && !OPEN_STATUSES.includes(job.status)) throw new TranslateError('translate.not_cancellable');
  await cancelBatches(deps, job);
  const next = await deps.db.cas(job, { status: 'cancelled', stats: addStats(job, { sweep: true, run_at: undefined }) });
  if (!next) throw new TranslateError('translate.conflict');
  return next;
}

/**
 * Admin op: a `full` job (the whole gap of a language). It is only started here; the ticks estimate
 * it in slices and it then waits for approval, whatever the caps. The answer is the job as it stands.
 *
 * There is one job per build, language and mode. One that still runs or waits is returned as it is;
 * one that has ended is started again.
 */
export async function startFull(deps: Deps, build_id: string, lang: string): Promise<Job> {
  const language = await deps.db.getLanguage(lang);
  if (!language) throw new TranslateError('translate.lang_unknown');
  const have = deps.db.findJob ? await deps.db.findJob(build_id, lang, 'full') : null;
  if (!have) return await deps.db.insertJob({ build_id, lang, mode: 'full', base_build_id: null });
  if (!TERMINAL_STATUSES.includes(have.status)) return have;
  // Its work files are still being deleted: a new run would lose its own files to that.
  if (have.stats?.sweep) throw new TranslateError('translate.job_cleanup_pending');
  // `spent_usd` stays: it is what the ledger holds for this job, over all its runs.
  const again = await deps.db.cas(have, {
    status: 'estimating', stats: { run: (have.stats?.run ?? 0) + 1 }, batch_ids: [], error: null, estimate_usd: null, string_count: null,
    approved_by: null,
  });
  if (!again) throw new TranslateError('translate.conflict');
  return again;
}
