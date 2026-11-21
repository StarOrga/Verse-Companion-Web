import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

/**
 * A small "i" that carries an explanatory sentence as an app-styled tooltip
 * instead of a written-out paragraph (admin feedback #375: "tooltips überall
 * als Tooltip anzeigen, nicht voll ausschreiben").
 *
 * Only for explanation. Status, data-gap, warning and error lines stay
 * visible text — a reader must not have to hover to learn that something is
 * missing or wrong.
 *
 * The trigger is focusable (Tab opens the tooltip, Escape closes it; touch
 * opens it on long-press), and the sentence is also in the DOM as
 * visually hidden text, so a screen reader reads it in the flow.
 * An optional `label` shows a short word before the "i" ("Skala").
 */
@Component({
  selector: 'sc-hint-tip',
  standalone: true,
  imports: [ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tip" tabindex="0" [class.labelled]="!!label()" [scTooltip]="text()" scTooltipTier="label" [scTooltipPlacement]="placement()">
      @if (label()) { <span class="lbl">{{ label() }}</span> }
      <span class="i" aria-hidden="true">i</span>
      <span class="sc-sr-only">{{ text() }}</span>
    </span>
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .tip {
      display: inline-flex; align-items: center; gap: 5px; border-radius: 3px; cursor: help;
      color: var(--sc-fg-2); font-size: max(10.5px, var(--sc-fs-floor)); line-height: 1;
    }
    .tip:hover { color: var(--sc-fg-1); }
    .tip:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .lbl { letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
    .i {
      display: inline-grid; place-items: center; inline-size: 13px; block-size: 13px; border-radius: 50%;
      border: 1px solid currentColor; font: italic 600 9px/1 Georgia, serif; letter-spacing: 0; text-transform: none;
    }
    /* Touch: the trigger reaches the 48px tap size without moving the text around it. */
    @media (pointer: coarse) {
      .tip { min-block-size: 48px; min-inline-size: 48px; justify-content: center; margin-block: -17px; }
      .tip.labelled { margin-block: 0; }
    }
  `],
})
export class HintTipComponent {
  /** The explanation, already translated by the caller. */
  readonly text = input.required<string>();
  /** Optional short visible word before the "i", already translated. */
  readonly label = input<string | null>(null);
  readonly placement = input<'above' | 'below'>('above');
}
