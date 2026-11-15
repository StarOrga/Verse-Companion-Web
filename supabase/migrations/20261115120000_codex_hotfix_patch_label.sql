-- ============================================================
-- 20261115120000_codex_hotfix_patch_label.sql
-- The Codex labels the 4.10.3 hotfix "4.10.0" and lists nothing as new in it
-- (admin feedback #360).
--
-- WHY
--   1. Patch label. The uploader takes the patch from the game's build_manifest.id
--      "Branch". CIG ships the 4.10.3 hotfix (build 13165946, 2026-11-11) on the
--      branch "sc-alpha-4.10.0" - older than the 4.10.2 build before it (12913470,
--      branch "sc-alpha-4.10.2"). No local file names 4.10.3; only the RSI side
--      does (patch_versions, live = 4.10.3 since 2026-11-13).
--   2. "Neu in" stayed empty. codex_refresh_pending_derived (20261114120000) only
--      records the patch news when no codex_build_changes_done marker exists for
--      (build, other-patch build). That baseline is usually the very build the
--      changed-class-names step just diffed against and marked done, so the record
--      was skipped: codex_patch_first_seen has none of the four new ships.
--
-- WHAT
--   * codex_patch_floor(): BEFORE INSERT/UPDATE OF patch_version trigger on
--     codex_builds. A LIVE build whose manifest names an OLDER patch than a build of
--     the same channel with a LOWER build number gets that patch as a floor; when the
--     RSI live patch (patch_versions) is newer than the floor and in the same line
--     (4.10.x), it gets that one. Non-numeric patches / build numbers pass untouched.
--   * codex_patch_news_done: its own "recorded" marker per build;
--     codex_refresh_pending_derived checks it instead of codex_build_changes_done.
--   * Data fix: the current build 2de5303e (13165946) is relabelled 4.10.3 through
--     the trigger, and its patch news is recorded right here (~30 s, the function's
--     own 120 s budget). The catalog rows keep their informational patch_version
--     column (every unique key is on build_id since 20261114120000).
--
-- Additive (one table, one trigger, one function replaced). Nothing dropped.
-- ROLLBACK: drop trigger if exists codex_builds_patch_floor on public.codex_builds;
--           drop function if exists public.codex_patch_floor();
--           drop table if exists public.codex_patch_news_done;
--           re-apply section 7 of 20261114120000 (codex_refresh_pending_derived).
-- After a real push run: notify pgrst, 'reload schema';
-- ============================================================

create or replace function public.codex_patch_floor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  v_floor text;
  v_live text;
  v_num constant text := '^\d+(\.\d+)*$';
begin
  if upper(coalesce(new.channel, '')) <> 'LIVE'
     or coalesce(new.build_number, '') !~ '^\d+$'
     or coalesce(new.patch_version, '') !~ v_num then
    return new;
  end if;
  -- The newest patch any earlier build of the channel already carries.
  select b.patch_version into v_floor
    from public.codex_builds b
   where b.channel = new.channel and b.id <> new.id
     and b.build_number ~ '^\d+$' and b.build_number::bigint < new.build_number::bigint
     and b.patch_version ~ v_num
   order by string_to_array(b.patch_version, '.')::int[] desc
   limit 1;
  if v_floor is null
     or string_to_array(v_floor, '.')::int[] <= string_to_array(new.patch_version, '.')::int[] then
    return new;
  end if;
  -- A newer build cannot be an older patch: a hotfix on a reused branch name.
  select v.version into v_live
    from public.patch_versions v
   where v.channel = 'live' and v.version ~ v_num
   order by v.detected_at desc
   limit 1;
  if v_live is not null
     and (string_to_array(v_live, '.')::int[])[1:2] = (string_to_array(v_floor, '.')::int[])[1:2]
     and string_to_array(v_live, '.')::int[] > string_to_array(v_floor, '.')::int[] then
    new.patch_version := v_live;
  else
    new.patch_version := v_floor;
  end if;
  return new;
end;
$func$;

revoke all on function public.codex_patch_floor() from public, anon, authenticated;

drop trigger if exists codex_builds_patch_floor on public.codex_builds;
create trigger codex_builds_patch_floor
  before insert or update of patch_version on public.codex_builds
  for each row execute function public.codex_patch_floor();

create table if not exists public.codex_patch_news_done (
  build_id    uuid primary key,   -- no FK: builds are pruned
  recorded_at timestamptz not null default now()
);
alter table public.codex_patch_news_done enable row level security;
revoke all on public.codex_patch_news_done from anon, authenticated;
comment on table public.codex_patch_news_done is
  'Builds whose patch news (codex_record_patch_news) codex_refresh_pending_derived has recorded. Service role only.';

create or replace function public.codex_refresh_pending_derived()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  b record;
  v_prev uuid;
  v_other uuid;
  v_n integer := 0;
begin
  for b in select id, channel, patch_version, created_at from public.codex_builds
            where is_current and finalized_at is not null and superseded_at is null loop
    -- The default diff baseline (the build before it in the channel).
    select id into v_prev from public.codex_builds
     where channel = b.channel and id <> b.id and finalized_at is not null
       and superseded_at is null and created_at < b.created_at
     order by created_at desc limit 1;
    if v_prev is not null and not exists (select 1 from public.codex_build_changes_done d
                                           where d.build_id = b.id and d.previous_build_id = v_prev) then
      perform public.codex_refresh_changed_class_names(b.id, v_prev);
      v_n := v_n + 1;
    end if;
    -- Patch news: first-seen + changed versus the newest build of another patch. Its own
    -- marker: the changed-names marker above is usually for this very baseline (#360).
    select id into v_other from public.codex_builds
     where channel = b.channel and id <> b.id and finalized_at is not null and superseded_at is null
       and patch_version <> b.patch_version and created_at < b.created_at
     order by created_at desc limit 1;
    if v_other is not null and not exists (select 1 from public.codex_patch_news_done n where n.build_id = b.id) then
      perform public.codex_record_patch_news(b.id);
      insert into public.codex_patch_news_done (build_id) values (b.id) on conflict do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$function$;
revoke all on function public.codex_refresh_pending_derived() from public, anon, authenticated;
grant execute on function public.codex_refresh_pending_derived() to service_role;

-- Data fix: the live 4.10.3 build. The trigger picks the label (4.10.3 from
-- patch_versions, else the 4.10.2 floor); the guard keeps a re-run a no-op.
update public.codex_builds set patch_version = patch_version
 where id = '2de5303e-4d59-42e1-8cef-d59285077da5' and patch_version = '4.10.0';

-- Every build that is current now records its patch news on the next cron tick
-- (none of them has the new marker yet); the live one right away.
do $$
begin
  if exists (select 1 from public.codex_builds where id = '2de5303e-4d59-42e1-8cef-d59285077da5') then
    perform public.codex_record_patch_news('2de5303e-4d59-42e1-8cef-d59285077da5');
    insert into public.codex_patch_news_done (build_id)
    values ('2de5303e-4d59-42e1-8cef-d59285077da5') on conflict do nothing;
  end if;
end $$;
