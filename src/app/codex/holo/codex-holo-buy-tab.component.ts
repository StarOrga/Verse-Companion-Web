import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { ItemPathService, PLACE_WITH_ME } from '../../hq/data/item-path.service';
import { WishlistStore } from '../../hq/data/wishlist.store';
import { placeOfName } from '../../hq/plan/map/hq-places';
import type { MapPlace } from '../../hq/plan/map/hq-map.types';
import type { BuyOption } from '../uex-shop.service';
import { formatNumber } from '../codex-format';
import { BUY_TOP, ShopRow, WikeloNeed, groupShops, haveOf, rankShops, shopSource, toShopRows } from './codex-holo-buy';
import { foldText, fuzzyFilter } from './codex-holo-fuzzy';

type WishState = 'idle' | 'busy' | 'error';

/**
 * The "Kaufen" tab of the Holotisch-Akte (concept batch-galerie-akte-login-upload, B2): where the ship is sold
 * and for how much (UEX), the top three places nearest to the reader's HQ position (live, else the last one
 * seen; without one the places grouped star system -> planet system -> place), a typo-tolerant mini search over
 * all places, the Wikelo trade row (with how many of the needed parts the reader already holds) and, on every
 * row, "Auf die Wunschliste" which keeps the chosen source with the wish.
 */
@Component({
  selector: 'sc-codex-holo-buy-tab',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <p class="muted" role="status">{{ 'codex.holo.akte.buy.loading' | translate }}</p>
    } @else if (error()) {
      <div class="err" role="alert">
        <p>{{ 'codex.holo.akte.buy.error' | translate }}</p>
        <button scAction tier="secondary" type="button" (click)="retry.emit()"><span>{{ 'codex.holo.akte.buy.retry' | translate }}</span></button>
      </div>
    } @else {
      @if (rows().length > BUY_TOP) {
        <label class="srch">
          <span class="sc-sr-only">{{ 'codex.holo.akte.buy.searchLabel' | translate }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
          <input type="search" [value]="query()" (input)="query.set($any($event.target).value)" autocomplete="off" spellcheck="false"
                 [placeholder]="'codex.holo.akte.buy.searchPlaceholder' | translate" />
        </label>
      }
      <div class="list" tabindex="0" [attr.aria-label]="'codex.holo.akte.buy.shops' | translate">
        @if (rows().length === 0) {
          <p class="muted">{{ 'codex.holo.akte.buy.empty' | translate }}</p>
        } @else {
          <span class="gh">{{ headline() | translate: { place: hereName() } }}</span>
          @if (searching() && found().length === 0) {
            <p class="muted">{{ 'codex.holo.akte.buy.noMatch' | translate: { q: query().trim() } }}</p>
          }
          @for (r of flat(); track r.key) {
            <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: r }" />
          }
          @for (g of grouped(); track g.key) {
            <span class="gh sub">{{ g.system || '?' }}@if (g.planet) { · {{ g.planet }} }</span>
            @for (r of g.rows; track r.key) {
              <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: r }" />
            }
          }
          @if (canToggle()) {
            <button type="button" class="more" (click)="expanded.set(!expanded())" [attr.aria-expanded]="expanded()">
              {{ (expanded() ? 'codex.holo.akte.buy.showLess' : 'codex.holo.akte.buy.showAll') | translate: { n: rows().length } }}
            </button>
          }
        }
        @if (wikelo()) {
          <span class="gh">{{ 'codex.holo.akte.buy.wikelo' | translate }}</span>
          <div class="row wk" [class.done]="wishedFrom() === wikeloSource()">
            <div class="who">
              <b>{{ 'codex.holo.akte.buy.wikeloRow' | translate }}</b>
              <small>{{ 'codex.holo.akte.buy.wikeloPlace' | translate }}</small>
              @if (wikeloNeeds().length) {
                <ul class="need">
                  @for (n of wikeloNeeds(); track n.className) {
                    <li [class.ok]="have(n) >= n.qty">{{ n.qty }} × {{ n.name }} <em>{{ 'codex.holo.akte.buy.wikeloHave' | translate: { have: have(n), need: n.qty } }}</em></li>
                  }
                </ul>
              } @else {
                <small class="nd">{{ 'codex.holo.akte.buy.wikeloNoData' | translate }}</small>
              }
            </div>
            <ng-container [ngTemplateOutlet]="wishTpl" [ngTemplateOutletContext]="{ $implicit: wikeloSource(), source: 'wikelo' }" />
          </div>
        }
      </div>
      @if (note(); as n) {
        <p class="note" role="status">
          @if (n.key) { ✓ {{ n.key | translate }} }
          @if (n.undo) { <button type="button" class="undo" (click)="undoLast()">{{ 'codex.holo.akte.buy.undo' | translate }}</button> }
        </p>
      } @else {
        <p class="attr">{{ 'codex.holo.akte.buy.attribution' | translate }}</p>
      }
    }

    <ng-template #rowTpl let-r>
      <div class="row" [class.done]="wishedFrom() === shopSourceOf(r)">
        <div class="who"><b>{{ r.terminal }}</b><small>{{ r.where }}</small></div>
        <span class="price">{{ fmt(r.price) }} <small>{{ 'codex.holo.akte.buy.aUEC' | translate }}</small></span>
        <ng-container [ngTemplateOutlet]="wishTpl" [ngTemplateOutletContext]="{ $implicit: shopSourceOf(r), source: 'shop' }" />
      </div>
    </ng-template>

    <ng-template #wishTpl let-src let-source="source">
      @if (wishedFrom() === src) {
        <span class="ok">✓ {{ 'codex.holo.akte.buy.wished' | translate }}</span>
      } @else {
        <button scAction tier="secondary" type="button" [busy]="state() === 'busy'" (click)="wish(src, source)">
          <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
          <span>{{ 'codex.holo.akte.buy.wish' | translate }}</span>
        </button>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: var(--sc-space-3); min-height: 0; flex: 1 1 auto; }
    .muted { margin: 0; color: var(--sc-fg-2); font-size: max(13px, var(--sc-fs-floor)); }
    .err { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-2); color: var(--sc-danger); font-size: max(13px, var(--sc-fs-floor)); }
    .err p { margin: 0; }
    .srch { position: relative; display: flex; align-items: center; flex: 0 0 auto; }
    .srch svg { position: absolute; inset-inline-start: 10px; width: 15px; height: 15px; fill: none; stroke: var(--sc-fg-2); stroke-width: 1.8; pointer-events: none; }
    .srch input { width: 100%; box-sizing: border-box; min-height: 32px; padding: 0 12px 0 32px; border: 1px solid var(--sc-border); border-radius: 16px;
      background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); color: var(--sc-fg-0); font: inherit; font-size: max(12.5px, var(--sc-fs-floor)); }
    .srch input:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
    .list { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--sc-space-2); padding-inline-end: 2px; }
    .list:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
    .gh { font-size: max(9.5px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); margin-top: var(--sc-space-2); }
    .gh.sub { color: var(--sc-accent); letter-spacing: 0.1em; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--sc-space-1) var(--sc-space-2); padding: var(--sc-space-2);
      border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 50%, transparent); }
    .row.done { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); }
    .row.wk { grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
    .who { display: flex; flex-direction: column; min-width: 0; }
    .who b { font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .who small, .nd { font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .price { font-family: var(--sc-font-mono, monospace); font-weight: 600; font-size: max(12.5px, var(--sc-fs-floor)); color: var(--sc-fg-0); white-space: nowrap; }
    .price small { color: var(--sc-fg-2); font-weight: 400; }
    .ok { color: var(--sc-accent); font-size: max(12px, var(--sc-fs-floor)); white-space: nowrap; }
    .need { list-style: none; margin: var(--sc-space-1) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-1); font-size: max(11.5px, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .need li.ok { color: var(--sc-accent); }
    .need em { font-style: normal; color: var(--sc-fg-2); margin-inline-start: var(--sc-space-2); }
    .more, .undo { align-self: flex-start; min-height: 28px; padding: 0 4px; border: 0; background: none; color: var(--sc-accent); font: inherit; font-size: max(12px, var(--sc-fs-floor)); cursor: pointer; text-decoration: underline; }
    .more:focus-visible, .undo:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
    .note, .attr { flex: 0 0 auto; margin: 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .note { color: var(--sc-fg-1); }
    @media (max-width: 520px) { .row { grid-template-columns: minmax(0, 1fr) auto; } .row .price { grid-column: 2; grid-row: 1; } .row > :last-child:not(.who) { grid-column: 1 / -1; justify-self: start; } }
    @media (pointer: coarse) { .more, .undo { min-height: 48px; } .srch input { min-height: 48px; } }
  `],
})
export class CodexHoloBuyTabComponent {
  /** The UEX purchase options of the ship (the page's lookup). */
  readonly options = input<readonly BuyOption[]>([]);
  readonly loading = input(false);
  readonly error = input(false);
  /** Codex kind + class name + display name of the record: the wishlist entry the rows write. */
  readonly kind = input('ship');
  readonly className = input('');
  readonly name = input('');
  /** The record is a Wikelo trade item: the row shows. */
  readonly wikelo = input(false);
  /** The parts the trade asks for (when the Codex knows them), each with the reader's stock. */
  readonly wikeloNeeds = input<readonly WikeloNeed[]>([]);
  readonly retry = output<void>();

  private readonly wishlist = inject(WishlistStore);
  private readonly itemPath = inject(ItemPathService);
  private readonly inventory = inject(HqInventoryService);
  private readonly analytics = inject(AnalyticsService);
  private readonly t = inject(TranslateService);

  protected readonly BUY_TOP = BUY_TOP;
  readonly query = signal('');
  readonly expanded = signal(false);
  protected readonly state = signal<WishState>('idle');
  protected readonly note = signal<{ key: string; undo: (() => Promise<void>) | null } | null>(null);

  readonly rows = computed<ShopRow[]>(() => toShopRows(this.options()));

  /** The last place HQ saw the reader at (live state), asked once. */
  private readonly lastSeen = signal<MapPlace | null>(null);
  /** The reader's HQ position: live while the game runs, else the last one HQ saw. */
  private readonly here = computed<MapPlace | null>(() => {
    const live = this.itemPath.currentPlaceDefault();
    return (live && live !== PLACE_WITH_ME ? placeOfName(live) : null) ?? this.lastSeen();
  });
  protected readonly hereName = computed(() => this.here()?.location ?? '');

  protected readonly searching = computed(() => foldText(this.query()) !== '');
  protected readonly found = computed(() =>
    fuzzyFilter(this.query(), rankShops(this.rows(), this.here()), (r) => `${r.terminal} ${r.where} ${r.system} ${r.planet ?? ''}`),
  );
  /** A search or the nearest top three: one flat list. */
  protected readonly flat = computed<ShopRow[]>(() => {
    if (this.searching()) return this.found();
    const here = this.here();
    return here && !this.expanded() ? rankShops(this.rows(), here).slice(0, BUY_TOP) : [];
  });
  /** No search and no position (or all places asked for): grouped star system -> planet system -> place. */
  protected readonly grouped = computed(() => (this.searching() || this.flat().length > 0 ? [] : groupShops(this.rows())));
  protected readonly canToggle = computed(() => !this.searching() && !!this.here() && this.rows().length > BUY_TOP);
  protected readonly headline = computed(() =>
    this.searching() ? 'codex.holo.akte.buy.shops' : this.here() ? (this.expanded() ? 'codex.holo.akte.buy.grouped' : 'codex.holo.akte.buy.nearest') : 'codex.holo.akte.buy.grouped',
  );

  /** The source the ship's wish currently carries (notes), null when it is not on the list. */
  protected readonly wishedFrom = computed(() => this.wishlist.find(this.kind(), this.className(), this.name())?.notes ?? null);
  protected wikeloSource(): string {
    return this.t.instant('codex.holo.akte.buy.wikeloSource') as string;
  }
  protected shopSourceOf(r: ShopRow): string {
    return shopSource(r);
  }

  constructor() {
    void this.wishlist.ensureLoaded();
    void this.inventory.load();
    void this.inventory.lastKnownLocation().then((l) => {
      if (l) this.lastSeen.set(placeOfName(l.name, l.system));
    });
  }

  protected have(n: WikeloNeed): number {
    return haveOf(n, this.inventory.items());
  }

  protected fmt(n: number): string {
    return formatNumber(n);
  }

  /** Put the ship on the wishlist with `src` as where it is bought; an existing wish only changes its source. */
  protected async wish(src: string, source: 'shop' | 'wikelo'): Promise<void> {
    if (this.state() === 'busy') return;
    const entry = { kind: this.kind(), className: this.className(), name: this.name() };
    const before = this.wishlist.find(entry.kind, entry.className, entry.name);
    this.state.set('busy');
    let ok = false;
    try {
      ok = await this.wishlist.setNotes(entry, src);
    } finally {
      this.state.set(ok ? 'idle' : 'error');
    }
    if (!ok) {
      this.note.set({ key: 'codex.holo.akte.buy.wishError', undo: null });
      return;
    }
    this.analytics.track('codex:wish_add', { kind: entry.kind, source });
    const undo = async (): Promise<void> => {
      if (before) await this.wishlist.setNotes(entry, before.notes);
      else await this.wishlist.remove(entry.kind, entry.className, entry.name);
      this.note.set(null);
    };
    this.note.set({ key: 'codex.holo.akte.buy.wished', undo });
  }

  protected async undoLast(): Promise<void> {
    await this.note()?.undo?.();
  }
}
