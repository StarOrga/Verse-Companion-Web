/**
 * What a `JobStall` crash report says about WHERE a native job went quiet.
 *
 * The stall watchdog (`watchdog.ts`) only knows that no event arrived for a
 * while. On its own the report carried the job id and the window length — not
 * enough to tell a wedged converter from a slow part or a sleeping PC. The
 * tracker remembers the last phase, the last counter (`armor-packages
 * 133/4456`) and the last log line of the job, and `jobStallReport` folds them
 * into the report together with the time it actually waited.
 *
 * Pure (no Electron) so it is unit-testable.
 */

import { redactHome } from './job-diagnostics.js';

/** Per-line ceiling for the last log line in the report. */
const MAX_LOG_CHARS = 300;

/**
 * How long a job may stay silent before it counts as stalled.
 *
 * Extraction (and every other job): generous enough to clear the longest
 * opaque stages (open the archive, decompress the DataCore). The 3D build
 * (`skin`) runs cgf-converter (up to 600 s per call) and gltf-transform (up to
 * 900 s per call) — its window has to outlast the longest single tool call, or
 * a slow part is reported as a hang.
 */
export const JOB_STALL_MS = 5 * 60_000;
export const SKIN_STALL_MS = 20 * 60_000;

export function stallTimeoutFor(kind: string): number {
  return kind === 'skin' ? SKIN_STALL_MS : JOB_STALL_MS;
}

/** The subset of a sidecar event the tracker reads. */
export interface StallEvent {
  type: string;
  phase?: string;
  stage?: string;
  current?: number;
  total?: number;
  level?: string;
  message?: string;
}

export interface StallTracker {
  phase: string | null;
  stage: string | null;
  current: number | null;
  total: number | null;
  lastLog: string | null;
}

export function newStallTracker(): StallTracker {
  return { phase: null, stage: null, current: null, total: null, lastLog: null };
}

/** Remember where the job is. Cheap enough for the hot event path. */
export function noteStallEvent(t: StallTracker, ev: StallEvent): void {
  if (typeof ev.phase === 'string') t.phase = ev.phase;
  if (ev.type === 'progress') {
    if (typeof ev.stage === 'string') t.stage = ev.stage;
    t.current = typeof ev.current === 'number' ? ev.current : null;
    t.total = typeof ev.total === 'number' ? ev.total : null;
  } else if ((ev.type === 'log' || ev.type === 'warning' || ev.type === 'error') && ev.message) {
    t.lastLog = String(ev.message).trim();
  }
}

/** `armor-packages 133/4456`, `armor-packages 133`, or null. */
export function stallCounter(t: StallTracker): string | null {
  if (!t.stage) return null;
  if (t.current === null) return t.stage;
  return t.total === null ? `${t.stage} ${t.current}` : `${t.stage} ${t.current}/${t.total}`;
}

export interface JobStallReport {
  errorType: 'hang';
  name: 'JobStall';
  message: string;
  stack: null;
  extra: Record<string, unknown>;
}

export function jobStallReport(kind: string, jobId: string, idleMs: number, t: StallTracker): JobStallReport {
  const counter = stallCounter(t);
  // Only the stage NAME goes into the message — counters would split one
  // stall into a new error group per position; they sit in `extra`.
  const where = t.stage ?? t.phase;
  return {
    errorType: 'hang',
    name: 'JobStall',
    message: `${kind} job made no progress for ${Math.round(idleMs / 1000)}s${where ? ` (${where})` : ''}`,
    stack: null,
    extra: {
      kind,
      jobId,
      idleMs,
      timeoutMs: stallTimeoutFor(kind),
      phase: t.phase,
      counter,
      lastLog: t.lastLog ? redactHome(t.lastLog).slice(0, MAX_LOG_CHARS) : null,
    },
  };
}
