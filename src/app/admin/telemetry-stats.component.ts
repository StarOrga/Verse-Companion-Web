import { ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { toErrorKey } from '../core/describe-error';
import { useAutoRefresh } from '../core/auto-refresh';
import { logWarn } from '../core/log';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { SupabaseClientProvider } from '../core/supabase.client';
import { FeedbackFabPrefsService } from '../core/feedback-fab-prefs.service';
import { FeedbackComposerSeedService } from '../feedback/feedback-composer-seed.service';
import { draftScopes } from '../feedback/feedback-draft.types';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { PageCrumb } from '../shared/page-header/nav-origin.service';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import {
  KNOWN_SERVICES,
  deltaIsWorse,
  deltaText,
  mergeRefresh,
  posthogRoot,
  sparkPoints,
  type FeedbackText,
  type Overview,
  type OverviewCard,
  type OverviewItem,
} from './telemetry-overview';

/** Status strip variants: something to do, a blind spot (PostHog unreachable), or really quiet. */
type StatusKind = 'attention' | 'blind' | 'calm';

/**
 * Admin › Telemetrie — the Themen-Karten page (concept 20261115-0211-posthog-audit, round 2, design `karten`).
 *
 * One read (`telemetry-overview`) feeds six topic cards in the server's urgency order. Each card is a teaser:
 * level icon + text, one KPI, delta or forecast, the top three findings and a way into PostHog — no lists to wade
 * through, no second copy of what PostHog already shows. Every top finding can become a feedback topic; the
 * composer is only pre-filled, the admin sends it.
 */
@Component({
  selector: 'sc-telemetry-stats',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScActionDirective, ScTooltipDirective, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header
      [crumbs]="crumbs"
      [eyebrow]="'telemetry.eyebrow' | translate"
      [title]="'telemetry.title' | translate"
      [subtitle]="'telemetry.subtitle' | translate">
      <div phAside class="aside">
        @if (overview(); as o) {
          <span class="stand">{{ 'telemetry.asOf' | translate }} {{ o.generatedAt | scDate: 'time' }}</span>
        }
        <a scAction tier="secondary" [href]="postHogUrl()" target="_blank" rel="noopener noreferrer">
          <span>{{ 'telemetry.openPosthog' | translate }}</span>
        </a>
      </div>
    </sc-page-header>

    @if (errorKey(); as key) {
      <div class="state err" role="alert">
        <span><strong>{{ 'telemetry.errorTitle' | translate }}:</strong> {{ key | translate }}</span>
        <button scAction tier="secondary" type="button" [busy]="busy()" (click)="load()">{{ 'telemetry.retry' | translate }}</button>
      </div>
    } @else if (!overview()) {
      <div class="state" role="status">{{ 'telemetry.loading' | translate }}</div>
    } @else {
      @let o = overview()!;
      @if (!o.posthogReachable) {
        <div class="notice" role="status" data-notice="unreachable">
          <span class="tick lv-unknown" aria-hidden="true">?</span>
          <span>{{ 'telemetry.unavailable' | translate }}</span>
        </div>
      }
      <div class="status" [class]="'status st-' + status()" role="status" data-status>
        <span class="tick" [class]="'tick lv-' + statusLevel()" aria-hidden="true">{{ statusGlyph() }}</span>
        <span class="status-text">
          @switch (status()) {
            @case ('attention') { {{ (o.attention === 1 ? 'telemetry.status.attentionOne' : 'telemetry.status.attention') | translate: { n: o.attention } }} }
            @case ('blind') { {{ 'telemetry.status.blind' | translate }} }
            @default { {{ 'telemetry.status.calm' | translate }} }
          }
        </span>
        <span class="since">
          @if (o.lastVisitAt) {
            {{ 'telemetry.status.since' | translate: { date: (o.lastVisitAt | scDate: 'datetime') } }}
          } @else {
            {{ 'telemetry.status.firstVisit' | translate }}
          }
        </span>
      </div>

      <div class="grid">
        @for (c of o.cards; track c.id) {
          <section class="card" [class]="'card lv-card-' + c.level" [attr.data-card]="c.id" [attr.data-level]="c.level" [attr.aria-labelledby]="'tc-' + c.id">
            <h2 class="top" [id]="'tc-' + c.id">
              <span class="tick" [class]="'tick lv-' + c.level" aria-hidden="true">{{ glyph(c.level) }}</span>
              <span class="sc-sr-only">{{ 'telemetry.level.' + c.level | translate }}: </span>
              {{ titleOf(c) }}
            </h2>

            <div class="kpi">
              <span class="kpi-val">{{ c.kpi.display }}</span>
              <small>{{ 'telemetry.unit.' + c.kpi.unitKey | translate }}</small>
              @if (c.forecast) { <small class="fc">· {{ 'telemetry.forecast' | translate: { value: c.forecast.display } }}</small> }
              @if (c.delta) {
                <span class="delta" [class.worse]="isWorse(c)" [class.better]="!isWorse(c)">{{ deltaOf(c) }}</span>
              }
            </div>

            @if (c.bar; as b) {
              <div class="bar" role="img" [class]="'bar bar-' + c.level" [attr.aria-label]="'telemetry.barLabel' | translate: { pct: b.pct, month: b.monthPct }">
                <span [style.width.%]="b.pct"></span><i [style.left.%]="b.monthPct"></i>
              </div>
            }

            @if (c.spark?.length) {
              <svg class="spark" viewBox="0 0 120 26" preserveAspectRatio="none" role="img" [attr.aria-label]="'telemetry.sparkLabel' | translate">
                <polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" [attr.points]="spark(c)" />
              </svg>
            }

            @if (c.top.length) {
              <ul class="list">
                @for (it of c.top; track $index) {
                  <li>
                    @if (it.badge) { <span class="badge">{{ 'telemetry.badge.' + it.badge | translate }}</span> }
                    @else if (c.id === 'services' && it.level) { <span class="tick sm" [class]="'tick sm lv-' + it.level" aria-hidden="true">{{ glyph(it.level) }}</span> }
                    <span class="name">
                      @if (it.url) {
                        <a class="item-link" [href]="it.url" target="_blank" rel="noopener noreferrer">{{ itemLabel(c, it) }}<span class="sc-sr-only"> ↗</span></a>
                      } @else {
                        {{ itemLabel(c, it) }}
                      }
                    </span>
                    @if (it.value) { <span class="muted val">{{ it.value }}</span> }
                    @if (it.feedback; as fb) {
                      <button scAction tier="tertiary" type="button" class="to-fb" [scTooltip]="'telemetry.toFeedback' | translate" scTooltipTier="label"
                              [attr.aria-label]="'telemetry.toFeedback' | translate" (click)="toFeedback(fb, it.badge)">
                        <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4V5zM12 8v4M10 10h4" /></svg>
                      </button>
                    }
                  </li>
                }
              </ul>
            } @else if (c.level === 'unknown') {
              <p class="calm">{{ 'telemetry.cardUnavailable' | translate }}</p>
            } @else if (c.calmKey) {
              <p class="calm">{{ 'telemetry.calm.' + c.calmKey | translate }}</p>
            }

            <div class="cta">
              @if (c.feedbackCta; as fb) {
                <button scAction tier="secondary" type="button" class="cta-fb" (click)="toFeedback(fb)">{{ 'telemetry.quotaFeedback' | translate }}</button>
              }
              @if (c.upgradeUrl; as up) {
                <a scAction tier="secondary" [href]="up" target="_blank" rel="noopener noreferrer"><span>{{ 'telemetry.upgrade' | translate }}</span></a>
              }
              @for (l of c.links; track l.labelKey) {
                @if (l.url !== c.upgradeUrl) {
                  <a scAction tier="secondary" [href]="l.url" target="_blank" rel="noopener noreferrer"><span>{{ 'telemetry.link.' + l.labelKey | translate }}</span></a>
                }
              }
              @if (c.boardWaiting) {
                <span class="badge board">{{ (c.boardWaiting === 1 ? 'telemetry.boardWaitingOne' : 'telemetry.boardWaitingMany') | translate: { n: c.boardWaiting } }}</span>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; padding-block: var(--sc-space-4) var(--sc-space-6); }
    .aside { display: flex; align-items: center; gap: var(--sc-space-3); flex-wrap: wrap; }
    .stand { color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor)); }

    .tick { width: 18px; height: 18px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 0.7rem; font-weight: 700; flex: none; }
    .tick.sm { width: 16px; height: 16px; font-size: 0.65rem; }
    .lv-ok { background: color-mix(in srgb, var(--sc-success) 18%, transparent); color: var(--sc-success); }
    .lv-warn { background: color-mix(in srgb, var(--sc-warning) 20%, transparent); color: var(--sc-warning); }
    .lv-error { background: color-mix(in srgb, var(--sc-danger) 18%, transparent); color: var(--sc-danger); }
    .lv-unknown { background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }

    .state, .notice, .status {
      display: flex; align-items: center; gap: var(--sc-space-3); flex-wrap: wrap;
      margin-top: var(--sc-space-4); padding: var(--sc-space-3) var(--sc-space-4);
      border-radius: 10px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }
    .state.err { border-color: var(--sc-danger); justify-content: space-between; }
    .notice { border-color: var(--sc-warning); }
    .status-text { font-size: 1rem; font-weight: 600; }
    .since { margin-inline-start: auto; font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .grid { display: grid; gap: var(--sc-space-4); margin-top: var(--sc-space-4); grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 1000px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 640px) { .grid { grid-template-columns: minmax(0, 1fr); } .since { margin-inline-start: 0; flex-basis: 100%; } }

    .card {
      display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: var(--sc-space-4);
      background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 12px;
    }
    .card.lv-card-warn { border-color: color-mix(in srgb, var(--sc-warning) 55%, transparent); }
    .card.lv-card-error { border-color: color-mix(in srgb, var(--sc-danger) 50%, transparent); }
    .top { display: flex; align-items: center; gap: var(--sc-space-2); margin: 0; font-size: 0.82rem; font-weight: 500; color: var(--sc-fg-2); }
    .kpi { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 6px; line-height: 1.15; }
    .kpi-val { font-size: 1.75rem; font-weight: 700; color: var(--sc-fg-0, inherit); }
    .kpi small { font-size: max(0.82rem, var(--sc-fs-floor)); font-weight: 400; color: var(--sc-fg-2); }
    .delta { font-size: max(0.82rem, var(--sc-fs-floor)); }
    .delta.better { color: var(--sc-success); }
    .delta.worse { color: var(--sc-warning); }
    .spark { height: 26px; width: 100%; color: var(--sc-accent); }
    .bar { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--sc-fg-2) 25%, transparent); position: relative; margin-block: 4px; }
    .bar span { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--sc-success); }
    .bar-warn span { background: var(--sc-warning); }
    .bar-error span { background: var(--sc-danger); }
    .bar-unknown span { background: var(--sc-fg-2); }
    .bar i { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--sc-fg-1, var(--sc-fg-2)); }

    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; }
    .list li { display: flex; gap: var(--sc-space-2); align-items: center; min-width: 0; }
    .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .item-link { color: inherit; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); text-underline-offset: 3px; }
    .item-link:hover { color: var(--sc-accent); }
    .muted { color: var(--sc-fg-2); }
    .val { white-space: nowrap; }
    .badge { font-size: max(0.72rem, var(--sc-fs-floor)); padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--sc-fg-2) 20%, transparent); color: var(--sc-fg-2); white-space: nowrap; }
    .calm { margin: 0; font-size: 0.85rem; color: var(--sc-fg-2); }
    .cta { display: flex; gap: var(--sc-space-2); flex-wrap: wrap; align-items: center; margin-top: auto; }
    .badge.board { white-space: normal; }
  `],
})
export class TelemetryStatsComponent {
  private readonly supabase = inject(SupabaseClientProvider);
  private readonly translate = inject(TranslateService);
  private readonly seeds = inject(FeedbackComposerSeedService);
  private readonly fabPrefs = inject(FeedbackFabPrefsService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  readonly crumbs: PageCrumb[] = [{ labelKey: 'adminHub.title', link: '/admin/hub' }];

  readonly overview = signal<Overview | null>(null);
  readonly busy = signal(false);
  /** i18n key, never raw text. */
  readonly errorKey = signal<string | null>(null);

  /** The first answer of this visit — what a later auto-refresh must not overwrite (see mergeRefresh). */
  private first: Overview | null = null;
  private seenSent = false;
  private destroyed = false;

  readonly postHogUrl = computed(() => posthogRoot(this.overview()?.cards ?? []));

  readonly status = computed<StatusKind>(() => {
    const o = this.overview();
    if (!o) return 'calm';
    if (o.attention > 0) return 'attention';
    return o.posthogReachable ? 'calm' : 'blind';
  });
  readonly statusLevel = computed(() => {
    const s = this.status();
    return s === 'attention' ? (this.overview()?.cards.some((c) => c.level === 'error') ? 'error' : 'warn') : s === 'blind' ? 'unknown' : 'ok';
  });
  readonly statusGlyph = computed(() => this.glyph(this.statusLevel()));

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    void this.load();
    useAutoRefresh(() => this.load(true), { enabled: () => !this.busy() && !this.errorKey() });
  }

  glyph(level: string): string {
    return level === 'ok' ? '✓' : level === 'warn' ? '!' : level === 'error' ? '×' : '?';
  }

  titleOf(c: OverviewCard): string {
    if (c.id !== 'ai') return this.translate.instant(`telemetry.card.${c.id}`);
    const lang = this.translate.currentLang() || this.translate.getFallbackLang() || 'de';
    const month = new Intl.DateTimeFormat(lang, { month: 'long' }).format(new Date(this.overview()?.generatedAt ?? Date.now()));
    return this.translate.instant('telemetry.card.ai', { month });
  }

  itemLabel(c: OverviewCard, it: OverviewItem): string {
    if (c.id === 'services' && (KNOWN_SERVICES as readonly string[]).includes(it.label)) return this.translate.instant(`telemetry.service.${it.label}`);
    return it.label;
  }

  spark(c: OverviewCard): string { return sparkPoints(c.spark ?? []); }
  deltaOf(c: OverviewCard): string { return c.delta ? deltaText(c.delta) : ''; }
  isWorse(c: OverviewCard): boolean { return !!c.delta && deltaIsWorse(c.delta); }

  /**
   * "In Feedback umwandeln" / "Sparvorschlag als Feedback": plant the server's text in the admin new-topic composer
   * and open it. Nothing is sent here — the admin reads, edits and presses send.
   */
  toFeedback(fb: FeedbackText, badge?: string): void {
    this.seeds.plant(draftScopes.adminNew, { body: fb.body, area: badge === 'desktop' ? 'desktop' : null, complex: false });
    // An admin who switched the launcher off has no docked panel: the full board's composer takes the seed.
    if (this.fabPrefs.show()) this.seeds.requestOpen();
    else void this.router.navigateByUrl('/admin/feedback');
  }

  async load(refresh = false): Promise<void> {
    this.busy.set(true);
    if (!refresh) this.errorKey.set(null);
    try {
      const { data, error } = await this.supabase.client.functions.invoke('telemetry-overview', { method: 'GET' });
      if (this.destroyed) return;
      if (error || !data || !Array.isArray((data as Overview).cards)) {
        // A failed background refresh keeps the cards on screen; a failed first load or retry shows the error state.
        if (!refresh || !this.overview()) {
          this.errorKey.set(toErrorKey('telemetry', 'load overview', error ?? new Error('empty overview')));
          this.overview.set(null);
        } else {
          logWarn('telemetry', 'refresh overview failed', { error });
        }
        return;
      }
      this.errorKey.set(null);
      const next = data as Overview;
      if (!this.first || !refresh) this.first = next;
      this.overview.set(refresh && this.overview() && this.first ? mergeRefresh(this.first, next) : next);
      this.markSeen();
    } finally {
      this.busy.set(false);
    }
  }

  /** Stores this visit as "seen" — once, after the cards are on screen, never in the way of the render. */
  private markSeen(): void {
    if (this.seenSent) return;
    this.seenSent = true;
    afterNextRender(() => {
      void this.supabase.client.functions
        .invoke('telemetry-overview', { method: 'POST', body: { seen: true } })
        .then(({ error }) => { if (error) logWarn('telemetry', 'mark seen failed', { error }); })
        .catch((e: unknown) => logWarn('telemetry', 'mark seen failed', { error: e }));
    }, { injector: this.injector });
  }
}
