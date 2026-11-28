import { logWarn } from './log';
import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject, signal } from '@angular/core';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { clearBootSplashResume, holdBootSplash, markBootSplashResume } from './boot-splash';

/**
 * Surfaces ngsw "new version ready" events to the UI and performs the
 * activate-and-reload.
 *
 * Without this, ngsw downloads a new deploy in the background but never
 * activates it while any tab stays open — returning users keep seeing a stale
 * app shell (missing nav links, chunk-hash mismatches that bounce deep links
 * to /news). Wiring SwUpdate lets us prompt for a reload the moment a newer
 * build is ready.
 */
@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);

  /** True once a newer version is fully downloaded and ready to activate. */
  readonly updateReady = signal(false);

  /** Poll interval for long-open tabs (desktop PWA stays open for hours). */
  private static readonly POLL_MS = 30 * 60 * 1000;

  /**
   * Startup grace window: a newer build that becomes ready this soon after the
   * app opens is treated as a *fresh open* and activated silently (see
   * {@link onVersionReady}). A build that lands later means the user is already
   * settled on the page, so it gets the deliberate reload prompt instead
   * (feedback 4f9fcff8).
   */
  private static readonly STARTUP_GRACE_MS = 10 * 1000;

  /**
   * sessionStorage flag marking that this browsing session already auto-reloaded
   * once for an update. It caps silent reloads at one per session so a
   * pathological "always ready" state can never trap the page in a reload loop —
   * any further ready build in the same session falls through to the prompt.
   */
  private static readonly AUTO_RELOAD_FLAG = 'sc.sw.autoReloaded';

  /**
   * Longest the boot splash waits for the worker's answer to "is there a newer build?" once
   * the page is ready. The answer usually arrives while the page still loads, so this costs
   * nothing; without it a build found a moment later reloads a page that just appeared.
   */
  private static readonly CHECK_HOLD_MS = 1500;

  /** Guards against double-wiring (subscription + timer) if init() re-runs. */
  private initialized = false;
  /** Guards against concurrent activate-and-reload from double clicks. */
  private applying = false;
  /** Epoch ms of the last init() — the anchor for the startup grace window. */
  private startedAt = 0;
  /** The user clicked, typed or scrolled since opening: no silent reload any more. */
  private interacted = false;
  /** Releases the boot splash held for the startup check (see {@link holdSplashForCheck}); null = not held. */
  private releaseSplash: (() => void) | null = null;
  /** Ends the splash hold when the worker stays silent or the download outlasts the grace window. */
  private splashTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Subscribe to version events and start polling. No-op when the service
   * worker is disabled (dev mode or unsupported browser) or already wired.
   */
  init(): void {
    if (this.initialized || !this.swUpdate.isEnabled) {
      return;
    }
    this.initialized = true;
    this.startedAt = Date.now();
    this.watchForInteraction();
    this.holdSplashForCheck();

    // versionUpdates can emit outside the Angular zone; re-enter so the
    // signal write reliably schedules CD for the OnPush banner.
    this.swUpdate.versionUpdates.subscribe((event) => this.zone.run(() => this.onVersionEvent(event)));

    // A cached asset whose hash no longer exists on the server leaves the
    // shell broken until a full reload; the SW reports it once and never
    // recovers by itself. One silent reload per session (same flag as the
    // startup auto-reload) so a persistent state cannot loop the page.
    this.swUpdate.unrecoverable.subscribe(() =>
      this.zone.run(() => {
        if (this.autoReloadedThisSession()) return;
        this.markAutoReloaded();
        markBootSplashResume(this.document);
        this.document.location.reload();
      }),
    );

    // A long-open tab would otherwise only check on reload. Poll outside the
    // Angular zone so the timer never keeps the zone unstable (which would
    // delay `registerWhenStable` and CD).
    this.swUpdate
      .checkForUpdate()
      // false = no newer build: the splash may go. true = one is ready, VERSION_READY decides.
      .then((found) => {
        if (!found) this.endSplashHold();
      })
      .catch((e) => {
        this.endSplashHold();
        logWarn('sw', 'checkForUpdate failed', e);
      });
    this.zone.runOutsideAngular(() => {
      setInterval(
        () => this.swUpdate.checkForUpdate().catch((e) => logWarn('sw', 'checkForUpdate failed', e)),
        SwUpdateService.POLL_MS,
      );
    });
  }

  /**
   * React to a newer build being ready. A fresh open (a ready version within the
   * startup grace window) is activated and loaded silently, so the returning
   * user simply gets the newest site with no reload button. A version that lands
   * later — the user is already on the page and mid-task — instead raises the
   * prompt, so they choose when to reload without losing their view (feedback
   * 4f9fcff8). The same goes for a user who already clicked, typed or scrolled
   * inside the window: the reload would throw away what they started, and the
   * next open gets the new build anyway. The once-per-session guard keeps a
   * persistent "ready" state from looping the page.
   */
  private onVersionReady(): void {
    if (this.silentReloadAllowed()) {
      this.markAutoReloaded();
      // The splash is still up (held since the build was found): the next document carries its animation on.
      markBootSplashResume(this.document);
      void this.applyUpdate().then(() => {
        // Still here and no longer applying = the activation failed: no reload comes, the page may show.
        if (this.applying) return;
        clearBootSplashResume(this.document);
        this.endSplashHold();
      });
      return;
    }
    this.endSplashHold();
    this.updateReady.set(true);
  }

  /** A fresh open nobody has touched yet, with this session's one silent reload unspent. */
  private silentReloadAllowed(): boolean {
    const withinStartup = Date.now() - this.startedAt < SwUpdateService.STARTUP_GRACE_MS;
    return withinStartup && !this.interacted && !this.autoReloadedThisSession();
  }

  private onVersionEvent(event: VersionEvent): void {
    switch (event.type) {
      case 'VERSION_READY':
        this.onVersionReady();
        break;
      case 'VERSION_DETECTED':
        // A build is downloading. If it will load silently, the splash stays until the reload
        // (one loading sequence instead of page, reload, splash again) — at most until the
        // grace window ends, after which the build only raises the prompt anyway.
        if (this.releaseSplash && this.silentReloadAllowed()) {
          this.armSplashTimer(SwUpdateService.STARTUP_GRACE_MS - (Date.now() - this.startedAt));
        } else {
          this.endSplashHold();
        }
        break;
      default:
        // NO_NEW_VERSION_DETECTED, VERSION_INSTALLATION_FAILED: nothing to wait for.
        this.endSplashHold();
    }
  }

  /**
   * A page this worker already controls may be about to reload into a newer build. Hold the
   * boot splash until the worker has answered the startup check, so the reload never hits a
   * page that just appeared. A first visit (no controller yet) has nothing to update.
   */
  private holdSplashForCheck(): void {
    if (!this.window()?.navigator?.serviceWorker?.controller) return;
    this.releaseSplash = holdBootSplash();
    this.armSplashTimer(SwUpdateService.CHECK_HOLD_MS);
  }

  private armSplashTimer(ms: number): void {
    if (this.splashTimer !== null) clearTimeout(this.splashTimer);
    this.zone.runOutsideAngular(() => {
      this.splashTimer = setTimeout(() => this.endSplashHold(), Math.max(0, ms));
    });
  }

  private endSplashHold(): void {
    if (this.splashTimer !== null) clearTimeout(this.splashTimer);
    this.splashTimer = null;
    this.releaseSplash?.();
    this.releaseSplash = null;
  }

  /** Flags the first input. Outside the zone: it only sets a field, no CD needed. */
  private watchForInteraction(): void {
    const view = this.window();
    if (!view) return;
    const mark = (): void => {
      this.interacted = true;
    };
    this.zone.runOutsideAngular(() => {
      for (const type of ['pointerdown', 'keydown', 'wheel']) {
        view.addEventListener(type, mark, { capture: true, once: true, passive: true });
      }
    });
  }

  /** Whether this browsing session already spent its one silent auto-reload. */
  private autoReloadedThisSession(): boolean {
    try {
      return this.window()?.sessionStorage.getItem(SwUpdateService.AUTO_RELOAD_FLAG) === '1';
    } catch {
      // sessionStorage can throw (private mode / disabled storage) — treat as
      // "not yet reloaded" so the feature degrades to always prompting.
      return false;
    }
  }

  /** Record that this session used its silent auto-reload. Best-effort. */
  private markAutoReloaded(): void {
    try {
      this.window()?.sessionStorage.setItem(SwUpdateService.AUTO_RELOAD_FLAG, '1');
    } catch {
      // Ignore — worst case is one extra silent reload if storage is unavailable.
    }
  }

  /** The document's default view, or null when running without a window (SSR). */
  private window(): (Window & typeof globalThis) | null {
    return this.document.defaultView;
  }

  /** Activate the downloaded version and hard-reload into it. */
  async applyUpdate(): Promise<void> {
    if (this.applying) {
      return;
    }
    this.applying = true;
    try {
      await this.swUpdate.activateUpdate();
      this.document.location.reload();
    } catch {
      // Activation failed (e.g. the new worker vanished) — allow a retry on
      // the next prompt instead of leaving the button silently inert.
      this.applying = false;
    }
  }
}
