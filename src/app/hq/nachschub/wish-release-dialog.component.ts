import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import type { ReleaseInfo } from './nachschub.service';

/** The answer of the release confirmation; null (the `closed` value) = cancelled. */
export interface WishReleaseChoice {
  /** `release` = the wish stays on the wishlist and is free again; `delete` = it leaves the wishlist too. */
  readonly action: 'release' | 'delete';
  /** The unticked box of a last wish whose Operation keeps its Einsätze. */
  readonly dissolve: boolean;
}

/**
 * C7: "Lösen" in the HQ always asks. "<Item> aus der Operation lösen?", the pieces stay on the wishlist and become free
 * again; three choices: Abbrechen, Lösen (the one primary) and the red "Auch von der Wunschliste löschen". When the
 * release empties the Operation, A7 applies and the dialog says so (danger hint without Einsatz, the unticked box with).
 */
@Component({
  selector: 'sc-wish-release-dialog',
  standalone: true,
  imports: [TranslatePipe, ScPopupComponent, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-popup kind="dialog" size="m" [sheet]="true" dialogRole="alertdialog" [backdrop]="false"
              [title]="'wishRemoval.release.title' | translate: { name: name() }" (closed)="closed.emit(null)">
      <div class="wr-body">
        <p class="wr-text">{{ (info().pieces === 1 ? 'wishRemoval.release.textOne' : 'wishRemoval.release.text') | translate: { n: info().pieces } }}</p>
        @if (info().emptiesPackage) {
          @if (info().dissolvesAlong) {
            <p class="wr-hint dng" role="note">
              <svg class="wr-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of route; track $index) { <path [attr.d]="d" /> }</svg>
              <span>{{ 'wishRemoval.dissolves' | translate: { name: info().packageName } }}</span>
            </p>
          } @else {
            <p class="wr-hint" role="note">
              <svg class="wr-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of route; track $index) { <path [attr.d]="d" /> }</svg>
              <span>{{ (info().einsaetze === 1 ? 'wishRemoval.lastStaysOne' : 'wishRemoval.lastStays') | translate: { name: info().packageName, n: info().einsaetze } }}</span>
            </p>
            <label class="wr-chk">
              <input type="checkbox" [checked]="dissolve()" (change)="dissolve.set($any($event.target).checked)" />
              <span class="wr-box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
              <span>{{ 'wishRemoval.alsoDissolve' | translate }}</span>
            </label>
          }
        }
      </div>
      <span popupActions class="wr-acts">
        <button scAction tier="secondary" type="button" class="cancel" (click)="closed.emit(null)">{{ 'common.dialog.cancel' | translate }}</button>
        <button scAction tier="primary" type="button" class="release" (click)="answer('release')">{{ 'wishRemoval.release.confirm' | translate }}</button>
        <button scAction tier="secondary" tone="danger" type="button" class="delete" (click)="answer('delete')">{{ 'wishRemoval.release.deleteToo' | translate }}</button>
      </span>
    </sc-popup>
  `,
  styles: [`
    :host { display: block; }
    /* The mock's order on one row: Abbrechen, Lösen, the red one. On a phone they stack: Lösen first, Abbrechen, the red one clearly apart. */
    .wr-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    @media (max-width: 720px) {
      .wr-acts { flex-direction: column; align-items: stretch; inline-size: 100%; }
      .wr-acts .release { order: 1; }
      .wr-acts .cancel { order: 2; }
      .wr-acts .delete { order: 3; margin-block-start: 12px; }
    }
    .wr-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .wr-text { margin: 0; color: var(--sc-fg-1); overflow-wrap: anywhere; }
    .wr-i { flex: none; inline-size: 14px; block-size: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--sc-accent); margin-block-start: 2px; }
    .wr-hint { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 10px; border-inline-start: 2px solid var(--sc-accent);
      border-radius: 0 8px 8px 0; background: color-mix(in srgb, var(--sc-accent) 8%, transparent); color: var(--sc-fg-0); font-size: 0.8125rem; overflow-wrap: anywhere; }
    .wr-hint.dng { border-inline-start-color: var(--sc-danger); background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .wr-hint.dng .wr-i { color: var(--sc-danger); }
    .wr-chk { position: relative; display: inline-flex; align-items: center; gap: 8px; min-block-size: 32px; color: var(--sc-fg-1); font-size: 0.8125rem; cursor: pointer; }
    .wr-chk input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; }
    .wr-box { display: grid; place-items: center; inline-size: 18px; block-size: 18px; border: 1.5px solid var(--sc-fg-2); border-radius: 4px; flex: none; }
    .wr-box svg { inline-size: 12px; block-size: 12px; fill: none; stroke: var(--sc-bg-0); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
    .wr-chk input:checked + .wr-box { background: var(--sc-accent); border-color: var(--sc-accent); }
    .wr-chk input:checked + .wr-box svg { opacity: 1; }
    .wr-chk input:focus-visible + .wr-box { box-shadow: var(--sc-focus-ring); }
    @media (pointer: coarse), (max-width: 749px) { .wr-chk { min-block-size: 48px; } }
  `],
})
export class WishReleaseDialogComponent {
  readonly name = input.required<string>();
  readonly info = input.required<ReleaseInfo>();
  readonly closed = output<WishReleaseChoice | null>();

  protected readonly route = PATH_ICONS.nachschub;
  protected readonly dissolve = signal(false);

  protected answer(action: 'release' | 'delete'): void {
    this.closed.emit({ action, dissolve: this.dissolve() });
  }
}
