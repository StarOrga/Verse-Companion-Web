// The rank display of a category head: a P-ring and the plain sentence
// ("besser als 41 % der Klasse").
//
// Kept as its own small component ON PURPOSE: another concept thread wants a
// "compare with factory / saved loadout" display in this spot instead of (or
// next to) the class rank. That display replaces this component in
// `sc-codex-holo-category-head`; nothing else needs to change.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

const R = 28;
const CIRC = 2 * Math.PI * R;

@Component({
  selector: 'sc-codex-holo-rank',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-dim]': 'dim()' },
  template: `
    <svg class="ring" viewBox="0 0 64 64" role="img"
         [attr.aria-label]="rank() === null ? ('codex.holo.head.rankNone' | translate) : ('codex.holo.head.rankAria' | translate: { n: rank() })">
      <circle class="tr" cx="32" cy="32" r="28" />
      @if (rank() !== null) {
        <circle class="va" cx="32" cy="32" r="28" [attr.stroke-dasharray]="dash()" />
      }
      <text x="32" y="38">{{ rank() === null ? '—' : 'P' + rank() }}</text>
    </svg>
    <p class="say">
      @if (rank() !== null) {
        {{ phraseKey() | translate: { n: rank() } }}
      } @else if (thin()) {
        {{ 'codex.holo.head.thin' | translate: { n: cohortSize() } }}
      } @else {
        {{ 'codex.holo.head.rankNone' | translate }}
      }
    </p>
  `,
  styles: [
    `
      :host { display: contents; }
      .ring { grid-column: 2; grid-row: 1 / span 2; inline-size: 64px; block-size: 64px; }
      :host(.is-dim) .ring { opacity: 0.35; }
      .ring circle { fill: none; stroke-width: 6; }
      .tr { stroke: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); }
      .va { stroke: var(--p, var(--sc-accent)); stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
      /* ds-ok: 16px ring label inside a 64px graphic */
      .ring text { text-anchor: middle; fill: var(--sc-fg-0); font-family: var(--font-monospace, monospace); font-size: 16px; }
      .say { grid-column: 1; margin: 0; font-size: 13px; line-height: 1.45; color: var(--sc-fg-2); }
    `,
  ],
})
export class CodexHoloRankComponent {
  /** Percentile 0..100, higher = better; null = no ranking (thin class or a gap). */
  readonly rank = input<number | null>(null);
  readonly thin = input(false);
  readonly cohortSize = input(0);
  /** i18n key of the sentence; `{{n}}` is the percentile. */
  readonly phraseKey = input('codex.holo.head.betterThan');
  readonly dim = input(false);

  protected readonly dash = computed(() => {
    const p = Math.max(0, Math.min(100, this.rank() ?? 0));
    return `${((p / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`;
  });
}
