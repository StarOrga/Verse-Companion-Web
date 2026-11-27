import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';

import type { RankShipInput } from '../codex-rank';
import { NOMAD_SHIP_STATS, nomadOccupants } from '../testing/nomad-power.fixture';
import { CodexHoloCategoryPanelComponent } from './codex-holo-category-panel.component';
import { HoloCategoryId, buildHoloCategoryModels } from './holo-category-model';
import de from '../../../../public/i18n/de.json';

describe('CodexHoloCategoryPanelComponent', () => {
  const ship = { flight: { scmSpeed: 200, maxSpeed: 1000, boostSpeed: 300 }, hull: { hp: 21500, mass: 78000 }, armorHp: null, cargoScu: 24, stats: NOMAD_SHIP_STATS };
  const cohort: RankShipInput[] = Array.from({ length: 10 }, (_, i) => ({
    className: `S${i}`, sizeClass: 1, career: null, sheet: { sustainedDps: 100 + i * 30 },
  }));

  function render(area: HoloCategoryId, opts: { occupants?: ReturnType<typeof nomadOccupants>; cohort?: RankShipInput[] | null } = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CodexHoloCategoryPanelComponent],
      providers: [provideTranslateService({ fallbackLang: 'de' })],
    });
    const models = buildHoloCategoryModels({
      occupants: opts.occupants ?? nomadOccupants(), ship, schemaVersion: 3, cohort: opts.cohort === undefined ? cohort : opts.cohort,
    });
    const t = TestBed.inject(TranslateService);
    t.setTranslation('de', de as never);
    t.use('de');
    const f = TestBed.createComponent(CodexHoloCategoryPanelComponent);
    f.componentRef.setInput('area', area);
    f.componentRef.setInput('models', models);
    f.detectChanges();
    return { el: f.nativeElement as HTMLElement, models };
  }

  it('Offensive: the timeline question, a takeaway line and the missiles apart from the gun bars', () => {
    const { el, models } = render('offensive');
    expect(el.textContent).toContain('Wie lange kann ich voll feuern – und was stoppt mich?');
    if (models.offensive.detail.timeline.phases.length > 0) {
      expect(el.querySelector('.tl')).toBeTruthy();
      expect(el.querySelector('.take')!.textContent).toMatch(/Volles Feuer|Kein Bauteil bremst/);
    } else {
      expect(el.querySelector('.gap')).toBeTruthy();
    }
    expect(el.querySelectorAll('.bar').length).toBe(4);
    expect(el.querySelector('.bar.sep .k')!.textContent).toContain('Raketen');
  });

  it('Offensive: the takeaway names the first limiter in plain German and the class figure', () => {
    const { el, models } = render('offensive');
    const t = models.offensive.detail.timeline;
    if (t.firstLimiter && t.sustainedDps !== null && models.offensive.lead.median !== null) {
      const text = el.querySelector('.take')!.textContent!;
      expect(text).toMatch(/dann bremst (die Hitze|das Magazin|die Energie)/);
      expect(text).toContain('Klasse');
    }
    expect(el.textContent).not.toMatch(/codex\.holo\.panel/);
  });

  it('Verteidigung: regeneration as numbers only, no curve; the damage path as bars', () => {
    const { el } = render('defensive');
    expect(el.textContent).toContain('Schadensweg');
    expect(el.querySelectorAll('.bar').length).toBe(3);
    expect(el.textContent).toContain('Schild weg in');
    expect(el.textContent).toContain('Schild-Pause');
    expect(el.textContent).toContain('Schild wieder voll nach');
    expect(el.querySelector('svg, canvas, path, polyline')).toBeNull();
  });

  it('Bewegung: the speed ladder as bars and the acceleration as a quiet gap', () => {
    const { el } = render('movement');
    expect(el.querySelectorAll('.bar').length).toBe(3);
    const accel = Array.from(el.querySelectorAll('.facts > div')).find((d) => d.textContent!.includes('Beschleunigung'))!;
    expect(accel.querySelector('dd')!.classList).toContain('gap');
    expect(accel.textContent).toContain('keine Daten');
  });

  it('Signatur: IR / EM / Querschnitt in km, cooling load, decoys line', () => {
    const { el } = render('signature');
    const bars = Array.from(el.querySelectorAll('.bar')).map((b) => b.textContent!);
    expect(bars.some((t) => t.includes('Infrarot') && t.includes('km'))).toBe(true);
    expect(el.textContent).toContain('Kühlauslastung');
    expect(el.textContent).toContain('Woher kommt das EM-Signal');
    expect(el.textContent).toContain('Kürzere Distanz ist besser.');
  });

  it('gaps render without a crash: no weapons, no cohort', () => {
    for (const area of ['offensive', 'defensive', 'movement', 'signature'] as const) {
      const { el } = render(area, { occupants: [], cohort: null });
      expect(el.textContent!.length).toBeGreaterThan(10);
      expect(el.textContent).not.toMatch(/NaN|undefined/);
    }
    const { el } = render('offensive', { occupants: [], cohort: null });
    expect(el.querySelector('.gap')!.textContent).toContain('Keine Waffen');
  });
});
