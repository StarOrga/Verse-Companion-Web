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
/** A flick this fast skips the middle snap: straight to full / peek. */
export const HARD_FLING_VELOCITY = 1.6;
/** How long a released fling is assumed to keep coasting (ms): the projected landing is visible + velocity * this. */
export const COAST_MS = 220;
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
  const nearest = (at: number) => ORDER.reduce((best, s) => (Math.abs(h[s] - at) < Math.abs(h[best] - at) ? s : best), 'peek' as SheetSnap);
  if (Math.abs(velocityUp) > FLING_VELOCITY) {
    if (Math.abs(velocityUp) > HARD_FLING_VELOCITY) return velocityUp > 0 ? 'full' : 'peek';
    // A fling goes at least one snap on, and as far as its momentum would carry the sheet (a hard pull down from full ends at peek).
    const step = velocityUp > 0
      ? (ORDER.find((s) => h[s] > v + 1) ?? 'full')
      : ([...ORDER].reverse().find((s) => h[s] < v - 1) ?? 'peek');
    const carried = nearest(v + velocityUp * COAST_MS);
    return Math.abs(h[carried] - v) > Math.abs(h[step] - v) && Math.sign(h[carried] - v) === Math.sign(velocityUp) ? carried : step;
  }
  return nearest(v);
}

/** px/ms from the last pointer samples (only those within 80 ms of the newest). */
export function releaseVelocity(samples: readonly { t: number; y: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= 80) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (first.y - last.y) / dt : 0;
}
