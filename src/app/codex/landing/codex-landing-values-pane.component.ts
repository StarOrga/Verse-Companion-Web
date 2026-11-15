import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LandingItem, LandingOverviewField, LandingValue } from './codex-landing-data.types';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { splitCallouts, valueLabel, valueText } from './codex-landing-values';
import { CodexLandingCalloutSetService, hasLoadoutSet, valuesForSet } from './codex-landing-callout-set.service';
import { CodexLandingSetToggleComponent } from './codex-landing-set-toggle.component';

interface SheetRow {
  key: string;
  label: string;
  text: string;
  /** Also a callout at the hologram on wide screens: listed after the sheet's own values, so a short sheet cuts these first. */
  callout: boolean;
}

/** The data sheet lists this many values (admin feedback 2026-11-15: "viele (7!) Werte"). */
export const SHEET_ROWS = 7;

/**
 * The data sheet (round 5): a light pane with no box, only a glowing edge on
 * its outer side, projected out of the screen edge. On top the identity the
 * hologram's arm leaves out (manufacturer, role/type, size), then a plain
 * list of up to {@link SHEET_ROWS} values (label left, value right, no bars:
 * the class comparison stands at the hologram and on the detail page), then
 * the item's main action "<Name> ansehen" at the bottom, mirroring the Codex
 * list's "Alle …" on the left. Re-scans its content on every rotation step.
 */
@Component({
  selector: 'sc-codex-landing-values-pane',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective, CodexLandingSetToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.still]': 'still()' },
  template: `
    <span class="edge" aria-hidden="true"></span>
    @if (item(); as it) {
      @for (k of [key()]; track k) {
        <section class="body" [class.boot]="boot()" [attr.aria-label]="'codex.landing.values.more' | translate">
          <h2 class="ph">{{ 'codex.landing.values.more' | translate }}</h2>
          @if (it.eyebrow.manufacturer || idLine().length) {
            <div class="id">
              @if (it.eyebrow.manufacturer) { <p class="maker">{{ it.eyebrow.manufacturer }}</p> }
              @if (idLine().length) {
                <p class="cls">
                  @for (f of idLine(); track f.id; let last = $last) {
                    <span class="sc-sr-only">{{ 'codex.landing.overview.' + f.id | translate }}:</span>{{ f.value }}@if (!last) {<span class="sep" aria-hidden="true">·</span>}
                  }
                </p>
              }
            </div>
          }
          @if (canSwitch()) {
            <!-- Where the callouts give way (< 1100px), the Flug / Loadout switch moves here (#884). -->
            <sc-codex-landing-set-toggle class="set" />
          }
          @if (rows().length) {
            <dl class="rows">
              @for (r of rows(); track r.key; let i = $index) {
                <div class="row" [class.callout]="r.callout" [style.--i]="i">
                  <dt>{{ r.label }}</dt>
                  <dd class="flash">{{ r.text }}</dd>
                </div>
              }
            </dl>
          }
          <a class="go" scAction tier="secondary" [routerLink]="it.detailRoute">
            <span class="go-t">{{ 'codex.landing.values.view' | translate: { name: it.name } }}</span><i aria-hidden="true">↗</i>
          </a>
          <i class="sweep" aria-hidden="true"></i>
        </section>
      }
    }
  `,
  styles: [
    `
      :host { position: relative; display: flex; flex-direction: column; justify-content: flex-end; color: var(--sc-fg-1); --cx-mono: 'JetBrains Mono', 'Cascadia Mono', ui-monospace, Consolas, monospace; }
      .edge {
        position: absolute; right: 0; top: 0; bottom: 0; width: 1px; pointer-events: none;
        background: linear-gradient(180deg, transparent, rgba(170, 238, 255, 0.85) 18%, rgba(220, 250, 255, 1) 50%, rgba(170, 238, 255, 0.85) 82%, transparent);
        box-shadow: 0 0 10px rgba(130, 220, 255, 0.55);
      }
      /* The light fan from the screen edge: narrow at the edge, the full edge height at the line. */
      .edge::before {
        content: ''; position: absolute; left: 100%; top: 0; bottom: 0; width: var(--cx-bleed, 40px);
        background: linear-gradient(90deg, rgba(130, 222, 255, 0.07), rgba(82, 193, 230, 0.015) 55%, rgba(170, 238, 255, 0.08));
        clip-path: polygon(0 0, 0 100%, 100% 58%, 100% 42%);
      }
      /* The source slit where the fan leaves the screen edge. */
      .edge::after {
        content: ''; position: absolute; top: 42%; height: 16%; left: calc(100% + var(--cx-bleed, 40px) - 2px); width: 2px;
        background: rgba(220, 250, 255, 0.85); box-shadow: 0 0 12px 2px rgba(130, 220, 255, 0.7); border-radius: 1px;
      }
      .body {
        position: relative; display: flex; flex-direction: column; align-items: stretch; text-align: left;
        /* The sheet fills the pane, so its box is exactly as tall as the projector edge beside it and the Codex list (#320). */
        flex: 1 1 auto; min-height: 0; overflow: hidden;
        padding: 16px 18px 14px 0;
        background: repeating-linear-gradient(180deg, rgba(150, 230, 255, 0.035) 0 1px, transparent 1px 4px);
        clip-path: inset(0 0 100% 0);
        animation: pane-in 0.7s cubic-bezier(0.3, 0.6, 0.3, 1) var(--pane-at, 2.6s) both;
      }
      .body:not(.boot) { --pane-at: 1.5s; }
      .ph {
        flex: 0 0 auto; margin: 0 0 10px; font: 600 max(10px, 0.62rem) / 1.2 var(--sc-font-display); letter-spacing: 0.24em;
        text-transform: uppercase; color: var(--sc-accent);
      }
      /* Identity: what the hologram's arm leaves out (manufacturer, role/type, size). */
      .id { flex: 0 0 auto; margin: 0; padding-bottom: 10px; border-bottom: 1px solid color-mix(in srgb, var(--sc-accent) 22%, transparent); }
      .maker {
        margin: 0; font: 600 max(11px, 0.74rem) / 1.25 var(--sc-font-display); letter-spacing: 0.14em; text-transform: uppercase;
        color: var(--sc-fg-0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .cls { margin: 4px 0 0; font: 400 max(11px, 0.72rem) / 1.3 var(--sc-font-body); color: var(--sc-fg-2); }
      .cls .sep { margin: 0 6px; color: var(--sc-fg-3, var(--sc-fg-2)); }
      .set { display: none; flex: 0 0 auto; margin: 0; }
      /* The values: a plain list, label toward the hologram, value at the outer edge. */
      .rows { flex: 0 0 auto; display: flex; flex-direction: column; width: 100%; margin: 0; }
      .row {
        display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 6px 0;
        border-bottom: 1px solid color-mix(in srgb, var(--sc-accent) 9%, transparent);
      }
      .row:last-child { border-bottom: 0; }
      .row dt {
        min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font: 600 max(9.5px, 0.6rem) / 1.2 var(--sc-font-display); letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2);
      }
      .row dd { flex: none; margin: 0; font: 600 max(13px, 0.84rem) / 1 var(--cx-mono); font-variant-numeric: tabular-nums; color: var(--sc-fg-0); white-space: nowrap; }
      /* Past the sheet's height: only the action carries the rest (fitRows). */
      .row.cut { display: none !important; }
      /* The item's main step, at the pane's foot like "Alle …" in the Codex list (scAction secondary, styles.scss). */
      .go { flex: 0 0 auto; align-self: flex-start; max-width: 100%; margin-top: auto; }
      .rows, .id, .set { margin-bottom: 12px; }
      .go-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      /* The re-scan line: a body-tall track slides its top edge down (transform only). */
      .sweep {
        position: absolute; left: 0; right: 0; top: 0; height: 100%; pointer-events: none; opacity: 0;
        animation: sweep 0.75s linear var(--pane-at, 2.6s) both;
      }
      .sweep::before {
        content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px;
        background: linear-gradient(90deg, transparent, #eaffff 30%, transparent); box-shadow: 0 0 10px #8fe3ff;
      }
      .body:not(.boot) .flash { animation: flash 1.1s ease-out calc(var(--pane-at) + 0.45s) both; }
      @keyframes pane-in { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
      @keyframes sweep { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(100%); opacity: 0; } }
      @keyframes flash { 0% { color: inherit; } 22% { color: #fff; text-shadow: 0 0 14px #8fe3ff, 0 0 3px #fff; } 100% { text-shadow: none; } }
      :host(.still) .body, :host(.still) .sweep, :host(.still) .flash { animation: none; clip-path: none; }
      :host(.still) .sweep { display: none; }
      @media (prefers-reduced-motion: reduce) { .body, .sweep, .flash { animation: none !important; clip-path: none; } .sweep { display: none; } }
      @media (max-width: 1099px) { .set { display: block; } }
      /* Touch screens: the dense holo labels stay readable and the link tappable (mobile gate). */
      @media (pointer: coarse) {
        .ph, .row dt, .cls { font-size: 12px; }
      }
      @media (max-width: 720px) {
        :host { justify-content: flex-start; }
        .edge { display: none; }
        .body { padding: 12px 0; }
        .go { margin-top: 12px; }
      }
    `,
  ],
})
export class CodexLandingValuesPaneComponent {
  private readonly translate = inject(TranslateService);
  private readonly lang = this.translate.currentLang;
  private readonly calloutSet = inject(CodexLandingCalloutSetService);

  readonly item = input<LandingItem | null>(null);
  readonly switchNo = input(0);
  readonly still = input(false);

  readonly boot = computed(() => this.switchNo() === 0);
  readonly key = computed(() => {
    const it = this.item();
    return it ? `${it.category}:${it.className}` : '';
  });

  /** Role/type/part, size and class under the manufacturer; the manufacturer itself has its own line. */
  readonly idLine = computed(() =>
    (this.item()?.overview ?? []).filter((f): f is LandingOverviewField & { value: string } => f.id !== 'manufacturer' && !!f.value),
  );

  /**
   * Up to {@link SHEET_ROWS} values: the ones that are no callout first, then
   * the callout values (on wide screens they also stand at the hologram, so a
   * short sheet cuts them first).
   */
  readonly rows = computed<SheetRow[]>(() => {
    this.lang();
    const it = this.item();
    if (!it) return [];
    const { callouts, rest } = splitCallouts(it.category, valuesForSet(it, this.calloutSet.set()));
    const toRow = (v: LandingValue, callout: boolean): SheetRow => ({ key: v.key, label: valueLabel(this.translate, v.key), text: valueText(v), callout });
    return [...rest.map((v) => toRow(v, false)), ...callouts.map((c) => toRow(c.value, true))].slice(0, SHEET_ROWS);
  });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroy = inject(DestroyRef);
    // The sheet is as tall as the hologram box and never scrolls: the rows that do not fit are cut, lowest priority first.
    effect(() => {
      this.rows();
      this.canSwitch();
      requestAnimationFrame(() => this.fitRows());
    });
    afterNextRender(() => {
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.fitRows());
      ro?.observe(this.host.nativeElement);
      void document.fonts?.ready.then(() => this.fitRows());
      destroy.onDestroy(() => ro?.disconnect());
    });
  }

  /** Shows as many rows (in priority order) as the sheet's height holds; the action to the detail page always stays. */
  fitRows(): void {
    const body = this.host.nativeElement.querySelector<HTMLElement>('.body');
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>('.row'));
    for (const r of rows) r.classList.remove('cut');
    const go = body.querySelector<HTMLElement>('.go');
    // Not scrollHeight: the re-scan line (.sweep) travels below the body and would count as overflow.
    const over = (): boolean => !!go && go.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(body).paddingBottom) || 0) > body.getBoundingClientRect().bottom + 1;
    const shown = rows.filter((r) => r.getClientRects().length > 0);
    for (let i = shown.length - 1; i >= 0 && over(); i--) shown[i].classList.add('cut');
  }

  readonly canSwitch = computed(() => hasLoadoutSet(this.item()));
}
