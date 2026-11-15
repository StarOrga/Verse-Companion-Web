import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScPopupComponent } from '../popup/sc-popup.component';
import { ScActionDirective } from '../action/sc-action.directive';
import type { ScConfirmTone } from './sc-confirm.service';

let uid = 0;

/**
 * The confirm/prompt dialog ScConfirmService renders in a CDK overlay — the
 * first consumer of `<sc-popup>` (kind dialog, size S, alertdialog). ✕ beside
 * Abbrechen; a scrim click never answers it, only ✕, Abbrechen, Escape or the
 * confirm button do. A real form: Enter in the prompt field submits, Enter on a
 * focused button presses it. Primary first, in reading order (d3). Initial focus is the safe choice — Cancel for a destructive (danger)
 * question, Confirm for a harmless one, the field in prompt mode.
 */
@Component({
  selector: 'sc-confirm-dialog',
  standalone: true,
  imports: [TranslatePipe, ScPopupComponent, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="sc-confirm" (submit)="onSubmit($event)">
      <sc-popup
        kind="dialog"
        size="s"
        dialogRole="alertdialog"
        [backdrop]="false"
        [describedBy]="messageKey() ? messageId : null"
        [title]="titleKey() | translate: params()"
        (closed)="closed.emit(null)"
      >
        @if (messageKey(); as m) {
          <p class="msg" [id]="messageId">{{ m | translate: params() }}</p>
        }
        @if (mode() === 'prompt') {
          <label class="sc-float-field field">
            <input
              class="sc-input"
              type="text"
              placeholder=" "
              cdkFocusInitial
              [attr.maxlength]="inputMaxLength() ?? null"
              [value]="text()"
              (input)="text.set($any($event.target).value)"
            />
            @if (inputLabelKey(); as l) {
              <span class="sc-float-label">{{ l | translate }}</span>
            }
          </label>
        }
        <ng-container popupActions>
          <button
            scAction
            tier="primary"
            [tone]="tone() === 'danger' ? 'danger' : 'default'"
            type="submit"
            class="confirm"
            [class.danger]="tone() === 'danger'"
            [attr.cdkFocusInitial]="mode() === 'confirm' && tone() !== 'danger' ? '' : null"
          >
            {{ confirmKey() | translate }}
          </button>
          <button
            scAction
            tier="secondary"
            type="button"
            class="cancel"
            [attr.cdkFocusInitial]="mode() === 'confirm' && tone() === 'danger' ? '' : null"
            (click)="closed.emit(null)"
          >
            {{ cancelKey() | translate }}
          </button>
        </ng-container>
      </sc-popup>
    </form>
  `,
  styles: [
    `
      :host { display: block; }
      .sc-confirm { margin: 0; }
      .msg {
        margin: 0;
        color: var(--sc-fg-1);
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .field { margin-top: 12px; }
    `,
  ],
})
export class ScConfirmDialogComponent {
  readonly titleKey = input.required<string>();
  readonly messageKey = input<string | undefined>();
  readonly params = input<Record<string, unknown> | undefined>();
  readonly confirmKey = input<string>('common.dialog.confirm');
  readonly cancelKey = input<string>('common.dialog.cancel');
  readonly tone = input<ScConfirmTone>('default');
  readonly mode = input<'confirm' | 'prompt'>('confirm');
  readonly inputLabelKey = input<string | undefined>();
  readonly inputMaxLength = input<number | undefined>();
  readonly initialValue = input<string>('');

  /** '' / the typed text = confirmed, null = cancelled. */
  readonly closed = output<string | null>();

  readonly messageId = `sc-confirm-message-${++uid}`;
  readonly text = linkedSignal(() => this.initialValue());

  onSubmit(ev: Event): void {
    ev.preventDefault();
    this.closed.emit(this.mode() === 'prompt' ? this.text() : '');
  }
}
