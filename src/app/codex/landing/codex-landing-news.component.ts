import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { PatchSummaryView } from './codex-landing-data.types';

/**
 * News button of the Codex landing (round 6, d1-s5): the KI patch summary of
 * the current build. The dot marks a summary this user has not opened yet
 * (per patch, stored in the profile — the data service owns that state).
 */
@Component({
  selector: 'sc-codex-landing-news',
  standalone: true,
  imports: [TranslatePipe, ScPopupComponent, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary(); as s) {
      <button type="button" class="news" [class.on]="open()" [attr.aria-expanded]="open()" aria-haspopup="dialog"
              [attr.aria-label]="'codex.landing.news.open' | translate: { patch: s.patchVersion }" (click)="toggle()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>
        @if (unread()) { <i class="dot"></i><span class="sc-sr-only">{{ 'codex.landing.news.unread' | translate }}</span> }
        <span aria-hidden="true">{{ 'codex.landing.news.button' | translate }}</span> <b aria-hidden="true">{{ s.patchVersion }}</b>
      </button>
      @if (open()) {
        <sc-popup class="pop" kind="panel" [title]="'codex.landing.news.title' | translate: { patch: s.patchVersion }"
                  [eyebrow]="'codex.title' | translate" (closed)="open.set(false)">
          <ul>
            @for (line of s.lines; track $index) { <li><b aria-hidden="true">›</b><span>{{ line }}</span></li> }
          </ul>
          <ng-container popupActions>
            <a scAction [href]="s.patchNotesUrl" target="_blank" rel="noopener noreferrer">
              {{ (s.patchNotesIsThread ? 'codex.landing.news.notes' : 'codex.landing.news.notesOverview') | translate }} <i aria-hidden="true">↗</i>
            </a>
          </ng-container>
        </sc-popup>
      }
    }
  `,
  styles: [
    `
      :host { position: relative; display: block; }
      .news {
        position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 14px 0 12px;
        border-radius: 999px; border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); background: color-mix(in srgb, var(--sc-bg-1) 72%, transparent); cursor: pointer;
        font: 600 max(10px, 0.62rem) var(--sc-font-display); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-1);
      }
      .news svg { width: 15px; height: 15px; color: var(--sc-accent); }
      .news b { font: 400 12px var(--font-monospace, 'Share Tech Mono', monospace); letter-spacing: 0; color: var(--sc-fg-0); }
      .news:hover, .news.on { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .news.on { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
      .news:focus-visible { outline: 1px solid transparent; outline-offset: 0; box-shadow: var(--sc-focus-ring); }
      .dot {
        position: absolute; top: 6px; left: 22px; width: 8px; height: 8px; border-radius: 50%;
        background: var(--sc-accent); box-shadow: 0 0 0 2px var(--sc-bg-0), 0 0 10px color-mix(in srgb, var(--sc-accent) 90%, transparent);
      }
      /* Positioned at its trigger; width and frame come from sc-popup. */
      .pop { position: absolute; right: 0; top: calc(100% + 10px); z-index: 8; }
      /* Phone: the popup frame is fixed full-screen; lift the wrapper onto the popup layer (above the shell header). */
      @media (max-width: 720px) { .pop { z-index: var(--sc-popup-z, 1300); } }
      ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
      li { display: flex; gap: 10px; padding: 8px 6px; font-size: 13px; line-height: 1.35; color: var(--sc-fg-0); }
      li b { flex: 0 0 14px; font-weight: 400; text-align: center; color: var(--sc-accent); }
      @media (max-width: 720px) {
        .news { min-height: 32px; padding: 0 10px; font-size: 9px; }
        .dot { top: 4px; left: 18px; }
      }
    `,
  ],
})
export class CodexLandingNewsComponent {
  readonly summary = input<PatchSummaryView | null>(null);
  readonly unread = input(false);
  /** Fired the first time the popover opens (the landing marks the patch seen). */
  readonly opened = output<void>();
  readonly open = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const onDown = (ev: PointerEvent) => {
      if (this.open() && ev.target instanceof Node && !host.contains(ev.target)) this.open.set(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('pointerdown', onDown, true));
  }

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) this.opened.emit();
  }
}
