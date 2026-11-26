import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { NOMAD_SHIP_STATS, nomadOccupants } from '../testing/nomad-power.fixture';
import { CodexHoloEnergyComponent } from './codex-holo-energy.component';
import type { EnergyConsequences } from './holo-category-model';

describe('CodexHoloEnergyComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [CodexHoloEnergyComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(CodexHoloEnergyComponent);
    fixture.componentRef.setInput('occupants', nomadOccupants());
    fixture.componentRef.setInput('shipStats', NOMAD_SHIP_STATS);
    fixture.componentRef.setInput('schemaVersion', 3);
    fixture.componentRef.setInput('baseLead', 506);
    const emitted: (EnergyConsequences | null)[] = [];
    fixture.componentInstance.changed.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, emitted };
  }
  const col = (el: HTMLElement, key: string) => el.querySelector<HTMLElement>(`.col[data-key="${key}"]`)!;

  it('draws one column per consumer group, grouped under the four areas', () => {
    const { el } = setup();
    expect(col(el, 'weapons')).toBeTruthy();
    expect(col(el, 'shields')).toBeTruthy();
    expect(el.querySelectorAll('.grp').length).toBeGreaterThanOrEqual(3);
    expect(el.querySelector('.grp[data-p="offensive"] .grp-l')).toBeTruthy();
    expect(el.querySelector('.chip')).toBeNull();
  });

  it('"Waffen aus" sets weapons to 0, shows the chips and the lead drops to 0', () => {
    const { fixture, el, emitted } = setup();
    col(el, 'weapons').querySelector<HTMLButtonElement>('.gbtn')!.click();
    fixture.detectChanges();
    expect(col(el, 'weapons').querySelector('.cnt')!.textContent).toMatch(/^0\//);
    const chips = el.querySelector('[data-testid="en-chips"]')!;
    expect(chips.querySelector('.chip.is-worse')!.textContent).toContain('→');
    expect(chips.querySelector('.chip.is-worse')!.textContent).toContain('0');
    expect(emitted.at(-1)?.offensiveLead).toBe(0);
    expect(emitted.at(-1)?.energy.sheet.weaponsCut).toBe(true);
  });

  it('a stepper lowers a column by one segment and the reset action brings everything back', () => {
    const { fixture, el, emitted } = setup();
    const before = col(el, 'shields').querySelector('.cnt')!.textContent!;
    col(el, 'shields').querySelectorAll<HTMLButtonElement>('.stp')[0].click();
    fixture.detectChanges();
    expect(col(el, 'shields').querySelector('.cnt')!.textContent).not.toBe(before);
    const reset = el.querySelector<HTMLButtonElement>('button.reset')!;
    expect(reset.disabled).toBe(false);
    reset.click();
    fixture.detectChanges();
    expect(col(el, 'shields').querySelector('.cnt')!.textContent).toBe(before);
    expect(emitted.at(-1)).toBeNull();
    expect(el.querySelector('[data-testid="en-chips"]')).toBeNull();
  });

  it('clicking a lit top segment steps the column down; clicking a dim one raises it', () => {
    const { fixture, el } = setup();
    const w = col(el, 'weapons');
    const used = Number(w.querySelector('.cnt')!.textContent!.split('/')[0]);
    w.querySelectorAll<HTMLButtonElement>('.seg')[used - 1].click();
    fixture.detectChanges();
    expect(Number(col(el, 'weapons').querySelector('.cnt')!.textContent!.split('/')[0])).toBe(used - 1);
  });
});
