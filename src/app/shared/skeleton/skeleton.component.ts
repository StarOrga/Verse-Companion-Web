import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Loading placeholder with a RESERVED box: the page reserves the final height before the data
 * arrives, so nothing below it moves when the real content replaces it (layout shift).
 *
 * `<sc-skeleton h="96px" [lines]="3" />` — `h` is the height of one block (a CSS length), `lines`
 * repeats the block, `count` is an alias for a stack of equal blocks. The shimmer is a pseudo
 * element sliding by `translate` only (compositor, no layout/paint of the box); under reduced
 * motion it stands still. The blocks are `aria-hidden`; one visible-to-assistive-tech live region
 * says "loading".
 */
@Component({
  selector: 'sc-skeleton',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[style.--sc-sk-h]': 'h()', '[style.--sc-sk-gap]': 'gap()' },
  template: `
    <span class="sc-sr-only">{{ 'skeleton.loading' | translate }}</span>
    @for (n of rows(); track n) {
      <span class="blk" aria-hidden="true"></span>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: var(--sc-sk-gap, var(--sc-space-3)); contain: layout paint; }
    .blk {
      position: relative; display: block; overflow: hidden; block-size: var(--sc-sk-h, 96px);
      border-radius: var(--sc-radius-md, 10px);
      background: color-mix(in srgb, var(--sc-fg-0, #fff) 6%, var(--sc-bg-1, #111));
    }
    .blk::after {
      content: ''; position: absolute; inset: 0; translate: -100% 0;
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sc-fg-0, #fff) 9%, transparent), transparent);
      animation: sc-sk-shimmer 1.4s var(--sc-e-out, ease-out) infinite;
    }
    @keyframes sc-sk-shimmer { to { translate: 100% 0; } }
    @media (prefers-reduced-motion: reduce) { .blk::after { animation: none; display: none; } }
    :host-context(.reduced-motion) .blk::after { animation: none; display: none; }
  `],
})
export class ScSkeletonComponent {
  /** Height of one block (CSS length). */
  readonly h = input('96px');
  /** How many equal blocks are stacked. */
  readonly lines = input(1);
  /** Gap between stacked blocks (CSS length). */
  readonly gap = input<string | null>(null);

  protected rows(): number[] {
    return Array.from({ length: Math.max(1, Math.floor(this.lines())) }, (_, i) => i);
  }
}
