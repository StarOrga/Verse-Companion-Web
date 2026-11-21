import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../../shared/tooltip/sc-tooltip.directive';
import type { TranslationCard } from '../translations.service';
import { CARD_KEYS, cardQuestion, examplesOf, optionCount, optionLabel, optionOf } from './cards.logic';
import { CARD_STYLES } from './cards.styles';

/**
 * The Duell-Karte (concept karteikarten-neu r5 d1 s2/s3): one card, the two options as its two halves. Exactly one
 * thing is largest — the two answers; the question and the count share one quiet line on top, three examples sit
 * under each answer, one quiet footer says how far it reaches and when it takes effect. What an answer changes
 * (P10 „betrifft N Texte“) shows as the half's hint on a long hover, not as another line. Tapping a half answers.
 */
@Component({
  selector: 'sc-duel-card',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = card();
    <article class="card" data-test="card" [attr.aria-label]="'admin.translations.cards.cardAria' | translate: { n: index(), total: total() }">
      <div class="chead">
        @let q = question();
        <h2 class="q">{{ q.key! | translate: q.params }}</h2>
        <span class="count">{{ 'admin.translations.cards.count' | translate: { n: index(), total: total() } }}</span>
      </div>
      <div class="duel" role="group" [attr.aria-label]="q.key! | translate: q.params">
        @for (side of sides; track side) {
          @let label = optionLabel(c, side);
          <button type="button" class="half" [class.r]="side === 'b'" [class.pick]="picked() === side"
                  [attr.data-test]="'half-' + side" [disabled]="busy()"
                  [attr.aria-keyshortcuts]="side === 'a' ? 'ArrowLeft 1' : 'ArrowRight 2'"
                  [scTooltip]="'admin.translations.cards.affects' | translate: { count: count(side) }"
                  (click)="pick.emit(side)">
            <span class="opt">
              <kbd class="kbd desk" aria-hidden="true">{{ side === 'a' ? keys.left : keys.right }}</kbd>
              <span class="name">{{ label.key ? (label.key | translate) : label.text }}</span>
              @if (votesOf(side); as v) { <span class="cnt">{{ 'admin.translations.cards.votes' | translate: { votes: v } }}</span> }
            </span>
            @let ex = examples(side);
            @if (ex.length) {
              <ul class="ex" [class.ctx]="c.kind !== 'convention'">
                @for (e of ex; track $index) {
                  <li>
                    @if (c.kind === 'convention') {
                      <small>{{ e.lang.toUpperCase() }}</small>
                    } @else {
                      <small class="where" [scTooltip]="e.en">{{ e.en }}</small>
                    }
                    <span>{{ e.text }}</span>
                  </li>
                }
              </ul>
            }
          </button>
          @if (side === 'a') { <span class="or" aria-hidden="true"></span> }
        }
      </div>
      <footer class="cfoot">
        <span class="cmeta">
          @if (c.kind === 'convention') {
            <span class="ac">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>{{ 'admin.translations.cards.allLangs' | translate: { n: c.langs.length } }}
            </span>
          }
          <span>{{ 'admin.translations.cards.affects' | translate: { count: c.spread } }}</span>
          <span>{{ 'admin.translations.cards.when' | translate }}</span>
          @if (exceptionLang(); as x) {
            <span class="exc" data-test="exception">{{ 'admin.translations.cards.exception.chip' | translate: { lang: exceptionName() } }}</span>
          }
        </span>
      </footer>
    </article>
  `,
  styles: [CARD_STYLES],
})
export class DuelCardComponent {
  readonly card = input.required<TranslationCard>();
  readonly index = input(1);
  readonly total = input(1);
  /** The half highlighted as chosen (the moment of the answer, and while a swipe leans that way). */
  readonly picked = input<'a' | 'b' | null>(null);
  readonly busy = input(false);
  /** Convention only: the language that takes the other option (P8). */
  readonly exceptionLang = input<string | null>(null);
  readonly exceptionName = input('');
  readonly pick = output<'a' | 'b'>();

  protected readonly sides = ['a', 'b'] as const;
  protected readonly keys = CARD_KEYS;
  protected readonly optionLabel = optionLabel;
  protected readonly question = computed(() => cardQuestion(this.card()));
  protected count(side: 'a' | 'b'): number {
    return optionCount(this.card(), side);
  }
  protected examples(side: 'a' | 'b') {
    return examplesOf(optionOf(this.card(), side));
  }
  protected votesOf(side: 'a' | 'b'): number | null {
    const c = this.card();
    if (c.kind !== 'term') return null;
    return optionOf(c, side).votes ?? null;
  }
}
