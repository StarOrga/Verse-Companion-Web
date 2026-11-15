import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';

/** One choosable Einsatz in the picker. */
export interface EinsatzPickOption {
  id: string;
  title: string;
  steps: number;
}

/** What the reader chose: an existing Einsatz, a new one, or nothing (null). */
export type EinsatzPick = { kind: 'existing'; id: string } | { kind: 'new' };

/**
 * "Zum Einsatz" (search CTA on a mission row): which planned / active Einsatz
 * the mission joins as a step, or "Neuer Einsatz". A list of real buttons in
 * an app dialog (`[scDialog]`: focus in, Tab trap, Escape, focus return) —
 * never a native dialog. Opened by HqEinsatzPickService.
 */
@Component({
  selector: 'sc-hq-einsatz-pick-dialog',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-popup kind="dialog" size="s" [backdrop]="false" [eyebrow]="'hq.title' | translate" [title]="'hq.einsatz.pick.title' | translate" (closed)="closed.emit(null)">
      <div class="pick">
      <p class="msg">{{ 'hq.einsatz.pick.message' | translate: { name: missionTitle() } }}</p>
      @if (options().length) {
        <ul class="list" (keydown)="onListKey($event)">
          @for (o of options(); track o.id; let first = $first) {
            <li>
              <button type="button" class="opt" [attr.cdkFocusInitial]="first ? '' : null" (click)="closed.emit({ kind: 'existing', id: o.id })">
                <span class="name">{{ o.title }}</span>
                <span class="n">{{ 'hq.einsatz.stepsTooltip' | translate: { n: o.steps } }}</span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="msg muted">{{ 'hq.einsatz.pick.none' | translate }}</p>
      }
      </div>
      <ng-container popupActions>
        <button type="button" scAction tier="primary" [attr.cdkFocusInitial]="options().length ? null : ''"
                (click)="closed.emit({ kind: 'new' })">{{ 'hq.einsatz.pick.new' | translate }}</button>
        <button type="button" scAction tier="secondary" (click)="closed.emit(null)">{{ 'common.dialog.cancel' | translate }}</button>
      </ng-container>
    </sc-popup>
  `,
  styles: [
    `
      :host { display: block; }
      .pick { display: flex; flex-direction: column; gap: 12px; }
      .msg { margin: 0; color: var(--sc-fg-1); overflow-wrap: anywhere; }
      .muted { color: var(--sc-fg-2); }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2); }
      .opt {
        inline-size: 100%;
        min-block-size: 44px;
        display: flex;
        align-items: center;
        gap: var(--sc-space-3);
        padding: var(--sc-space-2) var(--sc-space-3);
        border: 1px solid var(--sc-border);
        border-radius: var(--sc-radius, 6px);
        background: var(--sc-bg-1);
        color: var(--sc-fg-0);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .opt:hover { border-color: var(--sc-accent); }
      .opt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .name { flex: 1; min-inline-size: 0; overflow-wrap: anywhere; }
      .n { color: var(--sc-fg-2); font-size: 0.85rem; flex-shrink: 0; }
    `,
  ],
})
export class HqEinsatzPickDialogComponent {
  readonly missionTitle = input('');
  readonly options = input<readonly EinsatzPickOption[]>([]);
  readonly closed = output<EinsatzPick | null>();

  /** Arrow keys move between the Einsatz buttons (Home / End to the ends). */
  onListKey(ev: KeyboardEvent): void {
    const list = ev.currentTarget as HTMLElement;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>('button.opt'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      ev.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1)
      : ev.key === 'ArrowUp' ? Math.max(0, at - 1)
      : ev.key === 'Home' ? 0
      : ev.key === 'End' ? items.length - 1
      : -1;
    if (next < 0 || at < 0) return;
    ev.preventDefault();
    items[next]?.focus();
  }
}
