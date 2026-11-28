// Head of one of the four part columns (zone ③): the lead number with its unit
// and plain label, the P-rank ring, the class median with a delta chip and one
// line of secondary values. No charts — those live in the strip's fold-out.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { EquippedStatFormat, formatEquippedStatNumber } from '../codex-equipped-stats';
import { formatNumber } from '../codex-format';
import { CodexHoloRankComponent } from './holo-rank.component';
import { HoloCategoryId, HoloCategoryModel, signatureToKm } from './holo-category-model';

interface Fig {
  num: string;
  unit: string;
}
interface HeadSub {
  labelKey: string;
  text: string;
}

const UNIT: Partial<Record<EquippedStatFormat, string>> = { perSec: '/s', mps: 'm/s', kms: 'km/s', seconds: 's', percent: '%' };

const LEAD_LABEL: Readonly<Record<string, { labelKey: string; format: EquippedStatFormat }>> = {
  sustainedDps: { labelKey: 'codex.kpi.sustainedDps', format: 'perSec' },
  burstDps: { labelKey: 'codex.kpi.burstDps', format: 'perSec' },
  shieldHp: { labelKey: 'codex.kpi.shieldHp', format: 'int' },
  hullHp: { labelKey: 'codex.kpi.hullHp', format: 'int' },
  effectiveHp: { labelKey: 'codex.kpi.effectiveHp', format: 'int' },
  scm: { labelKey: 'codex.kpi.scm', format: 'mps' },
  maxSpeed: { labelKey: 'codex.kpi.maxSpeed', format: 'mps' },
  emLoad: { labelKey: 'codex.holo.head.emKm', format: 'int' },
  ir: { labelKey: 'codex.holo.head.irKm', format: 'int' },
};

@Component({
  selector: 'sc-codex-holo-category-head',
  standalone: true,
  imports: [TranslatePipe, CodexHoloRankComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-p]': 'area()' },
  template: `
    <div class="hx-head" [class.is-dim]="off()">
      <div class="lead">
        @if (fig(); as f) {
          <span class="num">{{ f.num }}</span>
          @if (f.unit) { <span class="unit">{{ f.unit }}</span> }
        } @else {
          <span class="num gap">—</span>
        }
        <span class="lbl">{{ label() | translate }}</span>
      </div>
      <sc-codex-holo-rank [rank]="model().lead.rank" [thin]="model().lead.thin" [cohortSize]="model().lead.cohortSize"
                          [phraseKey]="phraseKey()" [dim]="off()" />
      @if (median(); as m) {
        <p class="med">
          {{ 'codex.holo.head.median' | translate }} <b>{{ m.text }}</b>
          @if (m.delta) { <span class="chip" [class.is-better]="m.delta.better" [class.is-worse]="!m.delta.better">{{ m.delta.text }}</span> }
          @if (hint(); as h) { · {{ 'codex.holo.head.firstReveals' | translate }} <b>{{ h }}</b> }
        </p>
      }
      <div class="subs">
        @for (s of subs(); track s.labelKey) {
          <span>{{ s.labelKey | translate }}<b>{{ s.text }}</b></span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .hx-head { display: grid; grid-template-columns: minmax(0, 1fr) 64px; gap: 4px 12px; align-items: center; margin: 0 0 16px; }
      .lead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
      .num { font-family: var(--font-monospace, monospace); font-size: 28px; line-height: 1.05; color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }
      .num.gap { color: var(--sc-fg-2); }
      .unit { font-family: var(--font-monospace, monospace); font-size: 16px; color: var(--sc-fg-1); }
      .lbl { flex-basis: 100%; font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.12em; font-size: 13px; color: var(--sc-fg-2); }
      .med { grid-column: 1 / -1; margin: 0; font-size: 13px; line-height: 1.45; color: var(--sc-fg-2); }
      .med b { font-weight: 400; font-family: var(--font-monospace, monospace); color: var(--sc-fg-1); }
      .chip { display: inline-block; font-family: var(--font-monospace, monospace); font-size: 13px; line-height: 1.5; padding: 0 6px; border-radius: 2px; white-space: nowrap; }
      .chip.is-worse { color: var(--sc-warning); background: color-mix(in srgb, var(--sc-warning) 14%, transparent); }
      .chip.is-better { color: var(--sc-success); background: color-mix(in srgb, var(--sc-success) 14%, transparent); }
      .subs { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--sc-fg-2); }
      .subs b { margin-inline-start: 6px; font-family: var(--font-monospace, monospace); font-weight: 400; color: var(--sc-fg-0); }
    `,
  ],
})
export class CodexHoloCategoryHeadComponent {
  readonly area = input.required<HoloCategoryId>();
  readonly models = input.required<HoloCategoryModel>();
  /** The area's power is cut in the energy zone: the lead reads 0 and the ring dims. */
  readonly off = input(false);

  protected readonly model = computed(() => this.models()[this.area()]);

  protected readonly label = computed(() => LEAD_LABEL[this.model().lead.key]?.labelKey ?? `codex.kpi.${this.model().lead.key}`);
  protected readonly phraseKey = computed(() => (this.area() === 'signature' ? 'codex.holo.head.quieterThan' : 'codex.holo.head.betterThan'));

  private readonly isKm = computed(() => ['emLoad', 'ir'].includes(this.model().lead.key));

  private figOf(v: number | null): Fig | null {
    if (v === null) return null;
    if (this.isKm()) {
      const km = signatureToKm(v);
      return km === null ? null : { num: formatNumber(km, undefined, 1), unit: 'km' };
    }
    const format = LEAD_LABEL[this.model().lead.key]?.format ?? 'int';
    return { num: formatEquippedStatNumber({ labelKey: '', value: v, format }), unit: UNIT[format] ?? '' };
  }

  protected readonly fig = computed<Fig | null>(() => {
    const l = this.model().lead;
    return this.figOf(this.off() && this.area() === 'offensive' && l.value !== null ? 0 : l.value);
  });

  protected readonly median = computed<{ text: string; delta: { text: string; better: boolean } | null } | null>(() => {
    const l = this.model().lead;
    const m = this.figOf(l.median);
    if (!m) return null;
    const text = m.unit ? `${m.num} ${m.unit}` : m.num;
    if (l.value === null || l.median === null) return { text, delta: null };
    const diff = this.isKm() ? (signatureToKm(l.value) ?? 0) - (signatureToKm(l.median) ?? 0) : l.value - l.median;
    const d = this.figOf(this.isKm() ? null : Math.abs(diff));
    const mag = this.isKm() ? formatNumber(Math.abs(diff), undefined, 1) : d?.num;
    if (!mag || /^0([.,]0*)?$/.test(mag)) return { text, delta: null };
    const better = l.lowerIsBetter ? diff < 0 : diff > 0;
    return { text, delta: { text: `${diff > 0 ? '+' : '−'}${mag}`, better } };
  });

  /** Signature only: which of IR / EM gives the ship away from farther. */
  protected readonly hint = computed<string | null>(() => {
    if (this.area() !== 'signature') return null;
    const d = this.models().signature.detail;
    if (d.emKm === null || d.irKm === null) return null;
    return d.emKm >= d.irKm ? 'EM' : 'IR';
  });

  protected readonly subs = computed<HeadSub[]>(() => {
    const m = this.models();
    const sheet = m.sheet;
    const num = (v: number | null | undefined, format: EquippedStatFormat): string =>
      v == null ? '—' : `${formatEquippedStatNumber({ labelKey: '', value: v, format })}${UNIT[format] ? ' ' + UNIT[format] : ''}`;
    const km = (v: number | null): string => (v === null ? '—' : `${formatNumber(v, undefined, 1)} km`);
    switch (this.area()) {
      case 'offensive':
        return [
          { labelKey: 'codex.kpi.burstDps', text: num(sheet.burstDps, 'perSec').replace(' /s', '/s') },
          { labelKey: 'codex.kpi.alpha', text: num(sheet.alpha, 'dec') },
        ];
      case 'defensive':
        return [
          { labelKey: 'codex.kpi.shieldRegen', text: num(sheet.shieldRegen, 'perSec').replace(' /s', '/s') },
          { labelKey: 'codex.kpi.hullHp', text: num(sheet.hullHp, 'int') },
        ];
      case 'movement':
        return [
          { labelKey: 'codex.holo.head.maxSpeed', text: num(m.movement.detail.maxSpeed, 'mps') },
          { labelKey: 'codex.kpi.boost', text: num(m.movement.detail.boost, 'mps') },
        ];
      default:
        return [
          { labelKey: 'codex.holo.head.irKm', text: km(m.signature.detail.irKm) },
          { labelKey: 'codex.holo.head.csKm', text: km(m.signature.detail.crossSectionKm) },
        ];
    }
  });
}
