import { DestroyRef, Injectable, InjectionToken, Injector, NgZone, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { logWarn } from '../core/log';
import { AssetPackageService } from './asset-package/asset-package.service';

/**
 * Idle prefetch of the open ship's 3D model (#404). The classic ship page shows
 * the model only after "3D" is pressed; once the page has settled and the
 * browser is idle, this downloads that one ship's package (row, manifest, GLBs)
 * and the three.js scene chunk into the caches the viewer reads, so the press
 * opens straight into the model.
 *
 * It only ever runs in spare time: low fetch priority, one file at a time, and
 * cancelled on any navigation and whenever the page starts a foreground load
 * (`yieldToForeground()`, e.g. opening the swap picker); it resumes on the
 * next idle stretch, already cached files are free. A press on "3D" while it
 * runs joins the download in flight (AssetPackageService.glb), never a second
 * request.
 *
 * The swap picker's lists are warmed by CodexSwapCandidatesService.preload
 * (#244), which honours the same `prefetchAllowed()` guard.
 */

/** Wait this long after the page settled before the first idle callback is asked for. */
export const SHIP_PREFETCH_START_DELAY_MS = 4000;
/** After a foreground load, wait this long before the prefetch resumes. */
export const SHIP_PREFETCH_RESUME_DELAY_MS = 3000;

/** Runs `run` in a later idle stretch; `signal` aborting means "never mind". */
export type ShipPrefetchScheduler = (run: () => void, delayMs: number, signal: AbortSignal) => void;

const defaultScheduler: ShipPrefetchScheduler = (run, delayMs, signal) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  const timer = setTimeout(() => {
    if (signal.aborted) return;
    if (typeof ric === 'function') ric(() => !signal.aborted && run(), { timeout: 10_000 });
    else run();
  }, delayMs);
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
};

export const SHIP_PREFETCH_SCHEDULER = new InjectionToken<ShipPrefetchScheduler>('SHIP_PREFETCH_SCHEDULER', {
  providedIn: 'root',
  factory: () => {
    const zone = inject(NgZone);
    return (run, delayMs, signal) => zone.runOutsideAngular(() => defaultScheduler(run, delayMs, signal));
  },
});

interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * May anything be downloaded speculatively? No when the reader asked to save
 * data or the connection is 2G-class.
 */
export function prefetchAllowed(nav: { connection?: ConnectionLike } | undefined = globalThis.navigator as never): boolean {
  const c = nav?.connection;
  if (!c) return true;
  if (c.saveData) return false;
  return c.effectiveType !== '2g' && c.effectiveType !== 'slow-2g';
}

/**
 * The 3D package is megabytes and every file is a Worker request (R2 cost
 * guard, storage.md): besides `prefetchAllowed()`, it is fetched ahead only on
 * a desktop-class connection and screen — never on 3G or a phone, where the
 * page opens without the model anyway.
 */
export function modelPrefetchAllowed(
  nav: { connection?: ConnectionLike } | undefined = globalThis.navigator as never,
  isPhone: () => boolean = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches,
): boolean {
  if (!prefetchAllowed(nav)) return false;
  if (nav?.connection?.effectiveType === '3g') return false;
  return !isPhone();
}

interface Run {
  readonly ship: string;
  /** Cancels the whole run (navigation, stop, a different ship). */
  readonly ctrl: AbortController;
  /** Cancels the current attempt only (a foreground load; the run resumes). */
  attempt: AbortController | null;
  readonly done: Promise<boolean>;
  resolve(v: boolean): void;
}

@Injectable({ providedIn: 'root' })
export class ShipPrefetchService {
  private readonly injector = inject(Injector);
  private readonly schedule = inject(SHIP_PREFETCH_SCHEDULER);
  /** Gate, swappable in tests. */
  allowed: () => boolean = () => modelPrefetchAllowed();
  private run: Run | null = null;

  constructor() {
    // Any navigation (another ship, another page, a query change) ends the run;
    // the page starts it again for the ship it then shows.
    const sub = inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationStart) this.stop();
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /**
   * Prefetch this ship's model in idle time. A second call for the same ship
   * returns the run in flight; a call for another ship cancels the first (one
   * ship only). Resolves true once everything is cached, false when skipped,
   * cancelled or failed.
   */
  start(ship: string): Promise<boolean> {
    if (!ship) return Promise.resolve(false);
    const key = ship.toLowerCase();
    if (this.run && this.run.ship === key && !this.run.ctrl.signal.aborted) return this.run.done;
    this.stop();
    if (!this.allowed()) return Promise.resolve(false);
    let resolve!: (v: boolean) => void;
    const done = new Promise<boolean>((r) => (resolve = r));
    const run: Run = { ship: key, ctrl: new AbortController(), attempt: null, done, resolve };
    run.ctrl.signal.addEventListener('abort', () => resolve(false), { once: true });
    this.run = run;
    this.scheduleAttempt(run, ship, SHIP_PREFETCH_START_DELAY_MS);
    return done;
  }

  /** Cancel the run: nothing more is requested, background downloads abort. */
  stop(): void {
    const run = this.run;
    this.run = null;
    if (!run) return;
    run.attempt?.abort();
    run.ctrl.abort();
  }

  /**
   * The page starts a load the reader is waiting for: get out of its way now,
   * carry on in the next idle stretch.
   */
  yieldToForeground(): void {
    const run = this.run;
    if (!run || !run.attempt) return;
    const attempt = run.attempt;
    run.attempt = null;
    attempt.abort();
  }

  private scheduleAttempt(run: Run, ship: string, delayMs: number): void {
    this.schedule(() => void this.attemptRun(run, ship), delayMs, run.ctrl.signal);
  }

  private async attemptRun(run: Run, ship: string): Promise<void> {
    if (this.run !== run || run.ctrl.signal.aborted || run.attempt) return;
    const attempt = new AbortController();
    run.attempt = attempt;
    const signal = AbortSignal.any([run.ctrl.signal, attempt.signal]);
    let ok = false;
    try {
      const packages = this.injector.get(AssetPackageService);
      const [model] = await Promise.all([
        packages.prefetchShip(ship, { signal }),
        signal.aborted ? undefined : packages.preloadScene(),
      ]);
      ok = model;
    } catch (err) {
      logWarn('ship-prefetch', 'prefetch failed', { ship, err });
    }
    if (run.attempt === attempt) run.attempt = null;
    if (this.run !== run) return;
    if (ok) {
      this.run = null;
      run.resolve(true);
    } else if (attempt.signal.aborted && !run.ctrl.signal.aborted) {
      // Pushed aside by a foreground load: resume later, finished files stay cached.
      this.scheduleAttempt(run, ship, SHIP_PREFETCH_RESUME_DELAY_MS);
    } else {
      // No package or a failure: one try per page visit is enough.
      this.run = null;
      run.resolve(false);
    }
  }
}
