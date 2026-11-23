import type { VerseNewsItem } from './news.service';

/*
 * In-game events in Verse News (feedback #389): the "Events" category of the
 * stream and the event teasers above/below it and in the Verse hub.
 *
 * Two existing sources, no new one:
 * - the curated event timeline `public.sc_events` (expos, festivals, Free Fly,
 *   showcases), kept current by `sc-events-sync` from the comm-links;
 * - the news feed itself: an article or video is an event post when its title
 *   names an event. The family patterns mirror FAMILIES in
 *   supabase/functions/sc-events-sync/matcher.ts — keep the two in sync — plus
 *   the dynamic in-game events the timeline does not carry as a family.
 *
 * Pure: no Angular, no I/O.
 */

export type VerseEventKind = 'expo' | 'showcase' | 'seasonal' | 'community' | 'free-fly';

/** One `sc_events` row as the teasers need it. Dates are `YYYY-MM-DD` (UTC days). */
export interface VerseEvent {
  readonly id: string;
  readonly kind: VerseEventKind;
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly dateStatus: 'confirmed' | 'estimated';
  readonly freeFly: boolean;
  /** RSI comm-link announcing it; '' when none is known yet. */
  readonly url: string;
  readonly summary: { readonly en: string; readonly de: string };
  /**
   * The event's official RSI picture (`sc_events.extra.image`, found by `sc-events-sync`, feedback #400): the
   * edition's schedule artwork when RSI published one, else the event post's header image. Null while none is known.
   */
  readonly image: VerseEventImage | null;
}

export interface VerseEventImage {
  readonly url: string;
  /** `schedule` = the dated rental/hall plan (shown whole); `hero`/`admin` = header artwork (cropped to fit). */
  readonly kind: 'schedule' | 'hero' | 'admin';
  /** The RSI article the picture comes from. */
  readonly from: string;
}

const RSI_IMAGE_HOSTS = new Set(['robertsspaceindustries.com', 'media.robertsspaceindustries.com']);

/** `extra.image` as stored → a picture the CSP allows, or null (the column is jsonb, so nothing about it is trusted). */
export function eventImageOf(extra: unknown): VerseEventImage | null {
  const raw = (extra as { image?: unknown } | null)?.image as { url?: unknown; kind?: unknown; from?: unknown } | undefined;
  if (!raw || typeof raw.url !== 'string') return null;
  try {
    const u = new URL(raw.url);
    if (u.protocol !== 'https:' || !RSI_IMAGE_HOSTS.has(u.hostname)) return null;
  } catch {
    return null;
  }
  const kind = raw.kind === 'schedule' || raw.kind === 'admin' ? raw.kind : 'hero';
  return { url: raw.url, kind, from: typeof raw.from === 'string' ? raw.from : '' };
}

/** Mirror of the family patterns in sc-events-sync/matcher.ts (FAMILIES[].pattern). */
const FAMILY_PATTERNS: readonly RegExp[] = [
  /\b(invictus(?: launch week)?|defensecon)\b/i,
  /\b([Ii]ntergalactic [Aa]erospace [Ee]xpo|IAE)\b/,
  /\bluminalia\b/i,
  /\bday of the vara\b/i,
  /\bred festival\b/i,
  /\bstella fortuna\b/i,
  /\bcoramor\b/i,
  /\bfoundation festival\b/i,
  /\bcitizencon\b/i,
  /\balien week\b/i,
  /\bship showdown\b/i,
  /\bpirate week\b/i,
  /\bcaptains of industry\b/i,
  /\bfleet week\b/i,
  /\bjump ?town\b/i,
  /\bdiscovery month\b/i,
  /\bfree[- ]fly\b/i,
];

/** Dynamic in-game events (scenarios, not calendar families) and the plain word. */
const DYNAMIC_PATTERNS: readonly RegExp[] = [
  /\bxeno ?threat\b/i,
  /\bsiege of orison\b/i,
  /\bnine tails lockdown\b/i,
  /\bblockade runner\b/i,
  /\bresource drive\b/i,
  /\bassault on stanton\b/i,
  /\bevents?\b/i,
];

/** Titles that name an event in passing but are not about it. */
const NOT_EVENT = /\b(monthly report|roadmap roundup|patch notes?)\b/i;

/** Channels a post can come from; patch notes and status lines never are event posts. */
const EVENT_CHANNELS: readonly VerseNewsItem['channel'][] = ['comm-link', 'youtube', 'spectrum'];

/** An event's name without its in-game year ("Luminalia 2956" → "luminalia"), for title matching. */
export function eventStem(name: string): string {
  return name.replace(/\b2\d{3}\b/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * True when a news post is about an in-game event: its title names a known
 * family, a dynamic event, the word "event", or one of the timeline's own event
 * names (`stems`, see {@link eventStem}) — so a hand-curated event without a
 * family pattern still finds its posts.
 */
export function isEventNews(item: Pick<VerseNewsItem, 'title' | 'channel'>, stems: readonly string[] = []): boolean {
  if (!EVENT_CHANNELS.includes(item.channel)) return false;
  const title = item.title ?? '';
  if (!title || NOT_EVENT.test(title)) return false;
  if (FAMILY_PATTERNS.some((p) => p.test(title)) || DYNAMIC_PATTERNS.some((p) => p.test(title))) return true;
  const lower = title.toLowerCase();
  return stems.some((s) => s.length >= 4 && lower.includes(s));
}

/** Today as a `YYYY-MM-DD` UTC day — the unit `sc_events` dates are in. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type EventPhase = 'running' | 'upcoming' | 'past';

export function eventPhase(e: Pick<VerseEvent, 'start' | 'end'>, now: number): EventPhase {
  const today = utcDay(now);
  if (e.end < today) return 'past';
  return e.start <= today ? 'running' : 'upcoming';
}

/** Whole days from today to a `YYYY-MM-DD` day (negative = past). */
export function daysUntil(day: string, now: number): number {
  const t = Date.parse(`${day}T00:00:00Z`);
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round((t - today) / 86_400_000) : 0;
}

export interface EventTeaser {
  /** Running now, the one ending first first. */
  readonly running: readonly VerseEvent[];
  /** Not started yet, soonest first. */
  readonly upcoming: readonly VerseEvent[];
}

/** How far ahead an upcoming event is worth a teaser: an estimate a season away is noise. */
export const UPCOMING_HORIZON_DAYS = 120;

/** Running and upcoming events, each list capped; past events drop out. */
export function eventTeaser(events: readonly VerseEvent[], now: number, max = 4): EventTeaser {
  const running = events
    .filter((e) => eventPhase(e, now) === 'running')
    .sort((a, b) => a.end.localeCompare(b.end) || a.name.localeCompare(b.name))
    .slice(0, max);
  const upcoming = events
    .filter((e) => eventPhase(e, now) === 'upcoming' && daysUntil(e.start, now) <= UPCOMING_HORIZON_DAYS)
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
    .slice(0, max);
  return { running, upcoming };
}
