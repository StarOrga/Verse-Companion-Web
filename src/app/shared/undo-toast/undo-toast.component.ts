import { ScPopupMotionDirective } from '../popup-motion/sc-popup-motion.directive';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ToastSlotDirective } from '../toast-stack/toast-stack';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../action/sc-action.directive';
import { ScPopupComponent } from '../popup/sc-popup.component';
import { UndoToastService } from './undo-toast.service';

/**
 * The undo toast for {@link UndoToastService}: one card bottom-right, above the
 * feedback launcher (same lane as the star toast), with the action in words, an
 * "Undo" button and a draining bar for the window. Hover or focus holds the
 * window. Hosted once by the shell, outside the routed page's stacking context;
 * the window keeps running across navigation and commits when it closes.
 */
@Component({
  selector: 'sc-undo-toast',
  standalone: true,
  imports: [ScPopupMotionDirective, ToastSlotDirective, TranslatePipe, ScActionDirective, ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of shown(); track p.id) {
      <div class="toast" scToastSlot scPopupMotion scPopupMotionOrigin="br" animate.leave="pm-out" [class.paused]="svc.held()"
           (mouseenter)="svc.hold('hover', true)" (mouseleave)="svc.hold('hover', false)"
           (focusin)="svc.hold('focus', true)" (focusout)="svc.hold('focus', false)">
        <sc-popup kind="notice" [title]="p.messageKey | translate: p.messageParams">
          <svg popupIcon viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg>
          <div class="row">
            <span class="msg">{{ p.messageKey | translate: p.messageParams }}</span>
            <button type="button" scAction tier="secondary" class="undo" (click)="svc.undo()">{{ 'common.undo' | translate }}</button>
          </div>
          <i class="drain" aria-hidden="true" [style.animation-duration.ms]="svc.duration"></i>
        </sc-popup>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* Position only (bottom right, above the launcher); frame, width, rail and symbol come from <sc-popup kind="notice">. */
    .toast {
      position: fixed; z-index: 1450;
      inset-inline-end: var(--sc-fab-gutter, 16px);
      bottom: calc(var(--sc-toast-bottom, var(--sc-fab-clear-block, 80px)) + var(--sc-toast-offset, 0px));
    }
    .row { display: flex; align-items: center; gap: 12px; }
    .msg { flex: 1; min-width: 0; font-size: 0.9rem; color: var(--sc-fg-0); }
    .undo { flex: none; }
    .drain {
      display: block; height: 2px; margin-top: 10px; background: var(--sc-accent); transform-origin: left center;
      animation: toast-drain linear forwards;
    }
    .toast.paused .drain { animation-play-state: paused; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes toast-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) {
      @keyframes toast-fade { from { opacity: 0; } to { opacity: 1; } }
    }
  `],
})
export class UndoToastComponent {
  protected readonly svc = inject(UndoToastService);
  /** One-element list so each offer gets a fresh DOM node (restarts the drain). */
  protected readonly shown = computed(() => {
    const c = this.svc.current();
    return c ? [c] : [];
  });
}
