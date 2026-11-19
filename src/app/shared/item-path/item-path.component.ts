import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { logWarn } from '../../core/log';
import { isPlainLeftClick } from '../../core/modified-click.util';
import {
  ItemPathService,
  PLACE_BLUEPRINTS,
  isPathError,
  PLACE_WITH_ME,
  ownWordOf,
  type ItemPathState,
  type OwnWord,
  type PathResult,
  type PathStep,
  type PathTone,
} from '../../hq/data/item-path.service';
import { HQ_ROOT, hangarRedirectLink, hqStockLink, type HqPageLink } from '../../hq/hq-routes';
import { NachschubFocusService } from '../../hq/nachschub/nachschub-focus.service';
import type { AssignTargets } from '../../hq/nachschub/nachschub.service';
import { WishRemovalFlowService } from '../../hq/nachschub/wish-removal-flow.service';
import { placeLabel } from '../../hq/now/hq-live.util';
import { WishCartService } from '../../shell/cart/wish-cart.service';
import { ScActionDirective } from '../action/sc-action.directive';
import { SC_POPUP_PHONE_QUERY, ScPopupComponent } from '../popup/sc-popup.component';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';
import { UndoToastService } from '../undo-toast/undo-toast.service';
import { ItemPathAssignComponent, progressMarks, type AssignCaret, type AssignPick } from './item-path-assign.component';
import { PATH_ICONS } from './path-icons';

/** Length of the add moment: the streak is visible for about 1.1 s, the node peaks as it arrives, then it settles (1.7 s). */
const ADD_MOMENT_MS = 1700;
/** How long the ownership station stays lit after the head strip's jump. */
const REVEAL_FLASH_MS = 1400;

/**
 * The wish station shows one strip per Operation holding the item, newest first, up to this many; the rest is one
 * "+N weitere Operationen" link to Planen (B4: several Operationen without growing the station without limit).
 */
const MAX_ASSIGNMENT_LINES = 2;

/** The place pin of the ownership strip (mock rounds/04.html `pfad-beides`). */
const PIN_ICON: readonly string[] = ['M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z', 'M12 8.5a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'];

export type ItemPathLevel = 'tertiary' | 'secondary' | 'primary';
type PopMode = 'place' | 'error' | 'assign';

/** A stop has something in it: the wish node when the item is wished, the second node when it is owned / collected. */
export function isFilled(s: ItemPathState, step: PathStep): boolean {
  switch (step) {
    case 'wish': return s.wished;
    case 'nachschub': return s.nachschubQty > 0;
    case 'inventar': return s.inventarQty > 0;
    case 'hangar': return s.inHangar;
  }
}

/** The second node's step of a state: Hangar for ships, Inventar for the rest (Sammlung is the Inventar step of blueprints). */
export function ownStepOf(s: ItemPathState): PathStep | null {
  return s.steps.find((x) => x === 'inventar' || x === 'hangar') ?? null;
}

/**
 * What the pill offers without an override: the next thing this reader can do with this item. Announced ships end at
 * the wish; an owned item has nothing left to do; a wished one can be put into the Inventar / Hangar / Sammlung.
 */
export function nextStepOf(s: ItemPathState): PathStep | null {
  if (s.hint === 'notYetInGame') return s.wished ? null : 'wish';
  const own = ownStepOf(s);
  if (own && isFilled(s, own)) return null;
  if (!s.wished) return 'wish';
  return own;
}

/**
 * `sc-item-path`: the one control of the way an item takes - two nodes, Wunschliste -> Inventar / Hangar / Sammlung by
 * kind (concept nachschub-hq r4-d1-s8). No Nachschub node (Nachschub lives in the HQ) and no "Besitz" word.
 *
 *   <sc-item-path [kind]="kind" [className]="cls" [name]="title" level="tertiary" />
 *
 * An empty wish node puts one piece on the wishlist; a filled one shows the count and opens the cart. An empty second node
 * adds the item (Inventar asks for the place first); a filled one is a real link to the item in HQ Bestand / the ship in
 * the Hangar, with the count on it. Levels: `tertiary` the two nodes with count bullets (search rows, cards); `secondary`
 * the pill - the nodes plus the next step as a button; `primary` the detail page: both stops in words, a stepper on the
 * wish and on the Inventar count. `(leave)` fires when a plain click leaves the page, so a floating host can close itself.
 *
 * Operationen (concept 20261117-1110-pfad-stationen): still two stations - the assignment lives inside the wish
 * station. Detail page: head -> a strip per Operation holding the item (link to Planen, progress marks, then
 * "k von n Einsätzen") -> "Zuordnen" while free pieces are left, with the picker hanging on it
 * (`sc-item-path-assign`). The ownership station mirrors it: head with counter -> one-line strip "N× im Inventar ·
 * <nearest place> +k weitere Orte" -> or only its button. Rows and cards never assign; an assigned wish node carries
 * the small Route badge. Lowering the wish always runs through WishRemovalFlowService (C6).
 *
 * Host slots (primary): `[ipWishExtra]` at the end of the wish station, `[ipOwnTools]` in the ownership head (only while
 * owned), `[ipOwnExtra]` under the ownership strip or button.
 */
@Component({
  selector: 'sc-item-path',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScActionDirective, ScPopupComponent, ScTooltipDirective, ItemPathAssignComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ip-primary]': "level() === 'primary'", '[class.ip-stacked]': "layout() === 'stacked'", '[class.ip-bare]': 'bare()' },
  template: `
    <ng-template #rail>
      <span class="rail">
        <button scAction tier="tertiary" type="button" class="node" data-step="wish" [class.on]="state().wished" [class.cur]="state().wished && !ownOn()" [class.is-adding]="adding()" [attr.data-adding]="adding() ? '' : null"
                [busy]="busy() === 'wish'" [scTooltip]="wishLabel()" scTooltipTier="label" [attr.aria-label]="ariaName(wishLabel())"
                (click)="onWish($event)">
          <svg class="sc-action-icon" [class.is-filled]="state().wished" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.wish; track $index) { <path [attr.d]="d" /> }</svg>
          @if (state().wishQty > 0) { <i class="n">{{ countText(state().wishQty) }}</i> }
          <!-- B8: rows do not assign; the small Route badge only says the wish belongs to an Operation. -->
          @if (state().assigned > 0) {
            <i class="op-badge" data-badge="operation" aria-hidden="true"><svg viewBox="0 0 24 24">@for (d of icons.nachschub; track $index) { <path [attr.d]="d" /> }</svg></i>
          }
        </button>
        @if (own(); as o) {
          <i class="link" [class.on]="state().wished || ownOn()"></i>
          @if (ownOn()) {
            <a scAction tier="tertiary" class="node on cur" [attr.data-step]="o" [routerLink]="ownLink().commands" [fragment]="ownLink().fragment"
               [queryParams]="ownLink().queryParams" [scTooltip]="ownLabel()" scTooltipTier="label" [attr.aria-label]="ariaName(ownLabel())"
               (click)="onLink($event)">
              <svg class="sc-action-icon is-filled" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
              <i class="n">{{ countText(ownQty()) }}</i>
            </a>
          } @else {
            <button scAction tier="tertiary" type="button" class="node" [class.open]="mode() === 'place'" [attr.data-step]="o" [busy]="busy() === o"
                    [scTooltip]="ownLabel()" scTooltipTier="label" [attr.aria-label]="ariaName(ownLabel())"
                    [attr.aria-haspopup]="o === 'inventar' && kind() !== 'blueprint' ? 'dialog' : null" [attr.aria-expanded]="o === 'inventar' && kind() !== 'blueprint' ? mode() === 'place' : null"
                    (click)="onOwnAdd($event)">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
            </button>
          }
        }
      </span>
    </ng-template>

    <ng-template #hint>
      @if (state().hint) { <i class="rdy">{{ 'itemPath.hint.notYetInGame' | translate }}</i> }
    </ng-template>

    @switch (level()) {
      @case ('tertiary') {
        <ng-container [ngTemplateOutlet]="rail" />
      }
      @case ('secondary') {
        <span class="pill">
          <ng-container [ngTemplateOutlet]="rail" />
          @if (next(); as step) {
            <button scAction tier="secondary" type="button" class="go" [busy]="busy() === step" (click)="onGo($event, step)">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of goIcon(step); track $index) { <path [attr.d]="d" /> }</svg>
              <span>{{ goKey(step) | translate }}</span>
            </button>
          }
          <ng-container [ngTemplateOutlet]="hint" />
        </span>
      }
      @case ('primary') {
        <div class="primary">
          <ol class="path" [class.single]="!own()">
            <!--
              Two stations built alike (B1, B2): head (icon, word, counter) -> a strip only when there is something to say
              -> otherwise only the action button. The assignment to an Operation lives inside the wish station.
            -->
            <li class="stop" data-station="wish" [class.on]="state().wished">
              <div class="head">
                <span class="stop-h" [class.is-adding]="adding()" [attr.data-adding]="adding() ? '' : null">
                  <svg class="sc-action-icon" [class.is-filled]="state().wished" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.wish; track $index) { <path [attr.d]="d" /> }</svg>
                  <b>{{ 'pathCtl.node.wish' | translate }}</b>
                </span>
                @if (state().wished) {
                  <span class="st" role="group" [attr.aria-label]="'pathCtl.wishQty' | translate">
                    <button type="button" [attr.aria-label]="'pathCtl.less' | translate" [disabled]="lowering()" (click)="stepWish(-1)">−</button>
                    <b>{{ state().wishQty }}</b>
                    <button type="button" [attr.aria-label]="'pathCtl.more' | translate" [disabled]="state().wishQty >= 999" (click)="stepWish(1)">+</button>
                  </span>
                  <button type="button" class="txt end" (click)="openCart($event)">{{ 'pathCtl.openCart' | translate }}</button>
                }
              </div>
              @if (state().wished) {
                @for (a of shownAssignments(); track a.packageId) {
                  <!-- B4: a real link into the HQ to that Operation; marks before the text "1 von 4 Einsätzen". -->
                  <a class="strip asg" data-strip="operation" [routerLink]="hqRoot" fragment="planen"
                     (click)="onOperationLink($event, a.packageId)" (auxclick)="onOperationLink($event, a.packageId)">
                    <svg class="strip-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.nachschub; track $index) { <path [attr.d]="d" /> }</svg>
                    <span class="asg-name">{{ 'pathCtl.assign.line' | translate: { n: a.qty, name: a.packageName } }}</span>
                    @if (a.einsaetzeTotal > 0) {
                      <span class="seg" aria-hidden="true">@for (m of marks(a.einsaetzeDone, a.einsaetzeTotal); track $index) { <i [class.on]="m"></i> }</span>
                      <span class="mut">{{ 'pathCtl.assign.progress' | translate: { done: a.einsaetzeDone, total: a.einsaetzeTotal } }}</span>
                    } @else {
                      <span class="mut">{{ 'pathCtl.assign.noEinsatz' | translate }}</span>
                    }
                  </a>
                }
                @if (moreAssignments() > 0) {
                  <a class="strip-more" [routerLink]="hqRoot" fragment="planen" (click)="onLink($event)">
                    {{ (moreAssignments() === 1 ? 'pathCtl.assign.moreOne' : 'pathCtl.assign.more') | translate: { n: moreAssignments() } }}
                  </a>
                }
                @if (canAssign() || assignPending()) {
                  <!-- B3/B6: same tier, size and place as "Ins Inventar"; the picker hangs on it. -->
                  <div class="anc">
                    <button #assignBtn scAction tier="secondary" type="button" class="assign" [class.is-open]="mode() === 'assign'" [busy]="assigning() || assignPending()"
                            aria-haspopup="dialog" [attr.aria-expanded]="mode() === 'assign'" (click)="toggleAssign($event)">
                      <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.nachschub; track $index) { <path [attr.d]="d" /> }</svg>
                      <span>{{ 'pathCtl.assign.go' | translate }}</span>
                    </button>
                    @if (mode() === 'assign' && pickInline()) {
                      <ng-container [ngTemplateOutlet]="assignTpl" [ngTemplateOutletContext]="{ inline: true }" />
                    }
                  </div>
                }
              } @else {
                <button scAction tier="primary" type="button" [busy]="busy() === 'wish'" (click)="onGo($event, 'wish')">
                  <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.wish; track $index) { <path [attr.d]="d" /> }</svg>
                  <span>{{ 'pathCtl.go.wish' | translate }}</span>
                </button>
              }
              <!-- The host's own wish entries under the station (Holotisch menu: wishes with a loadout, "wish this build"). -->
              <ng-content select="[ipWishExtra]" />
            </li>
            @if (own(); as o) {
              <li #ownStop class="stop" data-station="own" tabindex="-1" [class.on]="ownOn()" [class.flash]="flashing()">
                <div class="head">
                  <span class="stop-h">
                    <svg class="sc-action-icon" [class.is-filled]="ownOn()" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
                    <b>{{ 'pathCtl.node.' + word() | translate }}</b>
                  </span>
                  @if (ownOn() && o === 'inventar' && kind() !== 'blueprint' && stepPlaceName(); as at) {
                    <span class="st" role="group" [attr.aria-label]="'pathCtl.ownQty.' + word() | translate">
                      <button type="button" [attr.aria-label]="'pathCtl.less' | translate" (click)="stepPlace(at, -1)">−</button>
                      <b>{{ ownQty() }}</b>
                      <button type="button" [attr.aria-label]="'pathCtl.more' | translate" (click)="stepPlace(at, 1)">+</button>
                    </span>
                  }
                  @if (ownOn()) {
                    <!-- R5 (G2): the host's own actions on the owned piece (note, pin, remove / rename) as icon buttons. -->
                    <span class="tools end"><ng-content select="[ipOwnTools]" /></span>
                  }
                </div>
                @if (ownOn()) {
                  <!-- B5: ONE line - the quantity, the one nearest place, a hint for more; the rest behind the link. -->
                  <span class="strip own" data-strip="own">
                    <svg class="strip-i" viewBox="0 0 24 24" aria-hidden="true">@for (d of ownStripIcon(); track $index) { <path [attr.d]="d" /> }</svg>
                    <span class="own-what">
                      <b class="q">{{ ('pathCtl.ownOn.' + word()) | translate: { n: ownQty() } }}</b>
                      @if (o === 'inventar' && kind() !== 'blueprint' && state().nearestPlace; as where) {
                        <span class="mut place-1">· {{ placeText(where) }}</span>
                        @if (state().morePlaces > 0) {
                          <span class="mut more-places">{{ (state().morePlaces === 1 ? 'pathCtl.own.morePlacesOne' : 'pathCtl.own.morePlaces') | translate: { n: state().morePlaces } }}</span>
                        }
                      }
                      @if (ownName(); as nm) { <span class="mut place-1 own-name">· „{{ nm }}“</span> }
                    </span>
                    <a class="alink end" [routerLink]="ownLink().commands" [fragment]="ownLink().fragment" [queryParams]="ownLink().queryParams" (click)="onLink($event)">{{ 'pathCtl.view.' + word() | translate }}</a>
                  </span>
                } @else {
                  <button scAction tier="secondary" type="button" [class.is-open]="mode() === 'place'" [busy]="busy() === o"
                          [attr.aria-haspopup]="o === 'inventar' && kind() !== 'blueprint' ? 'dialog' : null"
                          [attr.aria-expanded]="o === 'inventar' && kind() !== 'blueprint' ? mode() === 'place' : null" (click)="onGo($event, o)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
                    <span>{{ 'pathCtl.go.' + word() | translate }}</span>
                  </button>
                }
                <ng-content select="[ipOwnExtra]" />
              </li>
            }
          </ol>
          <ng-container [ngTemplateOutlet]="hint" />
        </div>
      }
    }

    <ng-template #assignTpl let-inline="inline">
      <sc-item-path-assign [name]="name() ?? ''" [free]="state().free" [assigned]="state().assigned" [targets]="targets()"
                           [busy]="assigning() || assignPending()" [busyKey]="pickerBusyKey()"
                           [inline]="!!inline" [caret]="caret()" [returnFocus]="anchor()"
                           (assign)="onAssign($event)" (closed)="closePop()" (leave)="onLink($event)" />
    </ng-template>

    <ng-template #pop>
      @if (mode() === 'assign') {
        <ng-container [ngTemplateOutlet]="assignTpl" [ngTemplateOutletContext]="{ inline: false }" />
      } @else if (mode() === 'error') {
        <!-- A refusal (tone info) reads neutral and politely; only a real failure is an alert in the danger tone. -->
        <sc-popup class="rp" [class.err]="errorTone() === 'error'" [attr.role]="errorTone() === 'error' ? 'alert' : 'status'"
                  kind="notice" [title]="'pathCtl.whereTitle' | translate">{{ errorKey() | translate }}</sc-popup>
      } @else {
        <sc-popup class="rp" kind="panel" [title]="'pathCtl.whereTitle' | translate" [eyebrow]="name() ?? ''"
                  [returnFocus]="anchor()" (closed)="closePop()">
          <div class="places">
            @for (p of placeOptions(); track p; let first = $first) {
              <button type="button" class="place" [class.on]="first" (click)="choosePlace(p)">{{ placeText(p) }}</button>
            }
            <button type="button" class="place" [class.on]="otherOpen()" [attr.aria-expanded]="otherOpen()" (click)="openOther()">{{ 'pathCtl.otherPlace' | translate }}</button>
          </div>
          @if (otherOpen()) {
            <div class="other">
              <input #placeInput type="text" maxlength="120" [attr.aria-label]="'pathCtl.whereTitle' | translate"
                     [attr.placeholder]="'pathCtl.otherPlaceholder' | translate" (keydown.enter)="choosePlace(placeInput.value)" />
              <button scAction tier="secondary" type="button" (click)="choosePlace(placeInput.value)"><span>{{ 'pathCtl.store' | translate }}</span></button>
            </div>
          }
        </sc-popup>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; flex: none; }
    :host(.ip-primary) { display: block; container: ip-path / inline-size; }

    .rail { display: inline-flex; align-items: center; }
    .node.sc-action.sc-action--tertiary {
      position: relative; display: grid; place-items: center;
      width: max(30px, var(--sc-tap-min, 0px)); height: max(30px, var(--sc-tap-min, 0px));
      border: 1px solid var(--sc-border); border-radius: 50%;
      color: var(--sc-fg-2); background: color-mix(in srgb, var(--sc-bg-0) 90%, transparent);
    }
    .node.sc-action svg { width: 15px; height: 15px; }
    .node.is-busy svg { display: none; }
    .node.sc-action.sc-action--tertiary:hover:not(.is-busy), .node.sc-action.sc-action--tertiary.open {
      color: var(--sc-accent); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-bg-0) 90%, transparent); filter: none;
    }
    .node.sc-action.sc-action--tertiary.on { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 60%, transparent); }
    .node.sc-action.cur { box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 22%, transparent), 0 0 12px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    .node.sc-action.open { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    @media (hover: hover) {
      .node:not(.on):not(.is-busy):hover::after {
        content: "+"; position: absolute; right: -4px; bottom: -4px; width: 14px; height: 14px; border-radius: 50%;
        background: var(--sc-accent); color: var(--sc-bg-0); font: 700 12px/14px var(--sc-font-body); text-align: center;
      }
    }
    .n {
      position: absolute; right: -2px; top: -3px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px;
      background: var(--sc-accent); color: var(--sc-bg-0); font: 600 10px/15px var(--sc-font-body); font-style: normal; text-align: center;
    }
    /*
     * The add moment (concept wunschliste-gefuehl, d3 "Sternschnuppe"): a streak flies into the wish node from the top right
     * (wl-star-in), the node pulses (wl-add) and its icon fills (wl-fill). One shot of 1.7 s per add: the mock's 5 s loop
     * shows the streak for 24-47 % (about 1.1 s) and peaks the node right as it arrives; the rest state afterwards is the
     * normal wished look, so every keyframe ends on the element's own style.
     */
    .node.sc-action.is-adding { animation: ip-add 1.7s ease-in-out; }
    .node.is-adding svg { animation: ip-fill 1.7s ease-in-out; }
    .node.is-adding::before, .stop-h.is-adding::before {
      content: ""; position: absolute; top: 50%; width: 46px; height: 2px; border-radius: 2px; pointer-events: none; opacity: 0;
      background: linear-gradient(90deg, #fff, color-mix(in srgb, var(--sc-accent) 60%, transparent) 35%, transparent);
      animation: ip-star-in 1.7s ease-in;
    }
    .node.is-adding::before { right: 50%; }
    .stop-h.is-adding { position: relative; }
    .stop-h.is-adding::before { right: calc(100% - 9px); }
    .stop-h.is-adding svg { animation: ip-icon 1.7s ease-in-out, ip-fill 1.7s ease-in-out; }
    @keyframes ip-add {
      0%, 47% { border-color: var(--sc-border); color: var(--sc-fg-2); box-shadow: 0 0 0 0 transparent; transform: none; }
      70% { border-color: var(--sc-accent); color: var(--sc-accent); box-shadow: 0 0 0 8px color-mix(in srgb, var(--sc-accent) 22%, transparent); transform: scale(1.14); }
    }
    @keyframes ip-icon {
      0%, 47% { color: var(--sc-fg-1); transform: none; }
      70% { color: var(--sc-accent); transform: scale(1.14); }
    }
    @keyframes ip-fill {
      0%, 52% { fill: transparent; }
      /* var(--sc-accent), not currentColor: a currentColor colour mix in animated fill next to the streak crashed Chromium (Edge) renderers. */
      76% { fill: color-mix(in srgb, var(--sc-accent) 28%, transparent); }
    }
    @keyframes ip-star-in {
      0% { opacity: 0; transform: translate(120px, -70px) rotate(-30deg); }
      18% { opacity: 1; }
      59% { opacity: 1; transform: translate(22px, -12px) rotate(-30deg); }
      68%, 100% { opacity: 0; transform: translate(22px, -12px) rotate(-30deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .node.sc-action.is-adding, .node.is-adding svg, .stop-h.is-adding svg { animation: none; }
      .node.is-adding::before, .stop-h.is-adding::before { display: none; }
    }
    .link { display: block; width: 9px; height: 2px; background: var(--sc-border); }
    .link.on { background: var(--sc-accent); }

    .pill {
      display: inline-flex; align-items: center; gap: 10px; padding: 5px 6px 5px 8px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 7%, transparent); box-shadow: 0 0 22px color-mix(in srgb, var(--sc-accent) 12%, transparent);
    }
    .go.sc-action.sc-action--secondary {
      min-height: max(34px, var(--sc-tap-min, 0px)); padding: 4px 14px; border: 0; box-shadow: none;
      background: var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; font-size: 0.8125rem;
      max-width: 100%; white-space: normal; text-align: left;
    }
    .rdy {
      flex: none; padding: 1px 8px; border: 1px solid var(--sc-accent); border-radius: 999px;
      font-style: normal; font-size: 0.72rem; color: var(--sc-accent); white-space: nowrap;
    }

    .primary {
      display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); border-radius: 12px;
      background: color-mix(in srgb, var(--sc-accent) 5%, transparent);
    }
    .path { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin: 0; padding: 0; list-style: none; }
    .path.single { grid-template-columns: minmax(0, 1fr); }
    .stop {
      position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 14px;
      border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
    }
    .stop + .stop::before { content: ""; position: absolute; left: -19px; top: 28px; width: 18px; height: 2px; background: var(--sc-border); }
    .stop.on + .stop::before { background: var(--sc-accent); }
    .stop.on { border-color: color-mix(in srgb, var(--sc-accent) 50%, transparent); }
    .stop-h { display: inline-flex; align-items: center; gap: 8px; color: var(--sc-fg-1); }
    .stop.on .stop-h { color: var(--sc-accent); }
    .stop-h b { font: 500 0.8125rem/1.2 var(--sc-font-display); letter-spacing: 0.05em; }
    /* The main action of a stop wraps inside the stop instead of running over its neighbour. */
    .stop > .sc-action { max-width: 100%; white-space: normal; text-align: left; }
    .stop p { margin: 0; color: var(--sc-fg-1); font-size: 0.8125rem; }
    svg.sc-action-icon { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    svg.sc-action-icon.is-filled { fill: color-mix(in srgb, currentColor 28%, transparent); }

    .txt {
      min-height: var(--sc-tap-min, 0px); padding: 4px 2px; border: 0; background: none; cursor: pointer; font: inherit; font-size: 0.8125rem;
      color: var(--sc-accent); text-decoration: underline; text-underline-offset: 3px;
    }
    .txt:focus-visible, .alink:focus-visible, .place:focus-visible, .st button:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }

    /* Frame, ✕, width and the phone full screen come from sc-popup; only content rules stay. */
    .rp.err { color: var(--sc-danger); }
    .alink { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 0px); color: var(--sc-accent); font-size: 0.8125rem; text-decoration: none; }
    .alink:hover { text-decoration: underline; text-underline-offset: 3px; }
    .st { display: inline-flex; align-items: center; gap: 2px; flex: none; }
    .st button {
      width: max(30px, var(--sc-tap-min, 0px)); height: max(30px, var(--sc-tap-min, 0px)); padding: 0; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 7px; background: none; color: var(--sc-fg-1);
    }
    .st button:hover:not(:disabled) { color: var(--sc-accent); border-color: var(--sc-accent); }
    .st button:disabled { opacity: 0.4; cursor: default; }
    .st b { min-width: 30px; text-align: center; font-weight: 500; font-variant-numeric: tabular-nums; }
    .places { display: flex; gap: 6px; flex-wrap: wrap; }
    .place {
      display: inline-flex; align-items: center; gap: 6px; min-height: max(34px, var(--sc-tap-min, 0px)); padding: 4px 12px; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 999px; background: none; color: var(--sc-fg-1);
    }
    .place:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .place.on { border-color: var(--sc-accent); color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    /* B8: the Route badge on an assigned wish node (rows, cards); the ring stays solid. */
    .op-badge {
      position: absolute; right: -5px; bottom: -5px; display: grid; place-items: center; width: 15px; height: 15px; border-radius: 50%;
      border: 1px solid var(--sc-accent); background: var(--sc-bg-0); color: var(--sc-accent); font-style: normal; pointer-events: none;
    }
    .node.sc-action .op-badge svg { width: 10px; height: 10px; display: block; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }

    /* The station head (B2): icon + word, the counter, the cart link at the end. */
    .head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; width: 100%; min-height: 30px; }
    .end { margin-left: auto; }
    .mut { color: var(--sc-fg-2); font-size: 0.75rem; }
    /* The status strip, the same construction in both stations (B2, B4, B5). */
    .strip {
      display: flex; align-items: center; gap: 6px 10px; width: 100%; min-height: max(36px, var(--sc-tap-min, 0px)); padding: 6px 10px;
      border-left: 2px solid var(--sc-accent); border-radius: 0 8px 8px 0; background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
      color: var(--sc-fg-1); font-size: 0.8125rem;
    }
    .strip-i { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .asg { flex-wrap: wrap; text-decoration: none; }
    .asg:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .asg:hover .asg-name { text-decoration: underline; text-underline-offset: 3px; }
    .asg-name { min-width: 0; color: var(--sc-accent); overflow-wrap: anywhere; }
    .seg { display: inline-flex; align-items: center; gap: 3px; flex: none; }
    .seg i { display: block; width: 16px; height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--sc-accent) 20%, transparent); }
    .seg i.on { background: var(--sc-accent); }
    .strip-more { color: var(--sc-fg-2); font-size: 0.75rem; text-decoration: underline; text-underline-offset: 3px; min-height: var(--sc-tap-min, 0px); display: inline-flex; align-items: center; }
    .strip-more:hover { color: var(--sc-accent); }
    /* One line, always (B5): the place gives way before the link does. */
    .own { flex-wrap: nowrap; white-space: nowrap; }
    .own-what { display: inline-flex; align-items: baseline; gap: 6px; flex: 1 1 auto; min-width: 0; overflow: hidden; }
    .own-what .q { flex: none; color: var(--sc-fg-0); font-weight: 600; }
    .own-what .place-1 { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .own-what .more-places { flex: none; }
    .own .alink { flex: none; }
    /* The anchor of the picker (B6): the button, and on phones the picker in the flow right under it. */
    .anc { position: relative; display: flex; flex-direction: column; align-items: flex-start; max-width: 100%; }
    .anc > .sc-action { max-width: 100%; white-space: normal; text-align: left; }
    /* The open state of a station button while its popup hangs on it ("Ins Inventar" / "Zuordnen"). */
    .stop .sc-action.sc-action--secondary.is-open {
      border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0);
    }
    .asg:focus-visible, .strip-more:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }

    .other { display: flex; align-items: center; gap: 8px; }
    .other input {
      flex: 1 1 auto; min-width: 0; min-height: max(36px, var(--sc-tap-min, 0px)); padding: 4px 10px; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 6px; background: var(--sc-bg-0); color: var(--sc-fg-0);
    }
    .other input:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }

    /* R5 (G1): one station under the other in a narrow host (item panel, menus) - by the host's width, not the page's. */
    :host(.ip-stacked) .path { grid-template-columns: minmax(0, 1fr); gap: 10px; }
    :host(.ip-stacked) .stop + .stop::before { left: 28px; top: -11px; width: 2px; height: 10px; }
    :host(.ip-stacked) .own { flex-wrap: wrap; }
    @container ip-path (max-width: 520px) {
      .path { grid-template-columns: minmax(0, 1fr); gap: 10px; }
      .stop + .stop::before { left: 28px; top: -11px; width: 2px; height: 10px; }
      .own { flex-wrap: wrap; }
    }
    .anc:has(> sc-item-path-assign.inline) { width: 100%; }
    :host(.ip-bare) .primary { padding: 0; border: 0; border-radius: 0; background: none; }
    .tools { display: inline-flex; align-items: center; gap: 2px; }
    .tools:empty { display: none; }
    .stop[data-station="own"] { outline: none; transition: box-shadow 0.3s ease, border-color 0.3s ease; }
    .stop.flash { border-color: var(--sc-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    @media (prefers-reduced-motion: reduce) { .stop[data-station="own"] { transition: none; } }
    @media (max-width: 640px) {
      .node.sc-action.sc-action--tertiary { width: max(44px, var(--sc-tap-min, 0px)); height: max(44px, var(--sc-tap-min, 0px)); }
      .link { width: 6px; }
      .path { grid-template-columns: minmax(0, 1fr); }
      .stop + .stop::before { display: none; }
      .pill { flex-wrap: wrap; border-radius: 18px; }
    }
    @media (max-width: 720px) {
      /* B10: the picker sits in the flow under its button, as wide as the station. */
      .anc { width: 100%; }
    }
  `],
})
export class ItemPathComponent implements OnDestroy {
  readonly kind = input.required<string>();
  readonly className = input.required<string>();
  readonly name = input<string | null>(null);
  readonly level = input<ItemPathLevel>('tertiary');
  /** What the pill offers as next step; null follows the state. */
  readonly nextStep = input<PathStep | null>(null);
  /** A plain click on a link is leaving: a floating host can close itself. */
  readonly leave = output<void>();
  /**
   * Primary level: `auto` puts the two stations side by side and stacks them when the host is narrow (a container
   * query on the host's own width); `stacked` always puts one under the other (narrow panels, menus).
   */
  readonly layout = input<'auto' | 'stacked'>('auto');
  /** The page is the reader's own copy (HQ-hosted ship page): the ownership station reads filled whatever the store says. */
  readonly forceOwned = input(false);
  /** A ship's own name, shown in the ownership strip ("Im Hangar · „Name“"). */
  readonly ownName = input<string | null>(null);
  /** No frame around the two stations: the host is already a frame (the Holotisch panel). */
  readonly bare = input(false);
  /** The picker opens in the flow under "Zuordnen" at every width (a host that is itself a popover, the Holotisch menu). */
  readonly pickerInFlow = input(false);

  private readonly path = inject(ItemPathService);
  /** Resolved on click only: building the cart (wishlist store, Supabase client) is not the price of drawing a path control. */
  private readonly toast = inject(UndoToastService);
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly popTpl = viewChild.required<TemplateRef<unknown>>('pop');
  private readonly placeInput = viewChild<ElementRef<HTMLInputElement>>('placeInput');
  private readonly ownStop = viewChild<ElementRef<HTMLElement>>('ownStop');
  /** The ownership station lights up after {@link reveal}. */
  readonly flashing = signal(false);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  readonly icons = PATH_ICONS;
  private readonly translate = inject(TranslateService);

  /** A stored place as the reader sees it ("Bei mir" shows as "With me" in EN, ingame names are tidied). */
  placeText(place: string): string {
    return placeLabel(place, this.translate.getCurrentLang());
  }

  readonly state = computed(() => this.path.state(this.kind(), this.className(), this.name())());
  readonly busy = signal<PathStep | null>(null);
  readonly mode = signal<PopMode | null>(null);
  readonly errorKey = signal('');
  readonly errorTone = signal<PathTone>('error');
  readonly anchor = signal<HTMLElement | null>(null);
  readonly otherOpen = signal(false);
  /** The add moment plays while this is on (one shot per add by the user, see {@link playAdd}). */
  readonly adding = signal(false);

  /** The second node's step (Inventar / Hangar), null for an announced ship. */
  readonly own = computed(() => ownStepOf(this.state()));
  /** Its word: Inventar, Hangar, or Sammlung for a blueprint. */
  readonly word = computed<OwnWord | null>(() => ownWordOf(this.kind()));
  readonly ownOn = computed(() => {
    const o = this.own();
    return !!o && (this.forceOwned() || isFilled(this.state(), o));
  });
  readonly ownQty = computed(() => (this.own() === 'hangar' ? Math.max(1, this.state().hangarQty) : this.state().inventarQty));
  readonly ownLink = computed<HqPageLink>(() => {
    const s = this.state();
    if (this.own() === 'hangar') return { commands: s.hangarShipId ? hangarRedirectLink(s.hangarShipId) : hqStockLink({ tab: 'hangar' }).commands, fragment: undefined };
    return hqStockLink({ tab: this.kind() === 'blueprint' ? 'sammlung' : 'inventar', focus: this.className() });
  });

  readonly next = computed<PathStep | null>(() => {
    const s = this.state();
    const wanted = this.nextStep();
    return wanted && s.steps.includes(wanted) ? wanted : nextStepOf(s);
  });

  readonly hqRoot = [HQ_ROOT];
  /** A write of the picker is under way. */
  readonly assigning = signal(false);
  /** A lowering of the wish runs through the removal flow (its dialog may be open). */
  readonly lowering = signal(false);
  /** The picker sits in the flow under its button (phones, B10) instead of in the overlay. */
  readonly pickInline = signal(false);
  readonly caret = signal<AssignCaret>('top');

  /** The picker's rows; read only while it is open (the Nachschub store is resolved on demand). */
  readonly targets = computed(() => (this.mode() === 'assign' ? this.path.assignTargets() : NO_TARGETS));
  /** "Zuordnen" is offered while free pieces are left (B3); an announced ship cannot be obtained yet. */
  readonly canAssign = computed(() => {
    const s = this.state();
    return s.signedIn && s.wished && s.free > 0 && s.hint === null;
  });
  /**
   * The Operationen of a wished item are still loading (`assignmentsKnown === false`, `free` reads 0 until then):
   * "Zuordnen" shows busy instead of vanishing as if nothing were free, and it opens no empty picker.
   */
  readonly assignPending = computed(() => {
    const s = this.state();
    return s.signedIn && s.wished && s.hint === null && s.assignmentsKnown === false;
  });
  /** The picker's rows are off while the Operationen load or a write runs - and it says so (never a click that is lost). */
  readonly pickerBusyKey = computed(() => (this.assigning() ? 'pathCtl.assign.working' : this.assignPending() ? 'pathCtl.assign.loading' : null));
  readonly shownAssignments = computed(() => {
    const a = this.state().assignments;
    return a.length > MAX_ASSIGNMENT_LINES ? a.slice(0, MAX_ASSIGNMENT_LINES) : a;
  });
  readonly moreAssignments = computed(() => Math.max(0, this.state().assignments.length - MAX_ASSIGNMENT_LINES));
  /** The Inventar counter steps at the place the strip names (B5), so both speak of the same place. */
  readonly stepPlaceName = computed(() => this.state().nearestPlace ?? this.state().places[0]?.location ?? null);
  readonly ownStripIcon = computed<readonly string[]>(() => {
    const w = this.word();
    return w === 'inventar' ? PIN_ICON : this.icons[w ?? 'inventar'];
  });

  readonly placeOptions = computed(() => {
    const first = this.path.currentPlaceDefault();
    return [first, ...this.path.knownPlaces().filter((p) => p !== first)].slice(0, 5);
  });

  private ref: OverlayRef | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private addTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onScroll = (ev: Event): void => {
    if (this.ref && !this.ref.overlayElement.contains(ev.target as Node)) this.closePop();
  };

  constructor() {
    effect(() => this.path.ensureLoaded());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.addTimer) clearTimeout(this.addTimer);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.closePop();
  }

  /**
   * The jump from the head strip's segment ("Nicht im Inventar"): the ownership station (or the whole control when
   * there is none) comes into view, takes focus and lights up briefly.
   */
  reveal(): void {
    const target = this.ownStop()?.nativeElement ?? this.host;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    target.focus?.({ preventScroll: true });
    this.flashing.set(true);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashing.set(false), REVEAL_FLASH_MS);
  }

  private get label(): string {
    return this.name() ?? this.className();
  }

  ariaName(label: string): string {
    return this.name() ? `${label}: ${this.name()}` : label;
  }

  countText(n: number): string {
    return n > 99 ? '99+' : String(n);
  }

  /** Tooltip and name of the wish node: add, or "n on the wishlist - open". */
  wishLabel(): string {
    const s = this.state();
    const base = this.translate.instant(s.wished ? 'pathCtl.tip.wishOn' : 'pathCtl.tip.wishOff', { qty: s.wishQty });
    // B8: the badge is decoration; its meaning reaches the tooltip and the accessible name.
    return s.assigned > 0 ? `${base} · ${this.translate.instant('pathCtl.wishAssigned', { n: s.assigned })}` : base;
  }

  marks(done: number, total: number): boolean[] {
    return progressMarks(done, total);
  }

  ownLabel(): string {
    const w = this.word();
    if (!w) return '';
    return this.translate.instant(this.ownOn() ? `pathCtl.tip.${w}On` : `pathCtl.tip.${w}Off`, { qty: this.ownQty() });
  }

  goKey(step: PathStep): string {
    return step === 'wish' ? 'pathCtl.go.wish' : `pathCtl.go.${this.word() ?? 'inventar'}`;
  }

  goIcon(step: PathStep): readonly string[] {
    return step === 'wish' ? this.icons.wish : this.icons[this.word() ?? 'inventar'];
  }

  // ── click logic: an empty node adds, a filled one leads somewhere ───────────

  /** Empty: one piece on the wishlist (undo in the toast). Filled: the cart opens. */
  async onWish(ev: Event): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.state().wished) {
      this.openCart(ev);
      return;
    }
    await this.fill('wish', ev.currentTarget as HTMLElement);
  }

  /** The empty second node: adds the item (Inventar asks for the place first). */
  async onOwnAdd(ev: Event): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const o = this.own();
    if (o) await this.fill(o, ev.currentTarget as HTMLElement);
  }

  /** The pill and the primary buttons: an action in words. */
  async onGo(ev: Event, step: PathStep): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const at = this.host.querySelector<HTMLElement>(`.node[data-step="${step}"]`) ?? (ev.currentTarget as HTMLElement);
    await this.fill(step, at);
  }

  openCart(ev: Event): void {
    ev.preventDefault();
    this.closePop();
    this.leave.emit();
    void this.injector.get(WishCartService).open();
  }

  /**
   * The add moment: only after the reader's own action took the item from "not wished" to "wished" - never on the first
   * render of a wished item, never on a quantity change or a removal. It ends after its 1.7 s (the node then simply
   * shows the wished look, which is also all that is left under reduced motion).
   */
  private playAdd(wasWished: boolean, res: PathResult): void {
    if (this.destroyed || wasWished || !res.ok) return;
    if (this.addTimer) clearTimeout(this.addTimer);
    this.adding.set(true);
    this.addTimer = setTimeout(() => {
      this.addTimer = null;
      this.adding.set(false);
    }, ADD_MOMENT_MS);
  }

  private async fill(step: PathStep, at: HTMLElement): Promise<void> {
    if (step === 'inventar' && this.kind() !== 'blueprint') {
      this.togglePlace(at);
      return;
    }
    this.busy.set(step);
    const wasWished = this.state().wished;
    try {
      const res = await this.write(step);
      if (step === 'wish') this.playAdd(wasWished, res);
      this.report(res, at);
    } finally {
      this.busy.set(null);
    }
  }

  private write(step: PathStep): Promise<PathResult> | PathResult {
    switch (step) {
      case 'wish': return this.path.addWish(this.kind(), this.className(), this.name());
      case 'hangar': return this.path.addToHangar(this.className(), this.name());
      case 'inventar': return this.path.moveToInventar(this.kind(), this.className(), this.label, PLACE_BLUEPRINTS, 1);
      case 'nachschub': return { ok: false, key: 'itemPath.err.unavailable', tone: 'info' };
    }
  }

  // ── detail page steppers ────────────────────────────────────────────────────

  async stepWish(delta: number): Promise<void> {
    const at = this.host.querySelector<HTMLElement>('.st') ?? this.host;
    if (delta < 0) {
      await this.lowerWish(-delta, at);
      return;
    }
    const wasWished = this.state().wished;
    const res = await this.path.setWishQty(this.kind(), this.className(), this.name(), this.state().wishQty + delta);
    this.playAdd(wasWished, res);
    this.report(res, at);
  }

  /**
   * C6: lowering or removing the wish goes through the ONE removal flow - free pieces go without a question (A4), a
   * cut into assigned pieces asks first (A5). Cancelled = null, nothing changed. The result's undo goes on the toast.
   */
  private async lowerWish(n: number, at: HTMLElement): Promise<void> {
    if (this.lowering()) return;
    this.lowering.set(true);
    try {
      const flow = this.injector.get(WishRemovalFlowService);
      const res = await flow.lower({ kind: this.kind(), className: this.className(), forClassName: null, name: this.label }, n, 'codex');
      if (!res) return;
      if (!res.ok) {
        this.showError(res.key, at);
        return;
      }
      flow.announce(res, (key) => this.showError(key, at));
    } finally {
      this.lowering.set(false);
    }
  }

  // ── assigning the wish to an Operation (B6, B7) ─────────────────────────────

  /** "Zuordnen": the picker opens under the button (overlay), on phones in the flow right under it; again = closes. */
  toggleAssign(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.mode() === 'assign') {
      this.closePop();
      return;
    }
    if (this.assignPending()) return;
    const at = ev.currentTarget as HTMLElement;
    this.closePop();
    void this.path.loadAssignTargets();
    if (this.pickerInFlow() || isPhone()) {
      this.anchor.set(at);
      this.pickInline.set(true);
      this.mode.set('assign');
      return;
    }
    this.openPop('assign', at);
  }

  async onAssign(pick: AssignPick): Promise<void> {
    // The rows are disabled in both phases (pickerBusyKey says why); this only guards a click that raced the render.
    if (this.assigning() || this.assignPending()) return;
    const at = this.anchor();
    this.assigning.set(true);
    try {
      const res = await this.path.assignWish(this.kind(), this.className(), pick.qty, pick.target, { name: this.label, surface: 'codex' });
      if (res.ok) this.closePop();
      this.report(res, at?.isConnected ? at : this.host.querySelector<HTMLElement>('.st'));
    } finally {
      this.assigning.set(false);
    }
  }

  /**
   * The strip leads to Planen with that Operation in focus. The focus is stored before the browser follows the link,
   * so a new tab (middle / modified click) opens on the same Operation; only a plain click closes a floating host.
   */
  onOperationLink(ev: MouseEvent, packageId: string): void {
    if (ev.type === 'auxclick' && ev.button !== 1) return;
    this.injector.get(NachschubFocusService).select(packageId);
    if (ev.type === 'click') this.onLink(ev);
  }

  async stepPlace(place: string, delta: number): Promise<void> {
    const at = this.host.querySelector<HTMLElement>('.st') ?? this.host;
    const res = await this.path.adjustInventar(this.className(), this.label, place, delta);
    if (!res.ok) this.report(res, at);
  }

  // ── place popover (Inventar asks where) ─────────────────────────────────────

  /** Stores one piece at the chosen place. */
  async choosePlace(place: string): Promise<void> {
    const where = place.trim();
    if (!where) return;
    const at = this.anchor();
    this.closePop();
    const res = await this.path.moveToInventar(this.kind(), this.className(), this.label, where, 1);
    this.report(res, at);
  }

  openOther(): void {
    this.otherOpen.set(true);
    afterNextRender(() => this.placeInput()?.nativeElement.focus(), { injector: this.injector });
  }

  onLink(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    this.closePop();
    this.leave.emit();
  }

  // ── result: toast with undo, error at the node ─────────────────────────────

  private report(res: PathResult, at: HTMLElement | null): void {
    if (!res.ok) {
      this.showError(res.key, at, isPathError(res) ? 'error' : 'info');
      return;
    }
    const undo = res.undo;
    if (!undo) return;
    this.toast.offer({
      messageKey: this.toastKey(res),
      messageParams: this.toastParams(res),
      commit: () => undefined,
      onUndo: () => void undo().then((back) => { if (!back.ok) this.showError(back.key, at); }),
    });
  }

  /** The toast's `where` is a stored place; it is shown the way the popover shows it. */
  private toastParams(res: PathResult): PathResult['params'] {
    const where = res.params?.['where'];
    return typeof where === 'string' ? { ...res.params, where: this.placeText(where) } : res.params;
  }

  /** "liegt jetzt in Bei mir" reads wrong: the two fixed places have their own sentence. */
  private toastKey(res: PathResult): string {
    if (res.key !== 'itemPath.done.inventar') return res.key;
    if (res.params?.['where'] === PLACE_WITH_ME) return 'itemPath.done.inventarWithMe';
    return res.params?.['where'] === PLACE_BLUEPRINTS ? 'itemPath.done.inventarBlueprint' : res.key;
  }

  private showError(key: string, at: HTMLElement | null, tone: PathTone = 'error'): void {
    // A refusal is never swallowed: when its anchor was re-rendered away, the message hangs on the control itself.
    const host = this.host.isConnected ? (this.host.querySelector<HTMLElement>('button.assign, .st') ?? this.host) : null;
    if (!this.destroyed && !at?.isConnected) at = host;
    if (this.destroyed || !at) {
      logWarn('itemPath', 'result without a surface to show it', { key });
      return;
    }
    this.closePop();
    this.errorKey.set(key);
    this.errorTone.set(tone);
    this.openPop('error', at);
    this.errorTimer = setTimeout(() => this.closePop(), 4000);
  }

  // ── overlay: in the CDK container, so a scrolling host cannot clip it ──────

  private togglePlace(at: HTMLElement): void {
    if (this.mode() === 'place') {
      this.closePop();
      return;
    }
    this.closePop();
    this.openPop('place', at);
  }

  private openPop(mode: PopMode, at: HTMLElement): void {
    const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
    this.mode.set(mode);
    this.anchor.set(at);
    this.otherOpen.set(false);
    this.caret.set('top');
    // The picker hangs on "Zuordnen" (B6): start-aligned under it, caret at its left; with no room below it opens
    // above with the caret at the bottom. No push: pushing would slide it over its own button.
    const connected =
      mode === 'assign'
        ? this.overlay
            .position()
            .flexibleConnectedTo(at)
            .withPositions([
              { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
              { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
            ])
            .withPush(false)
            .withViewportMargin(8)
            .withFlexibleDimensions(false)
        : this.overlay
            .position()
            .flexibleConnectedTo(at)
            .withPositions([
              { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
              { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
              { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
              { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
            ])
            .withPush(true)
            .withViewportMargin(8)
            .withFlexibleDimensions(false);
    if (mode === 'assign') connected.positionChanges.subscribe((c) => this.caret.set(c.connectionPair.originY === 'top' ? 'bottom' : 'top'));
    const ref = this.overlay.create({
      disposeOnNavigation: true,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      // Phones: above the launcher lane (--sc-fab-clear-block), never under the feedback button.
      positionStrategy: phone && mode !== 'assign' ? this.overlay.position().global().centerHorizontally().bottom('var(--sc-fab-clear-block)') : connected,
    });
    ref.attach(new TemplatePortal(this.popTpl(), this.vcr));
    ref.outsidePointerEvents().subscribe((ev) => {
      // The node itself toggles; closing here as well would reopen it on the same click.
      if (!this.host.contains(ev.target as Node)) this.closePop();
    });
    ref.detachments().subscribe(() => {
      if (this.ref === ref) this.closePop();
    });
    // Phones: the sheet does not hang on the row, and the keyboard scrolls the window.
    if (!phone) window.addEventListener('scroll', this.onScroll, true);
    this.ref = ref;
  }

  closePop(): void {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
    const ref = this.ref;
    this.ref = null;
    if (typeof window !== 'undefined') window.removeEventListener('scroll', this.onScroll, true);
    ref?.dispose();
    this.mode.set(null);
    this.pickInline.set(false);
  }
}

const NO_TARGETS: AssignTargets = { operations: [], slotsUsed: 0, slotsMax: 7, canCreate: true, blockKey: null };

/** The overlay breakpoint of sc-popup: below it the picker goes into the flow instead of an overlay (B10). */
function isPhone(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(SC_POPUP_PHONE_QUERY).matches;
}
