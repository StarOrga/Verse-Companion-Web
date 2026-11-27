import { ChangeDetectionStrategy, Component, effect, inject, input, untracked, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { HintTipComponent } from '../shared/hint-tip/hint-tip.component';
import { AreaSymbolComponent, type AreaSymbolKey } from '../shared/area-symbol/area-symbol.component';
import { modelHintKey } from './codex-em-model';
import { displayItemName, formatNumber } from './codex-format';
import { DefensivePanel, OffensivePanel } from './codex-loadout-stats';

/** Panel-local collapse: opens by default, resets whenever the mission asks it to fold. */
function useCollapse(startCollapsed: () => boolean) {
  const open = signal(true);
  effect(() => {
    const collapsed = startCollapsed();
    untracked(() => open.set(!collapsed));
  });
  return open;
}

const DAMAGE_CHANNEL_COLORS: Readonly<Record<string, string>> = {
  physical: '#c9a15a',
  energy: '#4fb3e0',
  distortion: '#a76ee0',
  thermal: '#e0654f',
  biochemical: '#5fbf6a',
  stun: '#e0d24f',
};

const PANEL_STYLES = `
  .src-table tr.empty td { color: var(--sc-fg-2); }
  .src-table .src-note { color: var(--sc-fg-2); font-size: 0.85em; text-align: left; }
  :host { display: block; }

  /* Area colours and symbols (feedback #377, after #330): the Analyse cards
     carry the same area as the loadout blocks beside them — a 2px line on
     top at --sc-area-line strength, the heading and its symbol in the area
     colour. Offensive is the offensive area, Defensive the defensive one;
     the ship card spans several areas, so it stays neutral outside like the
     loadout's merged "Antrieb & Systeme" block and each of its groups carries
     its own area instead. */
  details.block { --p: var(--sc-accent); --pb: color-mix(in srgb, var(--p) var(--sc-area-line), transparent);
    box-shadow: inset 0 2px 0 var(--pb), var(--sc-glow); }
  details.block[data-area="offensive"] { --p: var(--sc-area-offensive); }
  details.block[data-area="defensive"] { --p: var(--sc-area-defensive); }
  details.block[data-area="ship"] { --pb: var(--sc-border); }
  .panel-head > .area-sym { font-size: max(14px, var(--sc-fs-floor)); }
  h3.section-title[data-area="offensive"] { --s: var(--sc-area-offensive); }
  h3.section-title[data-area="defensive"] { --s: var(--sc-area-defensive); }
  h3.section-title[data-area="movement"] { --s: var(--sc-area-movement); }
  h3.section-title[data-area="signature"] { --s: var(--sc-area-signature); }
  h3.section-title > .area-sym { font-size: max(12px, var(--sc-fs-floor)); color: var(--s, var(--p, var(--sc-accent))); }

  /* Card head — concept .m-h2 (part-02:141). This is a micro-label, not a
     heading: 10.5px at .14em tracking in the accent, weight 600. It used to be
     15px at .04em, which read as a section title and dwarfed the values it
     introduces. The hairline under it is the concept's head strip, so it is
     pulled out to the card edges with the card's own padding, and only drawn
     while the panel is open (concept part-01:674-675). */
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 7px; cursor: pointer; margin: 0;
    font-size: max(10.5px, var(--sc-fs-floor)); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--p, var(--sc-accent)); list-style: none; }
  .panel-head::-webkit-details-marker { display: none; }
  details[open] > .panel-head { padding: 0 var(--sc-pad-1) 8px; margin: 0 calc(var(--sc-pad-1) * -1) 10px;
    border-bottom: 1px solid var(--sc-border); }

  .fold-hint { margin-left: auto; font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: none; letter-spacing: normal;
    color: var(--sc-fg-2); font-style: italic; }
  /* The read-out the concept parks on the right of the head (.m-h2 .r,
     part-02:143): muted, 11px, sentence case, gentle tracking. Rendered only
     while the panel is folded — see the template. */
  .head-peek { font-size: max(11px, var(--sc-fs-floor)); letter-spacing: 0.04em; color: var(--sc-fg-2);
    text-transform: none; font-weight: 400; font-variant-numeric: tabular-nums; }
  .chev { transition: transform 0.15s ease; }
  .chev.open { transform: rotate(90deg); }
  /* A missing value reads muted at 12px in the concept (.m-f.gap, part-02:238). */
  .gap-row { font-size: max(12px, var(--sc-fs-floor)); color: var(--sc-fg-2); }

  /* A weapon table is the widest thing on the page: five columns plus class
     names like APAR_BallisticGatling_S4, which have no break opportunity. Its
     min-content width used to become the floor for the whole detail page and
     scrolled it sideways on a phone (feedback 2c7ed0d0). The names may now
     break, and whatever is still too wide scrolls inside its own wrapper
     instead of taking the page with it. */
  .table-wrap { overflow-x: auto; }
  /* Tables — concept table.m-t (part-02:239-244). Two things were wrong: the
     type ran at 13px against the concept's 11px, and every cell was left
     aligned, so a column of figures could not be read down. In the concept only
     the first column is left aligned; everything else is flush right, the head
     is a 9.5px uppercase micro-label, and the row rule is far fainter than a
     card border (rgba .08 against the .22 of the mock's line token). */
  table.analysis-table { width: 100%; border-collapse: collapse; font-size: max(11px, var(--sc-fs-floor)); margin: 0 0 8px; }
  table.analysis-table th { text-align: right; font-weight: 500; font-size: max(9.5px, var(--sc-fs-floor));
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2);
    padding: 3px 4px; border-bottom: 1px solid var(--sc-border); }
  table.analysis-table td { text-align: right; padding: 3px 4px;
    border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 40%, transparent); }
  table.analysis-table th, table.analysis-table td { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  table.analysis-table th:first-child, table.analysis-table td:first-child { text-align: left; }
  /* Total row: accent, uppercase label, no rule under it — and the figures
     themselves drop the tracking and run a size up (part-02:243-244). */
  table.analysis-table tfoot td { font-weight: 400; color: var(--sc-accent); border-bottom: none;
    font-size: max(9.5px, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; }
  table.analysis-table tfoot td:not(:first-child) { font-size: max(12px, var(--sc-fs-floor)); letter-spacing: 0; text-transform: none; }

  .dmg-bars { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
  .dmg-bar-row { display: flex; align-items: center; gap: 8px; font-size: max(11px, var(--sc-fs-floor)); }
  /* Mini bar — concept .m-f .t (part-02:235-236): a 3px hairline track with a
     2px radius, not the 8px pill this used to draw. The track is a translucent
     light wash in the concept, which matters here: --sc-bg-2 is literally the
     top stop of the .sc-card gradient, so a bg-2 track disappears into the
     card at 3px. */
  .dmg-bar-track { flex: 1; height: 3px; border-radius: 2px;
    background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); overflow: hidden; }
  .dmg-bar-fill { height: 100%; border-radius: 2px; }

  /* Notes are left-bordered callouts in the concept (part-02:224-225), not bare
     lines: gold for a warning, dim accent for information. */
  .warn-note { border-left: 2px solid var(--sc-warn, #e8a33d);
    background: color-mix(in srgb, var(--sc-warn, #e8a33d) 8%, transparent);
    padding: 6px 8px; margin: 6px 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-0); }
  .note { border-left: 2px solid color-mix(in srgb, var(--sc-accent) 60%, var(--sc-fg-2));
    background: color-mix(in srgb, var(--sc-accent) 6%, transparent);
    padding: 6px 8px; margin: 6px 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }

  /* #375: the explanation beside a label, as a tooltip. */
  sc-hint-tip { margin-inline-start: 5px; text-transform: none; letter-spacing: normal; }

  /* Sub-head — concept .m-sub (part-02:229): a 9.5px dim-accent micro-label at
     .15em, sitting tight above its grid. It used to be a 13px muted heading. */
  h3.section-title { font-size: max(9.5px, var(--sc-fs-floor)); font-weight: 400; text-transform: uppercase;
    letter-spacing: 0.15em; color: color-mix(in srgb, var(--s, var(--p, var(--sc-accent))) 62%, var(--sc-fg-2)); margin: 7px 0 4px;
    display: flex; align-items: center; gap: 6px; }

  /* Fact grid — concept .m-g3 / .m-f (part-02:230-232): three equal columns,
     each one a 9.5px uppercase key stacked ABOVE a 15px value. This was a
     two-column dt/dd list at 12/13px, which is a different element entirely.

     The template alternates dt/dd and must not change, so the columns are
     assigned by position: children 1..6 are key/value/key/value/key/value of
     one band. Dense packing is what makes that work — a definite column with
     an auto row searches from the first row again under dense, so the three
     keys land on the band's first line and their values on its second. Row gap
     stays 0 (a key must touch its own value) and the .5rem between bands is
     carried by the value's bottom margin instead. minmax(0,1fr) keeps a long
     value from pushing the grid wider than the card on a phone. */
  dl.fact-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-flow: row dense; column-gap: 10px; row-gap: 0; margin: 4px 0 0; }
  dl.fact-grid dt { font-size: max(9.5px, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--sc-fg-2); overflow-wrap: anywhere; }
  dl.fact-grid dd { margin: 0 0 7px; font-size: 15px; color: var(--sc-fg-0);
    font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  dl.fact-grid dt:nth-child(6n + 1), dl.fact-grid dd:nth-child(6n + 2) { grid-column: 1; }
  dl.fact-grid dt:nth-child(6n + 3), dl.fact-grid dd:nth-child(6n + 4) { grid-column: 2; }
  dl.fact-grid dt:nth-child(6n + 5), dl.fact-grid dd:nth-child(6n + 6) { grid-column: 3; }
  /* Below the two-column split the analysis card is full width but narrow, and
     three columns of tracked-out keys would wrap every label. Two-wide bands
     there; a dt is always an odd child and a dd always an even one, so 4n+1..4
     covers every element and the later block wins on source order. */
  @media (max-width: 720px) {
    dl.fact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    dl.fact-grid dt:nth-child(4n + 1), dl.fact-grid dd:nth-child(4n + 2) { grid-column: 1; }
    dl.fact-grid dt:nth-child(4n + 3), dl.fact-grid dd:nth-child(4n + 4) { grid-column: 2; }
  }
`;

/** Waffen / Raketen — offensive read-out for the active loadout (PR C). */
@Component({
  selector: 'sc-codex-offensive-panel',
  standalone: true,
  imports: [TranslatePipe, HintTipComponent, AreaSymbolComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="sc-card block" data-area="offensive" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary class="panel-head">
        <sc-area-symbol class="area-sym" area="offensive" />
        <span class="head-label">{{ 'codex.analysis.offensive.title' | translate }}</span>
        <!-- The totals line used to sit UNDER the head, inside the open panel,
             quoting exactly the two figures the table's own total row quotes a
             few pixels further down (feedback dbdb2ffe: *"Wofür steht 1,636.88
             oben und der Alpha wert der steht unten auch! Also raus damit"*).
             It is a peek at what is folded away, so it belongs to the folded
             state only — open the panel and the table is the single source. -->
        @if (!open() && hintParts(); as h) {
          <span class="head-peek">
            @if (h.dps) { {{ 'codex.analysis.offensive.hintDps' | translate: { value: h.dps } }} }
            @if (h.dps && h.alpha) { · }
            @if (h.alpha) { {{ 'codex.analysis.offensive.hintAlpha' | translate: { value: h.alpha } }} }
            @if ((h.dps || h.alpha) && h.missiles) { · }
            @if (h.missiles) { {{ 'codex.analysis.offensive.hintMissiles' | translate: { value: h.missiles } }} }
          </span>
        }
        <span class="fold-hint">{{ 'codex.analysis.readHint' | translate }}</span>
        <span class="chev" [class.open]="open()" aria-hidden="true">›</span>
      </summary>
      @if (open()) {
        @if (panel(); as p) {
          @if (p.gapKeys.includes('codex.summary.gap.noStockGuns')) {
            <p class="gap-row">{{ 'codex.summary.gap.noStockGuns' | translate }}</p>
          } @else {
            <h3 class="section-title" data-area="offensive">{{ 'codex.analysis.offensive.bySource' | translate }}</h3>
            <div class="table-wrap">
            <table class="analysis-table src-table">
              <thead>
                <tr>
                  <th>{{ 'codex.analysis.offensive.colSource' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colAlpha' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colSustained' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colBurst' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (s of p.sources; track s.key) {
                  <tr [class.empty]="s.weapons === 0">
                    <td>{{ ('codex.analysis.offensive.source.' + s.key) | translate: { count: s.weapons } }}</td>
                    <td>{{ s.alpha != null ? num(s.alpha) : '—' }}</td>
                    <td>{{ s.sustainedDps != null ? num(s.sustainedDps) : '—' }}</td>
                    <td>{{ s.burstDps != null ? num(s.burstDps) : '—' }}</td>
                  </tr>
                }
                @if (p.missileCount > 0) {
                  <tr>
                    <td>{{ 'codex.analysis.offensive.source.missiles' | translate: { count: p.missileCount } }}</td>
                    <td>{{ p.missileSalvoDamage != null ? num(p.missileSalvoDamage) : '—' }}</td>
                    <td colspan="2" class="src-note">{{ 'codex.analysis.offensive.source.salvoOnce' | translate }}</td>
                  </tr>
                }
              </tbody>
            </table>
            </div>
            <h3 class="section-title" data-area="offensive"><sc-area-symbol class="area-sym" area="weapons" />{{ 'codex.analysis.offensive.weapons' | translate: { count: p.weaponCount } }}</h3>
            <div class="table-wrap">
            <table class="analysis-table">
              <thead>
                <tr>
                  <th>{{ 'codex.analysis.offensive.colWeapon' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colSize' | translate }}</th>
                  @if (p.hasAlphaColumn) { <th>{{ 'codex.analysis.offensive.colAlpha' | translate }}</th> }
                  @if (p.hasDpsColumn) { <th>{{ 'codex.analysis.offensive.colSustained' | translate }}</th> }
                  @if (p.hasDpsColumn) { <th>{{ 'codex.analysis.offensive.colBurst' | translate }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (r of p.weaponRows; track $index) {
                  <tr>
                    <td>{{ rowName(r.className, r.name) }}</td>
                    <td>{{ r.size != null ? 'S' + r.size : '—' }}</td>
                    @if (p.hasAlphaColumn) { <td>{{ r.alpha != null ? num(r.alpha) : '—' }}</td> }
                    @if (p.hasDpsColumn) { <td>{{ r.sustainedDps != null ? num(r.sustainedDps) : '—' }}</td> }
                    @if (p.hasDpsColumn) { <td>{{ r.burstDps != null ? num(r.burstDps) : '—' }}</td> }
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>{{ 'codex.analysis.offensive.total' | translate }}</td>
                  <td></td>
                  @if (p.hasAlphaColumn) { <td>{{ p.footerAlpha != null ? num(p.footerAlpha) : '—' }}</td> }
                  @if (p.hasDpsColumn) { <td>{{ p.footerSustainedDps != null ? num(p.footerSustainedDps) : '—' }}</td> }
                  @if (p.hasDpsColumn) { <td>{{ p.footerDps != null ? num(p.footerDps) : '—' }}</td> }
                </tr>
              </tfoot>
            </table>
            </div>

            @if (p.damageChannelTotals.length > 0) {
              <div class="dmg-bars">
                @for (c of p.damageChannelTotals; track c.channel) {
                  <div class="dmg-bar-row">
                    <span>{{ ('codex.damageChannel.' + c.channel) | translate }}</span>
                    <span class="dmg-bar-track">
                      <span class="dmg-bar-fill" [style.width.%]="pctOf(c.value, p.damageChannelTotals)" [style.background]="colorOf(c.channel)"></span>
                    </span>
                    <span>{{ num(c.value) }}</span>
                  </div>
                }
              </div>
            }

            <dl class="fact-grid">
              @if (p.effectiveRange != null) {
                <dt>{{ 'codex.analysis.offensive.effectiveRange' | translate }}@if (p.longestRangeGun) { <sc-hint-tip [text]="'codex.analysis.offensive.longestGunNote' | translate: { name: p.longestRangeGun }" /> }</dt>
                <dd>{{ num(p.effectiveRange) }} m</dd>
              }
              @if (p.projectileSpeed != null) {
                <dt>{{ 'codex.analysis.offensive.projectileSpeed' | translate }}</dt>
                <dd>{{ num(p.projectileSpeed) }} m/s</dd>
              }
            </dl>
            @if (p.mixedRangeWarning) {
              <p class="warn-note">{{ 'codex.analysis.offensive.mixedRangeWarning' | translate }}</p>
            }
          }

          @if (p.missileCount > 0) {
            <h3 class="section-title" data-area="offensive"><sc-area-symbol class="area-sym" area="missiles" />{{ 'codex.analysis.offensive.missiles' | translate: { count: p.missileCount } }}</h3>
            <!-- Missiles are their own table (feedback #350): one row per missile
                 kind, its warhead and the whole salvo. A salvo is a one-off
                 burst, so it never joins the guns' DPS total above. -->
            <div class="table-wrap">
            <table class="analysis-table">
              <thead>
                <tr>
                  <th>{{ 'codex.analysis.offensive.colMissile' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colSize' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colTracking' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colCount' | translate }}</th>
                  @if (p.missileSalvoDamage != null) {
                    <th>{{ 'codex.analysis.offensive.colWarhead' | translate }}</th>
                    <th>{{ 'codex.analysis.offensive.colMissileTotal' | translate }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (m of p.missileRows; track m.className) {
                  <tr>
                    <td>{{ itemName(m.className) }}</td>
                    <td>{{ m.size != null ? 'S' + m.size : '—' }}</td>
                    <td>{{ m.signal ? (('codex.missile.signal.' + m.signal) | translate) : '—' }}</td>
                    <td>{{ m.count }}×</td>
                    @if (p.missileSalvoDamage != null) {
                      <td>{{ m.damage != null ? num(m.damage) : '—' }}</td>
                      <td>{{ m.totalDamage != null ? num(m.totalDamage) : '—' }}</td>
                    }
                  </tr>
                }
              </tbody>
              @if (p.missileSalvoDamage != null) {
                <tfoot>
                  <tr>
                    <td>{{ 'codex.analysis.offensive.salvoDamage' | translate }} <sc-hint-tip [text]="'codex.analysis.offensive.salvoNote' | translate" /></td>
                    <td></td>
                    <td></td>
                    <td>{{ p.missileCount }}×</td>
                    <td></td>
                    <td>{{ num(p.missileSalvoDamage) }}</td>
                  </tr>
                </tfoot>
              }
            </table>
            </div>
            @if (p.missileSalvoDamage == null) {
              <p class="gap-row">{{ 'codex.analysis.offensive.noWarheadData' | translate }}</p>
            }
            @if (p.missileSalvoPartial) {
              <p class="warn-note">{{ 'codex.analysis.offensive.salvoPartial' | translate }}</p>
            }
            @if (p.missileLockTime != null || p.missileRange != null) {
              <dl class="fact-grid">
                @if (p.missileLockTime != null) {
                  <dt>{{ 'codex.analysis.offensive.lockTime' | translate }}@if (p.missileLockNoteSlowest) { <sc-hint-tip [text]="'codex.analysis.offensive.slowestMissileNote' | translate" /> }</dt>
                  <dd>{{ num(p.missileLockTime) }} s</dd>
                }
                @if (p.missileRange != null) {
                  <dt>{{ 'codex.analysis.offensive.range' | translate }}</dt>
                  <dd>{{ num(p.missileRange) }} m</dd>
                }
              </dl>
            }
          }
        }
      }
    </details>
  `,
  styles: [PANEL_STYLES],
})
export class CodexOffensivePanelComponent {
  private readonly translateSvc = inject(TranslateService);
  /** A weapon row names the gun, never its raw class. */
  /** The in-game name in the UI language, the readable class name otherwise. */
  rowName(className: string, name: { de?: string | null; en?: string | null } | null | undefined): string {
    const lang = (this.translateSvc.getCurrentLang() || 'de').startsWith('de') ? 'de' : 'en';
    const loc = name?.[lang] || name?.en || name?.de;
    return loc && loc.trim() && !loc.startsWith('@') ? loc : displayItemName(className);
  }

  itemName(className: string): string {
    return displayItemName(className);
  }

  readonly panel = input.required<OffensivePanel | null>();
  readonly startCollapsed = input<boolean>(false);
  readonly open = useCollapse(() => this.startCollapsed());

  /**
   * The formatted numbers for the folded head's peek; the words around them
   * come from i18n in the template (AUD-188), not from a TS string.
   */
  hintParts(): { dps: string | null; alpha: string | null; missiles: string | null } | null {
    const p = this.panel();
    if (!p || (p.footerDps == null && p.missileSalvoDamage == null)) return null;
    const dps = p.footerDps != null ? this.num(p.footerDps) : null;
    const alpha = p.footerAlpha != null ? this.num(p.footerAlpha) : null;
    const missiles = p.missileSalvoDamage != null ? this.num(p.missileSalvoDamage) : null;
    return dps || alpha || missiles ? { dps, alpha, missiles } : null;
  }

  num(v: number): string {
    return formatNumber(v);
  }

  colorOf(channel: string): string {
    return DAMAGE_CHANNEL_COLORS[channel] ?? 'var(--sc-accent)';
  }

  pctOf(v: number, all: { channel: string; value: number }[]): number {
    const total = all.reduce((s, c) => s + c.value, 0);
    return total > 0 ? (v / total) * 100 : 0;
  }
}

/** Schild / Rumpf & Panzerung — survivability read-out (PR C). */
@Component({
  selector: 'sc-codex-defensive-panel',
  standalone: true,
  imports: [TranslatePipe, AreaSymbolComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="sc-card block" data-area="defensive" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary class="panel-head">
        <sc-area-symbol class="area-sym" area="defensive" />
        <span class="head-label">{{ 'codex.analysis.defensive.title' | translate }}</span>
        <span class="fold-hint">{{ 'codex.analysis.readHint' | translate }}</span>
        <span class="chev" [class.open]="open()" aria-hidden="true">›</span>
      </summary>
      @if (open() && panel(); as p) {
        <h3 class="section-title" data-area="defensive"><sc-area-symbol class="area-sym" area="shields" />{{ 'codex.analysis.defensive.shield' | translate }}</h3>
        @if (p.shieldGeneratorCount === 0) {
          <p class="gap-row">{{ 'codex.summary.gap.noShields' | translate }}</p>
        } @else {
          <dl class="fact-grid">
            @if (p.shieldHp != null) { <dt>{{ 'codex.analysis.defensive.hp' | translate }}</dt><dd>{{ num(p.shieldHp) }}</dd> }
            @if (p.shieldRegen != null) { <dt>{{ 'codex.analysis.defensive.regen' | translate }}</dt><dd>{{ num(p.shieldRegen) }}/s</dd> }
            @if (p.fullInSeconds != null) { <dt>{{ 'codex.analysis.defensive.fullIn' | translate }}</dt><dd>{{ num(p.fullInSeconds) }} s</dd> }
            @if (p.regenDelay != null) { <dt>{{ 'codex.analysis.defensive.regenDelay' | translate }}</dt><dd>{{ num(p.regenDelay) }} s</dd> }
            @if (p.downedDelay != null) { <dt>{{ 'codex.analysis.defensive.downedDelay' | translate }}</dt><dd>{{ num(p.downedDelay) }} s</dd> }
          </dl>
          @if (p.mixedGeneratorNote) { <p class="warn-note">{{ 'codex.analysis.defensive.mixedGeneratorNote' | translate }}</p> }
          <h3 class="section-title" data-area="defensive"><sc-area-symbol class="area-sym" area="shields" />{{ 'codex.analysis.defensive.resistance' | translate }}</h3>
          @if (p.resistances.length > 0) {
            <div class="dmg-bars">
              @for (r of p.resistances; track r.channel) {
                <div class="dmg-bar-row">
                  <span>{{ ('codex.damageChannel.' + r.channel) | translate }}</span>
                  <span class="dmg-bar-track"><span class="dmg-bar-fill" [style.width.%]="r.pct" style="background: var(--sc-accent)"></span></span>
                  <span>{{ num(r.pct) }} %</span>
                </div>
              }
            </div>
          } @else {
            <p class="gap-row">{{ 'codex.summary.gap.noResistances' | translate }}</p>
          }
        }

        <h3 class="section-title" data-area="defensive"><sc-area-symbol class="area-sym" area="structure" />{{ 'codex.analysis.defensive.hull' | translate }}</h3>
        <p class="gap-row">{{ 'codex.summary.gap.noHullMass' | translate }}</p>
        @if (p.armor; as a) {
          <dl class="fact-grid">
            @if (a.reductionPhysicalPct != null) { <dt>{{ 'codex.analysis.defensive.armorPhysical' | translate }}</dt><dd>{{ num(a.reductionPhysicalPct) }} %</dd> }
            @if (a.reductionEnergyPct != null) { <dt>{{ 'codex.analysis.defensive.armorEnergy' | translate }}</dt><dd>{{ num(a.reductionEnergyPct) }} %</dd> }
            @if (a.reductionDistortionPct != null) { <dt>{{ 'codex.analysis.defensive.armorDistortion' | translate }}</dt><dd>{{ num(a.reductionDistortionPct) }} %</dd> }
            <!-- absolute values, NOT multipliers — no % suffix, no reduction math -->
            @if (a.penetrationReduction != null) { <dt>{{ 'codex.analysis.defensive.armorPenetration' | translate }}</dt><dd>{{ num(a.penetrationReduction) }}</dd> }
            @if (a.deflectionPhysical != null) { <dt>{{ 'codex.analysis.defensive.armorDeflectionPhysical' | translate }}</dt><dd>{{ num(a.deflectionPhysical) }}</dd> }
            @if (a.deflectionEnergy != null) { <dt>{{ 'codex.analysis.defensive.armorDeflectionEnergy' | translate }}</dt><dd>{{ num(a.deflectionEnergy) }}</dd> }
          </dl>
        } @else {
          <p class="note">{{ 'codex.analysis.defensive.noArmorData' | translate }}</p>
        }

        @if (p.effectiveHp == null) {
          <h3 class="section-title" data-area="defensive"><sc-area-symbol class="area-sym" area="defensive" />{{ 'codex.analysis.defensive.effectiveHp' | translate }}</h3>
          <p class="gap-row">{{ 'codex.analysis.defensive.effectiveHpGap' | translate }}</p>
        }
      }
    </details>
  `,
  styles: [PANEL_STYLES],
})
export class CodexDefensivePanelComponent {
  readonly panel = input.required<DefensivePanel | null>();
  readonly startCollapsed = input<boolean>(false);
  readonly open = useCollapse(() => this.startCollapsed());

  num(v: number): string {
    return formatNumber(v);
  }
}

/** Flugleistung / Masse / Systeme / Signatur / Rumpf — the ship-level facts panel. */
export interface ShipFactRow {
  labelKey: string;
  value: string | null;
  gapKey?: string | null;
}

export interface ShipFactGroup {
  titleKey: string;
  rows: ShipFactRow[];
  /** A visible line: a data gap or status the reader must see. */
  note?: string | null;
  /** An explanation, shown as a tooltip beside the group title (#375). */
  tip?: string | null;
}

/**
 * Ship fact group → loadout area (#377). The same pairing the loadout blocks
 * use (ship-module-sections, #330): quantum sits in Bewegung, the hull in
 * Verteidigung (structure), the signature in Signatur & Kühlung. Flight and
 * mass are how the ship moves, so they take the movement area.
 */
const SHIP_GROUP_AREA: Readonly<Record<string, { area: string; symbol: AreaSymbolKey }>> = {
  'codex.analysis.ship.flightPerformance': { area: 'movement', symbol: 'movement' },
  'codex.analysis.ship.mass': { area: 'movement', symbol: 'movement' },
  'codex.analysis.ship.systems': { area: 'movement', symbol: 'quantum' },
  'codex.analysis.ship.signature': { area: 'signature', symbol: 'signature' },
  'codex.analysis.ship.hull': { area: 'defensive', symbol: 'structure' },
};

@Component({
  selector: 'sc-codex-ship-panel',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, HintTipComponent, AreaSymbolComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="sc-card block" data-area="ship" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary class="panel-head">
        <sc-area-symbol class="area-sym" area="systems" />
        <span class="head-label">{{ 'codex.analysis.ship.title' | translate }}</span>
        <span class="fold-hint">{{ 'codex.analysis.readHint' | translate }}</span>
        <span class="chev" [class.open]="open()" aria-hidden="true">›</span>
      </summary>
      @if (open()) {
        @for (g of groups(); track g.titleKey) {
          <h3 class="section-title" [attr.data-area]="groupArea(g.titleKey)?.area">@if (groupArea(g.titleKey); as ga) { <sc-area-symbol class="area-sym" [area]="ga.symbol" /> }{{ g.titleKey | translate }}@if (g.tip) { <sc-hint-tip class="title-tip" [text]="g.tip" /> }</h3>
          <dl class="fact-grid">
            @for (r of g.rows; track r.labelKey) {
              <dt [scTooltip]="modelHint(r.labelKey) ? (modelHint(r.labelKey)! | translate) : null">{{ r.labelKey | translate }}</dt>
              <dd>
                @if (r.value == null && r.gapKey) {
                  <!-- Focusable anchor: the reason for the gap is the only
                       content, so keyboard users must reach it too. -->
                  <span class="gap-dash" tabindex="0" role="img" [attr.aria-label]="r.gapKey | translate"
                        [scTooltip]="r.gapKey | translate" scTooltipTier="label">—</span>
                } @else {
                  {{ r.value ?? '—' }}
                }
              </dd>
            }
          </dl>
          @if (g.note) { <p class="note">{{ g.note }}</p> }
        }
      }
    </details>
  `,
  styles: [PANEL_STYLES],
})
export class CodexShipPanelComponent {
  /** #377: each fact group in the loadout area and symbol it belongs to. */
  protected groupArea(titleKey: string): { area: string; symbol: AreaSymbolKey } | null {
    return SHIP_GROUP_AREA[titleKey] ?? null;
  }
  /** #967: IR / EM rows are our model — their label carries the formula. */
  protected readonly modelHint = modelHintKey;
  readonly groups = input.required<readonly ShipFactGroup[]>();
  readonly startCollapsed = input<boolean>(false);
  readonly open = useCollapse(() => this.startCollapsed());
}
