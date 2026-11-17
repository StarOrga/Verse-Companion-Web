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
