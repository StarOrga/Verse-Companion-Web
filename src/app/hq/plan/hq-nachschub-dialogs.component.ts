import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { NachschubService } from '../nachschub/nachschub.service';
import { NACHSCHUB_ICON_PATHS } from '../nachschub/step-icons';
import { HQ_POPUP_CONTENT_STYLES } from './hq-popup-content.styles';

/**
 * Delete or empty a Nachschub (round 3/4): "Offene Positionen zurück auf die Wunschliste?" with a checkbox, default on.
 * Off drops the open lines for good; on counts them up on the wishlist. Delete removes the crate as well; empty keeps it.
 */
@Component({
  selector: 'sc-hq-nachschub-remove-dialog',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScPopupComponent, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-popup kind="dialog" size="s" [eyebrow]="'hq.title' | translate"
      [title]="(mode() === 'remove' ? 'hq.remove.titleRemove' : 'hq.remove.titleEmpty') | translate: { name: name() }" (closed)="cancelled.emit()">
      <div class="pbody">
        <p class="dlg-msg">{{ (mode() === 'remove' ? 'hq.remove.msgRemove' : 'hq.remove.msgEmpty') | translate: { n: open() } }}</p>
        @if (open() > 0) {
          <div class="opt">
            <sc-tristate variant="checkbox" [label]="'hq.remove.back' | translate" [value]="back() ? 1 : 0" (toggled)="back.set(!back())" />
            <span>{{ 'hq.remove.back' | translate }}</span>
          </div>
          <p class="dlg-msg hint">{{ (back() ? 'hq.remove.backOn' : 'hq.remove.backOff') | translate }}</p>
        }
      </div>
      <ng-container popupActions>
        <button type="button" scAction tier="secondary" tone="danger" (click)="confirmed.emit(back())">
          {{ (mode() === 'remove' ? 'hq.remove.confirmRemove' : 'hq.remove.confirmEmpty') | translate }}
        </button>
        <button type="button" scAction tier="secondary" (click)="cancelled.emit()">{{ 'common.dialog.cancel' | translate }}</button>
      </ng-container>
    </sc-popup>
  `,
  styles: [HQ_POPUP_CONTENT_STYLES, `.opt span { flex: 1; } .hint { color: var(--sc-fg-2); font-size: 0.85rem; }`],
})
export class HqNachschubRemoveDialogComponent {
  readonly name = input.required<string>();
  readonly mode = input<'remove' | 'empty'>('remove');
  /** Open (not yet closed) lines that would leave. */
  readonly open = input(0);
  readonly confirmed = output<boolean>();
  readonly cancelled = output<void>();
  protected readonly back = signal(true);
  protected readonly tray = NACHSCHUB_ICON_PATHS;
}

/** The archive: finished Nachschübe that freed their slot; bring one back while a slot is free. */
@Component({
  selector: 'sc-hq-nachschub-archive-dialog',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-popup kind="dialog" [eyebrow]="'hq.title' | translate" [title]="'hq.slots.archive' | translate" (closed)="closed.emit()">
      <div class="pbody">
        <p class="dlg-msg hint">{{ svc.newBlock() ? (svc.newBlock()! | translate) : ('hq.archive.slotFree' | translate) }}</p>
        @if (svc.archived().length === 0) {
          <p class="dlg-msg">{{ 'hq.archive.empty' | translate }}</p>
        } @else {
          <ul class="list">
            @for (n of svc.archived(); track n.id) {
              <li>
                <span class="nm">{{ n.name }}</span>
                <button type="button" scAction tier="secondary" [disabled]="svc.newBlock() !== null" (click)="reactivate.emit(n.id)">{{ 'hq.archive.reactivate' | translate }}</button>
              </li>
            }
          </ul>
        }
      </div>
    </sc-popup>
  `,
  styles: [
    HQ_POPUP_CONTENT_STYLES,
    `.hint { color: var(--sc-fg-2); font-size: 0.85rem; }
     .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
     .list li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
     .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }`,
  ],
})
export class HqNachschubArchiveDialogComponent {
  protected readonly svc = inject(NachschubService);
  readonly reactivate = output<string>();
  readonly closed = output<void>();
}
