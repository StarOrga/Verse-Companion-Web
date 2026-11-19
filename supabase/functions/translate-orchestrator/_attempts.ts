// Dead-attempt bookkeeping for the heavy steps. A worker killed by the runtime (546: CPU / memory
// limit) never reaches a catch block, so nothing records the failure and the next tick repeats the
// same work forever. Before a heavy step the driver stamps `stats.run_at`; a step that ends normally
// clears it. A stamp that is still there and older than RUN_STALE_MS means the run died.

/** Longer than any request the platform lets live (the cron job's own timeout is 120 s). */
export const RUN_STALE_MS = 5 * 60_000;
/** Dead runs in a row (without progress in between) before the job is failed. */
export const MAX_DEAD_ATTEMPTS = 3;
/** Stored in `translation_jobs.error`; the admin UI maps `translate.*` keys to text. */
export const WORKER_LIMIT_KEY = 'translate.worker_limit';

export interface RunMarks {
  run_at?: string;
  dead?: number;
}

export type RunVerdict =
  /** Proceed; `dead` is the number of dead runs seen so far (0 when the last run ended cleanly). */
  | { kind: 'go'; dead: number }
  /** Another tick is working on it right now (a young stamp): leave it alone. */
  | { kind: 'busy' }
  /** The job died too often without progress: fail it. */
  | { kind: 'fail'; dead: number };

export function runVerdict(marks: RunMarks | null | undefined, nowMs: number): RunVerdict {
  const dead = marks?.dead ?? 0;
  if (!marks?.run_at) return { kind: 'go', dead };
  const at = Date.parse(marks.run_at);
  if (Number.isFinite(at) && nowMs - at < RUN_STALE_MS) return { kind: 'busy' };
  // The stamp outlived any possible run: that run was killed.
  const next = dead + 1;
  return next >= MAX_DEAD_ATTEMPTS ? { kind: 'fail', dead: next } : { kind: 'go', dead: next };
}
