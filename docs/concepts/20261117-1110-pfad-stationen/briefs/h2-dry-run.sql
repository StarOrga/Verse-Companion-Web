-- H2 dry run: the met-line guard (migration 20261117160000_hq_supplies_met_guard.sql).
--
-- ONE self-contained script: begin; the migration body; test cases that `raise exception` on a wrong outcome;
-- rollback. It leaves no trace (everything, including the migration objects, is rolled back). Run it against the live
-- project as the owner role (SQL editor / psql / Management API), as ONE statement batch in a single session:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f h2-dry-run.sql
-- Success = the last notice reads "H2 dry run: all cases passed" and the batch ends with ROLLBACK. Any wrong outcome
-- aborts with an exception that names the case. Needs at least one row in auth.users.
--
-- The cases run under `set local role authenticated` with a JWT sub of the row owner, so RLS and the grants are the
-- real ones. Timestamps are explicit and in the past (the sync trigger skips a write whose updated_at is older than
-- the stored one, and clamps future ones).

begin;

-- ===========================================================================
-- migration body (verbatim copy of 20261117160000_hq_supplies_met_guard.sql; re-copy it when the migration changes)
-- ===========================================================================
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

-- ===========================================================================
-- setup (as the owner role): five throwaway rows for an existing user
-- ===========================================================================
do $$
declare
  uid uuid := coalesce((select user_id from public.hq_supplies limit 1), (select id from auth.users limit 1));
  t0  timestamptz := now() - interval '3 hours';
begin
  if uid is null then
    raise exception 'H2 dry run: no user in auth.users to borrow';
  end if;
  perform set_config('h2.uid', uid::text, true);
  insert into public.hq_supplies (user_id, id, name, qty, done, source, updated_at) values
    (uid, 'h2-met-reopened',  'H2 met, stale reopen',  2, true,  'wish_met', t0),
    (uid, 'h2-met-unrelated', 'H2 met, other edit',    2, true,  'wish_met', t0),
    (uid, 'h2-open-wish',     'H2 open wish line',     2, false, 'wish',     t0),
    (uid, 'h2-search',        'H2 search line',        2, false, 'search',   t0),
    (uid, 'h2-met-foreign',   'H2 met, other user',    2, true,  'wish_met', t0);
end $$;

-- From here on: the real role and the owner's identity (what PostgREST sets for a signed-in request).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('h2.uid'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('h2.uid'), true);

-- ===========================================================================
-- case 1: an UNMARKED wish_met -> wish update (a stale full-row upsert) keeps source and done; other columns apply
-- ===========================================================================
do $$
declare r record;
begin
  update public.hq_supplies
     set source = 'wish', done = false, qty = 5, updated_at = now() - interval '2 hours'
   where id = 'h2-met-reopened';
  select source, done, qty into r from public.hq_supplies where id = 'h2-met-reopened';
  if r.source <> 'wish_met' then raise exception 'case 1: source reopened to %', r.source; end if;
  if r.done is not true then raise exception 'case 1: done was cleared'; end if;
  if r.qty <> 5 then raise exception 'case 1: the newer qty did not apply (qty = %)', r.qty; end if;
end $$;

-- ===========================================================================
-- case 2: the function moves wish_met -> wish and returns the id, exactly once
-- ===========================================================================
do $$
declare won text[]; r record;
begin
  select coalesce(array_agg(won_id), '{}') into won
    from public.hq_supplies_cas_source(array['h2-met-reopened'], 'wish_met', 'wish', now() - interval '1 hour 50 minutes');
  if won <> array['h2-met-reopened'] then raise exception 'case 2: expected the id back, got %', won; end if;
  select source into r from public.hq_supplies where id = 'h2-met-reopened';
  if r.source <> 'wish' then raise exception 'case 2: source is % after the function', r.source; end if;
  -- second call: the row is not wish_met any more, nothing is won (the exactly-once marker)
  select coalesce(array_agg(won_id), '{}') into won
    from public.hq_supplies_cas_source(array['h2-met-reopened'], 'wish_met', 'wish', now() - interval '1 hour 40 minutes');
  if cardinality(won) <> 0 then raise exception 'case 2: the second call won again: %', won; end if;
end $$;

-- ===========================================================================
-- case 3: the function moves wish -> wish_met and returns the id; afterwards the mark is gone, so an unmarked
--         write to 'wish' is coerced again (the flag does not leak out of the function)
-- ===========================================================================
do $$
declare won text[]; r record;
begin
  select coalesce(array_agg(won_id), '{}') into won
    from public.hq_supplies_cas_source(array['h2-open-wish'], 'wish', 'wish_met', now() - interval '1 hour 30 minutes');
  if won <> array['h2-open-wish'] then raise exception 'case 3: expected the id back, got %', won; end if;
  select source into r from public.hq_supplies where id = 'h2-open-wish';
  if r.source <> 'wish_met' then raise exception 'case 3: source is % after the function', r.source; end if;
  update public.hq_supplies set source = 'wish', updated_at = now() - interval '1 hour 20 minutes' where id = 'h2-open-wish';
  select source into r from public.hq_supplies where id = 'h2-open-wish';
  if r.source <> 'wish_met' then raise exception 'case 3: the mark leaked, an unmarked write reopened the line (%)', r.source; end if;
end $$;

-- ===========================================================================
-- case 4: an unrelated update of a wish_met row (qty, done unticked) passes untouched
-- ===========================================================================
do $$
declare r record;
begin
  update public.hq_supplies set qty = 7, done = false, updated_at = now() - interval '1 hour' where id = 'h2-met-unrelated';
  select source, done, qty into r from public.hq_supplies where id = 'h2-met-unrelated';
  if r.qty <> 7 then raise exception 'case 4: qty was not written (%)', r.qty; end if;
  if r.done is not false then raise exception 'case 4: the untick was swallowed'; end if;
  if r.source <> 'wish_met' then raise exception 'case 4: source changed to %', r.source; end if;
end $$;

-- ===========================================================================
-- case 5: search -> wish by an unmarked update is NOT blocked (the old reconcile path)
-- ===========================================================================
do $$
declare r record;
begin
  update public.hq_supplies set source = 'wish', updated_at = now() - interval '50 minutes' where id = 'h2-search';
  select source into r from public.hq_supplies where id = 'h2-search';
  if r.source <> 'wish' then raise exception 'case 5: search -> wish was blocked (source %)', r.source; end if;
end $$;

-- ===========================================================================
-- case 6: RLS still applies - another user's identity wins nothing, even with the function
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
declare won text[];
begin
  select coalesce(array_agg(won_id), '{}') into won
    from public.hq_supplies_cas_source(array['h2-met-foreign'], 'wish_met', 'wish', now() - interval '40 minutes');
  if cardinality(won) <> 0 then raise exception 'case 6: a foreign user moved a row: %', won; end if;
end $$;

-- ===========================================================================
-- case 7: grants - anon may not call the function, authenticated may; the trigger functions are not callable
-- ===========================================================================
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.hq_supplies_cas_source(text[], text, text, timestamptz)', 'execute') then
    raise exception 'case 7: anon can execute hq_supplies_cas_source';
  end if;
  if not has_function_privilege('authenticated', 'public.hq_supplies_cas_source(text[], text, text, timestamptz)', 'execute') then
    raise exception 'case 7: authenticated cannot execute hq_supplies_cas_source';
  end if;
  if has_function_privilege('authenticated', 'public.hq_supplies_keep_met()', 'execute') then
    raise exception 'case 7: authenticated can execute the trigger function';
  end if;
  -- trigger order: the guard must fire after hq_supplies_a_sync and hq_supplies_b_cap
  if (select array_agg(tgname::text order by tgname) from pg_trigger
       where tgrelid = 'public.hq_supplies'::regclass and not tgisinternal)
     <> array['hq_supplies_a_sync', 'hq_supplies_b_cap', 'hq_supplies_c_met_guard'] then
    raise exception 'case 7: unexpected trigger set on hq_supplies';
  end if;
  raise notice 'H2 dry run: all cases passed';
end $$;

rollback;
