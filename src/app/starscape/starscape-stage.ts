import { Wallpaper } from './starscape.service';

/**
 * The staged first load of the gallery (batch concept 20261115-2122, B1.7; the
 * binding motion spec is "B1.7 motion spec" in that concept's parity.md):
 *
 *   phase 1  announced "Neu"       - tiles published within {@link NEW_WINDOW_DAYS}
 *   phase 2  announced "Sammlung"  - tiles in the reader's Sammlung (up-voted)
 *   phase 3  unannounced           - every other painted tile, staggered
 *
 * Pure planning: it answers which tile starts when and which words show when;
 * the component turns that into CSS custom properties. An empty set skips its
 * phase (no word without tiles behind it) and the timeline closes up.
 */

/** "Neu" = published within this many days. */
export const NEW_WINDOW_DAYS = 14;
/** Length of an announced phase (veil + word), ms. */
export const PHASE_MS = 1100;
/** Tile entrance animation, ms. */
export const TILE_IN_MS = 420;
/** First announced tile starts this long into its phase, ms. */
const PHASE_TILE_LEAD_MS = 200;
/** Stagger inside an announced phase, ms. */
const PHASE_STAGGER_MS = 70;
/** Stagger of the unannounced rest, ms - capped so a full wall never drags. */
const REST_STAGGER_MS = 30;
const REST_STAGGER_CAP_MS = 600;
/** Announced tiles that still get their own slot; more share the last one. */
const PHASE_STAGGER_SLOTS = 10;

export interface StageWord {
  /** i18n key of the announcement. */
  readonly key: string;
  /** Start of its veil, ms from the page's arrival. */
  readonly at: number;
}

export interface StagePlan {
  /** Entrance delay per staged tile, ms. */
  readonly delays: ReadonlyMap<string, number>;
  /** Tiles of an announced phase (they get the accent mark). */
  readonly marked: ReadonlySet<string>;
  readonly words: readonly StageWord[];
  /** When everything has finished, ms - the staging class is dropped then. */
  readonly total: number;
}

const DAY_MS = 86_400_000;

export function isNew(w: Wallpaper, now: number): boolean {
  if (!w.publishedAt) return false;
  const t = Date.parse(w.publishedAt);
  return Number.isFinite(t) && now - t <= NEW_WINDOW_DAYS * DAY_MS && t <= now + DAY_MS;
}

/** Plan the staged load for the painted tiles, or null when there is nothing to stage. */
export function planStage(
  tiles: readonly Wallpaper[],
  collected: ReadonlySet<string>,
  now: number,
): StagePlan | null {
  if (tiles.length === 0) return null;
  const neu = tiles.filter((w) => isNew(w, now));
  const neuIds = new Set(neu.map((w) => w.imageId));
  const mine = tiles.filter((w) => !neuIds.has(w.imageId) && collected.has(w.imageId));
  const mineIds = new Set(mine.map((w) => w.imageId));
  const rest = tiles.filter((w) => !neuIds.has(w.imageId) && !mineIds.has(w.imageId));

  const delays = new Map<string, number>();
  const marked = new Set<string>();
  const words: StageWord[] = [];
  let t = 0;
  for (const [key, set] of [
    ['starscape.stage.new', neu],
    ['starscape.stage.sammlung', mine],
  ] as const) {
    if (set.length === 0) continue;
    words.push({ key, at: t });
    set.forEach((w, i) => {
      delays.set(w.imageId, t + PHASE_TILE_LEAD_MS + Math.min(i, PHASE_STAGGER_SLOTS) * PHASE_STAGGER_MS);
      marked.add(w.imageId);
    });
    t += PHASE_MS;
  }
  rest.forEach((w, i) => delays.set(w.imageId, t + Math.min(i * REST_STAGGER_MS, REST_STAGGER_CAP_MS)));
  const lastTile = Math.max(...delays.values()) + Math.max(TILE_IN_MS, marked.size ? 900 : 0);
  return { delays, marked, words, total: Math.max(t, lastTile) };
}

/** True when the platform asks for reduced motion (then nothing is staged). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
