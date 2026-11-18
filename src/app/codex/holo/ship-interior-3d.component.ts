import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import type { ShipDeck, ShipInterior, ShipInteriorGroup } from '../codex.types';
import type { HoloSilhouette } from '../holo-silhouette';
import { GLYPH_PATHS, InteriorPick } from './holo-interior';
import { buildScene3d } from './holo-interior-3d';

const YAW0 = 35;
const PITCH0 = 32;

/**
 * "3D mit Hülle" (concept 20261117-1810 r2d1, „sehr gut so machen!"): the
 * interior inside a ghost of the hull, the picked deck solid, the others
 * faint. Drag turns it, the wheel zooms; arrow keys and +/− do the same from
 * the keyboard, the two zoom buttons on touch. A click on a faint deck focuses
 * it, a click on an element picks it. Loaded through `@defer` with the 3D view.
 */
@Component({
  selector: 'sc-ship-interior-3d',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (scene(); as s) {
      <div class="i3" tabindex="0" role="img" [class.dragging]="dragging()"
           [attr.aria-label]="(focusLabel() ? 'codex.holo.interior.view3dAria' : 'codex.holo.interior.view3dAllAria') | translate: { deck: focusLabel() }"
           [attr.aria-keyshortcuts]="'ArrowLeft ArrowRight ArrowUp ArrowDown + -'"
           (keydown)="onKey($event)">
        <svg class="h3" [attr.viewBox]="s.viewBox" preserveAspectRatio="xMidYMid meet"
             (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointercancel)="onUp($event)">
          <g class="h3-hull" aria-hidden="true">
            @for (d of s.rings; track $index) { <path class="h3-ring" [class.mid]="$index === 1" [attr.d]="d" /> }
            @for (d of s.ribs; track $index) { <path class="h3-rib" [attr.d]="d" /> }
          </g>
          @for (d of s.decks; track d.key) {
            <g class="h3-deck" [class.on]="d.state === 'on'" [class.ghost]="d.state === 'ghost'" [class.all]="d.state === 'all'"
               [attr.data-deck]="d.key" (click)="onDeckClick(d.key, d.state)">
              <path class="h3-floor" [attr.d]="d.floor" />
              @if (d.top) { <path class="h3-top" [attr.d]="d.top" /> }
            </g>
          }
          @for (g of s.grids; track g.index) {
            <g class="h3-grid" [class.off]="!g.on" (click)="pickEl({ kind: 'grid', index: g.index })">
              <path class="h3-gb" [attr.d]="g.bottom" />
              @for (d of g.sides; track $index) { <path class="h3-gs" [attr.d]="d" /> }
              <path class="h3-gt" [attr.d]="g.top" />
              @if (g.on) {
                <text class="h3-gl" [attr.x]="g.at[0]" [attr.y]="g.at[1] - s.r * 0.6" [attr.font-size]="s.r * 1.5">{{ g.scu }}</text>
              }
            </g>
          }
          <g class="h3-links" aria-hidden="true">
            @for (l of s.lifts; track $index) {
              <path class="h3-lift" [attr.d]="l.line" />
              @for (p of l.stops; track $index) { <circle class="h3-stop" [attr.cx]="p[0]" [attr.cy]="p[1]" [attr.r]="s.r * 0.35" /> }
            }
            @for (d of s.ladders; track $index) { <path class="h3-ladder" [attr.d]="d" /> }
          </g>
          <g class="h3-pois">
            @for (i of s.icons; track i.index) {
              @if (i.door) {
                <circle class="h3-door" [attr.cx]="i.at[0]" [attr.cy]="i.at[1]" [attr.r]="s.r * 0.32" (click)="pickEl({ kind: 'poi', index: i.index })" />
              } @else {
                <g class="h3-ic" [attr.data-g]="i.group" [attr.transform]="'translate(' + (i.at[0] - s.r) + ' ' + (i.at[1] - s.r) + ') scale(' + (s.r / 12) + ')'"
                   (click)="pickEl({ kind: 'poi', index: i.index })">
                  <circle cx="12" cy="12" r="10.5" class="ic-bg" />
                  <path [attr.d]="glyph[i.glyph].d" [class.fill]="glyph[i.glyph].fill" />
                </g>
              }
            }
          </g>
          @if (s.picked; as p) {
            <circle class="h3-pick" [attr.cx]="p[0]" [attr.cy]="p[1]" [attr.r]="s.r * 1.6" />
          }
          @if (s.label; as l) {
            <text class="h3-lbl" [attr.x]="l.at[0]" [attr.y]="l.at[1]" [attr.font-size]="l.size" text-anchor="middle">{{ focusLabel() }}</text>
          }
        </svg>
        <div class="i3-ctl">
          <span class="i3-hint">{{ 'codex.holo.interior.view3dHint' | translate }}</span>
          <button type="button" scAction tier="tertiary" (click)="zoomBy(1.25)"
                  [attr.aria-label]="'codex.holo.interior.zoomIn' | translate" [scTooltip]="'codex.holo.interior.zoomIn' | translate">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
          </button>
          <button type="button" scAction tier="tertiary" (click)="zoomBy(0.8)"
                  [attr.aria-label]="'codex.holo.interior.zoomOut' | translate" [scTooltip]="'codex.holo.interior.zoomOut' | translate">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
          </button>
          <button type="button" scAction tier="tertiary" (click)="resetView()"
                  [attr.aria-label]="'codex.holo.interior.viewReset' | translate" [scTooltip]="'codex.holo.interior.viewReset' | translate">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2-5M5 4v4h4" /></svg>
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; }
    .i3 { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; border-radius: 8px; outline: none; }
    .i3:focus-visible { box-shadow: var(--sc-focus-ring); }
    .h3 { flex: 1; min-height: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; user-select: none; }
    .dragging .h3 { cursor: grabbing; }
    .h3-ring { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 24%, transparent); stroke-width: 1px; vector-effect: non-scaling-stroke; }
    .h3-ring.mid { fill: color-mix(in srgb, var(--sc-accent) 4%, transparent); stroke: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .h3-rib { stroke: color-mix(in srgb, var(--sc-accent) 13%, transparent); stroke-width: 1px; vector-effect: non-scaling-stroke; }
    .h3-floor { fill: color-mix(in srgb, var(--sc-accent) 3%, transparent); stroke: color-mix(in srgb, var(--sc-accent) 16%, transparent);
      stroke-width: 0.6px; vector-effect: non-scaling-stroke; }
    .h3-deck.ghost { cursor: pointer; }
    .h3-deck.ghost:hover .h3-floor { fill: color-mix(in srgb, var(--sc-accent) 9%, transparent); stroke: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .h3-deck.on .h3-floor { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke: color-mix(in srgb, var(--sc-accent) 85%, white); stroke-width: 1px; }
    .h3-deck.on .h3-top { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 30%, transparent); stroke-width: 0.7px; vector-effect: non-scaling-stroke; }
    .h3-deck.all .h3-floor { fill: color-mix(in srgb, var(--sc-accent) 10%, transparent); stroke: color-mix(in srgb, var(--sc-accent) 50%, transparent); stroke-width: 0.7px; }
    .h3-grid { cursor: pointer; }
    .h3-gb { fill: color-mix(in srgb, var(--sc-int-cargo) 25%, transparent); }
    .h3-gs { fill: color-mix(in srgb, var(--sc-int-cargo) 32%, transparent); stroke: var(--sc-int-cargo); stroke-width: 0.8px; vector-effect: non-scaling-stroke; }
    .h3-gt { fill: color-mix(in srgb, var(--sc-int-cargo) 55%, transparent); stroke: color-mix(in srgb, var(--sc-int-cargo) 70%, white); stroke-width: 1px; vector-effect: non-scaling-stroke; }
    .h3-grid.off { opacity: 0.35; }
    .h3-gl { fill: color-mix(in srgb, var(--sc-int-cargo) 40%, white); font-weight: 700; text-anchor: middle; pointer-events: none; }
    .h3-lift { stroke: color-mix(in srgb, var(--sc-int-ways) 60%, white); stroke-width: 2.4px; vector-effect: non-scaling-stroke;
      filter: drop-shadow(0 0 3px var(--sc-int-ways)); }
    .h3-stop { fill: color-mix(in srgb, var(--sc-int-ways) 15%, white); }
    .h3-ladder { stroke: color-mix(in srgb, var(--sc-int-ways) 40%, white); stroke-width: 1.6px; stroke-dasharray: 2 2; vector-effect: non-scaling-stroke; }
    .h3-door { fill: var(--sc-int-doors); cursor: pointer; }
    .h3-ic { cursor: pointer; }
    .h3-ic .ic-bg { fill: var(--sc-bg-0); stroke: currentColor; stroke-width: 1.6px; }
    .h3-ic path { fill: none; stroke: currentColor; stroke-width: 1.7px; }
    .h3-ic path.fill { fill: currentColor; stroke: none; }
    .h3-ic[data-g='ways'] { color: var(--sc-int-ways); }
    .h3-ic[data-g='med'] { color: var(--sc-int-med); }
    .h3-ic[data-g='weapons'] { color: var(--sc-int-weapons); }
    .h3-ic[data-g='lockers'] { color: var(--sc-int-lockers); }
    .h3-ic[data-g='fire'] { color: var(--sc-int-fire); }
    .h3-ic[data-g='tech'] { color: var(--sc-int-tech); }
    .h3-ic[data-g='living'] { color: var(--sc-int-living); }
    .h3-pick { fill: none; stroke: var(--sc-fg-0); stroke-width: 2px; vector-effect: non-scaling-stroke;
      filter: drop-shadow(0 0 4px var(--sc-accent)); pointer-events: none; }
    .h3-lbl { fill: var(--sc-fg-0); font-weight: 700; letter-spacing: 0.08em; pointer-events: none; }
    .i3-ctl { position: absolute; right: 4px; bottom: 4px; display: flex; align-items: center; gap: 4px; }
    .i3-hint { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); margin-right: 4px; }
    .i3-ctl svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    @media (pointer: coarse) { .i3-hint { display: none; } }
  `],
})
export class ShipInterior3dComponent {
  readonly decks = input.required<readonly ShipDeck[]>();
  readonly interior = input<ShipInterior | null>(null);
  readonly silhouette = input<HoloSilhouette | null>(null);
  /** The focused deck; null = every deck equal. */
  readonly focus = input<string | null>(null);
  readonly focusLabel = input<string>('');
  readonly groups = input<ReadonlySet<ShipInteriorGroup>>(new Set());
  readonly pick = input<InteriorPick | null>(null);
  readonly still = input(false);

  readonly pickChange = output<InteriorPick>();
  readonly deckSelect = output<string>();

  readonly glyph = GLYPH_PATHS;
  readonly yaw = signal(YAW0);
  readonly pitch = signal(PITCH0);
  readonly zoom = signal(1);
  readonly dragging = signal(false);

  readonly scene = computed(() =>
    buildScene3d({
      decks: this.decks(),
      interior: this.interior(),
      silhouette: this.silhouette(),
      focus: this.focus(),
      groups: this.groups(),
      pick: this.pick(),
      yaw: this.yaw(),
      pitch: this.pitch(),
      zoom: this.zoom(),
    }),
  );

  private readonly host = inject(ElementRef<HTMLElement>);
  private drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // The wheel zooms the model, not the page: a passive Angular listener cannot prevent the scroll.
    afterNextRender(() => {
      const el = this.host.nativeElement as HTMLElement;
      const onWheel = (e: WheelEvent) => {
        if (!(e.target instanceof Element) || !e.target.closest('.h3')) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      destroyRef.onDestroy(() => el.removeEventListener('wheel', onWheel));
    });
  }

  zoomBy(f: number): void {
    this.zoom.update((z) => Math.max(1, Math.min(8, Math.round(z * f * 100) / 100)));
  }

  resetView(): void {
    this.yaw.set(YAW0);
    this.pitch.set(PITCH0);
    this.zoom.set(1);
  }

  onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: this.yaw(), pitch: this.pitch(), moved: false };
  }

  onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      this.dragging.set(true);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    this.yaw.set(Math.round((d.yaw - dx * 0.4) * 10) / 10);
    this.pitch.set(Math.max(5, Math.min(88, Math.round((d.pitch + dy * 0.3) * 10) / 10)));
  }

  onUp(e: PointerEvent): void {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const moved = this.drag.moved;
    this.drag = null;
    this.dragging.set(false);
    // A drag that turned the model is no click on what it ended over.
    if (moved) this.suppressClick = true;
  }

  private suppressClick = false;

  private consumeClick(): boolean {
    if (!this.suppressClick) return true;
    this.suppressClick = false;
    return false;
  }

  onDeckClick(key: string, state: 'on' | 'ghost' | 'all'): void {
    if (!this.consumeClick()) return;
    if (state !== 'on') this.deckSelect.emit(key);
  }

  pickEl(p: InteriorPick): void {
    if (!this.consumeClick()) return;
    this.pickChange.emit(p);
  }

  onKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 15 : 5;
    switch (e.key) {
      case 'ArrowLeft': this.yaw.update((v) => v + step); break;
      case 'ArrowRight': this.yaw.update((v) => v - step); break;
      case 'ArrowUp': this.pitch.update((v) => Math.min(88, v + step)); break;
      case 'ArrowDown': this.pitch.update((v) => Math.max(5, v - step)); break;
      case '+': case '=': this.zoomBy(1.25); break;
      case '-': this.zoomBy(0.8); break;
      default: return;
    }
    e.preventDefault();
  }
}
