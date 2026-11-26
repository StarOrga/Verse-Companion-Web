import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloPerspectivesComponent } from './codex-holo-perspectives.component';
import { AnalyticsService } from '../../core/analytics.service';
import type { HoloColumnRow, HoloColumnView } from './codex-holo-columns';

function row(key: string, over: Partial<HoloColumnRow> = {}): HoloColumnRow {
  return { key, labelKey: `codex.kpi.short.${key}`, value: '100', cmp: null, deltaText: null, savedText: null, ...over };
}

function col(id: HoloColumnView['id'], over: Partial<HoloColumnView> = {}): HoloColumnView {
  return { id, titleKey: `codex.holo.stage.perspective.${id}`, focus: false, quiet: false, rows: [], groups: [], gaps: [], ...over };
}

const COLUMNS: HoloColumnView[] = [
  col('offensive', {
    focus: true,
    rows: [
      row('sustainedDps', { value: '1.310/s', cmp: { tone: 'up', fill: 20, delta: 130, savedAt: 57 }, deltaText: '+130', savedText: 'Gespeichert: 1.250/s' }),
      row('burstDps', { value: '1.640/s' }),
    ],
    groups: [{
      topic: 'weapons',
      rows: [row('gun:KLWE', { labelKey: null, label: '2 × KLWE Laser Repeater S3', ports: [{ label: 'Wing L', value: '320/s' }, { label: 'Wing R', value: '320/s' }] })],
    }],
    gaps: [{ labelKey: 'codex.kpi.short.missiles', reasonKey: 'codex.summary.gap.noMissiles' }],
  }),
  col('defensive', { rows: [row('shieldHp')] }),
  col('movement', { quiet: true, rows: [row('scm', { cmp: { tone: null, fill: 0, delta: null, savedAt: 40 }, savedText: 'Gespeichert: 200 m/s' })] }),
  col('signature', { rows: [row('ir', { value: '7.100', cmp: { tone: 'down', fill: 18, delta: 700, savedAt: null }, deltaText: '+700' })] }),
];

describe('CodexHoloPerspectivesComponent (value list per Einsatz, bar against Werk)', () => {
  let track: ReturnType<typeof vi.fn>;

  function setup(inputs: Record<string, unknown> = {}): ComponentFixture<CodexHoloPerspectivesComponent> {
    track = vi.fn();
    TestBed.configureTestingModule({
      imports: [CodexHoloPerspectivesComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' }), { provide: AnalyticsService, useValue: { track } }],
    });
    const fixture = TestBed.createComponent(CodexHoloPerspectivesComponent);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('missionId', 'combat');
    fixture.componentRef.setInput('layout', 'row');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: ComponentFixture<CodexHoloPerspectivesComponent>): HTMLElement => f.nativeElement as HTMLElement;
  const colEl = (f: ComponentFixture<CodexHoloPerspectivesComponent>, id: string): HTMLElement => el(f).querySelector<HTMLElement>(`article.ptile[data-p="${id}"]`)!;

  afterEach(() => TestBed.resetTestingModule());

  it('keeps the four columns in the strip order and marks focus and quiet', () => {
    const f = setup();
    expect(Array.from(el(f).querySelectorAll('article.ptile')).map((a) => a.getAttribute('data-p'))).toEqual(['offensive', 'defensive', 'movement', 'signature']);
    expect(colEl(f, 'offensive').classList).toContain('focus');
    expect(colEl(f, 'movement').classList).toContain('quiet');
  });

  it('shows no rank: no ring, no P-number, no rank sentence', () => {
    const f = setup();
    expect(el(f).querySelector('.gauge, .pp, .say, .ghost')).toBeNull();
    expect(el(f).textContent).not.toMatch(/P\d{1,3}\b/);
  });

  it('a changed row draws the bar from the centre with its delta in the tone of the metric', () => {
    const f = setup();
    const lead = colEl(f, 'offensive').querySelector<HTMLElement>('.vr.first')!;
    expect(lead.querySelector('.v')!.textContent).toBe('1.310/s');
    const fill = lead.querySelector<HTMLElement>('.dv i.up')!;
    expect(fill.style.width).toBe('20%');
    expect(lead.querySelector('.dd')!.textContent!.trim()).toBe('+130');
    expect(lead.querySelector('.dd')!.classList).toContain('good');
    const ir = colEl(f, 'signature').querySelector<HTMLElement>('.vr')!;
    expect(ir.querySelector('.dv i.down')).not.toBeNull();
    expect(ir.querySelector('.dd')!.classList).toContain('bad');
  });

  it('marks the saved value as a tick with an accessible label, also on an unchanged row', () => {
    const f = setup();
    const tick = colEl(f, 'offensive').querySelector<HTMLElement>('.vr.first .tick')!;
    expect(tick.getAttribute('aria-label')).toBe('Gespeichert: 1.250/s');
    expect(tick.style.getPropertyValue('--at')).toBe('57%');
    const scm = colEl(f, 'movement').querySelector<HTMLElement>('.vr')!;
    expect(scm.querySelector('.tick')).not.toBeNull();
    expect(scm.querySelector('.dv i')).toBeNull();
  });

  it('a row equal to Werk shows only its value', () => {
    const f = setup();
    const burst = colEl(f, 'offensive').querySelectorAll<HTMLElement>('.vr')[1];
    expect(burst.querySelector('.dv.none')).not.toBeNull();
    expect(burst.querySelector('.tick')).toBeNull();
    expect(burst.querySelector('.dd')!.textContent!.trim()).toBe('');
  });

  it('"Alle Werte" continues the list in the column, groups by topic, counts the gaps and logs the open', () => {
    const f = setup();
    const off = colEl(f, 'offensive');
    expect(off.querySelector('.grp')).toBeNull();
    off.querySelector<HTMLButtonElement>('.tile-expand')!.click();
    f.detectChanges();
    expect(off.querySelector('.grp')!.textContent).toContain('codex.holo.col.topic.weapons');
    expect(off.querySelector('sc-codex-offensive-panel')).toBeNull();
    expect(track).toHaveBeenCalledWith('codex:perspective_detail_open', { perspective: 'offensive', mission: 'combat' });
    const gaps = off.querySelector<HTMLButtonElement>('.gaps')!;
    expect(gaps.textContent).toContain('codex.holo.col.gapsOne');
    expect(off.querySelector('.gap-list')).toBeNull();
    gaps.click();
    f.detectChanges();
    expect(off.querySelector('.gap-list')!.textContent).toContain('codex.summary.gap.noMissiles');
  });

  it('a grouped weapon row opens to its ports', () => {
    const f = setup();
    const off = colEl(f, 'offensive');
    off.querySelector<HTMLButtonElement>('.tile-expand')!.click();
    f.detectChanges();
    const toggle = off.querySelector<HTMLButtonElement>('.pk')!;
    expect(toggle.textContent).toContain('2 × KLWE Laser Repeater S3');
    expect(off.querySelectorAll('.vr.port').length).toBe(0);
    toggle.click();
    f.detectChanges();
    expect(Array.from(off.querySelectorAll('.vr.port .k')).map((k) => k.textContent)).toEqual(['Wing L', 'Wing R']);
  });

  it('"Alle Werte aller vier" opens every column', () => {
    const f = setup();
    el(f).querySelector<HTMLButtonElement>('.all-expand')!.click();
    f.detectChanges();
    expect(f.componentInstance.allOpen()).toBe(true);
    expect(track).toHaveBeenCalledWith('codex:perspective_detail_open', { perspective: 'all', mission: 'combat' });
  });

  it('pulses only the named column', () => {
    const f = setup({ pulse: 'defensive' });
    expect(colEl(f, 'defensive').classList).toContain('pulse');
    expect(colEl(f, 'offensive').classList).not.toContain('pulse');
  });
});
