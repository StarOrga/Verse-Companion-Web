import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

const PLUS = 'M12 5v14M5 12h14';
const MINUS = 'M5 12h14';

/**
 * ONE quantity stepper (− value +) for the app, extracted from the wish cart, the wish list and
 * the HQ Nachschub flows, which each carried their own copy (popup-aufbau polish finding #25).
 *
 * - a labelled `role="group"`; − and + are real buttons with an aria-label and the same text as
 *   an app tooltip (icon-only buttons show their label, CLAUDE.md)
 * - `valueChange` emits the NEW value, already clamped to [min, max]; the buttons disable at the
 *   bounds, so a click can never emit the current value again
 * - the middle shows `value` unless the caller projects its own content (a unit, "3 / 5")
 * - 30 px on a mouse, the 48 px touch floor on a coarse pointer or a phone width
 */
@Component({
  selector: 'sc-qty-stepper',
  standalone: true,
  imports: [ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sc-qty-stepper', role: 'group', '[attr.aria-label]': 'groupLabel() || null' },
  template: `
    <button type="button" class="qs-btn qs-less" [disabled]="disabled() || value() <= min()"
            [attr.aria-label]="lessLabel()" [scTooltip]="lessLabel()" scTooltipTier="label" (click)="go(-1)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="minus" /></svg>
    </button>
    <b class="qs-val"><ng-content>{{ value() }}</ng-content></b>
    <button type="button" class="qs-btn qs-more" [disabled]="disabled() || value() >= max()"
            [attr.aria-label]="moreLabel()" [scTooltip]="moreLabel()" scTooltipTier="label" (click)="go(1)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="plus" /></svg>
    </button>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; flex: none; border: 1px solid var(--sc-border); border-radius: 999px; overflow: hidden; }
    .qs-btn { display: grid; place-items: center; inline-size: 30px; block-size: 30px; padding: 0; border: 0;
      background: transparent; color: var(--sc-fg-1); cursor: pointer; }
    @media (hover: hover) { .qs-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); } }
    .qs-btn:disabled { opacity: 0.4; cursor: default; }
    .qs-btn:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
    .qs-btn svg { inline-size: 14px; block-size: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .qs-val { min-inline-size: 2ch; padding: 0 2px; text-align: center; font-variant-numeric: tabular-nums;
      font-size: 0.85rem; font-weight: 600; color: var(--sc-fg-0); white-space: nowrap; }
    .qs-val ::ng-deep small { font-size: 0.68rem; font-weight: 600; color: var(--sc-fg-2); }
    /* Touch floor of the mobile gate: 48 px (a 44 px value measures 43). */
    @media (pointer: coarse), (max-width: 749px) { .qs-btn { inline-size: 48px; block-size: 48px; } }
  `],
})
export class ScQtyStepperComponent {
  readonly value = input.required<number>();
  readonly min = input(1);
  readonly max = input(999);
  readonly disabled = input(false);
  /** Accessible name of the group, already translated ("Menge von Aluminium"). */
  readonly groupLabel = input('');
  /** Already translated labels of the two buttons. */
  readonly lessLabel = input.required<string>();
  readonly moreLabel = input.required<string>();

  /** The new value after a step, clamped to [min, max]. */
  readonly valueChange = output<number>();

  protected readonly plus = PLUS;
  protected readonly minus = MINUS;

  protected go(by: 1 | -1): void {
    const next = Math.min(this.max(), Math.max(this.min(), this.value() + by));
    if (next !== this.value()) this.valueChange.emit(next);
  }
}
