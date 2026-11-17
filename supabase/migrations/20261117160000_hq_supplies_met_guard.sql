-- A fulfilled wish line stays fulfilled on the server (concept 20261117-1110-pfad-stationen, A8, close-out H2).
--
-- What: (1) public.hq_supplies_cas_source(...) - the compare-and-set of `source` the client already does
-- (HqSuppliesService.casSource), now as a function that marks its own transaction; (2) a BEFORE UPDATE trigger
-- hq_supplies_c_met_guard on public.hq_supplies that, when a write tries to turn a 'wish_met' row back into 'wish'
-- WITHOUT that mark, keeps `source` and `done` of the stored row. Every other column of the write still applies.
--
-- Why: a met wish line is moved 'wish' -> 'wish_met' once (the wish is lowered exactly once by that move). A second
-- device that edited the same line while offline still holds source 'wish' and pushes its whole row on reconnect;
-- last write wins on updated_at, the line read as open again and the next fulfilment lowered the wish a second time.
-- The client cannot know it missed the transition, so the server refuses it. 'wish_met' -> 'wish' is ALSO the
-- deliberate way back (a ticked-off line that is unticked, an undo): that goes through hq_supplies_cas_source, which
-- sets the transaction-local flag `hq.supplies_cas`, so exactly that move passes - and, being conditional on
-- `source = 'wish_met'`, passes exactly once even with two devices.
--
-- Trigger order (alphabetical): hq_supplies_a_sync (last-write-wins, skips stale writes, sets synced_at) ->
-- hq_supplies_b_cap (row caps) -> hq_supplies_c_met_guard. The guard runs last, so a stale write that a_sync already
-- skipped never reaches it, and a coerced write keeps the fresh synced_at a_sync gave it: the device that pushed the
-- stale 'wish' pulls the corrected row (met, ticked) on its next sync.
--
-- The function is SECURITY INVOKER: RLS applies, a user moves only their own rows (it also filters on auth.uid()).
-- search_path is pinned; execute is granted to `authenticated` only.
--
-- Deploy order: push this migration BEFORE the client that calls hq_supplies_cas_source (the client of this branch).
-- The production client deployed today never writes 'wish' / 'wish_met' and does not call the function, and the
-- guard only acts on rows that are 'wish_met', so applying the migration first changes nothing for it.
-- Alpha data policy: no row is changed, nothing is dropped. Never `create extension` here (2BP01).

-- ---------------------------------------------------------------------------
-- compare-and-set of the source, marked as the deliberate move
-- ---------------------------------------------------------------------------
create or replace function public.hq_supplies_cas_source(
  p_ids  text[],
  p_from text,
  p_to   text,
  p_at   timestamptz default now()
)
returns table (won_id text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 300 then
    raise exception 'hq_supplies_cas_source: too many ids' using errcode = 'invalid_parameter_value';
  end if;

  -- Transaction-local mark, read by hq_supplies_keep_met(); cleared again right after the update.
  perform set_config('hq.supplies_cas', 'on', true);
  return query
    update public.hq_supplies s
       set source = p_to,
           updated_at = coalesce(p_at, now())
     where s.user_id = (select auth.uid())
       and s.id = any (p_ids)
       and s.source = p_from
       and s.deleted_at is null
    returning s.id;
  perform set_config('hq.supplies_cas', 'off', true);
end;
$$;

revoke all on function public.hq_supplies_cas_source(text[], text, text, timestamptz) from public, anon;
grant execute on function public.hq_supplies_cas_source(text[], text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- guard: an unmarked write never reopens a met line
-- ---------------------------------------------------------------------------
create or replace function public.hq_supplies_keep_met()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source = 'wish_met'
     and new.source = 'wish'
     and coalesce(current_setting('hq.supplies_cas', true), '') <> 'on' then
    new.source := old.source;
    new.done := old.done;
  end if;
  return new;
end;
$$;

revoke all on function public.hq_supplies_keep_met() from public, anon, authenticated;

drop trigger if exists hq_supplies_c_met_guard on public.hq_supplies;
create trigger hq_supplies_c_met_guard
  before update on public.hq_supplies
  for each row execute function public.hq_supplies_keep_met();

-- PostgREST learns the new function right away (a new rpc answers PGRST202 until its schema cache reloads).
notify pgrst, 'reload schema';
