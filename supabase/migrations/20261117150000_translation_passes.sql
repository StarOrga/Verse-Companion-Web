-- Translation pipeline: background passes that run in slices (2026-11-17).
--
-- Why: three parts of the pipeline read the whole string table (~90k keys) and the whole translation memory in one
-- edge request and died at the CPU limit every time: the learning pass (never finished once in production), the
-- community-source import (`sync_sources` answered 546 every night, no source was ever imported) and the overlay
-- rebuild after an import. They now run as passes: one bounded slice per request, progress in this table, so a
-- killed request loses one slice and the next tick goes on where it stopped. Jobs (translation_jobs) run every step
-- in slices as well; their position is in `stats`, and they share the lock, the ledger key and the fast lane below.
--
--   translation_passes            one row per pass (learn | seed | overlay), compare-and-set on updated_at
--   translation_ledger.ref        idempotency key of a ledger row (a retried slice books its spend once)
--   lock_claim / lock_release     the heavy-work lock of the orchestrator: a claim that expires, given back by its owner only
--   translation_work_pending()    true while a job or pass has a slice to run (gate of the fast-lane cron)
--   cron translate-orchestrator-fast            every 10 s, but only while work is pending
--   cron translate-orchestrator-housekeeping    daily: old run details of the fast lane, finished passes > 30 d
--
-- Additive: nothing is dropped, no existing row changes. pg_cron is already enabled - never `create extension` it
-- again (2BP01).
--
-- ROLLBACK:
--   select cron.unschedule('translate-orchestrator-fast');
--   select cron.unschedule('translate-orchestrator-housekeeping');
--   drop function public.translation_work_pending();
--   drop function public.lock_release(text, timestamptz); drop function public.lock_claim(text, interval);
--   drop index public.translation_ledger_ref_uniq; alter table public.translation_ledger drop column ref;
--   drop table public.translation_passes;

create table if not exists public.translation_passes (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('learn', 'seed', 'overlay')),
  lang       text not null references public.translation_languages(lang) on delete cascade,
  -- seed passes: the community source being imported
  source_id  text references public.translation_sources(id) on delete cascade,
  -- pinned when the pass starts, so every slice reads the same build
  build_id   uuid,
  -- what asked for it: publish | seed | sync | backfill | again
  reason     text not null default 'backfill',
  status     text not null default 'open' check (status in ('open', 'done', 'failed')),
  phase      text not null default 'start',
  pos        integer not null default 0 check (pos >= 0),
  total      integer not null default 0 check (total >= 0),
  state      jsonb not null default '{}'::jsonb,
  -- heavy slice in flight since; still set after 5 minutes = that request was killed
  run_at     timestamptz,
  dead       integer not null default 0 check (dead >= 0),
  attempts   integer not null default 0 check (attempts >= 0),
  -- asked for again while it was running: one more pass follows this one, starting with next_state
  again      boolean not null default false,
  next_state jsonb,
  -- who asked: the same asker asking twice (a slice repeated after a kill) does not order a second pass
  token      text,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.translation_passes is
  'Sliced background passes of the translation pipeline (learn, seed import, overlay rebuild). Written by translate-orchestrator only.';

-- At most one open pass per kind, language and source; a second request sets `again` on the open one.
create unique index if not exists translation_passes_one_open
  on public.translation_passes (kind, lang, coalesce(source_id, ''))
  where status = 'open';
create index if not exists translation_passes_open_idx
  on public.translation_passes (created_at)
  where status = 'open';

alter table public.translation_passes enable row level security;

drop policy if exists translation_passes_admin_read on public.translation_passes;
create policy translation_passes_admin_read on public.translation_passes
  for select to authenticated using (public.is_admin());

revoke all on public.translation_passes from public, anon, authenticated;
grant select on public.translation_passes to authenticated;
grant all on public.translation_passes to service_role;

-- Ledger rows get an idempotency key. A slice that books spend and is killed before it records its progress books the
-- same amount again on the retry; with `ref` the second insert is a unique violation the caller ignores.
alter table public.translation_ledger add column if not exists ref text;
create unique index if not exists translation_ledger_ref_uniq
  on public.translation_ledger (coalesce(job_id::text, ''), ref)
  where ref is not null;

-- The heavy-work lock of the orchestrator (same table as claim_run). A claim expires after p_ttl, so a request the
-- runtime killed frees it; a request that ends gives it back at once. The claim's timestamp is the owner's token:
-- lock_release only frees the claim it was given, never the one a later request took after an expiry.
create or replace function public.lock_claim(p_name text, p_ttl interval)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if p_name is null or length(p_name) = 0 or length(p_name) > 200 then
    raise exception 'lock_claim: bad name' using errcode = '22023';
  end if;
  if p_ttl is null or p_ttl <= interval '0' then
    raise exception 'lock_claim: bad ttl' using errcode = '22023';
  end if;

  insert into public.guard_runs as g (mode, last_run_at)
  values (p_name, clock_timestamp())
  on conflict (mode) do update
    set last_run_at = excluded.last_run_at
    where g.last_run_at <= excluded.last_run_at - p_ttl
  returning g.last_run_at into v_at;

  return v_at;
end;
$$;

create or replace function public.lock_release(p_name text, p_token timestamptz)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with freed as (
    update public.guard_runs set last_run_at = 'epoch'::timestamptz
    where mode = p_name and last_run_at = p_token
    returning 1
  )
  select exists (select 1 from freed);
$$;

comment on function public.lock_claim(text, interval) is
  'Claims a named lock that expires after p_ttl; returns the claim timestamp (the owner token) or null when it is held. service_role only.';
comment on function public.lock_release(text, timestamptz) is
  'Gives a lock_claim() claim back; only the claim with this token is freed. service_role only.';

revoke all on function public.lock_claim(text, interval) from public, anon, authenticated;
revoke all on function public.lock_release(text, timestamptz) from public, anon, authenticated;
grant execute on function public.lock_claim(text, interval) to service_role;
grant execute on function public.lock_release(text, timestamptz) to service_role;

-- True while something has a slice to run right now. Jobs that only wait for a batch are not pending: the 10-minute
-- tick asks those. Nothing is stored for this: status and phase of a job tell it.
create or replace function public.translation_work_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.translation_jobs j
      -- The same rule as isHeavy() in translate-orchestrator/_machine.ts: status and phase say whether the
      -- next step is a slice of work or a wait for a batch. Keep the two in step.
      where j.status = 'publishing'
         -- an estimate costs nothing; a full run is the admin's own order and is estimated even while paused
         or (j.status = 'estimating'
             and (j.mode = 'full'
                  or coalesce((select s.enabled from public.translation_settings s where s.id = 1), false)))
         -- queued -> submitted is one status change; the fast lane takes it so that an approved job starts at once
         or (j.status = 'queued'
             and coalesce((select s.enabled from public.translation_settings s where s.id = 1), false))
         or (j.status = 'submitted' and j.stats ->> 'phase' = 'submitting')
         or (j.status = 'validating' and coalesce(j.stats ->> 'phase', 'results') <> 'judge')
         or (j.status = 'post_editing' and coalesce(j.stats ->> 'phase', 'submitting') <> 'running')
         -- an ended job whose work files are still to be deleted
         or j.stats ->> 'sweep' = 'true'
    )
    or exists (select 1 from public.translation_passes p where p.status = 'open');
$$;

comment on function public.translation_work_pending() is
  'True while a translation job or pass has a slice to run (gate of the fast-lane cron).';

revoke all on function public.translation_work_pending() from public, anon, authenticated;
grant execute on function public.translation_work_pending() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'translate-orchestrator-fast') then
    perform cron.unschedule('translate-orchestrator-fast');
  end if;
  if exists (select 1 from cron.job where jobname = 'translate-orchestrator-housekeeping') then
    perform cron.unschedule('translate-orchestrator-housekeeping');
  end if;
end $$;

-- Fast lane: a sliced step needs many requests (a pass ~40, a delta job ~95, the whole gap of a language ~390). On
-- the 10-minute tick alone that is hours to days per language. This job asks every 10 seconds but posts only while
-- work is pending, and the function runs slices of one unit per request behind a lock, so overlapping posts do nothing.
select cron.schedule(
  'translate-orchestrator-fast',
  '10 seconds',
  $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/translate-orchestrator',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{"op":"tick","fast":true}'::jsonb,
    timeout_milliseconds := 60000
  )
  where public.translation_work_pending();
  $job$
);

-- A 10-second job writes 8 640 cron.job_run_details rows a day. Keep one day of them, and 30 days of finished passes.
select cron.schedule(
  'translate-orchestrator-housekeeping',
  '23 4 * * *',
  $job$
  delete from cron.job_run_details d
    using cron.job j
    where j.jobid = d.jobid and j.jobname = 'translate-orchestrator-fast' and d.end_time < now() - interval '1 day';
  delete from public.translation_passes where status <> 'open' and updated_at < now() - interval '30 days';
  $job$
);

notify pgrst, 'reload schema';
