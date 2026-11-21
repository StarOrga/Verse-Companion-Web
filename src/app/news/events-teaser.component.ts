import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../core/analytics.service';
import { AuthService } from '../auth/auth.service';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { daysUntil, eventPhase, type VerseEvent } from './news-events';
import { VerseEventsService } from './verse-events.service';

/** Where the teaser stands — also the analytics `surface`. */
export type EventsTeaserVariant = 'news_top' | 'news_bottom' | 'hub';

interface TeaserRow {
  readonly event: VerseEvent;
  readonly phase: 'running' | 'upcoming';
  /** i18n key + params of the "when" line. */
  readonly whenKey: string;
  readonly whenParams: Record<string, string | number>;
  readonly kindKey: string;
}

/**
 * In-game events teaser (feedback #389), one component for three places:
 *
 * - `news_top`    above the Verse News stream: what runs now, plus the next one;
 * - `news_bottom` below the stream: the upcoming calendar;
 * - `hub`         in the Verse hub under the three columns: now + next.
 *
 * Data: the event timeline `sc_events` ({@link VerseEventsService}). The head
 * is a real anchor to the stream's Events category (`/verse/news?filter=events`);
 * an event row is a real anchor to its RSI comm-link, or plain text while the
 * timeline knows none. Nothing to show → the teaser renders nothing; a failed
 * load shows its error with a retry.
 */
@Component({
  selector: 'sc-events-teaser',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant()', '[class.empty]': '!visible()' },
  template: `
    @if (svc.error() && !svc.loaded() && auth.user()) {
      <div class="ev-state" role="alert">
        <span>{{ 'news.events.error' | translate }}</span>
        <button type="button" scAction tier="secondary" [busy]="svc.loading()" (click)="retry()">{{ 'errors.retry' | translate }}</button>
      </div>
    } @else if (rows().length) {
      <section class="ev" [attr.aria-label]="'news.events.aria' | translate">
        <h2 class="ev-h">
          <a class="ev-head" routerLink="/verse/news" [queryParams]="{ filter: 'events' }">
            <span class="ev-dot" aria-hidden="true"></span>
            <span>{{ (variant() === 'news_bottom' ? 'news.events.upcomingTitle' : 'news.events.title') | translate }}</span>
            <span class="ev-all">{{ 'news.events.allPosts' | translate }} →</span>
          </a>
        </h2>
        <ul class="ev-list">
          @for (r of rows(); track r.event.id) {
            <li class="ev-i" [attr.data-phase]="r.phase">
              @if (r.event.url) {
                <a class="ev-a" [href]="r.event.url" target="_blank" rel="noopener noreferrer"
                   (click)="opened(r)" (auxclick)="opened(r)">
                  <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: r }" />
                </a>
              } @else {
                <div class="ev-a static">
                  <ng-container [ngTemplateOutlet]="body" [ngTemplateOutletContext]="{ $implicit: r }" />
                </div>
              }
            </li>
          }
        </ul>
      </section>
    }

    <ng-template #body let-r>
      <span class="ev-when">
        @if (r.phase === 'running') { <i class="ev-live" aria-hidden="true"></i> }
        {{ r.whenKey | translate: r.whenParams }}
        @if (r.event.dateStatus === 'estimated') { <span class="ev-est">· {{ 'news.events.estimated' | translate }}</span> }
      </span>
      <span class="ev-name">{{ r.event.name }}</span>
      <span class="ev-kind">
        {{ r.kindKey | translate }}
        @if (r.event.freeFly && r.event.kind !== 'free-fly') { · {{ 'news.events.kind.free-fly' | translate }} }
      </span>
      @if (variant() === 'news_bottom' && summaryOf(r.event); as s) { <span class="ev-sum">{{ s }}</span> }
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    :host(.empty) { display: none; }
    .ev { display: flex; flex-direction: column; gap: 10px; }
    .ev-h { margin: 0; font: inherit; }
    .ev-head {
      display: inline-flex; align-items: center; gap: 10px; min-height: 44px;
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.18em; text-transform: uppercase; color: var(--sc-fg-0); text-decoration: none;
    }
    .ev-head:hover .ev-all, .ev-head:focus-visible .ev-all { color: var(--sc-accent); }
    .ev-head:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); border-radius: 6px; }
    .ev-all { color: var(--sc-fg-2); letter-spacing: 0.06em; text-transform: none; font-family: inherit; }
    .ev-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-accent); box-shadow: 0 0 8px color-mix(in srgb, var(--sc-accent) 60%, transparent); }
    .ev-list {
      list-style: none; margin: 0; padding: 0;
      display: grid; gap: var(--news-gap, 12px);
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
    }
    .ev-i { min-width: 0; }
    .ev-a {
      display: flex; flex-direction: column; gap: 4px; height: 100%; box-sizing: border-box;
      padding: 12px 14px; min-height: 44px;
      border: 1px solid var(--sc-border); border-radius: 10px;
      background: color-mix(in srgb, var(--sc-bg-1) 55%, transparent);
      color: var(--sc-fg-0); text-decoration: none;
      transition: border-color 0.18s, background-color 0.18s;
    }
    a.ev-a:hover { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); }
    a.ev-a:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
    .ev-i[data-phase='running'] .ev-a { border-color: color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border)); }
    .ev-when {
      display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
      font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .ev-i[data-phase='running'] .ev-when { color: var(--sc-accent); }
    .ev-live { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: ev-pulse 2.4s ease-in-out infinite; }
    .ev-est { color: var(--sc-fg-2); }
    .ev-name { font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
    .ev-kind { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ev-sum {
      font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); line-height: 1.45;
    }
    .ev-state { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); }
    @keyframes ev-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) { .ev-live { animation: none; } }
  `],
})
export class EventsTeaserComponent {
  readonly variant = input<EventsTeaserVariant>('news_top');

  readonly svc = inject(VerseEventsService);
  private readonly translate = inject(TranslateService);
  private readonly analytics = inject(AnalyticsService);
  private readonly lang = toSignal(this.translate.onLangChange, { initialValue: null });

  /** Ticks every ten minutes so "läuft" / "in n Tagen" stay honest on an open tab. */
  private readonly clock = signal(Date.now());

  readonly auth = inject(AuthService);

  private readonly zone = inject(NgZone);
  private clockTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    // The timeline is readable for signed-in readers only (RLS); signed out there is nothing to ask for.
    effect(() => {
      if (!this.auth.user()) return;
      void this.svc.load();
      this.startClock();
    });
    inject(DestroyRef).onDestroy(() => clearInterval(this.clockTimer));
  }

  /**
   * Outside the zone: a repeating timer would keep the app from ever turning
   * stable (fixture.whenStable(), the service worker's registration); the
   * signal write still schedules change detection. Signed-in readers only.
   */
  private startClock(): void {
    if (this.clockTimer) return;
    this.clockTimer = this.zone.runOutsideAngular(() => setInterval(() => this.clock.set(Date.now()), 10 * 60 * 1000));
  }

  readonly rows = computed<readonly TeaserRow[]>(() => {
    const now = this.clock();
    this.lang();
    const { running, upcoming } = this.svc.teaser(now);
    const picked: VerseEvent[] =
      this.variant() === 'news_bottom' ? [...upcoming] : [...running.slice(0, 3), ...upcoming.slice(0, 1)];
    return picked.map((e) => this.row(e, now));
  });

  readonly visible = computed(() => this.rows().length > 0 || (!!this.svc.error() && !this.svc.loaded() && !!this.auth.user()));

  retry(): void {
    void this.svc.load(true);
  }

  opened(r: TeaserRow): void {
    this.analytics.track('news:event_open', { surface: this.variant(), phase: r.phase });
  }

  summaryOf(e: VerseEvent): string {
    const lang = (this.translate.getCurrentLang() || 'en').slice(0, 2);
    return (lang === 'de' ? e.summary.de : e.summary.en) || e.summary.en;
  }

  private row(e: VerseEvent, now: number): TeaserRow {
    const phase = eventPhase(e, now) === 'running' ? 'running' : 'upcoming';
    const kindKey = `news.events.kind.${e.kind}`;
    if (phase === 'running') {
      const left = daysUntil(e.end, now);
      return left <= 0
        ? { event: e, phase, whenKey: 'news.events.endsToday', whenParams: {}, kindKey }
        : { event: e, phase, whenKey: 'news.events.runningUntil', whenParams: { date: this.day(e.end) }, kindKey };
    }
    const n = daysUntil(e.start, now);
    const whenKey = n === 1 ? 'news.events.startsTomorrow' : 'news.events.startsIn';
    return { event: e, phase, whenKey, whenParams: { date: this.day(e.start), n }, kindKey };
  }

  private day(iso: string): string {
    const t = Date.parse(`${iso}T00:00:00Z`);
    if (!Number.isFinite(t)) return iso;
    return new Intl.DateTimeFormat(this.translate.getCurrentLang() || 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(t);
  }
}
