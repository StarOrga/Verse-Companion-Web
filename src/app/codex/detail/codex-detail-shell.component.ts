// The one beta detail shell (concept batch-holotisch-kopf-vorlage, T1/T2): head band, stage slot, the
// right panel with its tab pill, an optional strip — switched by a per-kind profile (codex-detail-profile.ts).
// Every beta detail page renders through this shell. Item pages (weapon, component, FPS gear, iron,
// water …) fill head, stage, panel and strip; the ship profile (`stage: 'holo'`) projects the holotable
// as its stage across the full width — the holotable carries the same head band (sc-codex-detail-head)
// and its panel uses the same tab pill (sc-codex-detail-tabs), its strip stays its own.
import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, viewChildren } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

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

@Component({
  selector: 'sc-codex-detail-shell',
  standalone: true,
  imports: [TranslatePipe, CodexDetailTabsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-stage]': 'profile().stage' },
  template: `
    <ng-content select="sc-codex-detail-head" />
    <div class="sh-grid">
      <div class="sh-stage"><ng-content select="[shellStage]" /></div>
      @if (!holo()) {
        <aside class="sh-panel" [attr.aria-label]="'codex.detailShell.panelAria' | translate">
          <div class="sh-path"><ng-content select="[shellPath]" /></div>
          @if (showTabs()) {
            <sc-codex-detail-tabs class="sh-tabs" [tabs]="profile().tabs" [active]="activeTab()" (tabSelect)="tabChange.emit($event)" />
          }
          <div class="sh-pane" id="dt-pane" role="tabpanel" [attr.aria-labelledby]="showTabs() ? 'dt-tab-' + activeTab() : null"><ng-content /></div>
        </aside>
      }
    </div>
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
      .sh-panel { position: relative; display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 12px;
        border: 1px solid var(--sc-border); border-radius: 16px; background: color-mix(in srgb, var(--sc-bg-0) 73%, transparent); }
      .sh-path:empty { display: none; }
      .sh-pane { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
      /* Simple items (iron, a backpack, water): a small stage, a wider panel (r1-simple). */
      :host([data-stage='compact']) .sh-grid { grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1.3fr); }
      :host([data-stage='compact']) .sh-stage { height: auto; min-height: 0; aspect-ratio: 4 / 3; max-height: 420px; }
      :host([data-stage='compact']) .sh-grid { min-height: 0; }
      /* The ship: the holotable is the whole body (its own panel and strip inside), so the stage spans the frame. */
      :host([data-stage='holo']) .sh-grid { display: block; min-height: 0; }
      :host([data-stage='holo']) .sh-stage { position: static; height: auto; min-height: 0; }
      :host([data-stage='holo']) .sh-stage > ::ng-deep * { height: auto; }
      @media (max-width: 900px) {
        .sh-grid, :host([data-stage='compact']) .sh-grid { grid-template-columns: minmax(0, 1fr); min-height: 0; }
        .sh-stage { position: static; height: auto; min-height: 320px; }
        :host([data-stage='compact']) .sh-stage { min-height: 220px; aspect-ratio: auto; }
      }
    `,
  ],
})
export class CodexDetailShellComponent {
  readonly profile = input.required<DetailProfile>();
  readonly activeTab = input.required<DetailTabId>();
  readonly tabChange = output<DetailTabId>();
  /** The tab pill shows whenever the page has a tab: one panel chrome on every kind, even a simple item with only Werte (T2/T3). */
  protected readonly showTabs = computed(() => this.profile().tabs.length > 0);
  /** The ship profile: the projected holotable brings its own panel, so the shell's aside stays out. */
  protected readonly holo = computed(() => this.profile().stage === 'holo');
}
