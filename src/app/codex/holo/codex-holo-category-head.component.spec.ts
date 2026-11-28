import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import type { RankShipInput } from '../codex-rank';
import { NOMAD_SHIP_STATS, nomadOccupants } from '../testing/nomad-power.fixture';
import { CodexHoloCategoryHeadComponent } from './codex-holo-category-head.component';
import { buildHoloCategoryModels } from './holo-category-model';

describe('CodexHoloCategoryHeadComponent', () => {
  const ship = { flight: { scmSpeed: 200, maxSpeed: 1000, boostSpeed: 300 }, hull: { hp: 21500, mass: 78000 }, armorHp: null, cargoScu: 24, stats: NOMAD_SHIP_STATS };
  const cohort: RankShipInput[] = Array.from({ length: 10 }, (_, i) => ({
    className: `S${i}`, sizeClass: 1, career: null, sheet: { scm: 100 + i * 30 },
  }));

  function render(area: 'movement' | 'offensive', withCohort: boolean) {
    TestBed.configureTestingModule({
      imports: [CodexHoloCategoryHeadComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    });
    const models = buildHoloCategoryModels({ occupants: nomadOccupants(), ship, schemaVersion: 3, cohort: withCohort ? cohort : null });
    const f = TestBed.createComponent(CodexHoloCategoryHeadComponent);
    f.componentRef.setInput('area', area);
    f.componentRef.setInput('models', models);
    f.detectChanges();
    return { el: f.nativeElement as HTMLElement, models };
  }

  it('shows the lead number, the P-rank ring and the class median with a delta chip', () => {
    const { el, models } = render('movement', true);
    expect(el.querySelector('.num')!.textContent).toContain('200');
    expect(el.querySelector('.unit')!.textContent).toBe('m/s');
    expect(el.querySelector('.ring text')!.textContent).toBe(`P${models.movement.lead.rank}`);
    expect(el.querySelector('.med')!.textContent).toContain('m/s');
    expect(el.querySelector('.med .chip')).toBeTruthy();
  });

  it('draws a marked gap, not a rank, without a class', () => {
    const { el } = render('movement', false);
    expect(el.querySelector('.ring text')!.textContent).toBe('—');
    expect(el.querySelector('.med')).toBeNull();
  });

  it('reads the lead as 0 when the area is cut', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [CodexHoloCategoryHeadComponent], providers: [provideTranslateService({ fallbackLang: 'en' })] });
    const models = buildHoloCategoryModels({ occupants: nomadOccupants(), ship, schemaVersion: 3 });
    const f = TestBed.createComponent(CodexHoloCategoryHeadComponent);
    f.componentRef.setInput('area', 'offensive');
    f.componentRef.setInput('models', models);
    f.componentRef.setInput('off', true);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.hx-head.is-dim')).toBeTruthy();
  });

  it('follows the scaled lead while the weapons column is only reduced', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [CodexHoloCategoryHeadComponent], providers: [provideTranslateService({ fallbackLang: 'en' })] });
    const base = buildHoloCategoryModels({ occupants: nomadOccupants(), ship, schemaVersion: 3 });
    const models = { ...base, offensive: { ...base.offensive, lead: { ...base.offensive.lead, value: 506 } } };
    const f = TestBed.createComponent(CodexHoloCategoryHeadComponent);
    f.componentRef.setInput('area', 'offensive');
    f.componentRef.setInput('models', models);
    f.detectChanges();
    const num = () => (f.nativeElement as HTMLElement).querySelector('.num')!.textContent!;
    expect(num()).toContain('506');
    f.componentRef.setInput('editedLead', 300);
    f.detectChanges();
    expect(num()).toContain('300');
    f.componentRef.setInput('editedLead', null);
    f.detectChanges();
    expect(num()).toContain('506');
  });

  it('says "no class rank" for an empty cohort, never "only 0 ships"', () => {
    const { el } = render('movement', false);
    expect(el.querySelector('.say')!.textContent).not.toMatch(/0/);
    expect(el.querySelector('.say')!.textContent!.trim().length).toBeGreaterThan(0);
  });
});
