import { logWarn } from './log';
import { Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import type { PostHog } from 'posthog-js';
import { environment } from '../../environments/environment';
import { ConsentService } from './consent.service';
import type { EventName, EventProps, TrackArgs } from './analytics/events';
import { setErrorShownSink } from './describe-error';

export type { BetaArea } from './analytics/events';

/**
 * Anonymous product analytics via PostHog (issue #139).
 *
 * Two independent gates, both of which must be open before anything happens:
 *  1. `environment.posthog.key` is non-empty. Empty is the shipped default —
 *     the admin supplies the key separately, and until then this service is a
 *     no-op and the posthog-js chunk is never even fetched.
 *  2. The user opted into the `statistics` consent category. It defaults to
 *     off, so a fresh visitor sends nothing.
 *
 * Revoking consent at runtime opts out, resets the distinct id, and lets
 * `ConsentService` purge PostHog's localStorage keys — no reload needed.
 *
 * Privacy posture (deliberate, matches the "no cookies, no tracking-by-default"
 * promise the storage notice makes):
 *  - `persistence: 'localStorage'` — PostHog's default is cookies; we never set one.
 *  - `autocapture: false` — no blanket click/input capture; only explicit events.
 *  - `person_profiles: 'identified_only'` — visitors stay anonymous events; only a
 *    signed-in user with statistics consent is identified, by a salted hash of the
 *    account id plus its role (`AnalyticsIdentityService`) — never e-mail or name.
 *  - session replay only for sessions that hit an `$exception` (started from
 *    `captureException`), every input masked, `[data-ph-mask]` text masked.
 *  - heatmaps + dead clicks on; the `telemetry-saver` flag pauses replay and
 *    heatmaps near the free quota — errors and core events are never touched.
 *  - EU region; the browser talks to `/ingest` on the app's own domain
 *    (Vercel rewrite / dev proxy) so ad blockers and the CSP stay out of it.
 */
/** How long a pending flags answer is awaited before the defaults apply. */
export const FLAGS_TIMEOUT_MS = 2500;

/** PostHog flag that pauses replay and heatmaps (quota saver, admin-controlled). */
export const TELEMETRY_SAVER_FLAG = 'telemetry-saver';

/** The `<meta name="app-version">` the build stamps (`v0.265.1`), `dev` under `ng serve`. */
export function readAppRelease(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): string {
  return doc?.querySelector('meta[name="app-version"]')?.getAttribute('content')?.trim() || 'dev';
}

/** Whether PostHog's remote config says this project has no feature flags (so no flags answer will ever come). */
export function remoteConfigHasNoFlags(result: unknown): boolean {
  const r = result as { ok?: boolean; config?: { hasFeatureFlags?: boolean } } | null | undefined;
  return !!r && r.ok !== false && r.config?.hasFeatureFlags === false;
}

const trackedListeners = new Set<(event: string) => void>();

/**
 * Local-only tap on `track()` (runs before the consent check, sends nothing anywhere): lets a feature
 * react to "the user just did something" - e.g. the PWA install prompt waiting for a calm moment after
 * a success. Returns the unsubscribe function.
 */
export function onTrackedEvent(listener: (event: string) => void): () => void {
  trackedListeners.add(listener);
  return () => trackedListeners.delete(listener);
}

function notifyTracked(event: string): void {
  for (const l of trackedListeners) {
    try {
      l(event);
    } catch {
      /* a listener never breaks tracking */
    }
  }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly consent = inject(ConsentService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private client: PostHog | null = null;
  /** Feature flags as last reported by PostHog; empty until consent + load. */
  private readonly flagValues = signal<Readonly<Record<string, boolean | string>>>({});
  /** Flags, but only while statistics consent holds — never read before it. */
  readonly flags = computed(() => (this.consent.statisticsAllowed() ? this.flagValues() : {}));
  /** True once PostHog reported flags (or its load failed) - until then `flags` is only "not yet", not "off". */
  private readonly flagsSettled = signal(false);
  /**
   * Flags are still on their way: statistics consent holds and a key is configured, but PostHog has not
   * answered yet. A flag-driven decision (the `beta-*` areas) taken now would read the default, not the flag.
   */
  readonly flagsPending = computed(
    () => this.configured && this.consent.statisticsAllowed() && !this.flagsSettled(),
  );
  private flagsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a second concurrent lazy-load while the first is in flight. */
  private loading = false;
  private routerBound = false;
  /** The identity to apply once the client is loaded (and re-apply after a consent round trip). */
  private identity: { distinctId: string; role: string } | null = null;
  /** True once the client holds an identified person — only then does sign-out need reset(). */
  private identified = false;
  /** Replay started for this page session (an $exception happened). */
  private replayStarted = false;
  private saver = false;

  /** Set by `captureLanding()`, applied by whichever `enable()` call actually
   *  finishes loading the client — see that method for the race this avoids. */
  private pendingLandingUtm: Record<string, string> | null = null;
  /** One-shot guard — `captureLanding()` must register the UTM props at most once. */
  private landingCaptured = false;

  /** Whether a key is configured at all — false ships until the admin adds one. */
  private get configured(): boolean {
    return environment.posthog.key.trim().length > 0;
  }

  /**
   * Called once from AppComponent. Sets up the consent reaction; the library
   * itself loads lazily, only if and when consent is actually granted.
   */
  init(): void {
    if (!this.configured) return;
    this.bindErrorSink();
    // Explicit injector: init() is called from ngOnInit, outside an injection context.
    effect(
      () => {
        if (this.consent.statisticsAllowed()) void this.enable();
        else this.disable();
      },
      { injector: this.injector },
    );
    // The quota saver flag: pause replay + heatmaps while it is true.
    effect(() => this.applySaver(this.featureFlag(TELEMETRY_SAVER_FLAG) === true), { injector: this.injector });
  }

  /**
   * Records a catalogue event (`events.ts`). Safe to call unconditionally from
   * feature code: it is a no-op without a key, without consent, or before the
   * lazy load finished. Only catalogue names with their exact properties compile.
   */
  track<E extends EventName>(event: E, ...args: TrackArgs<E>): void {
    const props = args[0] as EventProps[E] | undefined;
    // Local listeners first: they work without statistics consent and nothing leaves the device.
    notifyTracked(event);
    this.capture(event, props as Record<string, unknown> | undefined);
  }

  /** Central place where an error state reaches the user: `toErrorKey` reports here. */
  private bindErrorSink(): void {
    setErrorShownSink((scope, key) => this.track('app:error_show', { scope, key }));
  }

  /** Internal sender (pageviews + `track`); not part of the feature-facing API. */
  private capture(event: string, properties?: Record<string, unknown>): void {
    if (!this.consent.statisticsAllowed()) return;
    this.client?.capture(event, properties);
  }

  /**
   * Identifies the signed-in user — only ever with statistics consent. `distinctId`
   * is the salted hash from `AnalyticsIdentityService`, never the account id,
   * e-mail or name; `role` is the only person property.
   */
  identify(distinctId: string, role: string): void {
    if (!this.consent.statisticsAllowed()) return;
    this.identity = { distinctId, role };
    this.applyIdentity();
  }

  private applyIdentity(): void {
    if (!this.client || !this.identity) return;
    this.client.identify(this.identity.distinctId, { role: this.identity.role });
    this.identified = true;
  }

  /** Back to an anonymous visitor (sign-out, consent revoke). */
  resetIdentity(): void {
    this.identity = null;
    if (this.client && this.identified) this.client.reset();
    this.identified = false;
  }

  /**
   * A PostHog feature flag, or `undefined` without consent, without a loaded
   * client, or when the flag is unknown. Reactive (reads a signal).
   */
  featureFlag(key: string): boolean | string | undefined {
    return this.flags()[key];
  }

  /**
   * Sends an already-redacted `$exception` (see `AppErrorHandler`). Same gate as
   * `capture()`: nothing leaves the browser without statistics consent.
   * PostHog's own `capture_exceptions` autocapture stays off on purpose — it
   * would ship raw messages and URLs past the redaction.
   */
  captureException(error: Error, properties?: Record<string, unknown>): void {
    if (!this.consent.statisticsAllowed()) return;
    this.client?.captureException(error, properties);
    this.startReplayForError();
  }

  /**
   * Session replay only for sessions with an error: recording is off at init and
   * starts here, on the first $exception. Not while the quota saver is on —
   * errors themselves are always sent, only the replay is paused.
   */
  private startReplayForError(): void {
    if (!this.client || this.replayStarted || this.saver) return;
    this.replayStarted = true;
    this.client.startSessionRecording(true);
  }

  /** E4: the telemetry-saver flag pauses replay and heatmaps; errors and core events never. */
  private applySaver(on: boolean): void {
    this.saver = on;
    const client = this.client;
    if (!client) return;
    if (on) {
      if (this.replayStarted) client.stopSessionRecording();
      client.set_config({ enable_heatmaps: false, capture_heatmaps: false });
    } else {
      client.set_config({ enable_heatmaps: true, capture_heatmaps: true });
      if (this.replayStarted) client.startSessionRecording(true);
    }
  }

  /**
   * C7 — one-shot landing-page UTM capture. Called once from `AppComponent`
   * init (alongside `init()`). Reads `utm_source`/`utm_medium`/`utm_campaign`
   * from the CURRENT `location.search` at call time and, once `statistics`
   * consent is granted, registers them as PostHog super-properties so every
   * event from this session — not just the first pageview — carries them.
   *
   * Deliberately independent of `pageviewUrl()`: that function keeps
   * stripping the query string from `$current_url` on every pageview, so the
   * UTM params never persist in any STORED page URL — only as these
   * explicitly-registered event properties.
   *
   * No-op without a configured key, without any UTM params on the URL, or
   * (guarded by `landingCaptured`) after the first successful registration.
   */
  captureLanding(): void {
    if (!this.configured) return;
    const utm = readUtmParams(typeof location !== 'undefined' ? location.search : '');
    if (Object.keys(utm).length === 0) return;

    effect(
      () => {
        if (this.landingCaptured || !this.consent.statisticsAllowed()) return;
        this.landingCaptured = true;
        this.pendingLandingUtm = utm;
        if (this.client) this.applyPendingLandingUtm();
        else void this.enable();
      },
      { injector: this.injector },
    );
  }

  private applyPendingLandingUtm(): void {
    if (this.pendingLandingUtm && this.client) {
      this.client.register(this.pendingLandingUtm);
      this.pendingLandingUtm = null;
    }
  }

  /**
   * Upper bound for a flags answer that never comes (an ad blocker that only blocks the flags endpoint):
   * after it the defaults apply, as if PostHog were absent. A fallback for a missing answer only.
   */
  private armFlagsTimeout(): void {
    if (this.flagsSettled() || this.flagsTimer !== null) return;
    this.flagsTimer = setTimeout(() => this.settleFlags(), FLAGS_TIMEOUT_MS);
  }

  /**
   * A project without feature flags answers its remote config with
   * hasFeatureFlags: false; posthog-js then never loads flags and never fires
   * onFeatureFlags. Settle right away instead of waiting out the timeout
   * (which stays the fallback). A flag created later still works after a reload.
   */
  private watchRemoteConfig(posthog: PostHog): void {
    const settleIfNone = (result: unknown) => {
      if (remoteConfigHasNoFlags(result)) this.settleFlags();
    };
    // Not in the typed on() events, but the client emits it: the answer may come before or after this call.
    (posthog as unknown as { on(e: string, cb: (r: unknown) => void): void }).on('extensionsRemoteConfig', settleIfNone);
    const preloaded = (globalThis as { _POSTHOG_REMOTE_CONFIG?: Record<string, { config?: unknown }> })
      ._POSTHOG_REMOTE_CONFIG?.[environment.posthog.key];
    if (preloaded?.config) settleIfNone({ ok: true, config: preloaded.config });
  }

  private settleFlags(): void {
    if (this.flagsTimer !== null) clearTimeout(this.flagsTimer);
    this.flagsTimer = null;
    this.flagsSettled.set(true);
  }

  private async enable(): Promise<void> {
    this.armFlagsTimeout();
    if (this.client) {
      this.client.opt_in_capturing();
      this.applyPendingLandingUtm();
      this.applyIdentity();
      return;
    }
    // A second concurrent caller (e.g. `captureLanding()` racing `init()`'s own
    // consent effect) cannot re-enter the load below, but the in-flight call
    // still owns setting `this.client` and applies any pending UTM props once
    // it finishes — see the two `applyPendingLandingUtm()` calls below.
    if (this.loading) return;
    this.loading = true;
    try {
      const { default: posthog } = await import('posthog-js');
      posthog.init(environment.posthog.key, {
        api_host: environment.posthog.host,
        ui_host: environment.posthog.uiHost,
        persistence: 'localStorage',
        autocapture: false,
        capture_pageview: false, // routed manually — Angular navigations are not page loads
        capture_pageleave: false,
        // Replay starts only from captureException (see startReplayForError) — never for a clean session.
        disable_session_recording: true,
        session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' },
        disable_surveys: true,
        enable_heatmaps: true,
        capture_dead_clicks: true,
        capture_performance: { web_vitals: true },
        person_profiles: 'identified_only',
      });
      this.client = posthog;
      posthog.onFeatureFlags((_flags, variants) => {
        this.flagValues.set({ ...variants });
        this.settleFlags();
      });
      this.watchRemoteConfig(posthog);
      posthog.register({ app_version: readAppRelease().replace(/^v/, ''), release: readAppRelease() });
      this.applyIdentity();
      this.applySaver(this.saver);
      this.bindRouter();
      this.applyPendingLandingUtm();
    } catch (error) {
      // Blocked by an ad-blocker, offline, or chunk load failure. Analytics is
      // strictly optional — never let it break the app.
      logWarn('analytics', 'posthog load failed', error);
      this.client = null;
      this.settleFlags();
    } finally {
      this.loading = false;
    }
  }

  private disable(): void {
    this.flagValues.set({});
    if (this.flagsTimer !== null) clearTimeout(this.flagsTimer);
    this.flagsTimer = null;
    this.flagsSettled.set(false);
    if (!this.client) return;
    if (this.replayStarted) this.client.stopSessionRecording();
    this.client.opt_out_capturing();
    this.client.reset();
    this.identified = false;
    this.replayStarted = false;
  }

  /**
   * Pageviews for Angular route changes (the SPA has exactly one real page
   * load). `router.events` only fires on *future* navigations, so we also emit
   * one for the page already open when the library finished loading — otherwise
   * the landing page, the single most common pageview, is never captured.
   */
  private bindRouter(): void {
    if (this.routerBound) return;
    this.routerBound = true;
    this.capturePageview(this.router.url);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.capturePageview((e as NavigationEnd).urlAfterRedirects);
    });
  }

  private capturePageview(routerUrl: string): void {
    this.capture('$pageview', { $current_url: pageviewUrl(routerUrl) });
  }
}

/**
 * Turns an Angular router URL into the absolute `$current_url` a pageview needs.
 *
 * Absolute is not cosmetic: PostHog derives `$host` and `$pathname` by parsing
 * `$current_url`, and Web Analytics groups pageviews by host. A bare router path
 * (`/codex/ships`) parses to an empty host, so those pageviews are silently
 * dropped from Web Analytics ("No pageview events detected"). Prefixing the
 * origin restores the host; we still strip the query string and fragment, which
 * can carry tokens or search terms we have no reason to collect.
 */
export function pageviewUrl(routerUrl: string, origin: string = location.origin): string {
  return origin + maskBearerSegments(routerUrl.split(/[?#]/)[0]);
}

/**
 * Share links carry their whole authorisation in the path (`/shared/loadout/<token>`,
 * `/hangar/shared/<token>`); a pageview must not ship that bearer to PostHog.
 * The segment after these prefixes is replaced by a fixed placeholder so the
 * route still groups in Web Analytics without the secret.
 */
const BEARER_PATH_PREFIXES = ['/shared/loadout/', '/hangar/shared/'] as const;

export function maskBearerSegments(path: string): string {
  for (const prefix of BEARER_PATH_PREFIXES) {
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      if (!rest) return path;
      const slash = rest.indexOf('/');
      return prefix + ':token' + (slash >= 0 ? rest.slice(slash) : '');
    }
  }
  return path;
}

/**
 * Extracts only the three standard UTM params from a `location.search`-style
 * query string, as plain string properties for `posthog.register()`. Absent
 * params are simply omitted (never `null`/`undefined` entries) — used by
 * `AnalyticsService.captureLanding()` (C7).
 */
export function readUtmParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}
