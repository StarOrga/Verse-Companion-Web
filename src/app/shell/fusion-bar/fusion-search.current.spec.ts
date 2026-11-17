import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { pageLocationOf } from '../../codex/search/codex-search-model';
import type { OwnSearchResult } from '../../codex/search/search-own';
import { fakeEngine, fxGroup, fxHit, setupFusionSearch } from './fusion-search.testing';
import type { StoredRow } from './search-recent-rows';

@Component({ selector: 'sc-current-page', template: '', standalone: true })
class PageStub {}

const AEGIS = { key: 'manufacturer_aegs', de: 'Aegis Dynamics', en: 'Aegis Dynamics' };
const gladius = fxHit('ship', 'AEGS_Gladius', 'Aegis Gladius', { manufacturerName: AEGIS });
const valiant = fxHit('ship', 'AEGS_Gladius_Valiant', 'Aegis Gladius Valiant', { manufacturerName: AEGIS });
const pirate = fxHit('ship', 'AEGS_Gladius_PIR', 'Aegis Gladius Pirate', { manufacturerName: AEGIS });

/**
 * "Du bist hier" in the fusion bar (concept 2026-11-17, note 4): matrix Gladius ·
 * Valiant · Pirate · own variant, the empty field, Enter and the plain click.
 */
describe('FusionSearchComponent current page', () => {
  afterEach(() => (document.activeElement as HTMLElement | null)?.blur?.());

  async function setupOn(url: string, own: OwnSearchResult | null = null) {
    const engine = fakeEngine({ groups: [fxGroup('ship', [gladius, valiant, pirate], 7)], compose: own ? { own } : {} });
    const s = setupFusionSearch(engine);
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', component: PageStub }]);
    await router.navigateByUrl(url);
    engine.here.set(pageLocationOf(router.url));
    s.fixture.detectChanges();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    return { ...s, engine, router, navigate, nav };
  }

  function click(target: HTMLElement, init: MouseEventInit = {}): boolean {
    let left = false;
    const swallow = (ev: Event) => {
      left = !ev.defaultPrevented;
      ev.preventDefault();
    };
    window.addEventListener('click', swallow);
    target.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init }));
    window.removeEventListener('click', swallow);
    return left;
  }

  const names = (el: HTMLElement) => [...el.querySelectorAll('.group .row .nm')].map((n) => n.textContent?.trim());

  it('weak match on Gladius ("gla"): the Gladius row is gone, Valiant and Pirate stay', async () => {
    const s = await setupOn('/codex/ship/AEGS_Gladius');
    s.type('gla');
    expect(names(s.el)).toEqual(['Aegis Gladius Valiant', 'Aegis Gladius Pirate']);
    expect(s.el.querySelector('.row.current')).toBeNull();
  });

  it('near-exact ("gladius"): the row stays first, greyed, aria-current, no CTA and no icons', async () => {
    const s = await setupOn('/codex/ship/AEGS_Gladius?view=holo');
    s.type('gladius');
    const row = s.el.querySelector('.group .row') as HTMLElement;
    expect(row.classList).toContain('current');
    const a = row.querySelector('a.hit') as HTMLAnchorElement;
    expect(a.getAttribute('aria-current')).toBe('page');
    expect(row.querySelector('.here')).not.toBeNull();
    expect(row.querySelector('.rt')).toBeNull();
    expect(row.querySelector('sc-item-path')).toBeNull();
    expect(s.el.querySelectorAll('.row.current').length).toBe(1);
  });

  it('Enter on the greyed row only closes: no navigation, URL unchanged', async () => {
    const s = await setupOn('/codex/ship/AEGS_Gladius?view=holo#akte');
    const before = s.router.url;
    s.type('gladius');
    // The greyed row is an arrow stop like any row.
    s.key('ArrowDown');
    expect(s.cmp.activeOption()?.type === 'row' && s.cmp.activeOption()).toEqual(expect.objectContaining({ row: expect.objectContaining({ current: true }) }));
    s.key('Enter');
    s.fixture.detectChanges();
    expect(s.cmp.open()).toBe(false);
    expect(s.navigate).not.toHaveBeenCalled();
    expect(s.nav).not.toHaveBeenCalled();
    expect(s.router.url).toBe(before);
  });

  it('a plain click on the greyed row only closes; a Ctrl+click is left to the browser', async () => {
    const s = await setupOn('/codex/ship/AEGS_Gladius');
    s.type('gladius');
    const left = click(s.el.querySelector('.row.current a.hit') as HTMLElement, { ctrlKey: true });
    expect(left).toBe(true);
    expect(s.cmp.open()).toBe(true);
    const plain = click(s.el.querySelector('.row.current a.hit') as HTMLElement);
    s.fixture.detectChanges();
    expect(plain).toBe(false);
    expect(s.cmp.open()).toBe(false);
    expect(s.navigate).not.toHaveBeenCalled();
    expect(s.router.url).toBe('/codex/ship/AEGS_Gladius');
  });

  it('on Valiant and on Pirate the other hulls stay ordinary rows', async () => {
    const v = await setupOn('/codex/ship/AEGS_Gladius_Valiant');
    v.type('gladius');
    expect(names(v.el)).toEqual(['Aegis Gladius', 'Aegis Gladius Pirate']);
    TestBed.resetTestingModule();
    const p = await setupOn('/codex/ship/AEGS_Gladius_PIR');
    p.type('gladius pirate');
    expect(p.el.querySelector('.row.current .nm')?.textContent?.trim()).toBe('Aegis Gladius Pirate');
  });

  it('own variant page: one own row with variant mini links, the open one marked and not a navigation', async () => {
    const link = (v: string) => ({ link: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v } });
    const own: OwnSearchResult = {
      total: 1,
      rows: [{
        type: 'own', id: 'own-ship-h1', ownKind: 'ship', title: 'Aegis Gladius', ownName: 'Nachtfalke', subtitle: null,
        classNameSlug: 'AEGS_Gladius', qty: null, target: link('c1'),
        variants: [
          { id: 'c1', label: 'Meine Jagd', target: link('c1'), active: true },
          { id: 'c2', label: 'Meine PvP', target: link('c2'), active: false },
          { id: 'c3', label: 'Meine Fracht', target: link('c3'), active: false },
          { id: 'c4', label: 'Meine Rennbuild', target: link('c4'), active: false },
        ],
      }],
    };
    const s = await setupOn('/codex/ship/AEGS_Gladius?v=c2', own);
    s.type('gladius');
    const links = [...s.el.querySelectorAll('.variants a.vl')] as HTMLAnchorElement[];
    expect(links.slice(0, 3).map((a) => a.textContent?.trim())).toEqual(['Meine Jagd', 'Meine PvP', 'Meine Fracht']);
    // Three shown, the fourth behind "+n".
    expect(links.length).toBe(4);
    expect(links[3].classList).toContain('more');
    const here = links[1];
    expect(here.getAttribute('aria-current')).toBe('page');
    expect(links[0].getAttribute('href')).toContain('v=c1');
    expect(links[0].getAttribute('aria-current')).toBeNull();
    click(here);
    s.fixture.detectChanges();
    expect(s.cmp.open()).toBe(false);
    expect(s.navigate).not.toHaveBeenCalled();
    expect(s.engine.calls.noteVariantOpened).toBe(1);
  });

  it('empty field: "Zuletzt geöffnet" leaves out the current page and backfills to three', async () => {
    const s = await setupOn('/codex/ship/AEGS_Gladius');
    const stored = (slug: string, name: string): StoredRow => ({
      type: 'hit', id: `hit-ship-${slug}`, hit: fxHit('ship', slug, name), target: { link: ['/codex', 'ship', slug], queryParams: null },
      outside: false, owned: null, fit: null, signal: { recent: false, owned: false, popular: false },
    });
    s.cmp.recentRows.set([stored('AEGS_Gladius', 'Aegis Gladius'), stored('A1', 'One'), stored('A2', 'Two'), stored('A3', 'Three')]);
    s.field.click();
    s.fixture.detectChanges();
    expect(names(s.el)).toEqual(['One', 'Two', 'Three']);
  });
});
