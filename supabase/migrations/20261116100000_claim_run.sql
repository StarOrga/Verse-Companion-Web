-- claim_run(name, min_interval): the atomic run claim for the verify_jwt=false cron endpoints (audit 2026-11-16).
--
-- The edge functions sc-events-sync, sc-event-sheet, patch-teaser and translate-orchestrator (sync_sources) are public
-- (pg_cron has only the publishable key) and spend money or upstream quota per run. Their throttle used to read first and
-- write later, so N parallel anonymous POSTs all passed. claim_run() is ONE statement on the existing guard_runs row:
-- the first caller inserts or advances last_run_at and gets true; a concurrent caller blocks on the row lock, re-checks
-- the WHERE against the committed row and gets false. A claim expires by time alone (min_interval), so a crashed run
-- never blocks longer than that interval. Additive: reuses guard_runs (20261115030100), no data change.
--
-- ROLLBACK: drop function public.claim_run(text, interval);

create or replace function public.claim_run(p_name text, p_min_interval interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  if p_name is null or length(p_name) = 0 or length(p_name) > 200 then
    raise exception 'claim_run: bad name' using errcode = '22023';
  end if;
  if p_min_interval is null or p_min_interval <= interval '0' then
    raise exception 'claim_run: bad interval' using errcode = '22023';
  end if;

  insert into public.guard_runs as g (mode, last_run_at)
  values (p_name, clock_timestamp())
  on conflict (mode) do update
    set last_run_at = excluded.last_run_at
    where g.last_run_at <= excluded.last_run_at - p_min_interval
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

comment on function public.claim_run(text, interval) is
  'Atomic run claim: true when no claim of this name is younger than min_interval (and records the new one), else false. service_role only.';

revoke all on function public.claim_run(text, interval) from public, anon, authenticated;
grant execute on function public.claim_run(text, interval) to service_role;

notify pgrst, 'reload schema';
