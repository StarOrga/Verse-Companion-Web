import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The Holotable "Einordnung" before a ranking exists (holodeck polish
 * 2026-10-08). The ranking compares against the WHOLE fleet, so on a first
 * visit per build that read takes a while: until it lands the panel says what
 * it is doing (never an empty chart box), a failed read offers the retry, and
 * a fleet without values says so.
 */
@Component({
  selector: 'sc-codex-holo-rank-state',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="rank-state loading" role="status" aria-live="polite">
        <!-- The chart's own hexagon as a lock ring, with the scan line of the table's loaders rising through it. -->
        <svg class="rs-radar" viewBox="0 0 100 100" aria-hidden="true">
          <polygon class="lock" points="50,6 88.1,28 88.1,72 50,94 11.9,72 11.9,28" />
          <polygon points="50,28 69.1,39 69.1,61 50,72 30.9,61 30.9,39" />
          <line class="scan" x1="12" y1="0" x2="88" y2="0" />
        </svg>
        <p>{{ 'codex.holo.stage.rankLoading' | translate }}</p>
      </div>
    } @else {
      <div class="rank-state" [attr.role]="failed() ? 'alert' : null">
        <p>{{ (failed() ? 'codex.holo.stage.rankFailed' : 'codex.holo.stage.rankEmpty') | translate }}</p>
        @if (failed()) {
          <button type="button" class="rank-retry" (click)="retry.emit()">{{ 'codex.error.retry' | translate }}</button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .rank-state { display: grid; justify-items: center; gap: 8px; padding: 18px 8px; text-align: center; border-radius: 4px;
      border: 1px dashed color-mix(in srgb, var(--sc-accent) 30%, transparent); font-size: max(12px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .rank-state p { margin: 0; line-height: 1.4; }
    .rs-radar { width: 96px; height: 96px; }
    .rs-radar polygon { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke-width: 1; }
    /* Same timing and motion as the stage's lock ring and scan line (codex-detail .skel-ring / .skel-scan). */
    .rs-radar .lock { stroke: color-mix(in srgb, var(--sc-accent) 60%, transparent); transform-origin: 50px 50px; animation: rs-lock 1.6s ease-in-out infinite; }
    .rs-radar .scan { stroke: var(--sc-accent); stroke-width: 1.5; stroke-linecap: round; animation: rs-scan 2.4s ease-in-out infinite; }
    @keyframes rs-lock { 0%, 100% { transform: scale(0.9); opacity: 0.45; } 50% { transform: scale(1); opacity: 1; } }
    @keyframes rs-scan { 0% { transform: translateY(84px); opacity: 0; } 15%, 85% { opacity: 1; } 100% { transform: translateY(16px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .rs-radar .lock { animation: none; } .rs-radar .scan { animation: none; transform: translateY(50px); } }
    .rank-retry { min-height: max(32px, var(--sc-tap-min, 0px)); padding: 5px 12px; border-radius: 3px; border: 1px solid var(--sc-border); background: none;
      color: var(--sc-fg-1); cursor: pointer; font-family: var(--sc-font-display); text-transform: uppercase; font-size: max(11px, var(--sc-fs-floor));
      letter-spacing: 0.08em; transition: border-color 160ms ease, color 160ms ease; }
    .rank-retry:hover, .rank-retry:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
  `],
})
export class CodexHoloRankStateComponent {
  readonly loading = input(false);
  readonly failed = input(false);
  readonly retry = output<void>();
}
