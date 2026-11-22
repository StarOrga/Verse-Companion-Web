import type { HangarShip } from '../../hangar/hangar.types';
import { searchContextOf } from '../../shell/fusion-bar/search-context';
import { PolyHitKind, PolySearchHit, polyMatchQuality, rankPolyHits } from '../codex-poly-search';
import { MATCH, boundedEditDistance, fuzzyQuality, maxEdits, termQuality } from '../search-quality';
import { CodexSearchGroup, groupHits } from './codex-search-model';
import type { SearchFit } from './search-compat';
import { composeSearchResult } from './search-compose';
import { searchOwn } from './search-own';
import { GROUP_SIZE_ORDER, contextBoost, orderGroups, sizeBonus } from './search-rank';

function hit(kind: PolyHitKind, slug: string, name: string, extra: Partial<PolySearchHit> = {}): PolySearchHit {
  return {
    kind, classNameSlug: slug, nameLocalized: name, manufacturerCode: null, manufacturerName: null,
    size: null, grade: null, scope: 'equipment', ...extra,
  };
}

function group(kind: PolyHitKind, hits: PolySearchHit[]): CodexSearchGroup {
  return { kind, hits, total: hits.length, count: hits.length, countIsFloor: false, folded: 0, foldedIsFloor: false, more: null };
}

const anvil = { de: 'Anvil Aerospace', en: 'Anvil Aerospace', key: '' };

// The panel of the feedback screenshot (#395): on the C.O. Nomad page, "liber".
const shipLiberator = hit('ship', 'ANVL_Liberator', 'Anvil Liberator', { manufacturerName: anvil });
const shipValkyrie = hit('ship', 'ANVL_Valkyrie', 'Anvil Valkyrie', { manufacturerName: anvil });
const internalTank = hit('component', 'TANK_ANVL_Liberator_Internal', 'Internal Tank', { name: { de: 'Interner Tank', en: 'Internal Tank', key: '' } });
const intake = hit('component', 'INTK_ANVL_Liberator', 'INTK ANVL Liberator');
const cargoGrid = hit('component', 'ANVL_Liberator_CargoGrid', 'ANVL Liberator Cargo Grid');
const gunLiberator = hit('weapon', 'THER_Liberator_S1', 'Liberator');
const gunPrime = hit('weapon', 'THER_Liberator_S2', 'Liberator Prime');
const livery = hit('item', 'Paint_Liberator_Condor', 'Liberator Condor Livery');

const screenshotGroups = [
  group('component', [internalTank, intake, cargoGrid]),
  group('weapon', [gunLiberator, gunPrime]),
  group('ship', [shipLiberator, shipValkyrie]),
  group('item', [livery]),
];

const base = { signedIn: true, flagshipClassName: null as string | null };

describe('search quality (#395)', () => {
  it('orders the tiers: exact > class name > prefix > whole word > word start > substring > class only', () => {
    expect(termQuality('liberator', ['Liberator'])).toBe(MATCH.exact);
    expect(termQuality('anvl_liberator', ['Anvil Liberator'], ['ANVL_Liberator'])).toBe(MATCH.exactId);
    expect(termQuality('liber', ['Liberator Prime'])).toBe(MATCH.prefix);
    expect(termQuality('liberator', ['INTK ANVL Liberator'])).toBe(MATCH.word);
    expect(termQuality('liber', ['INTK ANVL Liberator'])).toBe(MATCH.wordPrefix);
    expect(termQuality('liberator anvil', ['INTK ANVL Liberator', 'Anvil Liberator Intake'])).toBe(MATCH.tokens);
    expect(termQuality('bera', ['Liberator'])).toBe(MATCH.substring);
    expect(termQuality('liber', ['Internal Tank'], ['TANK_ANVL_Liberator_Internal'])).toBe(MATCH.idOnly);
    const tiers = [MATCH.exact, MATCH.exactId, MATCH.prefix, MATCH.word, MATCH.wordPrefix, MATCH.tokens, MATCH.substring, MATCH.idOnly, MATCH.fuzzy];
    expect([...tiers].sort((a, b) => b - a)).toEqual(tiers);
  });

  it('a ship without its maker is an exact answer; the German name counts too', () => {
    expect(polyMatchQuality('liberator', shipLiberator)).toBe(MATCH.exact);
    expect(polyMatchQuality('interner tank', internalTank)).toBe(MATCH.exact);
  });

  it('a word of the name beats a class-name-only hit ("Interner Tank" no longer leads "liber")', () => {
    expect(polyMatchQuality('liber', intake)).toBeGreaterThan(polyMatchQuality('liber', internalTank));
    const ranked = rankPolyHits('liber', [internalTank, cargoGrid, intake]);
    expect(ranked.at(-1)).toBe(internalTank);
  });

  it('typos: bounded Damerau-Levenshtein per word, scaled to the word length', () => {
    expect(boundedEditDistance('libre', 'liber', 2)).toBe(1); // swapped neighbours = one edit
    expect(boundedEditDistance('liberatr', 'liberator', 2)).toBe(1);
    expect(boundedEditDistance('abcdefgh', 'zyxwvuts', 2)).toBe(3); // stops early at max + 1
    expect([maxEdits(3), maxEdits(4), maxEdits(6), maxEdits(9)]).toEqual([0, 1, 2, 3]);
    for (const typo of ['liberatr', 'libertor', 'liberater', 'lbierator', 'liebrator', 'Liberatro']) {
      const q = termQuality(typo, ['Anvil Liberator']);
      expect(q, typo).toBeGreaterThan(MATCH.none);
      expect(q, typo).toBeLessThan(MATCH.idOnly); // strictly below every real match
    }
    expect(fuzzyQuality('liberatr', ['Liberator'])).toBeGreaterThan(fuzzyQuality('lbieratr', ['Liberator']));
  });

  it('typos: short words and far-off words never match', () => {
    expect(termQuality('ar', ['Liberator'])).toBe(MATCH.none);
    expect(termQuality('gladius', ['Liberator'])).toBe(MATCH.none);
    // Not a typo of "Liberator" by any spelling metric (5+ edits): no false friend.
    expect(termQuality('mollywator', ['Anvil Liberator'])).toBe(MATCH.none);
    expect(termQuality('', ['Liberator'])).toBe(MATCH.none);
  });

  it('a typo hit ranks below a real hit of any kind', () => {
    const typoShip = hit('ship', 'ANVL_Liberator', 'Anvil Liberator', { manufacturerName: anvil });
    const real = hit('item', 'X', 'Liberatr Sticker');
    expect(rankPolyHits('liberatr', [typoShip, real])).toEqual([real, typoShip]);
  });
});

describe('group order (#395)', () => {
  it('defines the size hierarchy once: ship > component > weapon > item > … > announced', () => {
    expect(GROUP_SIZE_ORDER.slice(0, 4)).toEqual(['ship', 'component', 'weapon', 'item']);
    expect(GROUP_SIZE_ORDER.at(-1)).toBe('upcoming');
    expect(sizeBonus('ship')).toBeGreaterThan(sizeBonus('component'));
    expect(sizeBonus('component')).toBeGreaterThan(sizeBonus('weapon'));
  });

  it('bonuses stay below one tier gap: they never lift a weaker tier', () => {
    const maxBonus = sizeBonus('ship') + Math.max(...GROUP_SIZE_ORDER.map((k) => contextBoost(k, searchContextOf('/codex/index?kind=' + k))));
    expect(maxBonus).toBeLessThan(MATCH.exact - MATCH.exactId);
    expect(MATCH.fuzzy + maxBonus).toBeLessThan(MATCH.idOnly);
  });

  it('the overlay groups: best match leads, equals follow the size hierarchy', () => {
    const groups = groupHits('liber', [internalTank, intake, gunLiberator, shipLiberator, livery], {}, 5);
    expect(groups.map((g) => g.kind)).toEqual(['ship', 'weapon', 'item', 'component']);
  });

  it('the screenshot: on the C.O. Nomad page "liber" leads with the ship group, parts by match', () => {
    const ctx = searchContextOf('/codex/ship/MISC_CO_Nomad');
    const r = composeSearchResult({ ...base, term: 'liber', groups: screenshotGroups, context: ctx, chips: ctx.chips });
    expect(r.groups.map((g) => g.id)).toEqual(['ship', 'weapon', 'item', 'component']);
    const comps = r.groups.find((g) => g.id === 'component')!.rows.map((x) => (x.type === 'hit' ? x.hit.classNameSlug : ''));
    expect(comps.at(-1)).toBe('TANK_ANVL_Liberator_Internal');
    // The component group no longer claims "passt zu C.O. Nomad" for a place it got by its match.
    expect(r.groups.some((g) => g.reason?.key === 'search.why.context')).toBe(false);
  });

  it('"liberator": both exact, the ship group stands above the weapon group', () => {
    const ctx = searchContextOf('/codex/ship/MISC_CO_Nomad');
    const r = composeSearchResult({ ...base, term: 'liberator', groups: screenshotGroups, context: ctx, chips: ctx.chips });
    expect(r.groups.map((g) => g.id).slice(0, 2)).toEqual(['ship', 'weapon']);
  });

  it('a group with an exact hit beats a group with only partial hits, whatever the fixed order', () => {
    const groups = [group('ship', [hit('ship', 'S1', 'Stalker Arrowhead')]), group('weapon', [hit('weapon', 'W1', 'Arrow')])];
    const r = composeSearchResult({ ...base, term: 'arrow', groups, context: searchContextOf('/'), chips: [] });
    expect(r.groups.map((g) => g.id)).toEqual(['weapon', 'ship']);
  });

  it('the context boosts among equal matches but never buries an exact hit elsewhere', () => {
    const ctx = searchContextOf('/codex/index?kind=weapon');
    const equal = [group('ship', [hit('ship', 'S1', 'Stalker I')]), group('weapon', [hit('weapon', 'W1', 'Stalker Cannon')])];
    expect(composeSearchResult({ ...base, term: 'stalker', groups: equal, context: ctx, chips: [] }).groups.map((g) => g.id)).toEqual(['weapon', 'ship']);
    const exactShip = [group('ship', [hit('ship', 'S1', 'Stalker')]), group('weapon', [hit('weapon', 'W1', 'Stalker Cannon')])];
    const r = composeSearchResult({ ...base, term: 'stalker', groups: exactShip, context: ctx, chips: [] });
    expect(r.groups.map((g) => g.id)).toEqual(['ship', 'weapon']);
    expect(r.groups[0].reason).toBeNull();
  });

  it('excluded kinds of an HQ page still sort last, even with an exact hit', () => {
    const ctx = searchContextOf('/hq', 'statistik');
    const ordered = orderGroups(
      [{ kind: 'weapon' as PolyHitKind, best: MATCH.exact }, { kind: 'ship' as PolyHitKind, best: MATCH.substring }],
      (g) => g.kind, (g) => g.best, ctx,
    );
    expect(ordered.map((g) => g.kind)).toEqual(['ship', 'weapon']);
  });

  it('typo hits: the groups still follow the size hierarchy', () => {
    const groups = groupHits('liberatr', [gunLiberator, shipLiberator], {}, 5);
    expect(groups.map((g) => g.kind)).toEqual(['ship', 'weapon']);
  });

  it('among equal matches a part that fits the chip ship leads its group', () => {
    const ctx = searchContextOf('/codex/ship/MISC_CO_Nomad');
    const a = hit('weapon', 'W_A', 'Liberator Ultra');
    const b = hit('weapon', 'W_B', 'Liberator Prime');
    const fit = (h: PolySearchHit): SearchFit => ({ verdict: h === a ? 'fits' : 'noFit', reasonKey: null, reasonParams: null });
    const r = composeSearchResult({ ...base, term: 'liberator', groups: [group('weapon', [b, a])], context: ctx, chips: ctx.chips, fit });
    expect(r.groups[0].rows.map((x) => (x.type === 'hit' ? x.hit.classNameSlug : ''))).toEqual(['W_A', 'W_B']);
  });
});

describe('own (hangar) group (#395)', () => {
  const ownRows = (term: string, customName: string) =>
    searchOwn(term, { ships: [{ id: 'h1', shipClassName: 'A1', customName, status: 'owned' } as HangarShip], configs: [], sets: [], items: [] }, { nameOf: () => 'Stalker I' });

  it('leads outside HQ when it matches at least as well as the best catalog group', () => {
    const own = ownRows('nachtfalke', 'Nachtfalke');
    const groups = [group('weapon', [hit('weapon', 'W1', 'Nachtfalke Cannon')])];
    const r = composeSearchResult({ ...base, term: 'nachtfalke', groups, context: searchContextOf('/codex'), chips: [], own });
    expect(r.groups.map((g) => g.id)).toEqual(['own', 'weapon']);
  });

  it('stays second outside HQ when the catalog matches better, first on HQ pages', () => {
    const own = ownRows('stalker', 'Nachtfalke Stalker');
    const groups = [group('ship', [hit('ship', 'S1', 'Stalker')])];
    expect(composeSearchResult({ ...base, term: 'stalker', groups, context: searchContextOf('/codex'), chips: [], own }).groups.map((g) => g.id))
      .toEqual(['ship', 'own']);
    expect(composeSearchResult({ ...base, term: 'stalker', groups, context: searchContextOf('/hq'), chips: [], own }).groups.map((g) => g.id))
      .toEqual(['own', 'ship']);
  });
});
