// The one beta detail shell (concept batch-holotisch-kopf-vorlage, T1/T2): head band, stage slot, the
// right panel with its tab pill, an optional strip — switched by a per-kind profile (codex-detail-profile.ts).
// The ship holotable renders the same head band (sc-codex-detail-head) and keeps its own body; every
// non-ship beta page (weapon, component, FPS gear, iron, water …) renders through this shell.
import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, viewChildren } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { DetailProfile, DetailTab, DetailTabId } from './codex-detail-profile';

/** The tab pill of the detail panel: a real tablist (arrows, Home/End, roving tabindex). */
@Component({
  selector: 'sc-codex-detail-tabs',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dt-tabs" role="tablist" [attr.aria-label]="'codex.detailShell.tabsAria' | translate" (keydown)="onKey($event)">
      @for (t of tabs(); track t.id) {
        <button #tab type="button" role="tab" class="dt-tab" [class.on]="active() === t.id" [attr.aria-selected]="active() === t.id"
                [attr.id]="'dt-tab-' + t.id" [attr.aria-controls]="'dt-pane'"
                [attr.tabindex]="active() === t.id ? 0 : -1" (click)="pick(t.id)">
          {{ ('codex.detailShell.tab.' + t.id) | translate }}@if (t.count) { <small>{{ t.count }}</small> }
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .dt-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; padding: 3px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 24%, transparent); border-radius: 999px; }
      .dt-tab { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: max(34px, var(--sc-tap-min, 0px));
        padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--sc-fg-1); cursor: pointer;
        font: 500 0.74rem var(--sc-font-display, inherit); letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap;
        transition: color 160ms ease, background 160ms ease; }
      .dt-tab small { font: 500 0.72rem var(--sc-font-body, inherit); color: var(--sc-fg-2); }
      @media (hover: hover) { .dt-tab:hover { color: var(--sc-fg-0); } }
      .dt-tab.on { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .dt-tab:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring-inset); }
      @media (max-width: 640px) {
        .dt-tabs { grid-auto-columns: max-content; overflow-x: auto; scrollbar-width: none; }
      }
    `,
  ],
})
export class CodexDetailTabsComponent {
  readonly tabs = input<readonly DetailTab[]>([]);
  readonly active = input.required<DetailTabId>();
  readonly select = output<DetailTabId>();
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tab');

  protected pick(id: DetailTabId): void {
    if (id !== this.active()) this.select.emit(id);
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
      <aside class="sh-panel" [attr.aria-label]="'codex.detailShell.panelAria' | translate">
        <div class="sh-path"><ng-content select="[shellPath]" /></div>
        @if (showTabs()) {
          <sc-codex-detail-tabs class="sh-tabs" [tabs]="profile().tabs" [active]="activeTab()" (select)="tabChange.emit($event)" />
        }
        <div class="sh-pane" id="dt-pane" role="tabpanel" [attr.aria-labelledby]="showTabs() ? 'dt-tab-' + activeTab() : null"><ng-content /></div>
      </aside>
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
}
