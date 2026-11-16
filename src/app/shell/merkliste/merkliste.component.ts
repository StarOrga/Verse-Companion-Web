import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { hqNachschubPickLink } from '../../hq/hq-routes';
import { NACHSCHUB_ICON_PATHS } from '../../hq/nachschub/step-icons';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScQtyStepperComponent } from '../../shared/qty-stepper/qty-stepper.component';
import { SilThumbComponent } from '../../shared/sil-thumb/sil-thumb.component';
import { WishEmptyComponent } from '../../shared/wish-sky/wish-empty.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScPopupMotionDirective } from '../../shared/popup-motion/sc-popup-motion.directive';
import type { CartItem } from '../cart/wish-cart.model';
import { WishCartService } from '../cart/wish-cart.service';
import { HeaderPopoutService } from '../header-popout.service';
import { SearchOpenService } from '../search-open.service';
import { wishRowOfType, type MerkRow } from './merkliste.model';
import { MerklisteService } from './merkliste.service';

/** How many wishes the panel lists before "Alle Wünsche". */
export const WISH_PANEL_SHOWN = 7;

const TRASH = ['M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5'] as const;

/** One row of the wishlist panel: the position (quantity, removal, Nachschub) and how it is drawn. */
interface WishLine {
  readonly item: CartItem;
  readonly row: MerkRow;
}

/**
 * `<sc-merkliste>` - the wishlist popout in the header: the heart icon only, no count. The panel is the wishlist and
 * nothing else: the newest 7 positions, each with thumbnail, name and type, a quantity stepper, "Into a Nachschub"
 * (the HQ Planen flow with exactly this position picked, `hqNachschubPickLink`) and remove (with the cart's undo
 * window); below them "Ganze Wunschliste · N Positionen" opens the cart. Recently opened pages live in the search.
 * Every row name is a real anchor. A non-modal `[scDialog]` gives focus in, Escape and focus return; opening it
 * closes the other header popouts; on phones the panel is a sheet in dvh above the feedback launcher's lane.
 */
@Component({
  selector: 'sc-merkliste',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective, ScPopupComponent, ScTooltipDirective, ScPopupMotionDirective, SilThumbComponent, ScQtyStepperComponent, WishEmptyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mk">
      <button #trigger type="button" class="trigger" [class.on]="open()" (click)="toggle()"
              aria-haspopup="dialog" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? panelId : null"
              [attr.aria-label]="'quick.wish' | translate" [scTooltip]="open() ? null : ('quick.wish' | translate)" scTooltipTier="label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          @for (d of icon; track $index) { <path [attr.d]="d" /> }
        </svg>
      </button>
      @if (open()) {
        <div class="panel" [id]="panelId" scPopupMotion scPopupMotionItems=".qrow" scPopupMotionOrigin="tr" animate.leave="pm-out">
          <!-- No rail icon, no eyebrow: at its trigger the panel carries only the accent edge, like the account menu.
               The title is the list's name; the count stands once, in the footer. -->
          <sc-popup kind="panel" [title]="'quick.wish' | translate"
                    [returnFocus]="trigger" [backClose]="false" (closed)="close()">
          @if (cart.count() === 0) {
            <sc-wish-empty (searchWish)="searchWish()" />
          } @else {
          @for (l of lines(); track l.item.key) {
            <div class="qrow">
              <a class="open" [routerLink]="l.row.target!.link" [queryParams]="l.row.target!.queryParams" [fragment]="l.row.target!.fragment ?? undefined" (click)="onOpen($event)">
                <span class="rimg sc-wish-dot"><sc-sil-thumb [kind]="l.row.kind ?? l.row.type" [className]="l.row.className ?? l.row.id" /></span>
                <span class="rt"><b>{{ l.row.title }}</b>@if (sub(l.row); as s) { <small>{{ s | translate }}</small> }</span>
              </a>
              <sc-qty-stepper class="step" [value]="l.item.qty" [groupLabel]="'cart.qtyOf' | translate: { name: l.row.title }"
                              [lessLabel]="'cart.less' | translate" [moreLabel]="'cart.more' | translate"
                              (valueChange)="bump(l.item, $event - l.item.qty)" />
              <a scAction tier="tertiary" class="move" [routerLink]="['/hq']" [fragment]="'planen'" [queryParams]="pickParams(l.item)"
                 [attr.aria-label]="'quick.toNachschub' | translate: { name: l.row.title }" [scTooltip]="'quick.toNachschub' | translate: { name: l.row.title }" scTooltipTier="label"
                 (click)="onOpen($event)">
                <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of nachschub; track $index) { <path [attr.d]="d" /> }</svg>
              </a>
              <button type="button" scAction tier="tertiary" tone="danger" class="del"
                      [attr.aria-label]="'cart.remove' | translate: { name: l.row.title }" [scTooltip]="'cart.remove' | translate: { name: l.row.title }" scTooltipTier="label"
                      (click)="cart.remove([l.item])">
                <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="trash[0]" /></svg>
              </button>
            </div>
          }
          }
          <!-- While the list is empty the popout has no footer: the empty state's one primary action is the whole offer. -->
          @if (cart.count() > 0) {
            <ng-container popupActions>
              <a scAction class="all" [attr.href]="svc.cartHref()" (click)="onCart($event)">{{ 'quick.allWish' | translate }}</a>
            </ng-container>
          }
          @if (cart.count() > 0) {
            <span popupStatus class="all-count" role="status">{{ (cart.count() === 1 ? 'quick.allWishCountOne' : 'quick.allWishCount') | translate: { n: cart.count() } }}</span>
          }
          </sc-popup>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: contents; }
      .mk { position: relative; display: inline-flex; }
      /* The header's one icon-button style: square, bordered; the Apps and the profile trigger share it. */
      .trigger {
        position: relative; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 8px;
        border: 1px solid var(--sc-border); background: transparent; color: var(--sc-accent); cursor: pointer;
      }
      .trigger svg { width: 24px; height: 24px; }
      .trigger:hover, .trigger.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .trigger.on { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 18%, transparent); }
      .trigger:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
      /* Only the position at the trigger; frame, width, head and ✕ come from <sc-popup kind="panel">. */
      .panel { position: absolute; top: calc(100% + 8px); right: 0; z-index: 60; }
      .qrow { display: grid; grid-template-columns: minmax(0, 1fr) auto 32px 32px; align-items: center; gap: 4px; min-height: 50px; padding: 2px 4px; border: 1px solid transparent; border-radius: 8px; }
      .qrow:hover, .qrow:focus-within { background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .open { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; min-height: 44px; border-radius: 8px; color: var(--sc-fg-0); text-decoration: none; }
      .open:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
      .rimg { display: block; height: 36px; padding: 3px; border-radius: 7px; color: var(--sc-fg-1); background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .rt { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
      .rt b { font-size: 0.85rem; font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
      .open:hover .rt b { color: var(--sc-accent); }
      .rt small { font-size: max(0.72rem, var(--sc-fs-floor, 0.75rem)); color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* Stepper (not an action): same look as the cart dialog's. */
      /* Touch floor of the gate: 48 px (a 44 px value measures 43), by pointer, not by width, so tablets pass too. */
      @media (pointer: coarse), (max-width: 749px) {
        .trigger { width: 48px; height: 48px; }
        .qrow { grid-template-columns: minmax(0, 1fr) auto 48px 48px; min-height: 56px; }
      }
    `,
  ],
})
export class MerklisteComponent {
  protected readonly svc = inject(MerklisteService);
  protected readonly cart = inject(WishCartService);
  private readonly popouts = inject(HeaderPopoutService);
  private readonly analytics = inject(AnalyticsService);
  private readonly searchOpen = inject(SearchOpenService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly panelId = 'sc-merkliste-panel';
  /** The trigger icon: the wishes' shooting star, the same glyph as everywhere (`PATH_ICONS.wish`). */
  protected readonly icon = PATH_ICONS.wish;
  protected readonly trash = TRASH;
  protected readonly nachschub = NACHSCHUB_ICON_PATHS;
  protected readonly open = signal(false);

  /** The newest 7 positions the panel can draw; a position without a row (unknown kind) never takes a place. */
  protected readonly lines = computed<WishLine[]>(() => {
    const out: WishLine[] = [];
    for (const item of this.cart.newest(Number.MAX_SAFE_INTEGER)) {
      const row = wishRowOfType(
        { kind: item.kind, className: item.className, name: this.cart.nameOf(item), manufacturer: item.manufacturer, qty: item.qty, forClassName: item.forClassName },
        null,
      );
      if (row) out.push({ item, row });
      if (out.length >= WISH_PANEL_SHOWN) break;
    }
    return out;
  });

  constructor() {
    // Another header popout took the slot: this one folds away.
    effect(() => {
      const active = this.popouts.active();
      if (active !== 'wishlist' && untracked(() => this.open())) this.open.set(false);
    });
  }

  protected sub(r: MerkRow): string | null {
    return r.subtitleKey ?? (r.kind ? `cart.kind.${r.kind}` : null);
  }

  protected pickParams(i: CartItem): Record<string, string> {
    return (hqNachschubPickLink([{ key: i.key, qty: i.qty }]).queryParams ?? {}) as Record<string, string>;
  }

  protected bump(i: CartItem, by: number): void {
    void this.cart.setQty(i, i.qty + by);
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.svc.refresh();
    this.popouts.claim('wishlist');
    this.open.set(true);
    this.analytics.track('hq:wishlist_open', { surface: 'popout' });
  }

  protected close(): void {
    this.open.set(false);
    this.popouts.release('wishlist');
  }

  /**
   * "Wunsch suchen" (empty state): the popout folds away first, then the search of the page the reader is on opens as if
   * they had clicked into it. After the next render, never in the same tick: on a phone the popout is a sheet that
   * holds the page inert while it stands, and a field behind it cannot take the caret until the sheet is gone.
   */
  protected searchWish(): void {
    this.analytics.track('hq:wish_search_open', { surface: 'popout' });
    this.close();
    this.searchOpen.openAfterRender();
  }

  /** A row link folds the panel away on a plain left click only; a modified click opens a tab and stays. */
  protected onOpen(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.close();
  }

  /** "Ganze Wunschliste": a real anchor to this page with `?cart=1`; the plain click opens the cart in place. */
  protected onCart(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.close();
    void this.cart.open();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(ev: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(ev.target as Node)) this.close();
  }
}
