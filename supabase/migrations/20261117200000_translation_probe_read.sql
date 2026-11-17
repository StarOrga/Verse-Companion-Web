-- The fast lane takes the read of a probed first batch.
--
-- A translation job of several batch groups sends its first group alone and reads its bill before the
-- others go out (translate-orchestrator/_job_run.ts, `probe`). Waiting for that batch is a wait
-- (`submitted` / `probe`, asked by the 10-minute tick); reading it is a slice of work of its own
-- (`submitted` / `probe_read`): it streams a results file and reads plan parts, so it is stamped,
-- counted and run behind the heavy-work lock like every other slice. The gate of the fast-lane cron
-- has to know the new phase, or the read would wait for the next 10-minute tick.
--
-- Only the function body changes (one more phase for `submitted`). No table is touched, nothing is dropped.

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
         -- sending a batch, and reading the bill of the probed first one
         or (j.status = 'submitted' and j.stats ->> 'phase' in ('submitting', 'probe_read'))
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
