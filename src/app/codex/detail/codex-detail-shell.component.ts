// The one beta detail shell (concept batch-holotisch-kopf-vorlage, T1/T2): head band, stage slot, the
// right panel with its tab pill, an optional strip — switched by a per-kind profile (codex-detail-profile.ts).
// Every beta detail page renders through this shell. Item pages (weapon, component, FPS gear, iron,
// water …) fill head, stage, panel and strip by projection. The ship profile (`stage: 'holo'`) fills the same
// slots from the holotable stage, which keeps all of its state: the stage holds the table (stage slot) and hands
// its other regions — head band, panel head/pane/foot, views row, below, KPI strip — to the shell as templates
// (CodexDetailSlots, provided here); the shell draws the ship's tab pill from the profile and lays out the grid.
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, viewChildren } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { FeedbackSpotDirective } from '../../feedback/feedback-spot.directive';
import { CodexDetailSlots } from './codex-detail-slots';

import type { DetailProfile, DetailTabId } from './codex-detail-profile';

/** One tab of the pill: its id, an optional count, and — where the id is not a shell tab — its own label key and icon. */
export interface DetailTabItem<T extends string = string> {
  readonly id: T;
  /** Shown beside the label when > 0. */
  readonly count: number;
  /** Defaults to `codex.detailShell.tab.<id>`. */
  readonly labelKey?: string;
  /** An SVG path (24 × 24 viewBox), drawn as a stroke before the label. */
  readonly icon?: string;
}

/**
 * The one tab pill of every detail panel — item pages through the shell, the ship holotable's
 * panel (Einordnung | Bauteile | Änderungen) directly: a real tablist (arrows, Home/End, roving
 * tabindex) with a glowing pill that slides under the active tab.
 */
@Component({
  selector: 'sc-codex-detail-tabs',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dt-tabs" role="tablist" [attr.aria-label]="ariaLabelKey() | translate" (keydown)="onKey($event)"
         [style.--n]="tabs().length" [style.--i]="activeIndex()">
      @if (activeIndex() >= 0) { <span class="dt-pill" aria-hidden="true"></span> }
      @for (t of tabs(); track t.id) {
        <button #tab type="button" role="tab" class="dt-tab" [class.on]="active() === t.id" [attr.aria-selected]="active() === t.id"
                [attr.id]="idPrefix() + t.id" [attr.aria-controls]="panelId()"
                [attr.tabindex]="active() === t.id ? 0 : -1" (click)="pick(t.id)">
          @if (t.icon) { <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="t.icon" /></svg> }
          <span class="dt-label">{{ (t.labelKey ?? 'codex.detailShell.tab.' + t.id) | translate }}</span>@if (t.count) { <small>{{ t.count }}</small> }
        </button>
      }
    </div>
  `,
  styles: [
    `
      /* The pill measures its own width, not the viewport: the holotable's panel is ~360 px at any window size. */
      :host { display: block; min-width: 0; max-width: 100%; container: dt-tabs / inline-size; }
      .dt-tabs { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; padding: 3px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 24%, transparent); border-radius: 999px;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-2) 85%, transparent), color-mix(in srgb, var(--sc-bg-0) 85%, transparent)); }
      /* The pill slides under the active tab (equal columns: width and step follow from the tab count). */
      .dt-pill { position: absolute; inset-block: 3px; inset-inline-start: 3px; border-radius: 999px; pointer-events: none;
        width: calc((100% - 6px - (var(--n, 1) - 1) * 2px) / var(--n, 1));
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 40%, transparent), color-mix(in srgb, var(--sc-accent) 16%, transparent));
        box-shadow: 0 0 14px color-mix(in srgb, var(--sc-accent) 38%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 55%, transparent);
        transform: translateX(calc(var(--i, 0) * (100% + 2px))); transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1); }
      .dt-tab { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: max(34px, var(--sc-tap-min, 0px));
        padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--sc-fg-1); cursor: pointer;
        font: 500 0.74rem var(--sc-font-display, inherit); letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap;
        transition: color 160ms ease; }
      .dt-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .dt-tab svg { width: 1.2em; height: 1.2em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .dt-tab small { font: 500 0.72rem var(--sc-font-body, inherit); letter-spacing: 0; color: var(--sc-accent); }
      @media (hover: hover) { .dt-tab:hover { color: var(--sc-fg-0); } }
      .dt-tab.on { color: var(--sc-fg-0); }
      .dt-tab.on small { color: var(--sc-fg-0); }
      .dt-tab:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
      @media (prefers-reduced-motion: reduce) { .dt-pill { transition: none; } }
      /* A narrow pill (the holotable panel, a phone): the icons step aside and the tracking tightens, so the
         three labels keep their full words side by side instead of running into each other (#batch holo). */
      @container dt-tabs (max-width: 460px) {
        .dt-tab { gap: 4px; padding: 0 4px; letter-spacing: 0.04em; }
        .dt-tab svg { display: none; }
      }
      @container dt-tabs (max-width: 340px) {
        .dt-tab { letter-spacing: 0.02em; font-size: 0.68rem; }
      }
      /* Narrow: the tabs scroll at their own width, so the pill gives way to a fill on the active tab. */
      @media (max-width: 640px) {
        .dt-tabs { grid-auto-columns: max-content; overflow-x: auto; scrollbar-width: none; }
        .dt-pill { display: none; }
        .dt-tab.on { background: color-mix(in srgb, var(--sc-accent) 22%, transparent); }
      }
    `,
  ],
})
export class CodexDetailTabsComponent<T extends string = DetailTabId> {
  readonly tabs = input<readonly DetailTabItem<T>[]>([]);
  readonly active = input.required<T>();
  /** Prefix of each tab's id (`<prefix><tab id>`), referenced by the panel's aria-labelledby. */
  readonly idPrefix = input('dt-tab-');
  /** The id of the tabpanel the tabs control. */
  readonly panelId = input('dt-pane');
  readonly ariaLabelKey = input('codex.detailShell.tabsAria');
  readonly tabSelect = output<T>();
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tab');
  protected readonly activeIndex = computed(() => this.tabs().findIndex((t) => t.id === this.active()));

  protected pick(id: T): void {
    if (id !== this.active()) this.tabSelect.emit(id);
  }

  protected onKey(ev: KeyboardEvent): void {
    const ids = this.tabs().map((t) => t.id);
    const at = ids.indexOf(this.active());
    let to = -1;
    if (ev.key === 'ArrowRight') to = (at + 1) % ids.length;
    else if (ev.key === 'ArrowLeft') to = (at - 1 + ids.length) % ids.length;
    else if (ev.key === 'Home') to = 0;
    else if (ev.key === 'End') to = ids.length - 1;
    if (to < 0 || ids.length === 0) return;
    ev.preventDefault();
    this.pick(ids[to]);
    this.buttons()[to]?.nativeElement.focus();
  }
}

/**
 * The one detail panel frame (concept batch-holotisch-kopf-vorlage): the glass sheet, an optional head
 * slot (`[panelHead]`), the shared tab pill, the tabpanel (default slot) and an optional foot
 * (`[panelFoot]`). Item pages get it through the shell's panel slot, the ship holotable places the same
 * component in its own grid beside the table, so frame, tab-pill position, padding and scroll are one
 * template. `fit`: the frame has a bounded height (the holotable's card) — the pane scrolls and fades at
 * its bottom edge; under 1000 px it grows with its content again.
 */
@Component({
  selector: 'sc-codex-detail-panel',
  standalone: true,
  imports: [CodexDetailTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'complementary', '[attr.data-fit]': "fit() ? '' : null" },
  template: `
    <div class="dp-head"><ng-content select="[panelHead]" /></div>
    @if (tabs().length > 0) {
      <sc-codex-detail-tabs class="dp-tabs" [tabs]="tabs()" [active]="active()" [idPrefix]="idPrefix()" [panelId]="panelId()"
        [ariaLabelKey]="ariaLabelKey()" (tabSelect)="tabSelect.emit($event)" />
    }
    <div class="dp-pane" [attr.id]="panelId()" role="tabpanel" tabindex="-1"
         [attr.aria-labelledby]="tabs().length > 0 ? idPrefix() + active() : null"><ng-content /></div>
    <ng-content select="[panelFoot]" />
  `,
  styles: [
    `
      :host { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 24%, transparent); border-radius: 16px;
        background: color-mix(in srgb, var(--sc-bg-0) 73%, transparent); }
      .dp-head { flex: none; margin: 12px 12px 0; }
      /* No head when nothing is projected into it (a slot wrapper may stand there empty). */
      .dp-head:not(:has(> :not(:empty))) { display: none; }
      .dp-tabs { flex: none; margin: 12px 12px 0; }
      .dp-pane { min-width: 0; padding: 12px 14px 14px; }
      .dp-pane:focus-visible { outline: none; }
      /* Bounded height: the pane scrolls; its bottom edge fades instead of cutting a line in half, and the
         extra bottom padding lets the last line scroll fully clear of the fade. */
      :host([data-fit]) { overflow: hidden; }
      :host([data-fit]) .dp-pane { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
        padding-bottom: 28px; scroll-padding-bottom: 28px; mask-image: linear-gradient(to bottom, #000 calc(100% - 26px), transparent); }
      @media (max-width: 1000px) {
        :host([data-fit]) { overflow: visible; }
        :host([data-fit]) .dp-pane { overflow: visible; }
      }
    `,
  ],
})
export class CodexDetailPanelComponent<T extends string = DetailTabId> {
  readonly tabs = input<readonly DetailTabItem<T>[]>([]);
  readonly active = input.required<T>();
  readonly idPrefix = input('dt-tab-');
  readonly panelId = input('dt-pane');
  readonly ariaLabelKey = input('codex.detailShell.tabsAria');
  readonly fit = input(false);
  readonly tabSelect = output<T>();
}

@Component({
  selector: 'sc-codex-detail-shell',
  standalone: true,
  imports: [TranslatePipe, NgTemplateOutlet, CodexDetailPanelComponent, FeedbackSpotDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CodexDetailSlots],
  host: { '[attr.data-stage]': 'profile().stage', '[attr.data-holo-root]': "holo() ? '' : null" },
  template: `
    <!-- The ship: the holotable stage hands its regions over (CodexDetailSlots); the shell places them here. -->
    @if (holoSlots(); as s) { <ng-container [ngTemplateOutlet]="s.head" /> }
    <ng-content select="sc-codex-detail-head" />
    <div class="sh-grid" [class.push]="holoState()?.push" [class.still]="holoState()?.still">
      <div class="sh-stage"><ng-content select="[shellStage]" /></div>
      @if (!holo()) {
        <sc-codex-detail-panel class="sh-panel" [attr.aria-label]="'codex.detailShell.panelAria' | translate" [tabs]="profile().tabs" [active]="activeTab()"
          (tabSelect)="tabChange.emit($event)">
          <div panelHead class="sh-path"><ng-content select="[shellPath]" /></div>
          <div class="sh-pane"><ng-content /></div>
        </sc-codex-detail-panel>
      } @else if (holoSlots(); as s) {
        <!-- The ship's panel: the profile's tabs, the stage's open tab, counts and pane. -->
        @let st = holoState();
        <sc-codex-detail-panel class="holo-panel mobile-data" [class.mobile-off]="st?.hideData" [class.docking]="st?.docking" [class.reveal]="st?.reveal"
          [class.dim]="st?.dim" [class.still]="st?.still" [scFeedbackSpot]="'codex.holo.stage.inspector'" [fit]="true"
          [tabs]="holoTabs()" [active]="holoSource()!.panelTab()" idPrefix="holo-tab-" panelId="holo-tabpanel"
          ariaLabelKey="codex.holo.stage.inspector" (tabSelect)="holoSource()!.selectPanelTab($event)">
          <div panelHead><ng-container [ngTemplateOutlet]="s.panelHead" /></div>
          <ng-container [ngTemplateOutlet]="s.panelBody" />
          <div panelFoot class="pfoot"><ng-container [ngTemplateOutlet]="s.panelFoot" /></div>
        </sc-codex-detail-panel>
        <!-- The stage slot's foot: the views row under table and panel (after the panel: the tab order stays table, panel, views). -->
        <ng-container [ngTemplateOutlet]="s.views" />
      }
    </div>
    @if (holoSlots(); as s) {
      <ng-container [ngTemplateOutlet]="s.below" />
      @if (profile().strip) { <ng-container [ngTemplateOutlet]="s.strip" /> }
    }
    @if (profile().strip) { <ng-content select="[shellStrip]" /> }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
      .sh-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 470px); gap: 12px; align-items: start; min-height: 440px; }
      /* The stage stays in view beside the panel, under the slim head band. */
      .sh-stage { position: sticky; top: calc(var(--sc-imp-banner-h, 0px) + var(--sc-topbar-h, 0px) + 68px);
        height: calc(100dvh - var(--sc-topbar-h, 64px) - 160px); min-height: 440px; min-width: 0; }
      .sh-stage > ::ng-deep * { height: 100%; }
      .sh-pane { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
      /* Simple items (iron, a backpack, water): a small stage, a wider panel (r1-simple). */
      :host([data-stage='compact']) .sh-grid { grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1.3fr); }
      :host([data-stage='compact']) .sh-stage { height: auto; min-height: 0; aspect-ratio: 4 / 3; max-height: 420px; }
      :host([data-stage='compact']) .sh-grid { min-height: 0; }
      @media (max-width: 900px) {
        .sh-grid, :host([data-stage='compact']) .sh-grid { grid-template-columns: minmax(0, 1fr); min-height: 0; }
        .sh-stage { position: static; height: auto; min-height: 320px; }
        :host([data-stage='compact']) .sh-stage { min-height: 220px; aspect-ratio: auto; }
      }

      /* ── The ship (stage 'holo'). One column of head band, body, below and strip, 6 px apart. The body is the
         first screen: the table (stage slot) | the panel, as high as the card (540 px at most), and the views row
         over both, docked on the strip; its height is what the screen has left between where the body starts
         (--holo-top) and the strip (--holo-strip-h) — both measured by the stage and set on this host. ── */
      :host([data-stage='holo']) { gap: 6px; }
      :host([data-stage='holo']) .sh-grid { display: grid; grid-template-columns: minmax(0, 1fr) clamp(320px, 22.2vw, 360px); grid-template-rows: minmax(0, 1fr) auto;
        column-gap: 16px; row-gap: 8px; align-items: stretch; height: calc(100dvh - var(--holo-top, 170px) - var(--holo-strip-h, 82px) - 8px); min-height: 460px; }
      /* The stage slot has no box: the table it holds is the grid's first cell. */
      :host([data-stage='holo']) .sh-stage { display: contents; }
      .holo-panel { z-index: 1; align-self: start; height: min(100%, 540px); }
      .pfoot { flex: none; display: flex; flex-direction: column; }
      /* Arrival (the stage's phases): the body pushes in, the panel docks with an overshoot and a light edge, the pane
         rises; while the next ship loads the pane dims. */
      .sh-grid.push { transform-origin: 40% 50%; animation: sh-push 700ms cubic-bezier(0.16, 0.84, 0.24, 1) backwards; }
      @keyframes sh-push { from { transform: scale(0.965); } }
      .holo-panel ::ng-deep .dp-pane { animation: sh-rise var(--rise-dur, 300ms) var(--holo-e-out) var(--rise-delay, 60ms) backwards;
        transition: opacity var(--holo-t-fast) var(--holo-e-io); }
      @keyframes sh-rise { from { opacity: 0; transform: translateY(var(--holo-rise)); } }
      .holo-panel.reveal ::ng-deep .dp-pane { --rise-dur: 560ms; --rise-delay: 260ms; }
      .holo-panel.dim ::ng-deep .dp-pane { opacity: 0.35; }
      .holo-panel.docking { animation: sh-dock 900ms cubic-bezier(0.16, 0.84, 0.24, 1) 560ms backwards; }
      @keyframes sh-dock {
        0% { opacity: 0; transform: translateX(46px); filter: brightness(1.7); }
        52% { opacity: 1; transform: translateX(-6px); filter: brightness(1.4); }
        76% { transform: translateX(1.5px); }
        100% { transform: none; filter: none; }
      }
      .holo-panel.docking::after { content: ''; position: absolute; z-index: 2; inset-block: 8% 8%; inset-inline-start: 0; width: 2px; pointer-events: none;
        background: linear-gradient(to bottom, transparent, var(--sc-accent), transparent); box-shadow: 0 0 12px var(--sc-accent); animation: sh-edge 1100ms ease-out 560ms both; }
      @keyframes sh-edge { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
      :is(.sh-grid, .holo-panel).still, .holo-panel.still::after { animation: none !important; transition: none !important; }
      @media (prefers-reduced-motion: reduce) {
        .sh-grid, .holo-panel, .holo-panel::after { animation: none !important; transition: none !important; }
      }
      /* Tablet and phone: the panel goes under the model, its full width, and grows with its content. */
      @media (max-width: 1000px) {
        :host([data-stage='holo']) .sh-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; height: auto; min-height: 0; }
        .holo-panel { height: auto; align-self: stretch; }
      }
      @media (max-width: 640px) {
        :host([data-stage='holo']) { padding-bottom: calc(72px + var(--holo-strip-lift, 0px)); }
        /* Beta shell: the search capsule floats at the bottom edge, the strip rides above it. */
        :host-context([data-layout]) { --holo-strip-lift: calc(var(--sc-float-bottom) + var(--sc-bar-h)); }
        :host([data-stage='holo']) .sh-grid { gap: 10px; }
        .mobile-off { display: none; }
      }
    `,
  ],
})
export class CodexDetailShellComponent {
  readonly profile = input.required<DetailProfile>();
  readonly activeTab = input.required<DetailTabId>();
  readonly tabChange = output<DetailTabId>();
  /** The ship profile: the holotable stage fills the slots through the registry instead of projecting. */
  protected readonly holo = computed(() => this.profile().stage === 'holo');
  private readonly slots = inject(CodexDetailSlots);
  protected readonly holoSource = computed(() => (this.holo() ? this.slots.source() : null));
  protected readonly holoSlots = computed(() => this.holoSource()?.slotTemplates() ?? null);
  protected readonly holoState = computed(() => this.holoSource()?.slotState() ?? null);
  /** The profile's ship tabs with the stage's counts. */
  protected readonly holoTabs = computed<DetailTabItem<string>[]>(() => {
    const counts = this.holoSource()?.panelTabCounts() ?? {};
    return (this.profile().shipTabs ?? []).map((t) => ({ ...t, count: counts[t.id] ?? 0 }));
  });
}
