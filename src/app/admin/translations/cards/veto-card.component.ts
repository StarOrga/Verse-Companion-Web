import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../../shared/tooltip/sc-tooltip.directive';
import type { TranslationCard } from '../translations.service';
import { CARD_KEYS, countKey, reasonText, subjectOf } from './cards.logic';
import { CARD_STYLES } from './cards.styles';

/**
 * A KI decision as a card in the same Duell frame (concept karteikarten-neu r5 d1 s6, U11): five lines — the English
 * source and the count, the KI text as the hero, its German meaning directly under it with the ⚠ reason, the two
 * answers („Sieht falsch aus“ / „Passt“) as the card's halves, one quiet footer.
 */
@Component({
  selector: 'sc-veto-card',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = card();
    @let ai = c.ai!;
    <article class="card veto" data-test="veto-card" [attr.aria-label]="'admin.translations.cards.cardAria' | translate: { n: index(), total: total() }">
      <div class="chead">
        <span class="count src">
          @if (subject(); as s) { {{ 'admin.translations.cards.veto.source' | translate: { en: s } }} }
        </span>
        <span class="count">
          @if (ai.unsure) { <span class="warn">{{ 'admin.translations.cards.veto.unsure' | translate }}</span> · }
          {{ 'admin.translations.cards.count' | translate: { n: index(), total: total() } }}
        </span>
      </div>
      <div class="hero">
        <p class="ki" [attr.lang]="lang()">{{ 'admin.translations.cards.quoted' | translate: { text: ai.text } }}</p>
        <p class="back">
          @if (ai.back_de; as de) {
            <span class="desk-label">{{ 'admin.translations.cards.veto.meaning' | translate }}</span><b lang="de">{{ 'admin.translations.cards.quoted' | translate: { text: de } }}</b>
          } @else {
            <span>{{ 'admin.translations.cards.veto.meaningPending' | translate }}</span>
          }
          @let r = reason();
          <span class="why">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></svg>{{ r.key! | translate: r.params }}
          </span>
        </p>
      </div>
      <div class="vans">
        <button type="button" class="vbtn warn" data-test="veto-wrong" [disabled]="busy()" aria-keyshortcuts="ArrowLeft 1"
                [scTooltip]="(review() ? 'admin.translations.cards.veto.reviewWrongHint' : 'admin.translations.cards.veto.wrongHint') | translate" (click)="wrong.emit()">
          <kbd class="kbd desk" aria-hidden="true">{{ keys.left }}</kbd>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5" /></svg>{{ 'admin.translations.cards.veto.wrong' | translate }}
        </button>
        <span class="or" aria-hidden="true"></span>
        <button type="button" class="vbtn ok" data-test="veto-ok" [disabled]="busy()" aria-keyshortcuts="ArrowRight 2"
                [scTooltip]="'admin.translations.cards.veto.okHint' | translate" (click)="ok.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>{{ 'admin.translations.cards.veto.ok' | translate }}
          <kbd class="kbd desk" aria-hidden="true">{{ keys.right }}</kbd>
        </button>
      </div>
      <footer class="cfoot">
        <span class="cmeta">
          <span>{{ cn('admin.translations.cards.affects', c.spread) | translate: { count: c.spread } }}</span>
          <span>{{ 'admin.translations.cards.when' | translate }}</span>
        </span>
      </footer>
    </article>
  `,
  styles: [
    CARD_STYLES,
    `
      .card.veto { gap: 0; }
      .count.src { min-width: 0; flex: 1 1 10em; white-space: normal; overflow-wrap: anywhere; }
      .hero { display: grid; gap: 4px; margin: 16px 0 18px; min-width: 0; }
      .ki { margin: 0; font: 700 1.75rem/1.2 var(--sc-font-body, inherit); color: var(--sc-fg-0); overflow-wrap: anywhere; }
      .back { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 6px; font-size: 0.875rem; line-height: 1.45; color: var(--sc-fg-2); min-width: 0; }
      .back b { font-weight: 600; color: var(--sc-fg-1); overflow-wrap: anywhere; min-width: 0; }
      .why { display: inline-flex; align-items: baseline; gap: 5px; font-size: 0.78rem; color: var(--sc-warning); min-width: 0; overflow-wrap: anywhere; }
      .why::before { content: '·'; margin-inline-end: 2px; color: color-mix(in srgb, var(--sc-fg-1) 50%, transparent); }
      .why svg { flex: none; align-self: center; width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .vans { display: grid; grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr); column-gap: 12px; margin-bottom: 14px; }
      .vbtn {
        display: flex; align-items: center; gap: 9px; min-width: 0; min-height: 48px; margin: 0; padding: 8px 10px; border: 0; border-radius: 12px;
        background: none; font: 700 1.0625rem/1.2 var(--sc-font-body, inherit); color: var(--sc-fg-0); text-align: start; cursor: pointer; overflow-wrap: anywhere;
      }
      .vbtn:hover { background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .vbtn:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
      .vbtn:disabled { cursor: progress; }
      .vbtn svg { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .vbtn.warn { color: var(--sc-warning); }
      .vbtn.ok .kbd { margin-inline-start: auto; }
      @media (max-width: 520px) {
        .hero { margin: 14px 0; }
        .ki { font-size: 1.45rem; }
        .back { font-size: 0.8125rem; }
        .vans { column-gap: 6px; }
        .vbtn { gap: 7px; padding: 8px; font-size: 0.95rem; }
      }
    `,
  ],
})
export class VetoCardComponent {
  readonly card = input.required<TranslationCard>();
  readonly lang = input('');
  /** A judged language's automatic decision: „Sieht falsch aus“ reopens it as a deck card instead of re-asking the KI. */
  readonly review = input(false);
  readonly index = input(1);
  readonly total = input(1);
  readonly busy = input(false);
  readonly wrong = output<void>();
  readonly ok = output<void>();

  protected readonly keys = CARD_KEYS;
  protected readonly cn = countKey;
  protected readonly subject = computed(() => subjectOf(this.card()));
  protected readonly reason = computed(() => reasonText(this.card().ai!));
}
