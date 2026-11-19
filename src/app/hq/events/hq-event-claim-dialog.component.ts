import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScSegmentedComponent, type ScSegmentOption } from '../../shared/segmented-control.component';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { HQ_POPUP_CONTENT_STYLES } from '../plan/hq-popup-content.styles';
import { EventHqService } from './event-hq.service';
import { looksLikeShip } from './event-hq.util';
import { defaultClaimChannel, type ClaimChannel } from './event-nachschub';
import type { EventReward } from './event-sheet';

export const CLAIM_CHANNELS: readonly ClaimChannel[] = ['pledge', 'ingame', 'both'];

/**
 * Claim dialog (F10, ev-a9): which channel the reward came through (pledge / ingame / both, preselected from the sheet),
 * put it into Bestand (origin = channel; ships go to the Hangar), and optionally tick the whole event "erledigt".
 * The SCC-App can change the channel later by itself; the dialog shows what it set.
 */
@Component({
  selector: 'sc-hq-event-claim-dialog',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScPopupComponent, ScTristateComponent, ScSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-popup kind="dialog" [eyebrow]="'hq.title' | translate" [title]="'hq.events.claim.title' | translate: { name: reward().name }" (closed)="closed.emit()">
      <div class="pbody">
        <fieldset class="chan">
          <legend>{{ 'hq.events.claim.channel' | translate }}</legend>
          <sc-segmented variant="chips" [options]="channelOptions" [value]="channel()" [ariaLabel]="'hq.events.claim.channel' | translate"
                        (valueChange)="channel.set($any($event))" />
          @if (byApp()) { <small class="dlg-msg">{{ 'hq.events.claim.byApp' | translate }}</small> }
        </fieldset>
        <div class="opt">
          <sc-tristate variant="checkbox" [label]="'hq.events.claim.store' | translate" [value]="store() ? 1 : 0" (toggled)="store.set(!store())" />
          <span>{{ 'hq.events.claim.store' | translate }}</span>
        </div>
        @if (store() && reward().className) {
          <div class="opt sub">
            <sc-tristate variant="checkbox" [label]="'hq.events.claim.isShip' | translate" [value]="ship() ? 1 : 0" (toggled)="ship.set(!ship())" />
            <span>{{ 'hq.events.claim.isShip' | translate }}</span>
          </div>
          <p class="dlg-msg hint">{{ (ship() ? 'hq.events.claim.toHangar' : 'hq.events.claim.toInventory') | translate }}</p>
        }
        <div class="opt">
          <sc-tristate variant="checkbox" [label]="'hq.events.claim.complete' | translate" [value]="complete() ? 1 : 0" (toggled)="complete.set(!complete())" />
          <span>{{ 'hq.events.claim.complete' | translate }}</span>
        </div>
        @if (error(); as e) { <p class="dlg-err" role="alert">{{ e | translate }}</p> }
      </div>
      <ng-container popupActions>
        <button type="button" scAction tier="primary" [busy]="busy()" [disabled]="busy()" (click)="confirm()">{{ 'hq.events.claim.confirm' | translate }}</button>
        <button type="button" scAction tier="secondary" (click)="closed.emit()">{{ 'common.dialog.cancel' | translate }}</button>
      </ng-container>
    </sc-popup>
  `,
  styles: [
    HQ_POPUP_CONTENT_STYLES,
    `.chan { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
     .chan legend { padding: 0; font-weight: 600; margin-bottom: 4px; }
     .opt span { flex: 1; } .sub { margin-inline-start: 28px; } .hint { color: var(--sc-fg-2); font-size: 0.85rem; }`,
  ],
})
export class HqEventClaimDialogComponent {
  readonly eventId = input.required<string>();
  readonly reward = input.required<EventReward>();
  readonly closed = output<void>();
  readonly claimed = output<void>();

  private readonly events = inject(EventHqService);
  protected readonly channelOptions: readonly ScSegmentOption[] = CLAIM_CHANNELS.map((c) => ({ value: c, labelKey: 'hq.events.channel.' + c }));
  private readonly existing = computed(() => this.events.stateOf(this.eventId()).claimed[this.reward().id] ?? null);
  /** The SCC-App set the channel (a live claim) - shown, still changeable here. */
  protected readonly byApp = computed(() => this.existing()?.by === 'live');
  protected readonly channel = signal<ClaimChannel>('ingame');
  protected readonly store = signal(true);
  protected readonly ship = signal(false);
  protected readonly complete = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    queueMicrotask(() => {
      this.channel.set(this.existing()?.channel ?? defaultClaimChannel(this.reward()));
      this.ship.set(looksLikeShip(this.reward().className));
    });
  }

  protected async confirm(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const ok = await this.events.claim(this.eventId(), this.reward(), this.channel(), this.store(), this.ship());
      if (!ok) {
        this.error.set(this.events.claimError() ?? this.events.error() ?? 'errors.generic');
        return;
      }
      if (this.complete()) await this.events.complete(this.eventId());
      this.claimed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
