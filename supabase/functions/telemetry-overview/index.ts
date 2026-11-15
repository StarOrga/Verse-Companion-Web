// telemetry-overview - the admin telemetry page's single read (contract §5, docs/concepts/20261115-0211-posthog-audit).
//
//   GET                       → Overview { generatedAt, lastVisitAt, posthogReachable, attention, cards[], quotas[] }
//   POST { "seen": true }     → stores the admin's last visit (admin_telemetry_seen) and drops their cached overview
//
// Auth: the admin's session JWT (verify_jwt stays on); the function additionally requires public.is_admin() for that user
// (403 otherwise). Data: PostHog billing API (quota) + HogQL query API (errors / usage / desktop), ai_calls (AI cost),
// service_health (services), admin_feedback (machine items waiting). Without POSTHOG_PERSONAL_API_KEY every PostHog-backed
// card is level 'unknown' and posthogReachable=false - services + AI cost still render.
// Cache: in-memory per isolate, 5 min per admin (no table: a cold isolate only costs a few extra PostHog calls; the
// "seen" POST invalidates that admin's entry). Cards are sorted error → warn → ok → unknown.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { Db } from '../_shared/guard-board.ts';
import { diagR2, presignDiagLog } from '../_shared/diag-log.ts';
import { billing, hogql, personalKey, projectId } from '../_shared/posthog-api.ts';
import { captureServerException, withPosthog } from '../_shared/posthog.ts';
import { fromDbHealth, parseBilling, quotaStatus, type QuotaRow } from '../_shared/posthog-guard.ts';
import { aiCard, attentionCount, desktopCard, queryReachable, diagKeyOf, errorsCard, projectUrl, quotaCard, servicesCard, sortCards, usageCard, type Card, type DiagItem, type Mover, type NewIssue } from './_cards.ts';

const FN = 'telemetry-overview';
const CACHE_MS = 5 * 60_000;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });
const cache = new Map<string, { at: number; data: unknown }>();

const hogTs = (iso: string) => iso.slice(0, 19).replace('T', ' ');

async function build(db: Db, userId: string): Promise<unknown> {
  const now = new Date();
  const seen = await db.from('admin_telemetry_seen').select('seen_at').eq('user_id', userId).maybeSingle();
  const lastVisitAt: string | null = seen.data?.seen_at ?? null;
  const since = hogTs(lastVisitAt ?? new Date(now.getTime() - 7 * 86400_000).toISOString());
  const hasKey = !!personalKey();

  const pid = hasKey ? await projectId() : null;
  const base = projectUrl(pid);

  const [bill, errs, daily, movers, desk, diagRows] = hasKey
    ? await Promise.all([
        billing(),
        hogql(`select toString(properties.$exception_issue_id) i, any(toString(properties.$exception_types)) t, count() c, any(toString(properties.source)) s, any(toString(properties.$lib)) l, min(timestamp) f
          from events where event = '$exception' and properties.$exception_issue_id is not null and timestamp >= now() - interval 30 day
          group by i having f > toDateTime('${since}') order by c desc limit 50`, 'overview-errors'),
        hogql(`select toString(toDate(timestamp)) d, count(distinct person_id) from events where event = '$pageview' and timestamp >= now() - interval 7 day group by d order by d`, 'overview-usage'),
        hogql(`select toString(properties.$pathname) p, countIf(timestamp >= now() - interval 7 day) cur, countIf(timestamp < now() - interval 7 day) prev
          from events where event = '$pageview' and timestamp >= now() - interval 14 day group by p order by abs(cur - prev) desc limit 3`, 'overview-movers'),
        hogql(`select toString(properties.product) p, toString(properties.app_version) v, count(distinct distinct_id) n from events
          where properties.source = 'desktop' and timestamp >= now() - interval 7 day group by p, v order by n desc limit 20`, 'overview-desktop'),
        hogql(`select toString(properties.product) p, toString(properties.app_version) v, toString(properties.message) m, toString(properties.log_url) u from events
          where event = 'desktop:job_diagnostics_report' and properties.log_url is not null and timestamp >= now() - interval 7 day order by timestamp desc limit 3`, 'overview-desktop-diag'),
      ])
    : [null, null, null, null, null, null];

  // quota
  const parsed = parseBilling(bill);
  const quotas: QuotaRow[] = parsed
    ? parsed.rows.map((r) => {
        const st = quotaStatus({ usage: r.usage, limit: r.limit, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, now });
        return { product: r.product, usage: r.usage, limit: r.limit, pct: Math.round(st.pct * 10) / 10, forecastPct: Math.round(st.forecastPct * 10) / 10 };
      })
    : [];
  const posthogReachable = hasKey && (parsed != null || errs != null || daily != null);

  // errors
  const issues: NewIssue[] = (errs ?? []).map((r) => ({
    id: String(r[0]), name: String(r[1] || 'Fehler'), count: Number(r[2]),
    source: r[3] === 'server' ? 'server' : r[3] === 'desktop' ? 'desktop' : 'web',
  }));
  const waiting = await db.from('admin_feedback').select('id', { count: 'exact', head: true }).neq('origin', 'human').in('status', ['open', 'needs_input']);

  // services
  const sh = await db.from('service_health').select('*');
  const health = ((sh.data ?? []) as Record<string, unknown>[]).map(fromDbHealth);

  // AI cost (ai_calls may not exist before the ledger migration: then the card is unknown)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const ai = await db.from('ai_calls').select('function, cost_usd, ok, at').gte('at', monthStart).limit(20000);
  let aiC: Card;
  if (ai.error) {
    aiC = aiCard({ monthCostUsd: 0, day: 1, daysInMonth: 30, errorRate24h: null, top: [], reachable: false }, base);
  } else {
    const rows = (ai.data ?? []) as { function: string; cost_usd: number | null; ok: boolean; at: string }[];
    const byFn = new Map<string, number>();
    let total = 0;
    for (const r of rows) { const c = Number(r.cost_usd ?? 0); total += c; byFn.set(r.function, (byFn.get(r.function) ?? 0) + c); }
    const day = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const last = rows.filter((r) => r.at >= day);
    aiC = aiCard({
      monthCostUsd: total, day: now.getUTCDate(), daysInMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate(),
      errorRate24h: last.length >= 5 ? last.filter((r) => !r.ok).length / last.length : null,
      top: [...byFn.entries()].map(([fn, cost]) => ({ fn, cost })).sort((a, b) => b.cost - a.cost), reachable: true,
    }, base);
  }

  const dailyCounts = (daily ?? []).map((r) => Number(r[1]));
  const mv: Mover[] = (movers ?? []).map((r) => ({ label: String(r[0]), cur: Number(r[1]), prev: Number(r[2]) }));
  const deskRows = (desk ?? []).map((r) => ({ product: String(r[0]), version: String(r[1]), installs: Number(r[2]) }));

  // D2: diagnostic logs live in R2 as r2:// refs — hand the admin a presigned 24 h link inside the feedback body
  const r2 = diagR2();
  const diag: DiagItem[] = [];
  for (const r of diagRows ?? []) {
    const key = diagKeyOf(String(r[3]));
    let logLink: string | null = null;
    if (r2 && key) {
      try { logLink = await presignDiagLog(r2, key, 24 * 3600); } catch { logLink = null; }
    }
    diag.push({ product: String(r[0]), version: String(r[1]), message: String(r[2] || 'Diagnose'), logLink });
  }

  const cards = sortCards([
    quotaCard(quotas, posthogReachable, now),
    errorsCard(issues, queryReachable(posthogReachable, errs), waiting.count ?? 0, base),
    servicesCard(health, base),
    usageCard(dailyCounts, mv, queryReachable(posthogReachable, daily), base),
    aiC,
    desktopCard(deskRows, queryReachable(posthogReachable, desk), base, diag),
  ]);
  return { generatedAt: now.toISOString(), lastVisitAt, posthogReachable, attention: attentionCount(cards), cards, quotas };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authz = req.headers.get('authorization');
  if (!url || !anon || !service || !authz) return json({ error: 'unauthorized' }, 401);

  const asUser = createClient(url, anon, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return json({ error: 'unauthorized' }, 401);
  const isAdmin = await asUser.rpc('is_admin');
  if (isAdmin.error || isAdmin.data !== true) return json({ error: 'forbidden' }, 403);

  const db = createClient(url, service, { auth: { persistSession: false } });
  try {
    if (req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { seen?: boolean } | null;
      if (body?.seen !== true) return json({ error: 'bad_request' }, 400);
      const at = new Date().toISOString();
      await db.from('admin_telemetry_seen').upsert({ user_id: u.user.id, seen_at: at });
      cache.delete(u.user.id);
      return json({ ok: true, seenAt: at });
    }
    const hit = cache.get(u.user.id);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.data);
    const data = await build(db, u.user.id);
    cache.set(u.user.id, { at: Date.now(), data });
    return json(data);
  } catch (e) {
    await captureServerException(FN, e);
    console.warn(`[${FN}] ${(e as Error).message}`);
    return json({ error: 'internal' }, 500);
  }
};

Deno.serve(withPosthog(FN, handler));
