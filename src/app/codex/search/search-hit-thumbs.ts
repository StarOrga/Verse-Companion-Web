// SEARCH ROW THUMBNAILS — which picture of the thing itself a result row shows.
// -----------------------------------------------------------------------------
// Admin feedback #402: a result row should show the real, coloured picture of
// the ship or item instead of the generic category glyph. Pure, so the choice
// is testable without Angular; the row walks the candidates with
// `sc-fallback-image` and keeps its glyph (or the ship blueprint) when the list
// is empty or every candidate fails.

import { PolySearchHit, isUpcomingHit } from '../codex-poly-search';

/** Where the art comes from — `UpcomingShipsService` in the app, a stub in specs. */
export interface SearchHitArtSource {
  /** RSI store renders of an ingested ship, keyed by its `name_localized`; empty when unknown or not loaded. */
  shipArt(nameLocalized: string | null): readonly string[];
  /** RSI renders of an announced ship, by its feed id; empty when unknown or not loaded. */
  upcomingArt(feedId: string): readonly string[];
}

const NONE: readonly string[] = [];

/**
 * Colour thumbnail candidates of a hit, smallest-first (the order the RSI feed
 * already lists them for a card).
 *
 * Only ships and announced ships have one: RSI publishes a store render per hull.
 * Items, weapons and components do not — the build carries nothing but the game's
 * flat white UI glyph (`payload.previewImage`, one per weapon family or armour
 * weight, e.g. `heavy_armour_64.webp` for every heavy armour piece), which says
 * less than our own category icon. They return no candidates until the Data
 * Uploader extracts a coloured render per item.
 */
export function hitThumbCandidates(
  hit: Pick<PolySearchHit, 'kind' | 'classNameSlug' | 'nameLocalized'>,
  art: SearchHitArtSource,
): readonly string[] {
  if (hit.kind === 'ship') return art.shipArt(hit.nameLocalized);
  if (isUpcomingHit(hit)) return art.upcomingArt(hit.classNameSlug);
  return NONE;
}
