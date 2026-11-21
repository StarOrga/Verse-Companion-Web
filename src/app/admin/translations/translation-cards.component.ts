import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  NgZone,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { AnalyticsService } from '../../core/analytics.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import {
  CARD_KEYS,
  CardAction,
  SessionAnswer,
  StageMode,
  canException,
  canOwnText,
  cardErrorKey,
  cardKeyAction,
  chosenText,
  defaultLang,
  finishSummary,
  isJudged,
  needsReload,
  optionCount,
  optionLabel,
  subjectOf,
  swipeAction,
  swipeDirection,
} from './cards/cards.logic';
import { CardsGoalBoxComponent, CardsStatsBoxComponent } from './cards/cards-boxes.component';
import { DuelCardComponent } from './cards/duel-card.component';
import { GoalRingComponent } from './cards/goal-ring.component';
import { VetoCardComponent } from './cards/veto-card.component';
import { CardActionResult, CardBoard, CardDeck, CardGoal, TranslationCard, TranslationsService, VetoList } from './translations.service';

/** How long the moment after an answer stays before the next card turns up by itself (U3 auto-advance). */
export const MOMENT_MS = 1600;
/** Cards per deck (the server's default; the daily goal is ten). */
export const DECK_SIZE = 10;
/** Rough time per card for the cover's estimate („≈ 6 min“ for ten). */
const SECONDS_PER_CARD = 36;
const I18N = 'admin.translations.cards';
const TOUCH = typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches;
const OPEN_DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

type Input = 'tap' | 'key' | 'swipe';

/** The reward moment after a scoring action (U12): the chosen text large, the goal step, the points. */
export interface CardMoment {
  hero: string;
  /** „für „Open““ / „Passt“ — i18n key + params. */
  subKey: string | null;
  subParams?: Record<string, unknown>;
  points: number;
  bonus: number;
  texts: number;
  goal: CardGoal;
}

/**
 * Karteikarten tab as a game (concept 20261121-1151-karteikarten-neu, design „Duell-Karte“, round 5):
 * Box „Tagesziel & Sprachen“ left, the deck in the middle, Box „Statistik“ right; on a phone one column under a
 * slim HUD strip. The deck itself is the start (tap / Enter turns it), a tap on a half answers and the next card
 * comes by itself; ←/→, E, ↑, A, Enter, ? and Ctrl+Z on desktop, swipes on a phone. Undo goes through the app's
 * undo toast and the server's undo RPC. A language the admin does not judge opens as its veto list (P6): the KI's
 * decisions as cards in the same frame. Contract: docs/concepts/20261121-1151-karteikarten-neu/contract.md.
 */
@Component({
  selector: 'sc-translation-cards',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    ScActionDirective,
    ScTooltipDirective,
    ScDialogDirective,
    GoalRingComponent,
    DuelCardComponent,
    VetoCardComponent,
    CardsGoalBoxComponent,
    CardsStatsBoxComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.cards-hot]': '!!moment()' },
  template: `
    @let b = board();
    @let g = goal();
    <div class="table">
      <div class="hud" data-test="hud" [attr.aria-label]="'admin.translations.cards.hud.aria' | translate">
        <sc-goal-ring [small]="true" [done]="g.done" [target]="g.target" [hot]="!!moment()">
          <b class="hring">{{ 'admin.translations.cards.goalShort' | translate: { done: g.done, target: g.target } }}</b>
        </sc-goal-ring>
        <span class="cell"><small>{{ 'admin.translations.cards.hud.points' | translate }}</small>
          <b>{{ fmt(b?.week?.points ?? 0) }}@if (plus() > 0) { <em class="plus">+{{ plus() }}</em> }</b></span>
        <span class="cell"><small>{{ 'admin.translations.cards.hud.place' | translate }}</small><b>{{ b?.week?.rank ?? '–' }}</b></span>
        <span class="cell"><small>{{ 'admin.translations.cards.hud.streak' | translate }}</small>
          <b>{{ 'admin.translations.cards.stats.days' | translate: { days: b?.streak_days ?? 0 } }}</b></span>
      </div>

      <sc-cards-goal-box class="goalbox" [board]="b" [goal]="g" [active]="lang()" [hot]="!!moment()" />

      <div class="centre">
        @if (vetoMode() && veto(); as v) {
          <p class="vhead" data-test="veto-head">
            <b>{{ langName(lang()) }} · {{ (v.unsure > 0 ? 'admin.translations.cards.veto.headUnsure' : 'admin.translations.cards.veto.headAll') | translate: { count: v.total } }}</b>
            · {{ 'admin.translations.cards.veto.headNote' | translate }}
          </p>
        }
        <div class="stage" data-test="stage"
             (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointercancel)="onCancel()">
          @if (error(); as e) {
            <div class="state err" role="alert" data-test="error">
              <p>{{ e | translate }}</p>
              <button type="button" scAction tier="secondary" (click)="reload()">{{ 'admin.translations.retry' | translate }}</button>
            </div>
          } @else if (loading()) {
            <div class="state" role="status">{{ 'admin.translations.loading' | translate }}</div>
          } @else if (vetoMode()) {
            @if (moment(); as m) {
              <div class="deck"><div class="back rest" aria-hidden="true"><span class="bh l"></span><span class="bh r"></span></div></div>
              <ng-container *ngTemplateOutlet="burst; context: { $implicit: m }" />
            } @else if (currentVeto(); as c) {
              <div class="deck" [style.--drag.px]="drag()" [class.dragging]="drag() !== 0">
                <sc-veto-card [card]="c" [lang]="lang()" [index]="pos() + 1" [total]="veto()?.items?.length ?? 1" [busy]="busy()"
                              (wrong)="act({ kind: 'wrong' }, 'tap')" (ok)="act({ kind: 'ok' }, 'tap')" />
              </div>
            } @else {
              <div class="finish" data-test="veto-empty">
                <h2 class="finish-h">{{ 'admin.translations.cards.veto.emptyTitle' | translate: { lang: langName(lang()) } }}</h2>
                <p class="finish-w">{{ 'admin.translations.cards.veto.empty' | translate }}</p>
              </div>
            }
          } @else if (!turned() && deck()?.cards?.length) {
            @let d = deck()!;
            <div class="deck">
              <button type="button" class="back" data-test="cover" aria-keyshortcuts="Enter" (click)="act({ kind: 'turn' }, 'tap')">
                <span class="bh l" aria-hidden="true"></span><span class="bh r" aria-hidden="true"></span>
                <span class="cover">
                  <span class="mono" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 4h10a2 2 0 0 1 2 2v11" /><path d="M5 8h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 15 20H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 8z" /></svg></span>
                  <b>{{ 'admin.translations.cards.cover.title' | translate: { lang: langName(lang()), count: d.cards.length } }}</b>
                  <span class="cover-s" [scTooltip]="'admin.translations.cards.cover.hint' | translate: { open: d.open_total }">
                    {{ 'admin.translations.cards.cover.sub' | translate: { min: minutes(d.cards.length), count: d.deck_affected } }}
                  </span>
                  <span class="cover-go">
                    <span class="desk">{{ 'admin.translations.cards.cover.goKeys' | translate }} <kbd class="kbd">{{ keys.turn }}</kbd></span>
                    <span class="touch">{{ 'admin.translations.cards.cover.goTouch' | translate }}</span>
                  </span>
                </span>
              </button>
            </div>
          } @else if (moment(); as m) {
            <div class="deck">
              @if (current()) {
                <button type="button" class="back rest" aria-keyshortcuts="Enter" [attr.aria-label]="'admin.translations.cards.next' | translate"
                        (click)="act({ kind: 'turn' }, 'tap')">
                  <span class="bh l" aria-hidden="true"></span><span class="bh r" aria-hidden="true"></span>
                </button>
              } @else {
                <div class="back rest" aria-hidden="true"><span class="bh l"></span><span class="bh r"></span></div>
              }
            </div>
            <ng-container *ngTemplateOutlet="burst; context: { $implicit: m }" />
          } @else if (current(); as c) {
            <div class="deck" [style.--drag.px]="drag()" [class.dragging]="drag() !== 0">
              <sc-duel-card [card]="c" [index]="pos() + 1" [total]="deck()?.cards?.length ?? 1" [busy]="busy()"
                            [picked]="lean()" [exceptionLang]="exceptionLang()" [exceptionName]="exceptionLang() ? langName(exceptionLang()!) : ''"
                            (pick)="onPick($event)" />
            </div>
          } @else {
            @let s = summary();
            <div class="finish" data-test="finish">
              <div class="trophy" aria-hidden="true">
                <svg viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="88" class="t-track" /><circle cx="100" cy="100" r="88" class="t-ring" />
                  <g transform="translate(40 40)">
                    <path class="t-rays" d="M60 8v8M60 104v8M8 60h8M104 60h8M24 24l6 6M90 90l6 6M96 24l-6 6M30 90l-6 6" />
                    <path d="M38 30h44v16a22 22 0 0 1-44 0z" class="t-cup" />
                    <path d="M38 34H28a10 10 0 0 0 12 16M82 34h10a10 10 0 0 1-12 16" class="t-handle" />
                    <path d="M54 68h12v12H54z" class="t-stem" /><rect x="44" y="80" width="32" height="8" rx="2" class="t-base" />
                    <path d="M60 36l3 6 6.5 1-4.7 4.6 1.1 6.4-5.9-3.1-5.9 3.1 1.1-6.4-4.7-4.6 6.5-1z" class="t-star" />
                  </g>
                </svg>
              </div>
              <h2 class="finish-h">{{ 'admin.translations.cards.finish.title' | translate: { lang: langName(lang()) } }}</h2>
              @if (s.cards > 0) {
                <p class="finish-s">{{ 'admin.translations.cards.finish.sum' | translate: { cards: s.cards, texts: s.texts } }} · <b>+{{ fmt(s.points) }} {{ 'admin.translations.cards.finish.points' | translate }}</b></p>
                @if (s.bonus > 0) {
                  <p class="finish-p">{{ 'admin.translations.cards.finish.split' | translate: { base: s.base, cards: s.cards, bonus: s.bonus } }}</p>
                }
                <ul class="res" role="list">
                  @for (a of session(); track a.card.id) {
                    <li>
                      <span class="mini" aria-hidden="true"><i [class.on]="a.choice === 'a'"></i><i [class.on]="a.choice !== 'a'"></i></span>
                      <b>{{ resultLabel(a) }}</b>
                      <small>{{ 'admin.translations.cards.textsN' | translate: { count: resultTexts(a) } }}</small>
                    </li>
                  }
                </ul>
              } @else {
                <p class="finish-s">{{ 'admin.translations.cards.finish.none' | translate }}</p>
              }
              <p class="finish-w">{{ 'admin.translations.cards.finish.when' | translate }}
                @if (rest() > 0) { {{ 'admin.translations.cards.finish.rest' | translate: { count: rest() } }} }
              </p>
            </div>
          }
        </div>

        @if (!error() && !loading()) {
          @let m = mode();
          @if (m === 'card' || m === 'moment') {
            @let c = current();
            <div class="acts" [class.hold]="m === 'moment'">
              @if (c && canOwn(c)) {
                <button type="button" scAction tier="secondary" class="quiet" data-test="act-own" aria-keyshortcuts="E" [disabled]="busy()" (click)="act({ kind: 'own' }, 'tap')">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
                  {{ 'admin.translations.cards.own.both' | translate }} <kbd class="kbd desk" aria-hidden="true">{{ keys.own }}</kbd>
                </button>
              }
              <button type="button" scAction tier="secondary" class="quiet" data-test="act-notmine" aria-keyshortcuts="ArrowUp" [disabled]="busy() || !c" (click)="act({ kind: 'notMine' }, 'tap')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7" /></svg>
                {{ 'admin.translations.cards.notMine' | translate }} <kbd class="kbd desk" aria-hidden="true">{{ keys.notMine }}</kbd>
              </button>
              @if (c && canExc(c)) {
                <button type="button" scAction tier="secondary" class="quiet" data-test="act-exception" aria-keyshortcuts="A" [disabled]="busy()" (click)="act({ kind: 'exception' }, 'tap')">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18" /></svg>
                  {{ 'admin.translations.cards.exception.action' | translate }} <kbd class="kbd desk" aria-hidden="true">{{ keys.exception }}</kbd>
                </button>
              }
            </div>
            @if (c) {
              @let la = optionLabel(c, 'a');
              @let lb = optionLabel(c, 'b');
              <p class="swipe touch">
                <span>{{ 'admin.translations.cards.swipe.left' | translate: { label: la.key ? (la.key | translate) : la.text } }}</span>
                <span>{{ 'admin.translations.cards.swipe.right' | translate: { label: lb.key ? (lb.key | translate) : lb.text } }}</span>
                <span>{{ 'admin.translations.cards.swipe.up' | translate }}</span>
              </p>
            }
          } @else if (m === 'veto') {
            <div class="acts">
              <button type="button" scAction tier="secondary" class="quiet" data-test="act-own" aria-keyshortcuts="E" [disabled]="busy()" (click)="act({ kind: 'own' }, 'tap')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
                {{ 'admin.translations.cards.own.short' | translate }} <kbd class="kbd desk" aria-hidden="true">{{ keys.own }}</kbd>
              </button>
              <button type="button" scAction tier="secondary" data-test="act-accept-all" [disabled]="busy()" (click)="acceptAll()">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                {{ 'admin.translations.cards.veto.acceptAll' | translate }}
              </button>
            </div>
            <p class="swipe touch">
              <span>{{ 'admin.translations.cards.swipe.left' | translate: { label: ('admin.translations.cards.veto.wrong' | translate) } }}</span>
              <span>{{ 'admin.translations.cards.swipe.right' | translate: { label: ('admin.translations.cards.veto.ok' | translate) } }}</span>
            </p>
          }
          @if (flash(); as f) {
            <p class="flash" role="alert" data-test="flash">{{ f | translate }}</p>
          }
        }
      </div>

      <sc-cards-stats-box class="statsbox" [board]="b" [plus]="plus()" />
    </div>

    <ng-template #burst let-m>
      <div class="burst" role="status" data-test="moment">
        <span class="burst-hero"><b>{{ 'admin.translations.cards.quoted' | translate: { text: m.hero } }}</b>
          @if (m.subKey) { <small>{{ m.subKey | translate: m.subParams }}</small> }</span>
        <span class="burst-goal">
          <svg viewBox="0 0 300 110" aria-hidden="true">
            <g class="rays"><path d="M150 2v14M150 94v14M10 55h22M268 55h22M44 14l16 10M256 14l-16 10M44 96l16-10M256 96l-16-10" /></g>
            <ellipse cx="150" cy="55" rx="126" ry="40" class="orbit" />
          </svg>
          <b><span class="pip" aria-hidden="true"></span>{{ 'admin.translations.cards.goalStep' | translate: { done: m.goal.done, target: m.goal.target } }}</b>
        </span>
        <span class="burst-meta"><b>{{ 'admin.translations.cards.plusPoints' | translate: { points: m.points } }}</b>
          @if (m.bonus > 0) { · <b>{{ 'admin.translations.cards.plusBonus' | translate: { points: m.bonus } }}</b> }
          @if (m.texts > 0) { · {{ 'admin.translations.cards.unified' | translate: { count: m.texts } }} }</span>
      </div>
    </ng-template>

    @if (sheet() === 'keys') {
      <div class="scrim" aria-hidden="true"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="cards-keys-h" scDialog (scDialogEscape)="sheet.set(null)" data-test="keys-sheet">
        <header class="sheet-h">
          <h2 id="cards-keys-h">{{ 'admin.translations.cards.keys.title' | translate }}</h2>
          <button type="button" scAction tier="tertiary" [attr.aria-label]="'common.dialog.close' | translate" [scTooltip]="'common.dialog.close' | translate" (click)="sheet.set(null)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <dl class="keylist">
          @for (k of keyRows; track k.label) {
            <dt><kbd class="kbd">{{ k.cap }}</kbd></dt><dd>{{ k.label | translate }}</dd>
          }
        </dl>
      </section>
    }
    @if (sheet() === 'exception' && current(); as c) {
      <div class="scrim" aria-hidden="true"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="cards-exc-h" scDialog (scDialogEscape)="sheet.set(null)" data-test="exception-sheet">
        <header class="sheet-h">
          <h2 id="cards-exc-h">{{ 'admin.translations.cards.exception.title' | translate }}</h2>
          <button type="button" scAction tier="tertiary" [attr.aria-label]="'common.dialog.close' | translate" [scTooltip]="'common.dialog.close' | translate" (click)="sheet.set(null)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <p class="sheet-p">{{ 'admin.translations.cards.exception.text' | translate }}</p>
        <div class="sheet-langs">
          @for (l of c.langs; track l) {
            <button type="button" scAction tier="secondary" [attr.data-test]="'exc-' + l" [attr.aria-pressed]="exceptionLang() === l" (click)="setException(l)">{{ langName(l) }}</button>
          }
          @if (exceptionLang()) {
            <button type="button" scAction tier="secondary" data-test="exc-none" (click)="setException(null)">{{ 'admin.translations.cards.exception.none' | translate }}</button>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      :host {
        --tc-pu: #b79cf0; --tc-pu-hi: #e2d8ff; --tc-gold: #e8c96b;
        display: block; margin-top: var(--sc-space-4, 16px);
      }
      .table { display: grid; grid-template-columns: 236px minmax(0, 1fr) 236px; gap: 28px; align-items: start; }
      .centre { min-width: 0; }
      .hud { display: none; }
      @media (max-width: 1180px) { .table { grid-template-columns: 208px minmax(0, 1fr) 208px; gap: 20px; } }
      @media (max-width: 899px) {
        .table { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
        .hud, .centre { grid-column: 1 / -1; }
        .hud { order: 0; display: grid; grid-template-columns: 52px repeat(3, minmax(0, 1fr)); align-items: center; gap: 10px; padding: 8px 12px;
          border: 1px solid color-mix(in srgb, var(--tc-pu) 22%, transparent); border-radius: 14px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-1) 70%, transparent), color-mix(in srgb, var(--sc-bg-0) 70%, transparent)); }
        .centre { order: 1; }
        .goalbox { order: 2; }
        .statsbox { order: 3; }
      }
      @media (max-width: 599px) { .table { grid-template-columns: minmax(0, 1fr); } }
      .hring { font: 700 0.75rem/1 var(--sc-font-display, inherit); color: var(--sc-fg-0); white-space: nowrap; }
      .cell { display: grid; gap: 1px; min-width: 0; }
      .cell small { font-size: 0.6rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
      .cell b { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 5px; font-size: 0.875rem; font-weight: 600; line-height: 1.2; color: var(--sc-fg-0); min-width: 0; overflow-wrap: anywhere; }
      .plus { padding: 1px 5px; border-radius: 999px; background: color-mix(in srgb, var(--tc-pu) 20%, transparent); color: var(--tc-pu-hi); font: 700 0.65rem/1.2 var(--sc-font-body, inherit); font-style: normal; }

      .vhead { margin: 2px 0 8px; font-size: 0.8125rem; line-height: 1.4; color: var(--sc-fg-2); text-align: center; overflow-wrap: anywhere; }
      .vhead b { font: 600 0.85rem/1.4 var(--sc-font-display, inherit); letter-spacing: 0.04em; color: var(--sc-fg-0); }
      .stage { position: relative; min-height: 380px; display: grid; place-items: center; padding: 6px 0 18px; }
      .state { display: grid; gap: var(--sc-space-3, 12px); justify-items: center; text-align: center; color: var(--sc-fg-1); }
      .state.err p { margin: 0; color: var(--sc-fg-0); }

      .deck { position: relative; width: min(520px, 100%); touch-action: none; }
      .deck::before, .deck::after {
        content: ''; position: absolute; inset: 0; border: 1px solid color-mix(in srgb, var(--sc-accent) 14%, transparent); border-radius: 18px;
        background: linear-gradient(170deg, var(--sc-bg-1), var(--sc-bg-0));
      }
      .deck::before { transform: translateY(18px) scale(0.93); opacity: 0.35; }
      .deck::after { transform: translateY(9px) scale(0.965); opacity: 0.6; }
      .deck > * { position: relative; z-index: 1; display: block; }
      .deck.dragging > * { transform: translateX(var(--drag, 0px)) rotate(calc(var(--drag, 0px) / 40)); }

      .back {
        position: relative; z-index: 1; display: grid; place-items: center; align-content: center; width: 100%; min-height: 340px; margin: 0; padding: 0;
        overflow: hidden; cursor: pointer; border: 1px solid color-mix(in srgb, var(--sc-accent) 22%, transparent); border-radius: 18px;
        background: linear-gradient(170deg, color-mix(in srgb, var(--sc-bg-1) 92%, var(--sc-accent) 8%), var(--sc-bg-0)); color: var(--sc-fg-0); font: inherit;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.42);
      }
      .back:hover { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      .back:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
      .back.rest { min-height: 330px; cursor: pointer; }
      div.back.rest { cursor: default; }
      .bh { position: absolute; top: 0; bottom: 0; width: 50%; }
      .bh.l { left: 0; background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--sc-accent) 5%, transparent) 0 2px, transparent 2px 14px); }
      .bh.r { right: 0; border-left: 1px solid color-mix(in srgb, var(--tc-pu) 28%, transparent); background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--tc-pu) 6%, transparent) 0 2px, transparent 2px 14px); }
      .cover { position: relative; display: grid; justify-items: center; gap: 6px; max-width: calc(100% - 32px); box-sizing: border-box; padding: 22px 30px; border-radius: 16px; background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent); text-align: center; }
      .mono { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 6px; border: 1.5px solid color-mix(in srgb, var(--tc-pu) 55%, transparent); border-radius: 50%; color: var(--tc-pu-hi); box-shadow: 0 0 24px color-mix(in srgb, var(--tc-pu) 25%, transparent); }
      .mono svg { width: 30px; height: 30px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
      .cover b { font: 700 1.375rem/1.25 var(--sc-font-display, inherit); letter-spacing: 0.04em; overflow-wrap: anywhere; }
      .cover-s { font-size: 0.8125rem; color: var(--sc-fg-2); }
      .cover-go { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 0.78rem; color: var(--sc-accent); }

      .burst { position: absolute; left: 50%; top: 50%; z-index: 6; display: grid; justify-items: center; gap: 6px; width: min(440px, 100%); transform: translate(-50%, -50%); text-align: center; pointer-events: none; }
      .burst::before { content: ''; position: absolute; left: 50%; top: 50%; z-index: -1; width: 100%; height: 300px; transform: translate(-50%, -50%); border-radius: 50%;
        background: radial-gradient(closest-side, color-mix(in srgb, var(--sc-bg-0) 94%, transparent), color-mix(in srgb, var(--sc-bg-0) 80%, transparent) 55%, transparent); }
      .burst-hero { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 2px 10px; max-width: 100%; }
      .burst-hero b { font: 800 2.25rem/1.3 var(--sc-font-body, inherit); color: var(--sc-fg-0); text-shadow: 0 0 20px color-mix(in srgb, var(--sc-success) 45%, transparent); overflow-wrap: anywhere; min-width: 0; }
      .burst-hero small { font-size: 0.875rem; color: var(--sc-fg-1); overflow-wrap: anywhere; }
      .burst-goal { position: relative; display: grid; place-items: center; width: min(300px, 100%); height: 110px; }
      .burst-goal svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .rays { stroke: var(--tc-pu-hi); stroke-width: 3; stroke-linecap: round; opacity: 0.7; }
      .orbit { fill: none; stroke: color-mix(in srgb, var(--tc-pu) 50%, transparent); stroke-width: 2; stroke-dasharray: 4 7; }
      .burst-goal b {
        position: relative; display: inline-flex; align-items: center; gap: 12px; padding: 10px 22px; border-radius: 999px;
        background: linear-gradient(90deg, #7c5cd6, var(--tc-pu) 60%, var(--tc-pu-hi)); color: #0d1630;
        font: 800 1.3rem/1 var(--sc-font-display, inherit); letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap;
        box-shadow: 0 0 40px color-mix(in srgb, var(--tc-pu) 80%, transparent), 0 0 0 4px color-mix(in srgb, var(--tc-pu-hi) 22%, transparent);
        animation: step-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) both;
      }
      .pip { display: block; width: 13px; height: 13px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px rgba(13, 22, 48, 0.35), 0 0 10px #fff; }
      .burst-meta { font-size: 0.8125rem; color: var(--sc-fg-2); }
      .burst-meta b { font-weight: 700; color: var(--tc-pu-hi); }
      @keyframes step-in { from { transform: scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }

      .acts { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px 10px; margin-top: 6px; }
      .acts.hold { visibility: hidden; }
      .acts button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .acts button.quiet { border-color: var(--sc-border); color: var(--sc-fg-1); background: transparent; }
      .acts button { max-width: 100%; white-space: normal; text-align: center; }
      .swipe { display: none; flex-wrap: wrap; justify-content: center; gap: 4px 14px; margin: 10px 0 0; color: var(--sc-fg-2); font-size: 0.75rem; text-align: center; }
      .flash { margin: var(--sc-space-3, 12px) 0 0; color: var(--sc-danger); text-align: center; }

      .finish { display: grid; justify-items: center; gap: 8px; width: 100%; text-align: center; }
      .trophy { width: 124px; height: 124px; filter: drop-shadow(0 0 18px color-mix(in srgb, var(--tc-gold) 35%, transparent)); }
      .trophy svg { display: block; width: 100%; height: 100%; }
      .t-track { fill: none; stroke: color-mix(in srgb, var(--tc-gold) 18%, transparent); stroke-width: 10; }
      .t-ring { fill: none; stroke: var(--tc-gold); stroke-width: 10; }
      .t-rays { stroke: var(--tc-gold); stroke-opacity: 0.5; stroke-width: 2; stroke-linecap: round; }
      .t-cup { fill: #c8a84b; } .t-handle { fill: none; stroke: #c8a84b; stroke-width: 4; } .t-stem { fill: #a88c3a; } .t-base { fill: var(--tc-gold); } .t-star { fill: #fff3cf; }
      .finish-h { margin: 0; font: 700 1.3rem/1.25 var(--sc-font-display, inherit); letter-spacing: 0.03em; overflow-wrap: anywhere; }
      .finish-s { margin: 0; font-size: 0.85rem; color: var(--sc-fg-1); }
      .finish-s b { color: var(--tc-gold); font-weight: 600; }
      .finish-p { margin: 0; font-size: 0.78rem; color: var(--sc-fg-2); }
      .finish-w { margin: 0; max-width: 540px; font-size: 0.78rem; color: var(--sc-fg-2); }
      .res { list-style: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 6px 0; padding: 0; }
      .res li { display: grid; justify-items: center; gap: 3px; width: 104px; text-align: center; }
      .res b { font-size: 0.78rem; line-height: 1.3; font-weight: 600; color: var(--sc-fg-1); overflow-wrap: anywhere; max-width: 100%; }
      .res small { font-size: 0.72rem; color: var(--sc-fg-2); }
      .mini { display: grid; grid-template-columns: 1fr 1fr; width: 72px; height: 46px; padding: 4px; gap: 4px; box-sizing: border-box; border: 1px solid color-mix(in srgb, var(--sc-accent) 24%, transparent); border-radius: 9px; background: linear-gradient(170deg, var(--sc-bg-1), var(--sc-bg-0)); }
      .mini i { display: block; border-radius: 5px; background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .mini i.on { background: color-mix(in srgb, var(--sc-success) 30%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-success) 70%, transparent); }

      .kbd {
        display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); border-radius: 4px; background: var(--sc-sub-kbd);
        color: var(--sc-fg-1); font: 600 0.65rem/1 var(--font-monospace, ui-monospace, monospace); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
      }
      .touch { display: none; }
      @media (hover: none), (pointer: coarse) {
        .desk { display: none !important; }
        .touch { display: inline; }
        p.swipe.touch { display: flex; }
      }

      .scrim { position: fixed; inset: 0; z-index: 40; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); }
      .sheet {
        position: fixed; z-index: 41; left: 50%; top: 50%; translate: -50% -50%; width: min(420px, calc(100vw - 32px)); max-height: 80vh; max-height: 80dvh; overflow: auto;
        box-sizing: border-box; padding: 16px 18px 18px; border: 1px solid var(--sc-border); border-radius: 14px; background: var(--sc-bg-1); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
      }
      .sheet-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .sheet-h h2 { margin: 0; font-size: 1rem; }
      .sheet-h svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      .sheet-p { margin: 0 0 12px; color: var(--sc-fg-1); font-size: 0.875rem; }
      .sheet-langs { display: flex; flex-wrap: wrap; gap: 8px; }
      .keylist { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 14px; margin: 0; align-items: center; }
      .keylist dd { margin: 0; color: var(--sc-fg-1); font-size: 0.875rem; }

      @media (max-width: 520px) {
        .stage { min-height: 0; padding: 6px 0 14px; }
        .back { min-height: 300px; }
        .back.rest { min-height: 300px; }
        .cover { padding: 18px; }
        .burst-hero b { font-size: 1.875rem; }
        .burst-goal { height: 96px; }
        .burst-goal b { font-size: 1.05rem; padding: 9px 16px; gap: 8px; }
        .trophy { width: 100px; height: 100px; }
        .finish-h { font-size: 1.125rem; }
        .res li { width: 96px; }
      }
      @media (prefers-reduced-motion: reduce) { .burst-goal b { animation: none; } .deck.dragging > * { transform: none; } }
    `,
  ],
})
export class TranslationCardsComponent {
  private readonly svc = inject(TranslationsService);
  private readonly route = inject(ActivatedRoute);
  private readonly undoToast = inject(UndoToastService);
  private readonly confirmSvc = inject(ScConfirmService);
  private readonly analytics = inject(AnalyticsService);
  private readonly translate = inject(TranslateService);
  private readonly zone = inject(NgZone);

  protected readonly keys = CARD_KEYS;
  protected readonly optionLabel = optionLabel;
  protected readonly canOwn = canOwnText;
  protected readonly canExc = canException;
  protected readonly keyRows = [
    { cap: `${CARD_KEYS.left} ${CARD_KEYS.right}`, label: `${I18N}.keys.pick` },
    { cap: CARD_KEYS.own, label: `${I18N}.keys.own` },
    { cap: CARD_KEYS.notMine, label: `${I18N}.keys.notMine` },
    { cap: CARD_KEYS.exception, label: `${I18N}.keys.exception` },
    { cap: CARD_KEYS.turn, label: `${I18N}.keys.turn` },
    { cap: CARD_KEYS.undo, label: `${I18N}.keys.undo` },
    { cap: CARD_KEYS.keys, label: `${I18N}.keys.sheet` },
  ];

  readonly board = signal<CardBoard | null>(null);
  readonly goal = signal<CardGoal>({ done: 0, target: 10, full: false, bonus_taken: false });
  /** Points of the last scoring action, beside the own row and in the HUD until the next action. */
  readonly plus = signal(0);
  private readonly queryLang = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('lang'))), { initialValue: null });
  readonly lang = computed(() => defaultLang(this.board(), this.queryLang()));
  readonly vetoMode = computed(() => !isJudged(this.board(), this.lang()));

  readonly deck = signal<CardDeck | null>(null);
  readonly veto = signal<VetoList | null>(null);
  readonly pos = signal(0);
  readonly turned = signal(false);
  readonly moment = signal<CardMoment | null>(null);
  readonly session = signal<SessionAnswer[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly flash = signal<string | null>(null);
  readonly busy = signal(false);
  readonly sheet = signal<'keys' | 'exception' | null>(null);
  readonly exceptionLang = signal<string | null>(null);
  /** Horizontal drag of a swipe in progress (px); the card follows the finger. */
  readonly drag = signal(0);

  readonly current = computed<TranslationCard | null>(() => (this.vetoMode() ? null : (this.deck()?.cards[this.pos()] ?? null)));
  readonly currentVeto = computed<TranslationCard | null>(() => (this.vetoMode() ? (this.veto()?.items[this.pos()] ?? null) : null));
  /** The half a swipe leans to, lit while the finger is down. */
  readonly lean = computed<'a' | 'b' | null>(() => (this.drag() <= -30 ? 'a' : this.drag() >= 30 ? 'b' : null));
  readonly mode = computed<StageMode>(() => {
    if (this.error() || this.loading()) return 'idle';
    if (this.moment()) return 'moment';
    if (this.vetoMode()) return this.currentVeto() ? 'veto' : 'idle';
    const d = this.deck();
    if (!d) return 'idle';
    if (!this.turned() && d.cards.length) return 'cover';
    return this.current() ? 'card' : 'idle';
  });
  readonly summary = computed(() => finishSummary(this.session()));
  /** Open cards beyond this deck, re-checked by the next learn pass. */
  readonly rest = computed(() => Math.max(0, (this.deck()?.open_total ?? 0) - (this.deck()?.cards.length ?? 0)));

  private seq = 0;
  private momentTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUndoable: string | null = null;
  private finishTracked = false;
  private undoVia: 'toast' | 'key' = 'toast';
  private swipe: { id: number; x: number; y: number } | null = null;
  private swiped = false;

  constructor() {
    void this.loadBoard();
    // A language change (row click, deep link, back button) loads that language's deck or veto list.
    effect(() => {
      const lang = this.lang();
      const veto = this.vetoMode();
      untracked(() => void this.loadLang(lang, veto));
    });
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  // ── loading ──────────────────────────────────────────────────────────────

  async loadBoard(): Promise<void> {
    try {
      const b = await this.svc.cardBoard();
      this.board.set(b);
      this.goal.set(b.goal);
    } catch (e) {
      this.error.set(cardErrorKey('board', e));
    }
  }

  async loadLang(lang: string, veto: boolean): Promise<void> {
    const mine = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    this.flash.set(null);
    this.clearTimer();
    this.moment.set(null);
    this.pos.set(0);
    this.turned.set(false);
    this.session.set([]);
    this.exceptionLang.set(null);
    this.finishTracked = false;
    try {
      if (veto) {
        const v = await this.svc.vetoList(lang);
        if (mine !== this.seq) return;
        this.veto.set(v);
        this.deck.set(null);
      } else {
        const d = await this.svc.deck(lang, DECK_SIZE);
        if (mine !== this.seq) return;
        this.deck.set(d);
        this.veto.set(null);
      }
    } catch (e) {
      if (mine !== this.seq) return;
      this.error.set(cardErrorKey(veto ? 'veto-load' : 'deck-load', e));
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }

  reload(): void {
    this.error.set(null);
    void this.loadBoard();
    void this.loadLang(this.lang(), this.vetoMode());
  }

  /** Board numbers after an action, quietly: the local update already shows the step. */
  private async refreshBoard(): Promise<void> {
    try {
      const b = await this.svc.cardBoard();
      this.board.set(b);
      this.goal.set(b.goal);
    } catch {
      /* the boxes keep the locally updated numbers; the next load corrects them */
    }
  }

  // ── input ────────────────────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const action = cardKeyAction(e, this.mode(), this.sheet() !== null || dialogOpen());
    if (!action) return;
    e.preventDefault();
    this.act(action, 'key');
  }

  onPick(side: 'a' | 'b'): void {
    if (this.swiped) {
      this.swiped = false;
      return;
    }
    this.act({ kind: 'pick', choice: side }, 'tap');
  }

  onDown(e: PointerEvent): void {
    this.swiped = false;
    if (e.pointerType === 'mouse' || (this.mode() !== 'card' && this.mode() !== 'veto')) return;
    this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  onMove(e: PointerEvent): void {
    if (!this.swipe || e.pointerId !== this.swipe.id) return;
    const dx = e.clientX - this.swipe.x;
    this.drag.set(Math.max(-120, Math.min(120, dx)));
  }

  onUp(e: PointerEvent): void {
    const s = this.swipe;
    this.swipe = null;
    this.drag.set(0);
    if (!s || e.pointerId !== s.id) return;
    const action = swipeAction(swipeDirection(e.clientX - s.x, e.clientY - s.y), this.mode());
    if (!action) return;
    this.swiped = true;
    this.act(action, 'swipe');
  }

  onCancel(): void {
    this.swipe = null;
    this.drag.set(0);
  }

  act(a: CardAction, input: Input): void {
    switch (a.kind) {
      case 'turn':
        this.turn();
        return;
      case 'pick':
        void this.answer(a.choice, input);
        return;
      case 'own':
        void this.ownText(input);
        return;
      case 'notMine':
        void this.notMine(input);
        return;
      case 'exception':
        if (this.current() && canException(this.current()!)) this.sheet.set('exception');
        return;
      case 'wrong':
      case 'ok':
        void this.judgeKi(a.kind, input);
        return;
      case 'undo':
        this.undoLast();
        return;
      case 'keys':
        this.sheet.set('keys');
        return;
    }
  }

  // ── deck ─────────────────────────────────────────────────────────────────

  turn(): void {
    if (this.moment()) {
      this.endMoment();
      return;
    }
    if (this.turned() || this.vetoMode()) return;
    const d = this.deck();
    if (!d?.cards.length) return;
    this.turned.set(true);
    this.analytics.track('admin:translation_deck_start', { lang: this.lang(), cards: d.cards.length });
  }

  async answer(choice: 'a' | 'b', input: Input): Promise<void> {
    const c = this.current();
    if (!c || this.busy() || this.mode() !== 'card') return;
    const x = this.exceptionLang();
    const exceptions = x && c.kind === 'convention' ? { [x]: choice === 'a' ? ('b' as const) : ('a' as const) } : null;
    await this.score(c, 'answer', () => this.svc.answerCard(c.id, { answer: choice, exceptions }), (r) => {
      this.record(c, r, choice, this.heroText(c, choice));
      this.analytics.track('admin:translation_card_submit', { kind: c.kind, choice, exception: !!exceptions, input });
    });
  }

  async ownText(input: Input): Promise<void> {
    const veto = this.vetoMode();
    const c = veto ? this.currentVeto() : this.current();
    if (!c || this.busy() || (!veto && !canOwnText(c))) return;
    const subject = subjectOf(c);
    const text = await this.confirmSvc.prompt({
      titleKey: `${I18N}.own.title`,
      messageKey: subject ? `${I18N}.own.text` : undefined,
      params: { en: subject ?? '' },
      inputLabelKey: `${I18N}.own.label`,
      inputMaxLength: 500,
      initialValue: veto ? (c.ai?.text ?? '') : '',
      confirmKey: `${I18N}.own.confirm`,
    });
    const own = (text ?? '').trim();
    if (!own) return;
    await this.score(c, 'own', () => this.svc.answerCard(c.id, { answer: 'own', own_text: own }), (r) => {
      this.record(c, r, 'own', own);
      if (veto) this.analytics.track('admin:translation_veto_submit', { verdict: 'own', unsure: !!c.ai?.unsure, input });
      else this.analytics.track('admin:translation_card_submit', { kind: c.kind, choice: 'own', exception: false, input });
    });
  }

  async notMine(input: Input): Promise<void> {
    const c = this.current();
    if (!c || this.busy() || this.mode() !== 'card') return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      const r = await this.svc.notMineCard(c.id);
      this.goal.set(r.goal);
      this.plus.set(0);
      this.exceptionLang.set(null);
      this.pos.update((p) => p + 1);
      this.offerUndo(r.card, `${I18N}.undo.notMine`, { text: this.cardTitle(c) }, null);
      this.analytics.track('admin:translation_card_release', { kind: c.kind, input });
      this.checkFinished();
      void this.refreshBoard();
    } catch (e) {
      this.fail('not-mine', e);
    } finally {
      this.busy.set(false);
    }
  }

  setException(lang: string | null): void {
    this.exceptionLang.set(lang);
    this.sheet.set(null);
  }

  // ── KI decisions (veto list) ─────────────────────────────────────────────

  async judgeKi(verdict: 'wrong' | 'ok', input: Input): Promise<void> {
    const c = this.currentVeto();
    if (!c || this.busy() || this.mode() !== 'veto') return;
    const call = verdict === 'wrong' ? () => this.svc.vetoDecision(c.id) : () => this.svc.acceptDecision(c.id);
    await this.score(c, verdict === 'wrong' ? 'veto' : 'accept', call, (r) => {
      this.record(c, r, c.ai?.choice ?? 'own', c.ai?.text ?? '', verdict);
      this.analytics.track('admin:translation_veto_submit', { verdict, unsure: !!c.ai?.unsure, input });
    });
  }

  async acceptAll(): Promise<void> {
    const v = this.veto();
    if (!v || this.busy()) return;
    const left = Math.max(0, v.items.length - this.pos());
    const ok = await this.confirmSvc.confirm({
      titleKey: `${I18N}.veto.acceptAllTitle`,
      messageKey: `${I18N}.veto.acceptAllText`,
      params: { count: left, lang: this.langName(this.lang()) },
      confirmKey: `${I18N}.veto.acceptAll`,
    });
    if (!ok) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      await this.svc.acceptDecisions(this.lang());
      this.analytics.track('admin:translation_veto_submit', { verdict: 'all', unsure: false, input: 'tap' });
      await Promise.all([this.loadLang(this.lang(), true), this.refreshBoard()]);
    } catch (e) {
      this.fail('accept-all', e);
    } finally {
      this.busy.set(false);
    }
  }

  // ── scoring, moment, undo ────────────────────────────────────────────────

  private async score(c: TranslationCard, op: string, call: () => Promise<CardActionResult>, done: (r: CardActionResult) => void): Promise<void> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      done(await call());
      void this.refreshBoard();
    } catch (e) {
      this.fail(op, e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Local state after a scoring action: goal step, points, moment, next card, undo offer. */
  private record(c: TranslationCard, r: CardActionResult, choice: 'a' | 'b' | 'own', text: string, verdict?: 'wrong' | 'ok'): void {
    const gained = (r.points ?? 0) + (r.bonus ?? 0);
    this.goal.set(r.goal);
    this.plus.set(gained);
    this.board.update((b) =>
      b
        ? {
            ...b,
            goal: r.goal,
            week: { ...b.week, points: b.week.points + gained },
            leaderboard: b.leaderboard.map((x) => (x.is_me ? { ...x, points: x.points + gained } : x)),
          }
        : b,
    );
    const texts = choice === 'own' ? c.spread : optionCount(c, choice);
    if (!verdict) this.session.update((s) => [...s, { card: c, choice, text, points: r.points ?? 0, bonus: r.bonus ?? 0 }]);
    const subject = subjectOf(c);
    this.moment.set({
      hero: text,
      subKey: verdict ? `${I18N}.veto.${verdict}` : subject ? `${I18N}.forSubject` : null,
      subParams: subject ? { en: subject } : undefined,
      points: r.points ?? 0,
      bonus: r.bonus ?? 0,
      texts: verdict ? 0 : texts,
      goal: r.goal,
    });
    this.exceptionLang.set(null);
    this.pos.update((p) => p + 1);
    const msg = verdict ? `${I18N}.undo.${verdict}` : subject ? `${I18N}.undo.answered` : `${I18N}.undo.answeredRule`;
    this.offerUndo(r.card ?? c, msg, { text, en: subject ?? '' }, verdict ? null : texts);
    this.armMoment();
  }

  private armMoment(): void {
    this.clearTimer();
    this.zone.runOutsideAngular(() => {
      this.momentTimer = setTimeout(() => this.zone.run(() => this.endMoment()), MOMENT_MS);
    });
  }

  endMoment(): void {
    this.clearTimer();
    if (!this.moment()) return;
    this.moment.set(null);
    this.checkFinished();
  }

  private checkFinished(): void {
    const d = this.deck();
    if (this.vetoMode() || !d || this.pos() < d.cards.length || this.moment() || this.finishTracked) return;
    this.finishTracked = true;
    this.analytics.track('admin:translation_deck_finish', { lang: this.lang(), cards: this.session().length, points: this.summary().points });
  }

  private clearTimer(): void {
    if (this.momentTimer !== null) {
      clearTimeout(this.momentTimer);
      this.momentTimer = null;
    }
  }

  private offerUndo(card: TranslationCard, messageKey: string, params: Record<string, unknown>, texts: number | null): void {
    this.lastUndoable = card.id;
    this.undoToast.offer({
      messageKey,
      messageParams: params,
      // „auch mit Strg+Z“ only where there is a keyboard to press it on.
      detailKey: texts !== null ? `${I18N}.undo.${TOUCH ? 'detailTouch' : 'detail'}` : TOUCH ? undefined : `${I18N}.undo.detailShort`,
      detailParams: { count: texts ?? 0 },
      // The write already happened (the server scores it at once); undo is the server's undo RPC (P13).
      commit: () => undefined,
      onUndo: () => void this.undo(card.id, this.undoVia),
    });
  }

  /** Ctrl/⌘+Z: the open toast's undo, else the last action that can still be undone. */
  undoLast(): void {
    const t = this.undoToast.current();
    if (t && t.messageKey.startsWith(`${I18N}.undo.`)) {
      this.undoVia = 'key';
      this.undoToast.undo();
      this.undoVia = 'toast';
      return;
    }
    if (this.lastUndoable) void this.undo(this.lastUndoable, 'key');
  }

  async undo(id: string, via: 'toast' | 'key'): Promise<void> {
    this.lastUndoable = null;
    this.busy.set(true);
    this.flash.set(null);
    try {
      const r = await this.svc.undoCard(id);
      this.clearTimer();
      this.moment.set(null);
      this.goal.set(r.goal);
      this.plus.set(0);
      const list = this.vetoMode() ? this.veto()?.items : this.deck()?.cards;
      const idx = list?.findIndex((x) => x.id === id) ?? -1;
      if (idx >= 0) {
        if (this.vetoMode()) this.veto.update((v) => (v ? { ...v, items: v.items.map((x, i) => (i === idx ? r.card : x)) } : v));
        else this.deck.update((d) => (d ? { ...d, cards: d.cards.map((x, i) => (i === idx ? r.card : x)) } : d));
        this.pos.set(idx);
        this.turned.set(true);
      }
      this.session.update((s) => s.filter((x) => x.card.id !== id));
      this.finishTracked = false;
      this.analytics.track('admin:translation_answer_remove', { via });
      void this.refreshBoard();
    } catch (e) {
      this.fail('undo', e);
    } finally {
      this.busy.set(false);
    }
  }

  private fail(op: string, e: unknown): void {
    const key = cardErrorKey(op, e);
    this.flash.set(key);
    if (needsReload(key)) {
      void this.refreshBoard();
      void this.loadLang(this.lang(), this.vetoMode()).then(() => this.flash.set(key));
    }
  }

  // ── view helpers ─────────────────────────────────────────────────────────

  /** What an answer is called in the moment and the toast: a convention by its rule („Normal“), else the chosen text. */
  heroText(c: TranslationCard, choice: 'a' | 'b'): string {
    const l = optionLabel(c, choice);
    return l.key ? (this.translate.instant(l.key) as string) : chosenText(c, choice);
  }

  langName(code: string): string {
    const key = `${I18N}.langNames.${code}`;
    const t = this.translate.instant(key) as string;
    return t && t !== key ? t : code.toUpperCase();
  }

  minutes(cards: number): number {
    return Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
  }

  fmt(n: number): string {
    return new Intl.NumberFormat(this.translate.getCurrentLang() || 'de').format(n);
  }

  /** A card's one-line title for the toast and the result tiles: the English term / line, else the rule. */
  private cardTitle(c: TranslationCard): string {
    const s = subjectOf(c);
    if (s) return s;
    const label = optionLabel(c, 'a');
    return label.key ? (this.translate.instant(`${I18N}.q.short`) as string) : (label.text ?? '');
  }

  resultLabel(a: SessionAnswer): string {
    const s = subjectOf(a.card);
    if (s) return this.translate.instant(`${I18N}.finish.pair`, { en: s, text: a.text }) as string;
    const side = a.choice === 'own' ? 'a' : a.choice;
    const l = optionLabel(a.card, side);
    const label = l.key ? (this.translate.instant(l.key) as string) : (l.text ?? '');
    return this.translate.instant(`${I18N}.finish.rule`, { label }) as string;
  }

  resultTexts(a: SessionAnswer): number {
    return a.choice === 'own' ? a.card.spread : optionCount(a.card, a.choice);
  }
}

function dialogOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Array.from(document.querySelectorAll(OPEN_DIALOG)).some((d) => (d as HTMLElement).checkVisibility?.() ?? true);
}
