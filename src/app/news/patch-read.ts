/**
 * Read state of the patch notes ("Lesebestätigung"), pure part.
 *
 * Two channels, because a Live player does not care about test builds: `live`
 * (live release notes and hotfixes) and `ptu` (PTU + Evocati waves). Per
 * channel one cutoff is stored — every note published at or before `upTo` counts
 * as read. That gives the first-contact rule for free: the history before the
 * newest note starts as read (no wall of dots), the newest note itself stays
 * unread until the reader confirms.
 */
export type PatchChannel = 'live' | 'ptu';

export interface ChannelRead {
  /** Notes published at or before this instant (ms) count as read. */
  upTo: number;
  /** When the reader confirmed (ms); null for the first-contact baseline. */
  at: number | null;
}

export type ReadState = Partial<Record<PatchChannel, ChannelRead>>;

export const PATCH_READ_PREF_KEY = 'patchNotesRead';

/** Stored JSON (string) → state; anything malformed is an empty state. */
export function parseReadState(raw: unknown): ReadState {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: ReadState = {};
    for (const ch of ['live', 'ptu'] as const) {
      const c = obj?.[ch] as { upTo?: unknown; at?: unknown } | undefined;
      if (c && typeof c.upTo === 'number' && Number.isFinite(c.upTo)) {
        out[ch] = { upTo: c.upTo, at: typeof c.at === 'number' && Number.isFinite(c.at) ? c.at : null };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeReadState(state: ReadState): string {
  return JSON.stringify(state);
}

/** First contact: everything but the newest note counts as read. `times` in any order. */
export function baselineCutoff(times: readonly number[]): number {
  const sorted = times.filter((t) => Number.isFinite(t)).sort((a, b) => b - a);
  return sorted.length > 1 ? sorted[1] : 0;
}

/** Has the note published at `publishedMs` been read? A channel without state counts as read (no flash of dots before the baseline is written). */
export function isRead(state: ReadState, channel: PatchChannel, publishedMs: number): boolean {
  const c = state[channel];
  return c ? publishedMs <= c.upTo : true;
}

/** Confirm everything up to the newest note of the channel. */
export function withRead(state: ReadState, channel: PatchChannel, times: readonly number[], nowMs: number): ReadState {
  const newest = Math.max(0, ...times.filter((t) => Number.isFinite(t)));
  const prev = state[channel]?.upTo ?? 0;
  return { ...state, [channel]: { upTo: Math.max(prev, newest), at: nowMs } };
}

/** "Nochmal lesen": the note at `noteMs` (and everything newer) becomes unread again. */
export function withUnread(state: ReadState, channel: PatchChannel, noteMs: number, times: readonly number[]): ReadState {
  const older = times.filter((t) => Number.isFinite(t) && t < noteMs);
  return { ...state, [channel]: { upTo: older.length ? Math.max(...older) : 0, at: null } };
}

/** How many of `times` are unread. */
export function unreadCount(state: ReadState, channel: PatchChannel, times: readonly number[]): number {
  return times.filter((t) => !isRead(state, channel, t)).length;
}
