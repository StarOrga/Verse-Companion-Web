-- ============================================================
-- 20261117190000_uploader_ledger_by_build.sql
-- Data Uploader: the subtheme ledger is identified by channel + build number,
-- so a change of the patch LABEL never makes uploaded parts look open again.
--
-- WHY (feedback 17.11., notes #5/#6)
--   The uploader read its patch from build_manifest.id "Branch" — for the 4.10.3
--   hotfix (build 13165946) CIG reused the branch "sc-alpha-4.10.0", so every
--   ledger row of that build sits under patch_version '4.10.0'. The uploader now
--   reads the public x.y.z from the RSI launcher log line that installed exactly
--   this build ("4.10.3-live.13165946"). Under the old exact-patch lookup that
--   would orphan all seven uploaded parts and re-run the whole pipeline.
--   A build number is unique per channel; the patch label is informational.
--
-- WHAT
--   1. list_uploader_subthemes: for a numeric build number, matches channel +
--      build only (patch ignored) and returns ONE row per subtheme — the highest
--      revision, newest upload first. Non-numeric builds ('desktop', hand-run
--      extracts) keep the exact (channel, patch, build) match.
--   2. Data fix: the ledger rows of LIVE build 13165946 are relabelled
--      '4.10.0' -> '4.10.3' (only where no 4.10.3 row for that subtheme exists).
--   3. The stray staging row of 17.11. (LIVE 13165946, never finalized, not
--      current) — the catalogue re-upload that only started because the 3D
--      hulls were open — is deleted with its rows (FKs cascade, as in
--      prune_codex_builds, which would have removed it after 7 days anyway).
--
-- Idempotent: create or replace; the update and the delete match nothing on a
-- second run. Nothing dropped besides that one unfinalized staging build.
-- ROLLBACK: re-apply list_uploader_subthemes from 20261004070000; the relabel
--           is informational (update ... set patch_version = '4.10.0' where
--           channel = 'LIVE' and build_number = '13165946').
-- After a real push run: notify pgrst, 'reload schema';
-- ============================================================

create or replace function public.list_uploader_subthemes(
  p_channel text,
  p_patch_version text,
  p_build_number text
)
returns table (subtheme text, revision int, uploader_version text, uploaded_at timestamptz)
language sql security definer set search_path = public stable as $func$
  select distinct on (u.subtheme) u.subtheme, u.revision, u.uploader_version, u.uploaded_at
  from public.uploader_subtheme_uploads u
  where public.is_collaborator()
    and u.channel = upper(trim(p_channel))
    and u.build_number = trim(p_build_number)
    and (trim(p_build_number) ~ '^[0-9]+$' or u.patch_version = trim(p_patch_version))
  order by u.subtheme, u.revision desc, u.uploaded_at desc;
$func$;

revoke all on function public.list_uploader_subthemes(text, text, text) from public, anon;
grant execute on function public.list_uploader_subthemes(text, text, text) to authenticated;

update public.uploader_subtheme_uploads u
   set patch_version = '4.10.3'
 where u.channel = 'LIVE' and u.build_number = '13165946' and u.patch_version = '4.10.0'
   and not exists (
     select 1 from public.uploader_subtheme_uploads x
      where x.channel = u.channel and x.build_number = u.build_number
        and x.patch_version = '4.10.3' and x.subtheme = u.subtheme
   );

delete from public.codex_builds b
 where b.channel = 'LIVE' and b.build_number = '13165946'
   and b.finalized_at is null and not b.is_current
   and b.created_at >= timestamptz '2026-11-17 00:00:00+00'
   and b.created_at <  timestamptz '2026-11-18 00:00:00+00';
