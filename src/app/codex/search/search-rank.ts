// Group order of the search panel — pure, framework-free (admin feedback #395).
// -----------------------------------------------------------------------------
// Before: the groups stood in a fixed kind order, re-ordered only by the page
// context. On a ship page "liber" showed Komponenten and Waffen above the group
// with the Liberator itself. Now a group's place follows its BEST match:
//
//   group score = best row quality (search-quality MATCH, tiers ≥ 10 apart)
//               + size bonus   (0 … 3.5: ship > component > weapon > item > …)
//               + context boost (0 … 5 for the kinds the page prefers)
//
// Both bonuses together stay below one tier gap (8.5 < 10), so they only decide
// between groups whose best hits match equally well: an exact hit in any group
// always beats a prefix or partial hit in the page's preferred group. Excluded
// kinds (HQ pages, D12) still sort after everything else; deprioritized ones
// lose the boost again (−5). The reader's own group (Hangar, Bestand, Sets) is
// placed by the composer: first on HQ pages and whenever its best row matches
// at least as well as the best catalog group, second otherwise.
//
// Contexts whose chip judges ROWS rather than groups (the ship page's
// "passt auf <Schiff>") give no group boost: the fit verdict orders rows inside
// their groups instead, so a ship name typed on a ship page still leads with the
// ship group.

import type { PolyHitKind } from '../codex-poly-search';
import type { SearchContext, SearchContextKey } from '../../shell/fusion-bar/search-context';

/** The size hierarchy for groups that match equally well — the ONE place it is defined. */
export const GROUP_SIZE_ORDER: readonly PolyHitKind[] = [
  'ship',
  'component',
  'weapon',
  'item',
  'ammunition',
  'manufacturer',
  'blueprint',
  // Announced ships last: a hull you can fly today leads over a concept page.
  'upcoming',
];

const SIZE_STEP = 0.5;
/** Boost of the page's first preferred kind; each further preferred kind gets one step less. */
export const CONTEXT_BOOST = 5;
const CONTEXT_STEP = 0.5;

/** Contexts whose chip orders rows (fit), not groups. */
const ROW_LEVEL_CONTEXTS: ReadonlySet<SearchContextKey> = new Set<SearchContextKey>(['ship']);

/** Size bonus of a kind: 3.5 for ships down to 0 for announced ships and unknown kinds. */
export function sizeBonus(kind: PolyHitKind): number {
  const i = GROUP_SIZE_ORDER.indexOf(kind);
  return i === -1 ? 0 : (GROUP_SIZE_ORDER.length - 1 - i) * SIZE_STEP;
}

/** How much the page the reader stands on lifts (or lowers) a kind's group. */
export function contextBoost(kind: PolyHitKind, ctx: SearchContext | null | undefined): number {
  if (!ctx || ROW_LEVEL_CONTEXTS.has(ctx.key)) return 0;
  const p = ctx.prefer.indexOf(kind);
  if (p !== -1) return Math.max(CONTEXT_STEP, CONTEXT_BOOST - p * CONTEXT_STEP);
  if (ctx.deprioritize.includes(kind)) return -CONTEXT_BOOST;
  return 0;
}

/** The score a group sorts by (see the header). */
export function groupScore(kind: PolyHitKind, best: number, ctx: SearchContext | null | undefined): number {
  return best + sizeBonus(kind) + contextBoost(kind, ctx);
}

/**
 * Groups in reading order: excluded kinds last, then by {@link groupScore}
 * (desc), then by the size hierarchy, then as they came. Stable, returns a copy.
 */
export function orderGroups<G>(
  groups: readonly G[],
  kindOf: (g: G) => PolyHitKind,
  bestOf: (g: G) => number,
  ctx: SearchContext | null | undefined = null,
): G[] {
  const size = (k: PolyHitKind): number => {
    const i = GROUP_SIZE_ORDER.indexOf(k);
    return i === -1 ? GROUP_SIZE_ORDER.length : i;
  };
  return groups
    .map((g, i) => {
      const kind = kindOf(g);
      return { g, i, kind, x: ctx?.exclude.includes(kind) ? 1 : 0, s: groupScore(kind, bestOf(g), ctx) };
    })
    .sort((a, b) => a.x - b.x || b.s - a.s || size(a.kind) - size(b.kind) || a.i - b.i)
    .map((e) => e.g);
}
