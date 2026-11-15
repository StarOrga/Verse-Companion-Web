/**
 * The admin telemetry page's data: the `telemetry-overview` Edge Function's answer (contract §5, built in
 * `supabase/functions/telemetry-overview/_cards.ts`) and the pure helpers the page renders it with.
 */

export type OverviewLevel = 'ok' | 'warn' | 'error' | 'unknown';
export type CardId = 'quota' | 'errors' | 'services' | 'usage' | 'ai' | 'desktop';
export type ItemBadge = 'web' | 'server' | 'desktop';

export interface FeedbackText { title: string; body: string }

export interface OverviewItem {
  label: string;
  value?: string;
  badge?: ItemBadge;
  level?: OverviewLevel;
  url?: string;
  feedback?: FeedbackText;
}

export interface OverviewCard {
  id: CardId;
  level: OverviewLevel;
  kpi: { value: number | null; display: string; unitKey: string };
  delta?: { value: number; unit: 'pct' | 'abs' | 'pt'; better: 'up' | 'down' };
  forecast?: { display: string; pct?: number };
  spark?: number[];
  bar?: { pct: number; monthPct: number };
  top: OverviewItem[];
  links: { labelKey: string; url: string }[];
  feedbackCta?: FeedbackText;
  upgradeUrl?: string;
  boardWaiting?: number;
  calmKey?: string;
}

export interface Overview {
  generatedAt: string;
  lastVisitAt: string | null;
  posthogReachable: boolean;
  attention: number;
  cards: OverviewCard[];
  quotas: { product: string; usage: number; limit: number; pct: number; forecastPct: number }[];
}

/** The fixed order of the design when nothing is urgent, and the tie-break inside one level. */
export const CARD_ORDER: readonly CardId[] = ['quota', 'errors', 'services', 'usage', 'ai', 'desktop'];
const LEVEL_RANK: Record<OverviewLevel, number> = { error: 0, warn: 1, ok: 2, unknown: 3 };

export const needsAttention = (c: OverviewCard): boolean => c.level === 'warn' || c.level === 'error';

/** Same sort the server applies: error, warn, ok, unknown; inside a level the design order. */
export function sortCards(cards: readonly OverviewCard[]): OverviewCard[] {
  return [...cards].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id));
}

/**
 * An auto-refresh must not erase what the visit is about: the "seen" POST resets the server's "since your last
 * visit" window, so the next answer would report no new errors. The errors card of the first load of a visit
 * therefore stays pinned; every other card (quota, services, usage, cost, apps) takes the fresh values.
 */
export function mergeRefresh(first: Overview, fresh: Overview): Overview {
  const pinned = first.cards.find((c) => c.id === 'errors');
  if (!pinned) return fresh;
  const cards = sortCards(fresh.cards.map((c) => (c.id === 'errors' ? pinned : c)));
  return { ...fresh, lastVisitAt: first.lastVisitAt, cards, attention: cards.filter(needsAttention).length };
}

/** `points` of the inline spark polyline in a 120 × 26 box; flat series draw a centred line. */
export function sparkPoints(values: readonly number[], width = 120, height = 26, pad = 3): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = span === 0 ? height / 2 : height - pad - ((v - min) / span) * (height - 2 * pad);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}

/** "+12 %", "−9 %", "+3 Pkt." (unit text added by the caller for abs/pt) with a real minus sign. */
export function deltaText(d: NonNullable<OverviewCard['delta']>): string {
  const sign = d.value > 0 ? '+' : d.value < 0 ? '−' : '±';
  const n = Math.abs(d.value);
  return d.unit === 'pct' ? `${sign}${n} %` : `${sign}${n}`;
}

/** A change is good when it moves the way the card says is better; a worse one is a warning, never an error. */
export const deltaIsWorse = (d: NonNullable<OverviewCard['delta']>): boolean =>
  d.better === 'up' ? d.value < 0 : d.value > 0;

/** The PostHog project root, derived from any deep link the server sent (they all share `/project/<id>`). */
export function posthogRoot(cards: readonly OverviewCard[]): string {
  for (const c of cards) {
    for (const l of c.links) {
      const m = /^(https:\/\/[^/]+\/project\/[^/]+)/.exec(l.url);
      if (m) return m[1];
    }
  }
  return 'https://eu.posthog.com';
}

/** Services the server names by id; anything else renders verbatim. */
<<<<<<< HEAD
export const KNOWN_SERVICES = ['claude', 'posthog', 'supabase', 'r2', 'uex', 'rsi', 'xai', 'readme'] as const;

/** A feedback topic a finding already became — what the checked speech bubble links to. */
export interface LinkedTopic { id: string; seq: number | null }

/**
 * Match topics to findings: the seeded body opens with the finding's title as its own first line, and that line is
 * what an admin rarely rewrites. `rows` come newest first, so a title written twice links the newest topic.
 */
export function topicsByTitle(
  rows: readonly { id: string; seq?: number | null; body?: string | null }[],
  titles: readonly string[],
): ReadonlyMap<string, LinkedTopic> {
  const wanted = new Set(titles.map((t) => t.trim()).filter(Boolean));
  const out = new Map<string, LinkedTopic>();
  for (const r of rows) {
    const first = (r.body ?? '').split('\n', 1)[0].trim();
    if (wanted.has(first) && !out.has(first)) out.set(first, { id: r.id, seq: r.seq ?? null });
  }
  return out;
}
||||||| 939377ac8
export const KNOWN_SERVICES = ['claude', 'posthog', 'supabase', 'r2', 'uex', 'rsi', 'xai', 'readme'] as const;
=======
export const KNOWN_SERVICES = ['claude', 'posthog', 'supabase', 'r2', 'uex', 'rsi', 'readme'] as const;
>>>>>>> origin/main
