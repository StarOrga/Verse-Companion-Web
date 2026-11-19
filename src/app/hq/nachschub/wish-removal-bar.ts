/**
 * The segmented bar of the wish-removal dialog (concept 20261117-1110-pfad-stationen, C1/C5): one bar, one segment
 * per place the pieces leave - the free ones, then every Operation - each segment labelling itself, no legend. All
 * segments share one style; only the Route icon and the text mark an Operation segment. A label that does not fit
 * its segment hangs under it on a tick.
 */

export interface BarSegment {
  readonly id: string;
  /** Pieces this segment stands for; also its width weight. */
  readonly qty: number;
  /** `free` = pieces on no Operation, `op` = pieces taken out of an Operation. */
  readonly kind: 'free' | 'op';
  /** Operation name (kind `op`). */
  readonly name?: string;
}

/** The segments of a removal: the free share first, then one per Operation that gives pieces (qty > 0). */
export function barSegments(free: number, parts: readonly { readonly packageId: string; readonly packageName: string; readonly qty: number }[]): readonly BarSegment[] {
  const out: BarSegment[] = [];
  if (free > 0) out.push({ id: 'free', qty: free, kind: 'free' });
  for (const p of parts) if (p.qty > 0) out.push({ id: p.packageId, qty: p.qty, kind: 'op', name: p.packageName });
  return out;
}

/** Rough pixel width of a label at the bar's 12 px type, plus the segment's padding (and the Route icon). */
export function labelPx(label: string, withIcon: boolean): number {
  return label.length * 6.6 + 20 + (withIcon ? 20 : 0);
}

/** The labels of `segments` that do not fit inside their segment at `barPx` (0 = not measured yet: all fit). */
export function hangingIds(segments: readonly BarSegment[], labels: ReadonlyMap<string, string>, barPx: number, gapPx = 3, minPx = 56): ReadonlySet<string> {
  const out = new Set<string>();
  if (barPx <= 0 || segments.length === 0) return out;
  const total = segments.reduce((n, s) => n + s.qty, 0);
  const room = barPx - gapPx * (segments.length - 1);
  for (const s of segments) {
    const width = Math.max(minPx, (s.qty / total) * room);
    if (labelPx(labels.get(s.id) ?? '', s.kind === 'op') > width) out.add(s.id);
  }
  return out;
}

/** One hanging label: where its tick stands (px from the bar's left edge) and how far to indent it from the tick before it. */
export interface HangItem {
  readonly id: string;
  readonly x: number;
  readonly margin: number;
}

/**
 * The hanging labels as a chain, leftmost first. Each level is nested in the one before it: the nested element's left
 * border is the tick, so a tick runs down from the bar past the shallower labels (which start to its right) to its
 * own line, and no label can run into another - every label has its own line and wraps instead of being cut. A tick
 * near the right end is pulled left so its label keeps at least `minLabelPx` to wrap in.
 */
export function hangChain(segments: readonly BarSegment[], hanging: ReadonlySet<string>, barPx: number, gapPx = 3, minPx = 56, minLabelPx = 140): readonly HangItem[] {
  if (barPx <= 0 || hanging.size === 0) return [];
  const total = segments.reduce((n, s) => n + s.qty, 0);
  const room = barPx - gapPx * (segments.length - 1);
  let left = 0;
  const xs: { id: string; x: number }[] = [];
  for (const s of segments) {
    const width = Math.max(minPx, (s.qty / total) * room);
    if (hanging.has(s.id)) xs.push({ id: s.id, x: Math.max(0, Math.min(left + width / 2, barPx - minLabelPx)) });
    left += width + gapPx;
  }
  xs.sort((a, b) => a.x - b.x);
  // 9 px = the 1 px tick plus the 8 px between tick and text.
  return xs.map((h, i) => ({ id: h.id, x: h.x, margin: i === 0 ? h.x : Math.max(0, h.x - (xs[i - 1].x + 9)) }));
}
