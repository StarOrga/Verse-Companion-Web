import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { HqAppLaunchComponent } from '../hq-app-launch.component';
import { HqLiveService } from '../now/hq-live.service';
import { HqLiveStore } from '../now/hq-live.store';
import { isGameLive } from '../now/hq-live.util';
import type { HqLiveEventRow } from '../data/hq-db.types';
import { LOGBOOK_EVENT_TYPES, groupSessions, type LogbookSession } from './hq-sessions.util';

const DAY_MS = 86_400_000;
/** How far back the logbook reads, and the row cap of that read. */
const LOGBOOK_DAYS = 30;
const LOGBOOK_LIMIT = 2000;
/** Cards shown before "show all". */
const FIRST_CARDS = 6;

/**
 * HQ Statistik "Logbuch" (#896): one card per game session from the SCC-App live events —
 * duration, quantum jumps, contracts, aUEC balance, losses and costs (#1192). A session without a quit is
 * shown as ended without one; the running one as live. Without live sync: the SCC-App prompt.
 */
@Component({
  selector: 'sc-hq-logbook',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, HqAppLaunchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="logbook" aria-labelledby="hq-logbook-title">
      <h3 id="hq-logbook-title">{{ 'hq.logbook.title' | translate }}</h3>
      @if (error()) {
        <div class="state" role="alert">
          <p>{{ error()! | translate }}</p>
          <button type="button" scAction tier="secondary" (click)="load()">{{ 'hq.logbook.retry' | translate }}</button>
        </div>
      } @else if (sessions() === null) {
        <p class="state muted" role="status" aria-busy="true">{{ 'hq.logbook.loading' | translate }}</p>
      } @else if (sessions()!.length === 0) {
        <div class="state">
          <p class="muted">{{ (appReporting() ? 'hq.logbook.emptyLinked' : 'hq.logbook.empty') | translate }}</p>
          @if (!appReporting()) {
            <sc-hq-app-launch />
          }
        </div>
      } @else {
        <ul class="cards">
          @for (s of shown(); track s.startedAt) {
            <li class="card" [class.live]="s.end === 'live'">
              <div class="c-head">
                <span class="c-when">{{ when(s) }}</span>
                <span class="c-dur">{{ duration(s.durationMs) }}</span>
              </div>
              @if (s.end !== 'quit') {
                <span class="c-end">{{ 'hq.logbook.end.' + s.end | translate }}</span>
              }
              <dl class="c-facts">
                <div><dt>{{ 'hq.logbook.jumps' | translate }}</dt><dd>{{ fmt(s.jumps) }}</dd></div>
                <div><dt>{{ 'hq.logbook.contracts' | translate }}</dt><dd>{{ fmt(s.contracts) }}</dd></div>
                <div>
                  <dt>{{ 'hq.logbook.auec' | translate }}</dt>
                  <dd [class.warn]="s.auecNet < 0">{{ s.traded ? signed(s.auecNet) : '–' }}</dd>
                </div>
                <div>
                  <dt>{{ 'hq.logbook.losses' | translate }}</dt>
                  <dd [class.warn]="losses(s) > 0">{{ fmt(losses(s)) }}</dd>
                </div>
              </dl>
              @if (losses(s) > 0) {
                <p class="c-sub">{{ 'hq.logbook.lossesSub' | translate: { deaths: fmt(s.deaths), ships: fmt(s.shipsLost), claims: fmt(s.claims) } }}</p>
              }
              @let costs = costParts(s);
              @if (costs.length > 0) {
                <p class="c-sub c-costs"><span class="c-costs-label">{{ 'hq.logbook.costs.label' | translate }}</span> {{ costs.join(' · ') }}</p>
              }
            </li>
          }
        </ul>
        @if (!expanded() && sessions()!.length > shown().length) {
          <button type="button" scAction tier="secondary" (click)="expanded.set(true)">
            {{ 'hq.logbook.showAll' | translate: { n: sessions()!.length } }}
          </button>
        }
        <p class="note muted">{{ 'hq.logbook.note' | translate: { days: days } }}</p>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; margin-top: var(--sc-space-5, 24px); }
      h3 { margin: 0 0 var(--sc-space-3, 12px); font: 600 1.1rem / 1.3 var(--sc-font-display); }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2, 8px); }
      .state p { margin: 0; }
      .muted { color: var(--sc-fg-2); }
      .cards { list-style: none; margin: 0 0 var(--sc-space-3, 12px); padding: 0; display: grid; gap: var(--sc-space-3, 12px); grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); }
      .card { display: grid; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px); background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: var(--sc-radius); }
      .card.live { border-color: var(--sc-accent); }
      .c-head { display: flex; justify-content: space-between; gap: var(--sc-space-2, 8px); align-items: baseline; }
      .c-when { font-weight: 600; }
      .c-dur { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
      .c-end { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .card.live .c-end { color: var(--sc-accent); }
      .c-facts { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sc-space-2, 8px); }
      .c-facts div { display: grid; gap: 2px; }
      dt { color: var(--sc-fg-2); font-size: max(0.75rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.04em; }
      dd { margin: 0; font: 600 1.15rem / 1.2 var(--sc-font-display); font-variant-numeric: tabular-nums; }
      dd.warn { color: var(--sc-warning); }
      .c-sub { margin: 0; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .c-costs-label { color: var(--sc-fg-1); font-weight: 600; }
      .note { margin: var(--sc-space-2, 8px) 0 0; font-size: max(0.8rem, var(--sc-fs-floor)); }
    `,
  ],
})
export class HqLogbookComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly store = inject(HqLiveStore);
  private readonly live = inject(HqLiveService);
  private readonly i18n = inject(TranslateService);

  readonly days = LOGBOOK_DAYS;
  private readonly events = signal<readonly Pick<HqLiveEventRow, 'type' | 'at' | 'data'>[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly expanded = signal(false);
  /** The SCC app already reports game data: only playing is missing, not the app. */
  readonly appReporting = computed(() => this.live.state() !== null);

  readonly sessions = computed<LogbookSession[] | null>(() => {
    const ev = this.events();
    if (!ev) return null;
    return groupSessions(ev, isGameLive(this.live.state(), this.live.events(), Date.now()));
  });
  readonly shown = computed(() => {
    const s = this.sessions() ?? [];
    return this.expanded() ? s : s.slice(0, FIRST_CARDS);
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const uid = this.auth.user()?.id;
    if (!uid) return;
    this.error.set(null);
    try {
      const since = new Date(Date.now() - LOGBOOK_DAYS * DAY_MS).toISOString();
      this.events.set(await this.store.fetchEventsOfTypes(uid, LOGBOOK_EVENT_TYPES, since, LOGBOOK_LIMIT));
    } catch (err) {
      this.error.set(toErrorKey('hq', 'logbook.load', err));
    }
  }

  losses(s: LogbookSession): number {
    return s.deaths + s.shipsLost + s.claims;
  }

  /** The "Kosten" line (#1192): one part per non-zero cost, fines with their aUEC sum when the payload carried one. */
  costParts(s: LogbookSession): string[] {
    const part = (key: string, n: number) => this.i18n.instant(`hq.logbook.costs.${key}.${n === 1 ? 'one' : 'other'}`, { n: this.fmt(n) });
    const out: string[] = [];
    if (s.fines > 0) {
      const fines = part('fines', s.fines);
      out.push(s.fineAmount > 0 ? this.i18n.instant('hq.logbook.costs.fineAmount', { fines, amount: this.fmt(s.fineAmount) }) : fines);
    }
    if (s.injuries > 0) out.push(part('injuries', s.injuries));
    if (s.medbeds > 0) out.push(part('medbeds', s.medbeds));
    if (s.claimRequests > 0) out.push(part('claimRequests', s.claimRequests));
    return out;
  }

  fmt(n: number): string {
    return new Intl.NumberFormat(this.lang()).format(n);
  }

  signed(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '') + this.fmt(Math.abs(n));
  }

  when(s: LogbookSession): string {
    return new Intl.DateTimeFormat(this.lang(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
      new Date(s.startedAt),
    );
  }

  duration(ms: number): string {
    const min = Math.round(ms / 60_000);
    const h = Math.floor(min / 60);
    return h > 0 ? this.i18n.instant('hq.logbook.durH', { h, m: min % 60 }) : this.i18n.instant('hq.logbook.durM', { m: min });
  }

  private lang(): string {
    return this.i18n.currentLang() || 'de';
  }
}
