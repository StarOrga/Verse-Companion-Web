import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { CardBoard, CardGoal } from '../translations.service';
import { barPct, boardName, kiTargetLang, langRows, rankLine } from './cards.logic';
import { GoalRingComponent } from './goal-ring.component';

/** The quiet instrument frame both side boxes share (corner ticks in the game violet). */
const BOX_STYLES = `
  :host { display: block; min-width: 0; }
  .box {
    position: relative; display: grid; gap: 14px; min-width: 0; padding: 16px; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--tc-pu) 22%, transparent); border-radius: 16px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-1) 70%, transparent), color-mix(in srgb, var(--sc-bg-0) 70%, transparent));
  }
  .box::before {
    content: ''; position: absolute; inset: 6px; border-radius: 12px; pointer-events: none; opacity: 0.5;
    --t: var(--tc-pu);
    background:
      linear-gradient(var(--t), var(--t)) left top / 12px 2px no-repeat, linear-gradient(var(--t), var(--t)) left top / 2px 12px no-repeat,
      linear-gradient(var(--t), var(--t)) right top / 12px 2px no-repeat, linear-gradient(var(--t), var(--t)) right top / 2px 12px no-repeat,
      linear-gradient(var(--t), var(--t)) left bottom / 12px 2px no-repeat, linear-gradient(var(--t), var(--t)) left bottom / 2px 12px no-repeat,
      linear-gradient(var(--t), var(--t)) right bottom / 12px 2px no-repeat, linear-gradient(var(--t), var(--t)) right bottom / 2px 12px no-repeat;
  }
  .boxh {
    margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 8px;
    font: 600 0.6875rem/1.3 var(--sc-font-display, inherit); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2);
  }
  .boxh-s { font: 400 0.75rem/1.3 var(--sc-font-body, inherit); letter-spacing: 0; text-transform: none; }
  .narrow { display: none; }
  .sfoot { margin: 0; font-size: 0.75rem; line-height: 1.4; color: var(--sc-fg-2); }
  em { font-style: normal; color: var(--sc-warning); }
  /* One column (phone, below 900 px): the HUD strip carries ring, place and streak, the boxes keep only their lists. */
  @media (max-width: 899px) { .wide { display: none; } }
  @media (max-width: 899px) { .narrow { display: inline; } }
  @media (max-width: 899px) { .hud-dup { display: none; } }
`;

/**
 * Box „Tagesziel & Sprachen“ (concept karteikarten-neu r5 d1, left of the card, U8/U9): the daily-goal ring and one
 * row per language — the admin's own languages lead to their deck, the KI languages to their veto list; the KI
 * summary is the last row in the same style (no extra button). Rows are real anchors (`?tab=cards&lang=…`).
 */
@Component({
  selector: 'sc-cards-goal-box',
  standalone: true,
  imports: [TranslatePipe, RouterLink, GoalRingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="box" data-test="goal-box" [attr.aria-label]="'admin.translations.cards.box.goalAria' | translate">
      <h3 class="boxh">
        <span class="wide">{{ 'admin.translations.cards.box.goal' | translate }}</span>
        <span class="narrow">{{ 'admin.translations.cards.box.langs' | translate }}</span>
      </h3>
      <sc-goal-ring class="ring hud-dup" [done]="goal().done" [target]="goal().target" [hot]="hot()">
        <small>{{ 'admin.translations.cards.goalCap' | translate }}</small>
        <b>{{ 'admin.translations.cards.goalOf' | translate: { done: goal().done, target: goal().target } }}</b>
        <span>{{ (goal().full ? 'admin.translations.cards.goalDone' : 'admin.translations.cards.goalToday') | translate }}</span>
      </sc-goal-ring>
      <ul class="langs" role="list">
        @for (r of rows(); track r.lang) {
          <li>
            <a class="lrow" [routerLink]="[]" [queryParams]="{ tab: 'cards', lang: r.lang }" [attr.data-test]="'lang-' + r.lang"
               [class.done]="r.judged && r.line.key?.endsWith('.clear')"
               [attr.aria-current]="r.lang === active() ? 'true' : null">
              <span class="lc">{{ r.lang.toUpperCase() }}</span>
              <span class="ln">{{ langName(r.lang) }}
                <small>{{ r.line.key! | translate: r.line.params }}@if (r.unsure > 0) { · <em>{{ 'admin.translations.cards.row.unsure' | translate: { count: r.unsure } }}</em> }</small>
              </span>
            </a>
          </li>
        }
        @if (kiLang(); as k) {
          <li>
            <a class="lrow ki" data-test="ki-row" [routerLink]="[]" [queryParams]="{ tab: 'cards', lang: k }">
              <span class="lc" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></svg>
              </span>
              <span class="ln">{{ 'admin.translations.cards.row.kiSummary' | translate: { count: summary().decided } }}
                <small>@if (summary().unsure > 0) { <em>{{ 'admin.translations.cards.row.unsure' | translate: { count: summary().unsure } }}</em> · }{{ 'admin.translations.cards.row.waiting' | translate: { count: summary().review } }}</small>
              </span>
            </a>
          </li>
        }
      </ul>
    </aside>
  `,
  styles: [
    BOX_STYLES,
    `
      .ring { margin: 0 auto; }
      .ring small { font-size: 0.625rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2); }
      .ring b { font: 700 1.5rem/1 var(--sc-font-display, inherit); color: var(--sc-fg-0); white-space: nowrap; }
      .ring span { font-size: 0.72rem; color: var(--sc-fg-2); }
      :host-context(.cards-hot) .ring b { color: var(--tc-pu-hi); text-shadow: 0 0 14px color-mix(in srgb, var(--tc-pu) 80%, transparent); }
      .langs { list-style: none; margin: 0; display: grid; gap: 2px; padding: 12px 0 0; border-top: 1px solid color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      @media (max-width: 899px) { .langs { padding-top: 0; border-top: 0; } }
      .lrow {
        display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 44px; padding: 6px 8px; box-sizing: border-box;
        border-radius: 10px; font-size: 0.8125rem; line-height: 1.3; color: var(--sc-fg-1); text-decoration: none;
      }
      .lrow:hover { background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .lrow:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
      .lrow[aria-current] { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); color: var(--sc-fg-0); box-shadow: inset 2px 0 0 var(--sc-accent); }
      .lc { font: 600 0.65rem/1 var(--sc-font-display, inherit); letter-spacing: 0.04em; color: var(--sc-fg-2); white-space: nowrap; }
      .lrow[aria-current] .lc { color: var(--sc-accent); }
      .lrow.done .lc { color: var(--sc-success); }
      .lrow.ki .lc { color: var(--tc-pu-hi); }
      .lrow.ki svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; }
      .lrow.ki { margin-top: 4px; border-top: 1px dashed color-mix(in srgb, var(--tc-pu) 22%, transparent); border-radius: 0 0 10px 10px; }
      .ln { min-width: 0; overflow-wrap: anywhere; }
      .ln small { display: block; font-size: 0.72rem; color: var(--sc-fg-2); }
      @media (pointer: coarse) { .lrow { min-height: 48px; } }
    `,
  ],
})
export class CardsGoalBoxComponent {
  private readonly translate = inject(TranslateService);
  readonly board = input<CardBoard | null>(null);
  readonly goal = input<CardGoal>({ done: 0, target: 10, full: false, bonus_taken: false });
  readonly active = input('');
  readonly hot = input(false);

  protected readonly rows = computed(() => langRows(this.board()));
  protected readonly kiLang = computed(() => kiTargetLang(this.board()));
  protected readonly summary = computed(() => this.board()?.ai_summary ?? { decided: 0, review: 0, unsure: 0 });

  protected langName(code: string): string {
    const key = `admin.translations.cards.langNames.${code}`;
    const t = this.translate.instant(key) as string;
    return t && t !== key ? t : code.toUpperCase();
  }
}

/**
 * Box „Statistik“ (concept karteikarten-neu r5 d1, right of the card, U10/G1/G4): place and the gap to the next one,
 * the week's leaderboard by name (own row „Du“), the week's points and the 7-day streak row. No combo (G2).
 */
@Component({
  selector: 'sc-cards-stats-box',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = board();
    <aside class="box" data-test="stats-box" [attr.aria-label]="'admin.translations.cards.box.statsAria' | translate">
      <h3 class="boxh">
        <span class="wide">{{ 'admin.translations.cards.box.stats' | translate }}</span>
        <span class="narrow">{{ 'admin.translations.cards.box.board' | translate }}</span>
        <span class="boxh-s">{{ 'admin.translations.cards.box.week' | translate }}</span>
      </h3>
      @if (b) {
        <div class="rank hud-dup">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 3l11 5v9c0 6-5 10-11 12C10 27 5 23 5 17V8z" class="shield" />
            @if (b.week.rank === 1) {
              <path d="M16 10l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" class="star" />
            } @else {
              <path d="M10 12.5l6 4 6-4M10 17.5l6 4 6-4" class="chev" />
            }
          </svg>
          <span>
            <b>{{ 'admin.translations.cards.stats.place' | translate: { place: b.week.rank } }}</b>
            @if (rank(); as r) { <small>{{ r.key! | translate: r.params }}</small> }
          </span>
        </div>
        <ol class="lb" data-test="leaderboard">
          @for (r of rows(); track r.user_id) {
            @let n = name(r);
            <li [class.me]="r.is_me">
              <span class="pl">{{ r.rank }}</span>
              <span class="n">{{ n.key ? (n.key | translate) : n.text }}</span>
              <b>{{ fmt(r.points) }}@if (r.is_me && plus() > 0) { <em class="plus">+{{ plus() }}</em> }</b>
              <span class="bar" aria-hidden="true"><i [style.width.%]="pct(r.points)"></i></span>
            </li>
          }
        </ol>
        <p class="sfoot">{{ 'admin.translations.cards.stats.weekNote' | translate }}</p>
        <div class="streak hud-dup">
          <div class="streak-h">
            <span class="cap">{{ 'admin.translations.cards.stats.streak' | translate }}</span>
            <b>{{ 'admin.translations.cards.stats.days' | translate: { days: b.streak_days } }}</b>
          </div>
          <span class="days">
            @for (d of b.week.days; track d.date; let i = $index) {
              <span [class.on]="d.active" [class.today]="d.today"><i></i><small>{{ 'admin.translations.cards.stats.day' + i | translate }}</small></span>
            }
          </span>
        </div>
      }
    </aside>
  `,
  styles: [
    BOX_STYLES,
    `
      .rank { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .rank svg { flex: none; width: 28px; height: 28px; }
      .shield { fill: color-mix(in srgb, var(--tc-pu) 14%, transparent); stroke: var(--tc-pu); stroke-width: 1.5; }
      .chev { fill: none; stroke: var(--tc-pu-hi); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .star { fill: var(--tc-gold); }
      .rank b { display: block; font-size: 0.875rem; font-weight: 600; line-height: 1.3; color: var(--sc-fg-0); }
      .rank small { display: block; font-size: 0.75rem; line-height: 1.35; color: var(--sc-fg-2); }
      .lb { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      .lb li { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: baseline; column-gap: 8px; row-gap: 5px; font-size: 0.8125rem; color: var(--sc-fg-1); }
      .pl { font-size: 0.75rem; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
      .n { min-width: 0; overflow-wrap: anywhere; }
      .lb b { display: inline-flex; align-items: baseline; gap: 6px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--sc-fg-1); white-space: nowrap; }
      .bar { grid-column: 2 / 4; display: block; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--sc-accent) 8%, transparent); overflow: hidden; }
      .bar i { display: block; height: 100%; background: color-mix(in srgb, var(--tc-pu) 42%, transparent); }
      .me .n { color: var(--sc-accent); font-weight: 600; }
      .me b { font: 700 1.25rem/1.1 var(--sc-font-display, inherit); color: var(--sc-fg-0); }
      .me .bar i { background: var(--sc-accent); }
      .plus { padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--tc-pu) 20%, transparent); color: var(--tc-pu-hi); font: 700 0.72rem/1.2 var(--sc-font-body, inherit); font-style: normal; box-shadow: 0 0 12px color-mix(in srgb, var(--tc-pu) 45%, transparent); }
      .streak { display: grid; gap: 6px; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .streak-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
      .streak-h b { font-size: 0.85rem; font-weight: 600; color: var(--sc-fg-0); }
      .cap { font-size: 0.65rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2); }
      .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; text-align: center; }
      .days > span { display: grid; gap: 3px; }
      .days i { display: block; height: 7px; border-radius: 2px; background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .days small { font-size: 0.625rem; line-height: 1.2; color: var(--sc-fg-2); }
      .days .on i { background: var(--tc-gold); box-shadow: 0 0 6px color-mix(in srgb, var(--tc-gold) 45%, transparent); }
      .days .today small { color: var(--sc-fg-0); font-weight: 600; }
      .days .today:not(.on) i { background: none; border: 1px dashed color-mix(in srgb, var(--tc-gold) 70%, transparent); box-sizing: border-box; }
      @media (max-width: 899px) { .me b { font-size: 1rem; } }
    `,
  ],
})
export class CardsStatsBoxComponent {
  private readonly translate = inject(TranslateService);
  readonly board = input<CardBoard | null>(null);
  /** Points of the last action, shown beside the own row until the next one (U12). */
  readonly plus = input(0);

  /** The top five, and the own row when it is further down. */
  protected readonly rows = computed(() => {
    const all = [...(this.board()?.leaderboard ?? [])].sort((x, y) => x.rank - y.rank);
    const top = all.slice(0, 5);
    const me = all.find((r) => r.is_me);
    return me && !top.includes(me) ? [...top, me] : top;
  });
  protected readonly rank = computed(() => rankLine(this.board()));
  protected readonly name = boardName;
  protected pct(points: number): number {
    return barPct(points, this.board()?.leaderboard ?? []);
  }
  protected fmt(n: number): string {
    return new Intl.NumberFormat(this.translate.getCurrentLang() || 'de').format(n);
  }
}
