// Composes the search result the fusion bar renders (lines A2, A3, A5, A10,
// B5-data, C1, C2, C9, C11, C12). Pure and framework-free.
// -----------------------------------------------------------------------------
// Inputs: the engine's ranked catalog groups (all kinds, NOT yet filtered), the
// reader's own data matches, patch and gallery matches, the active chips
// (route + section + parsed, minus the ones the reader removed) and the ranking
// signals. Output: SearchResult (search-result-model.ts).
//
//  - Chips FILTER: a hit that fails one is not "inside". A fast-exact hit
//    (name score >= prefix) outside the chips is kept in a dashed `outside`
//    group with a reason; the rest is only counted (`filteredOut`).
//  - Groups stand in the order of their BEST match (search-rank.ts, #395): an
//    exact hit leads, equally good groups follow the size hierarchy (ship >
//    component > weapon > item > …). The CONTEXT only adds a small boost on
//    top (invisible) and says why in `reason`.
//    The HQ ownership chips (Bestand / Hangar / Sets, `ownFirst`) are ordering too:
//    the own group stands first, the catalog groups follow with the HQ CTAs.
//  - Every group lists up to `perGroup` rows; the UI shows the first three
//    (SEARCH_ROWS_SHOWN) on every page.
//  - Rows order by match quality (search-quality.ts, typo tolerant). Among
//    equal ones: fitting the chip's ship ("passt auf"), then recently opened by
//    the reader, then owned, then often opened by others (signals).

import {
  PolyHitKind,
  PolySearchHit,
  polyMatchQuality,
  polyMatchScore,
} from '../codex-poly-search';
import type { SearchContext } from '../../shell/fusion-bar/search-context';
import { contextBoost, orderGroups } from './search-rank';
import { qualityOfScore } from '../search-quality';
import {
  CodexSearchGroup,
  PageLocation,
  SearchTarget,
  hitTarget,
  indexTarget,
  ShipVariantsOf,
  isCurrentTarget,
  isNearExactHit,
  markVariants,
} from './codex-search-model';
import { recordScore, searchScore } from '../codex-search';
import { CtaRow, resolveCta, resolveIcons } from './search-cta';
import type { SearchFit } from './search-compat';
import { OwnSearchResult, ownMoreTarget } from './search-own';
import { otherMemberMatched } from './search-families';
import { withOptionCounts } from './search-query-parse';
import {
  NO_SIGNALS,
  RankSignals,
  signalOrder,
} from './search-signals';
import { GalleryMatch, MissionMatch, PatchMatch, SourceResult, sourceMoreTarget } from './search-sources';
import {
  RowOwnership,
  SEARCH_ROWS_SHOWN,
  SearchChip,
  SearchGroupId,
  SearchReason,
  SearchResult,
  SearchResultGroup,
  SearchResultRow,
} from './search-result-model';

export interface ComposeInput {
  /** The searched text (without the words that became chips). */
  term: string;
  /** The engine's catalog groups, unfiltered. */
  groups: readonly CodexSearchGroup[];
  context: SearchContext;
  /** All active chips: context (route + section) and parsed ones. */
  chips: readonly SearchChip[];
  own?: OwnSearchResult | null;
  patches?: SourceResult<PatchMatch> | null;
  gallery?: SourceResult<GalleryMatch> | null;
  missions?: SourceResult<MissionMatch> | null;
  signals?: RankSignals;
  /** What the reader owns of a hit (for Mein Loadout / Wo gelagert?). */
  ownership?: (hit: PolySearchHit) => RowOwnership | null;
  /** The fit badge of a hit against the chip's ship (B5); null = no chip asks. */
  fit?: (hit: PolySearchHit) => SearchFit | null;
  signedIn: boolean;
  /** The reader's wishlist / open Nachschub: filter (chips) and ranking (wished first). */
  wished?: (hit: PolySearchHit) => boolean;
  needed?: (hit: PolySearchHit) => boolean;
  flagshipClassName?: string | null;
  /** The reader's hangar ship id of a ship class (Montieren under a ship chip); null = none owned. */
  ownShipIdFor?: (shipClassName: string) => string | null;
  didYouMean?: readonly string[];
  /** The groups are the reader's own wishlist / Nachschub entries: "all N in the index" would lie. */
  ownSet?: boolean;
  /** Value → count over the rows read WITHOUT size/grade chips; fills the chip menus. */
  facets?: { size: Record<string, number>; grade: Record<string, number> } | null;
  /** The page the reader stands on: its row is hidden (weak match) or greyed (near-exact), never offered as a way there. */
  here?: PageLocation | null;
  /**
   * The mini links of a ship row per class — the family's other models, then the reader's own
   * variants: a catalog ship row and its own rows become ONE row (C11).
   */
  ownVariants?: ShipVariantsOf;
  /** The family base (lower case) of a ship class; own rows of any model fold into the family row. */
  shipBaseOf?: (classNameSlug: string) => string;
}

/** The chip a hit fails, or null when it is inside every chip. */
export function failingChip(
  hit: PolySearchHit,
  chips: readonly SearchChip[],
  own?: { wished?: (hit: PolySearchHit) => boolean; needed?: (hit: PolySearchHit) => boolean },
): SearchChip | null {
  for (const chip of chips) {
    const f = chip.filter;
    if (f.wished && !own?.wished?.(hit)) return chip;
    if (f.needed && !own?.needed?.(hit)) return chip;
    if (f.groups && !f.groups.includes(hit.kind)) return chip;
    if (f.size !== undefined && hit.size !== f.size) return chip;
    if (f.grade && (hit.grade ?? '').toUpperCase() !== f.grade) return chip;
  }
  return null;
}

/** True when a non-catalog group (own / patch / gallery) is allowed by the chips. */
function groupAllowed(id: SearchGroupId, chips: readonly SearchChip[]): boolean {
  return chips.every((c) => {
    const f = c.filter;
    if (f.wished || f.needed) return false; // a set of catalog entries: no own, patch, gallery or mission rows
    if (f.ownOnly && id !== 'own') return false; // "lager": the reader's own data only
    return !f.groups || f.groups.includes(id);
  });
}

const FAST_EXACT = 3;

const NO_ICONS = { wishlist: false, lager: false } as const;

export function composeSearchResult(input: ComposeInput): SearchResult {
  const { context: ctx, chips, term, signedIn } = input;
  const signals = input.signals ?? NO_SIGNALS;
  const flagship = input.flagshipClassName ?? null;
  const ownFirst = chips.some((c) => c.filter.ownFirst);
  const ownSlugs = new Set(
    (input.own?.rows ?? []).filter((r) => r.ownKind === 'ship' && r.classNameSlug).map((r) => r.classNameSlug!.toLowerCase()),
  );

  const chipShip = chips.find((c) => c.filter.compatWith?.kind === 'ship')?.filter.compatWith?.className ?? null;
  const chipShipId = chipShip && signedIn ? (input.ownShipIdFor?.(chipShip) ?? null) : null;

  const hitRow = (hit: PolySearchHit, outside: boolean): SearchResultRow => {
    const ownership = input.ownership?.(hit) ?? null;
    const target = hitTarget(hit);
    const row: CtaRow = {
      type: 'hit', kind: hit.kind, classNameSlug: hit.classNameSlug, manufacturerCode: hit.manufacturerCode,
      ownership, target, flagshipClassName: flagship, chipShipId,
    };
    return {
      type: 'hit',
      id: `hit-${hit.kind}-${hit.classNameSlug}`,
      hit, target, outside, owned: ownership, fit: input.fit?.(hit) ?? null,
      signal: {
        recent: signals.recentRank(hit.kind, hit.classNameSlug) !== -1,
        owned: signals.owns(hit.classNameSlug),
        popular: signals.popularity(hit.kind, hit.classNameSlug) > 0,
      },
      cta: resolveCta(ctx, row),
      icons: resolveIcons(row),
    };
  };

  // ── catalog groups: filter by chips, order among equals by signals ────────
  let filteredOut = 0;
  const outsideHits: { hit: PolySearchHit; chip: SearchChip; score: number }[] = [];
  const catalog: SearchResultGroup[] = [];
  const bestOf = new Map<SearchResultGroup, number>();
  // "lager" / "inventar": the reader's own data only, whatever groups the caller read.
  const ownOnlyChips = chips.some((c) => c.filter.ownOnly);
  for (const g of ownOnlyChips ? [] : input.groups) {
    const inside: PolySearchHit[] = [];
    let dropped = 0;
    for (const hit of g.hits) {
      const chip = failingChip(hit, chips, { wished: input.wished, needed: input.needed });
      const duplicateOfOwn = !chip && ownFirst && hit.kind === 'ship' && ownSlugs.has(hit.classNameSlug.toLowerCase());
      if (duplicateOfOwn) {
        dropped++;
        continue;
      }
      if (!chip) {
        inside.push(hit);
        continue;
      }
      dropped++;
      const score = polyMatchScore(term, hit);
      if (score >= FAST_EXACT) outsideHits.push({ hit, chip, score });
      else filteredOut++;
    }
    if (inside.length === 0) continue;
    const scored = inside.map((hit, i) => ({
      hit, i, s: polyMatchQuality(term, hit), k: signalOrder(signals, hit.kind, hit.classNameSlug), w: !!input.wished?.(hit),
      // The context at row level: a part that fits the chip's ship leads among equal matches.
      f: input.fit?.(hit)?.verdict === 'fits' ? 0 : 1,
    }));
    const ordered = scored
      .sort((a, b) => Number(b.w) - Number(a.w) || b.s - a.s || a.f - b.f || a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
      .map((x) => x.hit);
    // A group a chip trimmed on the client cannot promise the index total.
    const total = dropped === 0 ? Math.max(g.total, ordered.length) : ordered.length;
    const entry: SearchResultGroup = {
      id: g.kind,
      kind: g.kind,
      reason: null,
      rows: ordered.map((h) => hitRow(h, false)),
      total,
      count: dropped === 0 ? Math.min(total, Math.max(g.count ?? ordered.length, ordered.length)) : ordered.length,
      expandable: Math.max(0, ordered.length - SEARCH_ROWS_SHOWN),
      moreTarget: total > SEARCH_ROWS_SHOWN && !input.ownSet ? indexMoreTarget(g.kind, term, chips) : null,
      outside: false,
    };
    catalog.push(entry);
    bestOf.set(entry, scored.reduce((m, x) => Math.max(m, x.s), 0));
  }
  const catalogOrdered = orderGroups(catalog, (g) => g.kind as PolyHitKind, (g) => bestOf.get(g) ?? 0, ctx);
  const catalogBest = catalogOrdered.length ? (bestOf.get(catalogOrdered[0]) ?? 0) : 0;

  // ── own data / patches / gallery ──────────────────────────────────────────
  const own = input.own;
  let ownGroup: SearchResultGroup | null = null;
  if (own && own.rows.length && groupAllowed('own', chips)) {
    ownGroup = {
      id: 'own', kind: null, reason: null, total: own.total,
      rows: own.rows.map((r): SearchResultRow => {
        const ref = r.ownKind === 'item' ? null : (r.target.link[r.target.link.length - 1] ?? null);
        const row: CtaRow = { type: 'own', ownKind: r.ownKind, ownRefId: ref, kind: null };
        return { ...r, cta: resolveCta(ctx, row), icons: resolveIcons(row) };
      }),
      expandable: Math.max(0, own.rows.length - SEARCH_ROWS_SHOWN),
      moreTarget: own.total > SEARCH_ROWS_SHOWN ? ownMoreTarget(own.rows, term) : null,
      outside: false,
    };
  }
  let galleryGroup: SearchResultGroup | null = null;
  const gal = input.gallery;
  if (gal && gal.rows.length && groupAllowed('gallery', chips)) {
    galleryGroup = {
      id: 'gallery', kind: null, reason: null, total: gal.total,
      rows: gal.rows.map((r): SearchResultRow => ({ ...r, cta: null, icons: resolveIcons({ type: 'gallery' }) })),
      expandable: Math.max(0, gal.rows.length - SEARCH_ROWS_SHOWN),
      moreTarget: gal.total >= SEARCH_ROWS_SHOWN ? sourceMoreTarget('gallery', term) : null,
      outside: false,
    };
  }
  // Missions: the CTA "Zum Einsatz" (an action), no icons — the row itself opens the mission page.
  // No "Alle N": there is no mission index page yet.
  let missionGroup: SearchResultGroup | null = null;
  const mis = input.missions;
  if (mis && mis.rows.length && groupAllowed('mission', chips)) {
    missionGroup = {
      id: 'mission', kind: null, reason: null, total: mis.total,
      rows: mis.rows.map((r): SearchResultRow => ({
        ...r,
        cta: resolveCta(ctx, { type: 'mission', kind: null, classNameSlug: r.className }),
        icons: { ...NO_ICONS },
      })),
      expandable: Math.max(0, mis.rows.length - SEARCH_ROWS_SHOWN),
      moreTarget: null,
      outside: false,
    };
  }
  let patchGroup: SearchResultGroup | null = null;
  const pat = input.patches;
  if (pat && pat.rows.length && groupAllowed('patch', chips)) {
    patchGroup = {
      id: 'patch', kind: null, reason: null, total: pat.total,
      rows: pat.rows.map((r): SearchResultRow => ({ ...r, cta: null, icons: resolveIcons({ type: 'patch' }) })),
      expandable: Math.max(0, pat.rows.length - SEARCH_ROWS_SHOWN),
      moreTarget: pat.total > SEARCH_ROWS_SHOWN ? sourceMoreTarget('patch', term) : null,
      outside: false,
    };
  }

  // ── order (invisible) ─────────────────────────────────────────────────────
  const groups: SearchResultGroup[] = [...catalogOrdered];
  const inHq = ctx.key.startsWith('hq') || ctx.ownedFirst || ownFirst;
  // The reader's own rows lead on HQ pages and whenever they match at least as well as the best catalog group.
  const ownLeads = inHq || (!!own && ownQuality(term, own) >= catalogBest);
  if (ownGroup) groups.splice(ownLeads ? 0 : Math.min(1, groups.length), 0, ownGroup);
  if (missionGroup) groups.push(missionGroup);
  if (galleryGroup) {
    if (ctx.key === 'gallery') groups.unshift(galleryGroup);
    else groups.push(galleryGroup);
  }
  if (patchGroup) groups.splice(ctx.key === 'verse' ? Math.min(1, groups.length) : groups.length, 0, patchGroup);

  // ── reasons (A5) ──────────────────────────────────────────────────────────
  groups.forEach((g, i) => {
    g.reason = groupReason(g, i, ctx);
  });

  // ── outside the chips (A10) ───────────────────────────────────────────────
  let outside: SearchResultGroup | null = null;
  if (outsideHits.length) {
    const sorted = [...outsideHits].sort((a, b) => b.score - a.score);
    const chip = sorted[0].chip;
    outside = {
      id: 'outside', kind: null,
      reason: { key: 'search.why.outside', params: { chip: chip.labelKey, ...(chip.labelParams ?? {}) } },
      rows: sorted.slice(0, SEARCH_ROWS_SHOWN).map((o) => hitRow(o.hit, true)),
      total: sorted.length,
      expandable: 0,
      moreTarget: null,
      outside: true,
    };
  }

  // ── one row per ship page (C11): the own rows of a listed hull fold into its catalog row ──
  if (input.ownVariants) {
    const folded = foldShipRows(groups, outside, input.ownVariants, input.shipBaseOf);
    groups.splice(0, groups.length, ...folded.groups);
    outside = folded.outside;
    groups.forEach((g, i) => {
      g.reason = groupReason(g, i, ctx);
    });
  }

  // ── the current page (note 4): hidden or greyed, never an empty panel ─────
  if (input.here) {
    const ruled = applyCurrentRows(groups, outside, term, input.here);
    groups.splice(0, groups.length, ...ruled.groups);
    outside = ruled.outside;
    groups.forEach((g, i) => {
      g.reason = groupReason(g, i, ctx);
    });
  }

  // ── chip menus: counts per value ──────────────────────────────────────────
  const kindTotals: Record<string, number> = {};
  for (const g of input.groups) kindTotals[g.kind] = g.total;
  const outChips = chips.map((c) => {
    if (!c.options) return c;
    if (c.filter.size !== undefined) return input.facets ? withOptionCounts(c, input.facets.size) : c;
    if (c.filter.grade !== undefined) return input.facets ? withOptionCounts(c, input.facets.grade) : c;
    if (c.filter.groups?.length === 1) return withOptionCounts(c, kindTotals);
    return c;
  });

  return {
    term,
    chips: outChips,
    groups,
    outside,
    didYouMean: [...(input.didYouMean ?? [])],
    empty: groups.length === 0 && !outside,
    filteredOut,
  };
}

// ── "Du bist hier" (concept 2026-11-17, note 4) ─────────────────────────────

/** The term names the row nearly exactly — a hit by its score 4, every other row by its title. */
export function isNearExactRow(term: string, row: SearchResultRow): boolean {
  if (!term.trim()) return false;
  switch (row.type) {
    case 'hit':
      return isNearExactHit(term, row.hit);
    case 'own': {
      const rest = row.title.includes(' ') ? row.title.slice(row.title.indexOf(' ') + 1) : null;
      return recordScore(term, [row.title, row.ownName, rest], [row.classNameSlug]) === 4;
    }
    default:
      return searchScore(term, row.title) === 4;
  }
}

/** The best match quality of the reader's own rows (title, own name, name without its first word, class). */
function ownQuality(term: string, own: OwnSearchResult): number {
  let best = 0;
  for (const r of own.rows) {
    const rest = r.title.includes(' ') ? r.title.slice(r.title.indexOf(' ') + 1) : null;
    best = Math.max(best, qualityOfScore(recordScore(term, [r.title, r.ownName, rest], [r.classNameSlug])));
  }
  return best;
}

/** The greyed "Du bist hier" row: name and hint only — no CTA, no icons, no fit badge. */
function asCurrent(row: SearchResultRow): SearchResultRow {
  const base = { ...row, current: true as const, cta: null, icons: { ...NO_ICONS } };
  return base.type === 'hit' ? { ...base, fit: null } : base;
}

/** Mark the variant mini link that is open on the page. */
function withVariantState(row: SearchResultRow, here: PageLocation): SearchResultRow {
  if ((row.type !== 'hit' && row.type !== 'own') || !row.variants?.length) return row;
  return { ...row, variants: markVariants(row.variants, here) };
}


/**
 * One row per ship page (C11, the reader's words: "ein eintrag mit mini textlinks zu varianten").
 * A catalog ship row (`/codex/ship/<class>`, the stock ship) and every own ship / own variant row
 * of the same class become ONE row: the catalog row, carrying the reader's variants of that class
 * as mini links, at the better reading position of its parts (the own row's slot when the own
 * group stands first). A hull with a page of its own (Gladius Valiant, Pirate) has another class,
 * so it stays its own row; items and liveries are no ship rows. An own row whose hull is not
 * listed stays an own row. Group totals stay the sources' sums.
 */
export function foldShipRows(
  groups: readonly SearchResultGroup[],
  outside: SearchResultGroup | null,
  variantsOf: ShipVariantsOf,
  baseOf: (classNameSlug: string) => string = (c) => c.toLowerCase(),
): { groups: SearchResultGroup[]; outside: SearchResultGroup | null } {
  const slugOf = (r: SearchResultRow): string | null =>
    r.type === 'hit' ? (r.hit.kind === 'ship' ? baseOf(r.hit.classNameSlug) : null)
      : r.type === 'own' && (r.ownKind === 'ship' || r.ownKind === 'config') && r.classNameSlug ? baseOf(r.classNameSlug)
        : null;
  interface At { g: number; r: number }
  const hitAt = new Map<string, At>();
  groups.forEach((g, gi) =>
    g.rows.forEach((r, ri) => {
      const k = r.type === 'hit' ? slugOf(r) : null;
      if (k && !hitAt.has(k)) hitAt.set(k, { g: gi, r: ri });
    }),
  );
  const ownAt = new Map<string, At>();
  const drop = new Set<SearchResultRow>();
  groups.forEach((g, gi) =>
    g.rows.forEach((r, ri) => {
      const k = r.type === 'own' ? slugOf(r) : null;
      if (!k || !hitAt.has(k)) return;
      drop.add(r);
      if (!ownAt.has(k)) ownAt.set(k, { g: gi, r: ri });
    }),
  );
  const moved = new Map<string, At>();
  for (const [k, o] of ownAt) {
    const h = hitAt.get(k)!;
    if (o.g < h.g || (o.g === h.g && o.r < h.r)) moved.set(k, o);
  }
  const withVariants = (r: SearchResultRow): SearchResultRow => {
    const k = r.type === 'hit' ? slugOf(r) : null;
    const vs = k && r.type === 'hit' ? variantsOf(r.hit.classNameSlug) : undefined;
    return vs?.length && r.type === 'hit' ? { ...r, variants: [...vs] } : r;
  };
  const out: SearchResultGroup[] = [];
  groups.forEach((g, gi) => {
    const rows: SearchResultRow[] = [];
    g.rows.forEach((r, ri) => {
      const k = slugOf(r);
      if (drop.has(r)) {
        const m = k ? moved.get(k) : undefined;
        if (k && m && m.g === gi && m.r === ri) {
          const h = hitAt.get(k)!;
          rows.push(withVariants(groups[h.g].rows[h.r]));
        }
        return;
      }
      if (r.type === 'hit' && k) {
        const at = hitAt.get(k)!;
        if (at.g === gi && at.r === ri && moved.has(k)) return;
      }
      rows.push(withVariants(r));
    });
    if (!rows.length) return;
    const same = rows.length === g.rows.length && rows.every((r, i) => r === g.rows[i]);
    out.push(same ? g : { ...g, rows, expandable: Math.max(0, rows.length - SEARCH_ROWS_SHOWN) });
  });
  const outs = outside ? { ...outside, rows: outside.rows.map(withVariants) } : null;
  return { groups: out, outside: outs };
}

/**
 * The current-page rule over composed groups (fusion bar): a row on the page
 * the reader stands on is hidden for a weak match and kept at its rank, greyed,
 * for a near-exact one. When nothing would remain, the first hidden row comes
 * back greyed — never an empty panel. Totals and counts stay the source's.
 */
export function applyCurrentRows(
  groups: SearchResultGroup[],
  outside: SearchResultGroup | null,
  term: string,
  here: PageLocation | null | undefined,
): { groups: SearchResultGroup[]; outside: SearchResultGroup | null } {
  if (!here) return { groups, outside };
  const hidden: { at: number; group: SearchResultGroup; row: SearchResultRow }[] = [];
  const pass = (g: SearchResultGroup, at: number): SearchResultGroup => {
    const rows: SearchResultRow[] = [];
    for (const raw of g.rows) {
      const row = withVariantState(raw, here);
      if (!isCurrentTarget(row.target, here)) rows.push(row);
      else if (isNearExactRow(term, row) || otherMemberMatched(row.type === 'hit' ? row.variants : undefined)) rows.push(asCurrent(row));
      else hidden.push({ at, group: g, row });
    }
    return rows.length === g.rows.length && rows.every((r, i) => r === g.rows[i])
      ? g
      : { ...g, rows, expandable: Math.max(0, rows.length - SEARCH_ROWS_SHOWN) };
  };
  const passed = groups.map(pass);
  let out = passed.filter((g) => g.rows.length);
  let outs = outside ? pass(outside, -1) : null;
  if (outs && !outs.rows.length) outs = null;
  const first = hidden[0];
  if (first && !out.length && !outs) {
    const back = { ...first.group, rows: [asCurrent(first.row)], expandable: 0 };
    if (first.at === -1) outs = back;
    else out = [back];
  }
  return { groups: out, outside: outs };
}

function indexMoreTarget(kind: PolyHitKind, term: string, chips: readonly SearchChip[]): SearchTarget {
  const t = indexTarget(kind, term);
  const size = chips.find((c) => c.filter.size !== undefined)?.filter.size;
  const grade = chips.find((c) => c.filter.grade)?.filter.grade;
  if (size === undefined && !grade) return t;
  return { ...t, queryParams: { ...(t.queryParams ?? {}), ...(size !== undefined ? { size: String(size) } : {}), ...(grade ? { grade } : {}) } };
}

function groupReason(g: SearchResultGroup, index: number, ctx: SearchContext): SearchReason | null {
  const inHq = ctx.key.startsWith('hq') || ctx.ownedFirst;
  if (g.id === 'own') {
    if (index === 0 && inHq) return { key: 'search.why.ownHq', params: {} };
    return { key: 'search.why.own', params: null };
  }
  if (index !== 0) return null;
  if (g.id === 'gallery' && ctx.key === 'gallery') return { key: 'search.why.context', params: { ctx: ctx.labelKey } };
  if (g.kind && ctx.prefer.includes(g.kind) && contextBoost(g.kind as PolyHitKind, ctx) > 0) return { key: 'search.why.context', params: { ctx: ctx.labelKey, kind: g.kind } };
  return null;
}
