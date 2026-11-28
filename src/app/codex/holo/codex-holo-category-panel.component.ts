// Fold-out panel of one strip cell (concept holotisch-unten r3, s4..s7, zone 4): the story behind
// an area's lead number, drawn in plain CSS bars (no chart library). The strip owns where it sits
// (over the parts area, at most a third of the screen); this component owns what it says.
// Whatever the hull lacks is a muted gap, never a crash.
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { EquippedStatFormat, formatEquippedStat } from '../codex-equipped-stats';
import { formatNumber } from '../codex-format';
import type { SustainedLimit } from '../codex-sustained-dps';
import { HoloCategoryId, HoloCategoryModel } from './holo-category-model';

interface Bar {
  labelKey: string;
  text: string;
  /** 0..100, null = a gap (no bar). */
  pct: number | null;
}

interface TimelineSeg {
  from: number;
  to: number | null;
  widthPct: number;
  heightPct: number;
  dps: number;
  limiter: SustainedLimit | null;
}

const MIN_SEG_PCT = 3;

function pctOf(v: number | null, max: number): number | null {
  if (v === null || !(max > 0)) return null;
  return Math.max(2, Math.min(100, (v / max) * 100));
}

@Component({
  selector: 'sc-codex-holo-category-panel',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-p]': 'area()' },
  template: `
    @switch (area()) {
      @case ('offensive') {
        <h3 class="pt">{{ 'codex.holo.panel.offensive.title' | translate }}</h3>
        @if (timeline(); as t) {
          @let tk = takeaway();
          @let tkText = tk.key | translate: { sec: tk.sec, limiter: tk.limiterKey ? (tk.limiterKey | translate) : '', sustained: tk.sustained, median: tk.median };
          <div class="tl" role="img" [attr.aria-label]="tkText">
            <div class="plot">
              @for (s of t.segs; track $index) {
                <span class="seg" [style.inline-size.%]="s.widthPct" [style.block-size.%]="s.heightPct"></span>
              }
              @if (t.medianPct !== null) {
                <span class="median" [style.inset-block-end.%]="t.medianPct"></span>
              }
            </div>
            <div class="axis" aria-hidden="true">
              @for (tick of t.ticks; track tick.sec) {
                <span [style.inset-inline-start.%]="tick.pct">{{ tick.text }}</span>
              }
            </div>
          </div>
          <ul class="phases">
            @for (s of t.segs; track $index) {
              <li>
                <b>{{ fmtDps(s.dps) }}</b>
                @if (s.to !== null) {
                  {{ 'codex.holo.panel.offensive.phaseUntil' | translate: { sec: fmt(s.to, 1) } }}
                  @if (s.limiter) { · {{ 'codex.holo.panel.limiter.' + s.limiter | translate }} }
                } @else {
                  {{ 'codex.holo.panel.offensive.phaseOpen' | translate }}
                }
              </li>
            }
          </ul>
          @if (t.medianPct !== null) {
            <p class="legend"><span class="dash" aria-hidden="true"></span>{{ 'codex.holo.panel.offensive.classMedian' | translate }}</p>
          }
          <p class="take">{{ tkText }}</p>
          @if (!t.complete) { <p class="gap">{{ 'codex.holo.panel.offensive.incomplete' | translate }}</p> }
        } @else {
          <p class="gap">{{ 'codex.holo.panel.offensive.noTimeline' | translate }}</p>
        }
        <div class="bars">
          @for (b of offBars(); track b.labelKey) {
            <div class="bar" [class.is-gap]="b.pct === null">
              <span class="k">{{ b.labelKey | translate }}</span>
              <span class="track" aria-hidden="true"><span class="fill" [style.inline-size.%]="b.pct ?? 0"></span></span>
              <span class="v">{{ b.text }}</span>
            </div>
          }
          <div class="bar sep" [class.is-gap]="missileBar().pct === null">
            <span class="k">{{ missileBar().labelKey | translate }}</span>
            <span class="track" aria-hidden="true"><span class="fill" [style.inline-size.%]="missileBar().pct ?? 0"></span></span>
            <span class="v">{{ missileBar().text }}</span>
          </div>
        </div>
        @if (gunnerPct(); as g) { <p class="note">{{ 'codex.holo.panel.offensive.gunner' | translate: { pct: g } }}</p> }
      }
      @case ('defensive') {
        <h3 class="pt">{{ 'codex.holo.panel.defensive.title' | translate }}</h3>
        <div class="bars">
          @for (b of ehpBars(); track b.labelKey) {
            <div class="bar" [class.is-gap]="b.pct === null">
              <span class="k">{{ b.labelKey | translate }}</span>
              <span class="track" aria-hidden="true"><span class="fill" [style.inline-size.%]="b.pct ?? 0"></span></span>
              <span class="v">{{ b.text }}</span>
            </div>
          }
        </div>
        <dl class="facts">
          <div><dt>{{ 'codex.holo.panel.defensive.shieldDown' | translate }}</dt>
            <dd [class.gap]="shieldDown() === null">{{ shieldDown() ?? '—' }}</dd></div>
          <div><dt>{{ 'codex.holo.panel.defensive.regenDelay' | translate }}</dt>
            <dd [class.gap]="regenDelay() === null">{{ regenDelay() ?? '—' }}</dd></div>
          <div><dt>{{ 'codex.holo.panel.defensive.regenFull' | translate }}</dt>
            <dd [class.gap]="regenFull() === null">{{ regenFull() ?? '—' }}</dd></div>
          <div><dt>{{ 'codex.holo.panel.defensive.armor' | translate }}</dt>
            <dd [class.gap]="armorText() === null">{{ armorText() ?? '—' }}</dd></div>
        </dl>
      }
      @case ('movement') {
        <h3 class="pt">{{ 'codex.holo.panel.movement.title' | translate }}</h3>
        <div class="bars">
          @for (b of speedBars(); track b.labelKey) {
            <div class="bar" [class.is-gap]="b.pct === null">
              <span class="k">{{ b.labelKey | translate }}</span>
              <span class="track" aria-hidden="true"><span class="fill" [style.inline-size.%]="b.pct ?? 0"></span></span>
              <span class="v">{{ b.text }}</span>
            </div>
          }
        </div>
        <dl class="facts">
          @for (r of moveFacts(); track r.labelKey) {
            <div><dt>{{ r.labelKey | translate }}</dt><dd [class.gap]="r.gap">{{ r.text }}</dd></div>
          }
          <div><dt>{{ 'codex.holo.panel.movement.acceleration' | translate }}</dt>
            <dd class="gap">{{ 'codex.holo.panel.noData' | translate }}</dd></div>
        </dl>
      }
      @case ('signature') {
        <h3 class="pt">{{ 'codex.holo.panel.signature.title' | translate }}</h3>
        <div class="bars">
          @for (b of sigBars(); track b.labelKey) {
            <div class="bar" [class.is-gap]="b.pct === null">
              <span class="k">{{ b.labelKey | translate }}</span>
              <span class="track" aria-hidden="true"><span class="fill" [style.inline-size.%]="b.pct ?? 0"></span></span>
              <span class="v">{{ b.text }}</span>
            </div>
          }
        </div>
        <p class="legend">{{ 'codex.holo.panel.signature.lowerBetter' | translate }}</p>
        <h4 class="st">{{ 'codex.holo.panel.signature.emSources' | translate }}</h4>
        @if (emSourceBars().length > 0) {
          <div class="bars">
            @for (b of emSourceBars(); track b.labelKey) {
              <div class="bar">
                <span class="k">{{ b.labelKey | translate }}</span>
                <span class="track" aria-hidden="true"><span class="fill" [style.inline-size.%]="b.pct ?? 0"></span></span>
                <span class="v">{{ b.text }}</span>
              </div>
            }
          </div>
        } @else {
          <p class="gap">{{ 'codex.holo.panel.noData' | translate }}</p>
        }
        <div class="bars">
          <div class="bar" [class.is-gap]="coolBar().pct === null">
            <span class="k">{{ coolBar().labelKey | translate }}</span>
            <span class="track" aria-hidden="true"><span class="fill" [class.over]="coolOver()" [style.inline-size.%]="coolBar().pct ?? 0"></span></span>
            <span class="v">{{ coolBar().text }}</span>
          </div>
        </div>
        @if (decoyParams(); as d) {
          <p class="note">{{ 'codex.holo.panel.signature.decoys' | translate: d }}</p>
        } @else {
          <p class="gap">{{ 'codex.holo.panel.signature.decoysNone' | translate }}</p>
        }
      }
    }
  `,
  styles: [
    `
      :host { display: block; --p: var(--holo-p-offensive); color: var(--sc-fg-1); font-size: max(13px, var(--sc-fs-floor)); }
      :host([data-p='defensive']) { --p: var(--holo-p-defensive); }
      :host([data-p='movement']) { --p: var(--holo-p-movement); }
      :host([data-p='signature']) { --p: var(--holo-p-signature); }
      .pt { margin: 0 0 8px; font-family: var(--sc-font-display); font-weight: 400; font-size: max(13px, var(--sc-fs-floor)); letter-spacing: 0.04em; color: var(--sc-fg-0); }
      .st { margin: 12px 0 4px; font-family: var(--sc-font-display); font-weight: 400; text-transform: uppercase; letter-spacing: 0.12em; font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .gap, .gap-text { color: var(--sc-fg-2); font-style: italic; margin: 4px 0; }
      .note { margin: 8px 0 0; color: var(--sc-fg-1); }
      .take { margin: 8px 0 0; color: var(--sc-fg-0); }
      .legend { display: flex; align-items: center; gap: 8px; margin: 4px 0 0; color: var(--sc-fg-2); }
      .legend .dash { inline-size: 20px; border-block-start: 2px dashed var(--sc-fg-2); }
      .tl { margin-block: 4px 0; }
      .plot { position: relative; display: flex; align-items: flex-end; block-size: 72px; border-block-end: 1px solid var(--sc-border); background: color-mix(in srgb, var(--p) 5%, transparent); }
      .plot .seg { display: block; background: color-mix(in srgb, var(--p) 55%, transparent); border-inline-end: 1px solid var(--sc-bg-0); min-inline-size: 2px; }
      .plot .median { position: absolute; inset-inline: 0; border-block-start: 2px dashed var(--sc-fg-2); pointer-events: none; }
      .axis { position: relative; block-size: 20px; font-family: var(--font-monospace, monospace); font-size: max(13px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .axis span { position: absolute; translate: -50% 0; white-space: nowrap; }
      .axis span:first-child { translate: 0 0; }
      .phases { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--sc-fg-1); }
      .phases b { font-family: var(--font-monospace, monospace); font-weight: 400; color: var(--sc-fg-0); }
      .bars { display: grid; gap: 4px; margin-block-start: 12px; }
      .bar { display: grid; grid-template-columns: minmax(80px, 140px) minmax(40px, 1fr) minmax(64px, auto); align-items: center; gap: 12px; }
      .bar.sep { margin-block-start: 8px; padding-block-start: 8px; border-block-start: 1px dashed var(--sc-border); }
      .bar .k { min-inline-size: 0; color: var(--sc-fg-2); overflow-wrap: anywhere; hyphens: auto; }
      .bar .v { text-align: end; font-family: var(--font-monospace, monospace); font-variant-numeric: tabular-nums; color: var(--sc-fg-0); white-space: nowrap; }
      .bar.is-gap .v { color: var(--sc-fg-2); }
      .track { display: block; block-size: 8px; border-radius: 2px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); overflow: hidden; }
      .fill { display: block; block-size: 100%; border-radius: 2px; background: color-mix(in srgb, var(--p) 70%, transparent); }
      .fill.over { background: var(--sc-warning); }
      .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 16px; margin: 12px 0 0; }
      .facts dt { color: var(--sc-fg-2); }
      .facts dd { margin: 0; font-family: var(--font-monospace, monospace); font-variant-numeric: tabular-nums; color: var(--sc-fg-0); }
      .facts dd.gap { color: var(--sc-fg-2); font-family: inherit; font-style: italic; }
    `,
  ],
})
export class CodexHoloCategoryPanelComponent {
  readonly area = input.required<HoloCategoryId>();
  readonly models = input.required<HoloCategoryModel>();

  private readonly sheet = computed(() => this.models().sheet);

  protected fmt(v: number, decimals = 0): string {
    return formatNumber(v, undefined, decimals);
  }

  protected fmtDps(v: number): string {
    return formatEquippedStat({ labelKey: '', value: v, format: 'perSec' });
  }

  private stat(v: number | null | undefined, format: EquippedStatFormat): string | null {
    return v == null ? null : formatEquippedStat({ labelKey: '', value: v, format });
  }

  private bar(labelKey: string, v: number | null | undefined, max: number, format: EquippedStatFormat): Bar {
    const value = v ?? null;
    return { labelKey, text: this.stat(value, format) ?? '—', pct: pctOf(value, max) };
  }

  // ── Offensive ──
  private readonly classMedian = computed(() => {
    const lead = this.models().offensive.lead;
    return lead.key === 'sustainedDps' ? lead.median : null;
  });

  protected readonly timeline = computed(() => {
    const t = this.models().offensive.detail.timeline;
    if (t.phases.length === 0) return null;
    const finite = t.phases.filter((p) => p.untilSec !== null);
    const lastFinite = finite.length > 0 ? finite[finite.length - 1].untilSec! : 0;
    const open = t.phases.some((p) => p.untilSec === null);
    const total = open ? Math.max(lastFinite * 1.6, lastFinite + 2, 4) : Math.max(lastFinite, 1);
    const median = this.classMedian();
    const top = Math.max(...t.phases.map((p) => p.dps), median ?? 0, 1) * 1.05;
    let from = 0;
    const segs: TimelineSeg[] = t.phases.map((p) => {
      const to = p.untilSec;
      const end = to ?? total;
      const seg: TimelineSeg = {
        from,
        to,
        widthPct: Math.max(MIN_SEG_PCT, ((end - from) / total) * 100),
        heightPct: Math.max(2, (p.dps / top) * 100),
        dps: p.dps,
        limiter: p.limiter,
      };
      from = end;
      return seg;
    });
    const step = total <= 10 ? 2 : total <= 30 ? 5 : 10;
    const ticks: { sec: number; pct: number; text: string }[] = [];
    for (let s = 0; s <= total + 1e-9; s += step) ticks.push({ sec: s, pct: (s / total) * 100, text: `${formatNumber(s, undefined, 0)} s` });
    return { segs, ticks, complete: t.complete, medianPct: median !== null && median > 0 ? (median / top) * 100 : null };
  });

  /** The one-line takeaway as a key + params; the template resolves it (language changes stay live). */
  protected readonly takeaway = computed(() => {
    const t = this.models().offensive.detail.timeline;
    const med = this.classMedian();
    const sustained = t.complete ? t.sustainedDps : null;
    const base = 'codex.holo.panel.offensive.takeaway';
    const sec = t.fullFireSec == null ? '' : formatNumber(t.fullFireSec, undefined, 1);
    const limiterKey = t.firstLimiter ? `codex.holo.panel.limiterAcc.${t.firstLimiter}` : null;
    const num = (v: number | null) => (v === null ? '' : formatNumber(v, undefined, 0));
    if (t.fullFireSec == null || !limiterKey) {
      return { key: `${base}Open`, sec, limiterKey: null, sustained: num(t.phases[0]?.dps ?? null), median: '' };
    }
    if (sustained === null) return { key: `${base}Partial`, sec, limiterKey, sustained: '', median: '' };
    return { key: med === null ? `${base}NoClass` : base, sec, limiterKey, sustained: num(sustained), median: num(med) };
  });

  protected readonly offBars = computed<Bar[]>(() => {
    const sh = this.sheet();
    const max = Math.max(sh.alpha ?? 0, sh.burstDps ?? 0, sh.sustainedDps ?? 0);
    return [
      this.bar('codex.holo.panel.offensive.alpha', sh.alpha, max, 'int'),
      this.bar('codex.holo.panel.offensive.burst', sh.burstDps, max, 'perSec'),
      this.bar('codex.holo.panel.offensive.sustained', sh.sustainedDps, max, 'perSec'),
    ];
  });

  /** Missiles stand apart: one hit's worth of damage, not part of any gun DPS. */
  protected readonly missileBar = computed<Bar>(() => {
    const v = this.models().offensive.detail.missileDamage;
    return this.bar('codex.holo.panel.offensive.missiles', v !== null && v > 0 ? v : null, v ?? 0, 'int');
  });

  protected readonly gunnerPct = computed(() => {
    const share = this.models().offensive.detail.gunnerShare;
    return share !== null && share > 0 ? Math.round(share * 100) : null;
  });


  // ── Defensive ──
  protected readonly ehpBars = computed<Bar[]>(() => {
    const rows = this.models().defensive.detail.effectiveHp;
    const max = Math.max(0, ...rows.map((r) => r.total ?? 0));
    return rows.map((r) => this.bar(`codex.holo.panel.damage.${r.type}`, r.total, max, 'int'));
  });

  protected readonly shieldDown = computed(() => this.stat(this.models().defensive.detail.shieldDownInSec, 'seconds'));
  protected readonly regenDelay = computed(() => {
    const r = this.models().defensive.detail.regen;
    const a = this.stat(r.delaySec, 'seconds');
    const b = this.stat(r.downedDelaySec, 'seconds');
    return a === null && b === null ? null : [a ?? '—', b ?? '—'].join(' / ');
  });
  protected readonly regenFull = computed(() => this.stat(this.models().defensive.detail.regen.timeToFullSec, 'seconds'));
  protected readonly armorText = computed(() => this.stat(this.models().defensive.detail.armorHp, 'int'));

  // ── Movement ──
  protected readonly speedBars = computed<Bar[]>(() => {
    const m = this.models().movement.detail;
    const max = Math.max(m.scm ?? 0, m.boost ?? 0, m.maxSpeed ?? 0);
    return [
      this.bar('codex.holo.panel.movement.scm', m.scm, max, 'mps'),
      this.bar('codex.holo.panel.movement.boost', m.boost, max, 'mps'),
      this.bar('codex.holo.panel.movement.max', m.maxSpeed, max, 'mps'),
    ];
  });

  protected readonly moveFacts = computed(() => {
    const m = this.models().movement.detail;
    const gap = '—';
    const row = (labelKey: string, v: number | null, format: EquippedStatFormat) => {
      const text = this.stat(v, format);
      return { labelKey, text: text ?? gap, gap: text === null };
    };
    return [
      row('codex.holo.panel.movement.pitch', m.pitch, 'degrees'),
      row('codex.holo.panel.movement.yaw', m.yaw, 'degrees'),
      row('codex.holo.panel.movement.roll', m.roll, 'degrees'),
      row('codex.holo.panel.movement.quantumSpeed', m.quantumSpeed, 'kms'),
      row('codex.holo.panel.movement.quantumRange', m.quantumRange, 'gm'),
    ];
  });

  // ── Signature ──
  private km(v: number | null): string {
    return v === null ? '—' : `${formatNumber(v, undefined, 1)} km`;
  }

  protected readonly sigBars = computed<Bar[]>(() => {
    const s = this.models().signature.detail;
    const max = Math.max(s.irKm ?? 0, s.emKm ?? 0, s.crossSectionKm ?? 0);
    const row = (labelKey: string, v: number | null): Bar => ({ labelKey, text: this.km(v), pct: pctOf(v, max) });
    return [
      row('codex.holo.panel.signature.ir', s.irKm),
      row('codex.holo.panel.signature.em', s.emKm),
      row('codex.holo.panel.signature.crossSection', s.crossSectionKm),
    ];
  });

  protected readonly emSourceBars = computed<Bar[]>(() => {
    const rows = this.models().signature.detail.emSources.filter((r) => r.value > 0);
    const max = Math.max(0, ...rows.map((r) => r.value));
    return rows.map((r) => ({
      labelKey: `codex.holo.panel.emSource.${r.id}`,
      text: r.share === null ? '—' : `${formatNumber(r.share * 100, undefined, 0)} %`,
      pct: pctOf(r.value, max),
    }));
  });

  private readonly cool = computed(() => this.models().signature.detail.coolingLoadPct);
  protected readonly coolOver = computed(() => (this.cool() ?? 0) > 100);
  protected readonly coolBar = computed<Bar>(() => {
    const v = this.cool();
    return {
      labelKey: 'codex.holo.panel.signature.cooling',
      text: v === null ? '—' : `${formatNumber(v, undefined, 0)} %`,
      pct: v === null ? null : Math.max(2, Math.min(100, v)),
    };
  });

  protected readonly decoyParams = computed(() => {
    const d = this.models().signature.detail.decoys;
    if (d.ir === null && d.em === null && d.crossSection === null) return null;
    const n = (v: number | null) => (v === null ? '—' : formatNumber(v, undefined, 0));
    return { ir: n(d.ir), em: n(d.em), cs: n(d.crossSection) };
  });
}
