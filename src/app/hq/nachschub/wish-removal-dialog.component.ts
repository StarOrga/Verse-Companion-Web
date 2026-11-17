import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScQtyStepperComponent } from '../../shared/qty-stepper/qty-stepper.component';
import type { RemovalPart, RemovalPlan } from './nachschub.model';
import { NachschubService, type WishRef } from './nachschub.service';
import { barSegments, hangingIds } from './wish-removal-bar';

/** What the user chose in the removal dialog; null (the `closed` value) = cancelled. */
export interface WishRemovalChoice {
  readonly qty: number;
  /** Only when the user shifted the split over the Operationen. */
  readonly split?: Readonly<Record<string, number>>;
  /** Operationen the user ticked "auch auflösen" for (those dissolved without asking come from the plan). */
  readonly dissolve: readonly string[];
}

/**
 * The ONE dialog for lowering or removing a wish that is (partly) assigned to an Operation (C1-C6): title, "how many"
 * stepper, the caption "Diese N Stücke gehen:" and a segmented, self-labelled bar; with several Operationen a stepper
 * row each and the sum line; for a last wish the hint, the unticked "Operation auch auflösen" or - for an Operation
 * without Einsatz - the danger hint and the danger action. Opened by `WishRemovalFlowService` (a `sc-popup` in a CDK
 * overlay, like ScConfirmService); a modal, so only the ✕, Abbrechen or Escape close it. On a phone `sc-popup` is a
 * full-height sheet in dvh whose body scrolls.
 */
@Component({
  selector: 'sc-wish-removal-dialog',
  standalone: true,
  imports: [TranslatePipe, ScPopupComponent, ScActionDirective, ScQtyStepperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="wr" (submit)="submit($event)">
      <sc-popup kind="dialog" size="s" dialogRole="alertdialog" [backdrop]="false"
                [title]="'wishRemoval.title' | translate: { name: name() }" (closed)="closed.emit(null)">
        <div class="wr-body">
          <div class="wr-how">
            <span class="wr-lbl" [id]="howId">{{ 'wishRemoval.howMany' | translate }}</span>
            <sc-qty-stepper class="wr-step" [value]="qty()" [min]="1" [max]="wished()" [groupLabel]="'wishRemoval.howMany' | translate"
                            [lessLabel]="'cart.less' | translate" [moreLabel]="'cart.more' | translate" (valueChange)="setQty($event)" />
            <span class="wr-of">{{ 'wishRemoval.of' | translate: { n: wished() } }}</span>
          </div>

          <div class="wr-what">
            <span class="wr-cap" [id]="capId">{{ (qty() === 1 ? 'wishRemoval.captionOne' : 'wishRemoval.caption') | translate: { n: qty() } }}</span>
            <ul #bar class="wr-bar" [class.has-out]="hanging().size > 0" role="list" [attr.aria-labelledby]="capId">
              @for (s of segments(); track s.id) {
                <li class="wr-sg" [class.out]="hanging().has(s.id)" [class.op]="s.kind === 'op'" [style.--w]="s.qty">
                  @if (s.kind === 'op') {
                    <svg class="wr-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of route; track $index) { <path [attr.d]="d" /> }</svg>
                  }
                  <span class="wr-sl">{{ labelOf(s.id) }}</span>
                </li>
              }
            </ul>
          </div>

          @if (rows().length > 1) {
            <div class="wr-rows">
              @for (r of rows(); track r.packageId; let first = $first) {
                <div class="wr-row">
                  <svg class="wr-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of route; track $index) { <path [attr.d]="d" /> }</svg>
                  <span class="wr-rn"><b>{{ r.packageName }}</b>@if (first) { <small>{{ 'wishRemoval.latest' | translate }}</small> }</span>
                  <sc-qty-stepper [value]="partQty(r)" [min]="0" [max]="r.max" [groupLabel]="'wishRemoval.rowLabel' | translate: { name: r.packageName }"
                                  [lessLabel]="'cart.less' | translate" [moreLabel]="'cart.more' | translate" (valueChange)="setPart(r, $event)" />
                  <span class="wr-of">{{ 'wishRemoval.of' | translate: { n: r.max } }}</span>
                </div>
              }
              <span class="wr-sum" [class.bad]="!splitOk()" role="status">{{ 'wishRemoval.sum' | translate: { done: sumDone(), total: total() } }}</span>
            </div>
          }

          @for (p of dissolving(); track p.packageId) {
            <p class="wr-hint dng" role="note">
              <svg class="wr-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of route; track $index) { <path [attr.d]="d" /> }</svg>
              <span>{{ 'wishRemoval.dissolves' | translate: { name: p.packageName } }}</span>
            </p>
          }
          @for (p of staying(); track p.packageId) {
            <p class="wr-hint" role="note">
              <svg class="wr-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of route; track $index) { <path [attr.d]="d" /> }</svg>
              <span>{{ (p.einsaetze === 1 ? 'wishRemoval.lastStaysOne' : 'wishRemoval.lastStays') | translate: { name: p.packageName, n: p.einsaetze } }}</span>
            </p>
            <label class="wr-chk">
              <input type="checkbox" [checked]="ticked().has(p.packageId)" (change)="tick(p.packageId, $any($event.target).checked)" />
              <span class="wr-box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
              <span>{{ (staying().length > 1 ? 'wishRemoval.alsoDissolveNamed' : 'wishRemoval.alsoDissolve') | translate: { name: p.packageName } }}</span>
            </label>
          }
          @if (keeps() > 0) {
            <span class="wr-mut">{{ (keeps() > 1 ? 'wishRemoval.keepsMany' : 'wishRemoval.keeps') | translate }}</span>
          }
        </div>
        <ng-container popupActions>
          <button scAction tier="primary" [tone]="danger() ? 'danger' : 'default'" type="submit" class="confirm" [disabled]="!splitOk()">
            {{ (dissolveAny() ? 'wishRemoval.confirmDissolve' : 'wishRemoval.confirm') | translate: { n: qty() } }}
          </button>
          <button scAction tier="secondary" type="button" class="cancel" (click)="closed.emit(null)">{{ 'common.dialog.cancel' | translate }}</button>
        </ng-container>
      </sc-popup>
    </form>
  `,
  styles: [`
    :host { display: block; }
    .wr { margin: 0; }
    .wr-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .wr-how { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
    .wr-lbl { flex: 1 1 auto; color: var(--sc-fg-0); font-weight: 600; }
    .wr-of { color: var(--sc-fg-2); font-size: 0.8125rem; white-space: nowrap; }
    .wr-what { display: flex; flex-direction: column; gap: 8px; }
    .wr-cap { color: var(--sc-fg-1); font-size: 0.8125rem; font-weight: 600; }
    .wr-i { flex: none; inline-size: 14px; block-size: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--sc-accent); }
    /* One bar, one style: every segment has the same background and border; the Route icon and the text mark an Operation. */
    .wr-bar { display: flex; gap: 3px; min-width: 0; margin: 0; padding: 0; list-style: none; }
    .wr-bar.has-out { margin-block-end: 28px; }
    .wr-sg { position: relative; flex: var(--w) 1 0; min-inline-size: 56px; display: flex; align-items: center; gap: 6px; block-size: 30px; padding: 0 10px;
      border: 1px solid var(--sc-border); border-radius: 6px; background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
      color: var(--sc-fg-1); font-size: 0.75rem; font-weight: 500; white-space: nowrap; overflow: hidden; }
    .wr-sl { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
    /* A label that does not fit hangs under its segment on a tick. */
    .wr-sg.out { overflow: visible; justify-content: center; }
    .wr-sg.out > .wr-sl { position: absolute; inset-block-start: calc(100% + 8px); inset-inline-end: 0; overflow: visible; color: var(--sc-fg-1); }
    .wr-sg.out::after { content: ''; position: absolute; inset-block-start: 100%; inset-inline-start: 50%; inline-size: 1px; block-size: 7px; background: var(--sc-accent); }
    .wr-rows { display: flex; flex-direction: column; gap: 6px; }
    .wr-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 6px 10px; border: 1px solid var(--sc-border); border-radius: 8px; }
    .wr-rn { flex: 1 1 8rem; min-inline-size: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
    .wr-rn b { color: var(--sc-fg-0); font-weight: 500; }
    .wr-rn small { color: var(--sc-fg-2); font-size: 0.75rem; }
    .wr-sum { color: var(--sc-fg-1); font-size: 0.8125rem; font-weight: 600; }
    .wr-sum.bad { color: var(--sc-warning); }
    .wr-hint { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 10px; border-inline-start: 2px solid var(--sc-accent);
      border-radius: 0 8px 8px 0; background: color-mix(in srgb, var(--sc-accent) 8%, transparent); color: var(--sc-fg-0); font-size: 0.8125rem; overflow-wrap: anywhere; }
    .wr-hint .wr-i { margin-block-start: 2px; }
    .wr-hint.dng { border-inline-start-color: var(--sc-danger); background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .wr-hint.dng .wr-i { color: var(--sc-danger); }
    .wr-mut { color: var(--sc-fg-2); font-size: 0.8125rem; }
    .wr-chk { position: relative; display: inline-flex; align-items: center; gap: 8px; min-block-size: 32px; color: var(--sc-fg-1); font-size: 0.8125rem; cursor: pointer; }
    .wr-chk input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; }
    .wr-box { display: grid; place-items: center; inline-size: 18px; block-size: 18px; border: 1.5px solid var(--sc-fg-2); border-radius: 4px; flex: none; }
    .wr-box svg { inline-size: 12px; block-size: 12px; fill: none; stroke: var(--sc-bg-0); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
    .wr-chk input:checked + .wr-box { background: var(--sc-accent); border-color: var(--sc-accent); }
    .wr-chk input:checked + .wr-box svg { opacity: 1; }
    .wr-chk input:focus-visible + .wr-box { box-shadow: var(--sc-focus-ring); }
    @media (pointer: coarse), (max-width: 749px) { .wr-chk { min-block-size: 48px; } .wr-sg { padding: 0 8px; } }
  `],
})
export class WishRemovalDialogComponent implements AfterViewInit {
  readonly ref = input.required<WishRef>();
  readonly name = input.required<string>();
  /** What the user triggered; the stepper starts here. */
  readonly initialQty = input.required<number>();
  readonly closed = output<WishRemovalChoice | null>();

  private readonly nach = inject(NachschubService);
  private readonly i18n = inject(TranslateService);
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');

  protected readonly route = PATH_ICONS.nachschub;
  private static uid = 0;
  protected readonly howId = `wr-how-${++WishRemovalDialogComponent.uid}`;
  protected readonly capId = `wr-cap-${WishRemovalDialogComponent.uid}`;

  protected readonly wished = computed(() => Math.max(1, this.nach.allocationOf(this.ref()).wished));
  private readonly chosen = signal<number | null>(null);
  protected readonly qty = computed(() => this.chosen() ?? Math.max(1, Math.min(this.wished(), Math.round(this.initialQty()))));
  private readonly shiftedSplit = signal<Readonly<Record<string, number>> | null>(null);
  protected readonly ticked = signal<ReadonlySet<string>>(new Set());
  private readonly barPx = signal(0);

  /** The plan with the preset split (most recent Operation first). */
  protected readonly preset = computed<RemovalPlan>(() => this.nach.planWishRemoval(this.ref(), this.qty()));
  /** The plan the user's split yields, or the preset while it does not add up (the confirm is off then). */
  private readonly effective = computed<RemovalPlan>(() => {
    const s = this.shiftedSplit();
    return (s && this.nach.planWishRemovalWithSplit(this.ref(), this.qty(), s)) || this.preset();
  });
  protected readonly total = computed(() => this.preset().remove - this.preset().free);
  protected readonly rows = computed(() => this.preset().parts.filter((p) => p.max > 0));
  protected readonly sumDone = computed(() => this.rows().reduce((n, r) => n + this.partQty(r), 0));
  protected readonly splitOk = computed(() => this.sumDone() === this.total());

  /** Pieces each Operation gives: the user's split when shifted, else the preset. */
  private readonly qtys = computed(() => {
    const s = this.shiftedSplit();
    return new Map(this.preset().parts.map((p) => [p.packageId, s ? (s[p.packageId] ?? 0) : p.qty] as const));
  });
  protected readonly segments = computed(() =>
    barSegments(this.preset().free, this.preset().parts.map((p) => ({ packageId: p.packageId, packageName: p.packageName, qty: this.qtys().get(p.packageId) ?? 0 }))),
  );
  protected readonly hanging = computed(() => {
    const labels = new Map(this.segments().map((s) => [s.id, this.labelOf(s.id)] as const));
    return hangingIds(this.segments(), labels, this.barPx());
  });

  /** Operationen this removal empties: the ones that go with it (no Einsatz) and the ones that stay (Einsätze) with the tickbox. */
  private readonly emptied = computed(() => this.effective().parts.filter((p) => p.qty > 0 && p.lastWish));
  protected readonly dissolving = computed(() => this.emptied().filter((p) => p.dissolves));
  protected readonly staying = computed(() => this.emptied().filter((p) => !p.dissolves));
  protected readonly keeps = computed(() => this.effective().parts.filter((p) => p.qty > 0 && !p.lastWish).length);
  protected readonly dissolveAny = computed(() => this.dissolving().length > 0 || this.dissolveChosen().length > 0);
  protected readonly danger = computed(() => this.dissolving().length > 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  private observer: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    const el = this.bar()?.nativeElement;
    if (el && typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.barPx.set(el.clientWidth));
      this.observer.observe(el);
    }
  }

  protected setQty(n: number): void {
    this.chosen.set(Math.max(1, Math.min(this.wished(), n)));
    this.shiftedSplit.set(null);
  }

  protected partQty(r: RemovalPart): number {
    return this.qtys().get(r.packageId) ?? 0;
  }

  protected setPart(r: RemovalPart, n: number): void {
    const base = Object.fromEntries(this.qtys());
    this.shiftedSplit.set({ ...base, [r.packageId]: n });
  }

  protected tick(id: string, on: boolean): void {
    this.ticked.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected labelOf(id: string): string {
    const s = this.segments().find((x) => x.id === id);
    if (!s) return '';
    return s.kind === 'free'
      ? this.i18n.instant('wishRemoval.free', { n: s.qty })
      : this.i18n.instant('wishRemoval.fromOp', { n: s.qty, name: s.name });
  }

  /** The ticked Operationen that really are emptied-with-Einsätze now (a ticked one that got pieces back is dropped). */
  private dissolveChosen(): readonly string[] {
    const ticked = this.ticked();
    return this.staying().map((p) => p.packageId).filter((id) => ticked.has(id));
  }

  protected submit(ev: Event): void {
    ev.preventDefault();
    if (!this.splitOk()) return;
    const shifted = this.shiftedSplit();
    const dissolve = this.dissolveChosen();
    this.closed.emit({ qty: this.qty(), ...(shifted ? { split: shifted } : {}), dissolve });
  }
}
