import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SearchVariantLink, pageLocationOf } from '../../codex/search/codex-search-model';
import { familyFromRows, foldShipFamilies } from '../../codex/search/search-families';
import type { OwnSearchResult } from '../../codex/search/search-own';
import { useViewport } from '../../testing/viewport';
import { fakeEngine, fxGroup, fxHit, setupFusionSearch } from './fusion-search.testing';

@Component({ selector: 'sc-family-page', template: '', standalone: true })
class PageStub {}

const AEGIS = { key: 'manufacturer_aegs', de: 'Aegis Dynamics', en: 'Aegis Dynamics' };
const ships = [
  fxHit('ship', 'AEGS_Gladius', 'Aegis Gladius', { manufacturerName: AEGIS }),
  fxHit('ship', 'AEGS_Gladius_Dunlevy', 'Aegis Gladius Dunlevy', { manufacturerName: AEGIS }),
  fxHit('ship', 'AEGS_Gladius_PIR', 'Aegis Gladius Pirate', { manufacturerName: AEGIS }),
  fxHit('ship', 'AEGS_Gladius_Valiant', 'Aegis Gladius Valiant', { manufacturerName: AEGIS }),
];
const ownLink = (v: string) => ({ link: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v } });
const ownVariants: SearchVariantLink[] = ['Meine Jagd', 'Meine PvP', 'Meine Fracht'].map((label, i) => ({
  id: `c${i + 1}`, label, target: ownLink(`c${i + 1}`), active: i === 0,
}));
/** The own row the hangar search gives for the reader's Gladius — it folds into the family row. */
const own: OwnSearchResult = {
  total: 1,
  rows: [{
    type: 'own', id: 'own-ship-h1', ownKind: 'ship', title: 'Aegis Gladius', ownName: 'Nachtfalke', subtitle: null,
    classNameSlug: 'AEGS_Gladius', qty: null, target: ownLink('c1'), variants: ownVariants,
  }],
};

/**
 * One row per ship family in the fusion bar (C11 / C12): the engine's fold (Standard row, the
 * other models and the reader's own variants as mini links), rendered, clicked, at phone width.
 */
describe('FusionSearchComponent family row', () => {
  afterEach(() => (document.activeElement as HTMLElement | null)?.blur?.());

  async function setupOn(url: string) {
    const fold = foldShipFamilies([fxGroup('ship', ships, 9)], (c) => familyFromRows(ships, c));
    const links = (c: string): SearchVariantLink[] => {
      const key = fold.baseOf.get(c.toLowerCase()) ?? c.toLowerCase();
      return [...(fold.links.get(key) ?? []), ...(key === 'aegs_gladius' ? ownVariants : [])];
    };
    const engine = fakeEngine({
      groups: fold.groups,
      compose: { own, ownVariants: links, shipBaseOf: (c) => fold.baseOf.get(c.toLowerCase()) ?? c.toLowerCase() },
    });
    const s = setupFusionSearch(engine);
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', component: PageStub }]);
    await router.navigateByUrl(url);
    engine.here.set(pageLocationOf(router.url));
    s.fixture.detectChanges();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    return { ...s, engine, navigate };
  }

  function click(target: HTMLElement, init: MouseEventInit = {}): boolean {
    let left = false;
    const swallow = (ev: Event) => {
      left = !ev.defaultPrevented;
      ev.preventDefault();
    };
    // On the anchor itself (after the component's own listener): the mini link stops propagation.
    target.addEventListener('click', swallow);
    target.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init }));
    target.removeEventListener('click', swallow);
    return left;
  }

  const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.group .row')];
  const links = (el: HTMLElement) => [...el.querySelectorAll<HTMLAnchorElement>('.variants a.vl')];

  it('ONE row for Gladius, its models and the own Gladius: Standard anchor, models then own variants as links', async () => {
    const s = await setupOn('/codex/index');
    s.type('gladius');
    expect(rows(s.el).length).toBe(1);
    expect(s.el.querySelector('.group .row a.hit')!.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius');
    const ls = links(s.el);
    // Four shown, the rest behind "+n".
    expect(ls.map((a) => a.textContent?.trim())).toEqual(['Dunlevy', 'Pirate', 'Valiant', 'Meine Jagd', 'search.row.variantsMore']); // the harness loads no translations: "+2"
    expect(ls[2].getAttribute('href')).toBe('/codex/ship/AEGS_Gladius_Valiant');
    expect(ls[3].getAttribute('href')).toBe('/codex/ship/AEGS_Gladius?v=c1');
    expect(ls[4].classList).toContain('more');
  });

  it('on the Valiant page: a normal row to Standard, the Valiant link marked and not a navigation', async () => {
    const s = await setupOn('/codex/ship/AEGS_Gladius_Valiant');
    s.type('valiant');
    expect(rows(s.el).length).toBe(1);
    expect(rows(s.el)[0].classList).not.toContain('current');
    const valiant = links(s.el).find((a) => a.textContent?.trim() === 'Valiant')!;
    expect(valiant.getAttribute('aria-current')).toBe('page');
    expect(links(s.el).filter((a) => a.getAttribute('aria-current')).length).toBe(1);
    click(valiant);
    s.fixture.detectChanges();
    expect(s.cmp.open()).toBe(false);
    expect(s.navigate).not.toHaveBeenCalled();
    expect(s.engine.calls.noteVariantOpened).toBe(1);
  });

  it('on the Standard page: "gladius" greys the row; another model\'s link stays a link and opens like a row', async () => {
    const s = await setupOn('/codex/ship/AEGS_Gladius');
    s.type('gladius');
    expect(rows(s.el)[0].classList).toContain('current');
    expect(s.el.querySelector('.group .row a.hit')!.getAttribute('aria-current')).toBe('page');
    const pirate = links(s.el).find((a) => a.textContent?.trim() === 'Pirate')!;
    expect(pirate.getAttribute('aria-current')).toBeNull();
    // A modified click is the browser's: new tab, the search stays open.
    expect(click(pirate, { ctrlKey: true })).toBe(true);
    s.fixture.detectChanges();
    expect(s.cmp.open()).toBe(true);
    // A plain click goes through the open path (noted, recents) and closes.
    click(pirate);
    s.fixture.detectChanges();
    expect(s.engine.calls.noteVariantOpened).toBe(2);
    expect(s.cmp.open()).toBe(false);
  });

  describe('at phone width', () => {
    useViewport(375, 740);

    it('the mini links wrap inside the row, never past it', async () => {
      const s = await setupOn('/codex/index');
      s.type('gladius');
      const row = rows(s.el)[0];
      const box = row.querySelector<HTMLElement>('.variants')!;
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
      const right = row.getBoundingClientRect().right;
      for (const a of links(s.el)) expect(a.getBoundingClientRect().right).toBeLessThanOrEqual(right + 1);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    });
  });
});
