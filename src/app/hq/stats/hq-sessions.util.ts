import type { HqLiveEventRow } from '../data/hq-db.types';

/** The event types the logbook reads (#896): boundaries plus what a session card counts. */
export const LOGBOOK_EVENT_TYPES = [
  'session.joined',
  'session.quit',
  'disconnect',
  'qt.arrived',
  'contract.completed',
  'shop.purchase',
  'incapacitated',
  'vehicle.destroyed',
  'insurance.claim_complete',
] as const;

/** How a session ended: by a quit/disconnect, without one (crash, app closed), or not yet (the live one). */
export type SessionEnd = 'quit' | 'noQuit' | 'live';

export interface LogbookSession {
  /** Start of the session: its `session.joined`, else (attached late) its first event. */
  startedAt: string;
  /** The quit/disconnect, else the last event of the session. */
  endedAt: string;
  durationMs: number;
  end: SessionEnd;
  /** The app attached to a running game, so no `session.joined` was uploaded: the start is the first event seen. */
  startUnknown: boolean;
  jumps: number;
  contracts: number;
  /** Sells minus buys from `shop.purchase` `price` (the contract's TOTAL), like `hq_stats`. */
  auecNet: number;
  /** Whether any purchase fed `auecNet` (0 with trades ≠ 0 without). */
  traded: boolean;
  deaths: number;
  shipsLost: number;
  claims: number;
}

type Ev = Pick<HqLiveEventRow, 'type' | 'at' | 'data'>;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

function emptySession(startedAt: string, startUnknown: boolean): LogbookSession {
  return {
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    end: 'noQuit',
    startUnknown,
    jumps: 0,
    contracts: 0,
    auecNet: 0,
    traded: false,
    deaths: 0,
    shipsLost: 0,
    claims: 0,
  };
}

/**
 * Groups live events into game sessions, newest session first. A session runs from
 * `session.joined` to the next `session.quit` / `disconnect`. Events before the first
 * `joined` (the app attached to a running game) open a session of their own with an
 * unknown start. A session without an end is closed at its last event; the newest one is
 * `live` when `gameLive` says the game still runs, else it ended without a quit.
 */
export function groupSessions(events: readonly Ev[], gameLive: boolean): LogbookSession[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: LogbookSession[] = [];
  let cur: LogbookSession | null = null;
  const close = (s: LogbookSession, at: string, end: SessionEnd) => {
    s.endedAt = at;
    s.end = end;
    s.durationMs = Math.max(0, Date.parse(at) - Date.parse(s.startedAt));
    out.push(s);
  };
  for (const e of sorted) {
    if (e.type === 'session.joined') {
      if (cur) close(cur, cur.endedAt, 'noQuit');
      cur = emptySession(e.at, false);
      continue;
    }
    if (e.type === 'session.quit' || e.type === 'disconnect') {
      if (cur) close(cur, e.at, 'quit');
      cur = null;
      continue;
    }
    cur ??= emptySession(e.at, true);
    cur.endedAt = e.at;
    const d = e.data ?? {};
    switch (e.type) {
      case 'qt.arrived':
        cur.jumps++;
        break;
      case 'contract.completed':
        cur.contracts++;
        break;
      case 'shop.purchase': {
        // Same rule as the `hq_stats` RPC, so the logbook and the Statistik totals agree.
        const price = num(d['price']);
        if (d['kind'] === 'sell') cur.auecNet += price;
        else cur.auecNet -= price;
        cur.traded = true;
        break;
      }
      case 'incapacitated':
        cur.deaths++;
        break;
      case 'vehicle.destroyed':
        cur.shipsLost++;
        break;
      case 'insurance.claim_complete':
        cur.claims++;
        break;
    }
  }
  if (cur) close(cur, cur.endedAt, gameLive ? 'live' : 'noQuit');
  return out.reverse();
}
