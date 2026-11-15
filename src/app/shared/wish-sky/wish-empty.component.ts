import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../action/sc-action.directive';
import { WishSkyComponent } from './wish-sky.component';

/** The magnifier glyph of the search, drawn as everywhere else in the shell. */
const SEARCH = ['M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z', 'M15.5 15.5L20 20'] as const;

/**
 * `<sc-wish-empty>` - the empty state of the wishes, ONE piece for the header popout and the large window: the night
 * sky, the headline "Wünsch dir was", one sentence and the page's one primary action "Wunsch suchen" (search glyph
 * before the label, centred). The action only emits `searchWish`; the host closes itself and opens the search through
 * `SearchOpenService`. Nothing else stands in the popup while this shows: no footer, no second primary.
 */
@Component({
  selector: 'sc-wish-empty',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, WishSkyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="we">
      <sc-wish-sky />
      <p class="we-t">{{ 'cart.empty' | translate }}</p>
      <p class="we-x">{{ 'cart.emptyHint' | translate }}</p>
      <button type="button" scAction tier="primary" class="we-go" (click)="searchWish.emit()">
        <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icon; track $index) { <path [attr.d]="d" /> }</svg>
        <span>{{ 'cart.emptyAction' | translate }}</span>
      </button>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .we { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 2px 4px 6px; text-align: center; }
      .we-t { margin: 4px 0 0; font: 600 0.95rem/1.3 var(--sc-font-display, inherit); letter-spacing: 0.02em; color: var(--sc-fg-0); }
      .we-x { margin: 0; max-width: 36ch; color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor, 0.75rem)); }
      .we-go { align-self: center; }
    `,
  ],
})
export class WishEmptyComponent {
  protected readonly icon = SEARCH;
  /** The action was pressed: the host closes itself and opens the search. */
  readonly searchWish = output<void>();
}
