import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  booleanAttribute,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';
import { logWarn } from '../../core/log';
import { RouteLoadRecoveryService } from '../../core/route-load-recovery.service';
import { ScActionDirective } from '../action/sc-action.directive';

/** Sources already reported in this document — one `$exception` per block kind. */
const reported = new Set<string>();

/**
 * The `@error` branch of a `@defer` block whose lazy chunk did not load (#367).
 *
 * Typical cause: a tab still running a superseded build asks for a chunk name
 * that no longer exists (the SPA rewrite answers index.html, the module fails
 * its MIME check) or the network dropped for a moment. Without an `@error`
 * branch Angular throws NG0750 and the block keeps its placeholder forever.
 *
 * On render it hands the failure to {@link RouteLoadRecoveryService}, which
 * reloads the page once per session while the reader has not interacted yet,
 * and reports it to PostHog as handled. Visible form: a short hint with a
 * reload action, centred in whatever box the host class gives it (pass the
 * viewer's own size class, e.g. `class="pkg-viewer"`). `quiet` renders nothing
 * — for decorative blocks (the shell scene, landing tiles) whose fallback is
 * already on screen.
 *
 *   @error { <sc-defer-error source="codex.pkg" class="pkg-viewer" /> }
 */
@Component({
  selector: 'sc-defer-error',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.quiet]': 'quiet()' },
  template: `
    @if (!quiet()) {
      <p class="msg" role="status">{{ messageKey() | translate }}</p>
      <button type="button" scAction tier="secondary" (click)="reload()">
        {{ 'common.deferError.reload' | translate }}
      </button>
    }
  `,
  styles: [`
    :host {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--sc-space-2); padding: var(--sc-space-3);
      text-align: center; color: var(--sc-fg-2);
    }
    :host(.quiet) { display: none; }
    .msg { margin: 0; font-size: max(0.8rem, var(--sc-fs-floor)); line-height: 1.4; }
  `],
})
export class DeferErrorComponent {
  /** Which block failed — logged and reported, never shown. */
  readonly source = input.required<string>();
  readonly quiet = input(false, { transform: booleanAttribute });
  /** The hint's i18n key — the 3D view by default. */
  readonly messageKey = input('common.deferError.message');
  /** Emitted once after the error state rendered, for the host's own fallback. */
  readonly failed = output<void>();

  private readonly recovery = inject(RouteLoadRecoveryService);
  private readonly analytics = inject(AnalyticsService);

  constructor() {
    // After render: the host's handler writes signals its own template already read.
    afterNextRender(() => {
      const source = this.source();
      logWarn('defer', 'chunk failed to load', { source });
      this.report(source);
      this.failed.emit();
      this.recovery.recoverFromStaleChunk();
    });
  }

  reload(): void {
    this.recovery.reload();
  }

  private report(source: string): void {
    if (reported.has(source)) return;
    reported.add(source);
    const err = new Error(`NG0750 defer chunk failed: ${source}`);
    err.name = 'DeferLoadError';
    try {
      this.analytics.captureException(err, { handled: true, defer_source: source });
    } catch {
      // Reporting must never break the error state.
    }
  }
}
