import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BETA_AREAS, BetaArea, BetaService } from '../../core/beta.service';
import { FeedbackFabPrefsService } from '../../core/feedback-fab-prefs.service';
import { BetaPanelComponent } from './beta-panel.component';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * The ONE beta switch: a small round β FAB directly above the feedback
 * launcher (same size as the share button), on the beta shell and the normal
 * one alike. Its popup opens upward from there.
 *
 * Who sees what: a viewer gets only the switch of the area they are in
 * (`area`, from `betaAreaOf`) in the normal accent, and no FAB where there is
 * no switch. Admins and collaborators get every area; their FAB is the
 * elevated-access red and names the role in its label.
 *
 * Staff share one corner setting with the feedback launcher (feedback #339):
 * "Feedback-Button anzeigen" off hides this FAB too. A viewer's single area
 * switch is not affected — their settings text never mentions the beta button,
 * so the setting must not take it away from them either.
 */
@Component({
  selector: 'sc-beta-fab',
  standalone: true,
  imports: [TranslatePipe, BetaPanelComponent, ScPopupComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (areas().length) {
      <aside class="wrap" [class.staff]="staff()" [attr.aria-label]="'beta.aria' | translate">
        <button type="button" class="fab" [attr.aria-expanded]="open()" aria-haspopup="dialog"
                [attr.aria-label]="label() | translate"
                [scTooltip]="label() | translate" scTooltipTier="label"
                (click)="open.set(!open())">
          <span class="mark" aria-hidden="true">β</span>
        </button>
        @if (open()) {
          <div class="panel">
            <sc-popup kind="panel" size="menu" [title]="'beta.chip.title' | translate" [access]="staff() ? 'collab' : null"
                      [backClose]="false" (closed)="open.set(false)">
            <sc-beta-panel [areas]="areas()" [staff]="staff()" />
            </sc-popup>
          </div>
        }
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* One lane above the feedback launcher, on its centre line; the popup opens
       upward. Phone: above the share button's lane (--sc-beta-fab-bottom). */
    .wrap {
      --_d: max(44px, var(--sc-tap-min, 44px));
      position: fixed; z-index: 59; /* above the page furniture (<= 55), below every modal band layer (>= 60): a dialog and its scrim cover it */
      inset-inline-end: calc(max(var(--sc-fab-inset, 24px), env(safe-area-inset-right, 0px)) + (var(--sc-fab-size, 56px) - var(--_d)) / 2);
      /* The view toggle FAB (ship pages) takes the first lane above the launcher; β stacks on it. */
      bottom: calc(var(--sc-fab-clear-block, 96px) + var(--sc-view-fab-lane, 0px));
      display: flex; flex-direction: column-reverse; align-items: flex-end; gap: var(--sc-space-2);
    }
    @media (max-width: 720px) {
      .wrap { bottom: calc(var(--sc-beta-fab-bottom, var(--sc-fab-clear-block, 96px)) + var(--sc-view-fab-lane, 0px)); }
    }
    .fab {
      display: inline-grid; place-items: center; width: var(--_d); height: var(--_d);
      border-radius: 50%; padding: 0; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-accent);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }
    .staff .fab { color: var(--sc-accent-collab); border-color: color-mix(in srgb, var(--sc-accent-collab) 55%, var(--sc-border)); }
    .fab:hover, .fab[aria-expanded='true'] { background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-1)); border-color: var(--sc-accent); }
    .staff .fab:hover, .staff .fab[aria-expanded='true'] { background: color-mix(in srgb, var(--sc-accent-collab) 14%, var(--sc-bg-1)); border-color: var(--sc-accent-collab); }
    .fab:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
    .mark { font-family: var(--sc-font-display); font-weight: 700; font-size: 1.1rem; }
    /* Position only (opens upward from the FAB); frame, width, head and ✕ come from <sc-popup kind="panel">. */
    .panel { display: block; }
  `],
})
export class BetaFabComponent {
  protected readonly beta = inject(BetaService);
  protected readonly roles = inject(RoleService);
  private readonly fabPrefs = inject(FeedbackFabPrefsService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** The area the reader is in (`betaAreaOf`); viewers get only this switch. */
  readonly area = input<BetaArea | null>(null);
  protected readonly open = signal(false);
  protected readonly staff = computed(() => this.roles.isCollaborator());
  protected readonly areas = computed<readonly BetaArea[]>(() => {
    if (this.staff()) return this.fabPrefs.show() ? BETA_AREAS : [];
    const a = this.area();
    return a ? [a] : [];
  });
  protected readonly label = computed(() =>
    !this.staff() ? 'beta.aria' : this.roles.isAdmin() ? 'beta.fab.admin' : 'beta.fab.collaborator');

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open()) return;
    const wrap = (this.host.nativeElement as HTMLElement).querySelector('.wrap');
    if (wrap && !wrap.contains(ev.target as Node)) this.open.set(false);
  }
}
