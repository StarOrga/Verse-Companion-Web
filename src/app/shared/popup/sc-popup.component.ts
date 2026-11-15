import {
  ChangeDetectionStrategy,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../dialog/sc-dialog.directive';
import { ModalInertService } from '../dialog/modal-inert.service';
import { ScActionDirective } from '../action/sc-action.directive';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';
import { logWarn } from '../../core/log';
import { pushPopupEntry, releasePopupEntry } from './popup-history';

/** The five popup kinds (concept 20261115-0216-popup-aufbau, r1-types). */
export type ScPopupKind = 'menu' | 'panel' | 'dialog' | 'large' | 'notice';
/** The four overlay width tiers of styles.scss "OVERLAY SIZES", plus `fill` (sized by its host). */
export type ScPopupSize = 'menu' | 's' | 'm' | 'area' | 'fill';
/** Who can reach the popup: the top edge takes the role colour (r1-role). */
export type ScPopupAccess = 'admin' | 'collab' | null;
/** Why the popup asks to close: its ✕, Escape, or the browser / phone back gesture. */
export type ScPopupCloseReason = 'close' | 'escape' | 'back';

/** The one overlay breakpoint of styles.scss: below it dialog / panel / large are full screen. */
export const SC_POPUP_PHONE_QUERY = '(max-width: 720px)';

const DEFAULT_SIZE: Record<Exclude<ScPopupKind, 'notice'>, ScPopupSize> = {
  menu: 'menu',
  panel: 's',
  dialog: 'm',
  large: 'area',
};

/** Default rail symbol per kind (24-unit viewBox, stroke style of the app's icon family). */
const KIND_SYMBOL: Record<ScPopupKind, string> = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  panel: 'M4 5h16v14H4zM14 5v14',
  dialog: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.2a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.7v.4M12 17h.01',
  large: 'M3 5h18v14H3zM3 9h18',
  notice: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
};

let uid = 0;

/**
 * `<sc-popup>` — the ONE scaffold every popup uses (concept 20261115-0216-popup-aufbau,
 * design d3 "Kommando-Spalte"). The popup fills only its content; head, ✕, footer, width,
 * scroll, scrim, focus and the role edge come from here.
 *
 * Look: a coloured rail on the left (46 px; 36 px for menu + notice) carries the kind's symbol
 * and the vertical eyebrow; title + header tools + ✕ in the head row; only the body scrolls;
 * footer actions left in reading order (primary first), status text right. The rail colour is
 * the KIND, never the consequence: a delete shows its danger only on its own button
 * (`scAction tone="danger"`). All kinds share `--sc-accent` and differ by symbol; an area may
 * set `--sc-popup-rail` on the host, but never to hot / collab / danger / warning.
 *
 * Usage:
 *
 *   <sc-popup kind="dialog" [eyebrow]="'hq.nachschub.eyebrow' | translate"
 *             [title]="'hq.nachschub.target_title' | translate" (closed)="close()">
 *     … content …
 *     <ng-container popupActions>
 *       <button scAction tier="primary" type="button">{{ 'common.save' | translate }}</button>
 *       <button scAction type="button" (click)="close()">{{ 'common.dialog.cancel' | translate }}</button>
 *     </ng-container>
 *     <span popupStatus>{{ '3 von 5' }}</span>
 *   </sc-popup>
 *
 * Inputs
 * - `kind`      menu | panel | dialog | large | notice (default dialog).
 *                 menu   no head, no ✕, no eyebrow, narrow rail; focus in + Escape + focus back.
 *                 panel  head + ✕, non-modal (no inert, no Tab trap); for a panel at its trigger.
 *                 dialog head + ✕, modal (aria-modal, page inert, Tab trap).
 *                 large  as dialog, width = subheader width B.
 *                 notice no head, no ✕, no eyebrow, narrow rail, never takes focus.
 * - `title`     the popup's one heading (already translated). Menus/notices: screen-reader only.
 * - `eyebrow`   area or subject ("Nachschub", "Waffe · S3 · Nase"), vertical in the rail.
 *               Not shown on menus and notices.
 * - `size`      override among the four width tokens: menu | s | m | area. Defaults: menu→menu,
 *               panel→s, dialog→m, large→area; a notice takes `--sc-toast-w`. A two-button
 *               question passes `size="s"`.
 *               `fill`: no width token, the frame fills its host (a 3D panel over a picture, a part
 *               popup): the host gives the size, `--sc-popup-radius` / `--sc-popup-border-w` on the
 *               host square it off for a full-screen use.
 * - `bodyFill`  the body is a flex column that fills the height (gap `--sc-popup-body-gap`) instead of
 *               scrolling itself: for content that owns its scroller (a table box, a viewer).
 * - `float`     a coach mark / floating card: stays a card on phones instead of going full screen
 *               (the host positions it; `--sc-popup-max-h` caps its height).
 * - `access`    'admin' → top edge `--sc-accent-hot`, 'collab' → `--sc-accent-collab`, plus
 *               screen-reader text; no visible role words.
 * - `modal`     override; default true for dialog + large, false otherwise.
 * - `backdrop`  render own fixed scrim + centred stage (for an inline `@if` popup). Default:
 *               true for modal kinds. Pass false when a CDK overlay already owns the backdrop
 *               (ScConfirmService) or when the host positions the popup at its trigger.
 * - `dialogRole` 'dialog' (default) | 'alertdialog' (a question that needs an answer).
 * - `initialFocus` 'first' (default: `cdkFocusInitial`, else first tabbable) | 'container'.
 * - `returnFocus`  explicit focus return target (default: the opener).
 * - `describedBy`  id for aria-describedby (a confirm's message).
 * - `backClose`  the back gesture closes this popup first (r1-back "Erst Fenster, dann Seite"):
 *               one history entry on open, back closes the topmost popup only, ✕/Escape/
 *               Abbrechen pop the entry again. Default: large always; dialog + panel when
 *               opened at phone width (where they are full screen); never menu / notice.
 *               Pass `false` for a popup that already owns a URL (wish cart `?cart=1`,
 *               overlay-frame child routes) so it gets no second entry.
 *
 * Output
 * - `closed` ('close' | 'escape' | 'back'): the ✕, Escape or the back gesture. A scrim click
 *   NEVER closes a modal, and a press on the scrim keeps focus in the frame (Escape stays alive).
 *   The host decides what closing means (remove the `@if`, resolve a promise, play
 *   `[scPopupMotion]`'s exit first).
 *
 * Slots (content projection)
 * - default          the body (the only part that scrolls).
 * - `[popupIcon]`    an `<svg>` replacing the kind's default rail symbol (area symbol).
 * - `[popupTools]`   header tools before the ✕ (‹ › stepping, a filter toggle); tertiary scActions.
 * - `[popupActions]` footer actions, left, in reading order, at most ONE `tier="primary"`, first.
 * - `[popupStatus]`  footer status text, right (an element, e.g. `<span popupStatus>`).
 *   The footer hides itself while both footer slots are empty.
 *
 * Stacking (r1-stack): at most one confirm over a dialog / large window. A second modal layer's
 * scrim stays transparent (the page does not darken further); a third layer logs a warning.
 *
 * Phone (≤ 720 px, the one overlay breakpoint): dialog, panel and large become full screen
 * (100% × 100dvh, radius 0, safe-area padding, ≥ 48 px targets); menus and notices stay cards.
 * Open/close motion stays with `[scPopupMotion]` (shared/popup-motion), put it on the host.
 */
@Component({
  selector: 'sc-popup',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, ScDialogDirective, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './sc-popup.scss',
  host: {
    class: 'sc-popup',
    '[attr.data-kind]': 'kind()',
    '[class.sc-popup--staged]': 'hasBackdrop()',
    '[attr.data-layer]': 'hasBackdrop() ? layer : null',
    '(mousedown)': 'onHostMouseDown($event)',
  },
  template: `
    @if (hasBackdrop()) {
      <div class="scp-scrim" aria-hidden="true"></div>
    }
    @if (takesFocus()) {
      <div
        class="scp-frame"
        scDialog
        [scDialogModal]="isModal()"
        [scDialogInert]="isModal()"
        [scDialogInitialFocus]="initialFocus()"
        [scDialogReturnFocus]="returnFocus()"
        (scDialogEscape)="closed.emit('escape')"
        [attr.data-kind]="kind()"
        [attr.data-size]="widthTier()"
        [attr.data-body]="bodyFill() ? 'fill' : null"
        [attr.data-float]="float() ? '' : null"
        [attr.data-access]="access()"
        [attr.role]="frameRole()"
        [attr.aria-modal]="isModal() ? 'true' : null"
        [attr.aria-labelledby]="hasHead() ? titleId : null"
        [attr.aria-label]="!hasHead() && title() ? title() : null"
        [attr.aria-describedby]="describedBy()"
      >
        <ng-container *ngTemplateOutlet="inner" />
      </div>
    } @else {
      <div class="scp-frame" role="status" [attr.data-kind]="kind()" [attr.data-access]="access()">
        <ng-container *ngTemplateOutlet="inner" />
      </div>
    }

    <ng-template #inner>
      <aside class="scp-rail">
        <span class="scp-sym" aria-hidden="true">
          <ng-content select="[popupIcon]" />
          <svg class="scp-sym-default" viewBox="0 0 24 24"><path [attr.d]="symbol()" /></svg>
        </span>
        @if (showEyebrow()) {
          <span class="scp-ev">{{ eyebrow() }}</span>
        }
      </aside>
      <div class="scp-main">
        @if (access(); as a) {
          <span class="sc-sr-only">{{ 'common.popup.access.' + a | translate }}</span>
        }
        @if (hasHead()) {
          <header class="scp-h">
            <h2 class="scp-title" [id]="titleId">{{ title() }}</h2>
            <span class="scp-tools"><ng-content select="[popupTools]" /></span>
            <button
              scAction
              tier="tertiary"
              type="button"
              class="scp-x"
              [attr.aria-label]="'common.dialog.close' | translate"
              [scTooltip]="'common.dialog.close' | translate"
              scTooltipTier="label"
              (click)="closed.emit('close')"
            >
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </header>
        } @else if (title()) {
          <h2 class="sc-sr-only" [id]="titleId">{{ title() }}</h2>
        }
        <div class="scp-b"><ng-content /></div>
        <footer class="scp-f">
          <span class="scp-acts"><ng-content select="[popupActions]" /></span>
          <span class="scp-sp"></span>
          <span class="scp-st"><ng-content select="[popupStatus]" /></span>
        </footer>
      </div>
    </ng-template>
  `,
})
export class ScPopupComponent implements OnInit, OnDestroy {
  readonly kind = input<ScPopupKind>('dialog');
  readonly title = input<string>('');
  readonly eyebrow = input<string>('');
  readonly size = input<ScPopupSize | null>(null);
  readonly access = input<ScPopupAccess>(null);
  readonly bodyFill = input(false);
  readonly float = input(false);
  readonly modal = input<boolean | null>(null);
  readonly backdrop = input<boolean | null>(null);
  readonly dialogRole = input<'dialog' | 'alertdialog'>('dialog');
  readonly initialFocus = input<'first' | 'container'>('first');
  readonly returnFocus = input<HTMLElement | null>(null);
  /** id of the element that describes the popup (a confirm's message). */
  readonly describedBy = input<string | null>(null);
  /** null = auto (large always, dialog/panel at phone width); false for a popup that owns a URL. */
  readonly backClose = input<boolean | null>(null);

  readonly closed = output<ScPopupCloseReason>();

  readonly titleId = `sc-popup-title-${++uid}`;
  /** 1 = first modal layer, 2 = a confirm over a dialog. Fixed at open. */
  readonly layer: number;

  readonly isModal = computed(() => this.modal() ?? (this.kind() === 'dialog' || this.kind() === 'large'));
  readonly hasBackdrop = computed(() => this.backdrop() ?? this.isModal());
  readonly hasHead = computed(() => this.kind() === 'panel' || this.kind() === 'dialog' || this.kind() === 'large');
  readonly showEyebrow = computed(() => this.hasHead() && !!this.eyebrow());
  readonly takesFocus = computed(() => this.kind() !== 'notice');
  readonly frameRole = computed(() => (this.kind() === 'menu' ? null : this.dialogRole()));
  readonly symbol = computed(() => KIND_SYMBOL[this.kind()]);
  readonly widthTier = computed<ScPopupSize | 'toast'>(() => {
    const k = this.kind();
    if (k === 'notice') return 'toast';
    return this.size() ?? DEFAULT_SIZE[k];
  });

  private readonly zone = inject(NgZone);
  private historyId: string | null = null;

  constructor() {
    this.layer = inject(ModalInertService).depth + 1;
    if (this.layer > 2) logWarn('popup', 'more than two modal layers: only one confirm may stand over a dialog', { layer: this.layer });
  }

  ngOnInit(): void {
    if (!this.wantsHistoryEntry()) return;
    this.historyId = pushPopupEntry(() => {
      this.historyId = null;
      this.zone.run(() => this.closed.emit('back'));
    });
  }

  ngOnDestroy(): void {
    if (this.historyId) releasePopupEntry(this.historyId);
    this.historyId = null;
  }

  /**
   * A press on the scrim (or the empty stage; the modal-inert scrim is pointer-transparent, so
   * the press lands on this host) must not move focus to <body>: the frame's keydown would never
   * fire again and Escape would go dead. Preventing the default of the mousedown keeps focus where
   * it was, inside the frame. The click itself still never closes a modal.
   */
  onHostMouseDown(ev: MouseEvent): void {
    const frame = (ev.currentTarget as HTMLElement).querySelector('.scp-frame');
    if (!this.isModal() || !frame || frame.contains(ev.target as Node)) return;
    ev.preventDefault();
    const active = document.activeElement;
    if (!active || active === document.body) (frame as HTMLElement).focus({ preventScroll: true });
  }

  private wantsHistoryEntry(): boolean {
    if (typeof window === 'undefined' || typeof history === 'undefined') return false;
    const explicit = this.backClose();
    if (explicit !== null) return explicit && this.hasHead();
    const k = this.kind();
    if (k === 'large') return true;
    if (k !== 'dialog' && k !== 'panel') return false;
    return typeof matchMedia === 'function' && matchMedia(SC_POPUP_PHONE_QUERY).matches;
  }
}
