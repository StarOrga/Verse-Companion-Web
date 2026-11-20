import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AnalyticsService } from '../analytics.service';
import { PWA_INSTALL_KEY } from '../storage-keys';
import { DAY_MS, SESSION_GAP_MS } from './install-policy';
import { PWA_ENV, PwaEnv, PwaInstallService } from './pwa-install.service';

describe('PwaInstallService', () => {
  let clock: number;
  let calm: boolean;
  let route: boolean;
  const track = vi.fn();
  const env = (): PwaEnv => ({
    now: () => clock,
    coarsePointer: () => true,
    standalone: () => false,
    signedInShellRoute: () => route,
    calmDom: () => calm,
    platform: (has) => (has ? 'android-native' : 'other'),
    isIpad: () => false,
  });
  const seed = (sessions: number, extra: object = {}) =>
    localStorage.setItem(PWA_INSTALL_KEY, JSON.stringify({ sessions, lastActivity: clock - SESSION_GAP_MS - 1, dismissals: 0, lastDismissedAt: null, installed: false, ...extra }));
  const make = () => {
    TestBed.configureTestingModule({ providers: [{ provide: PWA_ENV, useValue: env() }, { provide: AnalyticsService, useValue: { track } }] });
    const svc = TestBed.inject(PwaInstallService);
    svc.init();
    return svc;
  };
  const beforeInstall = () => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: Mock; userChoice: Promise<unknown> };
    e.prompt = vi.fn().mockResolvedValue(undefined);
    e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(e);
    return e;
  };
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_800_000_000_000;
    calm = true;
    route = true;
    track.mockReset();
    localStorage.removeItem(PWA_INSTALL_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(PWA_INSTALL_KEY);
  });

  it('stashes the install event (preventDefault) and exposes canInstall', () => {
    const svc = make();
    const e = beforeInstall();
    expect(e.defaultPrevented).toBe(true);
    expect(svc.canInstall()).toBe(true);
    expect(svc.platform()).toBe('android-native');
  });

  it('shows after a success once 2.5 s of calm have passed, and not before', () => {
    seed(1); // init counts the 2nd session
    const svc = make();
    beforeInstall();
    svc.arm('success');
    advance(2000);
    expect(svc.prompt()).toBeNull();
    advance(1000);
    expect(svc.prompt()).toEqual({ trigger: 'success' });
    expect(track).toHaveBeenCalledWith('app:install_prompt_show', { trigger: 'success', platform: 'android-native' });
  });

  it('input resets the calm window; an open dialog blocks it; 60 s without calm drops the trigger', () => {
    seed(1);
    const svc = make();
    beforeInstall();
    svc.arm('success');
    advance(2000);
    svc.noteInteraction();
    advance(2000);
    expect(svc.prompt()).toBeNull();
    calm = false;
    advance(61_000);
    calm = true;
    advance(5000);
    expect(svc.prompt()).toBeNull();
  });

  it('stays quiet in the first session, on a public route, and once shown in this session', () => {
    let svc = make();
    beforeInstall();
    svc.arm('success');
    advance(5000);
    expect(svc.prompt()).toBeNull(); // 1st session
    TestBed.resetTestingModule();
    seed(1);
    route = false;
    svc = make();
    beforeInstall();
    svc.arm('success');
    advance(5000);
    expect(svc.prompt()).toBeNull();
    route = true;
    svc.arm('success');
    advance(5000);
    expect(svc.prompt()?.trigger).toBe('success');
    svc.later();
    svc.arm('success');
    advance(5000);
    expect(svc.prompt()).toBeNull(); // one per session
  });

  it('later() records a dismissal, starts the 14-day back-off and persists it', () => {
    seed(1);
    const svc = make();
    beforeInstall();
    svc.show('success');
    svc.later();
    expect(svc.prompt()).toBeNull();
    expect(svc.backoff).toBe(true);
    expect(JSON.parse(localStorage.getItem(PWA_INSTALL_KEY)!).dismissals).toBe(1);
    expect(track).toHaveBeenCalledWith('app:install_prompt_close', { platform: 'android-native', dismissals: 1 });
    clock += 14 * DAY_MS;
    expect(svc.backoff).toBe(false);
  });

  it('install() calls the native prompt synchronously; a cancelled dialog counts as a dismissal', async () => {
    seed(1);
    const svc = make();
    const e = beforeInstall();
    e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    svc.show('manual');
    const p = svc.install();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    await p;
    expect(svc.snapshot.dismissals).toBe(1);
  });

  it('fires the idle fallback only from the 4th session (20 s on the page, then 8 s of silence)', () => {
    seed(3);
    const svc = make();
    beforeInstall();
    advance(19_000);
    svc.noteInteraction();
    advance(1000); // 20 s: armed, but only 1 s of silence
    expect(svc.prompt()).toBeNull();
    advance(6500);
    expect(svc.prompt()).toBeNull();
    advance(1000); // 8.5 s of silence
    expect(svc.prompt()?.trigger).toBe('idle');
  });

  it('does not run the idle fallback before the 4th session', () => {
    seed(2);
    const svc = make();
    beforeInstall();
    advance(60_000);
    expect(svc.prompt()).toBeNull();
  });

  it('appinstalled marks it installed for good and hides the card', () => {
    seed(1);
    const svc = make();
    svc.show('manual');
    window.dispatchEvent(new Event('appinstalled'));
    expect(svc.installed()).toBe(true);
    expect(svc.prompt()).toBeNull();
    expect(JSON.parse(localStorage.getItem(PWA_INSTALL_KEY)!).installed).toBe(true);
    expect(track).toHaveBeenCalledWith('app:install_finish', expect.anything());
  });
});
