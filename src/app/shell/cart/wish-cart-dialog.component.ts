import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { polyHitLink, type PolyHitKind } from '../../codex/codex-poly-search';
import { AnalyticsService } from '../../core/analytics.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { hqNachschubPickLink } from '../../hq/hq-routes';
import { pickedShare, setPicked, toggleGroup, type FlowGroup } from '../../hq/plan/hq-nachschub-flow.util';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScQtyStepperComponent } from '../../shared/qty-stepper/qty-stepper.component';
import { ScEntryDirective } from '../../shared/entry-motion/entry-motion';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { SilThumbComponent } from '../../shared/sil-thumb/sil-thumb.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { WishEmptyComponent } from '../../shared/wish-sky/wish-empty.component';
import { WishSkyComponent } from '../../shared/wish-sky/wish-sky.component';
import { NachschubService } from '../../hq/nachschub/nachschub.service';
import { NACHSCHUB_ICON_PATHS } from '../../hq/nachschub/step-icons';
import type { Recommendation } from '../../hq/nachschub/recommend';
import type { CartItem } from './wish-cart.model';
import { SearchOpenService } from '../search-open.service';
import { WishCartService } from './wish-cart.service';

const TRASH = ['M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5'] as const;
const PLUS = ['M12 5v14M5 12h14'] as const;
const CLOSE = ['M6 6l12 12M18 6L6 18'] as const;
const OPEN = ['M14 5h5v5M19 5l-8 8M17 14v5H5V7h5'] as const;

/**
 * `<sc-wish-cart>` - the Warenkorb (concept nachschub-hq, r4-d1-s2). The wishlist as a dialog with its own URL
 * (`?cart=1`, opened through {@link WishCartService}): grouped (Waffen first, craft groups last), a checkbox per group and
 * per position, larger silhouettes that are never stretched, a stepper and a red trash per position and per group
 * (undo toast, no question), the "Passt dazu" row with 3 suggestions, and one primary "In einen Nachschub" that carries
 * the selection to HQ Planen.
 */
@Component({
  selector: 'sc-wish-cart',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective, ScPopupComponent, ScEntryDirective, ScTooltipDirective, SilThumbComponent, ScQtyStepperComponent, WishEmptyComponent, WishSkyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The scrim does not close the cart (a selection would be lost): the X, Escape or the browser's back do. The cart owns ?cart=1, so no extra history entry. -->
    <sc-popup kind="large" [scEntry]="'cart'" [eyebrow]="'hq.title' | translate" [title]="'cart.title' | translate" [backClose]="false" (closed)="cart.close()" data-cart>
      <svg popupIcon viewBox="0 0 24 24">@for (d of wishPath; track $index) { <path [attr.d]="d" /> }</svg>
      <div class="cart-body">
          @if (cart.count() === 0) {
            <sc-wish-empty (searchWish)="searchWish()" />
          } @else {
            <sc-wish-sky class="strip" variant="strip" />
            <div class="groups">
              @for (g of cart.groups(); track g.id) {
                <section class="group ce" [class.bp]="g.type === 'blueprint'" [style.--n]="span(g)" [style.--ce]="$index + 1" [attr.aria-label]="groupTitle(g)">
                  <h3 class="g-head">
                    <input type="checkbox" class="chk" [checked]="share(g) === 1" [indeterminate]="share(g) === 0.5"
                           [attr.aria-label]="'cart.selectGroup' | translate: { name: groupTitle(g) }" (change)="onGroup(g)" />
                    @if (g.type === 'blueprint') { <span class="bp-node" aria-hidden="true"></span> }
                    <span class="g-name">{{ groupTitle(g) }}</span>
                    <small>{{ g.type === 'blueprint' && g.blueprint ? ('cart.blueprintQty' | translate: { n: g.blueprint.qty, name: blueprintName(g) }) : g.rows.length }}</small>
                    <button type="button" scAction tier="tertiary" tone="danger" class="g-trash"
                            [attr.aria-label]="'cart.removeGroup' | translate: { name: groupTitle(g) }"
                            [scTooltip]="'cart.removeGroup' | translate: { name: groupTitle(g) }" scTooltipTier="label" (click)="removeGroup(g)">
                      <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="trash[0]" /></svg>
                    </button>
                  </h3>
                  <div class="tiles">
                    @for (r of g.rows; track r.key) {
                      @let it = cart.byKey().get(r.key);
                      @if (it) {
                        @let chkId = 'cart-chk-' + g.id + '-' + $index;
                        <div class="tile" [class.sel]="(picks().get(r.key) ?? 0) > 0">
                          <input type="checkbox" class="chk tile-chk" [id]="chkId" [checked]="(picks().get(r.key) ?? 0) > 0"
                                 [attr.aria-label]="'cart.select' | translate: { name: cart.nameOf(it) }" (change)="onTile(g, r.key, r.qty)" />
                          <!-- A click on the picture or the name ticks the position (the label of its checkbox); the Codex page is the arrow. -->
                          <label class="pickarea" [for]="chkId">
                            <span class="sil sc-wish-dot"><sc-sil-thumb [kind]="it.kind" [className]="it.className" /></span>
                            <span class="nm">{{ cart.nameOf(it) }}</span>
                            <small class="sub">{{ ('cart.kind.' + kindKey(it)) | translate }}@if (it.manufacturer) { · {{ it.manufacturer }} }</small>
                          </label>
                          <a scAction tier="tertiary" class="open" [routerLink]="link(it)" (click)="onOpen($event)"
                             [attr.aria-label]="'cart.open' | translate: { name: cart.nameOf(it) }" [scTooltip]="'cart.open' | translate: { name: cart.nameOf(it) }" scTooltipTier="label">
                            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="openIcon[0]" /></svg>
                          </a>
                          <span class="foot">
                            <sc-qty-stepper class="step" [value]="it.qty" [groupLabel]="'cart.qtyOf' | translate: { name: cart.nameOf(it) }"
                                            [lessLabel]="'cart.less' | translate" [moreLabel]="'cart.more' | translate"
                                            [highlight]="cart.flashed() === it.key" (valueChange)="bump(it, $event - it.qty)">
                              {{ it.qty }}@if (it.kind === 'material') { <small class="unit"> {{ 'blueprint.detail.unitScu' | translate }}</small> }
                            </sc-qty-stepper>
                            <button type="button" scAction tier="tertiary" tone="danger"
                                    [attr.aria-label]="'cart.remove' | translate: { name: cart.nameOf(it) }"
                                    [scTooltip]="'cart.remove' | translate: { name: cart.nameOf(it) }" scTooltipTier="label" (click)="cart.remove([it])">
                              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="trash[0]" /></svg>
                            </button>
                          </span>
                        </div>
                      }
                    }
                  </div>
                </section>
              }
            </div>

          }
        </div>

      @if (cart.suggestions().length) {
        <section class="sugs ce" style="--ce: 5" [attr.aria-label]="'cart.suggest.title' | translate">
          <h3 class="s-head">{{ 'cart.suggest.title' | translate }} <small>{{ 'cart.suggest.count' | translate: { n: cart.suggestions().length } }}</small></h3>
          <div class="s-row">
            @for (s of cart.suggestions(); track s.className) {
              <div class="sug">
                <span class="sug-img"><sc-sil-thumb [kind]="sugKind(s)" [className]="s.className" /></span>
                <span class="sug-t">
                  <b>{{ s.name }}</b>
                  <span class="reason">{{ ('hq.nachschub.rec.reason.' + s.reason) | translate: s.params }}</span>
                  <span class="sug-act">
                    <button type="button" scAction tier="secondary" (click)="addSug(s)">
                      <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="plus[0]" /></svg>
                      <span>{{ 'cart.suggest.add' | translate }}</span>
                    </button>
                    <button type="button" scAction tier="tertiary" [attr.aria-label]="'cart.suggest.dismiss' | translate: { name: s.name }"
                            [scTooltip]="'cart.suggest.dismiss' | translate: { name: s.name }" scTooltipTier="label" (click)="cart.dismiss(s.className)">
                      <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="close[0]" /></svg>
                    </button>
                  </span>
                </span>
              </div>
            }
          </div>
        </section>
      }

      <!-- While the list is empty the window has no footer: its one primary action is the empty state's "Wunsch suchen". -->
      @if (cart.count() > 0) {
      <ng-container popupActions>
        <a scAction tier="primary" class="go" [class.off]="picks().size === 0" [attr.aria-disabled]="picks().size === 0 ? 'true' : null" [attr.role]="picks().size === 0 ? 'link' : null"
           [routerLink]="picks().size === 0 ? null : ['/hq']" [fragment]="'planen'" [queryParams]="pickParams()" (click)="onGo($event)">
          <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of nachschubPath; track $index) { <path [attr.d]="d" /> }</svg>
          <span>{{ (ns.newBlock() ? 'cart.toExisting' : 'cart.toNachschub') | translate }}</span>
        </a>
        <button type="button" scAction tier="secondary" [disabled]="picks().size === 0" (click)="picks.set(emptyPicks)"><span>{{ 'cart.clear' | translate }}</span></button>
      </ng-container>
      }
      @if (cart.count() > 0) {
      <span popupStatus class="cart-status">
        <span class="cart-sum">{{ summaryKey() | translate: { n: cart.count(), g: cart.groups().length } }}</span>
        <span class="sel-count" role="status"><b>{{ selectedCount() }}</b> {{ 'cart.selected' | translate }}</span>
        @if (ns.newBlock()) {
          <span class="full-hint" role="status">{{ 'cart.slotsFullHint' | translate }}</span>
        }
      </span>
      }
    </sc-popup>
  `,
  styles: [
    `
      :host { display: contents; }
      .cart-status { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; justify-content: flex-end; }
      .cart-sum { color: var(--sc-fg-2); }
      .full-hint { color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor, 0.75rem)); max-width: 46ch; }
      .cart-body { display: flex; flex-direction: column; gap: var(--sc-space-4); }
      .groups { flex: none; }
      .sugs { flex: none; margin-top: var(--sc-space-4); }
      .groups { display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch; }
      .group {
        --n: 1; flex: var(--n) 1 calc(var(--n) * 168px); min-width: min(100%, 168px); display: flex; flex-direction: column;
        padding: 4px 8px 8px; border: 1px solid var(--sc-border); border-radius: 12px; background: color-mix(in srgb, var(--sc-bg-0) 40%, transparent);
      }
      .g-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; margin: 0; min-height: 40px; font: 600 0.78rem/1.2 var(--sc-font-display, inherit); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-accent); }
      .g-head small { font: 500 0.78rem var(--sc-font-body, inherit); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); }
      .g-name { min-width: 0; overflow-wrap: break-word; }
      .g-trash { margin-left: auto; }
      .bp-node { width: 9px; height: 9px; flex: none; border-radius: 2px; transform: rotate(45deg); border: 1.5px solid var(--sc-accent); }
      .tiles { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 8px; }
      .tile { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 8px; border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-1) 85%, transparent); min-width: 0; }
      .tile.sel { border-color: var(--sc-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--sc-accent) 25%, transparent); }
      .tile-chk { position: absolute; top: 8px; left: 8px; z-index: 1; }
      .pickarea { display: flex; flex-direction: column; gap: 2px; min-width: 0; cursor: pointer; }
      .open { position: absolute; top: 4px; right: 4px; z-index: 1; }
      .sil { display: block; height: 96px; margin-bottom: 4px; padding: 10px 8px; border-radius: 8px; color: var(--sc-fg-1);
        background: radial-gradient(ellipse at 50% 80%, color-mix(in srgb, var(--sc-accent) 14%, transparent), transparent 70%), color-mix(in srgb, var(--sc-accent) 4%, transparent); }
      .pickarea:hover .sil { background-color: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      /* The wish star sits bottom right on a tile: the top right corner belongs to the open arrow. */
      .sil.sc-wish-dot::after { top: auto; right: 6px; bottom: 6px; }
      .nm { font-size: 0.82rem; font-weight: 600; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: max(0.72rem, var(--sc-fs-floor, 0.75rem)); color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .foot { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; gap: 4px; }
      .chk {
        appearance: none; -webkit-appearance: none; width: 20px; height: 20px; flex: none; margin: 0; display: grid; place-content: center; cursor: pointer;
        border: 1.5px solid color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); border-radius: 6px; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
      }
      .chk:checked, .chk:indeterminate { background: var(--sc-accent); border-color: var(--sc-accent); }
      .chk:checked::after { content: ''; width: 5px; height: 10px; border: solid var(--sc-bg-0); border-width: 0 2.4px 2.4px 0; transform: translateY(-1px) rotate(45deg); }
      .chk:indeterminate::after { content: ''; width: 10px; height: 2.4px; background: var(--sc-bg-0); border-radius: 2px; }
      .chk:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
      .sugs { padding: var(--sc-space-3) var(--sc-space-4); border: 1px solid color-mix(in srgb, var(--sc-warning) 35%, transparent); border-radius: 12px; background: linear-gradient(90deg, color-mix(in srgb, var(--sc-warning) 7%, transparent), transparent); }
      .s-head { margin: 0 0 8px; font: 600 0.78rem/1.2 var(--sc-font-display, inherit); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-warning); }
      .s-head small { font: 500 0.78rem var(--sc-font-body, inherit); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); margin-left: 6px; }
      .s-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .sug { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 50%, transparent); }
      .sug-img { display: block; height: 64px; padding: 4px; border-radius: 7px; background: color-mix(in srgb, var(--sc-accent) 6%, transparent); color: var(--sc-fg-1); }
      .sug-t { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; }
      .sug-t b { font-size: 0.85rem; overflow-wrap: anywhere; }
      .reason { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sc-warning) 14%, transparent); font-size: 0.74rem; color: var(--sc-warning); }
      .sug-act { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .sel-count { font-size: 0.85rem; color: var(--sc-fg-1); }
      .sel-count b { color: var(--sc-accent); font-variant-numeric: tabular-nums; }
      .go.off { opacity: 0.45; cursor: default; }
      .strip { margin-bottom: 12px; }
      @media (max-width: 900px) {
        .group { flex-basis: 100%; }
        .s-row { grid-template-columns: 1fr; }
      }
      /* Phone: 1-2 tile columns instead of --n, so the stepper + remove row fits a tile. */
      @media (max-width: 749px) {
        .tiles { grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); }
      }
      @media (pointer: coarse), (max-width: 749px) {
        .foot { flex-wrap: wrap; }
        .chk { width: 24px; height: 24px; }
      }
    `,
  ],
})
export class WishCartDialogComponent {
  protected readonly cart = inject(WishCartService);
  /** `newBlock()` is set while all 7 slots are taken: the selection can then only join an existing Nachschub. */
  protected readonly ns = inject(NachschubService);

  protected readonly wishPath = PATH_ICONS.wish;
  protected readonly nachschubPath = NACHSCHUB_ICON_PATHS;
  protected readonly trash = TRASH;
  protected readonly plus = PLUS;
  protected readonly close = CLOSE;
  protected readonly openIcon = OPEN;
  protected readonly emptyPicks: ReadonlyMap<string, number> = new Map();

  private readonly analytics = inject(AnalyticsService);
  private readonly searchOpen = inject(SearchOpenService);

  /** The selection: position key -> picked quantity (the whole quantity unless a split was made in Planen). */
  protected readonly picks = signal<ReadonlyMap<string, number>>(this.emptyPicks);
  /** "1 Position · 1 Gruppe", "5 Positionen · 1 Gruppe", else the plural form. */
  protected readonly summaryKey = computed(() =>
    this.cart.count() === 1 ? 'cart.summaryOne' : this.cart.groups().length === 1 ? 'cart.summaryOneGroup' : 'cart.summary',
  );
  protected readonly selectedCount = computed(() => this.picks().size);
  protected readonly pickParams = computed(() => hqNachschubPickLink([...this.picks()].map(([key, qty]) => ({ key, qty }))).queryParams ?? {});

  constructor() {
    this.analytics.track('hq:wishlist_open', { surface: 'cart' });
    this.cart.ensureCatalogue();
    void this.ns.ensureLoaded();
    // A removed position drops out of the selection.
    effect(() => {
      const have = this.cart.byKey();
      const cur = this.picks();
      if ([...cur.keys()].some((k) => !have.has(k))) this.picks.set(new Map([...cur].filter(([k]) => have.has(k))));
    });
  }

  protected span(g: FlowGroup): number {
    return Math.min(3, Math.max(1, g.rows.length));
  }

  protected share(g: FlowGroup): number {
    return pickedShare(g.rows, this.picks());
  }

  private readonly translate = inject(TranslateService);

  /** "Waffen", "Rüstung", ... or, for a blueprint group, "für Gallant craften" (the blueprint's catalogue name). */
  protected groupTitle(g: FlowGroup): string {
    if (g.type !== 'blueprint') return g.titleKey ? this.translate.instant(g.titleKey) : '';
    const className = g.blueprint?.className ?? g.rows.find((r) => r.forClassName)?.forClassName ?? '';
    const name = this.cart.nameOf({ kind: 'blueprint', className, name: g.blueprint?.name ?? null });
    return this.translate.instant('cart.forBlueprint', { name });
  }

  protected blueprintName(g: FlowGroup): string {
    const className = g.blueprint?.className ?? g.rows.find((r) => r.forClassName)?.forClassName ?? '';
    return this.cart.nameOf({ kind: 'blueprint', className, name: g.blueprint?.name ?? null });
  }

  protected onGroup(g: FlowGroup): void {
    this.picks.set(toggleGroup(g, this.picks()));
  }

  protected onTile(g: FlowGroup, key: string, qty: number): void {
    const on = (this.picks().get(key) ?? 0) > 0;
    this.picks.set(setPicked(g, this.picks(), key, on ? 0 : qty));
  }

  protected removeGroup(g: FlowGroup): void {
    const items = g.rows.map((r) => this.cart.byKey().get(r.key)).filter((i): i is CartItem => !!i);
    this.cart.remove(items, 'cart.removedGroup', { name: this.groupTitle(g), n: items.length });
  }

  protected bump(i: CartItem, by: number): void {
    void this.cart.setQty(i, i.qty + by);
    // A picked position follows its new quantity.
    const have = this.picks().get(i.key);
    if (have !== undefined) this.picks.update((m) => new Map(m).set(i.key, Math.min(999, Math.max(1, i.qty + by))));
  }

  protected link(i: CartItem): string[] {
    return polyHitLink({ kind: (i.kind === 'upcoming' ? 'upcoming' : i.kind) as PolyHitKind, classNameSlug: i.className });
  }

  protected kindKey(i: CartItem): string {
    return ['ship', 'vehicle', 'upcoming', 'weapon', 'component', 'item', 'blueprint', 'material', 'ammunition'].includes(i.kind) ? i.kind : 'item';
  }

  protected sugKind(s: Recommendation): string {
    return s.bucket === 'weapon' ? 'weapon' : 'item';
  }

  protected addSug(s: Recommendation): void {
    void this.cart.addSuggestion(s);
  }

  /** The Codex page of a position: a plain click leaves the cart for it, a modified click opens a tab and keeps it. */
  protected onOpen(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) void this.cart.close();
  }

  /**
   * "Wunsch suchen" (empty state): the window closes first (while it stands the page is inert and no field behind it
   * could take the caret), then the search of the page the reader is on opens as if they had clicked into it.
   */
  protected searchWish(): void {
    this.analytics.track('hq:wish_search_open', { surface: 'cart' });
    void this.cart.close().then(() => this.searchOpen.openAfterRender());
  }

  protected onGo(ev: MouseEvent): void {
    if (this.picks().size === 0) ev.preventDefault();
  }
}
