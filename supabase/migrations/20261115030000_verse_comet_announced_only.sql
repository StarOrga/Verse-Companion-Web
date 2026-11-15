-- Comet tip: only the next patch CIG has announced, one target, +-1 day.
--
-- WHY. The target was inferred: verse_comet_version_info() fell back to LIVE + 1 patch
-- (LIVE 4.10.3 -> "4.10.4") and verse_explorer_state().upcoming to LIVE + 1 minor
-- (4.10 -> 4.11) although CIG had announced neither, and the client offered both at once
-- (x.y.z vs line switch). New rule, one place (verse_comet_target):
--   target = the LOWEST patch newer than LIVE that CIG has announced, where "announced" =
--     * a build in a testing channel: patch_versions ptu/eptu, patch_channel_builds
--       ptu/evocati (threads of the last 120 days), or
--     * an official row in verse_patch_announcements ('x.y' or 'x.y.z').
--   On the LIVE line it is an x.y.z (z > LIVE z) = a version tip; on a newer line it is
--   that line x.y = the line tip. Never LIVE + 1. Nothing announced -> target null ->
--   upcoming null and verse_comet_version_state().patch_version null; the client shows
--   "currently no patch tip" and cannot submit. verse_submit_version_prediction already
--   refuses any x.y.z other than the target; the line tip is only offered by the client
--   for upcoming.patch_line, which now only exists when announced.
-- TOLERANCE. hit = |tip - actual LIVE date (UTC)| <= 1 day (was 2): verse_comet_state
--   (hit/miss), verse_explorer_state (sun), verse_resolve_version_tips (splinter).
-- DATA EFFECTS (Alpha policy: nothing dropped).
--   * Tips on never-announced targets (e.g. 4.10.4) stay in verse_patch_version_tips /
--     patch_prediction, they are just no longer offered.
--   * verse_patch_version_tips.hit of every RESOLVED tip is recomputed with <= 1; tips that
--     were a hit at 2 days off lose their sun splinter (splinters are counted from `hit`:
--     verse_explorer_state.sun_splinters / verse_comet_version_state.splinters).
--   * Line tips: the sun (and with it the streak) is derived on read, so it follows <= 1
--     immediately; nothing is stored. Stars are NOT revoked: the 'comet' star is granted
--     by the insert trigger of the tip (verse_prediction_comet_star), never by a hit.
-- ROLLBACK: re-create verse_comet_state from 20261023100000, verse_explorer_state,
--   verse_resolve_version_tips and verse_comet_version_info from 20261114130000, drop
--   verse_comet_target(); lost splinters come back with
--   update ... set hit = abs(...) <= 2 for the resolved tips.

-- ── 1. the one target ──────────────────────────────────────────────────────
create or replace function public.verse_comet_target()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l record;
  t record;
begin
  select q.ma, q.mi, q.z into l
    from (
      select split_part(m[1], '.', 1)::int as ma, split_part(m[1], '.', 2)::int as mi,
             coalesce(nullif(split_part(m[1], '.', 3), ''), '0')::int as z
        from (select regexp_match(v.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)') as m
                from public.patch_versions v where v.channel = 'live') a
       where m is not null
      union all
      select split_part(m[1], '.', 1)::int, split_part(m[1], '.', 2)::int,
             coalesce(nullif(split_part(m[1], '.', 3), ''), '0')::int
        from (select regexp_match(b.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)') as m
                from public.patch_channel_builds b
               where b.channel = 'hotfix' and b.started_at <= now()) c
       where m is not null
    ) q
   order by q.ma desc, q.mi desc, q.z desc
   limit 1;
  if l.ma is null then
    return jsonb_build_object('live', null, 'kind', null, 'target', null, 'source', null);
  end if;

  select a.ma, a.mi, a.z, a.src into t
    from (
      select split_part(m[1], '.', 1)::int as ma, split_part(m[1], '.', 2)::int as mi,
             coalesce(nullif(split_part(m[1], '.', 3), ''), '0')::int as z, src
        from (select regexp_match(v.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)') as m, v.channel as src
                from public.patch_versions v where v.channel in ('ptu', 'eptu')
              union all
              select regexp_match(b.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)'), b.channel
                from public.patch_channel_builds b
               where b.channel in ('ptu', 'evocati')
                 and b.thread_first_at > now() - interval '120 days'
              union all
              select regexp_match(an.patch_line, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)$'), 'announced'
                from public.verse_patch_announcements an) s
       where m is not null
    ) a
   where (a.ma, a.mi, a.z) > (l.ma, l.mi, l.z) and a.z <= 99
   order by a.ma, a.mi, a.z,
            case a.src when 'ptu' then 1 when 'eptu' then 2 when 'evocati' then 3 else 4 end
   limit 1;

  if t.ma is null then
    return jsonb_build_object('live', l.ma || '.' || l.mi || '.' || l.z, 'kind', null, 'target', null, 'source', null);
  end if;
  if (t.ma, t.mi) > (l.ma, l.mi) then
    return jsonb_build_object('live', l.ma || '.' || l.mi || '.' || l.z, 'kind', 'line',
                              'target', t.ma || '.' || t.mi, 'source', t.src);
  end if;
  return jsonb_build_object('live', l.ma || '.' || l.mi || '.' || l.z, 'kind', 'version',
                            'target', t.ma || '.' || t.mi || '.' || t.z, 'source', t.src);
end;
$$;
revoke execute on function public.verse_comet_target() from public, anon, authenticated;

-- x.y.z view of the target (null when the target is a new line or nothing is announced).
-- Same shape as before ({live, target, source}); lock / state / submit use it unchanged.
create or replace function public.verse_comet_version_info()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'live', x ->> 'live',
    'target', case when x ->> 'kind' = 'version' then x ->> 'target' end,
    'source', case when x ->> 'kind' = 'version' then x ->> 'source' end)
  from (select public.verse_comet_target() as x) s;
$$;
revoke execute on function public.verse_comet_version_info() from public, anon, authenticated;

-- ── 2. tolerance: line comet hit/miss ──────────────────────────────────────
create or replace function public.verse_comet_state(p_uid uuid, p_patch_line text, p_live_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tip date;
  v_lock text := public.verse_comet_lock(p_patch_line);
  v_ann date;
  v_state text := 'none';
begin
  select pp.predicted_live_date into v_tip
    from public.patch_prediction pp where pp.user_id = p_uid and pp.patch_line = p_patch_line;
  select a.live_date into v_ann from public.verse_patch_announcements a where a.patch_line = p_patch_line;
  if v_tip is not null then
    if p_live_at is not null and p_live_at <= now() then
      v_state := case when abs(v_tip - (p_live_at at time zone 'UTC')::date) <= 1 then 'hit' else 'miss' end;
    else
      v_state := 'tipped';
    end if;
  end if;
  return jsonb_build_object(
    'state', v_state,
    'tipped_date', v_tip,
    'locked', v_lock is not null,
    'locked_reason', v_lock,
    'announced_date', v_ann);
end;
$$;

revoke execute on function public.verse_comet_state(uuid, text, timestamptz) from public, anon, authenticated;

-- ── 3. tolerance: splinter resolver + recompute of resolved tips ───────────
create or replace function public.verse_resolve_version_tips()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  with b as (
    select h.version, min(h.started_at) as started_at
      from public.patch_channel_builds h
     where h.channel = 'hotfix' and h.started_at <= now()
     group by h.version
  ), r as (
    update public.verse_patch_version_tips t
       set hit = abs(t.predicted_live_date - (b.started_at at time zone 'UTC')::date) <= 1,
           resolved_at = now()
      from b
     where t.patch_version = b.version and t.resolved_at is null
    returning 1
  )
  select count(*)::int into v_n from r;
  return v_n;
end;
$$;
revoke execute on function public.verse_resolve_version_tips() from public, anon, authenticated;

-- Already resolved tips: same rule, new tolerance (revokes splinters of 2-days-off tips).
update public.verse_patch_version_tips t
   set hit = abs(t.predicted_live_date - (b.started_at at time zone 'UTC')::date) <= 1
  from (select h.version, min(h.started_at) as started_at
          from public.patch_channel_builds h
         where h.channel = 'hotfix' and h.started_at <= now()
         group by h.version) b
 where t.patch_version = b.version and t.resolved_at is not null
   and t.hit is distinct from (abs(t.predicted_live_date - (b.started_at at time zone 'UTC')::date) <= 1);

-- ── 4. explorer state: upcoming = the announced line target, sun +-1 ───────
create or replace function public.verse_explorer_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_patches jsonb := '[]'::jsonb;
  r record;
  c record;
  v_guess jsonb;
  v_revealed boolean;
  v_streak int := 0;
  v_best int := 0;
  v_reserve boolean := false;
  v_next_reserve int := 5;
  v_reserves_used int := 0;
  v_full int := 0;
  v_suns jsonb := '[]'::jsonb;
  v_total int := 0;
  v_up_line text;
  v_upcoming jsonb := null;
  v_target jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  for r in
    with lines as (
      (select p.patch_line, p.live_at
         from public.patch_stability_patches p
        order by p.live_at desc
        limit 12)
      union
      select s.patch_line, p.live_at
        from (select sp.patch_line from public.verse_star_progress sp where sp.user_id = v_uid
              union
              select pp.patch_line from public.patch_prediction pp where pp.user_id = v_uid) s
        left join public.patch_stability_patches p using (patch_line)
    )
    select row_number() over (order by l.live_at asc nulls last, l.patch_line)::int as ord,
           count(*) over ()::int as n,
           -- Lines with a reached LIVE date sort first (asc, nulls last), so the
           -- newest LIVE line has ord = n_live; everything after it is not LIVE yet.
           (count(*) filter (where l.live_at <= now()) over ())::int as n_live,
           l.patch_line,
           l.live_at,
           coalesce((select array_agg(sp.star_key order by sp.earned_at)
                       from public.verse_star_progress sp
                      where sp.user_id = v_uid and sp.patch_line = l.patch_line), '{}') as stars,
           coalesce((select jsonb_object_agg(sp.star_key, sp.earned_at)
                       from public.verse_star_progress sp
                      where sp.user_id = v_uid and sp.patch_line = l.patch_line), '{}'::jsonb) as star_dates,
           coalesce((select l.live_at is not null
                            and abs(pp.predicted_live_date - (l.live_at at time zone 'UTC')::date) <= 1
                       from public.patch_prediction pp
                      where pp.user_id = v_uid and pp.patch_line = l.patch_line), false) as sun
      from lines l
     order by 1
  loop
    if cardinality(r.stars) > 0 or r.sun then
      v_streak := v_streak + 1;
      if v_streak >= v_next_reserve then
        v_reserve := true;
        v_next_reserve := v_streak + 5;
      end if;
    elsif r.live_at is null or r.live_at > now() or r.ord >= r.n_live then
      -- Still open: the newest LIVE patch and every line that is not LIVE yet
      -- (a comet tip on the PTU line must not turn the current LIVE patch into
      -- a missed one) never break the streak.
      null;
    elsif v_reserve then
      v_reserve := false;
      v_reserves_used := v_reserves_used + 1;
    else
      v_streak := 0;
      v_next_reserve := 5;
    end if;
    v_best := greatest(v_best, v_streak);
    v_total := v_total + cardinality(r.stars);
    if cardinality(r.stars) >= 7 then v_full := v_full + 1; end if;
    if r.sun then v_suns := v_suns || to_jsonb(r.patch_line); end if;

    v_guess := public.verse_guess_state(v_uid, r.patch_line);
    v_revealed := (v_guess ->> 'state') in ('correct', 'wrong') or cardinality(r.stars) >= 7;
    select vc.class_name, vc.kind, vc.points into c
      from public.verse_constellations vc where vc.patch_line = r.patch_line;

    -- Newest first in the payload.
    v_patches := jsonb_build_array(jsonb_build_object(
      'patch_line', r.patch_line,
      'live_at', r.live_at,
      'stars', to_jsonb(r.stars),
      'star_dates', r.star_dates,
      'star_count', cardinality(r.stars),
      'sun', r.sun,
      'offered', to_jsonb(public.verse_star_pool(r.patch_line)),
      'constellation', case when c.kind is null then null else jsonb_build_object(
        'class_name', case when v_revealed then coalesce(v_guess ->> 'answer_class', c.class_name) end,
        'name', v_guess -> 'answer_name',
        'kind', c.kind,
        'points', c.points) end,
      'comet', public.verse_comet_state(v_uid, r.patch_line, r.live_at),
      'guess', v_guess,
      'unlocks', jsonb_build_object(
        'log_entry', cardinality(r.stars) > 0 or r.sun,
        'community', cardinality(r.stars) >= 3,
        'wallpaper', cardinality(r.stars) >= 7))) || v_patches;
  end loop;

  -- Upcoming = the announced target, only when it is a NEW line (an x.y.z on the LIVE
  -- line is the version comet, verse_comet_version_state). No LIVE + 1 inference: with
  -- nothing announced upcoming stays null. See verse_comet_target.
  v_target := public.verse_comet_target();
  if v_target ->> 'kind' = 'line' then
    v_up_line := v_target ->> 'target';
    if not exists (
         select 1 from public.patch_stability_patches p where p.patch_line = v_up_line and p.live_at <= now()) then
      v_upcoming := jsonb_build_object(
        'patch_line', v_up_line,
        'comet', public.verse_comet_state(v_uid, v_up_line, null));
    end if;
  end if;

  return jsonb_build_object(
    'patches', v_patches,
    'upcoming', v_upcoming,
    'total_stars', v_total,
    'sun_splinters', (select count(*)::int from public.verse_patch_version_tips t where t.user_id = v_uid and t.hit),
    'suns', v_suns,
    'streak', jsonb_build_object(
      'current', v_streak,
      'best', v_best,
      'reserve_available', v_reserve,
      'reserves_used', v_reserves_used),
    'kartograph', jsonb_build_object('unlocked', v_full >= 1, 'rank', v_full,
      'stars', public.verse_lit_star_count(v_uid)),
    'rewards', jsonb_build_object(
      'road', v_best >= 2,
      'nebula', v_best >= 3,
      'live', v_best >= 4,
      'reserve', v_best >= 5,
      'meteor', v_best >= 6,
      'supernova', v_best >= 7,
      'sun_collection', jsonb_array_length(v_suns) > 0)
  );
end;
$$;

revoke execute on function public.verse_explorer_state() from public, anon;
grant execute on function public.verse_explorer_state() to authenticated;

notify pgrst, 'reload schema';
