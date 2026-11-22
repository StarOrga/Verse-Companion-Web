import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ringDash, ringPips } from './cards.logic';

/**
 * The daily-goal ring of the Karteikarten tab (concept karteikarten-neu, Box „Tagesziel & Sprachen“ and the
 * phone HUD strip): a violet arc over a faint track with one pip per card of the goal; gold once the goal is full.
 * `hot` lights it up for the moment after an answer (U12). Pure SVG, the numbers sit in the projected content.
 */
@Component({
  selector: 'sc-goal-ring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.hot]': 'hot()', '[class.full]': 'full()', '[class.small]': 'small()' },
  template: `
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <circle class="track" cx="80" cy="80" r="66" />
      <circle class="arc" cx="80" cy="80" r="66" [attr.stroke-dasharray]="dash()" transform="rotate(-90 80 80)" />
      @if (!small()) {
        @for (p of pips(); track $index) {
          <circle class="pip" [class.on]="$index < done()" [attr.cx]="p.x" [attr.cy]="p.y" r="3.6" />
        }
      }
    </svg>
    <span class="v"><ng-content /></span>
  `,
  styles: [
    `
      :host { position: relative; display: block; width: 132px; height: 132px; flex: none; }
      :host(.small) { width: 52px; height: 52px; }
      svg { display: block; width: 100%; height: 100%; overflow: visible; }
      .track { fill: none; stroke: color-mix(in srgb, var(--tc-pu) 14%, transparent); stroke-width: 7; }
      :host(.small) .track, :host(.small) .arc { stroke-width: 12; }
      .arc { fill: none; stroke: var(--tc-pu); stroke-width: 7; stroke-linecap: round; transition: stroke-dasharray 0.4s ease; }
      .pip { fill: var(--sc-bg-0); stroke: color-mix(in srgb, var(--tc-pu) 55%, transparent); stroke-width: 1.4; }
      .pip.on { fill: var(--tc-pu-hi); stroke: var(--tc-pu); }
      :host(.full) .arc { stroke: var(--tc-gold); }
      :host(.full) .track { stroke: color-mix(in srgb, var(--tc-gold) 18%, transparent); }
      :host(.hot) svg { filter: drop-shadow(0 0 14px color-mix(in srgb, var(--tc-pu) 60%, transparent)); }
      .v { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 3px; text-align: center; }
      @media (prefers-reduced-motion: reduce) { .arc { transition: none; } }
    `,
  ],
})
export class GoalRingComponent {
  readonly done = input(0);
  readonly target = input(10);
  readonly hot = input(false);
  readonly small = input(false);

  protected readonly full = computed(() => this.target() > 0 && this.done() >= this.target());
  protected readonly dash = computed(() => ringDash(this.done(), this.target(), 66));
  protected readonly pips = computed(() => ringPips(this.target()));
}
