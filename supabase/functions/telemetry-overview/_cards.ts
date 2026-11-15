// Pure card shaping for telemetry-overview (contract §5). No I/O - runs under node --test.
import { BILLING_URL, POSTHOG_HOST, ROUTINE_LINE, type HealthRow, type Level, type QuotaRow } from '../_shared/posthog-guard.ts';

export interface TopItem { label: string; value?: string; badge?: 'web' | 'server' | 'desktop'; level?: Level; url?: string; feedback?: { title: string; body: string } }
export interface Card {
  id: 'quota' | 'errors' | 'services' | 'usage' | 'ai' | 'desktop';
  level: Level;
  kpi: { value: number | null; display: string; unitKey: string };
  delta?: { value: number; unit: 'pct' | 'abs' | 'pt'; better: 'up' | 'down' };
  forecast?: { display: string; pct?: number };
  spark?: number[];
  bar?: { pct: number; monthPct: number };
  top: TopItem[];
  links: { labelKey: string; url: string }[];
  feedbackCta?: { title: string; body: string };
  upgradeUrl?: string;
  boardWaiting?: number;
  calmKey?: string;
}

const ORDER: Record<Level, number> = { error: 0, warn: 1, ok: 2, unknown: 3 };
/** error → warn → ok → unknown; stable inside a level (the design's fixed card order). */
export function sortCards(cards: Card[]): Card[] {
  return cards.map((c, i) => ({ c, i })).sort((a, b) => ORDER[a.c.level] - ORDER[b.c.level] || a.i - b.i).map((x) => x.c);
}
export const attentionCount = (cards: Card[]) => cards.filter((c) => c.level === 'warn' || c.level === 'error').length;

const worst = (levels: Level[]): Level => levels.reduce<Level>((w, l) => (ORDER[l] < ORDER[w] ? l : w), 'unknown');
const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(n));
const pctText = (n: number) => `${Math.round(n)} %`;

/** Prefilled „In Feedback umwandeln“ text (r2-convert): title + Markdown body with the PostHog link. */
export function feedbackPrefill(title: string, problem: string, link?: string): { title: string; body: string } {
  return { title, body: [title, '', problem, ...(link ? ['', `PostHog: ${link}`] : []), '', ROUTINE_LINE].join('\n') };
}

const PRODUCT_LABEL: Record<QuotaRow['product'], string> = { events: 'Ereignisse', exceptions: 'Fehler (Exceptions)', replay: 'Session-Replay', llm: 'KI-Ereignisse', flags: 'Feature-Flag-Abfragen' };

export function quotaLevel(q: Pick<QuotaRow, 'pct' | 'forecastPct'>): Level {
  return q.pct >= 100 ? 'error' : q.pct >= 80 || q.forecastPct > 100 ? 'warn' : 'ok';
}

export function quotaCard(quotas: QuotaRow[], reachable: boolean, now: Date): Card {
  const links = [{ labelKey: 'billing', url: BILLING_URL }];
  if (!reachable || !quotas.length) {
    return { id: 'quota', level: 'unknown', kpi: { value: null, display: '–', unitKey: 'quotaPct' }, top: [], links, upgradeUrl: BILLING_URL };
  }
  const sorted = [...quotas].sort((a, b) => Math.max(b.pct, b.forecastPct) - Math.max(a.pct, a.forecastPct));
  const lead = sorted[0];
  const level = worst(quotas.map(quotaLevel));
  const month = now.getUTCDate() / new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const top: TopItem[] = sorted.slice(0, 3).map((q) => {
    const lv = quotaLevel(q);
    return {
      label: PRODUCT_LABEL[q.product], value: `${pctText(q.pct)} · Prognose ${pctText(q.forecastPct)}`, level: lv, url: BILLING_URL,
      feedback: lv === 'ok' ? undefined : feedbackPrefill(`PostHog-Kontingent: ${PRODUCT_LABEL[q.product]} sparen`, `${PRODUCT_LABEL[q.product]} liegt bei ${pctText(q.pct)} des Freikontingents (Prognose zum Periodenende ${pctText(q.forecastPct)}). Bitte einen Sparvorschlag ausarbeiten (weniger senden statt mehr Kontingent kaufen).`, BILLING_URL),
    };
  });
  const card: Card = {
    id: 'quota', level, kpi: { value: Math.round(lead.pct), display: pctText(lead.pct), unitKey: 'quotaPct' },
    forecast: { display: pctText(lead.forecastPct), pct: Math.round(lead.forecastPct) },
    bar: { pct: Math.min(100, Math.round(lead.pct)), monthPct: Math.round(month * 100) },
    top, links, upgradeUrl: BILLING_URL, calmKey: 'quotaCalm',
  };
  if (level !== 'ok') {
    card.feedbackCta = feedbackPrefill(
      `PostHog-Kontingent: ${PRODUCT_LABEL[lead.product]} sparen`,
      `${PRODUCT_LABEL[lead.product]} liegt bei ${pctText(lead.pct)} des Freikontingents (Prognose ${pctText(lead.forecastPct)}). Bitte einen Sparvorschlag ausarbeiten.`,
      BILLING_URL,
    );
  }
  return card;
}

export interface NewIssue { id: string; name: string; count: number; source: 'web' | 'server' | 'desktop' }
export function errorsCard(issues: NewIssue[], reachable: boolean, boardWaiting: number, projectUrl: string): Card {
  const links = [{ labelKey: 'errorTracking', url: `${projectUrl}/error_tracking` }];
  if (!reachable) return { id: 'errors', level: 'unknown', kpi: { value: null, display: '–', unitKey: 'newErrors' }, top: [], links, boardWaiting };
  const level: Level = issues.length >= 3 || boardWaiting >= 3 ? 'error' : issues.length > 0 || boardWaiting > 0 ? 'warn' : 'ok';
  return {
    id: 'errors', level, kpi: { value: issues.length, display: String(issues.length), unitKey: 'newErrors' },
    top: issues.slice(0, 3).map((i) => {
      const url = `${projectUrl}/error_tracking/${i.id}`;
      return { label: i.name, value: `${i.count}×`, badge: i.source, level: 'warn' as Level, url, feedback: feedbackPrefill(`Fehler: ${i.name}`, `Neuer Fehler (${i.source}) mit ${i.count} Vorkommen seit dem letzten Besuch.`, url) };
    }),
    links, boardWaiting, calmKey: 'errorsCalm',
  };
}

export function servicesCard(rows: HealthRow[], projectUrl: string): Card {
  const links = [{ labelKey: 'serviceHealth', url: `${projectUrl}/error_tracking` }];
  if (!rows.length) return { id: 'services', level: 'unknown', kpi: { value: null, display: '–', unitKey: 'servicesDown' }, top: [], links };
  const bad = rows.filter((r) => r.level === 'warn' || r.level === 'error').sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return {
    id: 'services', level: worst(rows.map((r) => r.level).filter((l) => l !== 'unknown')),
    kpi: { value: bad.length, display: `${bad.length}/${rows.length}`, unitKey: 'servicesDown' },
    top: bad.slice(0, 3).map((r) => ({
      label: r.service, value: r.note ?? (r.level === 'error' ? 'nicht erreichbar' : 'auffällig'), level: r.level, badge: 'server' as const,
      feedback: feedbackPrefill(`Dienst ${r.service}: ${r.level === 'error' ? 'ausgefallen' : 'auffällig'}`, `Der Dienst ${r.service} meldet ${r.level} (${r.note ?? 'ohne Details'}), ${r.consecutive_failures} Fehlversuche in Folge.`),
    })),
    links, calmKey: 'servicesCalm',
  };
}

export interface Mover { label: string; cur: number; prev: number }
export function usageCard(daily: number[], movers: Mover[], reachable: boolean, projectUrl: string): Card {
  const links = [{ labelKey: 'webAnalytics', url: `${projectUrl}/web` }, { labelKey: 'dashboards', url: `${projectUrl}/dashboard` }];
  if (!reachable || daily.length < 2) return { id: 'usage', level: 'unknown', kpi: { value: null, display: '–', unitKey: 'activeUsers' }, top: [], links };
  const spark = daily.slice(-7);
  const today = spark[spark.length - 1];
  const prevMean = spark.slice(0, -1).reduce((s, v) => s + v, 0) / Math.max(1, spark.length - 1);
  const deltaPct = prevMean > 0 ? ((today - prevMean) / prevMean) * 100 : 0;
  return {
    id: 'usage', level: deltaPct <= -30 ? 'warn' : 'ok', kpi: { value: today, display: fmt(today), unitKey: 'activeUsers' },
    delta: { value: Math.round(deltaPct), unit: 'pct', better: 'up' }, spark,
    top: movers.slice(0, 3).map((m) => ({ label: m.label, value: `${m.cur >= m.prev ? '+' : ''}${fmt(m.cur - m.prev)}`, badge: 'web' as const })),
    links, calmKey: 'usageCalm',
  };
}

export function aiCard(i: { monthCostUsd: number; day: number; daysInMonth: number; errorRate24h: number | null; top: { fn: string; cost: number }[]; reachable: boolean }, projectUrl: string): Card {
  const links = [{ labelKey: 'llmObservability', url: `${projectUrl}/llm-observability` }];
  if (!i.reachable) return { id: 'ai', level: 'unknown', kpi: { value: null, display: '–', unitKey: 'aiCostUsd' }, top: [], links };
  const forecast = (i.monthCostUsd / Math.max(1, i.day)) * i.daysInMonth;
  return {
    id: 'ai', level: (i.errorRate24h ?? 0) >= 0.1 ? 'warn' : 'ok',
    kpi: { value: Math.round(i.monthCostUsd * 100) / 100, display: `$${i.monthCostUsd.toFixed(2)}`, unitKey: 'aiCostUsd' },
    forecast: { display: `$${forecast.toFixed(2)}` },
    top: i.top.slice(0, 3).map((t) => ({ label: t.fn, value: `$${t.cost.toFixed(2)}`, badge: 'server' as const })),
    links, calmKey: 'aiCalm',
  };
}

/** A desktop job-diagnostics report: `logLink` is a presigned 24 h URL of the stored r2:// log (null when R2 is not configured). */
export interface DiagItem { product: string; version: string; message: string; logLink: string | null }

/** `r2://<bucket>/<key>` → `<key>` (null for anything else). */
export function diagKeyOf(ref: string): string | null {
  const m = /^r2:\/\/[^/]+\/(.+)$/.exec(ref);
  return m ? m[1] : null;
}

export function desktopCard(rows: { product: string; version: string; installs: number }[], reachable: boolean, projectUrl: string, diag: DiagItem[] = []): Card {
  const links = [{ labelKey: 'desktopEvents', url: `${projectUrl}/activity/explore` }];
  if (!reachable) return { id: 'desktop', level: 'unknown', kpi: { value: null, display: '–', unitKey: 'desktopInstalls' }, top: [], links };
  const total = rows.reduce((s, r) => s + r.installs, 0);
  return {
    id: 'desktop', level: 'ok', kpi: { value: total, display: fmt(total), unitKey: 'desktopInstalls' },
    top: [
      // newest job-diagnostics reports first; the presigned log link rides in the feedback body
      ...diag.slice(0, 3).map((d) => ({
        label: `${d.product} ${d.version}: ${d.message}`, value: 'Log', badge: 'desktop' as const, level: 'warn' as Level,
        feedback: feedbackPrefill(`Desktop-Diagnose: ${d.message}`, `Job-Diagnose der Desktop-App ${d.product} ${d.version}.${d.logLink ? ` Log (24 h gültig): ${d.logLink}` : ''}`, `${projectUrl}/activity/explore`),
      })),
      ...rows.map((r) => ({ label: `${r.product} ${r.version}`, value: fmt(r.installs), badge: 'desktop' as const })),
    ].slice(0, 3),
    links, calmKey: diag.length ? undefined : 'desktopCalm',
  };
}

export const projectUrl = (id: string | number | null) => (id ? `${POSTHOG_HOST}/project/${id}` : POSTHOG_HOST);
