/**
 * Is an update installer still writing this app's files?
 *
 * The updater quits the app and starts the NSIS installer silently; under load
 * that takes minutes. An operator who opens the app again in that window got an
 * app whose `resources/python` was half written — every sidecar died with
 * "No module named 'sc_extract'" (2026-11-15, 0.81.3). The installer's own
 * restart (`--force-run`) then hit the single-instance lock and quit.
 *
 * Two signals, both required, so a stale marker never blocks a start:
 *   - the updater's `pending-update.json` marker, written right before the
 *     install starts, is fresh (`MAX_INSTALL_MS`);
 *   - the staged installer .exe is locked — Windows denies opening a running
 *     executable for writing (EBUSY / EPERM).
 *
 * Pure: the main process gathers the inputs (`main/install-guard.ts`).
 */

/** An install that has not finished after this long is not waited for. */
export const MAX_INSTALL_MS = 15 * 60_000;

/** How long a start waits for a running install before giving up and starting anyway. */
export const INSTALL_WAIT_MS = 10 * 60_000;

export const INSTALL_POLL_MS = 1_000;

export interface InstallGuardInput {
  /** `at` of the pending-update marker, null when there is none. */
  markerAt: number | null;
  now: number;
  /** Some staged installer .exe could not be opened for writing. */
  installerLocked: boolean;
}

export function installInProgress(i: InstallGuardInput): boolean {
  if (i.markerAt === null || !Number.isFinite(i.markerAt)) return false;
  const age = i.now - i.markerAt;
  if (age < 0 || age > MAX_INSTALL_MS) return false;
  return i.installerLocked;
}

/** Error codes that mean "a process has this file open" on Windows. */
export function isLockError(code: unknown): boolean {
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}
