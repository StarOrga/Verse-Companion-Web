// Holotable sticky bottom strip (concept 2026-09-20, iteration 10 `strip_final`,
// wave2 scope A). Layout: Einsatz -> arrow -> Offensive/Verteidigung/Bewegung
// mini perspective tiles -> ring joint (no label) -> Signatur & Kühlung -> an
// open/close toggle ONLY (no energy segment while collapsed).
//
// Concept holotisch-unten r1 (d2): the row sits on the stage's shared columns
// (--holo-cols: a narrow Einsatz, the four areas evenly, the arrow), and the
// arrow opens a dock ABOVE the row, over the page: the energy as its own row
// (SCM/NAV + "Schleichen", the pip stacks, the cooling gauge, the summary —
// energy moves every value, so it stays in sight) and under it the four
// perspective areas, projected by the stage ([hsDock]). No minimise control.
//
// Concept holotisch-feinschliff r4 (d1): the Einsatz moved to the head's
// centre (sc-codex-holo-einsatz), the row holds only the four topics, and the
// arrow became a thin handle bar under the capsule.
//
// Reuses `codex-power.ts` (the SAME model `sc-codex-energy-dock` computes
// from) rather than re-deriving the reactor/cooling maths, and
// `codex-build-compare.ts`'s `PERSPECTIVE_KPIS` (the SAME grouping the
// patch-Δ view uses) to sort `KpiStripCell`s into the three mini tiles —
// see wave1-core-web.md / wave0-research.md §A row 25/52 for the sources.
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ICON_PATHS } from '../codex-category-icon.component';
import { PERSPECTIVE_KPIS, Perspective } from '../codex-build-compare';
import { formatNumber } from '../codex-format';
import { formatEquippedStat } from '../codex-equipped-stats';
import { KpiStripCell } from '../codex-kpi-sets';
import {
  DEFAULT_POWER_DRAFT,
  PowerDraftState,
  decodePowerParam,
  encodePowerParam,
  parseLocalPowerDraft,
  powerStorageKey,
  serializeLocalPowerDraft,
} from '../codex-loadout-draft';
import { ShipCapabilities } from '../codex-mission';
import {
  FlightMode,
  PowerColumnKey,
  PowerFactKey,
  PowerGroup,
  PowerGroupRow,
  PowerLevels,
  PowerPreset,
  PowerSheet,
  clickPowerPip,
  computePowerSheet,
  coolerUnitCount,
  isFlightMode,
  migrateLegacyCoolerDraft,
  parsePowerGroups,
  parsePowerLevels,
  resetPowerState,
  stealthPowerState,
  togglePowerGroup,
} from '../codex-power';
import type { SummaryOccupant } from '../ship-summary-panels';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { AreaSymbolComponent } from '../../shared/area-symbol/area-symbol.component';
import { CountUp } from './count-up';
import { CodexHoloCategoryPanelComponent } from './codex-holo-category-panel.component';
import { HoloCategoryId, HoloCategoryModel } from './holo-category-model';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { logWarn } from '../../core/log';
import { AnalyticsService } from '../../core/analytics.service';
import { claimRootAttr } from '../../core/root-var';
import { SheetSnap, SnapHeights, cycleSnap, dragVisible, releaseVelocity, settleSnap } from './holo-sheet-snap';

const GROUP_ICON: Readonly<Record<PowerGroup, string>> = {
  weapons: 'weapon',
  shields: 'shield',
  thrusters: 'thruster',
  coolers: 'cooler',
  radar: 'radar',
  life: 'lifeSupport',
  quantum: 'quantum',
  tractor: 'tractor',
};

const PERSPECTIVE_TILES: readonly Perspective[] = ['offensive', 'defensive', 'movement'];

/** Cell order inside a strip tile — the headline first (concept round 10:
 * Alpha · Salve · Dauer | Schild-HP · Regen | Boost · SCM). */
const STRIP_TILE_ORDER: Readonly<Record<Perspective, readonly string[]>> = {
  offensive: ['alpha', 'burstDps', 'sustainedDps', 'missiles'],
  defensive: ['shieldHp', 'shieldRegen', 'hullHp', 'effectiveHp', 'armorHp'],
  movement: ['boost', 'scm', 'maxSpeed', 'agility', 'quantumRange', 'quantumSpeed', 'spool', 'mass', 'cargo'],
  signature: ['ir', 'emLoad', 'crossSection', 'emIdle'],
};

interface PerspectiveTile {
  perspective: Perspective;
  labelKey: string;
  cells: readonly KpiStripCell[];
}

export type { StripMission } from './codex-holo-einsatz.component';

let uidSeq = 0;

@Component({
  selector: 'sc-codex-holo-strip',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, ScActionDirective, AreaSymbolComponent, CodexHoloCategoryPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holo-strip" [class.away]="!stripShown()" [class.open]="expanded()" [class.sheet]="phone" [class.dragging]="dragging()" [attr.data-snap]="phone ? snap() : null"
         (keydown.escape)="phone && snap() !== 'peek' && setSnap('peek', true)">
      @if (phone) {
        <!-- Half / full: the page behind is dimmed; a tap on it folds the sheet back to peek. -->
        <div class="sheet-scrim" aria-hidden="true" (click)="setSnap('peek', true)"></div>
      }
      @if (expanded() || phone) {
        <div class="hs-panel" [id]="panelId" role="region" [attr.aria-label]="'codex.holo.strip.dockAria' | translate"
             [attr.inert]="phone && snap() === 'peek' ? '' : null"
             animate.enter="hp-enter" animate.leave="hp-leave"
             (keydown.escape)="dismissTooltips()" (focusin)="reopenTooltips()" (pointerenter)="reopenTooltips()">
          <div class="hp-energy">
          <div class="hp-modes">
            <div class="seg-pick" role="radiogroup" [attr.aria-label]="'codex.energy.mode.label' | translate">
              @for (m of modes; track m) {
                <button type="button" class="m" [class.on]="mode() === m" role="radio" [attr.aria-checked]="mode() === m" (click)="setMode(m)">
                  {{ ('codex.energy.mode.' + m) | translate }}
                </button>
              }
            </div>
            <button type="button" class="m preset" [class.on]="preset() === 'stealth'" (click)="setPreset('stealth')">
              {{ 'codex.holo.strip.stealthPreset' | translate }}<small>{{ 'codex.holo.strip.presetTag' | translate }}</small>
            </button>
            <button type="button" class="m preset" [class.on]="preset() === 'auto'" (click)="setPreset('auto')">
              {{ 'codex.energy.preset.auto' | translate }}
            </button>
          </div>

          @if (sheet().available) {
            <div class="hp-pips" [style.--pips]="maxPips()">
              @for (row of sheet().groups; track row.key) {
                <div class="hp-col" [class.off]="row.state === 'off'" [class.act]="row.state === 'active'" [class.absent]="row.state === 'absent'">
                  <div
                    class="stack"
                    role="group"
                    [attr.aria-label]="row.labelKey | translate: row.labelParams"
                    (keydown.arrowUp)="stepPipFocus($event, 1)"
                    (keydown.arrowDown)="stepPipFocus($event, -1)"
                  >
                    @for (pip of row.pips; track $index) {
                      <button
                        type="button"
                        class="pip"
                        [class.on]="pip.kind === 'on'"
                        [class.min]="pip.kind === 'min'"
                        [attr.data-n]="pip.numeral"
                        [attr.aria-pressed]="pip.kind !== 'empty'"
                        [attr.aria-label]="
                          'codex.energy.pip.level' | translate: { group: (row.labelKey | translate: row.labelParams), n: $index + 1, m: row.capacity }
                        "
                        [disabled]="!pipsEnabled(row)"
                        (click)="clickPip(row, $index + 1)"
                      ></button>
                    } @empty {
                      <span class="pip ghost" aria-hidden="true"></span>
                    }
                  </div>
                  <div>
                    <button type="button" class="grp-btn"
                            [scTooltip]="(row.tooltipTitleKey | translate: row.labelParams) + ' · ' + (row.tooltipBodyKey | translate)" scTooltipTier="label"
                            [attr.aria-pressed]="row.cut" [attr.aria-label]="(row.cut ? 'codex.energy.toggleOn' : 'codex.energy.toggleOff') | translate: { group: row.labelKey | translate: row.labelParams }" (click)="toggleGroup(row.key)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">
                        <path [attr.d]="iconPath(row.group)" />
                      </svg>
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <p class="gapv">{{ 'codex.energy.gap.noReactorData' | translate }}</p>
          }

          <div class="hp-right">
            <div class="hp-cooling">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle class="tr" cx="32" cy="32" r="26" />
                @if (sheet().coolant.percent !== null) {
                  <circle class="va" [class.over]="sheet().coolant.percent! > 100" cx="32" cy="32" r="26" [attr.stroke-dasharray]="coolDash(sheet().coolant.percent!)" />
                }
                <text class="p" x="32" y="31">{{ sheet().coolant.percent !== null ? sheet().coolant.percent + ' %' : '—' }}</text>
                <text class="l" x="32" y="42">{{ 'codex.holo.strip.cooling' | translate }}</text>
              </svg>
              <div class="hp-cool-txt">
                @if (sheet().coolant.used != null) {
                  <span class="v">{{ 'codex.holo.strip.coolingValue' | translate: { used: sheet().coolant.used, total: sheet().coolant.total } }}</span>
                  <span class="k">{{ 'codex.holo.strip.cooling' | translate }}</span>
                } @else {
                  <span class="gapv">{{ coolantGapKey() | translate }}</span>
                }
              </div>
            </div>

            <div class="hp-summary">
              @if (sheet().available) {
                <span class="v">{{ sheet().budgetUsed }}&nbsp;/&nbsp;{{ sheet().budgetTotal }} <small>{{ 'codex.energy.unit.segments' | translate }}</small></span>
                <span class="ok" [class.no]="!sheet().ready">
                  {{ sheet().ready ? '✓' : '✕' }} {{ (sheet().ready ? 'codex.energy.readiness.shortOk' : 'codex.energy.readiness.shortNo') | translate }}
                </span>
              } @else {
                <span class="gapv">—</span>
              }
              <span class="mode">{{ ('codex.energy.mode.' + mode()) | translate }}</span>
              <button type="button" class="m reset" (click)="reset()">{{ 'codex.energy.preset.reset' | translate }}</button>
            </div>
            @if (sheet().available) {
              <p class="draft-note">{{ 'codex.energy.draftNote' | translate }}</p>
            }
          </div>
          </div>
          <!-- The four perspective areas, on the row's own columns. -->
          <ng-content select="[hsDock]" />
        </div>
      }
      @if (openArea(); as area) {
        @if (models(); as m) {
          <div class="cat-panel" [id]="catPanelId" role="region" [attr.data-p]="area"
               [attr.aria-label]="'codex.holo.panel.aria' | translate: { area: areaLabel(area) | translate }"
               animate.enter="cp-enter" animate.leave="cp-leave">
            <button type="button" scAction tier="tertiary" class="cp-close" [attr.aria-label]="'codex.holo.panel.close' | translate"
                    [scTooltip]="'codex.holo.panel.close' | translate" scTooltipTier="label" (click)="closeArea(true)">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <sc-codex-holo-category-panel [area]="area" [models]="m" />
          </div>
        }
      }
      <div class="hs-row">
        @for (tile of perspectiveTiles(); track tile.perspective) {
          <button type="button" class="seg tile" [attr.data-p]="tile.perspective" [class.sel]="openArea() === tile.perspective"
                  [attr.aria-expanded]="openArea() === tile.perspective" [attr.aria-controls]="openArea() === tile.perspective ? catPanelId : null"
                  (click)="toggleArea(tile.perspective, $event)">
            <span class="lab"><sc-area-symbol class="area-sym" [area]="tile.perspective" /><span class="lt">{{ tile.labelKey | translate }}</span></span>
            <div class="tile-vals">
              @for (c of tile.cells; track c.key) {
                <span class="tv" [class.flash]="flashKeys().has(c.key)">
                  <span class="k">{{ ('codex.kpi.short.' + c.key) | translate }}</span>
                  <span class="v">{{ fmtRolled(c) }}</span>
                  @if (deltaTone(c); as tone) {
                    <span class="d" [class.up]="tone === 'up'" [class.down]="tone === 'down'"
                      >{{ c.delta!.raw > 0 ? '+' : '−' }}{{ fmt(absDelta(c)) }}</span
                    >
                  }
                </span>
              } @empty {
                <!-- Nothing in this perspective has a value for this hull — say
                     so instead of leaving a label over an empty cell. -->
                <span class="tv none" [scTooltip]="'codex.kpi.gap' | translate" scTooltipTier="label"><span class="k">&nbsp;</span><span class="v">—</span></span>
              }
            </div>
          </button>
        }

        <button type="button" class="seg tile sig" data-p="signature" [class.sel]="openArea() === 'signature'"
                [attr.aria-expanded]="openArea() === 'signature'" [attr.aria-controls]="openArea() === 'signature' ? catPanelId : null"
                (click)="toggleArea('signature', $event)">
          <span class="lab"><sc-area-symbol class="area-sym" area="signature" /><span class="lt">{{ 'codex.holo.strip.signature' | translate }}</span></span>
          <div class="tile-vals">
          <span class="fact" [scTooltip]="fmtM($safeNavigationMigration(irFact()?.value)) + '\u00a0m'" scTooltipTier="label">
            <span class="tip-trigger">{{ 'codex.energy.fact.ir' | translate }}</span>
            <span class="v pulse">{{ fmtKm(up('ir', irFact()?.value)) }}<small>km</small></span>
          </span>
          <span class="fact" [scTooltip]="fmtM($safeNavigationMigration(emFact()?.value)) + '\u00a0m'" scTooltipTier="label">
            <span class="tip-trigger">{{ 'codex.energy.fact.em' | translate }}</span>
            <span class="v pulse">{{ fmtKm(up('em', emFact()?.value)) }}<small>km</small></span>
          </span>
          <span class="fact" [scTooltip]="fmtM($safeNavigationMigration(csFact()?.value)) + '\u00a0m'" scTooltipTier="label">
            <span class="tip-trigger">{{ 'codex.energy.fact.crossSection' | translate }}</span>
            <span class="v pulse">{{ fmtKm(up('cs', csFact()?.value)) }}<small>km</small></span>
          </span>
          <span class="fact">
            <span class="tip-trigger">{{ 'codex.holo.strip.cooling' | translate }}</span>
            <span class="v pulse">{{
              sheet().coolant.used == null
                ? '—'
                : ('codex.holo.strip.coolingValue' | translate: { used: upInt('coolUsed', sheet().coolant.used), total: upInt('coolTotal', sheet().coolant.total) })
            }}</span>
          </span>
          </div>
        </button>

      </div>
      <!-- The dock's handle: a thin bar under the capsule (concept holotisch-feinschliff C8), it takes no width from the four topics. -->
      <button
        type="button"
        class="hs-toggle"
        #handle
        [attr.aria-expanded]="expanded()"
        [attr.aria-controls]="panelId"
        [attr.aria-label]="(expanded() ? 'codex.holo.strip.collapse' : 'codex.holo.strip.expand') | translate"
        [scTooltip]="(expanded() ? 'codex.holo.strip.collapse' : 'codex.holo.strip.expand') | translate"
        scTooltipTier="label"
        (click)="onHandleClick()"
        (pointerdown)="onHandleDown($event)"
        (pointermove)="onHandleMove($event)"
        (pointerup)="onHandleUp($event)"
        (pointercancel)="onHandleUp($event)"
      >
        <span class="bar" [class.open]="expanded()" aria-hidden="true"></span>
      </button>

    </div>
  `,
  styles: [
    `
      :host { display: block; position: sticky; inset-block-end: 0; z-index: 14;
        --e-out: var(--holo-e-out);
        --hs-mono: var(--font-monospace, 'Share Tech Mono', monospace);
        --p-offensive: var(--holo-p-offensive);
        --p-defensive: var(--holo-p-defensive);
        --p-movement: var(--holo-p-movement);
        --p-signature: var(--holo-p-signature); }
      .holo-strip {
        position: relative;
        padding-block-end: env(safe-area-inset-bottom, 0px);
        /* One capsule in the header's skin; its rim carries the Einsatz. */
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)), color-mix(in srgb, var(--sc-accent) 3%, var(--sc-bg-0)));
        border: 1px solid color-mix(in srgb, var(--holo-e, var(--sc-accent)) 28%, transparent);
        border-block-end: 0;
        border-radius: 18px 18px 0 0;
        box-shadow: 0 -10px 30px rgb(0 0 0 / 0.5);
        transition: border-color var(--holo-t-base) ease;
        color: var(--sc-fg-0);
        font-size: max(13px, var(--sc-fs-floor));
      }
      /* Desktop, touching the Perspektiven panel above (--holo-join, set by the
         stage): one box with it — top corners square, no top edge or shadow,
         bottom corners rounded like the box's outer corners. */
      @media (min-width: 901px) {
        .holo-strip {
          border-radius: calc(18px * (1 - var(--holo-join, 0))) calc(18px * (1 - var(--holo-join, 0))) calc(16px * var(--holo-join, 0)) calc(16px * var(--holo-join, 0));
          border-block-start-width: calc(1px * (1 - var(--holo-join, 0)));
          border-block-end: calc(1px * var(--holo-join, 0)) solid color-mix(in srgb, var(--holo-e, var(--sc-accent)) 28%, transparent);
          box-shadow: 0 -10px 30px rgb(0 0 0 / calc(0.5 * (1 - var(--holo-join, 0))));
        }
      }
      /* --fab-clear: the feedback launcher owns the bottom-right corner
         (--sc-fab-lane in styles.scss) — where the strip reaches into that
         lane, its content stops short of it (measured, see the class). */
      .hs-row { display: flex; align-items: stretch; gap: 0; padding: 0; padding-inline-end: var(--fab-clear, 0px); overflow-x: auto;
        scrollbar-width: none; min-block-size: 64px; }
      .hs-row::-webkit-scrollbar { display: none; }
      /* The cells are buttons: they keep the strip's own look, only the browser's button skin goes. */
      button.seg { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer;
        transition: background var(--holo-t-fast) ease; }
      button.seg:hover { background: color-mix(in srgb, var(--p, var(--sc-accent)) 7%, transparent); }
      button.seg:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
      /* The open cell lights up in its area's colour. */
      button.seg.sel { background: color-mix(in srgb, var(--p) 14%, transparent); box-shadow: inset 0 -2px 0 var(--p); }
      .seg { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 6px clamp(7px, 0.6vw, 11px); min-width: 0; flex: 1 1 auto; }
      .seg .lab { display: inline-flex; align-items: baseline; gap: 8px; font-family: var(--sc-font-display); font-size: max(13px, var(--sc-fs-floor));
        letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-accent); white-space: nowrap; }
      /* Each area's symbol in its colour (#330); the label beside it stays the accent. */
      .seg[data-p="offensive"] { --p: var(--p-offensive); }
      .seg[data-p="defensive"] { --p: var(--p-defensive); }
      .seg[data-p="movement"] { --p: var(--p-movement); }
      .seg[data-p="signature"] { --p: var(--p-signature); }
      .seg .lab .area-sym { align-self: center; color: var(--p, var(--sc-accent)); font-size: max(13px, var(--sc-fs-floor)); }
      .tile-vals { display: flex; justify-content: space-between; gap: clamp(6px, 0.5vw, 9px); flex-wrap: nowrap; }
      .tv { display: flex; flex-direction: column; gap: 1px; }
      .tv .k { font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; }
      .tv .v { font-family: var(--hs-mono); font-variant-numeric: tabular-nums; font-size: clamp(14px, 0.89vw, 17px); line-height: 1.1; color: var(--sc-fg-0); white-space: nowrap; letter-spacing: -0.02em;
        border-radius: 2px; transition: color 0.4s ease; }
      .tv.none .v { color: var(--sc-fg-2); }
      /* A value the pilot just changed (a swap, a revert) lights up once. */
      .tv.flash .v { animation: val-flash 900ms var(--e-out); }
      @keyframes val-flash { 0% { color: var(--sc-accent); text-shadow: 0 0 10px color-mix(in srgb, var(--sc-accent) 70%, transparent);
        background: color-mix(in srgb, var(--sc-accent) 16%, transparent); } }
      .d { font-family: var(--hs-mono); font-size: max(13px, var(--sc-fs-floor)); font-variant-numeric: tabular-nums; }
      .d.up { color: var(--sc-success); }
      .d.down { color: var(--sc-warning); }
      .fact { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; }
      .fact .v { font-family: var(--hs-mono); font-variant-numeric: tabular-nums; font-size: clamp(14px, 0.89vw, 17px); line-height: 1.1; white-space: nowrap; letter-spacing: -0.02em; }
      .fact .v small { color: var(--sc-fg-2); margin-inline-start: 3px; font-size: max(13px, var(--sc-fs-floor)); }
      .fact[tabindex] { cursor: help; border-radius: var(--holo-r-xs); }
      .fact[tabindex]:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
      /* Touch: a focusable fact (tooltip in metres) reaches the tap minimum. */
      @media (pointer: coarse) { .fact[tabindex] { min-block-size: var(--sc-tap-min); min-inline-size: var(--sc-tap-min); justify-content: center; } }
      .tip-trigger { font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .gapv { color: var(--sc-fg-2); }

      /* Desktop: the four topics share the whole row evenly (the Einsatz sits in
         the head, the dock's handle under the row — concept holotisch-feinschliff C4/C8). */
      @media (min-width: 901px) {
        .hs-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding-inline-end: 0; }
        .seg.tile + .seg.tile { border-inline-start: 1px solid color-mix(in srgb, var(--sc-accent) 22%, transparent); }
      }
      /* The handle: a thin bar under the capsule, the full width is its target. */
      .hs-toggle { display: flex; align-items: center; justify-content: center; inline-size: 100%; block-size: 14px; padding: 0; margin: 0;
        border: 0; border-block-start: 1px solid color-mix(in srgb, var(--sc-accent) 14%, transparent); background: transparent; cursor: pointer;
        transition: background var(--holo-t-fast) ease; }
      .hs-toggle .bar { display: block; inline-size: 44px; block-size: 3px; border-radius: 2px; background: color-mix(in srgb, var(--sc-accent) 55%, transparent);
        transition: background var(--holo-t-fast) ease, inline-size var(--holo-t-base) var(--e-out); }
      .hs-toggle:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .hs-toggle:hover .bar, .hs-toggle .bar.open { background: var(--sc-accent); inline-size: 64px; }
      .hs-toggle:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
      /* Touch: the bar keeps its look, the row under it grows to a reachable target. */
      @media (pointer: coarse) { .hs-toggle { block-size: 48px; min-block-size: 48px; } }
      /* The dock: over the page, docked on the row (concept r1-dock-open
         "both": the arrow opens it anywhere). Energy is its own row on top
         (r1-dock-energy "row"), the four areas under it. Capped to the
         viewport, scrolls inside. */
      /* Above 640px the whole box - border, background and this open dock - ends before the share lane
         and the launcher (concept codex-kopf-besitz C8): margin, not padding. */
      @media (min-width: 641px) {
        .holo-strip { margin-inline-end: var(--fab-clear, 0px); }
        .hs-row { padding-inline-end: 0; }
      }
      /* The "continue on the phone" button owns the bottom-left corner the same way (it lay over "Offensive"): from the
         tablet up, on the desktop too (U2, round 2: at 1280 it still lay over the first cell). */
      @media (min-width: 641px) {
        .holo-strip { margin-inline-start: var(--fab-clear-start, 0px); }
      }
      .hs-panel { position: absolute; inset-inline: -1px; inset-block-end: 100%; z-index: 4;
        display: flex; flex-direction: column; gap: 0;
        max-block-size: calc(100dvh - var(--holo-strip-h, 64px) - 72px); overflow-y: auto; overscroll-behavior: contain;
        background: color-mix(in srgb, var(--sc-accent) 6%, var(--sc-bg-0));
        border: 1px solid color-mix(in srgb, var(--holo-e, var(--sc-accent)) 28%, transparent); border-block-end: 0;
        border-radius: 16px 16px 0 0; box-shadow: 0 -12px 34px rgb(0 0 0 / 0.55); }
      /* The strip shows only once the category heads have scrolled out above (they carry the same numbers). */
      .holo-strip { transition: transform var(--holo-t-base) var(--e-out), opacity var(--holo-t-base) ease, border-color var(--holo-t-base) ease; }
      .holo-strip.away { transform: translateY(100%); opacity: 0; visibility: hidden; pointer-events: none; }
      /* ds-ok: the fold-out is its own surface — the strip's capsule skin, as wide as the strip, a third of the screen at most (vh = fallback). */
      .cat-panel { position: absolute; inset-inline: -1px; inset-block-end: 100%; z-index: 4;
        max-block-size: 33vh; max-block-size: 33dvh; overflow-y: auto; overscroll-behavior: contain;
        padding: 12px 48px 12px 16px;
        background: color-mix(in srgb, var(--sc-accent) 6%, var(--sc-bg-0));
        border: 1px solid color-mix(in srgb, var(--p, var(--sc-accent)) 40%, transparent); border-block-end: 0;
        border-radius: 16px 16px 0 0; box-shadow: 0 -12px 34px rgb(0 0 0 / 0.55); --p: var(--p-offensive); }
      .cat-panel[data-p='defensive'] { --p: var(--p-defensive); }
      .cat-panel[data-p='movement'] { --p: var(--p-movement); }
      .cat-panel[data-p='signature'] { --p: var(--p-signature); }
      .cp-close { position: absolute; inset-block-start: 8px; inset-inline-end: 8px; }
      .cp-enter { animation: hp-in 260ms var(--e-out); }
      .cp-leave { animation: hp-out 180ms ease-in forwards; }
      .holo-strip.open { border-start-start-radius: 0; border-start-end-radius: 0; }
      /* Energy row: modes | pips | cooling (concept round 6 "Energie-Zeile"). */
      .hp-energy { padding: 10px 14px; display: grid; grid-template-columns: 170px 1fr 240px; gap: 18px; align-items: center;
        border-block-end: 1px solid color-mix(in srgb, var(--sc-accent) 20%, transparent); }
      /* The panel unfolds out of the strip and folds back into it. */
      .hp-enter { animation: hp-in 260ms var(--e-out); }
      .hp-leave { animation: hp-out 180ms ease-in forwards; }
      @keyframes hp-in { from { opacity: 0; clip-path: inset(100% 0 0 0); } }
      @keyframes hp-out { to { opacity: 0; clip-path: inset(100% 0 0 0); } }
      .hp-modes { display: grid; gap: 6px; padding-inline-end: 22px; border-inline-end: 1px solid var(--sc-border); }
      .seg-pick { display: grid; gap: 6px; }
      .m { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid var(--sc-border); border-radius: 3px;
        background: transparent; color: var(--sc-fg-1); padding: 5px 10px; min-block-size: var(--sc-tap-min, 30px); cursor: pointer;
        font-family: var(--sc-font-display); font-size: max(13px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; text-align: start; }
      .m small { font-family: var(--hs-mono); letter-spacing: 0; text-transform: none; font-size: 13px; color: var(--sc-fg-2); }
      .m.on { color: var(--sc-accent); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .m.preset { border-style: dashed; border-color: rgba(var(--accent-gold-rgb, 200, 168, 75), 0.5); color: var(--p-signature); }
      .m.preset.on { background: rgba(var(--accent-gold-rgb, 200, 168, 75), 0.12); border-style: solid; border-color: var(--p-signature); }
      .m.reset { justify-content: center; padding: 3px 8px; min-block-size: 26px; font-size: max(13px, var(--sc-fs-floor)); }
      .hp-pips { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; --pip-h: 10px; --pip-gap: 3px; --pip-w: 26px; --pips: 1; }
      .hp-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .stack { display: flex; flex-direction: column-reverse; gap: var(--pip-gap);
        block-size: calc(var(--pips) * var(--pip-h) + (var(--pips) - 1) * var(--pip-gap)); min-block-size: 30px; }
      .stack .pip { inline-size: var(--pip-w); block-size: var(--pip-h); border: none; border-radius: 2px;
        background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); cursor: pointer; padding: 0;
        transition: background 160ms ease, box-shadow 160ms ease, transform 120ms ease; }
      .stack .pip:not(:disabled):hover { transform: scaleX(1.08); box-shadow: 0 0 0 1px color-mix(in srgb, var(--sc-accent) 55%, transparent); }
      .stack .pip.on { box-shadow: 0 0 6px color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      .stack .pip.on { background: var(--sc-accent); }
      .stack .pip.min { background: var(--sc-warning); }
      .hp-col.off .stack .pip { background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent); }
      .hp-col.absent .stack .pip { background: color-mix(in srgb, var(--sc-fg-2) 8%, transparent); border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 30%, transparent); }
      .grp-btn { min-inline-size: var(--sc-tap-min); min-block-size: var(--sc-tap-min); border: 1px solid transparent;
        border-radius: 3px; background: transparent; color: var(--sc-fg-2); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; }
      /* Touch: the global 48px button floor turned every 10px pip into a 48px
         block, and the fixed-height stack let them climb over the mode buttons
         above it. A pip keeps the bar shape (the stack is the target, one
         segment per level) and grows the way the energy dock's do. */
      @media (pointer: coarse) {
        .hp-pips { --pip-h: 16px; --pip-w: 30px; }
        .stack .pip { min-block-size: 0; min-inline-size: 0; }
      }
      .hp-col.act .grp-btn { color: var(--sc-accent); }
      .ico { width: 16px; height: 16px; }
      .hp-right { display: grid; gap: 6px; padding-inline-start: 22px; border-inline-start: 1px solid var(--sc-border); }
      .hp-cooling { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: center; }
      .hp-cooling svg { width: 64px; height: 64px; display: block; }
      .hp-cooling .tr { fill: none; stroke: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); stroke-width: 7; }
      .hp-cooling .va { fill: none; stroke: var(--sc-accent); stroke-width: 7; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
      /* Overload, not a comparison: the cooling cannot hold what is asked of it
         — an error, not a hint (same rule as the energy dock). Stays danger red. */
      .hp-cooling .va.over { stroke: var(--sc-warning); }
      .hp-cooling text { font-family: var(--hs-mono); font-size: 12px; fill: var(--sc-fg-0); text-anchor: middle; }
      .hp-cooling text.l { font-family: var(--sc-font-display); font-size: 5.5px; letter-spacing: 0.14em; fill: var(--sc-fg-2); text-transform: uppercase; }
      .hp-cool-txt { display: grid; gap: 1px; }
      .hp-cool-txt .v { font-family: var(--hs-mono); font-size: 14px; color: var(--sc-fg-0); }
      .hp-cool-txt .k { font-family: var(--sc-font-display); font-size: max(13px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); }
      .hp-summary { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-variant-numeric: tabular-nums; color: var(--sc-fg-1); }
      .hp-summary .v { font-family: var(--hs-mono); font-size: 13px; color: var(--sc-fg-0); }
      .hp-summary .v small { font-size: 13px; color: var(--sc-fg-2); }
      .hp-summary .mode { font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.14em; font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .hp-summary .ok { font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-success); }
      .hp-summary .ok.no { color: var(--sc-danger); }
      .draft-note { margin: 0; font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
      @media (max-width: 1100px) {
        .hp-energy { grid-template-columns: 1fr; gap: 12px; }
        .hp-modes { padding-inline-end: 0; border-inline-end: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .seg-pick { grid-template-columns: 1fr 1fr; grid-column: 1 / -1; }
        .hp-right { padding-inline-start: 0; border-inline-start: 0; }
      }

      /* concept it.1 fb-ready count-up pulse — reduced away below. */
      .pulse { transition: color 0.4s ease; }

      /* Phone: the sticky KPI row keeps one value per perspective (concept
         mo5-stack "sticky Kennzahl-Zeile"); the rest lives in the expanded sheet. */
      @media (max-width: 900px) {
        .tile-vals .tv + .tv { display: none; }
        .sig .fact + .fact { display: none; }
        .seg { padding: 6px 8px; }
        .sig .lab { max-inline-size: 64px; white-space: normal; line-height: 1.15; }
      }
      @media (max-width: 640px) {
        /* The phone sheet (concept mobile spec 3.4): full width, standing on the search bar (--holo-strip-lift), three snap points.
           The bar itself is the peek (handle + the three values); the panel is the part that rises, moved by transform only
           and clipped at the bar's bottom edge so it never shows over the search capsule. */
        .holo-strip { position: fixed; inset-inline: 0; inset-block-end: var(--holo-strip-lift, 0px); border-radius: 16px 16px 0 0; display: flex; flex-direction: column;
          clip-path: inset(-100vh 0 0 0); }
        .hs-toggle { order: -1; touch-action: none; block-size: 44px; min-block-size: 44px; }
        .hs-row { min-block-size: 52px; position: relative; z-index: 1; background: color-mix(in srgb, var(--sc-accent) 6%, var(--sc-bg-0)); }
        .hs-toggle { position: relative; z-index: 1; background: color-mix(in srgb, var(--sc-accent) 6%, var(--sc-bg-0)); border-radius: 16px 16px 0 0; }
        .hs-panel { inset-block-end: 100%; block-size: var(--_pfull, 0px); max-block-size: none; translate: 0 calc(100% - var(--_v, 0px)); will-change: auto; animation: none !important; border-radius: 16px 16px 0 0; z-index: 0; }
        .holo-strip.dragging .hs-panel { will-change: translate; }
        .holo-strip:not(.dragging) .hs-panel { transition: translate var(--sc-t-base, var(--holo-t-base)) var(--sc-e-out, var(--holo-e-out)), visibility 0s; }
        .holo-strip[data-snap='peek'] .hs-panel { visibility: hidden; box-shadow: none; transition: translate var(--sc-t-base, var(--holo-t-base)) var(--sc-e-out, var(--holo-e-out)), visibility 0s linear var(--sc-t-base, var(--holo-t-base)); }
        .sheet-scrim { position: absolute; inset-inline: 0; inset-block: -100vh 0; z-index: -1; background: color-mix(in srgb, var(--sc-bg-0) 40%, transparent); opacity: 0; pointer-events: none;
          transition: opacity var(--sc-t-base, var(--holo-t-base)) var(--sc-e-out, var(--holo-e-out)); }
        .holo-strip:is([data-snap='half'], [data-snap='full']) .sheet-scrim { opacity: 1; pointer-events: auto; }
        /* The narrowest phones: symbol + class + the three perspectives; the page's Signatur tile keeps those values. */
        @media (max-width: 430px) { .sig { display: none; } }
        .seg { padding: 5px 7px; flex: 1 1 0; }
        .tile-vals { min-inline-size: 0; }
        .tv .v, .fact .v { font-size: 13px; }
        .seg .lab .lt { display: none; }
        .seg .lab { gap: 0; }
        .tile-vals .tv .k { display: none; }
        .rankpips { display: none; }
        .sig .lab { max-inline-size: none; }
        .tip-trigger { display: none; }
        /* Phone: the dock rides on the fixed bar, which already ends before
           the feedback launcher's lane — nothing of it sits under the FAB. */
        .hs-panel { border-radius: 16px 16px 0 0; }
        .cat-panel { padding-inline-end: 48px; }
      }
      /* A phone on its side (two-pane page): the bar rides in the flow at the page's end instead of eating a third of the screen. */
      @media (orientation: landscape) and (max-height: 500px) {
        :host { position: static; }
        .holo-strip { position: relative; inset: auto; clip-path: none; margin-inline-end: 0; }
        .hs-panel { translate: none; inset-block-end: 100%; block-size: auto; max-block-size: 70dvh; visibility: visible; }
      }
      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; animation: none !important; }
      }
    `,
  ],
})
export class CodexHoloStripComponent {
  // ── mirrors sc-codex-energy-dock's inputs 1:1 ──────────────────────────
  readonly occupants = input.required<readonly SummaryOccupant[]>();
  readonly shipStats = input<Record<string, Record<string, string | number | boolean | null>> | null>(null);
  readonly shipClassName = input.required<string>();
  readonly schemaVersion = input<number | null>(null);
  readonly userId = input<string | null>(null);
  readonly crossSection = input<number | null>(null);
  readonly sheetChange = output<PowerSheet>();

  // ── mirrors sc-codex-kpi-band's input 1:1 ──────────────────────────────
  readonly cells = input.required<readonly KpiStripCell[]>();

  // The Einsatz picker lives in the head now (sc-codex-holo-einsatz, concept holotisch-feinschliff C4).
  readonly capabilities = input<ShipCapabilities | null>(null);
  /** The category models the fold-out panels draw from (the stage's `categoryModels()`). */
  readonly models = input<HoloCategoryModel | null>(null);

  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly modes: readonly FlightMode[] = ['scm', 'nav'];

  private readonly uid = `holo-strip-${++uidSeq}`;
  protected readonly panelId = `${this.uid}-panel`;
  protected readonly catPanelId = `${this.uid}-cat`;
  /** The strip appears once the category heads have scrolled out above (true until they are found: never lost). */
  protected readonly stripShown = signal(false);
  protected readonly openArea = signal<HoloCategoryId | null>(null);
  private openedFrom: HTMLElement | null = null;

  private readonly cutGroups = signal<ReadonlySet<PowerColumnKey>>(new Set());
  private readonly levels = signal<PowerLevels>({});
  protected readonly mode = signal<FlightMode>('scm');
  protected readonly preset = signal<PowerPreset>('auto');
  protected readonly expanded = signal<boolean>(false);
  /** Phone sheet: where the panel rests (peek = closed, only the bar shows). */
  protected readonly snap = signal<SheetSnap>('peek');
  protected readonly dragging = signal(false);
  private readonly analytics = inject(AnalyticsService);
  private readonly handleRef = viewChild<ElementRef<HTMLElement>>('handle');
  private drag: { startY: number; startVisible: number; moved: boolean; samples: { t: number; y: number }[]; id: number } | null = null;
  private suppressClick = false;
  private dragRaf = 0;
  private dragVisiblePx = 0;
  /** A phone (≤ 640 px at load): the strip is one slim, fixed row. */
  protected readonly phone = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
  protected readonly tipsHidden = signal(false);

  private previousSheet: PowerSheet | null = null;

  protected readonly sheet = computed<PowerSheet>(() => {
    const result = computePowerSheet({
      occupants: this.occupants(),
      shipStats: this.shipStats(),
      schemaVersion: this.schemaVersion(),
      mode: this.mode(),
      preset: this.preset(),
      cutGroups: this.cutGroups(),
      levels: this.levels(),
      previous: this.previousSheet,
    });
    this.previousSheet = result;
    return result;
  });

  protected readonly maxPips = computed(() => Math.max(1, ...this.sheet().groups.map((g) => g.pips.length)));

  protected readonly irFact = computed(() => this.sheet().facts.find((f) => f.key === 'ir'));
  protected readonly emFact = computed(() => this.sheet().facts.find((f) => f.key === 'em'));
  /** WHY the cooling load is empty — no coolers vs. no stated draw. */
  protected readonly coolantGapKey = computed(
    () => this.sheet().facts.find((f) => f.key === 'coolant')?.gapKey ?? 'codex.energy.gap.noCoolingData',
  );
  protected readonly csFact = computed(() => {
    const base = this.sheet().facts.find((f) => f.key === 'crossSection');
    const override = this.crossSection();
    if (!base) return base;
    if (override == null || base.value != null) return base;
    return { ...base, value: override, gapKey: null };
  });

  /** groups `cells()` (already computed against the active mission) into the
   * three mini tiles via the SAME classification `buildPerspectiveDeltas`
   * uses for the patch-Δ view — never a second, drifting grouping. */
  protected readonly perspectiveTiles = computed<PerspectiveTile[]>(() => {
    const cells = this.cells();
    return PERSPECTIVE_TILES.map((perspective) => {
      const keys = new Set(PERSPECTIVE_KPIS[perspective]);
      const order = STRIP_TILE_ORDER[perspective];
      const tileCells = cells
        .filter((c) => keys.has(c.key) && c.value != null)
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
        .slice(0, 3);
      return { perspective, labelKey: `codex.holo.strip.${perspective}`, cells: tileCells };
    });
  });

  // ── Rolling values: a changed number runs from where it stood to where it
  // lands (~700 ms) — a hull switch shows WHICH numbers moved, a swap lights
  // the values it touched. The very first paint is a plain render; reduced
  // motion never rolls. ──
  private readonly still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly shown = new Map<string, number>();
  private shownShip: string | null = null;
  private rollFrom = new Map<string, number>();
  private rollRaf: number | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly rollProgress = signal(1);
  protected readonly flashKeys = signal<ReadonlySet<string>>(new Set());

  private startRoll(cells: readonly KpiStripCell[], ship: string): void {
    const first = this.shown.size === 0;
    const sameShip = this.shownShip === ship;
    const from = new Map<string, number>();
    const changed = new Set<string>();
    for (const c of cells) {
      if (c.value == null) continue;
      const prev = this.shown.get(c.key);
      if (prev !== undefined && prev !== c.value) {
        from.set(c.key, prev);
        changed.add(c.key);
      }
      this.shown.set(c.key, c.value);
    }
    this.shownShip = ship;
    // First appearance: every value counts up from zero (cx-countup) — no flash.
    if (first) for (const c of cells) if (c.value != null && c.value !== 0) from.set(c.key, 0);
    if (this.still || from.size === 0 || typeof requestAnimationFrame !== 'function') return;
    this.rollFrom = from;
    // Date.now, not the frame timestamp: fake clocks (and a throttled tab) advance it too.
    const start = Date.now();
    const ms = 700;
    if (this.rollRaf) cancelAnimationFrame(this.rollRaf);
    this.rollProgress.set(0);
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      this.rollProgress.set(1 - Math.pow(1 - t, 3));
      this.rollRaf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this.rollRaf = requestAnimationFrame(tick);
    // Only a change on the SAME hull (a swap, a revert, a patch) flashes —
    // a hull switch changes everything, and lighting everything says nothing.
    if (sameShip) {
      this.flashKeys.set(changed);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.flashKeys.set(new Set()), 950);
    }
  }

  /** The cell's value mid-roll (or at rest) — the SAME formatter as `fmtCell`. */
  protected fmtRolled(c: KpiStripCell): string {
    const p = this.rollProgress();
    const from = this.rollFrom.get(c.key);
    if (c.value == null || p >= 1 || from === undefined) return this.fmtCell(c);
    return formatEquippedStat({ labelKey: c.labelKey, value: from + (c.value - from) * p, format: c.format });
  }

  /** How far the strip reaches into the feedback launcher's corner lane. */
  private measureFabClearance(): void {
    const el = this.host.nativeElement;
    const root = getComputedStyle(document.documentElement);
    const lane = (parseFloat(root.getPropertyValue('--sc-fab-inset')) || 24) + (parseFloat(root.getPropertyValue('--sc-fab-size')) || 56);
    const gutter = parseFloat(root.getPropertyValue('--sc-fab-gutter')) || 12;
    // Above 640px the host (full width; the bar itself shrinks by the clearance); on a phone the
    // fixed bar, the host collapses there.
    const box = (this.phone ? (el.querySelector('.holo-strip') ?? el) : el).getBoundingClientRect();
    // clientWidth, not innerWidth: the launcher's `right` inset is measured
    // from the viewport WITHOUT the page's scrollbar.
    let free = document.documentElement.clientWidth - lane - gutter;
    // A detail page's share button rides beside the launcher and never lifts alone (concept
    // codex-kopf-besitz C8): the bar always ends before the share lane.
    const dock = document.querySelector('sc-share-button .dock')?.getBoundingClientRect();
    if (dock && dock.width > 0) free = Math.min(free, dock.left - gutter / 2);
    const clear = Math.max(0, Math.round(box.right - free));
    el.style.setProperty('--fab-clear', `${clear}px`);
    // The handoff button's twin corner on the left (tablet only, see the styles): the bar starts after it.
    const handoff = document.querySelector('sc-handoff-button .wrap')?.getBoundingClientRect();
    const startClear = handoff && handoff.width > 0 ? Math.max(0, Math.round(handoff.right + gutter / 2 - box.left)) : 0;
    el.style.setProperty('--fab-clear-start', `${startClear}px`);
    (el.closest('.holo-stage, [data-holo-root]') as HTMLElement | null)?.style.setProperty('--holo-fab-clear-start', `${startClear}px`);
    // The stage's shared columns end with the same lane, so the parts and the
    // perspectives above stay on the bar's columns (concept r1 d2).
    (el.closest('.holo-stage, [data-holo-root]') as HTMLElement | null)?.style.setProperty('--holo-fab-clear', `${clear}px`);
  }

  /** Last ship class the local power state (`cutGroups`/`levels`/`mode`/
   * `preset`) was restored for — reset to `null` before every host reuses
   * this component instance for a different ship, `restoreState()` re-runs
   * against the *new* ship's own storage key instead of carrying A's state
   * into B's `persistDraft()` writes (wave5 red-team P0, strip is reused
   * across `/codex/ship/A -> /codex/ship/B` navigations). */
  private restoredFor: string | null = null;
  constructor() {
    effect(() => {
      const shipKey = this.shipClassName();
      this.userId();
      if (this.restoredFor === shipKey) return;
      this.restoredFor = shipKey;
      untracked(() => this.restoreState());
    });
    effect(() => {
      this.sheetChange.emit(this.sheet());
    });
    effect(() => {
      const cells = this.cells();
      const ship = this.shipClassName();
      untracked(() => this.startRoll(cells, ship));
    });
    afterNextRender(() => {
      this.measureFabClearance();
      // The share button arrives with the route, after this first measure.
      const late = setTimeout(() => this.measureFabClearance(), 1500);
      this.destroyRef.onDestroy(() => clearTimeout(late));
      const onResize = () => this.measureFabClearance();
      window.addEventListener('resize', onResize, { passive: true });
      // Next frame, not inside the observer callback: the clearance changes layout (ResizeObserver loop).
      let raf = 0;
      const ro = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => { raf ||= requestAnimationFrame(() => { raf = 0; onResize(); }); })
        : null;
      ro?.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('resize', onResize);
        ro?.disconnect();
        cancelAnimationFrame(raf);
      });
    });
    afterNextRender(() => this.watchHeads());
    afterNextRender(() => {
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape' && this.openArea() !== null) this.closeArea(true);
      };
      document.addEventListener('keydown', onKey);
      this.destroyRef.onDestroy(() => document.removeEventListener('keydown', onKey));
    });
    afterNextRender(() => {
      if (!this.phone) return;
      this.paint(0);
      this.claimBottom();
      this.publishSheet();
      const onRot = () => { this.claimBottom(); this.paint(this.snapHeights()[this.snap()]); this.publishSheet(); };
      window.addEventListener('resize', onRot, { passive: true });
      // The peek's own height settles after fonts and the roll-up: republish so the page's bottom padding follows.
      const bar = this.handleRef()?.nativeElement.parentElement;
      const peekRo = bar && typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.publishSheet()) : null;
      if (bar) peekRo?.observe(bar);
      this.destroyRef.onDestroy(() => {
        peekRo?.disconnect();
        claimRootAttr('data-sc-bar-off', this, null);
        window.removeEventListener('resize', onRot);
        document.documentElement.removeAttribute('data-sc-sheet');
        document.documentElement.style.removeProperty('--sc-sheet-peek-h');
      });
    });
    this.destroyRef.onDestroy(() => {
      if (this.rollRaf) cancelAnimationFrame(this.rollRaf);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.counter.dispose();
    });
  }

  /** Show the strip only while no category head is on screen below the top edge: it takes over once they scrolled out above. */
  private watchHeads(): void {
    if (typeof IntersectionObserver !== 'function') { this.stripShown.set(true); return; }
    let io: IntersectionObserver | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let tries = 0;
    const state = new Map<Element, boolean>();
    const apply = () => this.stripShown.set(state.size > 0 && [...state.values()].every(Boolean));
    const attach = (): boolean => {
      const heads = Array.from(document.querySelectorAll('sc-codex-holo-category-head'));
      if (heads.length === 0) return false;
      io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          const r = en.boundingClientRect;
          // Out of sight above the viewport (or not laid out at all) = passed; below = still ahead.
          state.set(en.target, !en.isIntersecting && (r.bottom < 0 || (r.width === 0 && r.height === 0)));
        }
        apply();
      });
      heads.forEach((h) => io!.observe(h));
      return true;
    };
    if (!attach()) {
      // The parts area renders after the arrival; look again a few times, then give up and show the strip.
      timer = setInterval(() => {
        tries++;
        if (attach() || tries >= 20) {
          if (timer) clearInterval(timer);
          timer = null;
          if (!io) { logWarn('holo-strip', 'no category heads found, strip stays visible'); this.stripShown.set(true); }
        }
      }, 300);
    }
    this.destroyRef.onDestroy(() => { if (timer) clearInterval(timer); io?.disconnect(); });
  }

  protected areaLabel(area: HoloCategoryId): string {
    return `codex.holo.strip.${area}`;
  }

  protected toggleArea(area: HoloCategoryId, ev: Event): void {
    if (this.openArea() === area) { this.closeArea(false); return; }
    this.openedFrom = ev.currentTarget as HTMLElement | null;
    this.openArea.set(area);
    // One surface at a time over the parts: the energy dock gives way.
    if (this.expanded()) { if (this.phone) this.setSnap('peek'); else this.expanded.set(false); }
    this.analytics.track('codex:stats_panel_open', { area });
  }

  protected closeArea(refocus: boolean): void {
    this.openArea.set(null);
    if (refocus) this.openedFrom?.focus({ preventScroll: true });
  }

  private storageGet(key: string): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private storageSet(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      /* private mode / disabled storage — draft state simply does not persist */
    }
  }

  private restoreState(): void {
    const shipKey = this.shipClassName();
    const local = parseLocalPowerDraft(this.storageGet(powerStorageKey(shipKey)));
    let urlDraft: PowerDraftState | null = null;
    try {
      const raw = this.route?.snapshot?.queryParamMap.get('pw') ?? null;
      urlDraft = decodePowerParam(raw);
    } catch {
      urlDraft = null;
    }
    const draft = urlDraft ?? local ?? DEFAULT_POWER_DRAFT;
    const migrated = migrateLegacyCoolerDraft(
      parsePowerGroups(draft.cutGroups),
      parsePowerLevels(draft.levels),
      coolerUnitCount(this.occupants()),
    );
    this.cutGroups.set(migrated.cutGroups);
    this.levels.set(migrated.levels);
    this.mode.set(isFlightMode(draft.mode) ? draft.mode : 'scm');
    this.preset.set(draft.preset === 'stealth' ? 'stealth' : 'auto');

    // The energy panel always starts closed: opened, it sits over the lower
    // part of the table, so a page must never LOAD with it open (holodeck
    // walkthrough 2026-10-08 — it covered ~40 % of a 900 px viewport).
    this.expanded.set(false);
  }

  private currentDraft(): PowerDraftState {
    return {
      cutGroups: [...this.cutGroups()],
      levels: { ...this.levels() } as Record<string, number>,
      mode: this.mode(),
      preset: this.preset(),
      dock: DEFAULT_POWER_DRAFT.dock,
    };
  }

  private persistDraft(): void {
    const shipKey = this.shipClassName();
    const draft = this.currentDraft();
    this.storageSet(powerStorageKey(shipKey), serializeLocalPowerDraft(shipKey, draft));
    if (!this.router) return;
    const pw = encodePowerParam(draft);
    try {
      void this.router.navigate([], {
        relativeTo: this.route ?? undefined,
        queryParams: { pw },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    } catch {
      /* navigation not available in this host context (e.g. a dev harness) */
    }
  }

  protected iconPath(group: PowerGroup): string {
    return ICON_PATHS[GROUP_ICON[group]] ?? ICON_PATHS['generic'];
  }

  protected fmt(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return formatNumber(v);
  }

  /** The cell's value with its unit — the SAME formatter the KPI band uses. */
  protected fmtCell(c: KpiStripCell): string {
    return c.value == null ? '—' : formatEquippedStat({ labelKey: c.labelKey, value: c.value, format: c.format });
  }

  protected roundPct(v: number): number {
    return Math.round(v);
  }

  /** Every other number of the strip counts up on appearance and rolls on change (cx-countup). */
  protected readonly counter = new CountUp(this.still);

  protected up(key: string, v: number | null | undefined): number | null {
    return v === null || v === undefined ? null : this.counter.value(key, v);
  }

  protected upInt(key: string, v: number | null | undefined): number | null {
    const n = this.up(key, v);
    return n === null ? null : Math.round(n);
  }

  /** One decimal in the page's number locale ("14,5" in German — never a
   * stray "14.5" beside every other comma-decimal on the page). */
  protected fmtKm(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    const km = Math.round(v / 100) / 10;
    const text = formatNumber(km);
    return Number.isInteger(km) ? `${text}${formatNumber(1.5).charAt(1)}0` : text;
  }

  protected fmtM(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return formatNumber(v);
  }

  protected minPct(pct: number | null): number {
    if (pct === null) return 0;
    return Math.min(100, Math.max(0, pct));
  }

  /** stroke-dasharray for the r=26 cooling ring. */
  protected coolDash(pct: number): string {
    const c = 2 * Math.PI * 26;
    const on = (this.minPct(pct) / 100) * c;
    return `${on.toFixed(1)} ${(c - on).toFixed(1)}`;
  }

  protected absDelta(c: KpiStripCell): number {
    return Math.abs(c.delta!.raw);
  }

  protected deltaTone(c: KpiStripCell): 'up' | 'down' | null {
    const delta = c.delta;
    if (!delta || delta.raw === 0) return null;
    return delta.good ? 'up' : 'down';
  }

  protected dismissTooltips(): void {
    this.tipsHidden.set(true);
  }

  protected reopenTooltips(): void {
    if (this.tipsHidden()) this.tipsHidden.set(false);
  }

  protected pipsEnabled(row: PowerGroupRow): boolean {
    return row.state !== 'absent' && row.state !== 'noChannel' && row.capacity > 0;
  }

  protected clickPip(row: PowerGroupRow, level: number): void {
    if (!this.pipsEnabled(row)) return;
    const next = clickPowerPip(this.cutGroups(), this.levels(), row, level);
    this.cutGroups.set(next.cutGroups);
    this.levels.set(next.levels);
    this.persistDraft();
  }

  protected stepPipFocus(event: Event, dir: 1 | -1): void {
    const stack = event.currentTarget as HTMLElement | null;
    if (!stack) return;
    const pips = Array.from(stack.querySelectorAll<HTMLButtonElement>('button.pip:not([disabled])'));
    const at = pips.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const to = pips[at + dir];
    if (!to) return;
    event.preventDefault();
    to.focus();
  }

  protected toggleGroup(key: PowerColumnKey): void {
    this.cutGroups.set(togglePowerGroup(this.cutGroups(), key));
    this.persistDraft();
  }

  protected setMode(mode: FlightMode): void {
    this.mode.set(mode);
    this.persistDraft();
  }

  /** A preset is a full re-deal — it clears every pin. `Schleichen` sets its
   * own cuts and pins (#352, `stealthPowerState`); leaving it for `Auto`
   * drops them again, any other cut stays. */
  protected setPreset(preset: PowerPreset): void {
    const from = this.preset();
    this.preset.set(preset);
    if (preset === 'stealth') {
      const next = stealthPowerState({
        occupants: this.occupants(),
        shipStats: this.shipStats(),
        schemaVersion: this.schemaVersion(),
        mode: this.mode(),
      });
      this.cutGroups.set(next.cutGroups);
      this.levels.set(next.levels);
    } else {
      if (from === 'stealth') this.cutGroups.set(new Set<PowerColumnKey>());
      this.levels.set({});
    }
    this.persistDraft();
  }

  protected reset(): void {
    const next = resetPowerState();
    this.cutGroups.set(next.cutGroups);
    this.levels.set(next.levels);
    this.mode.set(next.mode);
    this.preset.set(next.preset);
    this.persistDraft();
  }

  protected toggleExpanded(): void {
    if (!this.expanded()) this.openArea.set(null);
    this.expanded.set(!this.expanded());
  }

  // ── Phone sheet ──────────────────────────────────────────────────────
  /** The three visible heights of the PANEL in px (above the bar): half = 50 dvh in all, full = under the header. */
  private snapHeights(): SnapHeights {
    const bar = this.handleRef()?.nativeElement.parentElement?.getBoundingClientRect().height ?? 100;
    const css = getComputedStyle(document.documentElement);
    const head = parseFloat(css.getPropertyValue('--sc-header-h')) || 108;
    const lift = parseFloat(getComputedStyle(this.host.nativeElement.parentElement ?? document.body).getPropertyValue('--holo-strip-lift')) || 0;
    const vh = window.innerHeight;
    const full = Math.max(0, vh - head - lift - bar - 8);
    return { peek: 0, half: Math.min(full, Math.max(0, vh * 0.5 - lift - bar)), full };
  }

  private paint(visible: number): void {
    const bar = this.handleRef()?.nativeElement.parentElement;
    if (!bar) return;
    bar.style.setProperty('--_pfull', `${Math.round(this.snapHeights().full)}px`);
    bar.style.setProperty('--_v', `${Math.round(visible)}px`);
  }

  /** Move the sheet to a snap point (focus: handle on collapse, region heading on open). */
  protected setSnap(next: SheetSnap, focusHandle = false): void {
    const prev = this.snap();
    this.snap.set(next);
    if (next !== 'peek') this.openArea.set(null);
    this.expanded.set(next !== 'peek');
    this.paint(this.snapHeights()[next]);
    this.publishSheet();
    if (prev !== next) this.analytics.track('codex:stats_sheet_change', { snap: next });
    if (focusHandle) this.handleRef()?.nativeElement.focus({ preventScroll: true });
  }

  /** On a phone the sheet owns the bottom edge: the shell drops its bottom search bar (header magnifier instead) while this page shows. */
  private claimBottom(): void {
    claimRootAttr('data-sc-bar-off', this, document.documentElement.hasAttribute('data-sc-phone') ? '' : null);
  }

  /** `html[data-sc-sheet]` + `--sc-sheet-peek-h` are what the shell reads (dial hide, lane height). */
  private publishSheet(): void {
    const html = document.documentElement;
    const s = this.snap();
    if (s === 'peek') html.removeAttribute('data-sc-sheet'); else html.setAttribute('data-sc-sheet', s);
    const bar = this.handleRef()?.nativeElement.parentElement;
    html.style.setProperty('--sc-sheet-peek-h', `${Math.round(bar?.getBoundingClientRect().height ?? 0)}px`);
  }

  protected onHandleClick(): void {
    if (!this.phone) { this.toggleExpanded(); return; }
    if (this.suppressClick) { this.suppressClick = false; return; }
    this.setSnap(cycleSnap(this.snap()));
  }

  protected onHandleDown(ev: PointerEvent): void {
    if (!this.phone || ev.button > 0) return;
    this.drag = { startY: ev.clientY, startVisible: this.snapHeights()[this.snap()], moved: false, samples: [{ t: ev.timeStamp, y: ev.clientY }], id: ev.pointerId };
  }

  protected onHandleMove(ev: PointerEvent): void {
    const d = this.drag;
    if (!d || ev.pointerId !== d.id) return;
    if (!d.moved) {
      if (Math.abs(ev.clientY - d.startY) < 8) return;
      d.moved = true;
      this.dragging.set(true);
      try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch { /* the pointer ended already */ }
    }
    d.samples.push({ t: ev.timeStamp, y: ev.clientY });
    if (d.samples.length > 12) d.samples.shift();
    this.dragVisiblePx = dragVisible(d.startVisible, d.startY - ev.clientY, this.snapHeights());
    this.dragRaf ||= requestAnimationFrame(() => { this.dragRaf = 0; this.paint(this.dragVisiblePx); });
  }

  protected onHandleUp(ev: PointerEvent): void {
    const d = this.drag;
    if (!d || ev.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moved) return;
    cancelAnimationFrame(this.dragRaf);
    this.dragRaf = 0;
    this.dragging.set(false);
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
    this.setSnap(ev.type === 'pointercancel' ? this.snap() : settleSnap(this.dragVisiblePx, releaseVelocity(d.samples), this.snapHeights()));
  }
}
