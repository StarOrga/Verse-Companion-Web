import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AnalyticsService } from '../core/analytics.service';
import { AuthService } from '../auth/auth.service';
import { ScSegmentOption, ScSegmentedComponent } from '../shared/segmented-control.component';
import { STARSCAPE_FILTERS, StarscapeService, isStarscapeFilter } from './starscape.service';

/**
 * The gallery's four views as ONE segment in the page head, right next to the
 * page's actions (batch concept 20261115-2122, screen `d1-segment`: „ok! Lass
 * uns das so machen, ja!") — no row of its own with a dropdown any more.
 *
 * Self-contained on purpose: the Verse page projects it into
 * `<sc-verse-header vhActions>`, the legacy page into its own head; both read
 * and write the one root-scoped `StarscapeService.filter`, so the wall below
 * (StarscapeComponent) follows whichever head the segment sits in.
 *
 * The fourth view is the reader's Sammlung (= the wallpapers they up-voted). It
 * needs an account, so signed out it stays visible but not pickable, with the
 * reason as its tooltip.
 */
@Component({
  selector: 'sc-starscape-filter-segment',
  standalone: true,
  imports: [TranslatePipe, ScSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-segmented
      class="seg"
      [options]="options()"
      [value]="svc.filter()"
      [ariaLabel]="'starscape.filter.label' | translate"
      (valueChange)="pick($event)" />
  `,
  styles: [`
    :host { display: inline-block; max-width: 100%; min-width: 0; }
    .seg { max-width: 100%; }
    /* Phones: the segment takes the full row, four thumb-sized targets. */
    @media (max-width: 640px) { :host, .seg { display: block; width: 100%; } }
  `],
})
export class StarscapeFilterSegmentComponent {
  readonly svc = inject(StarscapeService);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);

  readonly options = computed<readonly ScSegmentOption[]>(() => {
    const signedIn = this.auth.isAuthenticated();
    return STARSCAPE_FILTERS.map((f) => {
      const locked = f.id === 'mine' && !signedIn;
      return {
        value: f.id,
        labelKey: f.labelKey,
        disabled: locked,
        titleKey: locked ? 'starscape.filter.sammlungSignedOut' : undefined,
      };
    });
  });

  pick(id: string): void {
    if (!isStarscapeFilter(id) || id === this.svc.filter()) return;
    if (id === 'mine' && !this.auth.isAuthenticated()) return;
    this.analytics.track('verse:gallery_filter_select', { filter: id });
    void this.svc.setFilter(id);
  }
}
