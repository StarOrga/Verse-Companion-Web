/**
 * Snap logic of the phone stats sheet (`sc-codex-holo-strip`): three visible heights, a drag that follows
 * the finger 1:1, a release that picks the next snap by velocity or the nearest one. Pure, so the
 * component only wires pointer events to it.
 */
export type SheetSnap = 'peek' | 'half' | 'full';

export interface SnapHeights { peek: number; half: number; full: number }

const ORDER: readonly SheetSnap[] = ['peek', 'half', 'full'];

/** px/ms over the last 80 ms above which a release flings to the next snap. */
export const FLING_VELOCITY = 0.5;
/** Past `full` the sheet gives 30 % of the finger's travel (rubber band). */
export const RUBBER_DAMPING = 0.3;

/** Tap on the handle: peek opens to half, anything else folds back to peek. */
export function cycleSnap(current: SheetSnap): SheetSnap {
  return current === 'peek' ? 'half' : 'peek';
}

/** The visible height while dragging: raw px between peek and full, damped beyond full, never under peek. */
export function dragVisible(startVisible: number, deltaUp: number, h: SnapHeights): number {
  const raw = startVisible + deltaUp;
  if (raw > h.full) return h.full + (raw - h.full) * RUBBER_DAMPING;
  return Math.max(h.peek, raw);
}

/** Where a release settles. `velocityUp` is px/ms, positive = the finger moved up. */
export function settleSnap(visible: number, velocityUp: number, h: SnapHeights): SheetSnap {
  const v = Math.min(visible, h.full);
  if (Math.abs(velocityUp) > FLING_VELOCITY) {
    if (velocityUp > 0) return ORDER.find((s) => h[s] > v + 1) ?? 'full';
    return [...ORDER].reverse().find((s) => h[s] < v - 1) ?? 'peek';
  }
  return ORDER.reduce((best, s) => (Math.abs(h[s] - v) < Math.abs(h[best] - v) ? s : best), 'peek' as SheetSnap);
}

/** px/ms from the last pointer samples (only those within 80 ms of the newest). */
export function releaseVelocity(samples: readonly { t: number; y: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= 80) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (first.y - last.y) / dt : 0;
}
