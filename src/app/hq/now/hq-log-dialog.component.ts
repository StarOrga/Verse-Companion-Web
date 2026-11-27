import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { HqLiveService } from './hq-live.service';
import { dayKey, eventLabel } from './hq-live.util';

/** The full event log, grouped by day, older pages on demand ("Mehr laden", 30 per page). */
@Component({
  selector: 'sc-hq-log-dialog',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScPopupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-popup [closeBeside]="true" kind="dialog" [eyebrow]="'hq.title' | translate" [title]="'hq.log.title' | translate" (closed)="closed.emit()">
      <div class="body">
        @if (live.error()) { <p class="err" role="alert">{{ live.error()! | translate }}</p> }
        @if (days().length === 0 && !live.error()) {
          <p class="empty">{{ 'hq.log.empty' | translate }}</p>
        }
        @for (day of days(); track day.key) {
          <h4 class="day">{{ day.at | scDate }}</h4>
          <ul>
            @for (ev of day.events; track ev.id) {
              <li [class.undone]="ev.undone">
                <time class="mono" [attr.datetime]="ev.at">{{ ev.at | scDate: 'time' }}</time>
                <span class="text">{{ label(ev).key | translate: label(ev).params }}</span>
                @if (ev.undone) {
                  <span class="tag">{{ 'hq.log.undone' | translate }}</span>
                } @else if (live.undoable(ev)) {
                  <button type="button" class="undo" (click)="live.undo(ev.id)">{{ 'hq.log.undo' | translate }}</button>
                }
              </li>
            }
          </ul>
        }
        @if (live.hasMore() && days().length > 0) {
          <button type="button" class="more" [disabled]="busy()" (click)="more()">{{ 'hq.log.more' | translate }}</button>
        }
      </div>
    </sc-popup>
  `,
  styles: [
    `
      .day { margin: var(--sc-space-3, 12px) 0 var(--sc-space-1, 4px); font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-fg-2); }
      ul { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) 0; border-bottom: 1px solid var(--sc-border); }
      li.undone .text { text-decoration: line-through; color: var(--sc-fg-2); }
      time { flex: none; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .tag { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .undo, .more { min-height: 44px; padding: 0 var(--sc-space-3, 12px); border-radius: var(--sc-radius, 10px); border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg); cursor: pointer; }
      .undo:hover:not(:disabled), .more:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-accent); }
      .undo:disabled, .more:disabled { opacity: 0.5; cursor: default; }
      .more { display: block; margin: var(--sc-space-3, 12px) auto 0; }
      .empty { color: var(--sc-fg-2); }
      .err { color: var(--sc-danger); }
    `,
  ],
})
export class HqLogDialogComponent {
  readonly live = inject(HqLiveService);
  readonly closed = output<void>();
  readonly busy = signal(false);

  readonly days = computed(() => {
    const out: { key: string; at: string; events: ReturnType<HqLiveService['events']> extends readonly (infer E)[] ? E[] : never }[] = [];
    for (const ev of this.live.events()) {
      const key = dayKey(ev.at);
      const last = out.at(-1);
      if (last?.key === key) last.events.push(ev);
      else out.push({ key, at: ev.at, events: [ev] });
    }
    return out;
  });

  readonly label = eventLabel;

  async more(): Promise<void> {
    this.busy.set(true);
    try {
      await this.live.loadMore();
    } finally {
      this.busy.set(false);
    }
  }
}
