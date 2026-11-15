import { toErrorKey } from '../core/describe-error';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { SupabaseClientProvider } from '../core/supabase.client';
import { RoleService } from '../auth/role.service';
import { AuthService } from '../auth/auth.service';
import { P4kHistoryComponent, compareVersion } from '../p4k/p4k-history.component';
import { P4kBundleRow, P4kService } from '../p4k/p4k.service';
import { SilhouetteCoverageComponent } from '../admin/silhouette-coverage.component';
import { AppDownloadEntry, AppDownloadPanelComponent } from './app-download-panel.component';
import { DOWNLOAD_RING, ReleaseRing } from './desktop-access';
import { DesktopReleaseService, ReleaseInfo, hashFingerprint } from './desktop-release.service';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

/**
 * The Data Upload page (`/apps/uploader`), rebuilt after the concept direction
 * "Zeitleiste" (2026-11-15, B4.1): a head strip — the SHARED
 * `sc-app-download-panel` (same panel as the Starscape download), the current
 * build and, for admins, the Holotable silhouette coverage (moved here from
 * Admin → Benutzer, B4.2) — then the setup steps, which fold away once the
 * reader has uploaded anything (B4.3), and the bundle history INLINE as the
 * page's spine (no popup any more). The page is admin + collaborator, so its
 * accent is copper; the admin-only parts (coverage, promote row, history
 * actions) carry the admin red edge, never a visible "Nur Admin" (B4.10).
 */
@Component({
  selector: 'sc-desktop-download',
  standalone: true,
  imports: [
    ScDatePipe,
    TranslatePipe,
    DecimalPipe,
    P4kHistoryComponent,
    SilhouetteCoverageComponent,
    AppDownloadPanelComponent,
    ScActionDirective,
    ScSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="uploader">
      <header class="u-head">
        <span class="u-eyebrow">{{ 'desktop.historyEyebrow' | translate }}</span>
        <h1>{{ 'desktop.title' | translate }}</h1>
        <p class="hint">{{ 'desktop.subtitle' | translate }}</p>
      </header>

      @if (errorMsg()) {
        <div class="err" role="alert">{{ errorMsg()! | translate }}</div>
      }

      <div class="strip" [class.with-cov]="roles.isAdmin()">
        <sc-app-download-panel
          class="strip-app"
          app="uploader"
          icon="⬆"
          [title]="'desktop.appTitle'"
          desc="desktop.appDesc"
          [version]="release()?.version ?? null"
          [entries]="entries()"
          [busy]="busy()"
          [notes]="notes"
          [releaseNotes]="release()?.notes ?? null" />

        <div class="sc-card tile build-tile">
          <span class="k">{{ 'desktop.build.title' | translate }}</span>
          @if (currentBuild(); as b) {
            <span class="big">{{ b.patch_version }} <small>{{ b.channel.toUpperCase() }}</small></span>
            <span class="s mono">{{ b.build_number || '—' }} · {{ 'desktop.build.since' | translate: { date: (b.created_at | scDate) } }}</span>
            <div class="qbar" role="img" [attr.aria-label]="'desktop.build.quality' | translate: { q: b.quality_score ?? '—' }">
              <i [style.width.%]="b.quality_score ?? 0"></i>
            </div>
            <span class="s">{{ 'desktop.build.quality' | translate: { q: b.quality_score !== null ? (b.quality_score | number: '1.0-0') : '—' } }}</span>
          } @else {
            <span class="s">{{ 'desktop.build.none' | translate }}</span>
          }
          @if (release(); as r) {
            <span class="s rel-when">{{ 'desktop.released' | translate }} · v{{ r.version }} · {{ r.created_at | scDate }}</span>
          }
        </div>

        @if (roles.isAdmin()) {
          <!-- Admin-only (the RPC is admin-only): red edge, no visible words. -->
          <sc-silhouette-coverage class="strip-cov" access="admin" />
        }
      </div>

      <!-- Setup: open and unmarked until this reader has uploaded anything (P12),
           then folded to one line with every step ticked (r1-d4-spalten-a1). -->
      <details class="sc-card steps" [open]="!hasUploaded()">
        <summary>
          <span class="steps-t">{{ 'desktop.steps.title' | translate }}</span>
          @if (hasUploaded()) {
            <span class="steps-done">{{ 'desktop.steps.done' | translate }}</span>
          }
        </summary>
        <ol>
          @for (step of steps; track step; let i = $index) {
            <li [class.ok]="hasUploaded()">
              <b aria-hidden="true">{{ hasUploaded() ? '✓' : i + 1 }}</b>
              <span>{{ step | translate }}</span>
              @if (hasUploaded()) { <span class="sc-sr-only">({{ 'desktop.steps.doneSr' | translate }})</span> }
            </li>
          }
        </ol>
      </details>

      <!-- The bundle history is the page's spine — inline, no popup (#8, B4.1). -->
      <sc-p4k-history [embedded]="true" [timeline]="true" class="spine" />

      <!-- Admin-only inline promotion (feedback 446c245e): pick a ring, see its
           version, roll it forward — no separate admin page. The download above
           is always stable, so the promote row reads its source ring itself.
           The server-side RPC also enforces admin + monotonicity, so this is a
           convenience gate. -->
      @if (roles.isAdmin()) {
        <div class="promote">
          <span class="sc-sr-only">{{ 'common.popup.access.admin' | translate }}</span>
          <span class="pl">{{ 'desktop.promote.from' | translate }}</span>
          <sc-select
            class="psel"
            [options]="promoteOptions"
            [allowEmpty]="false"
            [value]="promoteSource()"
            [disabled]="promoting()"
            [ariaLabel]="'desktop.promote.from' | translate"
            (valueChange)="onPromoteSource($event)"
          />
          @if (sourceRelease(); as r) {
            <span class="pver">v{{ r.version }}</span>
            <span class="pl">{{ 'desktop.promote.label' | translate }}</span>
            <sc-select
              class="psel"
              [options]="promoteOptions"
              [allowEmpty]="false"
              [value]="promoteTarget()"
              [disabled]="promoting()"
              [ariaLabel]="'desktop.promote.label' | translate"
              (valueChange)="onPromoteTarget($event)"
            />
            <button type="button" scAction tier="secondary" tone="hot" [busy]="promoting()" [disabled]="promoting()" (click)="promote(r.version)">
              {{ 'desktop.promote.action' | translate }}
            </button>
          }
          @if (promoteMsg(); as m) {
            <span class="pmsg" [class.err]="m.kind === 'error'">{{ m.text | translate }}</span>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    /* The full page frame (styles.scss, "PAGE FRAME") — no width of its own. */
    .uploader { display: flex; flex-direction: column; gap: var(--sc-space-4); }
    /* Admin + collaborator page: copper eyebrow and rule (CLAUDE.md colour rule). */
    .u-head {
      display: flex; flex-direction: column; gap: 4px;
      padding-bottom: var(--sc-space-3);
      border-bottom: 1px solid color-mix(in srgb, var(--sc-accent-collab) 45%, transparent);
    }
    .u-eyebrow {
      font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.16em; text-transform: uppercase;
      font-weight: 600; color: var(--sc-accent-collab);
    }
    .u-head h1 { margin: 0; }
    .u-head .hint { color: var(--sc-fg-2); margin: 0; }

    /* Head strip (spec d4-zeit .fb-strip2): app · build · coverage. */
    .strip { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: var(--sc-space-3); align-items: stretch; }
    .strip.with-cov { grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.8fr) minmax(0, 1.4fr); }
    .tile { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
    .k { font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); }
    .big { font-family: var(--sc-font-display); font-size: 1.6rem; font-weight: 700; color: var(--sc-fg-0); line-height: 1; }
    .big small { font-family: inherit; font-size: 0.8rem; font-weight: 500; color: var(--sc-fg-2); margin-left: 4px; }
    .s { color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .mono { font-family: monospace; }
    .qbar { position: relative; height: 6px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); }
    .qbar i { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: var(--sc-success); }
    @media (max-width: 1100px) {
      .strip.with-cov { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .strip-cov { grid-column: 1 / -1; }
    }
    @media (max-width: 720px) {
      .strip, .strip.with-cov { grid-template-columns: minmax(0, 1fr); }
    }

    /* Setup steps (spec d4-spalten .fb-steps). */
    .steps { padding: 0; }
    .steps summary {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 12px 16px; cursor: pointer; min-height: max(44px, var(--sc-tap-min));
    }
    .steps-t { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-1); }
    .steps-done { color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .steps ol { list-style: none; margin: 0; padding: 0 16px 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .steps li {
      display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px;
      border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); font-size: 0.86rem;
    }
    .steps li b {
      flex: none; width: 22px; height: 22px; border-radius: 11px; display: grid; place-items: center;
      border: 1px solid color-mix(in srgb, var(--sc-accent-collab) 55%, transparent); color: var(--sc-accent-collab); font-size: 0.72rem;
    }
    .steps li.ok b { background: var(--sc-accent-collab); color: var(--sc-bg-0); }
    @media (max-width: 720px) { .steps ol { grid-template-columns: minmax(0, 1fr); } }

    .spine { display: block; }
    .spine ::ng-deep .hist-body { border: 1px solid var(--sc-border); border-radius: 12px; overflow: hidden; background: var(--sc-bg-1); }
    .err {
      padding: var(--sc-space-3) var(--sc-space-4);
      background: color-mix(in srgb, var(--sc-danger) 10%, transparent);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }

    .rel-when { letter-spacing: 0.04em; }

    /* Admin-only inline promote row (feedback 446c245e) — the admin red edge (spec .fb-prom). */
    .promote {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 10px 14px; border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--sc-accent-hot) 40%, transparent);
      border-left: 3px solid var(--sc-accent-hot);
      background: color-mix(in srgb, var(--sc-accent-hot) 6%, transparent);
    }
    .promote .pl {
      color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor));
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .promote .psel { min-inline-size: 9rem; }
    .promote .pver { font-variant-numeric: tabular-nums; color: var(--sc-fg-1); }
    .promote .pmsg { font-size: 0.8rem; color: var(--sc-accent); }
    .promote .pmsg.err { color: var(--sc-danger); }

  `],
})
export class DesktopDownloadComponent {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly releases = inject(DesktopReleaseService);
  readonly roles = inject(RoleService);
  private readonly p4k = inject(P4kService);
  private readonly auth = inject(AuthService);

  readonly release = signal<ReleaseInfo | null>(null);
  readonly busy = signal(false);
  /** i18n key, never raw text. */
  readonly errorMsg = signal<string | null>(null);

  readonly steps = ['desktop.steps.s1', 'desktop.steps.s2', 'desktop.steps.s3'] as const;

  /** Has this reader ever uploaded a bundle? Then the setup folds away (P12). */
  readonly hasUploaded = computed(() => {
    const id = this.auth.user()?.id;
    return !!id && this.p4k.bundles().some((b) => b.uploaded_by_id === id);
  });

  /** The bundle the codex uses now: newest active LIVE upload of the highest patch, else any channel. */
  readonly currentBuild = computed<P4kBundleRow | null>(() => currentBundle(this.p4k.bundles()));

  /** Platform caveat + where beta/alpha went, kept behind the panel's ⓘ toggle. */
  readonly notes = ['desktop.access.note', 'appMenu.prerelease'] as const;

  // Admin-only inline release promotion (feedback 446c245e).
  /** Ring whose current version the admin is about to roll forward. */
  readonly promoteSource = signal<ReleaseRing>('alpha');
  readonly sourceRelease = signal<ReleaseInfo | null>(null);
  readonly promoteTarget = signal<ReleaseRing>('beta');
  readonly promoting = signal(false);
  /** `text`: an i18n key on error, the plain `vX → ring` line on success (the pipe passes it through). */
  readonly promoteMsg = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  readonly promoteOptions: readonly ScSelectOption[] = (['alpha', 'beta', 'stable'] as const).map(
    (c) => ({ value: c, labelKey: 'desktop.channel.' + c }),
  );

  readonly entries = computed<AppDownloadEntry[]>(() =>
    Object.entries(this.release()?.platforms ?? {}).map(([key, value]) => ({
      key,
      label: key,
      url: value.url,
      sizeBytes: value.size_bytes,
      hash: hashFingerprint(value),
    })),
  );

  constructor() {
    // The download is always the stable ring — beta/alpha are picked inside the
    // app after sign-in (DOWNLOAD_RING). Only the admin promote row reads others.
    void this.load();
    effect(() => {
      if (this.roles.isAdmin()) void this.loadSource(this.promoteSource());
    });
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { release, error } = await this.releases.forChannel(DOWNLOAD_RING);
    if (error) this.errorMsg.set(error);
    else this.release.set(release);
    this.busy.set(false);
  }

  private async loadSource(ring: ReleaseRing): Promise<void> {
    const { release } = await this.releases.forChannel(ring);
    // Latest-wins: a slower reply for a ring the admin already left is dropped.
    if (this.promoteSource() !== ring) return;
    this.sourceRelease.set(release);
  }

  onPromoteSource(value: string | null): void {
    if (value === null) return;
    this.sourceRelease.set(null);
    this.promoteSource.set(value as ReleaseRing);
    this.promoteMsg.set(null);
  }

  onPromoteTarget(value: string | null): void {
    if (value === null) return;
    this.promoteTarget.set(value as ReleaseRing);
    this.promoteMsg.set(null);
  }

  /**
   * Roll the source ring's version forward to the selected ring via
   * `promote_desktop_channel`. Admin + monotonicity are enforced server-side;
   * any violation surfaces inline. Both the stable download and the source row
   * are re-read on success so the new pointers show immediately.
   */
  async promote(version: string): Promise<void> {
    this.promoting.set(true);
    this.promoteMsg.set(null);
    const to = this.promoteTarget();
    const { error } = await this.sb.client.rpc('promote_desktop_channel', {
      p_version: version,
      p_to_channel: to,
    });
    if (error) {
      this.promoteMsg.set({ kind: 'error', text: toErrorKey('desktop', 'promote', error, { version, to }) });
    } else {
      this.promoteMsg.set({ kind: 'success', text: `v${version} → ${to}` });
      await Promise.all([this.load(), this.loadSource(this.promoteSource())]);
    }
    this.promoting.set(false);
  }
}

function currentBundle(bundles: readonly P4kBundleRow[]): P4kBundleRow | null {
  const active = bundles.filter((b) => !b.disabled);
  const pool = active.some((b) => b.channel === 'live') ? active.filter((b) => b.channel === 'live') : active;
  let best: P4kBundleRow | null = null;
  for (const b of pool) {
    if (!best) { best = b; continue; }
    const v = compareVersion(b.patch_version, best.patch_version);
    if (v > 0 || (v === 0 && b.created_at > best.created_at)) best = b;
  }
  return best;
}
