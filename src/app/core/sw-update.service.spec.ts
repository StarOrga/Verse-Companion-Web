import type { Mock } from 'vitest';
import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, UnrecoverableStateEvent, VersionEvent, VersionReadyEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { dismissBootSplash, resetBootSplashHolds } from './boot-splash';
import { SwUpdateService } from './sw-update.service';

/**
 * Guards the fresh-open-vs-active reload behaviour (feedback 4f9fcff8): a build
 * that is ready right after opening loads silently, while one that lands later —
 * the user is already on the page — only offers the deliberate reload prompt.
 */
describe('SwUpdateService', () => {
  let versionUpdates: Subject<VersionEvent>;
  let unrecoverable: Subject<UnrecoverableStateEvent>;
  let swUpdate: {
    isEnabled: boolean;
    versionUpdates: Subject<VersionEvent>;
    unrecoverable: Subject<UnrecoverableStateEvent>;
    checkForUpdate: Mock;
    activateUpdate: Mock;
  };
  let reload: Mock;
  let sessionStore: Map<string, string>;
  let service: SwUpdateService;
  let fireInput: (type: string) => void;
  /** Set `serviceWorker.controller` before init() to act as a page the worker already controls. */
  let fakeNavigator: { serviceWorker?: { controller: object | null } };

  const versionReady = (): VersionReadyEvent =>
    ({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' },
    }) as VersionReadyEvent;

  /** Flush the microtask queue so the fire-and-forget applyUpdate() settles. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    resetBootSplashHolds();
    versionUpdates = new Subject<VersionEvent>();
    unrecoverable = new Subject<UnrecoverableStateEvent>();
    swUpdate = {
      isEnabled: true,
      versionUpdates,
      unrecoverable,
      checkForUpdate: vi.fn().mockName('checkForUpdate').mockResolvedValue(true),
      activateUpdate: vi.fn().mockName('activateUpdate').mockResolvedValue(true),
    };
    reload = vi.fn().mockName('reload');
    sessionStore = new Map<string, string>();
    const inputListeners = new Map<string, () => void>();
    fireInput = (type) => inputListeners.get(type)?.();
    fakeNavigator = {};
    const fakeWindow = {
      navigator: fakeNavigator,
      addEventListener: (type: string, listener: () => void) => void inputListeners.set(type, listener),
      sessionStorage: {
        getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
        setItem: (k: string, v: string) => void sessionStore.set(k, v),
        removeItem: (k: string) => void sessionStore.delete(k),
      },
    };
    const fakeDoc = { location: { reload }, defaultView: fakeWindow };

    TestBed.configureTestingModule({
      providers: [
        SwUpdateService,
        { provide: SwUpdate, useValue: swUpdate },
        { provide: DOCUMENT, useValue: fakeDoc },
      ],
    });
    service = TestBed.inject(SwUpdateService);
  });

  it('silently activates and reloads when a build is ready right after opening', async () => {
    service.init();
    versionUpdates.next(versionReady());
    await flush();

    expect(swUpdate.activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // No prompt on a fresh open — the user just gets the newest site.
    expect(service.updateReady()).toBe(false);
    expect(sessionStore.get('sc.sw.autoReloaded')).toBe('1');
  });

  it('prompts (no silent reload) when a build lands while the user is on the page', async () => {
    service.init();
    // Simulate the update arriving well after startup — the user is settled.
    (service as unknown as { startedAt: number }).startedAt = Date.now() - 20_000;
    versionUpdates.next(versionReady());
    await flush();

    expect(reload).not.toHaveBeenCalled();
    expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
    expect(service.updateReady()).toBe(true);
  });

  for (const type of ['pointerdown', 'keydown', 'wheel']) {
    it(`prompts instead of reloading once a ${type} landed inside the grace window`, async () => {
      service.init();
      fireInput(type);
      versionUpdates.next(versionReady());
      await flush();

      expect(reload).not.toHaveBeenCalled();
      expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
      expect(service.updateReady()).toBe(true);
    });
  }

  it('auto-reloads at most once per session, then falls back to the prompt', async () => {
    service.init();
    versionUpdates.next(versionReady());
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);

    // A second ready build within the grace window must not loop the page.
    (service as unknown as { startedAt: number }).startedAt = Date.now();
    versionUpdates.next(versionReady());
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(service.updateReady()).toBe(true);
  });

  it('reloads once when the worker reports an unrecoverable state, then stops', () => {
    service.init();
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'hash mismatch' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStore.get('sc.sw.autoReloaded')).toBe('1');
    // A persistent broken state must not loop the page.
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'hash mismatch' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the service worker is disabled', () => {
    swUpdate.isEnabled = false;
    service.init();
    versionUpdates.next(versionReady());

    expect(swUpdate.checkForUpdate).not.toHaveBeenCalled();
    expect(service.updateReady()).toBe(false);
  });
  describe('boot splash during the startup check', () => {
    let splash: HTMLElement;
    const leaving = (): boolean => splash.classList.contains('scb-leave');

    beforeEach(() => {
      splash = document.createElement('div');
      splash.className = 'scb';
      document.body.appendChild(splash);
    });
    afterEach(() => {
      splash.remove();
      resetBootSplashHolds();
    });

    it('a first visit (no controlling worker) hands the splash over at once', () => {
      service.init();
      dismissBootSplash();
      expect(leaving()).toBe(true);
    });

    it('holds the splash until the worker reports no newer build', () => {
      fakeNavigator.serviceWorker = { controller: {} };
      service.init();
      dismissBootSplash();
      expect(leaving()).toBe(false);
      versionUpdates.next({ type: 'NO_NEW_VERSION_DETECTED', version: { hash: 'old' } });
      expect(leaving()).toBe(true);
    });

    it('releases the splash when the check answers "nothing new" without an event', async () => {
      fakeNavigator.serviceWorker = { controller: {} };
      swUpdate.checkForUpdate.mockResolvedValue(false);
      service.init();
      dismissBootSplash();
      await flush();
      expect(leaving()).toBe(true);
    });

    it('keeps the splash up from the found build to the silent reload', async () => {
      fakeNavigator.serviceWorker = { controller: {} };
      service.init();
      versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'new' } });
      dismissBootSplash();
      expect(leaving()).toBe(false);
      versionUpdates.next(versionReady());
      await flush();
      expect(reload).toHaveBeenCalledTimes(1);
      // The reload takes the splash with it: it never left on this page.
      expect(leaving()).toBe(false);
    });

    it('lets the page show when the found build will only raise the prompt', () => {
      fakeNavigator.serviceWorker = { controller: {} };
      service.init();
      fireInput('pointerdown');
      versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'new' } });
      dismissBootSplash();
      expect(leaving()).toBe(true);
    });

    it('lets the page show when the activation fails', async () => {
      fakeNavigator.serviceWorker = { controller: {} };
      swUpdate.activateUpdate.mockRejectedValue(new Error('gone'));
      service.init();
      dismissBootSplash();
      versionUpdates.next(versionReady());
      await flush();
      expect(reload).not.toHaveBeenCalled();
      expect(leaving()).toBe(true);
    });
  });
});
