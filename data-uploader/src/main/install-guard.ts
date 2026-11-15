/**
 * Hold a start that lands while an update installer is still writing the app
 * (see `lib/install-guard.ts` for why). Runs first thing in `whenReady`: no
 * window, no sidecar, no auto-run until the install is done — then the app
 * restarts itself, so the fresh files are what runs.
 */

import { app, Notification } from 'electron';
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log';
import {
  INSTALL_POLL_MS,
  INSTALL_WAIT_MS,
  installInProgress,
  isLockError,
} from '../lib/install-guard.js';
import { getSettings } from './settings.js';
import de from '../i18n/de.json';
import en from '../i18n/en.json';

/** The updater's marker, written right before a silent install starts (updater.ts). */
function markerAt(): number | null {
  try {
    const raw = readFileSync(join(app.getPath('userData'), 'pending-update.json'), 'utf-8');
    const at = (JSON.parse(raw) as { at?: unknown }).at;
    return typeof at === 'number' ? at : null;
  } catch {
    return null;
  }
}

/** electron-updater stages the installer in `%LOCALAPPDATA%/<updaterCacheDirName>/pending`. */
function pendingDir(): string | null {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  let name = '@sc-companiondata-uploader-updater';
  try {
    const yml = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf-8');
    const m = /^updaterCacheDirName:\s*'?([^'\r\n]+)'?\s*$/m.exec(yml);
    if (m?.[1]) name = m[1].trim();
  } catch {
    /* dev run / no yml — keep the default */
  }
  return join(local, name, 'pending');
}

function installerLocked(): boolean {
  const dir = pendingDir();
  if (!dir || !existsSync(dir)) return false;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.exe'));
  } catch {
    return false;
  }
  for (const f of files) {
    try {
      closeSync(openSync(join(dir, f), 'r+'));
    } catch (err) {
      if (isLockError((err as NodeJS.ErrnoException).code)) return true;
    }
  }
  return false;
}

function running(): boolean {
  return installInProgress({ markerAt: markerAt(), now: Date.now(), installerLocked: installerLocked() });
}

function text(key: 'installRunningTitle' | 'installRunningBody'): string {
  const dict = (getSettings().language ?? app.getLocale()).toLowerCase().startsWith('de') ? de : en;
  return (dict as { update?: Record<string, string> }).update?.[key] ?? key;
}

let _holding = false;

/** True while a start waits for a running install — no window may open meanwhile. */
export function holdingForInstall(): boolean {
  return _holding;
}

/**
 * True when an install was running: the app waited for it and is restarting
 * (the caller must not go on). False = nothing to wait for, start normally.
 */
export async function holdForRunningInstall(): Promise<boolean> {
  if (process.platform !== 'win32' || !app.isPackaged || !running()) return false;
  _holding = true;
  log.warn('[install-guard] an update installer is still running — waiting for it before starting');
  try {
    if (Notification.isSupported()) {
      new Notification({ title: text('installRunningTitle'), body: text('installRunningBody') }).show();
    }
  } catch {
    /* a missing notification must not block the wait */
  }
  const started = Date.now();
  while (running() && Date.now() - started < INSTALL_WAIT_MS) {
    await new Promise((r) => setTimeout(r, INSTALL_POLL_MS));
  }
  log.info(`[install-guard] installer done after ${Math.round((Date.now() - started) / 1000)} s — restarting`);
  app.relaunch();
  app.exit(0);
  return true;
}
