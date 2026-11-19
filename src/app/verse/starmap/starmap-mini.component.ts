import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { VersePoint } from '../data/verse.models';
import type { StarSlot, StarTaskView } from './starmap.model';
import { STARS_PER_PATCH, constellationEdges, starSlots } from './starmap.model';

/**
 * The current star map in small: only what the user has discovered — the lit
 * stars of the dome at their places and the solid lines between them, scaled
 * into a header emblem. Never a default shape: with nothing lit yet it is ONE
 * single star in the middle. No circle, no globe, no open stars, no task or
 * next-star hint. Decorative: the page states the
 * progress in words.
 */
@Component({
  selector: 'sc-starmap-mini',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-8 -8 116 116" aria-hidden="true" focusable="false">
      @for (e of edges(); track $index) {
        <path class="ln on" [attr.d]="'M' + e.from.x + ' ' + e.from.y + 'L' + e.to.x + ' ' + e.to.y" />
      }
      @for (s of slots(); track s.index) {
        <g [attr.transform]="'translate(' + s.x + ' ' + s.y + ')'" [class.done]="s.state === 'done'">
          @if (s.state === 'done') {
            <circle class="halo" r="9" />
            <path class="spk" d="M0-13L1 0 0 13-1 0zM-13 0L0 1 13 0 0-1z" />
          }
          <circle class="core" [attr.r]="s.state === 'done' ? 3.6 : 3" />
        </g>
      }
    </svg>
  `,
  styles: [
    `
      :host { display: block; width: 100%; height: 100%; }
      svg { display: block; width: 100%; height: 100%; overflow: visible; }
      .ln { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 45%, transparent); stroke-width: 1.2; stroke-dasharray: 3 4; }
      .ln.on { stroke: var(--sc-accent); stroke-dasharray: none; stroke-width: 1.6; }
      .core { fill: color-mix(in srgb, var(--sc-fg-1) 45%, transparent); }
      .done .core { fill: #fff; }
      .halo { fill: var(--sc-accent); opacity: 0.5; filter: blur(3px); }
      .spk { fill: #fff; opacity: 0.85; }
    `,
  ],
})
export class StarmapMiniComponent {
  readonly points = input<readonly VersePoint[] | null | undefined>(null);
  readonly tasks = input<readonly StarTaskView[]>([]);
  readonly next = input<StarTaskView | null>(null);

  private readonly all = computed(() => starSlots(this.points(), this.tasks(), this.next()));
  readonly slots = computed<StarSlot[]>(() => {
    const pts = this.points();
    const lit = pts && pts.length === STARS_PER_PATCH ? this.all().filter((s) => s.state === 'done') : [];
    if (lit.length === 0) return [{ index: 0, x: 50, y: 50, rank: 0, state: 'open', task: null }];
    return lit;
  });
  readonly edges = computed(() => (this.slots().length > 1 ? constellationEdges(this.all()).filter((e) => e.lit) : []));
}
