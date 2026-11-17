import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { TranslationPass, TranslationSource, TranslationsService } from './translations.service';
import { canImportSource, coverageText, jobErrorKey, passProgress } from './translations.logic';
import { TRANSLATIONS_TAB_STYLES } from './translations-shared.styles';

/** How often the list of background passes is read again while one is running. */
const PASS_POLL_MS = 5000;

/**
 * Quellen tab: community packs with licence, status, coverage and last sync.
 * Import / sync / learn only start a background pass in the orchestrator (it runs
 * in slices); the passes block below the table shows where each one stands. Import
 * is only enabled once the licence is clear (licensed / permitted).
 */
@Component({
  selector: 'sc-translation-sources',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <div class="block-head">
        <h2>{{ 'admin.translations.sources.title' | translate }}</h2>
        <button scAction type="button" [busy]="busyKey() === 'sync'" [disabled]="busy()" (click)="sync()">
          {{ 'admin.translations.sources.syncAll' | translate }}
        </button>
      </div>
      <p class="hint">{{ 'admin.translations.sources.intro' | translate }}</p>

      @if (error()) {
        <div class="state error" role="alert">
          <p>{{ error()! | translate }}</p>
          <button scAction type="button" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
        </div>
      } @else if (loading()) {
        <p class="hint" role="status">{{ 'admin.translations.loading' | translate }}</p>
      } @else if (sources().length === 0) {
        <p class="hint">{{ 'admin.translations.sources.empty' | translate }}</p>
      } @else {
        <div class="sc-table-scroll">
          <table class="src">
            <thead>
              <tr>
                <th>{{ 'admin.translations.sources.cols.lang' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.name' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.license' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.status' | translate }}</th>
                <th class="num">{{ 'admin.translations.sources.cols.coverage' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.synced' | translate }}</th>
                <th>{{ 'admin.translations.sources.cols.folder' | translate }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (s of sources(); track s.id) {
                <tr>
                  <td>{{ s.lang }}</td>
                  <td>{{ s.name }}</td>
                  <td>
                    {{ s.license ?? '—' }}
                    <span class="hint">{{ 'admin.translations.sources.kinds.' + s.license_kind | translate }}</span>
                  </td>
                  <td>
                    <span class="pill" [class.ok]="canImport(s.status)" [class.warn]="s.status === 'awaiting_permission'" [class.bad]="s.status === 'refused'">
                      {{ 'admin.translations.sources.status.' + s.status | translate }}
                    </span>
                  </td>
                  <td class="num">{{ coverage(s) === null ? '—' : coverage(s) + ' %' }}</td>
                  <td>{{ s.last_synced_at ? (s.last_synced_at | scDate: 'datetime') : ('admin.translations.sources.never' | translate) }}</td>
                  <td class="mono">{{ s.game_folder ?? '—' }}</td>
                  <td class="actions">
                    <span class="tip-wrap" [scTooltip]="canImport(s.status) ? '' : ('admin.translations.sources.importLocked' | translate)"
                          scTooltipTier="label" [scTooltipDisabled]="canImport(s.status)">
                      <button scAction type="button" [busy]="busyKey() === 'import:' + s.id"
                              [disabled]="busy() || !canImport(s.status)" (click)="importSeed(s)">
                        {{ 'admin.translations.sources.import' | translate }}
                      </button>
                    </span>
                    <button scAction type="button" [busy]="busyKey() === 'learn:' + s.id" [disabled]="busy()" (click)="learn(s)">
                      {{ 'admin.translations.sources.learn' | translate }}
                    </button>
                    <button scAction type="button" [busy]="busyKey() === 'draft:' + s.id" [disabled]="busy()" (click)="draft(s)">
                      {{ 'admin.translations.sources.draft' | translate }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.err" role="status">{{ f.key | translate: f.params }}</p>
    }

    <section class="sc-card block" data-test="passes">
      <div class="block-head">
        <h2>{{ 'admin.translations.passes.title' | translate }}</h2>
      </div>
      <p class="hint">{{ 'admin.translations.passes.intro' | translate }}</p>
      @if (passError()) {
        <div class="state error" role="alert">
          <p>{{ passError()! | translate }}</p>
          <button scAction type="button" (click)="loadPasses()">{{ 'admin.translations.retry' | translate }}</button>
        </div>
      } @else if (passes().length === 0) {
        <p class="hint" data-test="passes-empty">{{ 'admin.translations.passes.empty' | translate }}</p>
      } @else {
        <div class="sc-table-scroll">
          <table class="src">
            <thead>
              <tr>
                <th>{{ 'admin.translations.passes.cols.kind' | translate }}</th>
                <th>{{ 'admin.translations.passes.cols.lang' | translate }}</th>
                <th>{{ 'admin.translations.passes.cols.source' | translate }}</th>
                <th>{{ 'admin.translations.passes.cols.state' | translate }}</th>
                <th>{{ 'admin.translations.passes.cols.updated' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (p of passes(); track p.id) {
                <tr>
                  <td>{{ 'admin.translations.passes.kinds.' + p.kind | translate }}</td>
                  <td>{{ p.lang }}</td>
                  <td>{{ p.source_id ?? '—' }}</td>
                  <td>
                    <span class="pill" [class.ok]="p.status === 'done'" [class.warn]="p.status === 'open'" [class.bad]="p.status === 'failed'">
                      {{ 'admin.translations.passes.status.' + p.status | translate }}
                    </span>
                    @if (p.status === 'open') {
                      <span class="hint">
                        {{ 'admin.translations.passes.phases.' + p.phase | translate }}@if (progress(p) !== null) { · {{ progress(p) }} % }
                      </span>
                    } @else if (p.status === 'failed') {
                      <span class="hint">{{ errorKey(p.error) | translate }}</span>
                    }
                  </td>
                  <td>{{ p.updated_at | scDate: 'datetime' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: [
    TRANSLATIONS_TAB_STYLES,
    `
      .src { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
      .src th, .src td { text-align: start; padding: var(--sc-space-2) var(--sc-space-3); border-bottom: 1px solid var(--sc-border); vertical-align: middle; }
      .src .num { text-align: end; font-variant-numeric: tabular-nums; }
      .src .actions { display: flex; gap: var(--sc-space-2); flex-wrap: wrap; }
      .src .pill + .hint { margin-inline-start: var(--sc-space-2); }
    `,
  ],
})
export class TranslationSourcesComponent implements OnInit {
  private readonly svc = inject(TranslationsService);
  private readonly confirmSvc = inject(ScConfirmService);
  private readonly zone = inject(NgZone);

  readonly sources = signal<TranslationSource[]>([]);
  readonly passes = signal<TranslationPass[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly passError = signal<string | null>(null);
  readonly busyKey = signal<string | null>(null);
  readonly flash = signal<{ key: string; params?: Record<string, unknown>; err: boolean } | null>(null);

  readonly canImport = canImportSource;
  readonly coverage = (s: TranslationSource) => coverageText(s.coverage);
  readonly progress = passProgress;
  readonly errorKey = (code: string | null) => jobErrorKey(code) ?? 'admin.translations.jobErrors.unknown';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  busy(): boolean {
    return this.busyKey() !== null;
  }

  ngOnInit(): void {
    void this.load();
    void this.loadPasses();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.sources.set(await this.svc.listSources());
    } catch (e) {
      this.error.set(toErrorKey('admin-translations', 'sources-load', e));
    } finally {
      this.loading.set(false);
    }
  }

  /** Reads the passes; while one runs it is read again every few seconds, and a finished import refreshes the sources. */
  async loadPasses(): Promise<void> {
    this.stopPolling();
    const wasOpen = new Set(this.passes().filter((p) => p.status === 'open' && p.kind === 'seed').map((p) => p.id));
    try {
      const rows = await this.svc.listPasses();
      this.passes.set(rows);
      this.passError.set(null);
      if (rows.some((p) => wasOpen.has(p.id) && p.status !== 'open')) void this.load();
      // Outside the zone: a timer inside it would keep the app from ever becoming stable.
      if (rows.some((p) => p.status === 'open')) {
        this.zone.runOutsideAngular(() => {
          this.timer = setTimeout(() => this.zone.run(() => void this.loadPasses()), PASS_POLL_MS);
        });
      }
    } catch (e) {
      this.passError.set(toErrorKey('admin-translations', 'passes-load', e));
    }
  }

  private stopPolling(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run<T>(busyKey: string, op: string, fn: () => Promise<T>, done: (r: T) => void): Promise<void> {
    this.busyKey.set(busyKey);
    this.flash.set(null);
    try {
      done(await fn());
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const key = code?.startsWith('translate.') ? jobErrorKey(code) : null;
      this.flash.set({ key: key ?? toErrorKey('admin-translations', op, e), err: true });
    } finally {
      this.busyKey.set(null);
    }
  }

  async importSeed(s: TranslationSource): Promise<void> {
    if (!canImportSource(s.status)) return;
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.sources.importTitle',
      messageKey: 'admin.translations.sources.importText',
      params: { name: s.name, lang: s.lang },
      confirmKey: 'admin.translations.sources.import',
    });
    if (!ok) return;
    await this.run(
      'import:' + s.id,
      'import-seed',
      () => this.svc.importSeed(s.id),
      () => {
        this.flash.set({ key: 'admin.translations.sources.importStarted', params: { name: s.name }, err: false });
        void this.loadPasses();
      },
    );
  }

  async sync(): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.sources.syncTitle',
      messageKey: 'admin.translations.sources.syncText',
      confirmKey: 'admin.translations.sources.syncAll',
    });
    if (!ok) return;
    await this.run(
      'sync',
      'sync-sources',
      () => this.svc.syncSources(),
      (r) => {
        const errors = Array.isArray(r.errors) ? r.errors.length : Number(r.errors) || 0;
        this.flash.set({ key: 'admin.translations.sources.synced', params: { checked: r.checked, changed: r.changed, errors }, err: false });
        void this.loadPasses();
      },
    );
  }

  async learn(s: TranslationSource): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.sources.learnTitle',
      messageKey: 'admin.translations.sources.learnText',
      params: { lang: s.lang },
      confirmKey: 'admin.translations.sources.learn',
    });
    if (!ok) return;
    await this.run(
      'learn:' + s.id,
      'learn',
      () => this.svc.learn(s.lang),
      () => {
        this.flash.set({ key: 'admin.translations.sources.learnStarted', params: { lang: s.lang }, err: false });
        void this.loadPasses();
      },
    );
  }

  async draft(s: TranslationSource): Promise<void> {
    await this.run(
      'draft:' + s.id,
      'draft-outreach',
      () => this.svc.draftOutreach(s.id),
      () => this.flash.set({ key: 'admin.translations.sources.drafted', params: { name: s.name }, err: false }),
    );
  }
}
