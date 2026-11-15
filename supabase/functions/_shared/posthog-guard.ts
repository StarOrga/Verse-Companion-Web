// Pure decision logic of the PostHog guard (posthog-signal, service-health, telemetry-overview).
// No I/O, no Deno globals - runs under node --test (erasable TypeScript syntax only).

/** Fixed identity of the machine author "PostHog-Wächter" (contract §4). A profiles row needs an auth.users row,
 *  so machine items are stored with author_id = null + origin <> 'human'; the id below is the display identity
 *  the frontend maps to the Wächter label (src/app/feedback/feedback.types.ts POSTHOG_GUARD_PROFILE_ID). */
export const POSTHOG_GUARD_PROFILE_ID = '00000000-0000-4000-8000-0000706f7374';
export const POSTHOG_GUARD_NAME = 'PostHog-Wächter';
export const MAX_MACHINE_ITEMS_PER_DAY = 3;
export const SAVER_FLAG_KEY = 'telemetry-saver';
export const POSTHOG_HOST = 'https://eu.posthog.com';
export const BILLING_URL = `${POSTHOG_HOST}/organization/billing`;
export const ROUTINE_LINE = 'Diagnose und Lösungsvorschlag folgen von der Routine.';

export type Level = 'ok' | 'warn' | 'error' | 'unknown';
export type Origin = 'human' | 'posthog' | 'service';
export type QuotaProduct = 'events' | 'exceptions' | 'replay' | 'llm' | 'flags';
export const QUOTA_PRODUCTS: QuotaProduct[] = ['events', 'exceptions', 'replay', 'llm', 'flags'];
export const SERVICES = ['claude', 'posthog', 'supabase', 'r2', 'uex', 'rsi', 'xai', 'readme'] as const;
export type ServiceName = (typeof SERVICES)[number];

// ---------------------------------------------------------------- auth

/** Constant-time string compare (no early exit on the first differing byte; length leak only). */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** 'ok' | 'unauthorized' | 'no_key' (secret not configured - the caller answers 200 skipped, never 500). */
export function checkSignalSecret(header: string | null, secret: string | undefined): 'ok' | 'unauthorized' | 'no_key' {
  if (!secret) return 'no_key';
  if (!header) return 'unauthorized';
  return constantTimeEqual(header, secret) ? 'ok' : 'unauthorized';
}

// ---------------------------------------------------------------- board cap / dedupe (H5)

export type BoardAction = 'append' | 'skip' | 'create' | 'overflow';

/** What to do with one machine finding.
 *  - same external_ref still open → append a system thread message (never a second item);
 *  - a once-per-period ref (quota) that already exists in any status → skip;
 *  - today's cap of new machine items reached → overflow (goes to the day's summary item);
 *  - otherwise create. */
export function decideBoardAction(i: { existingOpen: boolean; existingAnyStatus: boolean; oncePerPeriod: boolean; newToday: number; cap?: number }): BoardAction {
  if (i.existingOpen) return 'append';
  if (i.oncePerPeriod && i.existingAnyStatus) return 'skip';
  return i.newToday >= (i.cap ?? MAX_MACHINE_ITEMS_PER_DAY) ? 'overflow' : 'create';
}

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export const summaryRef = (day: string) => `summary:${day}`;
export const isSummaryRef = (ref: string | null | undefined) => !!ref && ref.startsWith('summary:');

/** German Markdown body of every machine item. */
export function buildItemBody(i: { title: string; problem: string; numbers?: string[]; link?: string }): string {
  const parts = [i.title.trim(), '', i.problem.trim()];
  if (i.numbers?.length) parts.push('', ...i.numbers.map((n) => `- ${n}`));
  if (i.link) parts.push('', `PostHog: ${i.link}`);
  parts.push('', ROUTINE_LINE);
  return parts.join('\n');
}

export function buildSummaryBody(day: string, lines: string[]): string {
  return [
    `Weitere Auffälligkeiten vom ${day}`,
    '',
    `Das Tageslimit von ${MAX_MACHINE_ITEMS_PER_DAY} neuen Wächter-Einträgen ist erreicht. Die übrigen Funde:`,
    '',
    ...lines.map((l) => `- ${l}`),
    '',
    ROUTINE_LINE,
  ].join('\n');
}

// ---------------------------------------------------------------- signals (H1 trends)

export interface DayValue { day: string; value: number }

/** LCP p75 of today vs the mean of the other days: +25 % or more → signal. */
export function lcpSignal(rows: DayValue[], today: string, threshold = 0.25): { today: number; mean: number; deltaPct: number } | null {
  const t = rows.find((r) => r.day === today)?.value;
  const rest = rows.filter((r) => r.day !== today && Number.isFinite(r.value));
  if (t == null || !Number.isFinite(t) || rest.length < 3) return null;
  const mean = rest.reduce((s, r) => s + r.value, 0) / rest.length;
  if (mean <= 0) return null;
  const deltaPct = ((t - mean) / mean) * 100;
  return deltaPct >= threshold * 100 ? { today: t, mean, deltaPct } : null;
}

/** Login funnel completion (success / start, in %) today vs the 7-day mean; a drop of more than 10 points → signal. */
export function funnelSignal(rows: { day: string; started: number; done: number }[], today: string, dropPoints = 10, minStarts = 10): { today: number; mean: number; dropPt: number } | null {
  const rate = (r: { started: number; done: number }) => (r.started > 0 ? (r.done / r.started) * 100 : NaN);
  const t = rows.find((r) => r.day === today);
  const rest = rows.filter((r) => r.day !== today && r.started >= minStarts);
  if (!t || t.started < minStarts || rest.length < 3) return null;
  const mean = rest.reduce((s, r) => s + rate(r), 0) / rest.length;
  const cur = rate(t);
  return mean - cur > dropPoints ? { today: cur, mean, dropPt: mean - cur } : null;
}

// ---------------------------------------------------------------- quota (E1/E4)

const BILLING_TYPE: Record<string, QuotaProduct> = {
  product_analytics: 'events',
  error_tracking: 'exceptions',
  session_replay: 'replay',
  llm_observability: 'llm',
  feature_flags: 'flags',
};

export interface QuotaRow { product: QuotaProduct; usage: number; limit: number; pct: number; forecastPct: number }

/** Tolerant reader of GET /api/billing/ - products[] with type, current_usage, free allocation / usage_limit. */
export function parseBilling(raw: unknown): { periodStart: string; periodEnd: string; rows: { product: QuotaProduct; usage: number; limit: number }[] } | null {
  const r = raw as { products?: unknown[]; billing_period?: Record<string, string> } | null;
  const bp = r?.billing_period;
  if (!r || !Array.isArray(r.products) || !bp?.current_period_start || !bp?.current_period_end) return null;
  const rows: { product: QuotaProduct; usage: number; limit: number }[] = [];
  for (const p of r.products as Record<string, unknown>[]) {
    const product = BILLING_TYPE[String(p.type ?? '')];
    if (!product) continue;
    const tiers = Array.isArray(p.tiers) ? (p.tiers as Record<string, unknown>[]) : [];
    const free = Number(p.free_allocation ?? tiers.find((t) => Number(t.flat_amount_usd ?? t.unit_amount_usd ?? 0) === 0)?.up_to ?? NaN);
    const cap = Number(p.usage_limit ?? NaN);
    const limit = Number.isFinite(cap) && cap > 0 ? cap : free;
    const usage = Number(p.current_usage ?? 0);
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(usage)) rows.push({ product, usage, limit });
  }
  return { periodStart: bp.current_period_start, periodEnd: bp.current_period_end, rows };
}

export function quotaStatus(i: { usage: number; limit: number; periodStart: string; periodEnd: string; now: Date }): { pct: number; forecastPct: number; level: Level; proposal: boolean; saver: boolean } {
  if (!(i.limit > 0)) return { pct: 0, forecastPct: 0, level: 'unknown', proposal: false, saver: false };
  const start = Date.parse(i.periodStart);
  const end = Date.parse(i.periodEnd);
  const pct = (i.usage / i.limit) * 100;
  const elapsed = i.now.getTime() - start;
  // Under one day of data a linear extrapolation is noise: the forecast is just today's share.
  const forecastPct = elapsed >= 86_400_000 && end > start ? (pct * (end - start)) / elapsed : pct;
  const level: Level = pct >= 100 ? 'error' : pct >= 80 || forecastPct > 100 ? 'warn' : 'ok';
  return { pct, forecastPct, level, proposal: pct >= 80 || forecastPct > 100, saver: forecastPct >= 95 };
}

/** telemetry-saver flag target: on at forecast >= 95 %, off only once every product dropped under 80 % (hysteresis;
 *  a new billing period resets usage, so it flips back by itself). null = leave as is. */
export function saverTarget(forecasts: number[], currentlyOn: boolean): boolean | null {
  const max = forecasts.length ? Math.max(...forecasts) : 0;
  if (max >= 95) return currentlyOn ? null : true;
  if (currentlyOn && max < 80) return false;
  return null;
}

export const quotaRef = (product: QuotaProduct, periodStart: string) => `quota:${product}:${periodStart.slice(0, 10)}`;

// ---------------------------------------------------------------- service health (I4/I5)

export interface HealthRow {
  service: string;
  level: Level;
  error_rate: number | null;
  last_ok_at: string | null;
  last_check_at: string | null;
  expected_every_sec: number;
  consecutive_failures: number;
  note: string | null;
}

/** d-thresh: ok = in rhythm and < 10 % errors; warn = 10-50 % or rhythm exceeded 2x; error = last 3 failed or key missing. */
export function serviceLevel(i: { keyMissing?: boolean; consecutiveFailures: number; errorRate: number | null; lastOkAt: string | null; lastCheckAt: string | null; expectedEverySec: number; now: Date }): Level {
  if (i.keyMissing) return 'error';
  if (i.consecutiveFailures >= 3) return 'error';
  if (!i.lastCheckAt) return 'unknown';
  const ageMs = (iso: string | null) => (iso ? i.now.getTime() - Date.parse(iso) : Infinity);
  const limit = 2 * i.expectedEverySec * 1000;
  if (ageMs(i.lastCheckAt) > limit) return 'warn';
  if (i.consecutiveFailures > 0 && ageMs(i.lastOkAt) > limit) return 'warn';
  if ((i.errorRate ?? 0) >= 0.1) return 'warn';
  return 'ok';
}

export interface ProbeResult { ok: boolean; keyMissing?: boolean; skipped?: boolean; note?: string; passiveErrorRate?: number | null }

/** Next stored row after one probe. error_rate is an exponential average over ~24 hourly probes (no probe history
 *  table); a passive rate (ai_calls) wins when higher. */
export function nextHealth(prev: HealthRow | null, p: ProbeResult, service: string, expectedEverySec: number, now: Date): HealthRow {
  const iso = now.toISOString();
  if (p.skipped) {
    return { service, level: 'unknown', error_rate: prev?.error_rate ?? null, last_ok_at: prev?.last_ok_at ?? null, last_check_at: iso, expected_every_sec: expectedEverySec, consecutive_failures: 0, note: p.note ?? 'nicht konfiguriert' };
  }
  const fail = p.ok ? 0 : 1;
  const ema = prev?.error_rate == null ? fail : (prev.error_rate * 23) / 24 + fail / 24;
  const errorRate = Math.max(ema, p.passiveErrorRate ?? 0);
  const consecutive = p.ok ? 0 : (prev?.consecutive_failures ?? 0) + 1;
  const lastOk = p.ok ? iso : prev?.last_ok_at ?? null;
  const level = serviceLevel({ keyMissing: p.keyMissing, consecutiveFailures: consecutive, errorRate, lastOkAt: lastOk, lastCheckAt: iso, expectedEverySec, now });
  return { service, level, error_rate: Math.round(errorRate * 1e4) / 1e4, last_ok_at: lastOk, last_check_at: iso, expected_every_sec: expectedEverySec, consecutive_failures: consecutive, note: p.ok ? null : p.note ?? 'Probe fehlgeschlagen' };
}

export type Transition = 'degraded' | 'recovered' | 'none';
export function serviceTransition(before: Level | null, after: Level): Transition {
  if (after === 'error' && before !== 'error') return 'degraded';
  if (before === 'error' && after !== 'error') return 'recovered';
  return 'none';
}

/** Recovery may close the item only while no human touched it. */
export function canAutoCloseServiceItem(i: { status: string; humanMessages: number }): boolean {
  return (i.status === 'open' || i.status === 'needs_input') && i.humanMessages === 0;
}

/** Postgres interval text ("01:00:00", "1 day", "3600 seconds", "1 day 02:00:00") → seconds. */
export function intervalToSec(v: unknown, fallback = 3600): number {
  if (typeof v !== 'string') return fallback;
  let s = 0;
  const day = /(\d+)\s*days?/.exec(v);
  if (day) s += Number(day[1]) * 86400;
  const sec = /(\d+)\s*seconds?/.exec(v);
  if (sec) s += Number(sec[1]);
  const hms = /(\d+):(\d\d):(\d\d)/.exec(v);
  if (hms) s += Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  return s > 0 ? s : fallback;
}

/** Row as stored in public.service_health (expected_every is an interval column). */
export function toDbHealth(r: HealthRow): Record<string, unknown> {
  const { expected_every_sec, ...rest } = r;
  return { ...rest, expected_every: `${expected_every_sec} seconds`, updated_at: new Date().toISOString() };
}
export function fromDbHealth(d: Record<string, unknown>): HealthRow {
  return {
    service: String(d.service), level: (d.level as Level) ?? 'unknown',
    error_rate: d.error_rate == null ? null : Number(d.error_rate),
    last_ok_at: (d.last_ok_at as string) ?? null, last_check_at: (d.last_check_at as string) ?? null,
    expected_every_sec: intervalToSec(d.expected_every), consecutive_failures: Number(d.consecutive_failures ?? 0),
    note: (d.note as string) ?? null,
  };
}
