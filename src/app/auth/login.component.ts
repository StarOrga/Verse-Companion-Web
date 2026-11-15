import { toErrorKey } from '../core/describe-error';
import { authErrorKey } from './auth-error-key';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { AccessRequestService } from './access-request.service';
import { ImpersonationService } from './impersonation.service';
import { AnalyticsService } from '../core/analytics.service';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { safeRedirectTarget } from '../core/safe-redirect.util';
import { AccountStatusService } from '../social/account-status.service';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { BrandLogoComponent, BrandNameComponent } from '../shell/brand/brand.component';
import { LoginSceneComponent } from './login-scene.component';

/** Which panel the landing card currently shows. */
type Panel = 'signIn' | 'apply' | 'reset';

@Component({
  selector: 'sc-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, RouterLink, ScDatePipe, ScActionDirective, LoginSceneComponent, BrandLogoComponent, BrandNameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.switched]': 'switched()' },
  template: `
    <!--
      The signed-out landing page, direction "Bruecke" (concept 20261115-2122, screen d3-zwei):
      the visitor arrives on a ship's bridge above microTech (<sc-login-scene>, the full-bleed
      canopy), the sign-in console is docked on the right over the full height. Header and footer
      follow the signed-in shell (brand plate top left, badge + legal links at the bottom). The
      arrival is staged in CSS (motion spec: the concept's parity.md, "B3.2 motion spec"); the
      resting styles are the final frame, so reduced motion shows it at once.
    -->
    <div class="lg">
      <sc-login-scene class="lg-scene" />

      <header class="lg-head">
        <span class="lg-brand">
          <sc-brand-logo />
          <sc-brand-name channel="stack" />
        </span>
        <nav class="lg-nav" [attr.aria-label]="'auth.landing.headerNav' | translate">
          <a routerLink="/about">{{ 'footer.links.about' | translate }}</a>
          <a routerLink="/login" aria-current="page">{{ 'auth.signIn' | translate }}</a>
        </nav>
      </header>

      <main class="lg-main">
        <section class="lg-hero">
          <div class="brand st" style="--i: 0">
            <img src="icons/brand/vc-mark.svg" alt="" width="64" height="64" class="brand-logo" />
            <h1>{{ 'auth.landing.appName' | translate }}</h1>
          </div>
          <p class="tag st" style="--i: 1">{{ 'auth.tagline' | translate }}</p>

          <p class="join st" style="--i: 2">{{ 'auth.landing.join' | translate }}</p>
          <p class="pitch st" style="--i: 3">{{ 'auth.landing.pitch' | translate }}</p>

          <ul class="perks st" style="--i: 4">
            <li>{{ 'auth.landing.perks.hangar' | translate }}</li>
            <li>{{ 'auth.landing.perks.codex' | translate }}</li>
            <li>{{ 'auth.landing.perks.verse' | translate }}</li>
          </ul>

          <div class="hero-cta-slot st" style="--i: 5">
            @if (panel() === 'signIn') {
              <button type="button" scAction tier="secondary" class="hero-cta" (click)="showApply()">
                {{ 'auth.landing.applyCta' | translate }}
              </button>
            } @else {
              <button type="button" scAction tier="secondary" class="hero-cta" (click)="showSignIn()">
                {{ 'auth.landing.backToSignIn' | translate }}
              </button>
            }
          </div>
        </section>

        <section class="lg-panel login-card" [attr.aria-label]="'auth.landing.consoleAria' | translate">
          <div class="lg-panel-body">
            @if (panel() === 'signIn') {
              <h2 class="st" style="--i: 0">{{ 'auth.signIn' | translate }}</h2>

              @if (denied()) {
                <div class="notice denied" role="alert">{{ 'auth.deniedInvite' | translate }}</div>
              }

              <!--
                A suspended account (feedback cf0ddf7d phase 2) may still
                authenticate — deliberately, see suspend_user() — so that it
                gets told WHY instead of a generic auth failure. The guard
                drops the session again immediately and lands here. The reason
                is the admin's free text: interpolated, never bound as HTML.
              -->
              @if (suspended()) {
                <div class="notice suspended" role="alert">
                  <p class="suspended__title">{{ 'auth.suspended.title' | translate }}</p>
                  @if (suspensionReason(); as why) {
                    <p class="suspended__reason">{{ why }}</p>
                  }
                  <p class="suspended__body">
                    @if (suspendedUntil(); as until) {
                      {{ 'auth.suspended.until' | translate: { date: (until | scDate: 'datetime') } }}
                    } @else {
                      {{ 'auth.suspended.indefinite' | translate }}
                    }
                  </p>
                </div>
              }

              <!-- A signed-out preview (viewAs 'anon') has no box here any more: the
                   impersonation banner on top is the way out. A sign-in attempt in the
                   preview is still refused (onSubmit / OAuth) and explained in .err. -->
              <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
                <label class="st" style="--i: 1">
                  {{ 'auth.email' | translate }}
                  <input type="email" class="sc-input" formControlName="email" autocomplete="email" />
                </label>

                <label class="st" style="--i: 2">
                  {{ 'auth.password' | translate }}
                  <input type="password" class="sc-input" formControlName="password" autocomplete="current-password" />
                </label>

                @if (errorMsg()) {
                  <div class="err" role="alert">{{ errorMsg()! | translate }}</div>
                }

                <div class="actions st" style="--i: 3">
                  <button type="submit" scAction tier="primary" class="lg-submit" [disabled]="busy() || form.invalid">
                    {{ 'auth.signIn' | translate }}
                  </button>
                  <!-- An action (it sends a mail), not a navigation — stays a
                       <button>. Invited accounts start WITHOUT a password, so
                       this is the way back in, not just a "forgot" case. -->
                  <button type="button" class="linkish forgot" (click)="showReset()">
                    {{ 'auth.forgotPassword' | translate }}
                  </button>
                </div>
              </form>

              <div class="sep st" style="--i: 4"><span>{{ 'auth.or' | translate }}</span></div>

              <!-- Foreign brands: each provider's mark unaltered in its own colours,
                   label / border / hover on app tokens (CLAUDE.md, foreign brands). -->
              <div class="oauth-row st" style="--i: 5">
                <button type="button" scAction tier="secondary" class="oauth" (click)="signInWithGoogle()" [disabled]="busy()">
                  <svg class="brand-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  <span>{{ 'auth.continueGoogle' | translate }}</span>
                </button>
                <button type="button" scAction tier="secondary" class="oauth" (click)="signInWithDiscord()" [disabled]="busy()">
                  <svg class="brand-mark" viewBox="0 0 127.14 96.36" width="20" height="16" aria-hidden="true" focusable="false">
                    <path fill="#5865F2" d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
                  </svg>
                  <span>{{ 'auth.continueDiscord' | translate }}</span>
                </button>
              </div>

              <p class="invite-only st" style="--i: 6">
                {{ 'auth.inviteOnly' | translate }}
                <button type="button" class="linkish" (click)="showApply()">
                  {{ 'auth.landing.applyInline' | translate }}
                </button>
              </p>
            } @else if (panel() === 'reset') {
              <h2>{{ 'auth.reset.title' | translate }}</h2>

              @if (resetDone()) {
                <div class="notice sent" role="status">{{ 'auth.reset.sent' | translate }}</div>
                <button type="button" scAction tier="secondary" class="back-btn" (click)="showSignIn()">
                  {{ 'auth.landing.backToSignIn' | translate }}
                </button>
              } @else {
                <p class="apply-hint">{{ 'auth.reset.hint' | translate }}</p>

                <form [formGroup]="resetForm" (ngSubmit)="onReset()" novalidate>
                  <label>
                    {{ 'auth.email' | translate }}
                    <input type="email" class="sc-input" formControlName="email" autocomplete="email" />
                  </label>

                  @if (resetError()) {
                    <div class="err" role="alert">{{ resetError()! | translate }}</div>
                  }

                  <div class="actions">
                    <button type="submit" scAction tier="primary"
                            [disabled]="resetBusy() || resetForm.invalid">
                      {{ (resetBusy() ? 'auth.reset.sending' : 'auth.reset.send') | translate }}
                    </button>
                    <button type="button" class="linkish" (click)="showSignIn()">
                      {{ 'auth.landing.backToSignIn' | translate }}
                    </button>
                  </div>
                </form>
              }
            } @else {
              <h2>{{ 'auth.apply.title' | translate }}</h2>

              @if (applyDone()) {
                <div class="notice sent" role="status">{{ 'auth.apply.sent' | translate }}</div>
                <button type="button" scAction tier="secondary" class="back-btn" (click)="showSignIn()">
                  {{ 'auth.landing.backToSignIn' | translate }}
                </button>
              } @else {
                <p class="apply-hint">{{ 'auth.apply.hint' | translate }}</p>

                <form [formGroup]="applyForm" (ngSubmit)="onApply()" novalidate>
                  <label>
                    {{ 'auth.email' | translate }}
                    <input type="email" class="sc-input" formControlName="email" autocomplete="email" />
                  </label>

                  <label>
                    {{ 'auth.apply.handle' | translate }}
                    <input type="text" class="sc-input" formControlName="handle" autocomplete="nickname"
                           [placeholder]="'auth.apply.handlePlaceholder' | translate" />
                  </label>

                  <label>
                    {{ 'auth.apply.message' | translate }}
                    <textarea class="sc-input" formControlName="message" rows="3"
                              [placeholder]="'auth.apply.messagePlaceholder' | translate"></textarea>
                  </label>

                  @if (applyError()) {
                    <div class="err" role="alert">{{ applyError()! | translate }}</div>
                  }

                  <div class="actions">
                    <button type="submit" scAction tier="primary"
                            [disabled]="applyBusy() || applyForm.invalid">
                      {{ applyBusy() ? ('auth.apply.sending' | translate) : ('auth.apply.send' | translate) }}
                    </button>
                  </div>
                </form>
              }
            }

            <!-- Trust links: a bare credential form with no self-description is a
                 phishing-heuristic trigger for AV URL scanners — keep these visible
                 on the login card itself, not only in the footer. -->
            <nav class="trust-links st" style="--i: 7" [attr.aria-label]="'footer.legalNav' | translate">
              <a routerLink="/about">{{ 'footer.links.about' | translate }}</a>
              <span aria-hidden="true">·</span>
              <a routerLink="/legal/privacy">{{ 'footer.links.privacy' | translate }}</a>
              <span aria-hidden="true">·</span>
              <a routerLink="/legal/imprint">{{ 'footer.links.imprint' | translate }}</a>
            </nav>
          </div>
        </section>
      </main>

      <!-- The login page's own footer (B3.4): fan badge, the full disclaimer with the
           RSI link and the trademarks — open and obvious on the public entry page (CIG
           Fankit, Fandom FAQ), not behind a bubble — and the legal links, laid out like
           the signed-in shell's footer (badge left, links right). -->
      <footer class="lg-foot">
        <p class="fan-notice">
          <img class="fan-badge" src="icons/made-by-community.png" [alt]="'footer.badgeAlt' | translate" width="44" height="44" />
          <span>
            {{ 'footer.disclaimer' | translate }}
            <a href="https://robertsspaceindustries.com" target="_blank" rel="noopener noreferrer">{{ 'footer.rsiLink' | translate }}</a>
            <br />{{ 'footer.trademarks' | translate }}
          </span>
        </p>
        <nav class="lg-foot-links" [attr.aria-label]="'footer.legalNav' | translate">
          <a routerLink="/about">{{ 'footer.links.about' | translate }}</a>
          <span aria-hidden="true">·</span>
          <a routerLink="/legal/privacy">{{ 'footer.links.privacy' | translate }}</a>
          <span aria-hidden="true">·</span>
          <a routerLink="/legal/imprint">{{ 'footer.links.imprint' | translate }}</a>
        </nav>
      </footer>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      --lg-console: clamp(380px, 34vw, 520px);
      --lg-expo: cubic-bezier(0.16, 1, 0.3, 1);
    }
    /* One screen by design: the canopy (scene) is full-bleed behind everything, the
       console docks right between header and footer. min-height (not height), so short
       viewports scroll instead of clipping the form. */
    .lg {
      position: relative;
      isolation: isolate;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: calc(100vh - var(--sc-imp-banner-h, 0px));
      min-height: calc(100dvh - var(--sc-imp-banner-h, 0px));
      --ls-console: var(--lg-console);
    }
    .lg-scene { z-index: -1; }

    /* ---- Header: the signed-in shell's brand plate, on the canopy ---- */
    .lg-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sc-space-4, 16px);
      padding: var(--sc-space-4, 16px) var(--sc-page-gutter, 24px);
      background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-0) 60%, transparent), transparent);
    }
    .lg-brand { display: inline-flex; align-items: center; gap: 12px; min-width: 0; }
    .lg-nav { display: flex; gap: var(--sc-space-1, 4px); }
    .lg-nav a {
      display: inline-flex;
      align-items: center;
      min-height: var(--sc-tap-min, 44px);
      padding: 0 12px;
      border-radius: 8px;
      font: 500 max(0.72rem, var(--sc-fs-floor, 11px)) / 1 var(--sc-font-display);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      text-decoration: none;
      transition: color 0.16s ease;
    }
    .lg-nav a:hover, .lg-nav a[aria-current='page'] { color: var(--sc-fg-0); }
    .lg-nav a[aria-current='page'] { box-shadow: inset 0 -2px 0 var(--sc-accent); border-radius: 0; }
    .lg-nav a:focus-visible, .lg-foot a:focus-visible, .trust-links a:focus-visible {
      outline: 1px solid transparent;
      box-shadow: var(--sc-focus-ring);
      border-radius: 3px;
    }

    /* ---- Main: hero on the canopy (left), console docked right ---- */
    .lg-main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) var(--lg-console);
      min-height: 0;
    }
    .lg-hero {
      align-self: end;
      min-width: 0;
      max-width: 480px;
      padding: 0 var(--sc-page-gutter, 24px) clamp(28px, 7vh, 72px) clamp(24px, 6vw, 96px);
      text-shadow: 0 1px 12px rgba(2, 8, 14, 0.8);
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-logo { flex: none; filter: drop-shadow(0 0 14px color-mix(in srgb, var(--sc-accent) 55%, transparent)); }
    h1 {
      margin: 0;
      font-family: var(--sc-font-display);
      font-size: clamp(1.7rem, 3.4vw, 2.6rem);
      line-height: 1.1;
      /* Brand art, not a state: the hot accent in the hero gradient is deliberate (audit D10). */
      background: linear-gradient(90deg, var(--sc-accent), var(--sc-accent-hot));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-shadow: none;
    }
    .tag { margin: 10px 0 0; color: var(--sc-fg-1); font-size: 0.95rem; }
    .join {
      margin: clamp(14px, 3vh, 26px) 0 0;
      font-size: clamp(1.1rem, 2vw, 1.45rem);
      font-weight: 600;
      color: var(--sc-fg-0);
      letter-spacing: 0.01em;
    }
    .pitch { margin: 8px 0 0; color: var(--sc-fg-1); font-size: 0.92rem; line-height: 1.55; max-width: 46ch; }
    .perks {
      margin: 16px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
      color: var(--sc-fg-1);
      font-size: 0.88rem;
    }
    .perks li { display: flex; gap: 8px; align-items: baseline; }
    .perks li::before { content: '▸'; color: var(--sc-accent); flex: none; }
    .hero-cta-slot { margin-top: clamp(16px, 3vh, 26px); }

    .lg-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      padding: clamp(20px, 4vh, 40px) clamp(24px, 3vw, 44px);
      border-left: 1px solid var(--sc-border);
      background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-1, #0a1d2b) 88%, transparent), color-mix(in srgb, var(--sc-bg-0) 94%, transparent));
      backdrop-filter: blur(10px);
      box-shadow: -24px 0 60px rgba(0, 0, 0, 0.35);
    }
    /* The console's left edge: a hairline of accent light (its scan runs once in the intro). */
    .lg-panel::before {
      content: '';
      position: absolute;
      left: -1px;
      top: 0;
      bottom: 0;
      width: 1px;
      background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--sc-accent) 70%, transparent) 50%, transparent);
      opacity: 0.55;
    }
    .lg-panel-body { width: 100%; max-width: 400px; margin-inline: auto; }
    .lg-panel h2 {
      margin: 0 0 18px;
      font: 600 1.05rem / 1.2 var(--sc-font-display);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--sc-fg-0);
    }
    .apply-hint {
      margin: 0 0 16px;
      color: var(--sc-fg-2);
      font-size: max(0.82rem, var(--sc-fs-floor));
      line-height: 1.45;
    }
    .notice { margin-bottom: 18px; padding: 10px 14px; border-radius: 4px; font-size: 0.85rem; line-height: 1.45; }
    .notice.denied { background: rgba(251, 191, 36, 0.1); border: 1px solid var(--sc-warning); color: var(--sc-warning); }
    /* --sc-danger, not --sc-accent-hot: this is an error state shown to the
       affected user, not an elevated-access surface. */
    .notice.suspended { background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-fg-0); }
    .suspended__title { margin: 0 0 6px; font-weight: 600; color: var(--sc-danger); }
    .suspended__reason { margin: 0 0 6px; overflow-wrap: anywhere; }
    .suspended__body { margin: 0; color: var(--sc-fg-2); }
    .notice.sent { background: rgba(74, 222, 128, 0.1); border: 1px solid var(--sc-success); color: var(--sc-success); }
    .back-btn { width: 100%; justify-content: center; }
    .invite-only {
      margin: 18px 0 0;
      text-align: center;
      color: var(--sc-fg-2);
      font-size: max(0.78rem, var(--sc-fs-floor));
      line-height: 1.45;
    }
    /* An in-place panel switch is an action, not a navigation — button, styled
       as a link (CLAUDE.md: anchors are for things that take you somewhere). */
    .linkish {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      color: var(--sc-accent);
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    /* Brighten the normal accent rather than shifting to the hot one — the
       login page is the most public surface there is, and the hot accent is
       reserved for admin-only affordances (admin feedback b8b31f24). */
    .linkish:hover { color: color-mix(in srgb, var(--sc-accent) 78%, #fff); }
    .trust-links {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 22px;
      font-size: max(0.72rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .trust-links a { color: var(--sc-fg-2); text-decoration: none; transition: color 0.16s ease; }
    .trust-links a:hover { color: var(--sc-accent); }
    label {
      display: block;
      margin-bottom: 14px;
      color: var(--sc-fg-1);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    label .sc-input { margin-top: 6px; }
    textarea.sc-input { resize: vertical; min-height: 68px; }
    .actions { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
    .actions .sc-action { flex: 1; justify-content: center; }
    /* The link-styled buttons in an action row centre against the primary
       button instead of stretching like one. */
    .actions .linkish {
      flex: 0 0 auto;
      align-self: center;
      font-size: max(0.8rem, var(--sc-fs-floor));
      min-height: 44px;
    }
    .actions .linkish.forgot { margin-inline-start: auto; }
    .err {
      margin-top: 12px;
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
      font-size: 0.85rem;
    }
    .sep {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 22px 0;
      color: var(--sc-fg-2);
      font-size: max(0.75rem, var(--sc-fs-floor));
      letter-spacing: 0.1em;
    }
    .sep::before, .sep::after { content: ''; flex: 1; height: 1px; background: var(--sc-border); }
    .oauth-row { display: grid; gap: 10px; }
    .oauth { width: 100%; justify-content: center; gap: 10px; }
    .brand-mark { flex: none; display: block; }

    /* ---- Footer: like the signed-in shell's (badge left, links right) + the full notice ---- */
    .lg-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sc-space-4, 16px) clamp(16px, 4vw, 48px);
      padding: var(--sc-space-3, 12px) var(--sc-page-gutter, 24px) calc(var(--sc-space-3, 12px) + var(--sc-safe-bottom, 0px));
      border-top: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
      background: color-mix(in srgb, var(--sc-bg-0) 82%, transparent);
      backdrop-filter: blur(8px);
    }
    .fan-notice {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin: 0;
      max-width: 110ch;
      font-size: max(0.72rem, var(--sc-fs-floor));
      line-height: 1.45;
      color: var(--sc-fg-2);
    }
    /* Fan Kit "Made By The Community" logo: unaltered, no effects (Fan Kit guidelines p.9). */
    .fan-badge { flex: none; }
    .fan-notice a { color: var(--sc-fg-1); text-decoration: underline; text-underline-offset: 2px; }
    .fan-notice a:hover { color: var(--sc-accent); }
    .lg-foot-links { display: flex; flex: none; gap: 8px; font-size: max(0.75rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .lg-foot-links a { color: var(--sc-fg-2); text-decoration: none; transition: color 0.16s ease; }
    .lg-foot-links a:hover { color: var(--sc-accent); }

    /* ---- Arrival (motion spec B3.2). Resting styles are the final frame. ---- */
    @media (prefers-reduced-motion: no-preference) {
      .lg-head { animation: lg-drop 0.5s ease-out 0.2s both; }
      .lg-foot { animation: lg-lift 0.5s ease-out 1.3s both; }
      .lg-panel { animation: lg-dock 0.65s cubic-bezier(0.2, 0.8, 0.2, 1) 0.95s both; }
      .lg-panel::before { animation: lg-scan 0.7s ease-out 1.1s both; }
      .lg-hero .st { animation: lg-rise 0.52s var(--lg-expo) calc(1150ms + var(--i, 0) * 80ms) both; }
      :host(:not(.switched)) .lg-panel .st { animation: lg-up 0.38s ease-out calc(1100ms + var(--i, 0) * 55ms) both; }
      :host(:not(.switched)) .lg-submit { animation: lg-settle 0.6s ease-out 1.75s; }
      /* A later panel switch (apply / reset / back) is a quick crossfade, never the intro again. */
      :host(.switched) .lg-panel-body > * { animation: lg-up 0.22s ease-out both; }
    }
    @keyframes lg-drop { from { opacity: 0; transform: translateY(-8px); } }
    @keyframes lg-lift { from { opacity: 0; transform: translateY(8px); } }
    @keyframes lg-dock { from { opacity: 0; transform: translateX(32px); filter: blur(6px); } }
    @keyframes lg-scan {
      from { opacity: 1; clip-path: inset(0 0 100% 0); }
      60% { opacity: 1; }
      to { clip-path: inset(0 0 0 0); }
    }
    @keyframes lg-rise { from { opacity: 0; transform: translateY(12px); } }
    @keyframes lg-up { from { opacity: 0; transform: translateY(8px); } }
    @keyframes lg-settle {
      0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-accent) 0%, transparent); }
      45% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--sc-accent) 35%, transparent), 0 0 24px color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-accent) 0%, transparent); }
    }

    /* Short desktop viewports: the perks give way first. */
    @media (max-height: 700px) { .perks { display: none; } }

    /* Stacked (tablet portrait, phones): the canopy becomes a band on top with the word
       mark; the console follows full width, then the footer. The prose gives way so the
       sign-in form still lands above the fold. */
    @media (max-width: 860px) {
      .lg { --ls-console: 0px; grid-template-rows: auto auto minmax(0, 1fr) auto; }
      .lg-scene { bottom: auto; height: calc(clamp(170px, 30dvh, 260px) + 72px); }
      .lg-main { grid-row: 2 / 4; grid-template-columns: minmax(0, 1fr); grid-template-rows: clamp(98px, calc(30dvh - 72px), 188px) auto; }
      .lg-hero { align-self: end; max-width: none; padding: 0 var(--sc-page-gutter, 16px) 14px; }
      .brand-logo { width: 44px; height: 44px; }
      h1 { font-size: clamp(1.4rem, 6.4vw, 1.9rem); }
      .tag { margin-top: 4px; font-size: 0.85rem; }
      .join, .pitch, .perks, .hero-cta-slot { display: none; }
      .lg-panel { border-left: 0; border-top: 1px solid var(--sc-border); box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.35); justify-content: flex-start; }
      .lg-panel::before { display: none; }
      .lg-foot { flex-direction: column; align-items: stretch; }
      .lg-foot-links { justify-content: center; }
      .lg-nav a:first-child { display: none; }
    }
    @media (max-width: 860px) and (prefers-reduced-motion: no-preference) {
      .lg-panel { animation-name: lg-panel-up; }
    }
    @keyframes lg-panel-up { from { opacity: 0; transform: translateY(24px); filter: blur(6px); } }
  `],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly analytics = inject(AnalyticsService);
  private readonly accessRequests = inject(AccessRequestService);
  private readonly imp = inject(ImpersonationService);
  private readonly account = inject(AccountStatusService);

  /**
   * True while previewing as the signed-out visitor (defect B). Only `'anon'`
   * matters here — it is the sole preview value that shadows
   * `auth.isAuthenticated()` (see auth.service.ts's `session`/`user`
   * projections); a `'viewer'`/`'collaborator'` preview never blocks a real
   * sign-in. Deliberately NOT auto-exited on load — a visitor preview
   * rendering `/login` exactly as a real visitor sees it is the entire point
   * of the feature. Only the sign-in attempt itself is refused; the way out is
   * the impersonation banner on top (no second exit inside the form, batch #6).
   */
  readonly previewLocked = computed(() => this.imp.viewAs() === 'anon');

  readonly busy = signal(false);
  /** i18n key, never raw text. */
  readonly errorMsg = signal<string | null>(null);
  /** Set when the approvedGuard bounced an un-invited account back here. */
  readonly denied = signal(this.route.snapshot.queryParamMap.get('denied') === 'invite');

  /**
   * Set when the approvedGuard dropped a SUSPENDED session back here
   * (`?denied=suspended`, feedback cf0ddf7d phase 2). The query param is only
   * the trigger — the reason itself is never put in the URL; it is read from
   * the in-memory notice the guard left behind, which is why it disappears on
   * a reload and the generic wording below carries the rest.
   */
  private readonly deniedSuspended =
    this.route.snapshot.queryParamMap.get('denied') === 'suspended';
  readonly suspended = computed(
    () =>
      this.deniedSuspended ||
      // Not only the query param: the eject can come from the shell's
      // AccountNoticeComponent (a suspension that lands mid-session), whose
      // imperative navigation can lose a race with the guard's own UrlTree
      // and drop the param. The in-memory notice is the more reliable
      // signal, and it is set on every eject path.
      this.account.suspensionNotice() !== null,
  );
  readonly suspensionReason = computed(() => this.account.suspensionNotice()?.reason ?? null);
  readonly suspendedUntil = computed(() => this.account.suspensionNotice()?.until ?? null);

  /**
   * Which half of the card is showing. A bounced-back visitor (`?denied=invite`)
   * has just been told the site is invite-only — but the sign-in panel still
   * leads, so they can retry with the right account before applying.
   */
  readonly panel = signal<Panel>('signIn');
  /** The reader switched the panel once: from then on a switch is a quick crossfade, never the intro stagger again. */
  readonly switched = signal(false);

  readonly applyBusy = signal(false);
  readonly applyDone = signal(false);
  /** i18n key, never raw text. */
  readonly applyError = signal<string | null>(null);

  readonly resetBusy = signal(false);
  readonly resetDone = signal(false);
  /** i18n key, never raw text. */
  readonly resetError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    // Sign-in only needs *a* password: the length rule belongs to setting one.
    // A minLength here locked out every account whose password Supabase had
    // accepted with fewer characters (its own minimum is 6) — and the signed-in
    // mobile gate with it, whose submit stayed disabled.
    password: ['', [Validators.required]],
  });

  readonly applyForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    handle: [''],
    message: [''],
  });

  readonly resetForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  showApply(): void {
    this.switched.set(true);
    this.panel.set('apply');
    this.applyError.set(null);
    // Carry over whatever they already typed in the sign-in form.
    const typed = this.form.getRawValue().email;
    if (typed && !this.applyForm.getRawValue().email) {
      this.applyForm.patchValue({ email: typed });
    }
  }

  showSignIn(): void {
    this.switched.set(true);
    this.panel.set('signIn');
  }

  showReset(): void {
    this.switched.set(true);
    this.panel.set('reset');
    this.resetError.set(null);
    const typed = this.form.getRawValue().email;
    if (typed && !this.resetForm.getRawValue().email) {
      this.resetForm.patchValue({ email: typed });
    }
  }

  /**
   * Mail a password link. The confirmation is the SAME whether or not the
   * address has an account — Supabase answers identically on purpose, and
   * echoing "no such user" here would turn the login card into a membership
   * oracle (same rule as the apply form's duplicate handling).
   */
  async onReset() {
    if (this.resetForm.invalid) return;
    this.resetBusy.set(true);
    this.resetError.set(null);
    try {
      const { error } = await this.auth.sendPasswordReset(this.resetForm.getRawValue().email);
      if (error && error.status === 429) {
        this.resetError.set(authErrorKey(error, 'reset'));
        return;
      }
      this.resetDone.set(true);
    } catch (err) {
      this.resetError.set(authErrorKey(err, 'reset'));
    } finally {
      this.resetBusy.set(false);
    }
  }

  /**
   * Read the `?redirect=…` query param the auth guard set when bouncing
   * an unauthenticated user. Delegates the open-redirect check to the
   * shared `safeRedirectTarget()` util — `publicOnlyGuard` reuses the exact
   * same check for the "exit an impersonation preview" flow (Defect B).
   */
  private safeRedirectTarget(): string {
    return safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirect'));
  }

  async onSubmit() {
    if (this.form.invalid) return;
    if (this.previewLocked()) {
      // Defect B: signInWithPassword would succeed against the real client,
      // but navigateByUrl would still be bounced by authGuard back to /login
      // (viewAs() === 'anon' shadows isAuthenticated()) — a silent loop with
      // no feedback. Refuse before attempting it at all.
      this.errorMsg.set('auth.previewLocked.body');
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    this.analytics.track('auth:provider_select', { provider: 'email' });
    const { email, password } = this.form.getRawValue();
    try {
      const { error } = await this.auth.signInWithPassword(email, password);
      if (error) {
        this.errorMsg.set(authErrorKey(error, 'sign-in'));
      } else {
        this.analytics.track('auth:user_sign_in', { provider: 'email' });
        // navigateByUrl handles path + query string in one call
        // (router.navigate(['/path?q=1']) treats the whole thing as a single segment).
        await this.router.navigateByUrl(this.safeRedirectTarget());
      }
    } catch (err) {
      this.errorMsg.set(authErrorKey(err, 'sign-in'));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * File an invite application. A duplicate is reported as success on
   * purpose — see `AccessRequestService`: confirming that an application for
   * a given address already exists would make the form an oracle.
   */
  async onApply() {
    if (this.applyForm.invalid) return;
    this.applyBusy.set(true);
    this.applyError.set(null);
    const { email, handle, message } = this.applyForm.getRawValue();
    const result = await this.accessRequests.submit({ email, handle, message });
    this.applyBusy.set(false);

    if (result.kind === 'ok' || result.kind === 'duplicate') {
      this.applyDone.set(true);
      this.analytics.track('auth:access_request', { duplicate: result.kind === 'duplicate' });
      return;
    }
    this.applyError.set(
      result.kind === 'rate-limited' ? 'auth.apply.rateLimited' : toErrorKey('auth', 'apply', result.error),
    );
  }

  signInWithGoogle() {
    return this.signInWithOAuthProvider('google');
  }

  signInWithDiscord() {
    return this.signInWithOAuthProvider('discord');
  }

  private async signInWithOAuthProvider(provider: 'google' | 'discord') {
    this.analytics.track('auth:provider_select', { provider });
    if (this.previewLocked()) {
      // Same reasoning as onSubmit(): sc.viewAs is sessionStorage, so it
      // survives the OAuth round trip and would loop back to /login too.
      this.errorMsg.set('auth.previewLocked.body');
      return;
    }
    this.busy.set(true);
    this.errorMsg.set(null);
    let target = this.safeRedirectTarget();
    // Supabase's URL allowlist matches the full redirect URL — entries
    // configured without explicit wildcards reject query strings on the
    // OAuth callback ("Invalid redirect URL"). Stash any query string,
    // pass the bare path to the provider, and let the destination route
    // (currently only /uploader/auth) restore cb/state from sessionStorage.
    const qIdx = target.indexOf('?');
    if (qIdx !== -1) {
      try {
        sessionStorage.setItem('sc.oauth-redirect-qs', JSON.stringify({
          path: target.slice(0, qIdx),
          qs: target.slice(qIdx + 1),
        }));
      } catch { /* private mode / disabled storage — fall back to URL */ }
      target = target.slice(0, qIdx);
    }
    const { error } = provider === 'discord'
      ? await this.auth.signInWithDiscord(target)
      : await this.auth.signInWithGoogle(target);
    if (error) {
      this.errorMsg.set(authErrorKey(error, `${provider} sign-in`));
      this.busy.set(false);
    } else {
      this.analytics.track('auth:user_sign_in', { provider });
    }
  }
}
