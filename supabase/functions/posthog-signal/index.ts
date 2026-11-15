// posthog-signal - turns PostHog findings into admin-board items (H1/H3/H5/H6, E1/E4 server part).
//
//   POST (header x-signal-secret = POSTHOG_SIGNAL_SECRET)       webhook: PostHog error-tracking alert (issue created / reopened)
//   POST {"mode":"trends"}  pg_cron daily 06:30 UTC             HogQL: LCP p75 vs 7-day mean (+25 %), login funnel (-10 pt), new error groups
//   POST {"mode":"quota"}   pg_cron every 6 h                   PostHog billing API: >= 80 % / forecast > 100 % → one item per product and
//                                                               period; forecast >= 95 % → feature flag telemetry-saver on (off again later)
//
// verify_jwt=false (supabase/config.toml, like ingest-catalog): pg_cron only has the publishable key. The webhook is
// authenticated by the shared secret (constant-time compare, 401 otherwise); the cron modes only read PostHog and write
// capped board items, and are throttled through guard_runs (the secret header bypasses the throttle for manual runs).
// Missing POSTHOG_PERSONAL_API_KEY / POSTHOG_SIGNAL_SECRET → 200 {skipped:'no_key'} + a warning, never a 500.
// Secrets: POSTHOG_PERSONAL_API_KEY (read scopes + billing:read + feature_flag:write), POSTHOG_SIGNAL_SECRET,
// optional POSTHOG_PROJECT_ID, optional POSTHOG_LOGIN_SUCCESS_SQL (HogQL predicate for the login-success event).
// Board writes use the service role (SUPABASE_SERVICE_ROLE_KEY), no user token.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fileFinding, throttled, type Db } from '../_shared/guard-board.ts';
import { billing, hogql, personalKey, projectId, setSaverFlag, getSaverFlag } from '../_shared/posthog-api.ts';
import { captureServerException, withPosthog } from '../_shared/posthog.ts';
import {
  BILLING_URL, POSTHOG_HOST, buildItemBody, checkSignalSecret, funnelSignal, lcpSignal, parseBilling, quotaRef, quotaStatus,
  saverTarget, utcDay, type QuotaProduct,
} from '../_shared/posthog-guard.ts';
import { parseSignal } from './_webhook.ts';

const FN = 'posthog-signal';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LOGIN_OK = Deno.env.get('POSTHOG_LOGIN_SUCCESS_SQL') ?? "(event like 'user_signed_in%' or event = 'auth:user_sign_in')";

const PRODUCT_NAME: Record<QuotaProduct, string> = { events: 'Ereignisse', exceptions: 'Fehler (Exceptions)', replay: 'Session-Replay', llm: 'KI-Ereignisse', flags: 'Feature-Flag-Abfragen' };

const link = async (path: string) => {
  const id = await projectId();
  return id ? `${POSTHOG_HOST}/project/${id}${path}` : `${POSTHOG_HOST}${path}`;
};

async function webhook(db: Db, req: Request): Promise<Response> {
  const sig = parseSignal(await req.json().catch(() => null));
  if (!sig) return json({ ok: false, error: 'bad_payload' }, 400);
  const url = sig.url ?? (await link(`/error_tracking/${sig.issueId}`));
  const verb = sig.kind === 'reopened' ? 'wieder aufgetreten' : 'neu aufgetreten';
  const body = buildItemBody({ title: `Fehler ${verb}: ${sig.title}`, problem: `PostHog meldet einen Fehler (${verb}): ${sig.title}.`, numbers: [`Issue: ${sig.issueId}`], link: url });
  const r = await fileFinding(db, { origin: 'posthog', ref: `posthog:${sig.issueId}`, body, line: `${sig.title} (${verb}) ${url}` });
  return json({ ok: true, ...r });
}

async function trends(db: Db): Promise<Response> {
  const today = utcDay(new Date());
  const out: Record<string, unknown> = {};

  const lcp = await hogql(`select toString(toDate(timestamp)) d, quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)) v from events
    where event = '$web_vitals' and properties.$web_vitals_LCP_value is not null and timestamp >= now() - interval 8 day group by d order by d`, 'guard-lcp');
  const lcpS = lcp ? lcpSignal(lcp.map((r) => ({ day: String(r[0]), value: Number(r[1]) })), today) : null;
  out.lcp = lcp == null ? 'unreachable' : lcpS ? 'signal' : 'ok';
  if (lcpS) {
    const url = await link('/web-analytics/web-vitals');
    await fileFinding(db, {
      origin: 'posthog', ref: 'trend:lcp',
      body: buildItemBody({ title: 'Ladezeit (LCP) hat sich verschlechtert', problem: 'Der LCP (p75) liegt heute deutlich über dem Mittel der letzten sieben Tage.', numbers: [`heute: ${Math.round(lcpS.today)} ms`, `Mittel 7 Tage: ${Math.round(lcpS.mean)} ms`, `Abweichung: +${Math.round(lcpS.deltaPct)} %`], link: url }),
      line: `LCP p75 ${Math.round(lcpS.today)} ms (+${Math.round(lcpS.deltaPct)} %) ${url}`,
    });
  }

  const fun = await hogql(`select toString(toDate(timestamp)) d,
      uniqIf(person_id, event = '$pageview' and properties.$pathname = '/login') s,
      uniqIf(person_id, ${LOGIN_OK}) k
    from events where timestamp >= now() - interval 8 day group by d order by d`, 'guard-login-funnel');
  const funS = fun ? funnelSignal(fun.map((r) => ({ day: String(r[0]), started: Number(r[1]), done: Number(r[2]) })), today) : null;
  out.loginFunnel = fun == null ? 'unreachable' : funS ? 'signal' : 'ok';
  if (funS) {
    const url = await link('/insights');
    await fileFinding(db, {
      origin: 'posthog', ref: 'trend:login-funnel',
      body: buildItemBody({ title: 'Anmeldung schließt seltener ab', problem: 'Der Anteil der Login-Besuche mit erfolgreicher Anmeldung ist heute klar unter dem Wochenmittel.', numbers: [`heute: ${funS.today.toFixed(0)} %`, `Mittel 7 Tage: ${funS.mean.toFixed(0)} %`, `Rückgang: ${funS.dropPt.toFixed(0)} Punkte`], link: url }),
      line: `Login-Abschluss ${funS.today.toFixed(0)} % statt ${funS.mean.toFixed(0)} % ${url}`,
    });
  }

  const errs = await hogql(`select toString(properties.$exception_issue_id) i, any(toString(properties.$exception_types)) t, any(toString(properties.$exception_values)) m, count() c, min(timestamp) f
    from events where event = '$exception' and properties.$exception_issue_id is not null and timestamp >= now() - interval 30 day
    group by i having f >= now() - interval 1 day order by c desc limit 3`, 'guard-new-errors');
  out.newErrors = errs?.length ?? 'unreachable';
  for (const r of errs ?? []) {
    const id = String(r[0]);
    const title = [r[1], r[2]].filter(Boolean).join(': ').slice(0, 140) || 'Unbekannter Fehler';
    const url = await link(`/error_tracking/${id}`);
    await fileFinding(db, {
      origin: 'posthog', ref: `posthog:${id}`,
      body: buildItemBody({ title: `Neue Fehlergruppe: ${title}`, problem: 'In den letzten 24 Stunden ist eine neue Fehlergruppe aufgetaucht.', numbers: [`Vorkommen: ${r[3]}`], link: url }),
      line: `${title} (${r[3]}×) ${url}`,
    });
  }
  return json({ ok: true, ...out });
}

async function quota(db: Db): Promise<Response> {
  const now = new Date();
  const parsed = parseBilling(await billing());
  if (!parsed) return json({ ok: false, error: 'billing_unavailable' });
  const forecasts: number[] = [];
  const filed: Record<string, string> = {};
  for (const row of parsed.rows) {
    const st = quotaStatus({ usage: row.usage, limit: row.limit, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, now });
    forecasts.push(st.forecastPct);
    if (!st.proposal) continue;
    const name = PRODUCT_NAME[row.product];
    const f = await fileFinding(db, {
      origin: 'posthog', ref: quotaRef(row.product, parsed.periodStart), oncePerPeriod: true,
      body: buildItemBody({
        title: `PostHog-Kontingent: ${name} bei ${Math.round(st.pct)} %`,
        problem: `${name} verbraucht das Freikontingent in dieser Abrechnungsperiode schneller als geplant. Gesucht ist ein Sparvorschlag (weniger senden) als Alternative zu einem bezahlten Plan.`,
        numbers: [`verbraucht: ${row.usage.toLocaleString('de-DE')} von ${row.limit.toLocaleString('de-DE')} (${Math.round(st.pct)} %)`, `Prognose Periodenende: ${Math.round(st.forecastPct)} %`, `Periode ab ${parsed.periodStart.slice(0, 10)}`],
        link: BILLING_URL,
      }),
      line: `${name}: ${Math.round(st.pct)} % verbraucht, Prognose ${Math.round(st.forecastPct)} %`,
    });
    filed[row.product] = f.action;
  }
  // E4 server part: telemetry-saver flag, only the lowest-value telemetry (replay, heatmaps) reads it.
  const flag = await getSaverFlag();
  const target = saverTarget(forecasts, !!flag?.active);
  const saver = target == null ? 'unchanged' : await setSaverFlag(target);
  return json({ ok: true, period: parsed.periodStart, filed, saver, saverTarget: target });
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const secret = Deno.env.get('POSTHOG_SIGNAL_SECRET');
  const auth = checkSignalSecret(req.headers.get('x-signal-secret'), secret);
  const cloned = req.clone();
  const mode = (await cloned.json().catch(() => ({})) as { mode?: string }).mode;

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) { console.warn(`[${FN}] service role not configured`); return json({ ok: true, skipped: 'no_key' }); }
  const db = createClient(url, key, { auth: { persistSession: false } });

  try {
    if (mode === 'trends' || mode === 'quota') {
      if (!personalKey()) { console.warn(`[${FN}] POSTHOG_PERSONAL_API_KEY missing - ${mode} skipped`); return json({ ok: true, skipped: 'no_key' }); }
      if (auth !== 'ok' && (await throttled(db, mode, mode === 'trends' ? 20 * 3600_000 : 5 * 3600_000))) return json({ ok: true, skipped: 'throttled' });
      return mode === 'trends' ? await trends(db) : await quota(db);
    }
    if (auth === 'no_key') { console.warn(`[${FN}] POSTHOG_SIGNAL_SECRET missing - webhook skipped`); return json({ ok: true, skipped: 'no_key' }); }
    if (auth !== 'ok') return json({ ok: false, error: 'unauthorized' }, 401);
    return await webhook(db, req);
  } catch (e) {
    await captureServerException(FN, e);
    console.warn(`[${FN}] ${(e as Error).message}`);
    return json({ ok: false, error: 'internal' }, 200);
  }
};

Deno.serve(withPosthog(FN, handler, { cron: true }));
