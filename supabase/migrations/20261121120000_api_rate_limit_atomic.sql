-- Atomic count-and-record for the public API rate limiter (audit 2026-11-21).
-- The old limiter counted recent api_request_log rows, ran the handler and only then
-- inserted, so parallel requests all saw the same count and exceeded the limit.
-- This function serialises per token (advisory xact lock), counts the window and
-- records the hit in one transaction. The edge function falls back to the old
-- count-then-log path while this function does not exist yet, so it is safe to
-- deploy the function before or after the migration. No tables are dropped.
create or replace function public.api_rate_limit_hit(
  p_token_hash text,
  p_endpoint   text,
  p_limit      int,
  p_window_s   int default 60
)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_token_hash, 0));

  select count(*)::int into v_used
    from public.api_request_log
   where token_hash = p_token_hash
     and ts > now() - make_interval(secs => p_window_s);

  if v_used >= p_limit then
    return query select false, v_used;
    return;
  end if;

  -- status 0 = admitted, handler outcome not known yet (the limiter only counts rows).
  insert into public.api_request_log (token_hash, ts, endpoint, status)
  values (p_token_hash, now(), p_endpoint, 0);

  return query select true, v_used + 1;
end;
$$;

revoke all on function public.api_rate_limit_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.api_rate_limit_hit(text, text, int, int) to service_role;
