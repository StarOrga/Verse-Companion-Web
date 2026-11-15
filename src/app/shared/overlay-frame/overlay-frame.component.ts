import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../action/sc-action.directive';
import { ScPopupComponent } from '../popup/sc-popup.component';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';
import { OverlayOriginService } from './overlay-origin.service';

/** A prev/next neighbour: router commands for its real anchor. */
export interface OverlayNeighbour {
  readonly commands: readonly unknown[];
}

/**
 * ONE frame for every routed overlay (`/verse/news/:id`, `/verse/gallery/:imageId`,
 * `/verse/patches/:line`): close button, title row, prev/next, scrim, focus
 * trap via `[scDialog]`.
 *
 * Two modes, decided by `OverlayOriginService`:
 * - overlay (opened from its list): an `<sc-popup kind="large">` (its frame, ✕, scrim, phone full screen come from the scaffold; it owns a URL, so no extra history entry unless `popup`); Escape and the
 *   close button emit `closed` (a click on the scrim does not), the host closes via `OverlayOriginService.close()` (history back, never a pushed entry).
 * - page (direct load / refresh / shared link): the same content flows in the
 *   page frame, no scrim, no dialog semantics.
 * Prev/next are real anchors (`routerLink` leaves modified clicks to the browser).
 */
@Component({
  selector: 'sc-overlay-frame',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScActionDirective, ScPopupComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (overlay()) {
      <sc-popup kind="large" [title]="heading()" [eyebrow]="eyebrow()" [backClose]="popup() ? null : false" (closed)="closed.emit()">
        <ng-container popupTools>
          <ng-container *ngTemplateOutlet="steppers" />
        </ng-container>
        <div class="content"><ng-container *ngTemplateOutlet="body" /></div>
      </sc-popup>
    } @else {
      <div class="sheet page">
        <header class="bar">
          <h2 class="ttl">{{ heading() }}</h2>
          <span class="nav"><ng-container *ngTemplateOutlet="steppers" /></span>
        </header>
        <div class="content"><ng-container *ngTemplateOutlet="body" /></div>
      </div>
    }
    <!-- ONE ng-content (a second one in the other @if branch would leave the first slot empty). -->
    <ng-template #body><ng-content /></ng-template>
    <ng-template #steppers>
      @if (prev(); as p) {
        <a scAction tier="tertiary" [routerLink]="p.commands" [replaceUrl]="true" [attr.aria-label]="'overlay.prev' | translate"
           [scTooltip]="'overlay.prev' | translate" scTooltipTier="label">
          <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </a>
      }
      @if (next(); as n) {
        <a scAction tier="tertiary" [routerLink]="n.commands" [replaceUrl]="true" [attr.aria-label]="'overlay.next' | translate"
           [scTooltip]="'overlay.next' | translate" scTooltipTier="label">
          <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </a>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .sheet { display: flex; flex-direction: column; min-height: 0; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 10px 0; flex: 0 0 auto; }
    .ttl { margin: 0; flex: 1 1 auto; min-width: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
    .nav { display: inline-flex; gap: 6px; flex: 0 0 auto; }
    .content :where(p, li) { max-width: var(--sc-measure, 70ch); }
  `],
})
export class OverlayFrameComponent {
  private readonly origin = inject(OverlayOriginService);

  readonly heading = input.required<string>();
  /** Optional area / subject shown vertically in the popup rail (overlay mode only). */
  readonly eyebrow = input('');
  readonly prev = input<OverlayNeighbour | null>(null);
  readonly next = input<OverlayNeighbour | null>(null);
  readonly closed = output<void>();
  /** A popup opened from a button (not a routed overlay): always the takeover sheet, never the page mode. */
  readonly popup = input(false);

  /** Overlay over the list when opened from it, else a full page. */
  protected overlay(): boolean {
    return this.popup() || this.origin.overlaid();
  }
}
