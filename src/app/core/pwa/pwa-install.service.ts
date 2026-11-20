import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { environment } from '../../../environments/environment';
import { AnalyticsService, onTrackedEvent } from '../analytics.service';
import { logWarn } from '../log';
import { PWA_INSTALL_KEY } from '../storage-keys';
import {
  CALM_AFTER_SUCCESS_MS,
  CALM_IDLE_MS,
  EMPTY_INSTALL_STATE,
  IDLE_DELAY_MS,
  IDLE_MIN_SESSIONS,
  InstallPlatform,
  InstallState,
  InstallTrigger,
  TRIGGER_WINDOW_MS,
  backoffActive,
  calmView,
  isEligible,
  isSuccessEvent,
  withSessionTick,
} from './install-policy';

/** Chromium's `beforeinstallprompt` event (not in lib.dom). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** Everything the service reads from the device; the specs replace it. */
export interface PwaEnv {
  now(): number;
  coarsePointer(): boolean;
  standalone(): boolean;
  /** Signed in and on a shell page (not /login, not a public page). */
  signedInShellRoute(): boolean;
  /** No open dialog, no focused field, no other bottom toast, no landscape phone / fullscreen view. */
  calmDom(): boolean;
  platform(hasPromptEvent: boolean): InstallPlatform;
  isIpad(): boolean;
}

const PUBLIC_PREFIXES = ['/login', '/about', '/privacy', '/imprint', '/handoff'];

export const PWA_ENV = new InjectionToken<PwaEnv>('PWA_ENV', {
  providedIn: 'root',
  factory: () => {
    const router = inject(Router);
    const auth = inject(AuthService);
    const mq = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
    const touchMac = (): boolean => /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    const iosDevice = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) || touchMac();
    return {
      now: () => Date.now(),
      coarsePointer: () => mq('(pointer: coarse)'),
      standalone: () => mq('(display-mode: standalone)') || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      signedInShellRoute: () => !!auth.user() && !PUBLIC_PREFIXES.some((p) => router.url === p || router.url.startsWith(p + '/') || router.url.startsWith(p + '?')),
      calmDom: () => {
        if (document.querySelector('[aria-modal="true"], [scDialog], [scToastSlot]')) return false;
        const a = document.activeElement as HTMLElement | null;
        if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return false;
        return calmView({
          immersive: document.documentElement.classList.contains('sc-immersive'),
          compact: mq('(orientation: landscape) and (max-height: 500px)'),
          fullscreen: !!document.fullscreenElement,
          url: router.url,
        });
      },
      platform: (hasEvent) => (hasEvent ? 'android-native' : iosDevice() && /Safari/.test(navigator.userAgent) ? 'ios' : 'other'),
      isIpad: () => /iPad/.test(navigator.userAgent) || touchMac(),
    } satisfies PwaEnv;
  },
});

const POLL_MS = 500;

/**
 * Install-the-app logic: one `beforeinstallprompt` listener, `appinstalled`, standalone and platform
 * detection, and the "calm moment" scheduler for the automatic card (`<sc-install-prompt>`).
 * The rules (success verbs, back-off ladder, eligibility) live in `install-policy.ts`.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private readonly env = inject(PWA_ENV);
  private readonly analytics = inject(AnalyticsService);
  private readonly destroyRef = inject(DestroyRef);

  private deferred: BeforeInstallPromptEvent | null = null;
  private state: InstallState = { ...EMPTY_INSTALL_STATE };
  private memoryOnly = false;
  private inited = false;
  private shownThisSession = false;
  private lastInteraction = 0;
  private lastPersist = 0;
  private armed: { trigger: InstallTrigger; since: number } | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  readonly canInstall = signal(false);
  readonly installed = signal(false);
  readonly platform = signal<InstallPlatform>('other');
  /** The card is up (null = hidden) and what triggered it. */
  readonly prompt = signal<{ trigger: InstallTrigger } | null>(null);
  /** iOS instruction sheet open. */
  readonly iosSheetOpen = signal(false);
  readonly isIpad = signal(false);

  /** Menu entry: not installed and the browser can (event) or the reader can by hand (iOS). */
  readonly manualAvailable = () => !this.installed() && (this.canInstall() || this.platform() === 'ios');

  /** Called once from AppComponent. */
  init(): void {
    if (this.inited || typeof window === 'undefined') return;
    this.inited = true;
    this.isIpad.set(this.env.isIpad());
    this.state = this.load();
    this.installed.set(this.state.installed || this.env.standalone());
    this.platform.set(this.env.platform(false));
    this.state = withSessionTick(this.state, this.env.now());
    this.lastInteraction = this.env.now();
    this.save(true);

    const onBip = (e: Event): void => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
      this.platform.set('android-native');
      this.maybeArmIdle();
    };
    const onInstalled = (): void => {
      this.deferred = null;
      this.canInstall.set(false);
      this.installed.set(true);
      this.state = { ...this.state, installed: true };
      this.save(true);
      this.analytics.track('app:install_finish', { platform: this.platform() });
      this.hide();
    };
    const onActivity = (): void => this.noteInteraction();
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    const activity = ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll'] as const;
    for (const t of activity) window.addEventListener(t, onActivity, { capture: true, passive: true });
    const off = onTrackedEvent((name) => {
      if (isSuccessEvent(name)) this.arm('success');
    });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
      for (const t of activity) window.removeEventListener(t, onActivity, { capture: true });
      off();
      this.stopPoll();
      if (this.idleTimer) clearTimeout(this.idleTimer);
    });

    this.maybeArmIdle();
    if (!environment.production && new URLSearchParams(location.search).get('pwa-prompt') === 'force') {
      if (this.platform() === 'other') this.platform.set('android-native');
      setTimeout(() => this.show('manual'), 600);
    }
  }

  /** Last user input, from the activity listeners (and the specs). */
  noteInteraction(): void {
    const now = this.env.now();
    this.lastInteraction = now;
    if (now - this.lastPersist > 60_000) {
      this.state = { ...this.state, lastActivity: now };
      this.save(false);
    }
  }

  /** The fallback: from the 4th session, 20 s after boot (or after the install event arrives). */
  private maybeArmIdle(): void {
    if (this.idleTimer || this.state.sessions < IDLE_MIN_SESSIONS) return;
    this.idleTimer = setTimeout(() => this.arm('idle'), IDLE_DELAY_MS);
  }

  /** Waits for a calm moment (max 60 s), then shows the card. Ignored while one is pending or up. */
  arm(trigger: InstallTrigger): void {
    if (this.armed || this.prompt() || !this.eligible(trigger)) return;
    this.armed = { trigger, since: this.env.now() };
    if (!this.poll) this.poll = setInterval(() => this.tick(), POLL_MS);
  }

  /** One calm check; public for the specs (they drive the clock instead of waiting for the interval). */
  tick(): void {
    const a = this.armed;
    if (!a) return this.stopPoll();
    const now = this.env.now();
    if (now - a.since > TRIGGER_WINDOW_MS || !this.eligible(a.trigger)) return this.disarm();
    const quietFor = a.trigger === 'idle' ? CALM_IDLE_MS : CALM_AFTER_SUCCESS_MS;
    if (now - this.lastInteraction >= quietFor && this.env.calmDom()) {
      this.disarm();
      this.show(a.trigger);
    }
  }

  private disarm(): void {
    this.armed = null;
    this.stopPoll();
  }

  private stopPoll(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  private eligible(trigger: InstallTrigger): boolean {
    return isEligible({
      state: this.state,
      now: this.env.now(),
      trigger,
      platform: this.platform(),
      installable: this.platform() === 'ios' || this.canInstall(),
      standalone: this.env.standalone(),
      coarsePointer: this.env.coarsePointer(),
      signedInShellRoute: this.env.signedInShellRoute(),
      shownThisSession: this.shownThisSession,
    });
  }

  show(trigger: InstallTrigger): void {
    if (this.prompt()) return;
    this.shownThisSession = true;
    this.prompt.set({ trigger });
    this.analytics.track('app:install_prompt_show', { trigger, platform: this.platform() });
  }

  /**
   * "Install": on Android/desktop Chromium the stashed `prompt()` is called right here, synchronously
   * (it needs the click's user activation); on iOS the instruction sheet opens.
   */
  async install(): Promise<void> {
    const platform = this.platform();
    this.analytics.track('app:install_prompt_accept', { platform });
    const evt = this.deferred;
    if (evt) {
      this.deferred = null;
      this.canInstall.set(false);
      this.hide();
      try {
        void evt.prompt();
        const { outcome } = await evt.userChoice;
        if (outcome === 'dismissed') this.recordDismissal();
      } catch (err) {
        logWarn('pwa', 'install prompt failed', err);
      }
      return;
    }
    if (platform === 'ios') {
      this.hide();
      this.iosSheetOpen.set(true);
    }
  }

  /** "Later" (card) - counts for the back-off. */
  later(): void {
    this.hide();
    this.recordDismissal();
  }

  /** The iOS sheet was closed; without a finished install that is a dismissal. */
  closeIosSheet(): void {
    if (!this.iosSheetOpen()) return;
    this.iosSheetOpen.set(false);
    if (!this.installed()) this.recordDismissal();
  }

  /** Menu entry: no back-off, no eligibility. */
  manualInstall(): void {
    if (this.platform() === 'ios' && !this.deferred) {
      this.iosSheetOpen.set(true);
      this.analytics.track('app:install_prompt_accept', { platform: 'ios' });
    } else void this.install();
  }

  private hide(): void {
    this.prompt.set(null);
  }

  private recordDismissal(): void {
    const now = this.env.now();
    this.state = { ...this.state, dismissals: this.state.dismissals + 1, lastDismissedAt: now };
    this.save(true);
    this.analytics.track('app:install_prompt_close', { platform: this.platform(), dismissals: this.state.dismissals });
  }

  /** Back-off is running (for the specs and diagnostics). */
  get backoff(): boolean {
    return backoffActive(this.state, this.env.now());
  }

  get snapshot(): Readonly<InstallState> {
    return this.state;
  }

  private load(): InstallState {
    try {
      const raw = localStorage.getItem(PWA_INSTALL_KEY);
      if (raw) return { ...EMPTY_INSTALL_STATE, ...(JSON.parse(raw) as Partial<InstallState>) };
    } catch (err) {
      this.memoryOnly = true;
      logWarn('pwa', 'install state unreadable, using memory', err);
    }
    return { ...EMPTY_INSTALL_STATE };
  }

  private save(force: boolean): void {
    this.lastPersist = this.env.now();
    if (this.memoryOnly && !force) return;
    try {
      localStorage.setItem(PWA_INSTALL_KEY, JSON.stringify(this.state));
    } catch (err) {
      if (!this.memoryOnly) logWarn('pwa', 'install state not persisted', err);
      this.memoryOnly = true;
    }
  }
}
