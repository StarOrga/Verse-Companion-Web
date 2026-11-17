// "Du bist hier" (concept 2026-11-17, note 4) and one own row per ship (d-variant).
// Pure: the rule lives in the model / compose layer the three search surfaces share.
import type { HangarShip, HangarShipConfig } from '../../hangar/hangar.types';
import { searchContextOf } from '../../shell/fusion-bar/search-context';
import type { PolyHitKind, PolySearchHit } from '../codex-poly-search';
import {
  CodexSearchGroup,
  FRESH_SHIPS_SHOWN,
  SEARCH_CATEGORY_SHORTCUTS,
  applyCurrentPage,
  hitKey,
  isCurrentTarget,
  isCurrentVariant,
  pageLocationOf,
  resultOptions,
  suggestionOptions,
} from './codex-search-model';
import { composeSearchResult, isNearExactRow } from './search-compose';
import { searchOwn } from './search-own';
import type { SearchResultRow } from './search-result-model';

const AEGIS = { key: 'manufacturer_aegs', de: 'Aegis Dynamics', en: 'Aegis Dynamics' };

function ship(slug: string, name: string, extra: Partial<PolySearchHit> = {}): PolySearchHit {
  return {
    kind: 'ship', classNameSlug: slug, nameLocalized: name, manufacturerCode: 'AEGS', manufacturerName: AEGIS,
    size: null, grade: null, scope: 'vehicle', ...extra,
  } as PolySearchHit;
}
function item(kind: PolyHitKind, slug: string, name: string): PolySearchHit {
  return { kind, classNameSlug: slug, nameLocalized: name, manufacturerCode: null, manufacturerName: null, size: null, grade: null, scope: 'equipment' } as PolySearchHit;
}
function group(kind: PolyHitKind, hits: PolySearchHit[], total = hits.length, more = false): CodexSearchGroup {
  return {
    kind, hits, total, count: total, countIsFloor: false, folded: 0, foldedIsFloor: false,
    more: more ? { link: ['/codex/index'], queryParams: { kind } } : null,
  };
}

const GLADIUS = ship('AEGS_Gladius', 'Aegis Gladius');
const VALIANT = ship('AEGS_Gladius_Valiant', 'Aegis Gladius Valiant');
const PIRATE = ship('AEGS_Gladius_PIR', 'Aegis Gladius Pirate');
const LIVERY = item('item', 'Paint_Gladius_Black', 'Gladius Black Livery');
const ON_GLADIUS = pageLocationOf('/codex/ship/AEGS_Gladius');
const shipGroup = (): CodexSearchGroup => group('ship', [GLADIUS, VALIANT, PIRATE], 7, true);

describe('current page: identity', () => {
  it('matches the path decoded, case-insensitive, without trailing slash; fragment and view params never matter', () => {
    const t = { link: ['/codex', 'ship', 'AEGS_Gladius'], queryParams: null };
    for (const url of [
      '/codex/ship/AEGS_Gladius', '/codex/ship/aegs_gladius/', '/codex/ship/AEGS%5FGladius',
      '/codex/ship/AEGS_Gladius?view=holo#akte', '/codex/ship/AEGS_Gladius?v=c1', '/codex/ship/AEGS_Gladius?loadout=x&shared=1&mine=',
    ]) expect(isCurrentTarget(t, pageLocationOf(url)), url).toBe(true);
    expect(isCurrentTarget(t, pageLocationOf('/codex/ship/AEGS_Gladius_Valiant'))).toBe(false);
    expect(isCurrentTarget(t, null)).toBe(false);
  });

  it('a page-naming query param of the target must equal the URL\'s', () => {
    const ships = { link: ['/codex/index'], queryParams: { kind: 'ship' } };
    expect(isCurrentTarget(ships, pageLocationOf('/codex/index?kind=ship&q=gla'))).toBe(true);
    expect(isCurrentTarget(ships, pageLocationOf('/codex/index?kind=component'))).toBe(false);
  });

  it('the own variant: the ship row is current on any variant, the variant link only on its own `v`', () => {
    const v1 = { target: { link: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v: 'c1' } }, active: true };
    const v2 = { target: { link: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v: 'c2' } }, active: false };
    const onC2 = pageLocationOf('/codex/ship/AEGS_Gladius?v=c2');
    expect(isCurrentTarget(v1.target, onC2)).toBe(true);
    expect(isCurrentVariant(v1, onC2)).toBe(false);
    expect(isCurrentVariant(v2, onC2)).toBe(true);
    // No `v` in the URL: the Codex page shows the stock ship (the row itself), no variant is open.
    expect(isCurrentVariant(v1, ON_GLADIUS)).toBe(false);
    expect(isCurrentVariant(v2, ON_GLADIUS)).toBe(false);
  });
});

describe('current page: Codex bar and Ctrl+K (applyCurrentPage / resultOptions)', () => {
  it('weak match on Gladius ("gla", "aegis", "gladius valiant"): Gladius hidden, Valiant and Pirate stay', () => {
    for (const term of ['gla', 'aegis', 'gladius valiant', 'gladus']) {
      const { groups, current } = applyCurrentPage([shipGroup()], term, ON_GLADIUS);
      const slugs = groups[0].hits.map((h) => h.classNameSlug);
      expect(slugs, term).not.toContain('AEGS_Gladius');
      expect(slugs).toEqual(['AEGS_Gladius_Valiant', 'AEGS_Gladius_PIR']);
      expect(current.size).toBe(0);
      // The header numbers keep the index's sums.
      expect(groups[0].total).toBe(7);
      expect(groups[0].count).toBe(7);
    }
  });

  it('near-exact ("gladius", "Aegis Gladius", "AEGS_Gladius"): Gladius stays at its rank, marked current', () => {
    for (const term of ['gladius', 'Aegis Gladius', 'AEGS_Gladius']) {
      const { groups, current } = applyCurrentPage([shipGroup()], term, ON_GLADIUS);
      expect(groups[0].hits[0].classNameSlug, term).toBe('AEGS_Gladius');
      expect(current.has(hitKey(GLADIUS))).toBe(true);
      const opts = resultOptions(groups, current);
      expect(opts[0]).toEqual(expect.objectContaining({ type: 'hit', current: true }));
      expect(opts.filter((o) => o.type === 'hit' && o.current).length).toBe(1);
    }
  });

  it('on Valiant: "gladius" keeps Gladius as a normal row, Valiant is hidden (weak) ', () => {
    const onValiant = pageLocationOf('/codex/ship/AEGS_Gladius_Valiant');
    const { groups, current } = applyCurrentPage([shipGroup()], 'gladius', onValiant);
    expect(groups[0].hits.map((h) => h.classNameSlug)).toEqual(['AEGS_Gladius', 'AEGS_Gladius_PIR']);
    expect(current.size).toBe(0);
    expect(applyCurrentPage([shipGroup()], 'gladius valiant', onValiant).current.has(hitKey(VALIANT))).toBe(true);
  });

  it('on Pirate: liveries and the other hulls stay', () => {
    const onPirate = pageLocationOf('/codex/ship/AEGS_Gladius_PIR');
    const { groups } = applyCurrentPage([shipGroup(), group('item', [LIVERY])], 'gla', onPirate);
    expect(groups.map((g) => g.hits.map((h) => h.classNameSlug))).toEqual([['AEGS_Gladius', 'AEGS_Gladius_Valiant'], ['Paint_Gladius_Black']]);
  });

  it('own variant page (?v=): the catalog Gladius is the current page too', () => {
    const { current } = applyCurrentPage([shipGroup()], 'gladius', pageLocationOf('/codex/ship/AEGS_Gladius?v=c2&view=holo'));
    expect(current.has(hitKey(GLADIUS))).toBe(true);
  });

  it('never an empty panel: when the current page would be the only row, it shows marked', () => {
    const { groups, current } = applyCurrentPage([group('ship', [GLADIUS])], 'gla', ON_GLADIUS);
    expect(groups.length).toBe(1);
    expect(groups[0].hits).toEqual([GLADIUS]);
    expect(current.has(hitKey(GLADIUS))).toBe(true);
  });

  it('a group that loses its only row keeps its "all N" link, a group without one disappears', () => {
    const { groups } = applyCurrentPage([group('ship', [GLADIUS], 4, true), group('weapon', [item('weapon', 'W', 'Gladius Gun')])], 'gla', ON_GLADIUS);
    expect(groups.map((g) => [g.kind, g.hits.length])).toEqual([['ship', 0], ['weapon', 1]]);
    const { groups: g2 } = applyCurrentPage([group('ship', [GLADIUS]), group('weapon', [item('weapon', 'W', 'Gladius Gun')])], 'gla', ON_GLADIUS);
    expect(g2.map((g) => g.kind)).toEqual(['weapon']);
  });

  it('off any detail page nothing changes', () => {
    const { groups, current } = applyCurrentPage([shipGroup()], 'gla', pageLocationOf('/codex'));
    expect(groups[0].hits.length).toBe(3);
    expect(current.size).toBe(0);
  });
});

describe('current page: the empty field', () => {
  const fresh = [GLADIUS, VALIANT, PIRATE, ship('A_1', 'One'), ship('A_2', 'Two'), ship('A_3', 'Three')];

  it('the new ships never list the current page and backfill to their usual length', () => {
    const opts = suggestionOptions([], fresh, ON_GLADIUS).filter((o) => o.type === 'fresh');
    expect(opts.length).toBe(FRESH_SHIPS_SHOWN);
    expect(opts.map((o) => (o.type === 'fresh' ? o.hit.classNameSlug : ''))).toEqual(['AEGS_Gladius_Valiant', 'AEGS_Gladius_PIR', 'A_1', 'A_2']);
  });

  it('a category shortcut to the current page is left out; recent search terms stay', () => {
    const opts = suggestionOptions(['gladius'], [], pageLocationOf('/codex/keybinds'));
    expect(opts.filter((o) => o.type === 'category').length).toBe(SEARCH_CATEGORY_SHORTCUTS.length - 1);
    expect(opts[0]).toEqual(expect.objectContaining({ type: 'recent', term: 'gladius' }));
  });
});

describe('current page: fusion bar (composeSearchResult)', () => {
  const base = { signedIn: true, flagshipClassName: null as string | null, context: searchContextOf('/codex/ship/AEGS_Gladius'), chips: [] };

  it('weak match hides the row; near-exact greys it with no CTA, no icons and no fit badge', () => {
    const weak = composeSearchResult({ ...base, term: 'gla', groups: [shipGroup()], here: ON_GLADIUS });
    const shipsWeak = weak.groups.find((g) => g.id === 'ship')!;
    expect(shipsWeak.rows.map((r) => (r.type === 'hit' ? r.hit.classNameSlug : ''))).toEqual(['AEGS_Gladius_Valiant', 'AEGS_Gladius_PIR']);
    expect(shipsWeak.total).toBe(7);

    const exact = composeSearchResult({ ...base, term: 'gladius', groups: [shipGroup()], here: ON_GLADIUS, fit: () => ({ verdict: 'fits' }) as never });
    const row = exact.groups.find((g) => g.id === 'ship')!.rows[0];
    expect(row.type === 'hit' && row.hit.classNameSlug).toBe('AEGS_Gladius');
    expect(row.current).toBe(true);
    expect(row.cta).toBeNull();
    expect(row.icons).toEqual({ wishlist: false, lager: false });
    expect(row.type === 'hit' && row.fit).toBeNull();
    expect(exact.groups.find((g) => g.id === 'ship')!.rows.filter((r) => r.current).length).toBe(1);
  });

  it('never an empty panel: the only row comes back greyed', () => {
    const r = composeSearchResult({ ...base, term: 'gla', groups: [group('ship', [GLADIUS])], here: ON_GLADIUS });
    expect(r.empty).toBe(false);
    expect(r.groups[0].rows.length).toBe(1);
    expect(r.groups[0].rows[0].current).toBe(true);
  });

  it('without a location the result is unchanged', () => {
    const r = composeSearchResult({ ...base, term: 'gla', groups: [shipGroup()] });
    expect(r.groups[0].rows.length).toBe(3);
    expect(r.groups[0].rows.some((x) => x.current)).toBe(false);
  });

  it('near-exact own rows by type, own name or the type without its maker', () => {
    const own = { type: 'own', ownKind: 'ship', title: 'Aegis Gladius', ownName: 'Nachtfalke', classNameSlug: 'AEGS_Gladius' } as SearchResultRow;
    expect(isNearExactRow('gladius', own)).toBe(true);
    expect(isNearExactRow('nachtfalke', own)).toBe(true);
    expect(isNearExactRow('gla', own)).toBe(false);
  });
});

describe('one own row per ship (d-variant)', () => {
  const ships = [
    { id: 'h1', shipClassName: 'AEGS_Gladius', customName: 'Nachtfalke', status: 'owned' },
    { id: 'h2', shipClassName: 'DRAK_Cutlass_Black', customName: null, status: 'owned' },
  ] as HangarShip[];
  const configs = [
    { id: 'c1', hangarShipId: 'h1', name: 'Meine Jagd', loadout: [], isActive: true },
    { id: 'c2', hangarShipId: 'h1', name: 'Meine Rennbuild', loadout: [], isActive: false },
    { id: 'c3', hangarShipId: 'h1', name: 'Meine PvP', loadout: [], isActive: false },
    { id: 'c4', hangarShipId: 'h1', name: 'Meine Fracht', loadout: [], isActive: false },
    { id: 'c9', hangarShipId: 'h2', name: 'Solo', loadout: [], isActive: true },
  ] as unknown as HangarShipConfig[];
  const src = { ships, configs, sets: [], items: [] };
  const nameOf = (c: string) => (c === 'AEGS_Gladius' ? 'Aegis Gladius' : c === 'DRAK_Cutlass_Black' ? 'Drake Cutlass Black' : null);

  it('the ship and its variants are ONE row; it opens the active variant and carries every variant as a link', () => {
    const r = searchOwn('gladius', src, { nameOf });
    expect(r.rows.length).toBe(1);
    const row = r.rows[0];
    expect(row).toEqual(expect.objectContaining({ id: 'own-ship-h1', ownKind: 'ship', ownName: 'Nachtfalke' }));
    expect(row.target).toEqual({ link: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v: 'c1' } });
    expect(row.variants!.map((v) => v.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(row.variants![1].target).toEqual({ link: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v: 'c2' } });
  });

  it('a variant name alone finds the ship row once, the matched variant first', () => {
    const r = searchOwn('meine', src, { nameOf });
    expect(r.rows.length).toBe(1);
    expect(r.total).toBe(1);
    const rb = searchOwn('rennbuild', src, { nameOf }).rows;
    expect(rb.length).toBe(1);
    expect(rb[0]).toEqual(expect.objectContaining({ id: 'own-ship-h1', ownKind: 'config', ownName: 'Meine Rennbuild', subtitle: 'Nachtfalke' }));
    expect(rb[0].variants![0].id).toBe('c2');
  });

  it('a ship with a single variant gets no mini links (the row itself opens it)', () => {
    expect(searchOwn('cutlass', src, { nameOf }).rows[0].variants).toBeUndefined();
  });

  it('under the shell beta the links lead to the HQ ship page', () => {
    const row = searchOwn('gladius', src, { nameOf, hq: true }).rows[0];
    expect(row.variants![2].target).toEqual({ link: ['/hq/hangar', 'h1'], queryParams: { v: 'c3' } });
  });

  it('on the own variant page the row is current and the open variant link is marked', () => {
    const own = searchOwn('gladius', src, { nameOf });
    const r = composeSearchResult({
      term: 'gladius', groups: [], context: searchContextOf('/codex/ship/AEGS_Gladius'), chips: [], signedIn: true,
      own, here: pageLocationOf('/codex/ship/AEGS_Gladius?v=c3'),
    });
    const row = r.groups.find((g) => g.id === 'own')!.rows[0];
    expect(row.current).toBe(true);
    expect(row.type === 'own' && row.variants!.filter((v) => v.current).map((v) => v.id)).toEqual(['c3']);
  });
});
