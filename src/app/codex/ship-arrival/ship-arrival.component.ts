import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { SilThumb } from '../../shared/sil-thumb/sil-thumbs.service';

/**
 * The real silhouette of the ship that is loading, as the Holotable will show it a moment later: the outline
 * materialises behind a scan front, top to bottom, in the box the table's hull takes (the same move as the
 * table's own `sil-scan`), so the skeleton reads as the first pass of the hologram and not as a scene of its own.
 * Nothing else is drawn here; the lock ring and the scan line around it belong to the parent's skeleton.
 * Reduced motion: the outline is simply there.
 */
@Component({
  selector: 'sc-ship-arrival',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="hull" [attr.viewBox]="thumb().viewBox" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor"
         stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
      <path class="outline" [attr.d]="thumb().path" [attr.transform]="thumb().transform || null" vector-effect="non-scaling-stroke" />
      @if (thumb().edges) {
        <path class="edges" [attr.d]="thumb().edges" vector-effect="non-scaling-stroke" stroke-width="0.8" />
      }
    </svg>
  `,
  styles: [
    `
      :host { position: absolute; inset: 0; display: grid; place-items: center; color: var(--sc-accent); pointer-events: none; }
      /* ds-ok: the box of the Holotable's hull (.shipwrap in codex-holo-table), so the outline stands where the hologram lands. */
      .hull { width: min(560px, 76%); height: min(560px, 82%); overflow: visible;
        filter: drop-shadow(0 0 8px color-mix(in srgb, var(--sc-accent) 55%, transparent));
        animation: arr-scan 0.9s cubic-bezier(0.4, 0, 0.2, 1) both; }
      .edges { opacity: 0; animation: arr-edges 0.6s 0.7s ease-out forwards; }
      /* The whole outline, never a partly drawn stroke: a dash pattern has to know the path's length and cut long hulls in half. */
      @keyframes arr-scan { from { clip-path: inset(0 0 100% 0); opacity: 0.4; } to { clip-path: inset(-12% -12% -12% -12%); opacity: 1; } }
      @keyframes arr-edges { to { opacity: 0.5; } }
      @media (prefers-reduced-motion: reduce) {
        .hull, .edges { animation: none; }
        .edges { opacity: 0.5; }
      }
    `,
  ],
})
export class ShipArrivalComponent {
  readonly thumb = input.required<SilThumb>();
}
