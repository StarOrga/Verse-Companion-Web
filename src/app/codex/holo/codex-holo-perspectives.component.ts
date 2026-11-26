import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { Perspective } from '../codex-build-compare';
import type { MissionId } from '../codex-mission';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { AreaSymbolComponent } from '../../shared/area-symbol/area-symbol.component';
import { AnalyticsService } from '../../core/analytics.service';
import type { HoloColumnRow, HoloColumnView } from './codex-holo-columns';

/** A patch-Δ ghost beside a number: the other build's value and its tone (the immersive HUD). */
export interface HoloGhost {
  patch: string;
  text: string;
  tone: 'up' | 'down' | null;
}

/** One perspective as the immersive HUD reads it (headline per area). */
export interface HoloPerspectiveView {
  id: Perspective;
  titleKey: string;
  pct: number | null;
  leadText: string | null;
  leadFinalText?: string | null;
  leadLabelKey: string | null;
  leadShortKey: string | null;
  deltaText: string | null;
  deltaTone: 'up' | 'down' | null;
  ghost: HoloGhost | null;
  say: string;
  subs: readonly { key: string; shortKey: string; text: string; ghost: HoloGhost | null }[];
}

/**
 * The four columns under the Holotable (concept 2026-11-23 "Schiffskategorien
 * nach Einsatz": round 2 d2 "Werteliste nach Einsatz", round 3 d1 "Balken ab
 * Basislinie"). Each column is a value list whose rows and order follow the
 * active Einsatz; every row compares against the factory loadout with a bar
 * from a centre mark, the saved configuration as a tick on the same bar.
 * "Alle Werte" continues the same list inside the column, grouped by topic,
 * with one counter for the values the game data lacks. No rank anywhere —
 * that is the side panel's "Einordnung". Purely presentational.
 *
 * `layout="row"` (concept holotisch-unten r1, d2): one row on the strip's own
 * columns, the four areas edge on edge over the strip's four areas, the
 * "Alle Werte aller vier" switch on a slim right-aligned line above them. On
 * a phone the four areas swipe sideways, one at a time.
 */
@Component({
  selector: 'sc-codex-holo-perspectives',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, AreaSymbolComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.row]': "layout() === 'row'", '[class.docked]': 'docked()' },
  template: `
    <div class="all-line">
      <button type="button" class="all-expand" (click)="toggleAll()" [attr.aria-expanded]="allOpen()">
        {{ (allOpen() ? 'codex.holo.persp.allHide' : 'codex.holo.persp.allShow') | translate }}
      </button>
    </div>
    @for (col of columns(); track col.id) {
      <article class="ptile" [attr.data-p]="col.id" [class.pulse]="pulse() === col.id" [class.focus]="col.focus" [class.quiet]="col.quiet">
        <div class="pt-head">
          <span class="t"><sc-area-symbol class="area-sym" [area]="col.id" />{{ col.titleKey | translate }}</span>
          @if (col.focus) { <span class="sc-sr-only">{{ 'codex.holo.col.focusSr' | translate }}</span> }
          @if (col.quiet) { <span class="sc-sr-only">{{ 'codex.holo.col.quietSr' | translate }}</span> }
        </div>
        <ol class="vlist">
          @for (row of col.rows; track row.key; let first = $first) {
            <ng-container *ngTemplateOutlet="rowTpl; context: { $implicit: row, first: first, col: col.id }" />
          }
          @if (isOpen(col.id)) {
            @for (g of col.groups; track g.topic) {
              <li class="grp" aria-hidden="true">{{ 'codex.holo.col.topic.' + g.topic | translate }}</li>
              @for (row of g.rows; track row.key) {
                <ng-container *ngTemplateOutlet="rowTpl; context: { $implicit: row, first: false, col: col.id }" />
              }
            }
          }
        </ol>
        @if (col.rows.length === 0 && !isOpen(col.id)) {
          <p class="empty">{{ 'codex.holo.col.empty' | translate }}</p>
        }
        @if (isOpen(col.id) && col.gaps.length > 0) {
          <button type="button" class="gaps" (click)="toggleGaps(col.id)" [attr.aria-expanded]="gapsOpen(col.id)">
            {{ (col.gaps.length === 1 ? 'codex.holo.col.gapsOne' : 'codex.holo.col.gapsMany') | translate: { n: col.gaps.length } }}
            <span aria-hidden="true">{{ gapsOpen(col.id) ? '▴' : '▾' }}</span>
          </button>
          @if (gapsOpen(col.id)) {
            <ul class="gap-list">
              @for (g of col.gaps; track g.labelKey) {
                <li><span class="gk">{{ g.labelKey | translate }}</span><span class="gr">{{ g.reasonKey | translate }}</span></li>
              }
            </ul>
          }
        }
        <button type="button" class="tile-expand" (click)="toggleOpen(col.id)" [attr.aria-expanded]="isOpen(col.id)">
          {{ (isOpen(col.id) ? 'codex.holo.stage.allValuesHide' : 'codex.holo.stage.allValues') | translate }}
        </button>
      </article>
    }

    <ng-template #rowTpl let-row let-first="first" let-col="col">
      <li class="vr" [class.first]="first" [class.ch]="!!row.cmp?.tone" [attr.data-key]="row.key">
        <span class="k">
          @if (row.ports?.length) {
            <button type="button" class="pk" (click)="togglePorts(col + ':' + row.key)" [attr.aria-expanded]="portsOpen(col + ':' + row.key)">
              {{ labelOf(row) }} <span aria-hidden="true">{{ portsOpen(col + ':' + row.key) ? '▴' : '▾' }}</span>
            </button>
          } @else {
            {{ row.label ?? (row.labelKey! | translate) }}
          }
          @if (row.was) { <small class="was">{{ row.was }}</small> }
        </span>
        <span class="v">{{ row.value }}</span>
        @if (row.cmp; as c) {
          <!-- ds-new: diverging bar around a centre mark (Werk), saved value as a tick — StarUI has no comparison bar yet -->
          <span class="dv" aria-hidden="true">
            @if (c.tone) { <i [class.up]="c.tone === 'up'" [class.down]="c.tone === 'down'" [style.width.%]="c.fill"></i> }
          </span>
          @if (c.savedAt !== null) {
            <span class="tick" tabindex="0" role="img" [style.--at]="c.savedAt + '%'" [attr.aria-label]="row.savedText"
                  [scTooltip]="row.savedText" scTooltipTier="label"></span>
          }
          <span class="dd" [class.good]="c.tone === 'up'" [class.bad]="c.tone === 'down'">{{ row.deltaText }}</span>
          @if (c.tone) {
            <span class="sc-sr-only">{{ (c.tone === 'up' ? 'codex.holo.col.betterSr' : 'codex.holo.col.worseSr') | translate }}</span>
          }
        } @else {
          <span class="dv none" aria-hidden="true"></span><span class="dd"></span>
        }
      </li>
      @if (row.ports?.length && portsOpen(col + ':' + row.key)) {
        @for (p of row.ports; track $index) {
          <li class="vr port"><span class="k">{{ p.label }}</span><span class="v">{{ p.value }}</span><span class="dv none"></span><span class="dd"></span></li>
        }
      }
    </ng-template>
  `,
  styles: [`
    :host { display: grid; gap: 10px; align-content: start; min-width: 0;
      --f: var(--sc-fs-floor); --d: var(--sc-font-display); --m: var(--font-monospace, 'Share Tech Mono', monospace);
      --l1: var(--sc-border); --l2: var(--border-default, color-mix(in srgb, var(--sc-accent) 30%, transparent));
      --p-offensive: var(--holo-p-offensive); --p-defensive: var(--holo-p-defensive); --p-movement: var(--holo-p-movement); --p-signature: var(--holo-p-signature); }
    .pt-head, .tile-expand, .all-expand, .grp { font-family: var(--d); text-transform: uppercase; }
    .ptile { position: relative; display: grid; gap: 8px; align-content: start; padding: 12px 16px; border: 1px solid var(--l2); border-radius: var(--holo-r); overflow: hidden;
      background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-1) 70%, transparent), color-mix(in srgb, var(--sc-bg-0) 60%, transparent));
      transition: border-color var(--holo-t-fast) ease; }
    .ptile:hover { border-color: color-mix(in srgb, var(--p) 55%, var(--l2)); }
    .ptile[data-p="offensive"] { --p: var(--p-offensive); }
    .ptile[data-p="defensive"] { --p: var(--p-defensive); }
    .ptile[data-p="movement"] { --p: var(--p-movement); }
    .ptile[data-p="signature"] { --p: var(--p-signature); }
    /* The pulse after a port selection: an inner ring that swells and fades — transform + opacity only. */
    .ptile::after { content: ''; position: absolute; inset: 0; border: 1px solid var(--p); border-radius: inherit; pointer-events: none; opacity: 0;
      box-shadow: inset 0 0 18px color-mix(in srgb, var(--p) 35%, transparent); }
    .ptile.pulse::after { animation: holo-pulse 900ms var(--holo-e-out); }
    @keyframes holo-pulse { 0% { opacity: 1; transform: scale(0.985); } 100% { opacity: 0; transform: scale(1); } }
    .pt-head { display: flex; align-items: center; gap: 8px; font-size: max(13px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-0); }
    .pt-head .t { display: inline-flex; align-items: center; gap: 8px; }
    .pt-head .area-sym { color: var(--p); font-size: max(13px, var(--f)); }
    /* ★ in the Leitwert table: the column the Einsatz leads with carries the Einsatz hue in its title. */
    .ptile.focus .pt-head { color: var(--holo-e, var(--sc-fg-0)); }
    /* "leise": the column steps back for this Einsatz, still readable. */
    .ptile.quiet .vlist, .ptile.quiet .pt-head { opacity: 0.6; }

    .vlist { list-style: none; margin: 0; padding: 0; display: grid; }
    /* The label keeps its words whole (never broken mid-word); a long value wraps at its own spaces instead. */
    .vr { display: grid; grid-template-columns: minmax(min-content, 1fr) minmax(0, max-content) 32px 52px; align-items: center; column-gap: 4px; padding: 4px 0; position: relative;
      font-size: max(13px, var(--f)); border-bottom: 1px solid color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .vr .k { color: var(--sc-fg-1); overflow-wrap: normal; word-break: normal; hyphens: manual; }
    .vr .was { display: block; font-size: max(13px, var(--f)); color: var(--sc-fg-2); }
    .vr .v { font-family: var(--m); font-size: 15px; color: var(--sc-fg-0); text-align: end; font-variant-numeric: tabular-nums; padding-inline-end: 4px; }
    .vr.first { padding: 4px 0 8px; }
    .vr.first .k { color: var(--sc-fg-0); }
    .vr.first .v { font-size: 18px; }
    .vr.port .k { padding-inline-start: 12px; color: var(--sc-fg-2); }
    .vr.port .v { font-size: max(13px, var(--f)); color: var(--sc-fg-1); }
    .pk { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: start; }
    .pk:hover, .pk[aria-expanded="true"] { color: var(--sc-accent); }
    .pk:focus-visible, .gaps:focus-visible, .tick:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); border-radius: var(--holo-r-xs); }

    /* ds-new: diverging bar (concept r3 d1) — the centre mark is Werk, the fill grows right when better
       (success) and left when worse (warning, never danger: a comparison is not an error). */
    .dv { position: relative; display: block; height: 6px; border-radius: 2px; grid-column: 3; }
    .dv::before { content: ''; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: color-mix(in srgb, var(--sc-fg-2) 55%, transparent); }
    .dv.none::before { content: none; }
    .vr.ch .dv, .vr:has(.tick) .dv { background: color-mix(in srgb, var(--sc-fg-2) 16%, transparent); }
    .dv i { position: absolute; top: 0; bottom: 0; border-radius: 2px; }
    .dv i.up { left: 50%; background: var(--sc-success); }
    .dv i.down { right: 50%; background: var(--sc-warning); }
    /* The saved configuration, quiet on the same bar (a2: "in den balken markiert ggü. werk"). */
    /* ds-new: saved-value tick on the comparison bar */
    .tick { grid-column: 3; grid-row: 1; justify-self: start; position: relative; inset-inline-start: calc(var(--at) - 1px); width: 2px; height: 14px; border-radius: 2px;
      background: var(--sc-fg-0); opacity: 0.7; cursor: default; }
    .tick::after { content: ''; position: absolute; inset: -6px -8px; }
    .dd { grid-column: 4; font-family: var(--m); font-size: max(13px, var(--f)); text-align: right; white-space: nowrap; color: var(--sc-fg-2); }
    .dd.good { color: var(--sc-success); }
    .dd.bad { color: var(--sc-warning); }

    .grp { padding: 12px 0 4px; font-size: max(13px, var(--f)); letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .empty { margin: 0; font-size: max(13px, var(--f)); color: var(--sc-fg-2); }
    .gaps { justify-self: stretch; text-align: start; background: none; border: 0; border-top: 1px dashed var(--l2); padding: 4px 0 0; min-height: var(--sc-tap-min, 24px);
      font: inherit; font-size: max(13px, var(--f)); color: var(--sc-fg-2); cursor: pointer; }
    .gaps:hover, .gaps[aria-expanded="true"] { color: var(--sc-fg-1); }
    .gap-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: max(13px, var(--f)); }
    .gap-list li { display: grid; gap: 0; }
    .gap-list .gk { color: var(--sc-fg-1); }
    .gap-list .gr { color: var(--sc-fg-2); }

    .tile-expand { justify-self: start; background: none; border: none; padding: 0; cursor: pointer; font-size: max(13px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2); min-height: var(--sc-tap-min, 24px);
      transition: color var(--holo-t-fast) ease; }
    .tile-expand:hover, .tile-expand[aria-expanded="true"] { color: var(--sc-accent); }
    .tile-expand:focus-visible, .all-expand:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); border-radius: var(--holo-r-xs); }

    .all-line { grid-column: 1 / -1; display: flex; justify-content: flex-end; padding: 4px 16px 0; }
    .all-expand { background: none; border: none; padding: 0; cursor: pointer; font-size: max(13px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2);
      min-height: var(--sc-tap-min, 24px); transition: color var(--holo-t-fast) ease; }
    .all-expand:hover, .all-expand[aria-expanded="true"] { color: var(--sc-accent); }

    /* ── Row on the strip's columns (layout="row") ── */
    :host(.row) { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; align-items: stretch;
      border: 1px solid color-mix(in srgb, var(--holo-e, var(--sc-accent)) 28%, transparent); border-radius: 16px; /* ds-ok: the holo row frame keeps the strip's own radius */
      background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 7%, var(--sc-bg-0)), color-mix(in srgb, var(--sc-accent) 3%, var(--sc-bg-0))); overflow: hidden; }
    /* Docked onto the strip below: one piece with it. */
    :host(.row.docked) { border-block-end: 0; border-radius: 16px 16px 0 0; /* ds-ok: as above */ }
    /* Inside the strip's dock: the dock is the frame. */
    :host(.row.in-dock) { border: 0; border-radius: 0; background: none; overflow: visible; }
    /* The row is the frame: tiles only draw the rule between each other. */
    :host(.row) .ptile { border: 0; border-radius: 0; background: none; box-shadow: inset 0 2px 0 var(--p); }
    :host(.row) .ptile + .ptile { border-inline-start: 1px solid var(--sc-border); }
    @media (max-width: 1000px) {
      :host(.row) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      :host(.row) .ptile:nth-of-type(odd) { border-inline-start: 0; }
    }
    /* Phone (concept r1-dock-phone "swipe"): the four areas side by side, one large at a time, swiped with a snap. */
    @media (max-width: 640px) {
      :host(.row) { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 86%; overflow-x: auto; overscroll-behavior-x: contain;
        scroll-snap-type: x mandatory; scrollbar-width: none; }
      :host(.row)::-webkit-scrollbar { display: none; }
      :host(.row) .all-line { display: none; }
      :host(.row) .ptile { scroll-snap-align: start; border-inline-end: 0; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  `],
})
export class CodexHoloPerspectivesComponent {
  private readonly analytics = inject(AnalyticsService);

  readonly columns = input.required<readonly HoloColumnView[]>();
  /** The active Einsatz — only the analytics event reads it. */
  readonly missionId = input<MissionId>('all');
  /** The column that pulses after a port selection (concept pe4-pulse). */
  readonly pulse = input<Perspective | null>(null);
  /** `stack`: columns under each other; `row`: one row on the strip's columns. */
  readonly layout = input<'stack' | 'row'>('stack');
  /** The row sits right on the strip (no bottom edge of its own). */
  readonly docked = input(false);

  private readonly openCols = signal<ReadonlySet<Perspective>>(new Set());
  private readonly openGaps = signal<ReadonlySet<Perspective>>(new Set());
  private readonly openPorts = signal<ReadonlySet<string>>(new Set());

  /** Every column is open ("Alle Werte aller vier"). */
  readonly allOpen = computed(() => {
    const open = this.openCols();
    const cols = this.columns();
    return cols.length > 0 && cols.every((c) => open.has(c.id));
  });

  toggleAll(): void {
    const opening = !this.allOpen();
    this.openCols.set(opening ? new Set(this.columns().map((c) => c.id)) : new Set());
    if (opening) this.analytics.track('codex:perspective_detail_open', { perspective: 'all', mission: this.missionId() });
  }

  isOpen(id: Perspective): boolean {
    return this.openCols().has(id);
  }

  toggleOpen(id: Perspective): void {
    const next = new Set(this.openCols());
    const opening = !next.has(id);
    if (opening) next.add(id);
    else next.delete(id);
    this.openCols.set(next);
    if (opening) this.analytics.track('codex:perspective_detail_open', { perspective: id, mission: this.missionId() });
  }

  gapsOpen(id: Perspective): boolean {
    return this.openGaps().has(id);
  }

  toggleGaps(id: Perspective): void {
    this.openGaps.update((s) => toggled(s, id));
  }

  portsOpen(key: string): boolean {
    return this.openPorts().has(key);
  }

  togglePorts(key: string): void {
    this.openPorts.update((s) => toggled(s, key));
  }

  protected labelOf(row: HoloColumnRow): string {
    return row.label ?? row.labelKey ?? '';
  }
}

function toggled<T>(set: ReadonlySet<T>, v: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}
