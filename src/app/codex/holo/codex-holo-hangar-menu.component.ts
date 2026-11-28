import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, TemplateRef, ViewContainerRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ItemPathService } from '../../hq/data/item-path.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ItemPathComponent } from '../../shared/item-path/item-path.component';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HoloDiffMarkerComponent } from './holo-diff-marker';

/** A navigation target of the menu (router commands + query params). */
export interface HangarMenuLink {
  readonly commands: readonly unknown[];
  readonly queryParams: Record<string, string | null>;
}

/** One own exemplar of this hull (a saved loadout, `hangar_ship_configs`). */
export interface HangarExemplar {
  readonly id: string;
  readonly name: string;
  /** Parts that differ from Werk (◆ count). */
  readonly diffCount: number;
  /** The stored one-line summary; null = none (nothing is shown, never a placeholder text). */
  readonly summary: string | null;
  readonly link: HangarMenuLink;
}

/** The phone / overlay breakpoint: the panel then is a bottom sheet left of the launcher lane. */
const PHONE_QUERY = '(max-width: 720px)';
/** The panel's width on wider screens (`--sc-ov-s`, 28rem). */
const PANEL_W = 448;
const EDGE = 8;

/**
 * The one hangar button of the Holotisch head (concept holotisch-feinschliff r4 d1 s5, C5/C22/C23):
 * "▣ 2× im Hangar · <shown loadout> ▾", with the small Route badge when a wish of this hull sits in an Operation.
 *
 * Its panel (concept 20261117-1110-pfad-stationen, round 5, G5) reads like every other place that shows wish and
 * ownership: first AUSSTATTUNG - "Werk" and every own exemplar as real links (what the table shows), the selected
 * exemplar's rename / note / pin / remove as icon buttons - then the two stations of `sc-item-path` (level primary,
 * stacked): the wish station (counter through the one removal flow, Operation strips, "Zuordnen" with the picker in the
 * flow) with the wishes that carry a loadout and "wish this build" under it, and the hangar station (count, the
 * one-line strip with the shown exemplar's name and the link into the hangar) with the exemplar actions under it.
 *
 * The stations write wish and ownership themselves (ItemPathService). The panel only asks the page for what needs
 * the table: the exemplar actions, "wish this build" (it carries the swapped parts) and another copy into the hangar.
 *
 * A labelled non-modal dialog (`sc-popup` panel): focus goes in, Tab stays inside, Escape closes the picker first and
 * then the panel, focus returns to the trigger; a press beside it closes it (dialogs it opened do not count).
 */
@Component({
  selector: 'sc-codex-holo-hangar-menu',
  standalone: true,
  imports: [TranslatePipe, RouterLink, HoloDiffMarkerComponent, ScPopupComponent, ScActionDirective, ScTooltipDirective, ItemPathComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)', '(window:resize)': 'place()' },
  template: `
    <div class="hm">
      <button #trigger type="button" class="hb" [class.open]="open()" aria-haspopup="dialog" [attr.aria-expanded]="open()"
              [attr.aria-controls]="open() ? 'holo-hangar-menu' : null" (click)="toggle()"
              [scTooltip]="cutTip()" scTooltipTier="label" (pointerenter)="checkCut()" (focus)="checkCut()"
              [attr.aria-label]="(count() > 0 ? ('codex.head.own.hangarN' | translate: { n: count() }) : ('codex.head.notOwn.hangar' | translate)) + ' · ' + (shownName() ?? ('codex.holo.hangar.werk' | translate))" (keydown)="onTriggerKey($event)">
        <span class="ic-w">
          <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9H3zM9 20v-6h6v6" /></svg>
          @if (assigned() > 0) {
            <!-- The Route badge of the rows (B8): a wish of this hull belongs to an Operation. -->
            <i class="op-badge" data-badge="operation" aria-hidden="true"><svg viewBox="0 0 24 24">@for (d of routeIcon; track $index) { <path [attr.d]="d" /> }</svg></i>
          }
        </span>
        <!-- The sentence wraps onto a second line in a narrow head instead of being clipped. -->
        <span class="t">
          <b>{{ count() > 0 ? ('codex.head.own.hangarN' | translate: { n: count() }) : ('codex.head.notOwn.hangar' | translate) }} <span class="sep" aria-hidden="true">·</span></b>
          <span class="ex">{{ shownName() ?? ('codex.holo.hangar.werk' | translate) }}@if ((shownDiff() ?? 0) > 0) { <sc-holo-diff-marker /> }</span>
        </span>
        @if (assigned() > 0) { <span class="sc-sr-only">{{ 'pathCtl.wishAssigned' | translate: { n: assigned() } }}</span> }
        <span class="car" aria-hidden="true">▾</span>
      </button>
    </div>
    <!-- The panel lives in the CDK overlay: above the page's docks, under its button on wide screens, a bottom sheet on phones. -->
    <ng-template #panelTpl>
        <sc-popup #panel id="holo-hangar-menu" class="menu" kind="panel" size="s" [float]="true" [backdrop]="false" [backClose]="false"
                  [title]="shipName()" [returnFocus]="trigger" (closed)="close()" (keydown)="onPanelKey($event)"
                  (click)="onPanelClick($event)" (focusout)="onPanelFocusOut()">
          <section class="grp" [attr.aria-label]="'codex.holo.hangar.loadouts' | translate">
            <div class="gh" aria-hidden="true">{{ 'codex.holo.hangar.loadouts' | translate }}</div>
            <a class="row" [class.on]="activeId() === null" [attr.aria-current]="activeId() === null ? 'true' : null"
               [attr.cdkFocusInitial]="activeId() === null ? '' : null"
               [routerLink]="werkLink().commands" [queryParams]="werkLink().queryParams" (click)="close()">
              <i class="radio" aria-hidden="true"></i>
              <span class="txt"><b>{{ 'codex.holo.hangar.werk' | translate }}</b>
                @if (activeId() === null && werkChanged() > 0) {
                  <small>{{ 'codex.holo.hangar.werkChanged' | translate: { n: werkChanged() } }}</small>
                }
              </span>
            </a>
            @for (e of exemplars(); track e.id) {
              <a class="row" [class.on]="activeId() === e.id" [attr.aria-current]="activeId() === e.id ? 'true' : null"
                 [attr.cdkFocusInitial]="activeId() === e.id ? '' : null"
                 [routerLink]="e.link.commands" [queryParams]="e.link.queryParams" (click)="close()">
                <i class="radio" aria-hidden="true"></i>
                <span class="txt">
                  <b>{{ e.name }}</b>
                  @if (e.summary) { <small class="sum">{{ e.summary }}</small> }
                  <small class="diff">
                    @if (e.diffCount > 0) {
                      <sc-holo-diff-marker />
                      {{ (e.diffCount === 1 ? 'codex.holo.hangar.diffOne' : 'codex.holo.hangar.diffMany') | translate: { n: e.diffCount } }}
                    } @else {
                      {{ 'codex.holo.hangar.diffNone' | translate }}
                    }
                  </small>
                </span>
              </a>
              @if (activeId() === e.id) {
                <div class="acts" role="group" [attr.aria-label]="'codex.holo.hangar.selectedAria' | translate: { name: e.name }">
                  <button type="button" scAction tier="tertiary" class="a-rename" [attr.aria-label]="'codex.own.rename' | translate"
                          [scTooltip]="'codex.own.rename' | translate" scTooltipTier="label" (click)="fire(rename, e.id)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" /></svg>
                  </button>
                  <button type="button" scAction tier="tertiary" class="a-note" [attr.aria-label]="'codex.own.note' | translate"
                          [scTooltip]="'codex.own.note' | translate" scTooltipTier="label" (click)="fire(note, e.id)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4" /></svg>
                  </button>
                  <button type="button" scAction tier="tertiary" class="a-pin" [attr.aria-pressed]="pinned()"
                          [attr.aria-label]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate"
                          [scTooltip]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate" scTooltipTier="label" (click)="pin.emit(e.id)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3-1-6z" [attr.fill]="pinned() ? 'currentColor' : 'none'" /></svg>
                  </button>
                  <button type="button" scAction tier="tertiary" tone="danger" class="a-remove" [attr.aria-label]="'codex.holo.hangar.removeExemplar' | translate"
                          [scTooltip]="'codex.holo.hangar.removeExemplar' | translate" scTooltipTier="label" (click)="fire(remove, e.id)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" /></svg>
                  </button>
                </div>
              }
            }
          </section>

          @if (signedIn() && className()) {
            <sc-item-path class="stations" level="primary" layout="stacked" kind="ship" [className]="className()" [name]="shipName()"
                          [forceOwned]="forceOwned()" [ownName]="exemplarName()" [pickerInFlow]="true" [bare]="true" (leave)="close()">
              <div ipWishExtra class="xtra">
                @if (activeId() === null && werkChanged() > 0) {
                  <!-- D1: the swapped Werk goes onto the wishlist WITH its swaps - the page writes it (it holds the table). -->
                  <button type="button" scAction tier="secondary" class="wish-build" [busy]="busy()" (click)="addWish.emit(null)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of wishIcon; track $index) { <path [attr.d]="d" /> }</svg>
                    <span>{{ (werkChanged() === 1 ? 'codex.holo.hangar.wishWithOne' : 'codex.holo.hangar.wishWithMany') | translate: { n: werkChanged() } }}</span>
                  </button>
                }
                <!-- A wish that carries a loadout (D1): opened like an exemplar, its parts become the draft. -->
                @for (w of wishes(); track w.id) {
                  <a class="row wish" [class.on]="activeId() === w.id" [attr.aria-current]="activeId() === w.id ? 'true' : null"
                     [attr.cdkFocusInitial]="activeId() === w.id ? '' : null"
                     [routerLink]="w.link.commands" [queryParams]="w.link.queryParams" (click)="close()">
                    <i class="radio" aria-hidden="true"></i>
                    <span class="txt">
                      <b>{{ w.name }}</b>
                      <small class="diff">
                        @if (w.diffCount > 0) {
                          <sc-holo-diff-marker />
                          {{ (w.diffCount === 1 ? 'codex.holo.hangar.diffOne' : 'codex.holo.hangar.diffMany') | translate: { n: w.diffCount } }}
                        } @else {
                          {{ 'codex.holo.hangar.diffNone' | translate }}
                        }
                      </small>
                    </span>
                  </a>
                }
              </div>
              <div ipOwnExtra class="xtra hangar-acts">
                @if (active(); as a) {
                  <button type="button" scAction tier="secondary" class="h-copy" [busy]="busy()" (click)="fire(copyExemplar, a.id)">
                    <span>＋ {{ 'codex.holo.hangar.copy' | translate }}</span></button>
                  <button type="button" scAction tier="secondary" class="h-new" [busy]="busy()" (click)="fire(newFromWerk, a.id)">
                    <span>＋ {{ 'codex.holo.hangar.newFromWerk' | translate }}</span></button>
                } @else if (activeId() === null) {
                  <button type="button" scAction tier="secondary" class="h-save" [busy]="busy()" (click)="fire(saveAsExemplar, null)">
                    <span>＋ {{ (werkChanged() > 0 ? 'codex.holo.hangar.saveBuild' : 'codex.holo.hangar.saveWerk') | translate }}</span></button>
                }
                @if (count() > 0) {
                  <button type="button" scAction tier="secondary" class="h-another" [busy]="busy()" (click)="addCopy.emit(null)">
                    <span>＋ {{ 'codex.holo.hangar.anotherCopy' | translate: { name: shipName() } }}</span></button>
                }
              </div>
            </sc-item-path>
          } @else if (!signedIn()) {
            <a scAction tier="secondary" class="sign-in" routerLink="/login" (click)="close()">{{ 'codex.ownCard.signIn' | translate }}</a>
          }
          @if (errorKey(); as err) { <p class="err" role="alert">{{ err | translate }}</p> }
        </sc-popup>
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    .hm { position: relative; display: inline-flex; min-width: 0; }
    /* The band's pill language (detail/codex-detail-head.component.ts tokens), the same as the Einsatz pill.
       Full band: the sentence may wrap onto a second line (min-height, never clipped — #1184's contract).
       Slim band: one row, the loadout name ellipsises and the whole sentence is the tooltip. */
    .hb { display: inline-flex; align-items: center; gap: 8px; box-sizing: border-box; min-height: var(--hb-pill-h, 34px); min-width: 0; max-width: 100%; padding: 3px 14px 3px 5px;
      border: 1px solid var(--hb-pill-bd, color-mix(in srgb, var(--sc-accent) 30%, transparent)); border-radius: 17px;
      background: var(--hb-pill-bg, color-mix(in srgb, var(--sc-bg-0) 52%, transparent)); transition: border-color 160ms ease, background 160ms ease;
      color: var(--sc-fg-1); font: inherit; font-size: max(13px, var(--sc-fs-floor)); text-align: start; cursor: pointer; }
    @media (prefers-reduced-motion: reduce) { .hb { transition: none; } }
    .hb .ic { flex: none; width: 24px; height: 24px; padding: 5px; box-sizing: border-box; border-radius: 50%; color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
    .ic-w { position: relative; flex: none; display: inline-flex; margin-inline-end: 3px; }
    .hb .t { display: inline-flex; flex-wrap: wrap; align-items: center; column-gap: 6px; min-width: 0; line-height: 1.25; }
    .hb .t b { white-space: nowrap; }
    .hb .ex { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
    :host-context(sc-codex-detail-head.slim) .hb { height: var(--hb-pill-h, 32px); padding-block: 0; border-radius: var(--hb-pill-r, 999px); }
    :host-context(sc-codex-detail-head.slim) .hb .t { flex-wrap: nowrap; }
    :host-context(sc-codex-detail-head.slim) .hb .ex { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    /* The Route badge, as on the rows' wish node (sc-item-path .op-badge). */
    .op-badge { position: absolute; right: -8px; bottom: -6px; display: grid; place-items: center; width: 14px; height: 14px; box-sizing: border-box; border-radius: 50%;
      border: 1px solid var(--sc-accent); background: var(--sc-bg-0); color: var(--sc-accent); font-style: normal; pointer-events: none; }
    .op-badge svg { width: 10px; height: 10px; display: block; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .hb b { color: var(--sc-fg-0); font-weight: 600; }
    .hb .sep { color: var(--sc-fg-2); }
    .hb .ex { color: var(--sc-fg-0); }
    .hb .car { color: var(--sc-accent); font-size: 0.75em; }
    /* Phone, slim band (--hb-pill-text: none): icon and caret only; the menu names count and loadout. */
    :host-context(sc-codex-detail-head.slim) .hb .t { display: var(--hb-pill-text, inline-flex); }
    .hb:hover, .hb.open { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); border-color: var(--sc-accent); }
    .hb:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    /* The panel's frame fills the overlay pane (its width and height come from place()). */
    .menu { display: block; inline-size: 100%; }
    .menu ::ng-deep .scp-frame { inline-size: 100%; max-inline-size: 100%; }
    /* A compact head: the ship's name as a small eyebrow line beside the close button, not a title. */
    .menu ::ng-deep .scp-h { align-items: center; }
    .menu ::ng-deep .scp-title { font: 600 max(10.5px, var(--sc-fs-floor))/1.3 var(--sc-font-body, inherit); letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--sc-fg-2); }
    .menu ::ng-deep .scp-b { margin-top: 2px; }
    .grp { display: flex; flex-direction: column; gap: 2px; margin-block-end: 12px; }
    .gh { padding: 0 10px 2px; font-size: max(13px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); }
    .row { display: flex; align-items: flex-start; gap: 9px; width: 100%; box-sizing: border-box; min-height: 32px; padding: 7px 10px;
      border-radius: 8px; color: var(--sc-fg-1); font-size: max(13px, var(--sc-fs-floor)); text-decoration: none; }
    @media (hover: hover) { .row:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); color: var(--sc-fg-0); } }
    .row:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
    .row.on { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-fg-0); }
    .radio { flex: none; width: 12px; height: 12px; margin-top: 3px; box-sizing: border-box; border-radius: 50%; border: 1.5px solid var(--sc-fg-2); }
    .row.on .radio { border-color: var(--sc-accent); background: radial-gradient(circle, var(--sc-accent) 0 45%, transparent 50%); }
    .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .txt b { font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .txt small { display: inline-flex; align-items: center; gap: 6px; font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .txt .sum { display: block; color: var(--sc-fg-1); }
    .acts { display: flex; flex-wrap: wrap; gap: 2px; padding: 0 0 2px 21px; }
    .acts svg { width: 16px; height: 16px; }
    /* What the page adds under a station: its own entries, full width, in the stations' rhythm. */
    .xtra { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; margin-block-start: 8px; }
    .xtra:empty { display: none; }
    .hangar-acts { flex-direction: row; flex-wrap: wrap; }
    .xtra .row { margin-inline: -4px; width: calc(100% + 8px); }
    .xtra .sc-action { max-width: 100%; }
    .xtra .sc-action span { white-space: normal; text-align: start; }
    .sign-in { align-self: flex-start; }
    .err { margin: 10px 0 0; font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-danger); }
    @media (pointer: coarse) { .hb { min-height: 48px; min-width: 48px; flex-shrink: 1; border-radius: 24px; padding-block: 4px; } .row { min-height: 48px; align-items: center; } }
  `],
})
export class CodexHoloHangarMenuComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly path = inject(ItemPathService);
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  private readonly panel = viewChild('panel', { read: ElementRef });
  private readonly panelTpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private ref: OverlayRef | null = null;

  /** The hull's short name ("Gladius") for "Noch eine Gladius in den Hangar" and the panel's title. */
  readonly shipName = input('');
  /** The hull's class (slug): the stations read and write wish and ownership of it. */
  readonly className = input('');
  /** Copies in the hangar; 0 = not in the hangar. */
  readonly count = input(0);
  readonly signedIn = input(false);
  /** HQ › Hangar › ship: the page is the reader's own copy. */
  readonly forceOwned = input(false);
  readonly exemplars = input<readonly HangarExemplar[]>([]);
  /** Wishes of this hull that carry a loadout (`is_wish` configs, D1), listed under the wish station. */
  readonly wishes = input<readonly HangarExemplar[]>([]);
  /** The exemplar on the table; null = Werk. */
  readonly activeId = input<string | null>(null);
  readonly werkLink = input<HangarMenuLink>({ commands: [], queryParams: {} });
  /** Unsaved swaps on Werk (the sandbox, C23): offered to keep, never forced. */
  readonly werkChanged = input(0);
  readonly pinned = input(false);
  readonly busy = input(false);
  readonly errorKey = input<string | null>(null);

  readonly rename = output<string>();
  readonly note = output<string>();
  readonly pin = output<string>();
  readonly remove = output<string>();
  readonly copyExemplar = output<string>();
  readonly newFromWerk = output<string>();
  /** Keep what is on the Werk table (with or without swaps) as a new exemplar. */
  readonly saveAsExemplar = output<null>();
  readonly addCopy = output<null>();
  /** Wish the swapped Werk build: the hull wish plus its loadout (D1). */
  readonly addWish = output<null>();

  readonly open = signal(false);
  protected readonly routeIcon = PATH_ICONS.nachschub;
  protected readonly wishIcon = PATH_ICONS.wish;
  /** The exemplar on the table; a wish with a loadout counts as shown too (its name is on the trigger). */
  protected readonly active = computed(() => {
    const id = this.activeId();
    return id ? (this.exemplars().find((e) => e.id === id) ?? null) : null;
  });
  private readonly shown = computed(() => {
    const id = this.activeId();
    return id ? (this.active() ?? this.wishes().find((w) => w.id === id) ?? null) : null;
  });
  protected readonly shownName = computed(() => this.shown()?.name ?? null);
  /** The trigger's sentence is cut off (slim band): the tooltip carries it whole. */
  protected readonly cutTip = signal<string | null>(null);
  protected checkCut(): void {
    const t = this.host.querySelector<HTMLElement>('.hb .ex');
    const cut = !!t && t.scrollWidth > t.clientWidth + 1;
    this.cutTip.set(cut ? (this.host.querySelector('.hb')?.getAttribute('aria-label') ?? null) : null);
  }
  protected readonly shownDiff = computed(() => this.shown()?.diffCount ?? null);
  /** The ownership strip names the shown exemplar ("1× im Hangar · „PvP-Laser“"). */
  protected readonly exemplarName = computed(() => this.active()?.name ?? null);
  /** Pieces of this hull's wish that sit in an Operation: the trigger carries the Route badge. */
  protected readonly assigned = computed(() => {
    const cls = this.className();
    return cls && this.signedIn() ? this.path.state('ship', cls, this.shipName() || null)().assigned : 0;
  });

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    this.attach();
  }

  close(): void {
    this.open.set(false);
    const ref = this.ref;
    this.ref = null;
    ref?.dispose();
  }

  ngOnDestroy(): void {
    this.close();
  }

  /** A resize or rotation: the pane follows its button (or stays a sheet). */
  place(): void {
    this.ref?.updatePosition();
  }

  /**
   * Wide screens: under its button, end-aligned (start-aligned when there is no room), as tall as the room below allows.
   * Phones (<= 720px): a sheet at the bottom, as tall as its content up to the full height, its right edge left of the
   * launcher lane - so it lies above the page's own docks and nothing of it under the floating buttons.
   */
  private attach(): void {
    const btn = this.trigger()?.nativeElement;
    if (!btn || typeof window === 'undefined') return;
    const phone = window.matchMedia(PHONE_QUERY).matches;
    const r = btn.getBoundingClientRect();
    const position = phone
      ? this.overlay.position().global().left(`${EDGE}px`).bottom(`calc(${EDGE}px + var(--sc-safe-bottom, 0px))`)
      : this.overlay
          .position()
          .flexibleConnectedTo(btn)
          .withPositions([
            { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
            { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
          ])
          .withPush(false)
          .withViewportMargin(EDGE)
          .withFlexibleDimensions(false);
    const ref = this.overlay.create({
      positionStrategy: position,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      disposeOnNavigation: true,
      width: phone ? `calc(100vw - ${EDGE}px - var(--sc-fab-clear-inline, ${EDGE}px))` : `${Math.min(PANEL_W, window.innerWidth - 2 * EDGE)}px`,
    });
    const maxH = phone
      ? `calc(100dvh - ${2 * EDGE}px - var(--sc-safe-bottom, 0px))`
      : `${Math.max(280, Math.min(600, window.innerHeight - r.bottom - 6 - 2 * EDGE))}px`;
    ref.overlayElement.style.setProperty('--sc-popup-max-h', maxH);
    ref.attach(new TemplatePortal(this.panelTpl(), this.vcr));
    ref.detachments().subscribe(() => {
      if (this.ref !== ref) return;
      this.ref = null;
      this.open.set(false);
    });
    this.ref = ref;
  }

  /** Closes the menu first, then asks the page (a prompt, a navigation or a new exemplar follows). */
  protected fire<T>(out: { emit(v: T): void }, value: T): void {
    this.close();
    out.emit(value);
  }

  onTriggerKey(ev: KeyboardEvent): void {
    if (ev.key !== 'ArrowDown' || this.open()) return;
    ev.preventDefault();
    this.toggle();
  }

  /**
   * Tab stays inside the panel (the popup's own trap is off for a non-modal panel); Escape is the popup's - an open
   * picker consumes it first, so the first Escape closes the picker and the second the panel.
   */
  onPanelKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Tab') return;
    const frame = this.panel()?.nativeElement as HTMLElement | undefined;
    if (!frame) return;
    const items = Array.from(frame.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (ev.shiftKey && (at === first || !frame.contains(at))) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && (at === last || !frame.contains(at))) {
      ev.preventDefault();
      first.focus();
    }
  }

  /** "Zuordnen" opened the picker in the flow: bring it into view inside the scrolling body. */
  onPanelClick(ev: MouseEvent): void {
    if (!(ev.target instanceof Element) || !ev.target.closest('button.assign')) return;
    setTimeout(() => (this.panel()?.nativeElement as HTMLElement | undefined)?.querySelector('sc-item-path-assign')?.scrollIntoView?.({ block: 'nearest' }));
  }

  /** A station re-rendered under the focus (the add button became the counter): focus stays in the panel. */
  onPanelFocusOut(): void {
    setTimeout(() => {
      if (!this.open() || (document.activeElement && document.activeElement !== document.body)) return;
      ((this.panel()?.nativeElement as HTMLElement | undefined)?.querySelector('.scp-frame') as HTMLElement | null)?.focus({ preventScroll: true });
    });
  }

  /** A press beside the button and the panel closes it; a press in a dialog or tooltip it opened (CDK overlay) does not. */
  onOutside(ev: PointerEvent): void {
    if (!this.open() || !(ev.target instanceof Element)) return;
    if (this.host.contains(ev.target) || ev.target.closest('.cdk-overlay-container')) return;
    this.close();
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
