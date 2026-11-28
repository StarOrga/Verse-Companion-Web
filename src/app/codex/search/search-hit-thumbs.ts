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
  /**
   * URL of an item's model render (`renderImage`), or null when the reader
   * chose icons (Settings, `ItemArtPrefsService`) or no build is loaded.
   */
  itemRender(renderImage: string): string | null;
}

const NONE: readonly string[] = [];

/** Kinds whose rows can carry a model render (the item-like tables). */
const RENDER_KINDS: ReadonlySet<string> = new Set(['item', 'weapon', 'component']);

/**
 * Colour thumbnail candidates of a hit, smallest-first (the order the RSI feed
 * already lists them for a card).
 *
 * Only ships and announced ships have one: RSI publishes a store render per hull.
 * Items, weapons and components show the colour still of their 3D model that
 * the Data Uploader renders (`payload.renderImage`, #402) — never the game's
 * flat white UI glyph (`payload.previewImage`, one per weapon family or armour
 * weight), which says less than our own category icon. No render, or the
 * reader picked icons in Settings → no candidates, the row keeps its icon.
 */
export function hitThumbCandidates(
  hit: Pick<PolySearchHit, 'kind' | 'classNameSlug' | 'nameLocalized' | 'renderImage'>,
  art: SearchHitArtSource,
): readonly string[] {
  if (hit.kind === 'ship') return art.shipArt(hit.nameLocalized);
  if (isUpcomingHit(hit)) return art.upcomingArt(hit.classNameSlug);
  if (hit.renderImage && RENDER_KINDS.has(hit.kind)) {
    const url = art.itemRender(hit.renderImage);
    return url ? [url] : NONE;
  }
  return NONE;
}
