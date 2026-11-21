import type { PatchChannel } from './patch-read';
import { type PatchLineGroup, type PatchNoteEntry } from './patch-notes';
import type { PatchOutline } from './patch-outline';
import type { StackCard } from './patch-stack';
import { linesInTesting } from './patch-stats';
import type { SubVersionRow } from './patch-timeline';
import type { RoadmapCard, RoadmapStatus } from './roadmap';

/**
 * Pure selection logic of the "Live first" patch board (concept 20261110-1749,
 * round 5): which note heads the Live box, how a line's notes bundle, which
 * builds the PTU tab lists, what the roadmap chips count. Everything derives
 * from data the board already holds — no new source.
 */

const DAY_MS = 86_400_000;

export function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Whole days between `fromMs` and `nowMs`, never negative. */
export function daysBetween(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / DAY_MS));
}

/** Test builds (PTU / Evocati) belong to the PTU channel, everything else to Live. */
export function channelOfEntry(entry: Pick<PatchNoteEntry, 'facet'>): PatchChannel {
  return entry.facet === 'ptu' || entry.facet === 'evocati' ? 'ptu' : 'live';
}

/** Publication instants (ms) of every note of a channel across all lines. */
export function channelTimes(groups: readonly PatchLineGroup[], channel: PatchChannel): number[] {
  const out: number[] = [];
  for (const g of groups) {
    for (const e of g.entries) {
      if (channelOfEntry(e) === channel) out.push(ms(e.item.publishedAt));
    }
  }
  return out;
}

/** The first image a note carries (gallery image, else thumbnail). */
function entryImage(e: PatchNoteEntry): string | null {
  return e.item.images?.[0] ?? e.item.thumbnail ?? null;
}

/** Image of a card: the newest note that has one, else a roadmap thumbnail, else null (→ generated stand-in). */
export function cardImage(card: StackCard): string | null {
  const entries = [...(card.group?.entries ?? [])].sort((a, b) => ms(b.item.publishedAt) - ms(a.item.publishedAt));
  for (const e of entries) {
    const img = entryImage(e);
    if (img) return img;
  }
  return card.release?.cards.find((c) => c.thumbnail)?.thumbnail ?? null;
}

/** The Live view of a line: its newest live note on top, the earlier small patches bundled. */
export interface LiveLineView {
  latest: SubVersionRow | null;
  earlier: SubVersionRow[];
}

/** `rows` are `subVersionRows()` output (newest version first). Only live-ring notes count; test builds live on the PTU tab. */
export function liveLineView(rows: readonly SubVersionRow[]): LiveLineView {
  const live = rows.filter((r) => r.stage === 'live' || r.stage === null);
  return { latest: live[0] ?? null, earlier: live.slice(1) };
}

/** One build of the PTU tab. */
export interface PtuRow {
  id: string;
  line: string;
  version: string;
  title: string;
  stage: 'ptu' | 'evocati';
  publishedAt: string;
  url: string;
  /** 1-based wave within its line (oldest = 1). */
  wave: number;
  newest: boolean;
  image: string | null;
}

/**
 * Every single test build, newest first. Lines still in testing are the point
 * of the tab; with none in testing the newest builds overall are listed so the
 * tab is never empty for no reason.
 */
export function ptuRows(groups: readonly PatchLineGroup[], fallbackCount = 6): PtuRow[] {
  const testing = linesInTesting(groups);
  const pool = testing.length > 0 ? testing : groups.filter((g) => g.line);
  const all: PtuRow[] = [];
  for (const g of pool) {
    const builds = g.entries
      .filter((e) => e.facet === 'ptu' || e.facet === 'evocati')
      .sort((a, b) => ms(a.item.publishedAt) - ms(b.item.publishedAt));
    builds.forEach((e, i) => {
      all.push({
        id: String(e.item.id),
        line: g.line,
        version: e.version,
        title: e.item.title,
        stage: e.facet === 'evocati' ? 'evocati' : 'ptu',
        publishedAt: e.item.publishedAt,
        url: e.item.url,
        wave: i + 1,
        newest: false,
        image: entryImage(e),
      });
    });
  }
  all.sort((a, b) => ms(b.publishedAt) - ms(a.publishedAt));
  const rows = testing.length > 0 ? all : all.slice(0, fallbackCount);
  return rows.map((r, i) => ({ ...r, newest: i === 0 }));
}

// ---- roadmap chips ----------------------------------------------------------

/**
 * What the RSI roadmap data really carries per item: `committed`, `tentative`,
 * `released` (+ `unknown`). They map to Bestätigt / Möglich / Ausgeliefert;
 * "Verschoben" does not exist in the data and is NOT invented.
 */
export type RoadmapBucket = 'committed' | 'tentative' | 'released';
export const ROADMAP_BUCKETS: readonly RoadmapBucket[] = ['committed', 'tentative', 'released'];

export interface RoadmapChip {
  bucket: RoadmapBucket;
  count: number;
}

function inBucket(status: RoadmapStatus, bucket: RoadmapBucket): boolean {
  return status === bucket;
}

/** Chips only for buckets that have items. */
export function roadmapChips(cards: readonly RoadmapCard[]): RoadmapChip[] {
  return ROADMAP_BUCKETS.map((bucket) => ({ bucket, count: cards.filter((c) => inBucket(c.status, bucket)).length })).filter(
    (c) => c.count > 0,
  );
}

export function cardsInBucket(cards: readonly RoadmapCard[], bucket: RoadmapBucket): RoadmapCard[] {
  return cards.filter((c) => inBucket(c.status, bucket));
}

/** Up to `n` item lines under the chips: confirmed first, then possible, then the rest. */
export function previewCards(cards: readonly RoadmapCard[], n = 4): RoadmapCard[] {
  const rank = (c: RoadmapCard): number => ROADMAP_BUCKETS.indexOf(c.status as RoadmapBucket);
  return [...cards]
    .map((c, i) => ({ c, i, r: rank(c) < 0 ? 9 : rank(c) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, n)
    .map((x) => x.c);
}

// ---- headline bullets -------------------------------------------------------

const MAINTENANCE = /bug|fix|known|technical|behoben|bekannt/i;

/**
 * 3–4 headline bullets of a note: top-level bullets of the first sections that
 * are about content, not maintenance (fixes / known issues come last).
 */
export function headlineBullets(outline: PatchOutline | null, n = 4): string[] {
  if (!outline) return [];
  const content: string[] = [];
  const maintenance: string[] = [];
  let heading = '';
  for (const node of outline.nodes) {
    if (node.kind === 'heading') heading = node.text;
    else if (node.kind === 'bullet' && node.depth === 0 && node.text.trim()) {
      (MAINTENANCE.test(heading) ? maintenance : content).push(node.text.trim());
    }
  }
  return [...content, ...maintenance].slice(0, n);
}

/** Large faint number of a generated stand-in image: `4.10.3` → `4.10`. */
export function standInLabel(line: string, version?: string): string {
  return line || version || '';
}
