import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { ScPopupComponent } from '../shared/popup/sc-popup.component';
import { ScPopupMotionDirective } from '../shared/popup-motion/sc-popup-motion.directive';
import { ToastSlotDirective } from '../shared/toast-stack/toast-stack';
import { SwUpdateService } from './sw-update.service';

/**
 * `<sc-update-toast>` - "a new version is ready": a notice in the bottom-right toast stack, the same
 * card as the undo and star toasts. It has no close and no timer: it stays until the reader reloads,
 * because the open tab keeps the old build until then. Mounted by the root component (outside the
 * shell), so the public layout shows it too.
 */
@Component({
  selector: 'sc-update-toast',
  standalone: true,
  imports: [ScPopupMotionDirective, ToastSlotDirective, TranslatePipe, ScActionDirective, ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sw.updateReady()) {
      <div class="toast" scToastSlot scPopupMotion scPopupMotionOrigin="br">
        <sc-popup kind="notice" [title]="'update.available' | translate">
          <!-- Reload arrow: the rail names the action the toast offers. -->
          <svg popupIcon viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" /><path d="M21 3v5h-5" /></svg>
          <div class="row">
            <span class="msg">{{ 'update.available' | translate }}</span>
            <button type="button" scAction tier="secondary" class="reload" (click)="sw.applyUpdate()">{{ 'update.reload' | translate }}</button>
          </div>
        </sc-popup>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* Position only (bottom right, in the toast stack above the launcher); frame, width, rail come from <sc-popup kind="notice">. */
    .toast {
      position: fixed; z-index: 1450;
      inset-inline-end: var(--sc-toast-end, 24px);
      bottom: calc(var(--sc-toast-bottom, var(--sc-fab-clear-block, 80px)) + var(--sc-toast-offset, 0px));
    }
    .row { display: flex; align-items: center; gap: 12px; min-height: 36px; }
    .msg { flex: 1; min-width: 0; font-size: 0.9rem; color: var(--sc-fg-0); }
    .reload { flex: none; }
  `],
})
export class UpdateToastComponent {
  protected readonly sw = inject(SwUpdateService);
}
