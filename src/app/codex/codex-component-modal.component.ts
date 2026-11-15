import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ScPopupMotionDirective, ensurePopupMotionStyles } from '../shared/popup-motion/sc-popup-motion.directive';
import { ScPopupComponent } from '../shared/popup/sc-popup.component';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { isPlainLeftClick } from '../core/modified-click.util';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { CodexKind } from './codex.service';
import {
  SpecSection,
  StatRow,
  curateComponentStats,
  flattenSpec,
  meaningfulRows,
} from './codex-format';
import {
  EquippedStat,
  damageChannelsOf,
  equippedStats,
  equippedStatsNoteKey,
  formatEquippedStat,
} from './codex-equipped-stats';
import { AmmunitionPayload, ComponentPayload, ItemPayload, WeaponPayload } from './codex.types';

/**
 * Everything the overlay needs about ONE hardpoint occupant. Assembled by the
 * ship detail page, which already holds the resolved payloads — the overlay
 * itself fetches nothing, so opening it can never fail or spin.
 */
export interface ComponentInspectEntry {
  className: string;
  kind: CodexKind | null;
  name: string;
  /** Humanized hardpoint label this thing sits on. */
  port: string;
  /** How many identical hardpoints carry it (≥1). */
  count: number;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  /** "Gun", "Quantum Drive", … — the engine type, humanized. */
  typeLabel: string | null;
  payload: unknown;
  /** Matching `<class>_AMMO` projectile payload for guns, when one exists. */
  ammoPayload?: unknown;
}

/**
 * Full stat sheet for a single installed component, in our own visual language
 * (admin request 461288f9: "wenn ich auf die Waffe drücke, soll sich ein
 * Fenster öffnen … vor allem die Tabelle mit allen Werten").
 *
 * Three tiers, widest-use first: the curated headline stats a pilot compares
 * on (damage / regen / jump range …), then the item's own parameter block, then
 * the complete flattened payload — every numeric field the extract carries,
 * nothing hidden behind a "raw JSON" toggle.
 *
 * Deliberately self-contained: a fixed-position overlay with its own backdrop
 * rather than a CDK portal, so the ship page can render it inline and the
 * component stays unit-testable without an overlay container.
 */
@Component({
  selector: 'sc-codex-component-modal',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, ScPopupComponent, ScActionDirective, ScPopupMotionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entry(); as e) {
      <sc-popup kind="large" [title]="e.name" [eyebrow]="eyebrow()" initialFocus="container"
                scPopupMotion="large" scPopupMotionPlate=".scp-frame" scPopupMotionRows=".cm-headline .hs, .cm-table tbody tr" scPopupMotionFoot=".scp-f"
                (closed)="dismiss()">
        <div class="cm-body">
          <div class="cm-ident">
            <p class="cm-meta">
              @if (metaLine(); as m) { <span class="cm-meta-txt">{{ m }}</span> }
              @for (ch of channels(); track ch) {
                <span class="chip dmg">{{ ('codex.damage.' + ch) | translate }}</span>
              }
              @if (e.grade) { <span class="chip">{{ e.grade }}</span> }
            </p>
            <p class="cm-port">{{ 'codex.inspect.hardpoint' | translate }}: {{ e.port }}</p>
          </div>

          @if (headline().length > 0) {
            <dl class="cm-headline">
              @for (st of headline(); track st.labelKey) {
                <div class="hs" [attr.tabindex]="st.hintKey ? 0 : null" [scTooltip]="st.hintKey ? (st.hintKey | translate) : null">
                  <dt>
                    {{ st.labelKey | translate }}
                    @if (st.derived) {
                      <span class="derived" tabindex="0" role="img" [attr.aria-label]="'codex.equipped.derivedHint' | translate" [scTooltip]="'codex.equipped.derivedHint' | translate" scTooltipTier="label">*</span>
                    }
                  </dt>
                  <dd>{{ fmtStat(st) }}</dd>
                </div>
              }
            </dl>
          }
          <!-- Reading aids the card only carries as hover text — spelled out
               here, where a phone user can actually read them (a tractor
               beam's pull is a force, not a mass). Plus the extract-gap note
               for a beam whose numbers this build does not carry yet. -->
          @for (key of hintKeys(); track key) {
            <p class="cm-hint">{{ key | translate }}</p>
          }
          @if (noteKey(); as key) {
            <p class="cm-hint">{{ key | translate }}</p>
          }

          @if (paramRows().length > 0) {
            <section class="cm-block">
              <h3>{{ 'codex.inspect.parameters' | translate }}</h3>
              <table class="cm-table">
                <tbody>
                  @for (r of paramRows(); track r.key) {
                    <tr>
                      <td class="ct-key">{{ r.key }}</td>
                      <td class="ct-val">{{ r.value }}@if (r.unit) {<span class="ct-unit"> {{ r.unit }}</span>}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          @for (sec of specSections(); track sec.title) {
            <section class="cm-block">
              <h3>{{ sec.title || ('codex.inspect.general' | translate) }}</h3>
              <table class="cm-table">
                <tbody>
                  @for (r of sec.rows; track r.key) {
                    <tr>
                      <td class="ct-key">{{ r.key }}</td>
                      <td class="ct-val">{{ r.value }}@if (r.unit) {<span class="ct-unit"> {{ r.unit }}</span>}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          @for (sec of ammoSections(); track sec.title) {
            <section class="cm-block ammo">
              <h3>{{ 'codex.inspect.projectile' | translate }}@if (sec.title) { — {{ sec.title }} }</h3>
              <table class="cm-table">
                <tbody>
                  @for (r of sec.rows; track r.key) {
                    <tr>
                      <td class="ct-key">{{ r.key }}</td>
                      <td class="ct-val">{{ r.value }}@if (r.unit) {<span class="ct-unit"> {{ r.unit }}</span>}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          @if (isEmpty()) {
            <p class="cm-empty">{{ 'codex.inspect.noStats' | translate }}</p>
          }

        </div>
        <ng-container popupActions>
          @if (e.kind) {
            <a scAction tier="primary" [routerLink]="['/codex', e.kind, e.className]" (click)="onOpenDetail($event)">
              {{ 'codex.inspect.openDetail' | translate }} →
            </a>
          }
        </ng-container>
        <code popupStatus class="cm-cls">{{ e.className }}</code>
      </sc-popup>
    }
  `,
  styles: [`
    :host { display: contents; }
    .cm-body { display: flex; flex-direction: column; gap: 14px; }
    .cm-ident { min-width: 0; }
    .cm-meta { margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cm-meta-txt { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .cm-port { margin: 4px 0 0; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .chip { font-size: max(0.58rem, var(--sc-fs-floor)); letter-spacing: 0.04em; text-transform: uppercase;
      padding: 0 5px; border-radius: 3px; background: var(--sc-bg-2); color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); white-space: nowrap; }
    /* Same rule as the module row it opens from: the hot accent means
       "elevated access" and is banned on the ship page (concept section 0). */
    .chip.dmg { color: var(--sc-warn);
      border-color: color-mix(in srgb, var(--sc-warn) 45%, transparent);
      background: color-mix(in srgb, var(--sc-warn) 10%, transparent); }

    .cm-headline { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); display: flex; flex-wrap: wrap; gap: 6px 20px; }
    .cm-headline .hs { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .cm-headline dt { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .cm-headline dd { margin: 0; font-size: 0.86rem; color: var(--sc-accent);
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .derived { color: var(--sc-fg-2); cursor: help; }

    .cm-block h3 { margin: 0 0 6px; font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--sc-fg-2); }
    .cm-block.ammo h3 { color: var(--sc-warn); }
    .cm-table { width: 100%; border-collapse: collapse; }
    .cm-table tr { border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .cm-table tr:last-child { border-bottom: none; }
    .ct-key { padding: 3px 10px 3px 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .ct-val { padding: 3px 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-0); text-align: right;
      white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ct-unit { color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); }

    .cm-empty { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .cm-hint { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; line-height: 1.4; }
    .cm-cls { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace);
      overflow-wrap: anywhere; }

  `],
})
export class CodexComponentModalComponent {
  constructor() {
    // The stat sheet is a large popup: its stylesheet is in place before the first open.
    ensurePopupMotionStyles(inject(EnvironmentInjector));
  }

  /** The occupant to inspect; `null` renders nothing (closed). */
  readonly entry = input<ComponentInspectEntry | null>(null);
  readonly closed = output<void>();
  private readonly motion = viewChild(ScPopupMotionDirective);
  private dismissing = false;

  /** Close through the popup motion (a collapse to a line, about half the open time), then tell the host. */
  dismiss(): void {
    const mo = this.motion();
    if (!mo) { this.closed.emit(); return; }
    if (this.dismissing) return;
    this.dismissing = true;
    void mo.exit().then(() => { this.dismissing = false; this.closed.emit(); });
  }

  // Focus in, Tab trap, Escape and focus return come from [scDialog]
  // (audit S15) — the panel itself takes focus, as before.

  /**
   * The detail link closes the overlay only for a plain left click — a middle
   * or Ctrl/⌘ click opens the page in a new tab and the overlay should stay
   * (RULE-B, isPlainLeftClick).
   */
  onOpenDetail(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.closed.emit();
  }

  /** Rail eyebrow: "Gun · 3× S3". */
  eyebrow(): string {
    return [this.entry()?.typeLabel, this.badge()].filter(Boolean).join(' · ');
  }

  /** "3× S3" / "S3" / "3×" — never a guessed size. */
  badge(): string | null {
    const e = this.entry();
    if (!e) return null;
    if (e.size == null) return e.count > 1 ? `${e.count}×` : null;
    return e.count > 1 ? `${e.count}× S${e.size}` : `S${e.size}`;
  }

  /** "KLA · Gun" — catalog data, so untranslated like everywhere else. */
  metaLine(): string {
    const e = this.entry();
    if (!e) return '';
    return [e.manufacturerCode, e.typeLabel].filter(Boolean).join(' · ');
  }

  readonly channels = computed<string[]>(() => {
    const e = this.entry();
    return e ? damageChannelsOf(e.payload, e.ammoPayload) : [];
  });

  /**
   * The curated stats for this occupant's type — a superset of what the compact
   * hardpoint row shows. `Infinity`, not the row cap: this overlay IS the full
   * stat sheet ("vor allem die Tabelle mit allen Werten"), so silently dropping
   * everything past the sixth row is exactly the wrong trade here. The header
   * is a wrapping flex list and grows without breaking.
   */
  readonly headline = computed<EquippedStat[]>(() => {
    const e = this.entry();
    if (!e) return [];
    return equippedStats(
      { kind: e.kind, payload: e.payload, ammoPayload: e.ammoPayload },
      Infinity,
    );
  });

  /** Every distinct reading aid the headline rows carry, in row order. */
  readonly hintKeys = computed<string[]>(() => {
    const keys: string[] = [];
    for (const st of this.headline()) {
      if (st.hintKey && !keys.includes(st.hintKey)) keys.push(st.hintKey);
    }
    return keys;
  });

  /** The extract-gap note for this occupant, when its stats are incomplete. */
  readonly noteKey = computed<string | null>(() => {
    const e = this.entry();
    return e ? equippedStatsNoteKey({ kind: e.kind, payload: e.payload, ammoPayload: e.ammoPayload }) : null;
  });

  /** The item's own parameter block (weaponParams / curated component stats). */
  readonly paramRows = computed<StatRow[]>(() => {
    const e = this.entry();
    if (!e?.payload) return [];
    const entityKind = (e.payload as { entityKind?: string }).entityKind ?? e.kind ?? '';
    if (entityKind === 'weapon') {
      return meaningfulRows((e.payload as WeaponPayload).weaponParams);
    }
    if (entityKind === 'component') {
      return curateComponentStats((e.payload as ComponentPayload).stats);
    }
    return curateComponentStats((e.payload as ItemPayload).stats);
  });

  /** Every remaining field of the payload — the "table with all values". */
  readonly specSections = computed<SpecSection[]>(() => {
    const e = this.entry();
    return e?.payload ? flattenSpec(e.payload) : [];
  });

  /** The projectile's numbers, where a gun resolves to one. */
  readonly ammoSections = computed<SpecSection[]>(() => {
    const e = this.entry();
    const ammo = e?.ammoPayload as AmmunitionPayload | undefined;
    return ammo ? flattenSpec(ammo) : [];
  });

  readonly isEmpty = computed(
    () =>
      this.headline().length === 0 &&
      this.paramRows().length === 0 &&
      this.specSections().length === 0 &&
      this.ammoSections().length === 0,
  );

  fmtStat(stat: EquippedStat): string {
    return formatEquippedStat(stat);
  }
}
