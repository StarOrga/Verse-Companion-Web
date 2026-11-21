-- Audit 2026-11-21 (translation #1): pruning a codex build deleted its translation_jobs, and the
-- ledger rows cascaded with them, so the month's spend shrank and the monthly cap could be exceeded
-- again. The ledger is financial history: keep the rows, detach them from the job instead.
-- job_id has been nullable since 20261108180000_translation_ledger_kind.sql.
-- ROLLBACK: alter table public.translation_ledger drop constraint translation_ledger_job_id_fkey,
--   add constraint translation_ledger_job_id_fkey foreign key (job_id)
--   references public.translation_jobs(id) on delete cascade;
alter table public.translation_ledger drop constraint if exists translation_ledger_job_id_fkey;
alter table public.translation_ledger
  add constraint translation_ledger_job_id_fkey
  foreign key (job_id) references public.translation_jobs(id) on delete set null;

-- translation_ledger_job_kind_check demanded job_id for kind='job' rows, so "set null" would have made
-- the build prune fail. A detached job row is now legitimate (its job was pruned with its build).
-- (ROLLBACK for this part: re-add the check from 20261108180000 after deleting detached kind='job' rows.)
alter table public.translation_ledger drop constraint if exists translation_ledger_job_kind_check;
