import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { HangarShip } from '../../hangar/hangar.types';
import { HqItemMarksService, HQ_ITEM_NOTE_MAX } from '../../hq/data/hq-item-marks.service';
import { ItemPathService, ownWordOf, type PathResult } from '../../hq/data/item-path.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ItemPathComponent } from '../../shared/item-path/item-path.component';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { CodexOwnShipActionsComponent } from '../holo/codex-own-ship-actions.component';

const FLASH_MS = 1400;

/**
 * The two stations on an item or ship page (concept 20261117-1110-pfad-stationen, round 5 "Zwei Kästen"): the
 * Wunschliste station and the Inventar / Hangar / Sammlung station of `sc-item-path` (level primary), in place of the
 * former ownership card. This host only adds what belongs to the codex page, through the control's slots:
 * `[ipOwnTools]` in the ownership head - items: note, pin, remove (`hq_item_marks`, the confirm dialog); ships: rename,
 * note, pin, remove (`sc-codex-own-ship-actions`) - and `[ipOwnExtra]` under the strip: an item's note text, the
 * hint that the ship sits in an Operation, a failed write. Signed out it shows the hint and the sign-in link.
 *
 *   <sc-codex-own-stations [kind]="k" [className]="cls" [name]="title" layout="stacked" />
 */
@Component({
  selector: 'sc-codex-own-stations',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScActionDirective, ScTooltipDirective, ItemPathComponent, CodexOwnShipActionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sc-own-stations' },
  template: `
    @if (!state().signedIn) {
      <div #signedOut class="os-out" tabindex="-1" [class.flash]="flashing()">
        <p class="os-dim">{{ 'codex.ownCard.signedOut' | translate }}</p>
        <a scAction tier="secondary" routerLink="/login">{{ 'codex.ownCard.signIn' | translate }}</a>
      </div>
    } @else {
      <sc-item-path level="primary" [kind]="kind()" [className]="className()" [name]="name()" [layout]="layout()"
                    [forceOwned]="forceOwned()" [ownName]="shipName()">
        <span ipOwnTools class="os-tools">
          @if (isShip()) {
            @if (ship(); as s) { <sc-codex-own-ship-actions [ship]="s" /> }
          } @else {
            <button type="button" scAction tier="tertiary" class="os-note" [attr.aria-label]="'codex.own.note' | translate"
                    [scTooltip]="'codex.own.note' | translate" scTooltipTier="label" (click)="editNote()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4" /></svg>
            </button>
            <button type="button" scAction tier="tertiary" class="os-pin" [attr.aria-pressed]="pinned()"
                    [attr.aria-label]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate"
                    [scTooltip]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate" scTooltipTier="label" (click)="togglePin()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3-1-6z" [attr.fill]="pinned() ? 'currentColor' : 'none'" /></svg>
            </button>
            <button type="button" scAction tier="tertiary" tone="danger" class="os-remove" [busy]="busy()"
                    [attr.aria-label]="removeKey() | translate" [scTooltip]="removeKey() | translate"
                    scTooltipTier="label" (click)="removeItem()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" /></svg>
            </button>
          }
        </span>
        <div ipOwnExtra class="os-extra">
          @if (!isShip() && owned() && itemNote(); as n) { <p class="os-note-text">{{ n }}</p> }
          @if (isShip() && nachschubName(); as n) {
            <span class="os-hq">
              <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of operationIcon; track $index) { <path [attr.d]="d" /> }</svg>
              {{ 'codex.ownCard.inNachschub' | translate: { name: n } }}
            </span>
          }
          @if (errorKey(); as e) { <p class="os-err" role="alert">{{ e | translate }}</p> }
        </div>
      </sc-item-path>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .os-out { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 14px; border-radius: 10px; outline: none;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); background: color-mix(in srgb, var(--sc-accent) 5%, transparent);
      transition: box-shadow 0.3s ease, border-color 0.3s ease; }
    .os-out.flash { border-color: var(--sc-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    .os-dim { margin: 0; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .os-tools { display: inline-flex; align-items: center; gap: 2px; }
    .os-extra { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; }
    .os-extra:empty { display: none; }
    .os-note-text { margin: 0; color: var(--sc-fg-1); font-size: max(0.8rem, var(--sc-fs-floor)); overflow-wrap: anywhere; white-space: pre-wrap; }
    .os-hq { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 10px; border-radius: 12px;
      border: 1px dashed color-mix(in srgb, var(--sc-warning) 55%, transparent); color: var(--sc-warning);
      font-size: max(0.74rem, var(--sc-fs-floor)); }
    .os-err { margin: 0; color: var(--sc-danger); font-size: max(0.76rem, var(--sc-fs-floor)); }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    @media (max-width: 720px) { :host { padding-inline-end: var(--sc-fab-clear-inline); } }
    @media (prefers-reduced-motion: reduce) { .os-out { transition: none; } }
  `],
})
export class CodexOwnStationsComponent {
  private readonly path = inject(ItemPathService);
  private readonly toast = inject(UndoToastService);
  private readonly confirmDialog = inject(ScConfirmService);
  private readonly marks = inject(HqItemMarksService);

  readonly kind = input.required<string>();
  readonly className = input.required<string>();
  readonly name = input<string | null>(null);
  /** Ships: the reader's hangar row (rename / note / pin / remove act on it). */
  readonly ship = input<HangarShip | null>(null);
  /** HQ > Hangar > ship: the page is the reader's own copy. */
  readonly forceOwned = input(false);
  /** Name of the Operation the ship sits in; null = no hint. */
  readonly nachschubName = input<string | null>(null);
  /** `stacked` in narrow panels (item page); `auto` side by side with the connector, stacked when the host is narrow. */
  readonly layout = input<'auto' | 'stacked'>('auto');

  private readonly stations = viewChild(ItemPathComponent);
  private readonly signedOut = viewChild<ElementRef<HTMLElement>>('signedOut');

  protected readonly operationIcon = PATH_ICONS.nachschub;
  protected readonly state = computed(() => this.path.state(this.kind(), this.className(), this.name())());
  protected readonly isShip = computed(() => this.kind() === 'ship' || this.kind() === 'upcoming');
  private readonly sammlung = computed(() => ownWordOf(this.kind()) === 'sammlung');
  protected readonly removeKey = computed(() => (this.sammlung() ? 'codex.ownCard.removeSammlung' : 'codex.ownCard.removeItem'));
  readonly owned = computed(() => this.forceOwned() || (this.isShip() ? this.state().inHangar : this.state().inventarQty > 0));
  private readonly label = computed(() => this.name() ?? this.className());
  /** The ship's own name for the ownership strip; nothing when it has none (the page title already names the hull). */
  protected readonly shipName = computed(() => (this.isShip() ? this.ship()?.customName?.trim() || null : null));
  protected readonly pinned = computed(() => this.marks.isPinned(this.className()));
  protected readonly itemNote = computed(() => this.marks.noteOf(this.className()));

  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly flashing = signal(false);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => this.path.ensureLoaded());
    effect(() => {
      if (!this.isShip() && this.owned()) void this.marks.ensureLoaded();
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.flashTimer) clearTimeout(this.flashTimer);
    });
  }

  /** The head strip's "Nicht im Hangar / Inventar": the ownership station comes into view and lights up. */
  reveal(): void {
    const stations = this.stations();
    if (stations) {
      stations.reveal();
      return;
    }
    const box = this.signedOut()?.nativeElement;
    if (!box) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    box.focus({ preventScroll: true });
    this.flashing.set(true);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashing.set(false), FLASH_MS);
  }

  /** The item's note (per user and item, not per storage place). */
  async editNote(): Promise<void> {
    const v = await this.confirmDialog.prompt({
      titleKey: 'codex.ownCard.noteTitle',
      inputLabelKey: 'codex.own.note',
      inputMaxLength: HQ_ITEM_NOTE_MAX,
      initialValue: this.itemNote() ?? '',
      confirmKey: 'hangar.detail.save',
    });
    if (v === null) return;
    await this.markResult(this.marks.setNote(this.className(), v));
  }

  async togglePin(): Promise<void> {
    await this.markResult(this.marks.setPinned(this.className(), !this.pinned()));
  }

  private async markResult(write: Promise<boolean>): Promise<void> {
    this.errorKey.set(null);
    if (!(await write)) this.errorKey.set(this.marks.error() ?? 'errors.generic');
  }

  /** Takes the item out of the Inventar (or the blueprint out of the Sammlung) after the danger confirm. */
  async removeItem(): Promise<void> {
    const sammlung = this.sammlung();
    const ok = await this.confirmDialog.confirm({
      titleKey: sammlung ? 'codex.ownCard.removeSammlungTitle' : 'codex.ownCard.removeTitle',
      messageKey: sammlung ? 'codex.ownCard.removeSammlungBody' : 'codex.ownCard.removeBody',
      params: { name: this.label(), n: this.state().inventarQty },
      confirmKey: 'codex.ownCard.removeConfirm',
      tone: 'danger',
    });
    if (!ok) return;
    if (sammlung) await this.run(() => this.path.setBlueprintOwned(this.className(), this.label(), false));
    else await this.run(() => this.path.removeFromInventar(this.kind(), this.className(), this.label()));
  }

  private async run(write: () => Promise<PathResult>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      const res = await write();
      if (!res.ok) {
        this.errorKey.set(res.key);
        return;
      }
      const undo = res.undo;
      if (!undo) return;
      this.toast.offer({
        messageKey: res.key,
        messageParams: res.params,
        commit: () => undefined,
        onUndo: () => void undo().then((back) => { if (!back.ok) this.errorKey.set(back.key); }),
      });
    } finally {
      this.busy.set(false);
    }
  }
}
