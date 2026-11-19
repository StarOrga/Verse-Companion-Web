import { describe, it, expect } from 'vitest';
import { MAX_INSTALL_MS, installInProgress, isLockError } from '../src/lib/install-guard.js';

const NOW = 1_800_000_000_000;

describe('a start during a running update install', () => {
  it('waits while the marker is fresh and the staged installer is locked', () => {
    expect(installInProgress({ markerAt: NOW - 60_000, now: NOW, installerLocked: true })).toBe(true);
  });

  it('starts normally once the installer released its file', () => {
    expect(installInProgress({ markerAt: NOW - 60_000, now: NOW, installerLocked: false })).toBe(false);
  });

  it('never waits without the updater marker — a locked file alone is not an install', () => {
    expect(installInProgress({ markerAt: null, now: NOW, installerLocked: true })).toBe(false);
  });

  it('ignores a stale marker so a failed install cannot block every later start', () => {
    expect(installInProgress({ markerAt: NOW - MAX_INSTALL_MS - 1, now: NOW, installerLocked: true })).toBe(false);
    expect(installInProgress({ markerAt: NOW + 5_000, now: NOW, installerLocked: true })).toBe(false);
  });

  it('reads the Windows sharing-violation codes as a lock', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) expect(isLockError(code)).toBe(true);
    for (const code of ['ENOENT', 'EISDIR', undefined]) expect(isLockError(code)).toBe(false);
  });
});
