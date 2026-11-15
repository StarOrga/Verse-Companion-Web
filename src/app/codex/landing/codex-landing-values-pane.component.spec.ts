import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLandingValuesPaneComponent, SHEET_ROWS } from './codex-landing-values-pane.component';
import { LandingItem, LandingValue } from './codex-landing-data.types';

const value = (key: string, n: number): LandingValue => ({ key, value: n, unit: 'm/s', classAvg: n / 2, classMax: n * 2, higherIsBetter: true });

function ship(values: LandingValue[]): LandingItem {
  return {
    category: 'ship', kind: 'ship', className: 'ANVL_Liberator', name: 'Anvil Liberator',
    eyebrow: { manufacturer: 'Anvil Aerospace', descriptor: 'Carrier' }, detailRoute: ['/codex', 'ship', 'ANVL_Liberator'],
    imageUrl: null, previewUrl: null,
    overview: [{ id: 'role', value: 'Carrier' }, { id: 'size', value: null }, { id: 'manufacturer', value: 'Anvil Aerospace' }],
    topValues: values,
  } as LandingItem;
}

describe('Codex landing data sheet: identity, seven plain values, one action', () => {
  function render(it: LandingItem): HTMLElement {
    TestBed.configureTestingModule({ imports: [CodexLandingValuesPaneComponent], providers: [provideRouter([]), provideTranslateService()] });
    const fixture = TestBed.createComponent(CodexLandingValuesPaneComponent);
    const host = fixture.nativeElement as HTMLElement;
    host.style.cssText = 'display:flex;flex-direction:column;position:absolute;left:0;top:0;width:280px;height:700px;';
    document.body.appendChild(host);
    fixture.componentRef.setInput('item', it);
    fixture.componentRef.setInput('still', true);
    fixture.detectChanges();
    return host;
  }

  it(`lists at most ${SHEET_ROWS} values as rows without bars, its own values before the callout ones`, () => {
    const keys = ['armorHp', 'hull.hp', 'flight.maxSpeed', 'flight.scmSpeed', 'cargoScu', 'crew', 'mass', 'quantum.range', 'extra'];
    const host = render(ship(keys.map((k, i) => value(k, 10 + i))));
    const rows = Array.from(host.querySelectorAll<HTMLElement>('.row'));
    expect(rows.length).toBe(SHEET_ROWS);
    expect(host.querySelector('.bar')).toBeNull();
    const firstCallout = rows.findIndex((r) => r.classList.contains('callout'));
    if (firstCallout !== -1) expect(rows.slice(firstCallout).every((r) => r.classList.contains('callout'))).toBe(true);
    host.remove();
  });

  it('heads with the manufacturer and the role (the arm at the hologram no longer names the maker)', () => {
    const host = render(ship([value('flight.scmSpeed', 115)]));
    expect(host.querySelector('.id .maker')!.textContent).toContain('Anvil Aerospace');
    expect(host.querySelector('.id .cls')!.textContent).toContain('Carrier');
    expect(host.querySelector('.id .cls')!.textContent, 'the maker is not repeated').not.toContain('Anvil');
    host.remove();
  });

  it('ends with the item action: a secondary scAction anchor to the detail page', () => {
    const host = render(ship([value('flight.scmSpeed', 115)]));
    const go = host.querySelector<HTMLAnchorElement>('a.go')!;
    expect(go.getAttribute('href')).toBe('/codex/ship/ANVL_Liberator');
    expect(go.classList.contains('sc-action--secondary')).toBe(true);
    expect(go.classList.contains('sc-action--primary')).toBe(false);
    host.remove();
  });
});
