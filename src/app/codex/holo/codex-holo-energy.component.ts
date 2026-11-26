// Zone ② of the Holotable page: the energy, drawn the way the game's power
// screen draws it (concept holotisch-kategorien r3, screens s2 + s3).
//
// One row of vertical segment columns, one per consumer group of the model
// (`buildEnergy`), grouped under the four areas. Lit segments are assigned
// power, dim ones free capacity. The pilot sets a column with the − / + steppers
// or by clicking a segment, the icon cuts / restores it ("Waffen aus"). Every
// change goes through `recomputeEnergy`; its consequences (EM km, IR km,
// cooling load, the Offensive lead number) show as delta chips.
//
// The local edit state is a what-if: it never reaches the loadout draft and is
// not the strip's power draft (wave 3 owns that).
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  output,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { AreaSymbolComponent } from '../../shared/area-symbol/area-symbol.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { formatEquippedStat } from '../codex-equipped-stats';
import { EquippedStatFormat } from '../codex-equipped-stats';
import { formatNumber } from '../codex-format';
import { PowerColumnKey, parseCoolerUnit } from '../codex-power';
import type { SummaryOccupant } from '../ship-summary-panels';
import {
  EnergyConsequences,
  EnergySegments,
  HoloCategoryId,
  HoloEnergyInput,
  buildEnergy,
  recomputeEnergy,
  withGroupSegments,
} from './holo-category-model';

/** The symbol of each consumer group — five reuse the app's area symbols, `thrusters` is new (ds-new in area-symbol). */
const GROUP_SYMBOL: Readonly<Record<string, string>> = {
  weapons: 'weapons',
  shields: 'shields',
  thrusters: 'thrusters',
  quantum: 'quantum',
  radar: 'radar',
  coolers: 'coolers',
  life: 'lifeSupport',
  tractor: 'systems',
};

/** Which of the four areas a consumer group sits under (the area's colour paints its columns). */
const GROUP_AREA: Readonly<Record<string, HoloCategoryId>> = {
  weapons: 'offensive',
  shields: 'defensive',
  thrusters: 'movement',
  quantum: 'movement',
  radar: 'signature',
  coolers: 'signature',
  life: 'signature',
  tractor: 'signature',
};

const AREA_ORDER: readonly HoloCategoryId[] = ['offensive', 'defensive', 'movement', 'signature'];

export interface EnergyColumn {
  key: PowerColumnKey;
  labelKey: string;
  labelParams: Readonly<Record<string, number>>;
  symbol: string;
  used: number;
  max: number;
  /** 1..max, the segments bottom to top. */
  segs: readonly number[];
  /** Segments this column gave up against the untouched loadout (shown as outlines). */
  freed: number;
  cut: boolean;
}

export interface EnergyAreaGroup {
  area: HoloCategoryId;
  labelKey: string;
  cols: readonly EnergyColumn[];
}

export interface EnergyChip {
  key: 'lead' | 'emKm' | 'irKm' | 'coolingLoadPct';
  labelKey: string;
  text: string;
  tone: 'better' | 'worse';
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

@Component({
  selector: 'sc-codex-holo-energy',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, AreaSymbolComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length > 0) {
      <section class="en" [attr.aria-label]="'codex.holo.energy.title' | translate">
        <div class="en-head">
          <span class="t">{{ 'codex.holo.energy.title' | translate }}</span>
          <span class="n">{{ 'codex.holo.energy.used' | translate: { used: usedText(), total: totalText() } }}</span>
          <span class="rule"></span>
        </div>
        <div class="en-panel">
          <div class="en-gen">
            <span class="k">{{ 'codex.holo.energy.generator' | translate }}</span>
            <span class="gen-n">
              <sc-area-symbol area="powerPlants" />{{ generatorName() ?? ('codex.holo.energy.generatorUnknown' | translate) }}
            </span>
            <span class="tot" data-testid="en-total">{{ usedText() }} <small>/ {{ totalText() }}</small></span>
            <span class="k">{{ 'codex.holo.energy.segmentsUsed' | translate }}</span>
            <span class="budget" aria-hidden="true">
              @for (b of budgetBar(); track $index) { <i [class.on]="b === 1" [class.free]="b === 2"></i> }
            </span>
            <span class="gen-s">
              <span [class.is-ok]="energy().sheet.ready" [class.is-warn]="!energy().sheet.ready">{{ (energy().sheet.ready ? 'codex.energy.readiness.shortOk' : 'codex.energy.readiness.shortNo') | translate }}</span>
              · {{ 'codex.energy.mode.label' | translate }} {{ ('codex.energy.mode.' + energy().sheet.mode) | translate }}
              @if (edited()) { · {{ 'codex.holo.energy.manual' | translate }} }
            </span>
          </div>

          <div class="en-cols" role="group" [attr.aria-label]="'codex.holo.energy.columns' | translate">
            @for (g of groups(); track g.area) {
              <div class="grp" [attr.data-p]="g.area">
                <div class="grp-cols">
                  @for (c of g.cols; track c.key) {
                    <div class="col" [attr.data-key]="c.key">
                      @if (c.freed > 0) {
                        <span class="chip is-free">{{ 'codex.holo.energy.freed' | translate: { n: c.freed } }}</span>
                      }
                      <span class="cnt" [class.is-zero]="c.used === 0">{{ c.used }}/{{ c.max }}</span>
                      <span class="stack" [style.--n]="c.max" role="img"
                            [attr.aria-label]="'codex.energy.pip.level' | translate: { group: (c.labelKey | translate: c.labelParams), n: c.used, m: c.max }">
                        @for (n of c.segs; track n) {
                          <button type="button" class="seg" tabindex="-1" [class.on]="n <= c.used" [class.freed]="n > c.used && n <= c.used + c.freed"
                                  [attr.aria-label]="'codex.energy.pip.level' | translate: { group: (c.labelKey | translate: c.labelParams), n: n, m: c.max }"
                                  (click)="clickSegment(c, n)"></button>
                        }
                      </span>
                      <button type="button" class="gbtn" [class.is-off]="c.cut" [attr.aria-pressed]="c.cut"
                              [attr.aria-label]="(c.cut ? 'codex.energy.toggleOn' : 'codex.energy.toggleOff') | translate: { group: (c.labelKey | translate: c.labelParams) }"
                              [scTooltip]="(c.cut ? 'codex.energy.toggleOn' : 'codex.energy.toggleOff') | translate: { group: (c.labelKey | translate: c.labelParams) }"
                              scTooltipTier="label" (click)="toggle(c)">
                        <sc-area-symbol [area]="c.symbol" />
                      </button>
                      <span class="cl">{{ c.labelKey | translate: c.labelParams }}</span>
                      <span class="step" role="group" [attr.aria-label]="c.labelKey | translate: c.labelParams">
                        <button type="button" class="stp" [disabled]="c.used <= 0"
                                [attr.aria-label]="'codex.holo.energy.less' | translate: { group: (c.labelKey | translate: c.labelParams) }"
                                [scTooltip]="'codex.holo.energy.less' | translate: { group: (c.labelKey | translate: c.labelParams) }"
                                scTooltipTier="label" (click)="setLevel(c, c.used - 1)">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
                        </button>
                        <button type="button" class="stp" [disabled]="c.used >= c.max"
                                [attr.aria-label]="'codex.holo.energy.more' | translate: { group: (c.labelKey | translate: c.labelParams) }"
                                [scTooltip]="'codex.holo.energy.more' | translate: { group: (c.labelKey | translate: c.labelParams) }"
                                scTooltipTier="label" (click)="setLevel(c, c.used + 1)">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                      </span>
                    </div>
                  }
                </div>
                <span class="grp-l">{{ g.labelKey | translate }}</span>
              </div>
            }
          </div>

          <div class="en-side">
            @if (chips().length > 0) {
              <div class="deltas" data-testid="en-chips" aria-live="polite">
                <span class="k">{{ 'codex.holo.energy.changes' | translate }}</span>
                @for (c of chips(); track c.key) {
                  <span class="dl">{{ c.labelKey | translate }}<span class="chip" [class.is-better]="c.tone === 'better'" [class.is-worse]="c.tone === 'worse'">{{ c.text }}</span></span>
                }
              </div>
            } @else {
              <div class="cool">
                <span class="k">{{ 'codex.energy.fact.coolingLoad' | translate }}</span>
                <span class="v">{{ coolingText() }}</span>
                <span class="cool-b" aria-hidden="true"><i [style.width.%]="coolingBar()"></i></span>
              </div>
            }
            @if (chips().length > 0) {
              <div class="cool">
                <span class="k">{{ 'codex.energy.fact.coolingLoad' | translate }}</span>
                <span class="v">{{ coolingText() }}</span>
                <span class="cool-b" aria-hidden="true"><i [style.width.%]="coolingBar()"></i></span>
              </div>
            }
            @if (coolingNote(); as note) {
              <p class="note">{{ note.key | translate: note.params }}</p>
            }
            <button type="button" scAction tier="secondary" class="reset" [disabled]="!edited()" (click)="reset()">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7 M3 4v5h5" /></svg>
              <span>{{ 'codex.holo.energy.reset' | translate }}</span>
            </button>
          </div>
        </div>
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      /* ds-new: Energie-Balken — the game's power-screen columns (segment stacks, area underline); StarUI candidate, experimental */
      .en { --mono: var(--font-monospace, monospace); --disp: var(--sc-font-display); }
      .en-head { display: flex; align-items: center; gap: 12px; min-height: 28px; margin-bottom: 8px; color: var(--sc-accent); font-family: var(--disp); text-transform: uppercase; letter-spacing: 0.14em; font-size: 13px; }
      .en-head .n { font-family: var(--mono); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); }
      .en-head .rule { flex: 1; height: 1px; background: var(--sc-border); }
      .en-panel { display: grid; grid-template-columns: 216px minmax(0, 1fr) 248px; gap: 24px; align-items: stretch; padding: 16px 20px; border: 1px solid var(--sc-border); border-radius: 8px; background: color-mix(in srgb, var(--sc-bg-1) 60%, transparent); }
      .k { font-family: var(--disp); font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); }
      .en-gen { display: flex; flex-direction: column; gap: 4px; padding-inline-end: 24px; border-inline-end: 1px solid var(--sc-border); min-width: 0; }
      .gen-n { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--sc-fg-0); }
      .gen-n sc-area-symbol { color: var(--sc-warning); }
      .tot { margin-top: 8px; font-family: var(--mono); font-size: 32px; line-height: 1; color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }
      .tot small { font-size: 18px; color: var(--sc-fg-2); }
      .budget { display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0; }
      .budget i { flex: 1 1 0; min-width: 6px; height: 8px; border-radius: 2px; background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); }
      .budget i.on { background: var(--sc-accent); }
      .budget i.free { background: transparent; box-shadow: inset 0 0 0 1px var(--sc-accent); }
      .gen-s { margin-top: auto; font-size: 13px; color: var(--sc-fg-2); }
      .gen-s .is-ok { color: var(--sc-success); }
      .gen-s .is-warn { color: var(--sc-warning); }
      .en-cols { display: flex; justify-content: center; align-items: flex-end; gap: 20px; min-width: 0; overflow-x: auto; padding-top: 28px; }
      .grp { display: flex; flex-direction: column; align-items: stretch; flex: none; }
      .grp[data-p='offensive'] { --p: var(--sc-area-offensive); }
      .grp[data-p='defensive'] { --p: var(--sc-area-defensive); }
      .grp[data-p='movement'] { --p: var(--sc-area-movement); }
      .grp[data-p='signature'] { --p: var(--sc-area-signature); }
      .grp-cols { display: flex; gap: 4px; justify-content: center; align-items: flex-end; flex: 1 1 auto; }
      .grp-l { margin-top: 8px; padding-top: 4px; border-top: 2px solid var(--p); font-family: var(--disp); font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--p); text-align: center; white-space: nowrap; }
      .col { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; inline-size: 76px; }
      .cnt { font-family: var(--mono); font-size: 14px; color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }
      .cnt.is-zero { color: var(--sc-fg-2); }
      .stack { display: flex; flex-direction: column-reverse; justify-content: flex-start; gap: 4px; block-size: calc(var(--n, 1) * 16px - 4px); }
      .seg { display: block; inline-size: 36px; block-size: 12px; padding: 0; border: 0; border-radius: 2px; cursor: pointer; background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); }
      .seg.on { background: var(--p); box-shadow: 0 0 6px color-mix(in srgb, var(--p) 45%, transparent); }
      .seg.freed { background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 80%, transparent); }
      @media (hover: hover) { .seg:hover { background: color-mix(in srgb, var(--p) 55%, transparent); } }
      .seg:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
      .gbtn { display: inline-grid; place-items: center; inline-size: 32px; block-size: 32px; margin-top: 4px; padding: 0; border: 1px solid var(--sc-border); border-radius: 4px; background: none; color: var(--p); cursor: pointer; font-size: 18px; }
      @media (hover: hover) { .gbtn:hover { border-color: var(--p); background: color-mix(in srgb, var(--p) 10%, transparent); } }
      .gbtn.is-off { color: var(--sc-fg-2); border-style: dashed; }
      .gbtn:focus-visible, .stp:focus-visible, .reset:focus-visible { outline: 1px solid transparent; box-shadow: var(--sc-focus-ring); }
      .cl { min-block-size: 2.5em; font-size: 13px; line-height: 1.25; color: var(--sc-fg-1); text-align: center; hyphens: auto; overflow-wrap: anywhere; }
      .step { display: inline-flex; gap: 4px; }
      .stp { display: grid; place-items: center; inline-size: 28px; block-size: 28px; padding: 0; border: 1px solid var(--sc-border); border-radius: 4px; background: none; color: var(--sc-fg-1); cursor: pointer; }
      .stp svg { inline-size: 14px; block-size: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      @media (hover: hover) { .stp:hover:not(:disabled) { border-color: var(--p); color: var(--sc-fg-0); } }
      .stp:disabled { opacity: 0.4; cursor: default; }
      .col .chip.is-free { position: absolute; top: -28px; }
      .chip { display: inline-block; font-family: var(--mono); font-size: 13px; line-height: 1.5; padding: 0 6px; border-radius: 2px; white-space: nowrap; }
      .chip.is-worse { color: var(--sc-warning); background: color-mix(in srgb, var(--sc-warning) 14%, transparent); }
      .chip.is-better { color: var(--sc-success); background: color-mix(in srgb, var(--sc-success) 14%, transparent); }
      .chip.is-free { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
      .en-side { display: flex; flex-direction: column; gap: 8px; padding-inline-start: 24px; border-inline-start: 1px solid var(--sc-border); min-width: 0; }
      .deltas { display: grid; gap: 4px; }
      .dl { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13px; color: var(--sc-fg-1); }
      .cool { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; align-items: baseline; }
      .cool .v { font-family: var(--mono); font-size: 20px; color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }
      .cool-b { grid-column: 1 / -1; position: relative; block-size: 6px; border-radius: 2px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); }
      .cool-b i { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: var(--sc-area-signature); }
      .note { margin: 0; font-size: 13px; line-height: 1.45; color: var(--sc-fg-2); }
      .reset { align-self: flex-start; margin-top: auto; }
      /* Touch: the steppers and segments reach the 44 px floor; the row scrolls sideways instead of squeezing. */
      @media (pointer: coarse) {
        .col { inline-size: 104px; }
        .stp { inline-size: 44px; block-size: 44px; }
        .gbtn { inline-size: 44px; block-size: 44px; }
        .seg { block-size: 16px; inline-size: 44px; }
        .stack { block-size: calc(var(--n, 1) * 20px - 4px); }
      }
      @media (max-width: 1180px) {
        .en-panel { grid-template-columns: minmax(0, 1fr); gap: 16px; }
        .en-gen { padding-inline-end: 0; border-inline-end: 0; padding-block-end: 12px; border-block-end: 1px solid var(--sc-border); }
        .en-side { padding-inline-start: 0; border-inline-start: 0; padding-block-start: 12px; border-block-start: 1px solid var(--sc-border); }
        .en-cols { justify-content: flex-start; }
      }
    `,
  ],
})
export class CodexHoloEnergyComponent {
  readonly occupants = input.required<readonly SummaryOccupant[]>();
  readonly shipStats = input<Record<string, Record<string, unknown>> | null>(null);
  readonly schemaVersion = input<number | null>(null);
  /** The Offensive lead number as the loadout stands (e.g. Dauer-DPS); null = a gap. */
  readonly baseLead = input<number | null>(null);
  readonly leadFormat = input<EquippedStatFormat>('perSec');
  /** i18n key of the lead's label, for the chip ("Offensive"). */
  readonly leadLabelKey = input('codex.holo.strip.offensive');
  /** A new key (the ship) wipes the what-if. */
  readonly resetKey = input<string | null>(null);

  /** The consequences of the pilot's edits, null while nothing is edited. Wave 3's strip may read them. */
  readonly changed = output<EnergyConsequences | null>();

  /** column key → segments the pilot asked for (0 = cut). Insertion order = edit order. */
  protected readonly edits = linkedSignal<string | null, ReadonlyMap<PowerColumnKey, number>>({
    source: this.resetKey,
    computation: () => new Map(),
  });
  readonly edited = computed(() => this.edits().size > 0);

  private readonly baseInput = computed<HoloEnergyInput>(() => ({
    occupants: this.occupants(),
    shipStats: this.shipStats(),
    schemaVersion: this.schemaVersion(),
  }));
  private readonly original = computed(() => buildEnergy(this.baseInput()));

  /** The last edit run through `recomputeEnergy`, on top of the edits before it. */
  readonly result = computed<EnergyConsequences | null>(() => {
    const entries = [...this.edits()];
    if (entries.length === 0) return null;
    let input = this.baseInput();
    for (const [key, segments] of entries.slice(0, -1)) input = withGroupSegments(input, key, segments);
    const [lastKey, lastSegments] = entries[entries.length - 1];
    return recomputeEnergy(input, lastKey, lastSegments, this.baseLead());
  });
  readonly energy = computed(() => this.result()?.energy ?? this.original());

  constructor() {
    effect(() => {
      const r = this.result();
      untracked(() => this.changed.emit(r));
    });
  }

  protected readonly generatorName = computed<string | null>(() => {
    const plant = this.occupants().find((o) => o.section === 'powerPlants' && o.payload);
    const p = plant?.payload as { nameLocalized?: string; name?: unknown; className?: string } | undefined;
    const name = typeof p?.nameLocalized === 'string' && p.nameLocalized ? p.nameLocalized : typeof p?.name === 'string' ? p.name : null;
    return name || null;
  });

  protected readonly groups = computed<EnergyAreaGroup[]>(() => {
    const before = new Map(this.original().segments.map((s) => [s.key, s.used] as const));
    const rows = this.energy().segments.filter((s) => s.present && s.max > 0);
    const byArea = new Map<HoloCategoryId, EnergyColumn[]>();
    for (const s of rows) {
      const group = parseCoolerUnit(s.key) !== null ? 'coolers' : s.key;
      const area = GROUP_AREA[group] ?? 'signature';
      const col: EnergyColumn = {
        key: s.key,
        labelKey: s.labelKey,
        labelParams: s.labelParams ?? {},
        symbol: GROUP_SYMBOL[group] ?? 'systems',
        used: s.used,
        max: s.max,
        segs: Array.from({ length: s.max }, (_, i) => i + 1),
        freed: Math.max(0, (before.get(s.key) ?? s.used) - s.used),
        cut: s.cut,
      };
      byArea.set(area, [...(byArea.get(area) ?? []), col]);
    }
    return AREA_ORDER.filter((a) => byArea.has(a)).map((area) => ({
      area,
      labelKey: `codex.holo.strip.${area}`,
      cols: byArea.get(area)!,
    }));
  });

  private readonly budget = computed(() => this.energy().generator);
  protected readonly usedText = computed(() => String(this.budget().used));
  protected readonly totalText = computed(() => (this.budget().available === null ? '—' : String(this.budget().available)));

  /** One cell per generated segment: 1 = used, 2 = freed by the edit, 0 = free. */
  protected readonly budgetBar = computed<number[]>(() => {
    const { used, available } = this.budget();
    if (available === null || available <= 0) return [];
    const was = Math.min(available, this.original().generator.used);
    return Array.from({ length: available }, (_, i) => (i < used ? 1 : i < was ? 2 : 0));
  });

  protected readonly chips = computed<EnergyChip[]>(() => {
    const r = this.result();
    if (!r) return [];
    const before = this.original();
    const out: EnergyChip[] = [];
    const lead = this.baseLead();
    if (lead !== null && r.offensiveLead !== null && r.offensiveLead !== lead) {
      const f = this.leadFormat();
      out.push({
        key: 'lead',
        labelKey: this.leadLabelKey(),
        text: `${formatEquippedStat({ labelKey: '', value: lead, format: f })} → ${formatEquippedStat({ labelKey: '', value: r.offensiveLead, format: f })}`,
        tone: r.offensiveLead < lead ? 'worse' : 'better',
      });
    }
    const km = (key: 'emKm' | 'irKm', labelKey: string) => {
      const a = before[key];
      const b = r[key];
      if (a === null || b === null || round1(a) === round1(b)) return;
      out.push({ key, labelKey, text: `${formatNumber(a, undefined, 1)} → ${formatNumber(b, undefined, 1)} km`, tone: b < a ? 'better' : 'worse' });
    };
    km('emKm', 'codex.holo.energy.emFrom');
    km('irKm', 'codex.holo.energy.irFrom');
    const ca = before.coolingLoadPct;
    const cb = r.coolingLoadPct;
    if (ca !== null && cb !== null && Math.round(ca) !== Math.round(cb)) {
      out.push({ key: 'coolingLoadPct', labelKey: 'codex.energy.fact.coolingLoad', text: `${Math.round(ca)} → ${Math.round(cb)} %`, tone: cb < ca ? 'better' : 'worse' });
    }
    return out;
  });

  protected readonly coolingText = computed(() => {
    const p = this.energy().coolingLoadPct;
    return p === null ? '—' : `${Math.round(p)} %`;
  });
  protected readonly coolingBar = computed(() => Math.max(0, Math.min(100, this.energy().coolingLoadPct ?? 0)));
  protected readonly coolingNote = computed<{ key: string; params: Record<string, number> } | null>(() => {
    const c = this.energy().sheet.coolant;
    if (c.percent === null || c.used === null || c.total === null) return null;
    return {
      key: 'codex.holo.energy.coolingNote',
      params: { used: Math.round(c.used), total: Math.round(c.total), reserve: Math.max(0, Math.round(100 - c.percent)) },
    };
  });

  protected setLevel(col: EnergyColumn, segments: number): void {
    const next = Math.max(0, Math.min(col.max, Math.floor(segments)));
    this.edits.update((m) => {
      const out = new Map(m);
      out.delete(col.key);
      out.set(col.key, next);
      return out;
    });
  }

  /** A click on the segment that is already the top lit one steps down by one (1 → 0 cuts). */
  protected clickSegment(col: EnergyColumn, n: number): void {
    this.setLevel(col, n === col.used ? n - 1 : n);
  }

  /** Cut ↔ restore: restoring drops the edit and the column falls back to the allocation. */
  protected toggle(col: EnergyColumn): void {
    if (!col.cut) {
      this.setLevel(col, 0);
      return;
    }
    this.edits.update((m) => {
      const out = new Map(m);
      out.delete(col.key);
      return out;
    });
  }

  protected reset(): void {
    this.edits.set(new Map());
  }
}

export type { EnergySegments };
