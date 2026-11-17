// Background passes: work on the whole string table that must not happen in one request.
//
// The learning pass, the community-source import and the overlay rebuild each read ~90k keys and the
// whole translation memory. In one edge request that is several seconds of CPU; the runtime allows
// about two and killed all three every time (546). A pass does the same work in slices: one bounded
// step per request, its position in `translation_passes` (compare-and-set on `updated_at`), its
// intermediate results in R2. A killed request loses one slice; the next tick repeats that slice.
//
// This file is the driver only (dead-run bookkeeping, error counting, "again"); the steps live in
// _learn_pass.ts, _seed_pass.ts and _overlay.ts. Pure of Deno and of Postgres: the table comes in as PassDb.

import { MAX_DEAD_ATTEMPTS, runVerdict, WORKER_LIMIT_KEY } from './_attempts.ts';
import { sweepPrefix } from './_io.ts';
import type { Deps } from './_job.ts';
import { TranslateError } from './_errors.ts';

export type PassKind = 'learn' | 'seed' | 'overlay';

export interface Pass {
  id: string;
  kind: PassKind;
  lang: string;
  source_id: string | null;
  build_id: string | null;
  /** publish | seed | sync | backfill | again */
  reason: string;
  status: 'open' | 'done' | 'failed';
  phase: string;
  pos: number;
  total: number;
  state: Record<string, unknown>;
  run_at: string | null;
  dead: number;
  attempts: number;
  again: boolean;
  /** The state the pass that follows (`again`) starts with: what the newest request asked for. */
  next_state: Record<string, unknown> | null;
  /** Who asked (see PassRequest.token). */
  token: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type PassPatch = Partial<Pick<Pass, 'build_id' | 'status' | 'phase' | 'pos' | 'total' | 'state' | 'run_at' | 'dead' | 'attempts' | 'again' | 'error'>>;

export interface PassRequest {
  kind: PassKind;
  lang: string;
  source_id?: string | null;
  reason: string;
  state?: Record<string, unknown>;
  /**
   * Names the asker. A request that is repeated with the token of the open pass (a slice that was
   * killed after it asked) changes nothing, instead of ordering one more pass.
   */
  token?: string | null;
}

/** Where a pass keeps its work files; everything under it goes when the pass ends, either way. */
export function passPrefix(pass: Pick<Pass, 'id' | 'kind' | 'lang'>): string {
  if (pass.kind === 'learn') return `translation-work/learn-${pass.lang}/p-${pass.id}/`;
  return pass.kind === 'seed' ? `translation-work/seed-${pass.id}/` : `translation-work/ovl-${pass.id}/`;
}

export interface PassDb {
  /** Open passes, oldest first. */
  listOpen(): Promise<Pass[]>;
  get(id: string): Promise<Pass | null>;
  /** Compare-and-set on id + status + updated_at; stamps updated_at; null when someone else won. */
  cas(pass: Pass, patch: PassPatch): Promise<Pass | null>;
  /**
   * Opens a pass. When one of this kind, language and source is already open, that one is flagged `again`
   * (one more pass follows it, with the state of this request) and returned: a request is never lost and
   * never runs twice at once.
   */
  open(req: PassRequest): Promise<Pass>;
}

/** Errors in a row (not kills) before a pass is failed. */
export const MAX_PASS_ATTEMPTS = 5;

export type PassStep = (deps: Deps & { passes: PassDb }, pass: Pass) => Promise<Pass | null>;

/** Advances a pass and clears the run stamp: every step ends with this (or `finish` / `fail`). */
export function commit(deps: { passes: PassDb }, pass: Pass, patch: PassPatch): Promise<Pass | null> {
  return deps.passes.cas(pass, { ...patch, run_at: null, dead: 0, attempts: 0 });
}

export function mergeState(pass: Pass, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(pass.state ?? {}), ...patch };
}

export interface PassOutcome {
  id: string;
  kind: PassKind;
  lang: string;
  from: string;
  to: string;
  /** false when nothing was run (another request holds it): the caller may give the slot to someone else. */
  ran: boolean;
}

const label = (p: Pass) => (p.status === 'open' ? `${p.phase}:${p.pos}` : p.status);

/** The phase of a pass that gave up: it deletes its work files, then ends as `failed` with the error it kept. */
export const ABORT_PHASE = 'abort';
/** Work files deleted per slice of an aborting pass. */
const ABORT_KEYS = 150;

/** A pass that was asked for again while it ran is followed by one more, whether it ended well or not. */
async function follow(passes: PassDb, ended: Pass | null): Promise<void> {
  if (!ended || ended.status === 'open' || !ended.again) return;
  await passes.open({ kind: ended.kind, lang: ended.lang, source_id: ended.source_id, reason: 'again', state: ended.next_state ?? {} });
}

/**
 * One slice of one pass. A stamp left by a request that never ended means the runtime killed it; after
 * MAX_DEAD_ATTEMPTS in a row without progress the pass is failed instead of dying the same way forever.
 */
export async function advancePass(deps: Deps, pass: Pass, steps: Record<PassKind, PassStep>): Promise<PassOutcome> {
  const out = (to: Pass | null, ran: boolean): PassOutcome => ({
    id: pass.id, kind: pass.kind, lang: pass.lang, from: label(pass), to: to ? label(to) : label(pass), ran,
  });
  const passes = deps.passes;
  if (!passes || pass.status !== 'open') return out(null, false);
  const d = deps as Deps & { passes: PassDb };

  const v = runVerdict({ run_at: pass.run_at ?? undefined, dead: pass.dead }, deps.now().getTime());
  if (v.kind === 'busy') return out(null, false);
  const aborting = pass.phase === ABORT_PHASE;
  if (v.kind === 'fail') {
    deps.log('translate pass killed repeatedly', { pass: pass.id, kind: pass.kind, phase: pass.phase, dead: v.dead });
    // Killed while it was cleaning up: nothing more to try. Otherwise it gives up and cleans up first.
    const failed = await passes.cas(pass, aborting
      ? { status: 'failed', error: pass.error ?? WORKER_LIMIT_KEY, run_at: null, dead: v.dead }
      : { phase: ABORT_PHASE, pos: 0, error: WORKER_LIMIT_KEY, run_at: null, dead: 0, attempts: 0 });
    await follow(passes, failed);
    return out(failed, false);
  }
  const stamped = await passes.cas(pass, { run_at: deps.now().toISOString(), dead: v.dead });
  if (!stamped) return out(null, false);

  let after: Pass | null = null;
  try {
    if (aborting) {
      const swept = await sweepPrefix(deps.store, passPrefix(stamped), ABORT_KEYS);
      after = await passes.cas(stamped, swept
        ? { status: 'failed', run_at: null, dead: 0, attempts: 0 }
        : { pos: stamped.pos + 1, run_at: null, dead: 0, attempts: 0 });
    } else after = await steps[pass.kind](d, stamped);
  } catch (e) {
    const fresh = (await passes.get(pass.id)) ?? stamped;
    if (fresh.status !== 'open') return out(fresh, true);
    const key = e instanceof TranslateError ? e.key : null;
    const attempts = fresh.attempts + 1;
    const error = key ?? String((e as Error)?.message ?? e).slice(0, 300);
    deps.log('translate pass step error', { pass: pass.id, kind: pass.kind, phase: fresh.phase, error });
    // A translated key is a verdict (source not permitted, no build …): repeating the step cannot change it.
    const giveUp = !!key || attempts >= MAX_PASS_ATTEMPTS;
    if (!giveUp) after = await passes.cas(fresh, { run_at: null, attempts, error: aborting ? fresh.error : error });
    // The work files of a pass that gives up are deleted before it ends (the abort phase); a pass that
    // cannot even do that ends as it is.
    else if (aborting) after = await passes.cas(fresh, { status: 'failed', run_at: null, attempts });
    else after = await passes.cas(fresh, { phase: ABORT_PHASE, pos: 0, error: key ?? 'translate.internal', run_at: null, dead: 0, attempts: 0 });
    await follow(passes, after);
    return out(after ?? fresh, true);
  }
  // A step that returned without a commit (lost a race, nothing to do yet): give the stamp back.
  const cur = after ?? (await passes.get(pass.id));
  if (cur && cur.status === 'open' && cur.run_at) await passes.cas(cur, { run_at: null });
  await follow(passes, cur);
  return out(cur, true);
}

export { MAX_DEAD_ATTEMPTS };

/** In-memory PassDb: the unit tests, and callers that run a pass to its end in one process. */
/**
 * An asker that repeats itself (its slice was killed after it asked) finds the pass it ordered for
 * this long, also when that pass has ended meanwhile: a killed slice is run again after five minutes.
 */
export const TOKEN_WINDOW_MS = 24 * 3600_000;

export function memPasses(now: () => Date = () => new Date()): PassDb & { rows: Map<string, Pass> } {
  const rows = new Map<string, Pass>();
  let seq = 0;
  const same = (p: Pass, r: PassRequest) => p.status === 'open' && p.kind === r.kind && p.lang === r.lang && (p.source_id ?? '') === (r.source_id ?? '');
  return {
    rows,
    async listOpen() {
      return [...rows.values()].filter((p) => p.status === 'open').map((p) => structuredClone(p));
    },
    async get(id) {
      const p = rows.get(id);
      return p ? structuredClone(p) : null;
    },
    async cas(pass, patch) {
      const cur = rows.get(pass.id);
      if (!cur || cur.status !== pass.status || cur.updated_at !== pass.updated_at) return null;
      const next = { ...cur, ...structuredClone(patch), updated_at: `p${++seq}` };
      rows.set(pass.id, next);
      return structuredClone(next);
    },
    async open(req) {
      if (req.token) {
        const at = now().getTime();
        const mine = [...rows.values()].find((p) =>
          p.kind === req.kind && p.lang === req.lang && (p.source_id ?? '') === (req.source_id ?? '') && p.token === req.token &&
          at - Date.parse(p.created_at) < TOKEN_WINDOW_MS);
        if (mine) return structuredClone(mine);
      }
      const have = [...rows.values()].find((p) => same(p, req));
      if (have) {
        have.again = true;
        have.next_state = structuredClone(req.state ?? {});
        return structuredClone(have);
      }
      const row: Pass = {
        id: `pass${rows.size + 1}`, kind: req.kind, lang: req.lang, source_id: req.source_id ?? null, build_id: null,
        reason: req.reason, status: 'open', phase: 'start', pos: 0, total: 0, state: structuredClone(req.state ?? {}),
        run_at: null, dead: 0, attempts: 0, again: false, next_state: null, token: req.token ?? null, error: null,
        created_at: now().toISOString(), updated_at: `p${++seq}`,
      };
      rows.set(row.id, row);
      return structuredClone(row);
    },
  };
}
