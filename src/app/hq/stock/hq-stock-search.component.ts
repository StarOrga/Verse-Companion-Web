// #354 storage search (concept d83b72d8, round 4): the Lager-only search — fields Gegenstand, Ort, Menge; Einlagern /
// Rausnehmen in one click; one ranked list of ways for a wanted amount (flight minutes + approach); chips per place.
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AccountPrefsService } from '../../core/account-prefs.service';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { formatLocationName } from '../now/hq-live.util';
import { placeOfName } from '../plan/map/hq-places';
import type { MapPlace } from '../plan/map/hq-map.types';
import { HqHereService } from './hq-here.service';
import { MAX_STOPS_CHOICES, type MaxStops, type RoutePlan, STOCK_BALANCES, type StockBalance, minutesTo, planRoutes } from './hq-stock-route';
import { type SearchGroup, type SearchRow, itemSuggestions, knownItem, parseOrt, placeSuggestions, samePlace, searchStock } from './hq-stock-search.model';

const FILTER_PREF = 'hq.stockFilter';
const FILTER_LOCAL = 'sc.hq.stockFilter';
const SHOWN_PLANS = 4;

interface Filter {
  maxStops: MaxStops;
  balance: StockBalance;
}
const DEFAULT_FILTER: Filter = { maxStops: 3, balance: 'balanced' };

type Field = 'item' | 'ort';

@Component({
  selector: 'sc-hq-stock-search',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ss" [attr.aria-label]="'hq.bestand.lager.aria' | translate">
      <div class="fields">
        <label class="f item">
          <span class="sc-sr-only">{{ 'hq.bestand.lager.item' | translate }}</span>
          <input #qi type="search" [value]="item()" (input)="item.set(qi.value); openList('item')" (focus)="openList('item')" (blur)="closeList()"
                 (keydown)="listKey($event, 'item')" [placeholder]="'hq.bestand.lager.item' | translate" autocomplete="off"
                 role="combobox" [attr.aria-expanded]="list() === 'item' && itemSug().length > 0" aria-controls="hq-ss-item-list" />
          @if (list() === 'item' && itemSug().length) {
            <ul class="sug" id="hq-ss-item-list" role="listbox">
              @for (s of itemSug(); track s; let i = $index) {
                <li role="option" [attr.aria-selected]="active() === i" (pointerdown)="$event.preventDefault(); item.set(s); list.set(null)">{{ s }}</li>
              }
            </ul>
          }
        </label>
        <label class="f ort">
          <span class="sc-sr-only">{{ 'hq.bestand.lager.ort' | translate }}</span>
          <input #oi type="search" [value]="ort()" (input)="ort.set(oi.value); openList('ort')" (focus)="openList('ort')" (blur)="closeList()"
                 (keydown)="listKey($event, 'ort')" [placeholder]="'hq.bestand.lager.ort' | translate" autocomplete="off"
                 role="combobox" [attr.aria-expanded]="list() === 'ort' && ortSug().length > 0" aria-controls="hq-ss-ort-list" />
          @if (list() === 'ort' && ortSug().length) {
            <ul class="sug" id="hq-ss-ort-list" role="listbox">
              @for (s of ortSug(); track s; let i = $index) {
                <li role="option" [attr.aria-selected]="active() === i" (pointerdown)="$event.preventDefault(); ort.set(s); list.set(null)">{{ s }}</li>
              }
            </ul>
          }
        </label>
        <label class="f qty">
          <span class="sc-sr-only">{{ 'hq.bestand.lager.qty' | translate: { unit: unitLabel(unit()) } }}</span>
          <input #mi type="number" min="0" step="1" inputmode="decimal" [value]="want() ?? ''" (input)="setWant(mi.value)"
                 [placeholder]="'hq.bestand.lager.qty' | translate: { unit: unitLabel(unit()) }" />
        </label>
        <span class="acts">
          <button type="button" scAction tier="secondary" [busy]="busy() === 'add'" [attr.aria-disabled]="addBlock() ? 'true' : null"
                  [scTooltip]="addTip()" scTooltipTier="label" (click)="book('add')">{{ 'hq.bestand.lager.add' | translate }}</button>
          <button type="button" scAction tier="secondary" [busy]="busy() === 'out'" [attr.aria-disabled]="outBlock() ? 'true' : null"
                  [scTooltip]="outTip()" scTooltipTier="label" (click)="book('out')">{{ 'hq.bestand.lager.out' | translate }}</button>
        </span>
      </div>

      @if (active_()) {
        @if (errorKey(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }
        <p class="ref">
          @if (ref(); as r) { {{ 'hq.bestand.lager.from.' + r.why | translate: { place: r.label } }} } @else { {{ 'hq.bestand.lager.from.none' | translate }} }
        </p>

        @if ((want() ?? 0) > 0) {
          <div class="filter" role="group" [attr.aria-label]="'hq.bestand.lager.filterAria' | translate">
            <span class="grp" role="radiogroup" [attr.aria-label]="'hq.bestand.lager.maxStops' | translate">
              <span class="lbl">{{ 'hq.bestand.lager.maxStops' | translate }}</span>
              @for (n of stopChoices; track n) {
                <button type="button" role="radio" class="chip" [attr.aria-checked]="filter().maxStops === n" (click)="setFilter({ maxStops: n })">{{ n }}</button>
              }
            </span>
            <span class="grp" role="radiogroup" [attr.aria-label]="'hq.bestand.lager.balance' | translate">
              <span class="lbl">{{ 'hq.bestand.lager.balance' | translate }}</span>
              @for (b of balances; track b) {
                <button type="button" role="radio" class="chip" [attr.aria-checked]="filter().balance === b" (click)="setFilter({ balance: b })">{{ 'hq.bestand.lager.bal.' + b | translate }}</button>
              }
            </span>
          </div>
        }

        <ul class="res" [attr.aria-label]="'hq.bestand.lager.results' | translate">
          @for (g of groups(); track g.name + g.unit) {
            <li class="grow">
              <div class="gh">
                <b>{{ g.name }}</b>
                <small>{{ 'hq.bestand.lager.total' | translate: { qty: fmt(g.total, g.unit), n: g.rows.length } }}</small>
              </div>
              @if ((want() ?? 0) > 0) {
                @if (plansOf(g); as ps) {
                  @if (ps.length) {
                    <ol class="plans">
                      @for (p of (showAll().has(g.name) ? ps : ps.slice(0, shownPlans)); track $index) {
                        <li class="plan" [class.best]="$first">
                          <span class="min">
                            @if (ref()) { <b>{{ 'hq.bestand.lager.min' | translate: { n: p.minutes } }}</b>
                              <small>{{ 'hq.bestand.lager.minSplit' | translate: { fly: p.fly, appr: p.approach } }}</small> }
                          </span>
                          <span class="stops">
                            @for (s of p.stops; track s.location) {
                              <span class="stop">{{ fmt(s.take, g.unit) }} · {{ label(s.location) }}</span>
                            }
                          </span>
                          @if (p.stops.length > 1) { <small class="multi">{{ 'hq.bestand.lager.multi' | translate: { n: p.stops.length } }}</small> }
                        </li>
                      }
                    </ol>
                    @if (ps.length > shownPlans && !showAll().has(g.name)) {
                      <button type="button" scAction tier="secondary" (click)="more(g.name)">{{ 'hq.bestand.lager.more' | translate: { n: ps.length - shownPlans } }}</button>
                    }
                  } @else {
                    <p class="short">{{ 'hq.bestand.lager.short' | translate: { want: fmt(want()!, g.unit), total: fmt(g.total, g.unit) } }}</p>
                  }
                }
              }
              <div class="chips" role="group" [attr.aria-label]="'hq.bestand.lager.places' | translate: { name: g.name }">
                @for (r of ordered(g); track r.location) {
                  <button type="button" class="pchip" [attr.aria-expanded]="isOpen(r)" (click)="toggleRow(r)">
                    <b>{{ fmt(r.qty, r.unit) }}</b> {{ label(r.location) }}
                    @if (minutesOf(r.location); as m) { <small>{{ 'hq.bestand.lager.min' | translate: { n: m.fly + m.approach } }}</small> }
                  </button>
                }
              </div>
              @for (r of g.rows; track r.location) {
                @if (isOpen(r)) {
                  <div class="edit" role="group" [attr.aria-label]="'hq.bestand.lager.editAria' | translate: { name: r.name, place: label(r.location) }">
                    <span>{{ 'hq.bestand.lager.editHave' | translate: { qty: fmt(r.qty, r.unit), place: label(r.location) } }}</span>
                    <label class="f qty"><span class="sc-sr-only">{{ 'hq.bestand.lager.editAmount' | translate }}</span>
                      <input #ei type="number" min="1" step="1" inputmode="decimal" [value]="rowAmount()" (input)="rowAmount.set(+ei.value || 1)" [attr.aria-label]="'hq.bestand.lager.editAmount' | translate" /></label>
                    <button type="button" scAction tier="secondary" [busy]="busy() === 'row-add'" (click)="bookRow(r, 'add')">{{ 'hq.bestand.lager.addHere' | translate }}</button>
                    <button type="button" scAction tier="secondary" [busy]="busy() === 'row-out'" [attr.aria-disabled]="rowAmount() > r.qty ? 'true' : null"
                            [scTooltip]="rowAmount() > r.qty ? ('hq.bestand.lager.why.tooMuch' | translate: { qty: fmt(r.qty, r.unit), place: label(r.location) }) : ''" scTooltipTier="label"
                            (click)="bookRow(r, 'out')">{{ 'hq.bestand.lager.out' | translate }}</button>
                  </div>
                }
              }
            </li>
          } @empty {
            <li class="none">{{ 'hq.bestand.lager.none' | translate }}</li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .ss { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .fields { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); }
      .f { position: relative; display: flex; }
      .f.item { flex: 2 1 220px; }
      .f.ort { flex: 1 1 160px; }
      .f.qty { flex: 0 1 140px; }
      input { width: 100%; min-height: 36px; padding: 0 12px; border: 1px solid var(--sc-border); border-radius: 4px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; box-sizing: border-box; }
      input:focus-visible { outline: 1px solid transparent; border-color: var(--sc-accent); box-shadow: var(--sc-focus-ring); }
      .acts { display: inline-flex; gap: var(--sc-space-2, 8px); }
      .sug { position: absolute; z-index: 15; top: calc(100% + 4px); left: 0; right: 0; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); max-height: 280px; overflow-y: auto; }
      .sug li { display: flex; align-items: center; min-height: 36px; padding: 0 10px; border-radius: 4px; cursor: pointer; }
      .sug li:hover, .sug li[aria-selected='true'] { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
      .ref, .err, .short, .none { margin: 0; color: var(--sc-fg-2); font-size: 0.82rem; }
      .err { color: var(--sc-danger); }
      .filter { display: flex; flex-wrap: wrap; gap: var(--sc-space-3, 12px); align-items: center; }
      .grp { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-1, 4px); }
      .lbl { color: var(--sc-fg-2); font-size: 0.82rem; margin-right: 4px; }
      .chip, .pchip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); color: var(--sc-fg-2); font: inherit; font-size: 0.82rem; cursor: pointer; }
      .chip[aria-checked='true'], .pchip[aria-expanded='true'] { color: var(--sc-fg); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .chip:focus-visible, .pchip:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
      .pchip b { color: var(--sc-fg); }
      .pchip small { color: var(--sc-fg-2); }
      .res { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); margin: 0; padding: 0; list-style: none; }
      .grow { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); }
      .gh { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sc-space-2, 8px); }
      .gh small { color: var(--sc-fg-2); }
      .chips { display: flex; flex-wrap: wrap; gap: var(--sc-space-1, 4px); }
      .plans { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); margin: 0; padding: 0; list-style: none; }
      .plan { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-2, 8px); border: 1px solid var(--sc-border); border-radius: 4px; }
      .plan.best { border-color: var(--sc-accent); }
      .min { display: inline-flex; flex-direction: column; min-width: 88px; }
      .min small, .multi { color: var(--sc-fg-2); font-size: 0.82rem; }
      .stops { display: inline-flex; flex-wrap: wrap; gap: var(--sc-space-1, 4px); }
      .stop { padding: 2px 8px; border-radius: 999px; background: var(--sc-bg-0); font-size: 0.82rem; }
      .edit { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-2, 8px); border-radius: 4px; background: var(--sc-bg-0); }
      .edit .f.qty { flex: 0 0 96px; }
      @media (pointer: coarse) { input, .chip, .pchip, .sug li { min-height: 48px; } }
    `,
  ],
})
export class HqStockSearchComponent {
  private readonly inv = inject(HqInventoryService);
  private readonly here = inject(HqHereService);
  private readonly prefs = inject(AccountPrefsService);
  private readonly tr = inject(TranslateService);
  private readonly toast = inject(UndoToastService);

  /** The reader's stored locations (for the Ort suggestions). */
  readonly known = input<readonly string[]>([]);

  protected readonly stopChoices = MAX_STOPS_CHOICES;
  protected readonly balances = STOCK_BALANCES;
  protected readonly shownPlans = SHOWN_PLANS;

  protected readonly item = signal('');
  protected readonly ort = signal('');
  protected readonly want = signal<number | null>(null);
  protected readonly list = signal<Field | null>(null);
  protected readonly active = signal(-1);
  protected readonly busy = signal<string | null>(null);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly showAll = signal<ReadonlySet<string>>(new Set());
  private readonly openRow = signal<string | null>(null);
  protected readonly rowAmount = signal(1);
  protected readonly filter = signal<Filter>(readLocalFilter());

  private readonly rows = computed<SearchRow[]>(() => this.inv.items().map((r) => ({ location: r.location, name: r.name, qty: r.qty, unit: r.unit })));
  private readonly knownLocs = computed(() => [...new Set([...this.known(), ...this.rows().map((r) => r.location)])]);
  protected readonly ortValue = computed(() => parseOrt(this.ort(), this.knownLocs()));
  protected readonly active_ = computed(() => !!this.item().trim() || this.ortValue().kind !== 'none');
  protected readonly groups = computed<SearchGroup[]>(() => searchStock(this.rows(), this.item(), this.ortValue()));
  protected readonly itemSug = computed(() => itemSuggestions(this.rows(), this.item()));
  protected readonly ortSug = computed(() => placeSuggestions(this.knownLocs(), this.ort()));
  private readonly known_ = computed(() => knownItem(this.rows(), this.item()));
  protected readonly unit = computed(() => this.known_()?.unit ?? this.groups()[0]?.unit ?? 'scu');

  /** Reference point: a single place in Ort with an amount (round 3), else the Standort (decision s-link: separate). */
  protected readonly ref = computed<{ place: MapPlace | null; label: string; why: 'ort' | 'app' | 'manual' } | null>(() => {
    const o = this.ortValue();
    if (o.kind === 'place' && (this.want() ?? 0) > 0) return { place: placeOfName(o.text), label: o.text, why: 'ort' };
    const h = this.here.current();
    return h ? { place: h.place, label: h.label, why: h.source } : null;
  });

  /** Where a click on Einlagern / Rausnehmen books: a single place in Ort, else the Standort. */
  private readonly target = computed<string | null>(() => {
    const o = this.ortValue();
    if (o.kind === 'place') return this.rows().find((r) => samePlace(r.location, o.text))?.location ?? o.text;
    const h = this.here.current();
    if (!h) return null;
    return this.rows().find((r) => samePlace(r.location, h.name))?.location ?? h.label;
  });
  private readonly amount = computed(() => this.want() || 1);
  private readonly haveAtTarget = computed(() => {
    const k = this.known_();
    const t = this.target();
    if (!k || !t) return 0;
    return this.rows().find((r) => r.name === k.name && samePlace(r.location, t))?.qty ?? 0;
  });

  /** Why Einlagern is greyed (decision p-why: in the tooltip), null when it works. */
  protected readonly addBlock = computed<string | null>(() => {
    if (!this.item().trim()) return 'hq.bestand.lager.why.noItem';
    if (!this.known_()) return 'hq.bestand.lager.why.unknown';
    if (!this.target()) return 'hq.bestand.lager.why.noPlace';
    return null;
  });
  protected readonly outBlock = computed<string | null>(() => {
    const a = this.addBlock();
    if (a) return a;
    if (this.haveAtTarget() < this.amount()) return this.haveAtTarget() ? 'hq.bestand.lager.why.tooMuch' : 'hq.bestand.lager.why.nothingThere';
    return null;
  });
  protected readonly addTip = computed(() => this.tipFor(this.addBlock(), 'hq.bestand.lager.addTip'));
  protected readonly outTip = computed(() => this.tipFor(this.outBlock(), 'hq.bestand.lager.outTip'));

  constructor() {
    // Filter remembered in the account (round 3), the local copy for the instant start.
    effect(() => {
      const v = this.prefs.prefs()?.[FILTER_PREF];
      if (typeof v !== 'string') return;
      const f = parseFilter(v);
      if (f) untracked(() => this.filter.set(f));
    });
  }

  private tipFor(block: string | null, okKey: string): string {
    const k = this.known_();
    const p = {
      qty: this.fmt(this.amount(), this.unit()),
      have: this.fmt(this.haveAtTarget(), this.unit()),
      name: k?.name ?? this.item().trim(),
      place: this.target() ? formatLocationName(this.target()!) : '',
    };
    return this.tr.instant(block ?? okKey, p);
  }

  protected unitLabel(u: 'pcs' | 'scu'): string {
    return u === 'scu' ? 'SCU' : this.tr.instant('hq.stock.find.pcsUnit');
  }

  protected fmt(n: number, u: 'pcs' | 'scu'): string {
    return `${Math.round(n * 100) / 100} ${this.unitLabel(u)}`;
  }

  protected label(location: string): string {
    return formatLocationName(location);
  }

  protected setWant(v: string): void {
    const n = Number(v);
    this.want.set(Number.isFinite(n) && n > 0 ? n : null);
  }

  protected setFilter(patch: Partial<Filter>): void {
    const next = { ...this.filter(), ...patch };
    this.filter.set(next);
    const raw = JSON.stringify(next);
    try {
      localStorage.setItem(FILTER_LOCAL, raw);
    } catch {
      /* private mode */
    }
    this.prefs.set(FILTER_PREF, raw);
  }

  protected minutesOf(location: string): { fly: number; approach: number } | null {
    return minutesTo(this.ref()?.place ?? null, location);
  }

  /** Chips: nearest place first, without a reference point the largest amount (round 2). */
  protected ordered(g: SearchGroup): SearchRow[] {
    const from = this.ref()?.place ?? null;
    if (!from) return [...g.rows].sort((a, b) => b.qty - a.qty);
    const m = (r: SearchRow): number => {
      const x = minutesTo(from, r.location);
      return x ? x.fly + x.approach : Infinity;
    };
    return [...g.rows].sort((a, b) => m(a) - m(b) || b.qty - a.qty);
  }

  protected plansOf(g: SearchGroup): RoutePlan[] {
    const f = this.filter();
    return planRoutes(g.rows, this.want() ?? 0, this.ref()?.place ?? null, { maxStops: f.maxStops, balance: f.balance });
  }

  protected more(name: string): void {
    this.showAll.set(new Set([...this.showAll(), name]));
  }

  protected isOpen(r: SearchRow): boolean {
    return this.openRow() === `${r.name}\u0000${r.location}`;
  }

  protected toggleRow(r: SearchRow): void {
    const key = `${r.name}\u0000${r.location}`;
    this.openRow.set(this.openRow() === key ? null : key);
    this.rowAmount.set(this.want() || 1);
  }

  protected openList(f: Field): void {
    this.list.set(f);
    this.active.set(-1);
  }

  protected closeList(): void {
    this.list.set(null);
  }

  /** Arrows move through the suggestions, Enter / Tab take the active one, Escape closes (round 2: Tab takes a visible one). */
  protected listKey(e: KeyboardEvent, f: Field): void {
    const sug = f === 'item' ? this.itemSug() : this.ortSug();
    if (this.list() !== f || !sug.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      this.active.set((this.active() + d + sug.length) % sug.length);
    } else if ((e.key === 'Enter' || e.key === 'Tab') && (this.active() >= 0 || e.key === 'Tab')) {
      const pick = sug[Math.max(0, this.active())];
      if (e.key === 'Enter') e.preventDefault();
      (f === 'item' ? this.item : this.ort).set(pick);
      this.list.set(null);
    } else if (e.key === 'Escape') {
      this.list.set(null);
    }
  }

  protected async book(kind: 'add' | 'out'): Promise<void> {
    if ((kind === 'add' ? this.addBlock() : this.outBlock()) || this.busy()) return;
    const k = this.known_()!;
    await this.write(kind, this.target()!, k.name, this.amount(), k.unit, kind);
  }

  protected async bookRow(r: SearchRow, kind: 'add' | 'out'): Promise<void> {
    const n = this.rowAmount();
    if (this.busy() || n <= 0 || (kind === 'out' && n > r.qty)) return;
    await this.write(kind, r.location, r.name, n, r.unit, `row-${kind}`);
  }

  /** Saved at once; the toast offers the counter-booking (round 3: Rückgängig). Booking never moves the Standort. */
  private async write(kind: 'add' | 'out', location: string, name: string, qty: number, unit: 'pcs' | 'scu', busyKey: string): Promise<void> {
    this.busy.set(busyKey);
    this.errorKey.set(null);
    try {
      const ok = kind === 'add' ? await this.inv.addStock(location, name, qty, unit) : await this.inv.takeOut({ location, name }, qty);
      if (!ok) {
        this.errorKey.set(toErrorKey('hqStock', 'save', null));
        return;
      }
      this.toast.offer({
        messageKey: kind === 'add' ? 'hq.bestand.lager.doneAdd' : 'hq.bestand.lager.doneOut',
        messageParams: { qty: this.fmt(qty, unit), name, place: formatLocationName(location) },
        commit: () => undefined,
        onUndo: () => {
          void (kind === 'add' ? this.inv.removeStock(location, name, qty) : this.inv.addStock(location, name, qty, unit));
        },
      });
    } catch (err) {
      this.errorKey.set(toErrorKey('hqStock', 'save', err));
    } finally {
      this.busy.set(null);
    }
  }
}

function parseFilter(raw: string | null): Filter | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Filter>;
    const maxStops = MAX_STOPS_CHOICES.includes(o.maxStops as MaxStops) ? (o.maxStops as MaxStops) : DEFAULT_FILTER.maxStops;
    const balance = STOCK_BALANCES.includes(o.balance as StockBalance) ? (o.balance as StockBalance) : DEFAULT_FILTER.balance;
    return { maxStops, balance };
  } catch {
    return null;
  }
}

function readLocalFilter(): Filter {
  try {
    return parseFilter(typeof localStorage === 'undefined' ? null : localStorage.getItem(FILTER_LOCAL)) ?? DEFAULT_FILTER;
  } catch {
    return DEFAULT_FILTER;
  }
}
