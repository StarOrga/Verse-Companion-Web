import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { HQ_SPOT_NAME_MAX, HqSpot, HqSpotsService } from './hq-spots.service';

/** HQ "Spots": the reader's saved spots from the desktop app, renamed or deleted here. */
@Component({
  selector: 'sc-hq-spots',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScActionDirective, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header
      [eyebrow]="'hq.title' | translate"
      [title]="'hq.spots.title' | translate"
      [subtitle]="'hq.spots.subtitle' | translate" />

    @if (svc.writeError(); as key) {
      <p class="sc-card notice" role="alert">{{ key | translate }}</p>
    }

    @if (svc.loadError(); as key) {
      <div class="sc-card state" role="alert">
        <p>{{ key | translate }}</p>
        <button type="button" scAction tier="secondary" [busy]="svc.loading()" (click)="svc.load()">
          {{ 'hq.spots.retry' | translate }}
        </button>
      </div>
    } @else if (!svc.loaded()) {
      <div class="sc-card state" role="status"><p>{{ 'hq.spots.loading' | translate }}</p></div>
    } @else if (svc.spots().length === 0) {
      <div class="sc-card state" role="status">
        <p>{{ 'hq.spots.empty' | translate }}</p>
      </div>
    } @else {
      <ul class="list">
        @for (s of svc.spots(); track s.id) {
          <li class="sc-card row">
            <div class="main">
              @if (editing() === s.id) {
                <form class="edit" (submit)="$event.preventDefault(); save(s, nameInput.value)">
                  <input
                    #nameInput
                    class="sc-input"
                    type="text"
                    [value]="s.name"
                    [attr.maxlength]="nameMax"
                    [attr.aria-label]="'hq.spots.nameLabel' | translate"
                    (keydown.escape)="editing.set(null)" />
                  <button type="submit" scAction tier="secondary" [busy]="busy() === s.id">{{ 'hq.spots.save' | translate }}</button>
                  <button type="button" scAction tier="secondary" (click)="editing.set(null)">{{ 'hq.spots.cancel' | translate }}</button>
                </form>
              } @else {
                <h2 class="name">{{ s.name }}</h2>
              }
              @if (location(s); as loc) {
                <p class="loc">{{ loc }}</p>
              }
              @if (s.note) {
                <p class="note">{{ s.note }}</p>
              }
              <p class="meta">{{ 'hq.spots.created' | translate: { date: (s.created_at | scDate) } }}</p>
            </div>
            @if (editing() !== s.id) {
              <div class="acts">
                <button type="button" scAction tier="secondary" [disabled]="busy() === s.id" (click)="editing.set(s.id)">
                  {{ 'hq.spots.rename' | translate }}
                </button>
                <button type="button" scAction tier="secondary" tone="danger" [busy]="busy() === s.id" (click)="remove(s)">
                  {{ 'hq.spots.delete' | translate }}
                </button>
              </div>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-3); }
      .row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--sc-space-3); padding: var(--sc-space-4); }
      .main { flex: 1 1 16rem; min-width: 0; display: flex; flex-direction: column; gap: var(--sc-space-1); }
      .name { margin: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
      .loc, .note, .meta { margin: 0; overflow-wrap: anywhere; }
      .loc { color: var(--sc-fg-2); }
      .note { white-space: pre-wrap; }
      .meta { color: var(--sc-fg-3, var(--sc-fg-2)); font-size: max(0.85rem, var(--sc-fs-floor)); }
      .acts, .edit { display: flex; flex-wrap: wrap; gap: var(--sc-space-2); align-items: center; }
      .edit .sc-input { flex: 1 1 12rem; min-width: 0; }
      .state, .notice { padding: var(--sc-space-4); max-width: var(--sc-measure, 68ch); margin-bottom: var(--sc-space-3); }
      .state { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sc-space-3); }
      .state p, .notice { margin: 0; color: var(--sc-fg-2); }
      .notice { color: var(--sc-danger); }
    `,
  ],
})
export class HqSpotsComponent {
  protected readonly svc = inject(HqSpotsService);
  private readonly confirmer = inject(ScConfirmService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly nameMax = HQ_SPOT_NAME_MAX;
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);

  constructor() {
    void this.svc.load();
  }

  protected location(s: HqSpot): string {
    return [s.system_code, s.parent_body].filter((p) => !!p?.trim()).join(' · ');
  }

  protected async save(s: HqSpot, value: string): Promise<void> {
    const name = value.trim();
    if (!name) return;
    if (name === s.name) {
      this.editing.set(null);
      return;
    }
    this.busy.set(s.id);
    const ok = await this.svc.rename(s.id, name);
    this.busy.set(null);
    if (ok) {
      this.editing.set(null);
      this.analytics.track('hq:spot_rename');
    }
  }

  protected async remove(s: HqSpot): Promise<void> {
    const yes = await this.confirmer.confirm({
      titleKey: 'hq.spots.deleteTitle',
      messageKey: 'hq.spots.deleteMessage',
      params: { name: s.name },
      confirmKey: 'hq.spots.delete',
      tone: 'danger',
    });
    if (!yes) return;
    this.busy.set(s.id);
    const ok = await this.svc.remove(s.id);
    this.busy.set(null);
    if (ok) this.analytics.track('hq:spot_delete');
  }
}
