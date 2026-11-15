import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { ScPopupComponent } from '../../shared/popup/sc-popup.component';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import {
  API_TOKEN_SCOPES,
  ApiTokenRow,
  ApiTokenScope,
  ApiTokensService,
  CreatedToken,
} from './api-tokens.service';
import { useAutoRefresh } from '../../core/auto-refresh';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';

interface FlashMessage {
  kind: 'success' | 'error';
  text: string;
}

/** Public API documentation (readme.io). One-line change if the host moves. */
const README_IO_URL = 'https://star-citizen-companion.readme.io';

@Component({
  selector: 'sc-api-tokens',
  standalone: true,
  imports: [ScDatePipe, TranslatePipe, ScPopupComponent, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'admin.tokens.title' | translate }}</h1>
          <p class="hint">{{ 'admin.tokens.subtitle' | translate }}</p>
        </div>
      </header>

      <!--
        App connections. There is NO link between this account and the desktop
        app yet (no table, no handshake, nothing to read a status from), so this
        block is deliberately a labelled placeholder: it shows the slot and a
        "coming soon" pill instead of faking a green "connected" state.
        Admin feedback 85477aaa.
      -->
      <section class="block">
        <h2 class="block-title">{{ 'admin.tokens.connections.title' | translate }}</h2>
        <div class="sc-card conn-card">
          <div class="conn-text">
            <span class="conn-name">{{ 'admin.tokens.connections.scApp.name' | translate }}</span>
            <span class="conn-desc">{{ 'admin.tokens.connections.scApp.desc' | translate }}</span>
          </div>
          <span class="status-pill soon">{{ 'admin.tokens.connections.comingSoon' | translate }}</span>
        </div>
        <p class="hint mock-note">{{ 'admin.tokens.connections.mockNote' | translate }}</p>
      </section>

      <section class="block">
        <div class="block-head">
          <div>
            <h2 class="block-title">{{ 'admin.tokens.sectionTitle' | translate }}</h2>
            <p class="hint">{{ 'admin.tokens.sectionHint' | translate }}</p>
            <a class="docs-link" [href]="readmeUrl" target="_blank" rel="noopener noreferrer">
              {{ 'admin.tokens.docsLink' | translate }}
            </a>
          </div>
          <div class="head-actions">
            <button
              #newTokenBtn
              scAction tier="primary"
              (click)="openCreateDialog()"
              [disabled]="busy() || dialogOpen() || revealedToken() !== null">
              {{ 'admin.tokens.newToken' | translate }}
            </button>
          </div>
        </div>

      @if (flash(); as f) {
        <div class="flash" [class.error]="f.kind === 'error'" [class.success]="f.kind === 'success'">
          {{ f.text }}
        </div>
      }

      @if (loadError(); as e) {
        <div class="err">
          <strong>{{ 'admin.tokens.errorTitle' | translate }}:</strong> {{ e | translate }}
        </div>
      }

      @if (busy() && tokens().length === 0 && !loadError()) {
        <div class="sc-card empty">{{ 'admin.tokens.loading' | translate }}</div>
      } @else if (tokens().length === 0 && !busy() && !loadError()) {
        <div class="sc-card empty">{{ 'admin.tokens.empty' | translate }}</div>
      } @else if (tokens().length > 0) {
        <div class="sc-card table-card sc-table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>{{ 'admin.tokens.col.name' | translate }}</th>
              <th>{{ 'admin.tokens.col.prefix' | translate }}</th>
              <th>{{ 'admin.tokens.col.scopes' | translate }}</th>
              <th>{{ 'admin.tokens.col.lastUsed' | translate }}</th>
              <th>{{ 'admin.tokens.col.created' | translate }}</th>
              <th>{{ 'admin.tokens.col.actions' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (t of tokens(); track t.id) {
              <tr>
                <td class="name">{{ t.name }}</td>
                <td class="mono">{{ t.prefix }}…</td>
                <td>
                  <div class="scopes">
                    @for (s of t.scopes; track s) {
                      <span class="scope-pill">{{ s }}</span>
                    }
                  </div>
                </td>
                <td>
                  {{ t.last_used_at ? (t.last_used_at | scDate: 'datetime') : ('admin.tokens.neverUsed' | translate) }}
                </td>
                <td>{{ t.created_at | scDate: 'datetime' }}</td>
                <td>
                  <div class="actions">
                  <button
                    scAction tier="secondary" tone="danger"
                    (click)="revoke(t)"
                    [disabled]="busy() || revokingId() === t.id">
                    {{ (revokingId() === t.id ? 'admin.tokens.revoking' : 'admin.tokens.revoke') | translate }}
                  </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
        </div>
      }
      </section>
    </section>

    @if (dialogOpen()) {
      <sc-popup kind="dialog" access="admin" [returnFocus]="newTokenBtn"
                [eyebrow]="'admin.tokens.eyebrow' | translate" [title]="'admin.tokens.dialog.title' | translate"
                (closed)="onCreateEscape()">
        <p class="hint">{{ 'admin.tokens.dialog.subtitle' | translate }}</p>

        <form id="tok-create-form" (submit)="onCreateSubmit($event)">
          <label class="sc-float-field field">
            <input
              class="sc-input"
              type="text"
              [value]="newName()"
              (input)="newName.set(asInput($event))"
              placeholder=" "
              [disabled]="creating()"
              maxlength="80"
              required>
            <span class="sc-float-label">{{ 'admin.tokens.dialog.nameLabel' | translate }}</span>
          </label>

          <fieldset class="field scopes-field">
            <legend>{{ 'admin.tokens.dialog.scopesLabel' | translate }}</legend>
            @for (scope of allScopes; track scope) {
              <label class="scope-row">
                <input
                  type="checkbox"
                  [checked]="selectedScopes().includes(scope)"
                  (change)="toggleScope(scope, asChecked($event))"
                  [disabled]="creating()">
                <span class="scope-code">{{ scope }}</span>
                <span class="scope-desc">{{ ('admin.tokens.scopeDescriptions.' + scope) | translate }}</span>
              </label>
            }
          </fieldset>

          @if (createError(); as e) {
            <div class="err">
              <strong>{{ 'admin.tokens.dialog.errorTitle' | translate }}:</strong> {{ e | translate }}
            </div>
          }

        </form>
        <ng-container popupActions>
          <button type="submit" form="tok-create-form" scAction tier="primary" [busy]="creating()"
                  [disabled]="creating() || !canSubmit()">
            {{ (creating() ? 'admin.tokens.dialog.creating' : 'admin.tokens.dialog.create') | translate }}
          </button>
          <button type="button" scAction tier="secondary" (click)="closeCreateDialog()" [disabled]="creating()">
            {{ 'common.dialog.cancel' | translate }}
          </button>
        </ng-container>
      </sc-popup>
    }

    @if (revealedToken(); as r) {
      <sc-popup kind="dialog" access="admin" [returnFocus]="newTokenBtn"
                [eyebrow]="'admin.tokens.eyebrow' | translate" [title]="'admin.tokens.reveal.title' | translate"
                (closed)="onRevealEscape()">
        <div class="reveal-warning">
          <strong>!</strong>
          <span>{{ 'admin.tokens.reveal.warning' | translate }}</span>
        </div>

        <div class="field" role="group" aria-labelledby="tok-reveal-label">
          <span class="field-label" id="tok-reveal-label">{{ 'admin.tokens.reveal.tokenLabel' | translate }}</span>
          <div class="reveal-token-row">
            <code class="reveal-token mono">{{ r.plaintext }}</code>
            <button type="button" scAction (click)="copyToClipboard(r.plaintext)">
              {{ (copied() ? 'admin.tokens.reveal.copied' : 'admin.tokens.reveal.copy') | translate }}
            </button>
          </div>
        </div>

        <ng-container popupActions>
          <button type="button" scAction tier="primary" (click)="acknowledgeReveal()">
            {{ 'admin.tokens.reveal.ack' | translate }}
          </button>
        </ng-container>
      </sc-popup>
    }
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 20px; }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }
    .head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; max-width: 70ch; }

    .block { display: flex; flex-direction: column; gap: 12px; }
    .block-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }
    .block-title {
      margin: 0;
      font-family: var(--sc-font-display);
      font-size: 0.82rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }

    .conn-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 16px 18px;
    }
    .conn-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .conn-name { font-weight: 600; color: var(--sc-fg-0); }
    .conn-desc { color: var(--sc-fg-2); font-size: 0.86rem; max-width: 62ch; }
    .status-pill {
      flex: 0 0 auto;
      padding: 4px 12px;
      border-radius: 999px;
      font-family: var(--sc-font-display);
      font-size: max(0.68rem, var(--sc-fs-floor));
      letter-spacing: 0.1em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    /* Neutral, not green — nothing is connected, and the pill must not read as
       a success state at a glance. */
    .status-pill.soon {
      background: color-mix(in srgb, var(--sc-fg-2) 14%, transparent);
      border: 1px dashed var(--sc-border);
      color: var(--sc-fg-2);
    }
    .mock-note { font-size: 0.8rem; margin: 0; }
    .docs-link {
      display: inline-block;
      margin-top: 8px;
      color: var(--sc-accent);
      font-family: var(--sc-font-display);
      font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.06em;
      text-decoration: none;
    }
    .docs-link:hover { text-decoration: underline; }

    .flash {
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 0.88rem;
    }
    .flash.success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid var(--sc-success);
      color: var(--sc-success);
    }
    .flash.error {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
    }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 40px; }

    /* The card draws the frame; the table inside it is a real table and the
       card scrolls it sideways on a narrow screen (.sc-table-scroll). */
    .table-card { padding: 0; }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--sc-border);
      font-size: 0.88rem;
      vertical-align: middle;
    }
    .table thead th {
      background: var(--sc-bg-2);
      font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .table tbody tr:hover { background: rgba(0, 212, 255, 0.04); }
    .name { font-weight: 600; }
    .mono { font-family: 'Fira Code', Consolas, monospace; font-size: 0.82rem; color: var(--sc-fg-1); }

    .scopes { display: flex; gap: 4px; flex-wrap: wrap; }
    .scope-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: max(0.7rem, var(--sc-fs-floor));
      font-weight: 600;
      background: rgba(0, 212, 255, 0.12);
      color: var(--sc-accent);
      letter-spacing: 0.02em;
      font-family: 'Fira Code', Consolas, monospace;
    }

    .actions { display: flex; gap: 6px; flex-wrap: wrap; }

    /* Dialog frame, head, ✕, footer and width come from <sc-popup kind="dialog">. */
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 16px;
    }
    .field-label {
      font-size: max(0.78rem, var(--sc-fs-floor));
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
    }

    .scopes-field {
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      padding: 12px 14px;
      gap: 8px;
    }
    .scopes-field legend {
      font-size: max(0.78rem, var(--sc-fs-floor));
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      padding: 0 6px;
    }
    .scope-row {
      display: grid;
      grid-template-columns: auto auto 1fr;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.86rem;
      cursor: pointer;
    }
    .scope-code {
      font-family: 'Fira Code', Consolas, monospace;
      font-size: 0.82rem;
      color: var(--sc-accent);
      min-width: 130px;
    }
    .scope-desc { color: var(--sc-fg-2); font-size: 0.82rem; }

    .reveal-warning {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid var(--sc-warning);
      border-radius: 6px;
      margin: var(--sc-space-4) 0 0;
      color: var(--sc-warning);
      font-weight: 600;
      font-size: 0.92rem;
    }
    .reveal-warning strong {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--sc-warning);
      color: var(--sc-bg-0);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
    }
    .reveal-token-row {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .reveal-token {
      flex: 1;
      padding: 10px 14px;
      background: var(--sc-bg-0);
      border: 1px solid var(--sc-accent);
      border-radius: 6px;
      color: var(--sc-accent);
      font-size: 0.86rem;
      word-break: break-all;
      user-select: all;
    }

    @media (max-width: 640px) {
      .head { flex-direction: column; align-items: stretch; }
      .head-actions .sc-action { flex: 1; justify-content: center; }
      /* Checkbox in its own column, code and description stacked beside it:
         one row per scope instead of three. */
      .scope-row { grid-template-columns: auto minmax(0, 1fr); column-gap: 10px; row-gap: 0; padding: 4px 0; }
      .scope-row input { grid-row: span 2; }
      .scope-desc { grid-column: 2; }
      .scope-code { min-width: 0; }
      .reveal-token-row { flex-direction: column; }
      /* The token table scrolls inside its card instead of the page. */
      .table { min-width: 620px; }
    }
  `],
})
export class ApiTokensComponent implements OnInit {
  private readonly svc = inject(ApiTokensService);
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(ScConfirmService);

  constructor() {
    useAutoRefresh(() => this.refresh(), { enabled: () => !this.busy() });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copiedTimer));
  }

  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  readonly allScopes = API_TOKEN_SCOPES;
  readonly readmeUrl = README_IO_URL;

  readonly tokens = signal<ApiTokenRow[]>([]);
  readonly busy = signal(false);
  /** i18n key, never raw text. */
  readonly loadError = signal<string | null>(null);
  readonly flash = signal<FlashMessage | null>(null);
  readonly revokingId = signal<string | null>(null);

  readonly dialogOpen = signal(false);
  readonly newName = signal('');
  readonly selectedScopes = signal<ApiTokenScope[]>([]);
  readonly creating = signal(false);
  /** i18n key, never raw text. */
  readonly createError = signal<string | null>(null);

  readonly revealedToken = signal<CreatedToken | null>(null);
  readonly copied = signal(false);
  /** Sticky "was copied at least once" for the revealed token; `copied` only drives the 2.5 s label. */
  private readonly tokenCopied = signal(false);

  readonly canSubmit = computed(
    () => this.newName().trim().length > 0 && this.selectedScopes().length > 0,
  );

  asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  asChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    this.busy.set(true);
    this.loadError.set(null);
    try {
      const rows = await this.svc.list();
      this.tokens.set(rows);
    } catch (err) {
      this.loadError.set(toErrorKey('api-tokens', 'list', err));
    } finally {
      this.busy.set(false);
    }
  }

  openCreateDialog() {
    this.newName.set('');
    this.selectedScopes.set([]);
    this.createError.set(null);
    this.dialogOpen.set(true);
  }

  closeCreateDialog() {
    if (this.creating()) return;
    this.dialogOpen.set(false);
  }

  /** Escape in the create dialog — blocked while creating, like "Cancel". */
  onCreateEscape() {
    if (!this.creating()) this.closeCreateDialog();
  }

  /**
   * Escape in the reveal dialog closes only once the token has been copied.
   * The token is shown exactly once and the backdrop deliberately does not
   * close this dialog, so a stray Escape before copying must not discard it
   * either — a deliberate deviation from the AUD-068 fix text in favour of
   * protecting against token loss.
   */
  onRevealEscape() {
    if (this.tokenCopied()) this.acknowledgeReveal();
  }

  toggleScope(scope: ApiTokenScope, on: boolean) {
    const current = this.selectedScopes();
    if (on && !current.includes(scope)) {
      this.selectedScopes.set([...current, scope]);
    } else if (!on) {
      this.selectedScopes.set(current.filter((s) => s !== scope));
    }
  }

  async onCreateSubmit(e: Event) {
    e.preventDefault();
    if (!this.canSubmit()) return;
    this.creating.set(true);
    this.createError.set(null);
    try {
      const created = await this.svc.create(this.newName().trim(), this.selectedScopes());
      this.dialogOpen.set(false);
      this.revealedToken.set(created);
      this.copied.set(false);
      this.tokenCopied.set(false);
      await this.refresh();
    } catch (err) {
      this.createError.set(toErrorKey('api-tokens', 'create', err));
    } finally {
      this.creating.set(false);
    }
  }

  async revoke(t: ApiTokenRow) {
    const ok = await this.dialog.confirm({
      titleKey: 'admin.tokens.revokeTitle',
      messageKey: 'admin.tokens.revokeConfirm',
      params: { name: t.name },
      confirmKey: 'admin.tokens.revoke',
      tone: 'danger',
    });
    if (!ok) return;
    this.revokingId.set(t.id);
    this.flash.set(null);
    try {
      await this.svc.revoke(t.id);
      this.flash.set({
        kind: 'success',
        text: this.translate.instant('admin.tokens.revokeSuccess'),
      });
      await this.refresh();
    } catch (err) {
      this.flash.set({
        kind: 'error',
        text: `${this.translate.instant('admin.tokens.revokeError')}: ${this.translate.instant(toErrorKey('api-tokens', 'revoke', err, { tokenId: t.id }))}`,
      });
    } finally {
      this.revokingId.set(null);
    }
  }

  async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      this.tokenCopied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2500);
    } catch (err) {
      logWarn('api-tokens', 'clipboard write failed, text selected for manual copy', { err: String(err) });
      // Fallback: select the text so the user can ctrl+c manually
      const sel = window.getSelection();
      const el = document.querySelector('.reveal-token');
      if (sel && el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  acknowledgeReveal() {
    this.revealedToken.set(null);
    this.copied.set(false);
    this.tokenCopied.set(false);
  }
}
