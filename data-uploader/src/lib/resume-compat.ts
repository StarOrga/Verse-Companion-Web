/**
 * Can an interrupted upload job be finished by THIS uploader?
 *
 * A job uploads one extract, and the extract was made by the uploader that
 * started the job. An update can land in between (the app closes for the
 * install, the operator resumes afterwards). Continuing blindly would finish
 * an extract made by the old metadata logic with the new 3D / silhouette
 * logic — and the ledger would then record the new revisions for data the old
 * code produced, so the server keeps a mix of both and never repairs it.
 *
 * So a resume compares the job's origin (`JobOrigin`, the uploader version and
 * subtheme revisions that started it) with this uploader:
 *
 *   - a catalog subtheme changed (metadata extraction) → `restart`: drop the
 *     job; the next run extracts again and starts at step 1. The per-row diff,
 *     the ledger skip and the hull cache still keep that run cheap.
 *   - only silhouettes and/or hulls changed → `reset` those stages: the
 *     metadata already on the server stays valid, the steps whose logic moved
 *     run again from their start (the hull cache and the per-ship upload check
 *     still skip what is unchanged).
 *   - nothing changed → `keep`, resume exactly where it stopped.
 *
 * A job from before origins were recorded (≤ 0.81.4) is judged by the
 * extract's own `tool_version`: the same uploader version keeps it, anything
 * else cannot be proven compatible and restarts — wrongly restarting costs a
 * re-run, wrongly resuming leaves mixed data.
 *
 * Pure: no I/O, so main and the tests share it.
 */

import type { JobOrigin, MacroStage, UploadJobState } from './upload-job.js';
import { CATALOG_SUBTHEMES, SUBTHEME_KEYS, type SubthemeKey } from './subthemes.js';

const SILHOUETTE_PHASE = 'codex_silhouettes';

export type ResumeCompat =
  | { action: 'keep' }
  | { action: 'reset'; stages: Extract<MacroStage, 'silhouettes' | 'skins'>[]; changed: SubthemeKey[] }
  | { action: 'restart'; changed: SubthemeKey[]; reason: 'extractor-changed' | 'unknown-origin' };

export interface ResumeCompatInput {
  job: UploadJobState;
  /** This uploader's version and subtheme revisions. */
  current: JobOrigin;
  /** `tool_version` from the extract's manifest.json — only read for jobs without an origin. */
  extractToolVersion?: string | null;
}

/** Subthemes whose revision differs between the job's origin and this uploader. */
export function changedSubthemes(origin: JobOrigin, current: JobOrigin): SubthemeKey[] {
  return SUBTHEME_KEYS.filter((k) => origin.revisions[k] !== current.revisions[k]);
}

export function resumeCompat({ job, current, extractToolVersion }: ResumeCompatInput): ResumeCompat {
  const origin = job.origin;
  if (!origin) {
    if (extractToolVersion && extractToolVersion === current.uploaderVersion) return { action: 'keep' };
    return { action: 'restart', changed: [], reason: 'unknown-origin' };
  }
  const changed = changedSubthemes(origin, current);
  if (!changed.length) return { action: 'keep' };
  if (changed.some((k) => (CATALOG_SUBTHEMES as readonly SubthemeKey[]).includes(k))) {
    return { action: 'restart', changed, reason: 'extractor-changed' };
  }
  const stages: Extract<MacroStage, 'silhouettes' | 'skins'>[] = [];
  if (changed.includes('silhouettes') && job.silhouettes.status !== 'pending') stages.push('silhouettes');
  if (changed.includes('hulls') && (job.skins.status !== 'pending' || job.skins.doneShips.length)) {
    stages.push('skins');
  }
  // Empty `stages`: none of the changed steps had run yet, the new logic does
  // them anyway — the job only takes this uploader as its origin.
  return { action: 'reset', stages, changed };
}

/**
 * The job after a `reset`: the named stages start over, the origin becomes this
 * uploader (the stages left alone are identical under both — that is what made
 * it a reset and not a restart).
 */
export function applyReset(
  job: UploadJobState,
  stages: readonly ('silhouettes' | 'skins')[],
  current: JobOrigin,
): UploadJobState {
  const next: UploadJobState = { ...job, origin: current };
  if (stages.includes('silhouettes')) {
    next.silhouettes = { status: 'pending' };
    // The silhouette rows ride on the catalog cursor as phase
    // `codex_silhouettes`: left marked done, the new outlines would be skipped.
    next.catalog = {
      ...job.catalog,
      donePhases: job.catalog.donePhases.filter((p) => p !== SILHOUETTE_PHASE),
      cursor: job.catalog.cursor?.phase === SILHOUETTE_PHASE ? null : (job.catalog.cursor ?? null),
    };
  }
  if (stages.includes('skins')) next.skins = { status: 'pending', doneShips: [] };
  return next;
}
