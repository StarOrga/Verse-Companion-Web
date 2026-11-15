import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';
import { AnalyticsService } from '../../core/analytics.service';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { ItemPathService } from '../../hq/data/item-path.service';
import { WishlistStore } from '../../hq/data/wishlist.store';
import { cleanLiveryName } from '../codex-detail.component';
import { AKTE_TAB_PREF_KEY, CodexHoloAkteComponent, akteProse } from './codex-holo-akte.component';

describe('CodexHoloAkteComponent tabs', () => {
  const setup = (): ComponentFixture<CodexHoloAkteComponent> => {
    TestBed.configureTestingModule({
      imports: [CodexHoloAkteComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: AnalyticsService, useValue: { track: vi.fn() } },
        { provide: WishlistStore, useValue: { ensureLoaded: vi.fn().mockResolvedValue(undefined), find: () => null } },
        { provide: ItemPathService, useValue: { currentPlaceDefault: () => 'Bei mir' } },
        { provide: HqInventoryService, useValue: { load: vi.fn().mockResolvedValue(undefined), lastKnownLocation: vi.fn().mockResolvedValue(null), items: signal([]) } },
      ],
    });
    const f = TestBed.createComponent(CodexHoloAkteComponent);
    f.componentRef.setInput('description', 'Eine Beschreibung.');
    f.componentRef.setInput('facts', [{ labelKey: 'codex.holo.akte.maker', value: 'Aegis' }]);
    f.componentRef.setInput('currentSlug', 'aegs_gladius');
    f.detectChanges();
    return f;
  };
  const tabs = (f: ComponentFixture<CodexHoloAkteComponent>) => Array.from(f.nativeElement.querySelectorAll('[role=tab]')) as HTMLButtonElement[];

  beforeEach(() => localStorage.removeItem(AKTE_TAB_PREF_KEY));

  it('starts on the Datenblatt with Vergleichen and the RSI link in one footer row', () => {
    const f = setup();
    expect(tabs(f).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(f.nativeElement.querySelector('.ak-foot a.ak-rsi')).not.toBeNull();
    expect(f.nativeElement.querySelector('.ak-facts')).not.toBeNull();
    expect(f.nativeElement.querySelector('.ak-txt')).toBeNull();
  });

  it('switches to the description and the Kaufen tab and remembers the pick for the next ship', () => {
    const f = setup();
    tabs(f)[1].click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ak-txt')?.textContent).toContain('Eine Beschreibung.');
    expect(f.nativeElement.querySelector('.ak-rsi')).toBeNull();
    tabs(f)[2].click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('sc-codex-holo-buy-tab')).not.toBeNull();
    expect(localStorage.getItem(AKTE_TAB_PREF_KEY)).toBe('buy');
    TestBed.resetTestingModule();
    const g = setup();
    expect(tabs(g)[2].getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the card one fixed size on every tab, with "Nur Bild" in the head', () => {
    const f = setup();
    (f.nativeElement as HTMLElement).style.cssText = 'display:block;height:700px;width:900px';
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ak-head .ak-tg')).not.toBeNull();
    const card = f.nativeElement.querySelector('.ak-card') as HTMLElement;
    const sizes = new Set<string>();
    for (const i of [0, 1, 2]) {
      tabs(f)[i].click();
      f.detectChanges();
      const r = card.getBoundingClientRect();
      sizes.add(`${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    expect(sizes.size).toBe(1);
  });
});

describe('cleanLiveryName', () => {
  it('gives a title-cased acronym its capitals back', () => {
    expect(cleanLiveryName('Gladius Gladius Rp', 'Gladius')).toBe('Gladius RP');
  });

  it('keeps real words and the usual trims', () => {
    expect(cleanLiveryName('Gladius Frostbite Camo Livery', 'Gladius')).toBe('Frostbite Camo');
    expect(cleanLiveryName('Gladius (Standard)', 'Gladius')).toBe('Standard');
  });
});

describe('akteProse', () => {
  it('drops the leading maker and focus lines of a CIG description', () => {
    const raw = 'Hersteller: Aegis Dynamics\nFokus: Leichter Jäger\n\nBei der Gladius handelt es sich um ein älteres Design.';
    expect(akteProse(raw)).toBe('Bei der Gladius handelt es sich um ein älteres Design.');
  });

  it('handles CRLF line ends and English labels', () => {
    expect(akteProse('Manufacturer: Aegis Dynamics\r\nFocus: Light Fighter\r\n\r\nThe Gladius is a fighter.')).toBe('The Gladius is a fighter.');
  });

  it('keeps prose that has no data lines', () => {
    expect(akteProse('Die Gladius ist ein Jäger. Sie ist schnell: sehr schnell.')).toBe('Die Gladius ist ein Jäger. Sie ist schnell: sehr schnell.');
  });

  it('keeps a text that is nothing but data lines', () => {
    expect(akteProse('Hersteller: Aegis Dynamics\nFokus: Leichter Jäger')).toBe('Hersteller: Aegis Dynamics\nFokus: Leichter Jäger');
  });

  it('keeps a long first line that only happens to contain a colon', () => {
    const raw = 'Achtung: Diese Beschreibung beginnt mit einem langen Satz, der weit mehr als eine Datenzeile ist.\nZweite Zeile.';
    expect(akteProse(raw)).toBe(raw);
  });
});
