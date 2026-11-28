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
import { isPlainLeftClick } from '../../core/modified-click.util';
import { pushPopupEntry, releasePopupEntry } from './popup-history';

/** The five popup kinds (concept 20261115-0216-popup-aufbau, r1-types). */
export type ScPopupKind = 'menu' | 'panel' | 'dialog' | 'large' | 'notice';
/** The four overlay width tiers of styles.scss "OVERLAY SIZES", plus `fill` (sized by its host). */
export type ScPopupSize = 'menu' | 's' | 'm' | 'area' | 'fill';
/** Who can reach the popup: the top edge takes the role colour (r1-role). */
export type ScPopupAccess = 'admin' | 'collab' | null;
/** Why the popup asks to close: its ✕, Escape, the browser / phone back gesture, or a click beside it (`closeBeside`). */
export type ScPopupCloseReason = 'close' | 'escape' | 'back' | 'beside';

/**
 * The safety margin around the frame for `closeBeside` (admin feedback #406, "einen halben Zentimeter"):
 * a click on the scrim within this many px of the frame's edge is a near miss and keeps the window open.
 */
export const SC_POPUP_BESIDE_MARGIN = 20;

/** A point (client px) beside the frame rect, past the safety margin on every side? */
export function isBesideFrame(
  rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  x: number,
  y: number,
  margin = SC_POPUP_BESIDE_MARGIN,
): boolean {
  return x < rect.left - margin || x > rect.right + margin || y < rect.top - margin || y > rect.bottom + margin;
}

/** The one overlay breakpoint of styles.scss: below it dialog / panel / large are full screen. */
export const SC_POPUP_PHONE_QUERY = '(max-width: 720px)';

const DEFAULT_SIZE: Record<Exclude<ScPopupKind, 'notice'>, ScPopupSize> = {
  menu: 'menu',
  panel: 's',
  dialog: 'm',
  large: 'area',
};

let uid = 0;

/**
 * `<sc-popup>` — the ONE scaffold every popup uses (concept 20261115-0216-popup-aufbau,
 * design d3 "Kommando-Spalte"). The popup fills only its content; head, ✕, footer, width,
 * scroll, scrim, focus and the role edge come from here.
 *
 * Look: a coloured rail on the left (46 px; 36 px for menu + notice) carries the popup's own symbol
 * and the vertical eyebrow (with neither it narrows to a plain accent edge, never a generic icon); title + header tools + ✕ in the head row; only the body scrolls;
 * A LIGHT popout (a non-modal panel at its trigger: wishlist, app status, missions, a coach mark) never
 * shows the rail's symbol or vertical eyebrow, only the 3 px accent edge, like a menu; an eyebrow that
 * says something (an item's name, a step count) stands as a small line above its title instead.
 * footer actions left in reading order (primary first), status text right. The rail colour is
 * the KIND, never the consequence: a delete shows its danger only on its own button
 * (`scAction tone="danger"`). All kinds share `--sc-accent`; an area may
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
 *               Not shown on menus and notices. On a light popout (non-modal panel) it is a small
 *               line above the title: pass it only when it says more than the area's name.
 * - `size`      override among the four width tokens: menu | s | m | area. Defaults: menu→menu,
 *               panel→s, dialog→m, large→area; a notice takes `--sc-toast-w`. A two-button
 *               question passes `size="s"`.
 *               `fill`: no width token, the frame fills its host (a 3D panel over a picture, a part
 *               popup): the host gives the size (and `<sc-popup>` itself `display: block; height: 100%`), `--sc-popup-radius` / `--sc-popup-border-w` on the
 *               host square it off for a full-screen use.
 * - `bodyFill`  the body is a flex column that fills the height (gap `--sc-popup-body-gap`) instead of
 *               scrolling itself: for content that owns its scroller (a table box, a viewer).
 * - `float`     a coach mark / floating card: stays a card on phones instead of going full screen
 *               (the host positions it; `--sc-popup-max-h` caps its height).
 * - `sheet`     a short question: on a phone a bottom sheet as tall as its content (rounded top, safe area,
 *               scrolls inside when taller than the screen); landscape a centred card. Desktop: unchanged.
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
 * - `closeBeside` an info window without input the user could lose (a component window, a detail,
 *               a log): a plain left click on the scrim beside the frame closes it with reason
 *               'beside', but not within `SC_POPUP_BESIDE_MARGIN` (20 px) of the frame, so a near
 *               miss keeps it open; press and release must both land out there (a drag that starts
 *               in the window never closes it). Only with a scrim of its own (`backdrop`). Default
 *               false: a window with a form, a prompt or a confirm closes only via ✕ / Abbrechen / Escape.
 *
 * Output
 * - `closed` ('close' | 'escape' | 'back' | 'beside'): the ✕, Escape, the back gesture or a click
 *   beside a `closeBeside` window. Otherwise a scrim click NEVER closes a modal, and a press on
 *   the scrim keeps focus in the frame (Escape stays alive).
 *   The host decides what closing means (remove the `@if`, resolve a promise, play
 *   `[scPopupMotion]`'s exit first).
 *
 * Slots (content projection)
 * - default          the body (the only part that scrolls).
 * - `[popupIcon]`    an `<svg>` for the rail: the icon of the trigger that opened the popup, or of the one
 *                    action it offers. No fitting icon → leave it out; there is no generic default.
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
    '(pointerdown)': 'onHostPointerDown($event)',
    '(click)': 'onHostClick($event)',
  },
  template: `
    @if (hasBackdrop()) {
      <div class="scp-scrim" aria-hidden="true"></div>
    }
    @if (takesFocus()) {
      <div
        class="scp-frame"
        scDialog
        [scDialogModal]="trapped()"
        [scDialogInert]="trapped()"
        [scDialogInitialFocus]="initialFocus()"
        [scDialogReturnFocus]="returnFocus()"
        (scDialogEscape)="closed.emit('escape')"
        [attr.data-kind]="kind()"
        [attr.data-size]="widthTier()"
        [attr.data-body]="bodyFill() ? 'fill' : null"
        [attr.data-float]="float() ? '' : null"
        [attr.data-sheet]="sheet() ? '' : null"
        [attr.data-light]="light() ? '' : null"
        [attr.data-access]="access()"
        [attr.role]="frameRole()"
        [attr.aria-modal]="trapped() ? 'true' : null"
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
        </span>
        @if (showEyebrow() && !light()) {
          <span class="scp-ev">{{ eyebrow() }}</span>
        }
      </aside>
      <div class="scp-main">
        @if (access(); as a) {
          <span class="sc-sr-only">{{ 'common.popup.access.' + a | translate }}</span>
        }
        @if (hasHead()) {
          <header class="scp-h">
            <div class="scp-hd">
              @if (showEyebrow() && light()) {
                <span class="scp-ev-in">{{ eyebrow() }}</span>
              }
              <h2 class="scp-title" [id]="titleId">{{ title() }}</h2>
            </div>
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
  /** A short question: on a phone a bottom-anchored sheet as tall as its content instead of a full screen (landscape: a centred card). */
  readonly sheet = input(false);
  readonly modal = input<boolean | null>(null);
  readonly backdrop = input<boolean | null>(null);
  readonly dialogRole = input<'dialog' | 'alertdialog'>('dialog');
  readonly initialFocus = input<'first' | 'container'>('first');
  readonly returnFocus = input<HTMLElement | null>(null);
  /** id of the element that describes the popup (a confirm's message). */
  readonly describedBy = input<string | null>(null);
  /** null = auto (large always, dialog/panel at phone width); false for a popup that owns a URL. */
  readonly backClose = input<boolean | null>(null);
  /** A click beside the frame (past the safety margin) closes it: info windows without input only. */
  readonly closeBeside = input(false);

  readonly closed = output<ScPopupCloseReason>();

  readonly titleId = `sc-popup-title-${++uid}`;
  /** 1 = first modal layer, 2 = a confirm over a dialog. Fixed at open. */
  readonly layer: number;

  readonly isModal = computed(() => this.modal() ?? (this.kind() === 'dialog' || this.kind() === 'large'));
  /** Opened at phone width: a panel is full screen there, so the page behind it is not reachable (see `trapped`). */
  private readonly phoneAtOpen = typeof matchMedia === 'function' && matchMedia(SC_POPUP_PHONE_QUERY).matches;
  /**
   * Focus is contained (Tab trap + inert page, aria-modal): every modal, and a non-modal panel / dialog
   * while it covers the whole phone screen (a floating card and a menu keep their non-modal behaviour).
   */
  readonly trapped = computed(
    () => this.isModal() || (this.phoneAtOpen && this.kind() !== 'menu' && this.kind() !== 'notice' && !this.float()),
  );
  readonly hasBackdrop = computed(() => this.backdrop() ?? this.isModal());
  readonly hasHead = computed(() => this.kind() === 'panel' || this.kind() === 'dialog' || this.kind() === 'large');
  readonly showEyebrow = computed(() => this.hasHead() && !!this.eyebrow());
  /** A light popout: a non-modal panel at its trigger. Accent edge only, no rail symbol, no vertical eyebrow. */
  readonly light = computed(() => this.kind() === 'panel' && !this.isModal() && this.widthTier() !== 'fill');
  readonly takesFocus = computed(() => this.kind() !== 'notice');
  // A menu frame is a labelled group (its items are the host's menuitems); aria-label on a role-less div is invalid.
  readonly frameRole = computed(() => (this.kind() === 'menu' ? 'group' : this.dialogRole()));
  readonly widthTier = computed<ScPopupSize | 'toast'>(() => {
    const k = this.kind();
    if (k === 'notice') return 'toast';
    return this.size() ?? DEFAULT_SIZE[k];
  });

  private readonly zone = inject(NgZone);
  private historyId: string | null = null;
  private destroyed = false;

  constructor() {
    this.layer = inject(ModalInertService).depth + 1;
    if (this.layer > 2) logWarn('popup', 'more than two modal layers: only one confirm may stand over a dialog', { layer: this.layer });
  }

  ngOnInit(): void {
    if (this.wantsHistoryEntry()) this.pushEntry();
  }

  private pushEntry(): void {
    this.historyId = pushPopupEntry(() => {
      this.historyId = null;
      this.zone.run(() => this.closed.emit('back'));
      // A host that keeps the popup open (busy, a confirm pending) ignored the back: the gesture
      // already used up our entry, so take a new one or the next Back would leave the page.
      setTimeout(() => {
        if (!this.destroyed && !this.historyId) this.pushEntry();
      });
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
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

  /** The press of the current click landed beside the frame (past the margin): only then may its click close. */
  private pressedBeside = false;

  onHostPointerDown(ev: PointerEvent): void {
    this.pressedBeside = this.isBesideClick(ev);
  }

  onHostClick(ev: MouseEvent): void {
    const pressed = this.pressedBeside;
    this.pressedBeside = false;
    if (pressed && this.isBesideClick(ev)) this.closed.emit('beside');
  }

  private isBesideClick(ev: MouseEvent): boolean {
    if (!this.closeBeside() || !this.hasBackdrop() || !isPlainLeftClick(ev)) return false;
    const host = ev.currentTarget as HTMLElement | null;
    const frame = host?.querySelector<HTMLElement>(':scope > .scp-frame');
    if (!frame || frame.contains(ev.target as Node)) return false;
    // Only a press on this popup's own scrim / stage: never one inside a nested overlay it hosts.
    if (ev.target !== host && !(ev.target as Element).classList?.contains('scp-scrim')) return false;
    return isBesideFrame(frame.getBoundingClientRect(), ev.clientX, ev.clientY);
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
