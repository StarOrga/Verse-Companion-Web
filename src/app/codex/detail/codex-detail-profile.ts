// The per-kind profile of the one beta detail shell (concept batch-holotisch-kopf-vorlage, T1–T4):
// which stage, which panel tabs and whether a KPI strip is shown. The shell renders whatever the
// profile switches on; ship-only parts (hardpoints, decks, loadout, class hexagon) stay behind `ship`.
import type { CodexKind } from '../codex.service';

/** The panel tabs a non-ship page can have, in this order (r1-tabs). */
export type DetailTabId = 'einordnung' | 'werte' | 'bezug' | 'verbaut' | 'aenderungen';
export const DETAIL_TAB_ORDER: readonly DetailTabId[] = ['einordnung', 'werte', 'bezug', 'verbaut', 'aenderungen'];

/** `holo`: the ship holotable · `item`: the item stage beside the panel · `compact`: small stage, wider panel. */
export type DetailStageKind = 'holo' | 'item' | 'compact';

export interface DetailTab {
  readonly id: DetailTabId;
  /** Shown beside the label when > 0 (e.g. how many blueprints use it). */
  readonly count: number;
}

export interface DetailProfile {
  readonly stage: DetailStageKind;
  readonly tabs: readonly DetailTab[];
  /** A KPI strip under the body (the ship's four topics); simple items have none. */
  readonly strip: boolean;
}

/** What a page has data for; a tab without data is not shown (T3). */
export interface DetailTabData {
  /** A comparison graph exists for this kind (rank card). */
  readonly einordnung: boolean;
  /** Number of value blocks (facts, stat groups, damage, …). */
  readonly werte: number;
  /** Ways to get it: shops, a crafting recipe. */
  readonly bezug: number;
  /** Where it goes: blueprints that use it, the reader's ships/sets it is fitted to. */
  readonly verbaut: number;
  /** Patch changes of this record; 0 while the data has none. */
  readonly aenderungen: number;
  /** A 3D package or silhouette worth a full stage. */
  readonly richStage: boolean;
}

/** Tabs in their fixed order, only those with data; `werte` always stays so the panel is never empty. */
export function detailTabs(data: DetailTabData): DetailTab[] {
  const out: DetailTab[] = [];
  for (const id of DETAIL_TAB_ORDER) {
    if (id === 'einordnung') {
      if (data.einordnung) out.push({ id, count: 0 });
    } else if (id === 'werte') {
      out.push({ id, count: 0 });
    } else if (data[id] > 0) {
      out.push({ id, count: id === 'verbaut' ? data[id] : 0 });
    }
  }
  return out;
}

/**
 * The profile of one detail page. Ships keep their holotable (and the strip); an item with a
 * comparison graph or a real stage gets the item stage; everything else (iron, a backpack, water)
 * is `compact`: a small stage, a wider panel, no strip.
 */
export function detailProfileFor(kind: CodexKind | null | undefined, data: DetailTabData): DetailProfile {
  if (kind === 'ship') {
    return { stage: 'holo', tabs: [], strip: true };
  }
  const simple = !data.einordnung && !data.richStage;
  return { stage: simple ? 'compact' : 'item', tabs: detailTabs(data), strip: false };
}
