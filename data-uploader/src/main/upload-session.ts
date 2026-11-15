/**
 * Main-process owner of the durable upload job + its pause signal.
 *
 * Division of labour: the **renderer** sequences the three upload stages
 * (bundle → catalog → skins, see `doUploadAfterAuth`), while **main** owns the
 * things that must outlive it — the on-disk cursor and the pause/cancel signal.
 * A renderer reload, a window close, or a hard `taskkill` therefore cannot lose
 * upload progress: the job file under `userData` is the single source of truth,
 * and the next launch simply reads it back and continues.
 *
 * The store is deliberately single-job: one machine uploads one extract at a
 * time, and keeping a history would only invite resuming a job whose out_dir
 * was already cleaned up.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log';
import {
  UploadJobStore,
  createJob,
  isResumable,
  describeResume,
  resumeSummary,
  rehydrateResult,
  MANIFEST_FILE,
  type TextIO,
  type JobOrigin,
  type UploadJobState,
  type JobNat,
  type ResumeSummary,
  type RehydrateResult,
} from '../lib/upload-job.js';
import {
  catalogHooks,
  skinHooks,
  type CatalogHookSet,
  type SkinHookSet,
} from '../lib/upload-hooks.js';
import { createPauseControl, type PauseControl, type RunSignal } from '../lib/pause-control.js';
import { applyReset, resumeCompat } from '../lib/resume-compat.js';
import { currentRevisions, type SubthemeKey } from '../lib/subthemes.js';
import { TOOL_VERSION } from '../lib/release-token.js';
import * as resources from './resources.js';

const JOB_FILE = 'upload-job.json';

let _store: UploadJobStore | null = null;
let _control: PauseControl | null = null;

function store(): UploadJobStore {
  if (_store) return _store;
  const path = join(app.getPath('userData'), JOB_FILE);
  const io: TextIO = {
    read: () => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
    write: (text) => writeFileSync(path, text, { encoding: 'utf-8', mode: 0o600 }),
    remove: () => {
      if (existsSync(path)) rmSync(path, { force: true });
    },
  };
  _store = new UploadJobStore(io);
  return _store;
}

/** This uploader as a job origin: what a newly started job is stamped with. */
function currentOrigin(): JobOrigin {
  return { uploaderVersion: TOOL_VERSION, revisions: currentRevisions() };
}

/** The extract's own `tool_version` — the fallback for jobs without an origin. */
function extractToolVersion(outDir: string): string | null {
  try {
    const m = JSON.parse(readFileSync(join(outDir, MANIFEST_FILE), 'utf-8')) as { tool_version?: unknown };
    return typeof m.tool_version === 'string' ? m.tool_version : null;
  } catch {
    return null;
  }
}

/** Set when a job was dropped because this uploader extracts differently — for the renderer's notice. */
let _restarted: { changed: SubthemeKey[]; reason: 'extractor-changed' | 'unknown-origin' } | null = null;

/**
 * The stored job, reconciled with THIS uploader (`resume-compat.ts`): a job
 * whose extract was made by other metadata logic is dropped (the next run
 * extracts again from step 1), one whose silhouette / 3D logic changed gets
 * those stages reset. Every read that can lead to a resume goes through here.
 */
function loadReconciled(): UploadJobState | null {
  const state = store().load();
  if (!state || !isResumable(state)) return state;
  const compat = resumeCompat({
    job: state,
    current: currentOrigin(),
    extractToolVersion: state.origin ? null : extractToolVersion(state.outDir),
  });
  if (compat.action === 'keep') return state;
  if (compat.action === 'restart') {
    store().clear();
    _restarted = { changed: compat.changed, reason: compat.reason };
    log.info(
      `[upload-job] dropped ${state.jobId} (${describeResume(state)}): ${compat.reason}` +
        (compat.changed.length ? ` [${compat.changed.join(', ')}]` : '') +
        ' — the next run extracts again',
    );
    return null;
  }
  log.info(
    `[upload-job] ${state.jobId}: [${compat.changed.join(', ')}] changed since the job started` +
      (compat.stages.length ? ` — restarting [${compat.stages.join(', ')}]` : ''),
  );
  return store().save(applyReset(state, compat.stages, currentOrigin()));
}

/** The live pause control for the current run (created on demand). */
export function control(): PauseControl {
  if (!_control) _control = createPauseControl('running');
  return _control;
}

/** True once this app session started/adopted a run (a stale job file from a crash must not count). */
let _begun = false;

/**
 * Is an upload run actively in flight in THIS session? Catalog/bundle upload is
 * not an extraction job, and between pipeline steps no child process runs while
 * the run is still going — the durable status is what tells both apart from a
 * paused or finished run.
 */
export function isRunInFlight(): boolean {
  return _begun && store().load()?.status === 'running';
}

export interface JobView {
  state: UploadJobState | null;
  resumable: boolean;
  signal: RunSignal;
  /** Short TECHNICAL summary of where a resume would pick up (logs/telemetry). */
  resumeHint: string | null;
  /** Structured, localization-ready resume picture — the renderer's banner + seed. */
  resumeSummary: ResumeSummary | null;
  /** An interrupted job this uploader could not finish (other extraction logic) was dropped. */
  restartedAfterUpdate?: { changed: SubthemeKey[]; reason: 'extractor-changed' | 'unknown-origin' } | null;
}

export function view(): JobView {
  const state = loadReconciled();
  const resumable = isResumable(state);
  return {
    state,
    resumable,
    signal: control().state(),
    resumeHint: state && resumable ? describeResume(state) : null,
    resumeSummary: state && resumable ? resumeSummary(state) : null,
    restartedAfterUpdate: _restarted,
  };
}

/**
 * Start a job for `outDir`, or adopt the stored one when it targets the same
 * extract. Adopting is what makes "close the app, reopen, continue" work; a
 * different out_dir means the operator moved on, so the old job is dropped.
 */
export function begin(outDir: string, nat: JobNat): UploadJobState {
  _begun = true;
  const existing = loadReconciled();
  if (existing && existing.outDir === outDir && isResumable(existing)) {
    log.info(`[upload-job] resuming ${existing.jobId} at ${describeResume(existing)}`);
    _control = createPauseControl('running');
    return store().save({ ...existing, origin: existing.origin ?? currentOrigin(), status: 'running', error: null })!;
  }
  _restarted = null;
  const fresh = createJob(randomUUID(), outDir, nat, Date.now(), currentOrigin());
  _control = createPauseControl('running');
  log.info(`[upload-job] new job ${fresh.jobId} for ${outDir}`);
  return store().save(fresh);
}

export function get(): UploadJobState | null {
  return store().load();
}

export function update(fn: (s: UploadJobState) => UploadJobState): UploadJobState | null {
  return store().update(fn);
}

/** Resume wiring for the catalog stage, bound to this job + pause signal. */
export function hooksForCatalog(): CatalogHookSet {
  return catalogHooks(store(), control(), resources.pacer());
}

/** Resume wiring for the skin stage. */
export function hooksForSkins(): SkinHookSet {
  return skinHooks(store(), control(), resources.pacer());
}

export function pause(): JobView {
  control().pause();
  update((s) => ({ ...s, status: 'paused' }));
  log.info('[upload-job] pause requested');
  return view();
}

/**
 * Rebuild the extraction result the renderer's upload flow drives on, from the
 * stored job + the extract's manifest. Needed after a restart: the renderer's
 * in-memory result died with the old process, and without one its resume path
 * used to return before doing anything — the "Fortsetzen does nothing" hang.
 */
export function rehydrate(): RehydrateResult {
  const res = rehydrateResult(loadReconciled(), {
    exists: existsSync,
    readText: (path) => {
      try {
        return readFileSync(path, 'utf-8');
      } catch {
        return null;
      }
    },
  });
  if (res.ok) log.info(`[upload-job] rehydrated extract result from ${res.result.output_dir}`);
  else log.warn(`[upload-job] cannot resume: ${res.error}`);
  return res;
}

/** Clear the pause signal so the renderer can re-drive the stages. */
export function resume(): JobView {
  _control = createPauseControl('running');
  update((s) => ({ ...s, status: 'running', error: null }));
  log.info('[upload-job] resume requested');
  return view();
}

/** Abandon the job entirely — the operator does not want it continued. */
export function cancel(): JobView {
  control().cancel();
  store().clear();
  _restarted = null;
  log.info('[upload-job] cancelled + job state cleared');
  return {
    state: null,
    resumable: false,
    signal: 'cancelled',
    resumeHint: null,
    resumeSummary: null,
    restartedAfterUpdate: null,
  };
}

/** Mark the whole run finished and drop the state file. */
export function finish(): void {
  store().clear();
  log.info('[upload-job] finished — job state cleared');
}

/** Record a hard failure so the next launch can offer a retry. */
export function fail(error: string): void {
  update((s) => ({ ...s, status: 'error', error }));
}
