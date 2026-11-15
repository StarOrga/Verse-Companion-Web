import { ChangeDetectionStrategy, Component, effect, inject, OnInit, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth/auth.service';
import { PresenceService } from './auth/presence.service';
import { FriendsService } from './social/friends.service';
import { emptyGraph } from './social/friends.types';
import { SocialPresenceService } from './social/social-presence.service';
import { AnalyticsService } from './core/analytics.service';
import { AnalyticsIdentityService } from './core/analytics/analytics-identity.service';
import { PageEventsService } from './core/analytics/page-events.service';
import { ConsentBannerComponent } from './core/consent-banner.component';
import { LocaleService } from './core/locale/locale.service';
import { dismissBootSplash } from './core/boot-splash';
import { claimRootAttr } from './core/root-var';
import { RouteLoadRecoveryService } from './core/route-load-recovery.service';
import { SupabaseClientProvider } from './core/supabase.client';
import { SwUpdateService } from './core/sw-update.service';
import { ImpersonationBannerComponent } from './shell/impersonation-banner.component';
import { UpdateToastComponent } from './core/update-toast.component';

@Component({
  selector: 'sc-root',
  standalone: true,
  imports: [RouterOutlet, ConsentBannerComponent, ImpersonationBannerComponent, UpdateToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Mounted here (not inside sc-shell) because a signed-out preview bounces
         private routes to /login, which renders OUTSIDE the shell — this
         banner is the only way back from there, so it must live above every
         route. Its own component publishes --sc-imp-banner-h; the padding
         below reads it so the routed content (and the shell's own sticky
         header, which reads the same var) never sits underneath it. -->
    <sc-impersonation-banner />

    <div class="routed-content">
      <router-outlet (activate)="routed()" />
    </div>

    <!-- First-visit browser-storage notice (#130) — self-hides once decided. -->
    <sc-consent-banner />

    <!-- "New version ready": a toast in the bottom-right stack, up until the reader reloads. -->
    <sc-update-toast />
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
      }

      /* Pushes the routed content below the fixed sc-impersonation-banner
         strip (0px and thus a no-op while no preview is active — see that
         component's constructor, which owns the --sc-imp-banner-h var). */
      .routed-content {
        padding-top: var(--sc-imp-banner-h, 0px);
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly presence = inject(PresenceService);
  private readonly socialPresence = inject(SocialPresenceService);
  private readonly friends = inject(FriendsService);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly analytics = inject(AnalyticsService);
  private readonly analyticsIdentity = inject(AnalyticsIdentityService);
  private readonly pageEvents = inject(PageEventsService);
  private readonly locale = inject(LocaleService);
  readonly swUpdate = inject(SwUpdateService);
  private readonly routeRecovery = inject(RouteLoadRecoveryService);

  /**
   * Guards the preference race: the profile's locale columns are applied only
   * ONCE PER ACCOUNT, on its first post-login load. Without this a language the
   * user changes in the same session would be clobbered the next time the auth
   * signal re-emits (e.g. token refresh). Holding the account id (not a flag)
   * lets a sign-out + sign-in as someone else in the same tab apply the new
   * account's profile (AUD-198).
   */
  private appliedProfileFor: string | null = null;

  /** The first routed page stands: the boot sky (styles.scss, html[data-sc-booting]) steps back. */
  routed(): void {
    claimRootAttr('data-sc-booting', this, null);
    dismissBootSplash();
  }

  constructor() {
    // Rendered, page not yet: the boot sky shows (an html:has() on the outlet restyled the whole
    // document on every DOM change for the app's lifetime — perf-report "Wave 2c root cause").
    claimRootAttr('data-sc-booting', this, '');
    // The open-request counter on the account menu needs the graph once per
    // sign-in, not per navigation. Failure-silent (load() keeps its own error
    // signal); a sign-out empties the graph so a counter never outlives it.
    let friendsFor: string | null = null;
    effect(() => {
      const id = this.auth.realUser()?.id ?? null;
      if (id === friendsFor) return;
      friendsFor = id;
      if (id) untracked(() => void this.friends.load());
      else untracked(() => this.friends.graph.set(emptyGraph()));
    });
    // After auth is ready and a user appears, load their stored locale
    // preferences and apply them — once per account, so a switch made in the
    // current session is never overridden (see appliedProfileFor).
    effect(() => {
      const user = this.auth.user();
      if (!user) {
        // Only clean up after a profile was applied — the boot (user() starts
        // null) stays untouched.
        if (this.appliedProfileFor !== null) {
          this.appliedProfileFor = null;
          this.locale.clearProfile();
        }
        return;
      }
      if (this.appliedProfileFor === user.id) return;
      this.appliedProfileFor = user.id;
      this.sb.client
        .from('profiles')
        .select('preferred_lang, preferred_region')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          // A late answer for account A must not land after a switch to B.
          if (this.appliedProfileFor !== user.id) return;
          // LocaleService ignores anything unusable — legacy languages
          // (fr/es/…) that have no real translation (issue #23), NULL columns,
          // and a `preferred_region` that is absent because the migration has
          // not been applied yet.
          this.locale.hydrateFromProfile(
            data?.['preferred_lang'] as string | null | undefined,
            data?.['preferred_region'] as string | null | undefined,
          );
        });
    });

    // The resolved language is the single source of truth for ngx-translate:
    // whatever LocaleService decides (profile → explicit choice → browser →
    // English) is what gets activated, including later switches.
    effect(() => {
      const lang = this.locale.language();
      if (lang !== this.translate.getCurrentLang()) this.translate.use(lang);
    });
  }

  ngOnInit(): void {
    this.pageEvents.start();
    // Activate synchronously on boot so the first paint is already translated;
    // the effect above only handles subsequent changes.
    const initial = this.locale.language();
    this.translate.use(initial);

    // Sync <html lang> with the active translation so SEO + screenreaders
    // see the right language. ngx-translate does not touch this attribute.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = initial;
      this.translate.onLangChange.subscribe((e) => {
        document.documentElement.lang = e.lang;
      });
    }

    this.auth.init();
    // Keeps the admin "last seen" honest for members who stay signed in.
    this.presence.init();
    // Online status and the 30-day activity mask (user_presence); without
    // this nobody is ever online.
    this.socialPresence.init();
    this.swUpdate.init();
    // Turns a route whose lazy chunk will not load back into a working
    // navigation instead of a menu entry that silently does nothing (admin
    // feedback cdb16d63). Wired here, not in the shell, so it also covers the
    // public layout and the very first navigation of a page load.
    this.routeRecovery.init();
    // No-op without a configured key or statistics consent (#139).
    this.analytics.init();
    // Identifies a signed-in user (salted hash + role) once statistics consent holds.
    this.analyticsIdentity.init();
    // C7 — one-shot: reads UTM params off THIS load's URL; no-op without
    // params or (yet) consent. Must run after init() so it shares the same
    // lazy-loaded PostHog client once consent is granted.
    this.analytics.captureLanding();
  }
}
