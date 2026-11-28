import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armBootSplashFailsafe,
  clearBootSplashResume,
  dismissBootSplash,
  holdBootSplash,
  markBootSplashResume,
  resetBootSplashHolds,
  SPLASH_FAILSAFE_MS,
  SPLASH_LEAVE_MS,
  SPLASH_MIN_SHOWN_MS,
  SPLASH_QUICK_LEAVE_MS,
  SPLASH_RESUME_KEY,
  SPLASH_REVEAL_MS,
  SPLASH_SETTLE_CAP_MS,
} from './boot-splash';

function mount(stageOpacity: string): HTMLElement {
  const splash = document.createElement('div');
  splash.className = 'scb';
  const stage = document.createElement('div');
  stage.className = 'scb-stage';
  stage.style.opacity = stageOpacity;
  splash.appendChild(stage);
  document.body.appendChild(splash);
  return splash;
}

/** Long enough for the minimum showing time and the wait for calm frames to be over. */
const SETTLED_MS = SPLASH_REVEAL_MS + SPLASH_MIN_SHOWN_MS + SPLASH_SETTLE_CAP_MS + 100;

describe('boot splash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBootSplashHolds();
    sessionStorage.removeItem(SPLASH_RESUME_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.scb').forEach((n) => n.remove());
  });

  it('is a no-op without a splash', () => {
    expect(() => dismissBootSplash()).not.toThrow();
  });

  it('fades the backdrop out quickly while its elements were never visible, never a cut', () => {
    const splash = mount('0');
    dismissBootSplash();
    expect(splash.classList.contains('scb-leave')).toBe(true);
    expect(splash.classList.contains('scb-quick')).toBe(true);
    expect(document.querySelector('.scb')).not.toBeNull();
    vi.advanceTimersByTime(SPLASH_QUICK_LEAVE_MS + 300);
    expect(document.querySelector('.scb')).toBeNull();
  });

  it('keeps a visible stage for its minimum time before it leaves', () => {
    const splash = mount('1');
    dismissBootSplash();
    // The logo only just appeared: no exit class yet.
    expect(splash.classList.contains('scb-leave')).toBe(false);
    vi.advanceTimersByTime(SETTLED_MS);
    expect(splash.classList.contains('scb-leave')).toBe(true);
    expect(splash.classList.contains('scb-quick')).toBe(false);
    expect(document.querySelector('.scb')).not.toBeNull();
    vi.advanceTimersByTime(SPLASH_LEAVE_MS + 300);
    expect(document.querySelector('.scb')).toBeNull();
  });

  it('removes on transitionend of the splash itself', () => {
    const splash = mount('1');
    dismissBootSplash();
    vi.advanceTimersByTime(SETTLED_MS);
    splash.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.scb')).toBeNull();
  });

  it('a second dismissal while one is under way changes nothing', () => {
    const splash = mount('1');
    dismissBootSplash();
    dismissBootSplash();
    vi.advanceTimersByTime(SETTLED_MS + SPLASH_LEAVE_MS + 300);
    expect(splash.isConnected).toBe(false);
  });

  it('a hold keeps the splash until its release, then the pending dismissal runs', () => {
    const splash = mount('0');
    const release = holdBootSplash();
    dismissBootSplash();
    vi.advanceTimersByTime(5000);
    expect(splash.classList.contains('scb-leave')).toBe(false);
    release();
    release();
    expect(splash.classList.contains('scb-leave')).toBe(true);
  });

  it('a released hold nobody waited on leaves the splash alone', () => {
    const splash = mount('1');
    holdBootSplash()();
    expect(splash.classList.contains('scb-leave')).toBe(false);
    expect(splash.isConnected).toBe(true);
  });

  it('notes the animation age for the next document while the splash is up', () => {
    mount('1');
    expect(markBootSplashResume()).toBe(true);
    const note = JSON.parse(sessionStorage.getItem(SPLASH_RESUME_KEY) ?? '{}') as { at: number; age: number };
    expect(typeof note.at).toBe('number');
    expect(note.age).toBeGreaterThanOrEqual(0);
    clearBootSplashResume();
    expect(sessionStorage.getItem(SPLASH_RESUME_KEY)).toBeNull();
  });

  it('leaves no note once the splash is leaving or gone', () => {
    expect(markBootSplashResume()).toBe(false);
    mount('0');
    dismissBootSplash();
    expect(markBootSplashResume()).toBe(false);
    expect(sessionStorage.getItem(SPLASH_RESUME_KEY)).toBeNull();
  });

  it('failsafe removes a splash nobody dismissed', () => {
    mount('1');
    armBootSplashFailsafe();
    vi.advanceTimersByTime(SPLASH_FAILSAFE_MS + 1);
    expect(document.querySelector('.scb')).toBeNull();
  });
});
