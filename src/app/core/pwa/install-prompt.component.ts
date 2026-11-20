import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScPopupMotionDirective } from '../../shared/popup-motion/sc-popup-motion.directive';
import { PwaInstallService } from './pwa-install.service';

/** Swipe distance (px) that counts as "Later" on a phone. */
const SWIPE_DISMISS_PX = 64;

/**
 * `<sc-install-prompt>` - the "get the app" card and, on iOS, the three-step instruction sheet.
 * Mounted once by the root component. The card only appears when `PwaInstallService` decides it is a
 * calm moment; "Install" calls the browser's native prompt (Android / desktop Chromium) directly in the
 * click, or opens the iOS sheet. "Later" and a swipe down both count as a dismissal (long back-off).
 */
@Component({
  selector: 'sc-install-prompt',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScPopupComponent, ScPopupMotionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pwa.prompt()) {
      <section
        class="card"
        scPopupMotion
        scPopupMotionOrigin="bl"
        role="region"
        [attr.aria-label]="'pwa.card.title' | translate"
        [style.transform]="dragY() > 0 ? 'translateY(' + dragY() + 'px)' : null"
        [style.opacity]="dragY() > 0 ? 1 - dragY() / 160 : null"
        (touchstart)="swipeStart($event)"
        (touchmove)="swipeMove($event)"
        (touchend)="swipeEnd()"
        (touchcancel)="dragY.set(0)"
      >
        <img class="icon" src="icons/brand/vc-192.png" alt="" width="48" height="48" />
        <div class="txt">
          <strong class="title">{{ 'pwa.card.title' | translate }}</strong>
          <span class="benefit">{{ 'pwa.card.benefit' | translate }}</span>
        </div>
        <div class="actions">
          <button type="button" scAction tier="primary" (click)="pwa.install()">{{ 'pwa.card.install' | translate }}</button>
          <button type="button" scAction tier="secondary" (click)="pwa.later()">{{ 'pwa.card.later' | translate }}</button>
        </div>
      </section>
    }
    @if (pwa.iosSheetOpen()) {
      <sc-popup kind="dialog" size="s" [title]="'pwa.ios.title' | translate" (closed)="pwa.closeIosSheet()">
        <ol class="steps">
          <li>
            <span class="glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 15V3" /><path d="M8.5 6.5 12 3l3.5 3.5" /><path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17" />
              </svg>
            </span>
            <span class="step">{{ (pwa.isIpad() ? 'pwa.ios.step1Ipad' : 'pwa.ios.step1Iphone') | translate }}</span>
          </li>
          <li>
            <span class="glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" />
              </svg>
            </span>
            <span class="step">{{ 'pwa.ios.step2' | translate }}</span>
          </li>
          <li>
            <span class="glyph add" aria-hidden="true">{{ 'pwa.ios.addLabel' | translate }}</span>
            <span class="step">{{ 'pwa.ios.step3' | translate }}</span>
          </li>
        </ol>
        <ng-container popupActions>
          <button type="button" scAction tier="primary" (click)="pwa.closeIosSheet()">{{ 'pwa.ios.done' | translate }}</button>
        </ng-container>
      </sc-popup>
    }
  `,
  styles: [`
    :host { display: contents; }
    .card {
      position: fixed; z-index: 1450; box-sizing: border-box;
      display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--sc-space-3, 12px);
      padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px);
      background: var(--sc-bg-1); color: var(--sc-fg-0);
      border: 1px solid var(--sc-border); border-inline-start: 3px solid var(--sc-accent); border-radius: 12px;
      box-shadow: 0 8px 28px rgb(0 0 0 / 0.45);
      /* Phones: full width minus gutters, above the safe area, clear of the feedback launcher. */
      bottom: var(--sc-float-bottom);
      inset-inline-start: var(--sc-space-3, 12px); inset-inline-end: var(--sc-space-3, 12px);
      margin-inline-end: var(--sc-fab-clear-inline);
      touch-action: pan-x;
    }
    .icon { width: 48px; height: 48px; border-radius: 12px; }
    .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title { font-family: var(--sc-font-display); font-size: 0.95rem; font-weight: 600; }
    .benefit { font-size: max(0.8rem, var(--sc-fs-floor)); line-height: 1.35; color: var(--sc-fg-2); }
    .actions { grid-column: 1 / -1; display: flex; gap: var(--sc-space-2, 8px); justify-content: flex-end; }
    .actions button { min-height: 48px; min-width: 48px; }
    /* Tablet and up: a compact card bottom-left (the launcher and toasts live bottom-right). */
    @media (min-width: 721px) {
      .card { inset-inline-end: auto; margin-inline-end: 0; inset-inline-start: var(--sc-space-6, 24px); width: min(400px, calc(100vw - 48px)); }
    }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
    .steps li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); min-height: 48px; }
    .glyph {
      flex: none; display: grid; place-items: center; min-width: 44px; height: 44px; padding: 0 8px; box-sizing: border-box;
      border-radius: 10px; border: 1px solid var(--sc-border); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 10%, transparent);
    }
    .glyph svg { width: 24px; height: 24px; }
    .glyph.add { font-size: 0.82rem; font-weight: 600; white-space: nowrap; }
    .step { font-size: 0.92rem; line-height: 1.4; }
  `],
})
export class InstallPromptComponent {
  protected readonly pwa = inject(PwaInstallService);
  protected readonly dragY = signal(0);
  private startY = 0;

  protected swipeStart(e: TouchEvent): void {
    this.startY = e.touches[0]?.clientY ?? 0;
  }

  protected swipeMove(e: TouchEvent): void {
    const dy = (e.touches[0]?.clientY ?? 0) - this.startY;
    this.dragY.set(Math.max(0, dy));
  }

  protected swipeEnd(): void {
    const dismiss = this.dragY() >= SWIPE_DISMISS_PX;
    this.dragY.set(0);
    if (dismiss) this.pwa.later();
  }
}
