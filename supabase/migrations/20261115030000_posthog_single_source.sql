-- ============================================================
-- 20261115030000_posthog_single_source.sql
-- PostHog becomes the single telemetry source (concept 20261115-0211-posthog-audit,
-- decisions r2-old = now, r2-desktop = fwd, d-usage = ledger).
--
-- 1. CREATES public.ai_calls — the per-call ledger of every LLM call
--    (Claude, plus the OpenAI/xAI fallback of sc-events-sync). Written by the
--    Edge Functions through _shared/ai-ledger.ts `recordAiCall` (service role);
--    read by the admin overview function (service role). Metadata only: never
--    prompt or output text.
--
-- 2. DROPS the own desktop telemetry store — ALPHA-PHASE DATA POLICY (CLAUDE.md:
--    schema rewrites may drop legacy tables; this is the drop decided in concept
--    20261115-0211-posthog-audit, round 2 `r2-old = now`):
--      * public.telemetry_events            (crash + usage rows, 120-day retention)
--      * public.get_telemetry_stats(int, text) (the admin RPC; the older (int)
--        overload was already dropped in 20260706120000)
--      * cron job 'telemetry-events-retention' (its only purpose was that table)
--    ingest-telemetry now keeps HMAC + validation + rate limit and forwards to
--    PostHog (captureBatch); crash rows become `$exception`, diagnostic logs go
--    to R2 under diag/<yyyy-mm-dd>/ and are referenced from the event.
--    The history in telemetry_events is NOT migrated (alpha data). auth.users and
--    profiles are untouched.
--
-- ROLLBACK (data is gone, only the shape): re-run 20260618120000_telemetry.sql
-- and the later telemetry migrations in order.
-- ============================================================

-- ---------- 1. ai_calls ----------
create table if not exists public.ai_calls (
  id                 bigserial primary key,
  at                 timestamptz not null default now(),
  function           text not null,
  model              text not null,
  provider           text not null default 'anthropic',
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  cache_write_tokens int,
  cost_usd           numeric(12,6),
  latency_ms         int,
  ok                 boolean not null,
  status             int,
  error              text,
  probe              boolean not null default false
);

create index if not exists ai_calls_at_idx on public.ai_calls (at desc);
create index if not exists ai_calls_function_at_idx on public.ai_calls (function, at desc);

alter table public.ai_calls enable row level security;
-- Intentionally NO policies: the service role (Edge Functions) writes, the admin
-- overview function reads with the service role. anon/authenticated see nothing.
revoke all on public.ai_calls from anon, authenticated;

comment on table public.ai_calls is
  'One row per LLM call (function, model, provider, tokens, cost, latency, ok/error). Metadata only, never prompt or output text. Written by _shared/ai-ledger.ts, read by telemetry-overview. Retained 400 days.';

-- Keep the ledger bounded (cost history is wanted for the month-over-month view, not forever).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ai-calls-retention') then
    perform cron.unschedule('ai-calls-retention');
  end if;
end $$;

select cron.schedule(
  'ai-calls-retention',
  '35 4 * * *',
  $job$ delete from public.ai_calls where at < now() - interval '400 days'; $job$
);

-- ---------- 2. drop the own telemetry store ----------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'telemetry-events-retention') then
    perform cron.unschedule('telemetry-events-retention');
  end if;
end $$;

drop function if exists public.get_telemetry_stats(int, text);
drop function if exists public.get_telemetry_stats(int);
drop table if exists public.telemetry_events;

notify pgrst, 'reload schema';
