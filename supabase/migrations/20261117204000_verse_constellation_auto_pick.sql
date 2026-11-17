-- ============================================================
-- 20261117204000_verse_constellation_auto_pick.sql
-- The star map's ship is chosen by a server-side rule, and a choice that stops
-- being eligible heals itself (concept batch 2026-11-17, B4, C20-C22).
--
-- WHY
--   verse_constellations held for 4.10 the hull AEGS_Avenger_Stalker_Display,
--   picked by ingest-catalog from an older build. Ships revision 14 marks
--   mission / event / display hull copies as is_variant; verse_guess_answer
--   filters `not is_variant`, so the 4.10 guess became 'unavailable' and nobody
--   could guess. The choice used to live in the edge function (pickNewest: the
--   class with the latest first appearance in codex_ships), with only
--   is_variant = false as a filter and no way back once the class turned
--   ineligible.
--
-- THE RULE (verse_constellation_pick)
--   1. Eligible = a ship of the build (the uploading build, else the current
--      builds) that passes verse_guess_ship_eligible: not is_variant, a real
--      localized name (not '@'/'!' keys, not "... Edition/Special/Template").
--      The SAME predicate now feeds the answer and the six distractors
--      (verse_guess_pool), so it lives in one place.
--   2. ... and has 7 usable stars: the uploader sends the stars of every ship
--      silhouette (~355 hulls); ingest-catalog now keeps them all in
--      verse_constellation_candidates, not only the winner's.
--   3. "New in patch line L" = codex_patch_first_seen (kind 'ship', first_patch
--      not null) whose first_patch belongs to L - the same record the codex's
--      "Neu in diesem Patch" reads (codex_patch_news). The uploading build's
--      classes that first_seen does not know yet count as new in that build's
--      patch: the constellation op runs before finalize records them.
--   4. Pick from the newest patch line <= L that has such a ship (L itself
--      when it has new ships, else the last line that had some). Within that
--      line: a ship no OTHER patch line's constellation uses first, then the
--      newest first_patch (4.9.3 before 4.9.1), then md5(L || ':' || class).
--      No new ship anywhere (fresh catalog, baseline only): any eligible ship
--      with stars, by the same hash.
--   5. Locked per patch line as before: the first pick stays; a later build of
--      the same patch never changes the shape under stars already earned.
--
-- SELF-HEALING (verse_constellation_heal, also run on every constellation op)
--   A stored class that is no longer eligible in the current builds:
--   a. resolves to its BASE HULL = an eligible ship of the current builds with
--      the same localized name and entity kind as the stored class's newest
--      codex row (the schema has no variant -> base column; is_variant is a
--      class-name heuristic in data-uploader/src/lib/catalog-map.ts, and the
--      display / mission copies carry the series hull's localized name). Among
--      several, the one whose class is a prefix of the stored class wins, then
--      the shortest class name. The stored points stay (same hull, same shape).
--   b. otherwise re-picks by THE RULE for that line (new points from the
--      candidates), or stays as it is (guess 'unavailable') when nothing fits.
--   Skipped entirely while the current builds have no eligible ship.
--   verse_guess_answer resolves (a) on read as well, so a guess never goes
--   'unavailable' between a build switch and the next heal. A re-pick (b) is
--   only ever written by the heal, together with its points.
--
-- PAST GUESSES
--   verse_constellation_guesses stores answer_class / answer_name / correct per
--   (user, patch_line) and verse_guess_state returns them as stored: a re-point
--   never changes a past verdict, and the primary key + "on conflict do
--   nothing" in verse_guess_constellation still refuses a second guess.
--
-- DATA FIX
--   The final statement runs the heal over every stored line: 4.10 resolves
--   from AEGS_Avenger_Stalker_Display to the series Avenger Stalker by rule (a),
--   no hard-coded class name.
--
-- Additive (one table, helper functions); verse_guess_answer and
-- verse_guess_candidates are replaced with the same signatures and contracts.
-- ROLLBACK: drop function if exists public.verse_constellation_lock(text, uuid),
--             public.verse_constellation_heal(text), public.verse_constellation_pick(text, uuid),
--             public.verse_constellation_base(text), public.verse_guess_pool(uuid),
--             public.verse_guess_ship_eligible(text, text, boolean),
--             public.verse_patch_line_of(text), public.verse_version_key(text);
--           drop table if exists public.verse_constellation_candidates;
--           re-apply verse_guess_answer / verse_guess_candidates from 20261023100000.
-- After a real push run: notify pgrst, 'reload schema';
-- ============================================================

-- ------------------------------------------------------------
-- 1 — candidate stars per build (written by ingest-catalog, service role)
-- ------------------------------------------------------------
create table if not exists public.verse_constellation_candidates (
  build_id   uuid        not null references public.codex_builds (id) on delete cascade,
  class_name text        not null check (char_length(class_name) between 1 and 200),
  kind       text        not null check (kind in ('ship', 'ground')),
  points     jsonb       not null check (public.verse_constellation_points_valid(points)),
  created_at timestamptz not null default now(),
  primary key (build_id, class_name)
);
create index if not exists verse_constellation_candidates_class_idx
  on public.verse_constellation_candidates (lower(class_name));

alter table public.verse_constellation_candidates enable row level security;
revoke all on public.verse_constellation_candidates from anon, authenticated;
comment on table public.verse_constellation_candidates is
  'The 7 constellation stars of every ship silhouette per build (uploader -> ingest-catalog constellation op). Pool of verse_constellation_pick. Service role only.';

-- ------------------------------------------------------------
-- 2 — small pure helpers
-- ------------------------------------------------------------
-- "4.10.3" / "4.10" / "4.10.3-live" -> "4.10"; anything else -> null (same as
-- patchLineOf in supabase/functions/ingest-catalog/_constellation.ts).
create or replace function public.verse_patch_line_of(p_version text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case when m is null then null else (m[1]::int)::text || '.' || (m[2]::int)::text end
    from (select regexp_match(coalesce(p_version, ''), '^\s*(\d+)\.(\d+)') as m) x;
$$;

-- Numeric sort key: "4.10.3" -> {4,10,3}, "4.9" -> {4,9}; non-numeric -> {}.
create or replace function public.verse_version_key(p_version text)
returns int[]
language sql
immutable
set search_path to ''
as $$
  select coalesce(array(
           select x::int
             from regexp_split_to_table(substring(coalesce(p_version, '') from '^\s*([0-9]{1,9}(?:\.[0-9]{1,9})*)'), '\.') x),
         '{}'::int[]);
$$;

-- The one guess-eligibility predicate (answer, distractors and the pick).
-- Identical to the inline filters of 20261023100000, so the distractor pool
-- does not move.
create or replace function public.verse_guess_ship_eligible(p_class text, p_name text, p_is_variant boolean)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_class is not null
     and not coalesce(p_is_variant, true)
     and p_name is not null
     and p_name !~ '^[@!]'
     and p_name !~* '(edition|special|template)$';
$$;

-- ------------------------------------------------------------
-- 3 — the eligible pool of a build (null = the current builds)
-- ------------------------------------------------------------
create or replace function public.verse_guess_pool(p_build_id uuid default null)
returns table (class_name text, name text, entity_kind text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path to ''
as $$
  select s.class_name, s.name_localized, s.entity_kind, s.role, s.created_at
    from public.codex_ships s
    join public.codex_builds b on b.id = s.build_id
   where (case when p_build_id is null then b.is_current else b.id = p_build_id end)
     and public.verse_guess_ship_eligible(s.class_name, s.name_localized, s.is_variant);
$$;

revoke execute on function public.verse_guess_pool(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4 — base hull of a class that is no longer eligible (self-healing, rule a)
-- ------------------------------------------------------------
create or replace function public.verse_constellation_base(p_class text)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  with v as (
    select s.name_localized, s.entity_kind
      from public.codex_ships s
     where lower(s.class_name) = lower(p_class)
       and s.name_localized is not null
     order by s.created_at desc
     limit 1
  )
  select p.class_name
    from v
    join public.verse_guess_pool(null) p
      on lower(p.name) = lower(v.name_localized)
     and p.entity_kind is not distinct from v.entity_kind
   where lower(p.class_name) <> lower(p_class)
   order by starts_with(lower(p_class), lower(p.class_name) || '_') desc,
            length(p.class_name), p.class_name
   limit 1;
$$;

revoke execute on function public.verse_constellation_base(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5 — THE RULE (see header)
-- ------------------------------------------------------------
create or replace function public.verse_constellation_pick(p_patch_line text, p_build_id uuid default null)
returns table (class_name text, kind text, points jsonb, source_build_id uuid, rule text)
language sql
stable
security definer
set search_path to ''
as $$
  with elig as (
    select distinct lower(p.class_name) as lcn from public.verse_guess_pool(p_build_id) p
  ),
  pts as (
    -- One set of stars per class: the given build's, else the newest build's.
    select distinct on (lower(vc.class_name))
           lower(vc.class_name) as lcn, vc.class_name, vc.kind, vc.points, vc.build_id
      from public.verse_constellation_candidates vc
      join public.codex_builds b on b.id = vc.build_id
     order by lower(vc.class_name), coalesce(vc.build_id = p_build_id, false) desc, b.created_at desc
  ),
  news as (
    select f.class_name, f.first_patch as fp
      from public.codex_patch_first_seen f
     where f.kind = 'ship' and f.first_patch is not null
    union
    -- Not recorded yet (the op runs before finalize): new in the uploading build's patch.
    select s.class_name, b.patch_version
      from public.codex_ships s
      join public.codex_builds b on b.id = s.build_id
     where p_build_id is not null and s.build_id = p_build_id
       and not exists (select 1 from public.codex_patch_first_seen f
                        where f.kind = 'ship' and f.class_name = s.class_name)
  ),
  used as (
    select lower(c.class_name) as lcn from public.verse_constellations c where c.patch_line <> p_patch_line
  ),
  ranked as (
    select pts.class_name, pts.kind, pts.points, pts.build_id,
           0 as tier,
           public.verse_version_key(public.verse_patch_line_of(n.fp)) as lkey,
           public.verse_version_key(n.fp) as vkey,
           case when public.verse_patch_line_of(n.fp) = p_patch_line then 'new_in_line'
                else 'newest_of_' || public.verse_patch_line_of(n.fp) end as rule
      from news n
      join elig e on e.lcn = lower(n.class_name)
      join pts on pts.lcn = lower(n.class_name)
     where cardinality(public.verse_version_key(public.verse_patch_line_of(n.fp))) = 2
       and public.verse_version_key(public.verse_patch_line_of(n.fp)) <= public.verse_version_key(p_patch_line)
    union all
    select pts.class_name, pts.kind, pts.points, pts.build_id, 1, '{}'::int[], '{}'::int[], 'any_eligible'
      from pts join elig e on e.lcn = pts.lcn
  )
  select r.class_name, r.kind, r.points, r.build_id, r.rule
    from ranked r
   where cardinality(public.verse_version_key(p_patch_line)) = 2
   order by r.tier,
            r.lkey desc,
            (lower(r.class_name) in (select u.lcn from used u)) asc,
            r.vkey desc,
            md5(p_patch_line || ':' || lower(r.class_name)),
            r.class_name
   limit 1;
$$;

revoke execute on function public.verse_constellation_pick(text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 6 — self-healing write (rule a, then b). Service role / migrations only.
-- ------------------------------------------------------------
create or replace function public.verse_constellation_heal(p_patch_line text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  c record;
  p record;
  v_base text;
  v_out jsonb := '[]'::jsonb;
begin
  -- No current ships (catalog empty or mid-switch): judge nothing.
  if not exists (select 1 from public.verse_guess_pool(null)) then
    return jsonb_build_object('skipped', 'no_current_ships');
  end if;
  for c in
    select vc.patch_line, vc.class_name from public.verse_constellations vc
     where p_patch_line is null or vc.patch_line = p_patch_line
     order by vc.patch_line
     for update
  loop
    if exists (select 1 from public.verse_guess_pool(null) g where lower(g.class_name) = lower(c.class_name)) then
      continue;
    end if;
    v_base := public.verse_constellation_base(c.class_name);
    if v_base is not null then
      update public.verse_constellations set class_name = v_base where patch_line = c.patch_line;
      v_out := v_out || jsonb_build_object('patch_line', c.patch_line, 'from', c.class_name, 'to', v_base, 'rule', 'base_hull');
      continue;
    end if;
    select * into p from public.verse_constellation_pick(c.patch_line, null);
    if found then
      update public.verse_constellations
         set class_name = p.class_name, kind = p.kind, points = p.points, source_build_id = p.source_build_id::text
       where patch_line = c.patch_line;
      v_out := v_out || jsonb_build_object('patch_line', c.patch_line, 'from', c.class_name, 'to', p.class_name, 'rule', p.rule);
    else
      v_out := v_out || jsonb_build_object('patch_line', c.patch_line, 'from', c.class_name, 'to', null, 'rule', 'unresolved');
    end if;
  end loop;
  return jsonb_build_object('healed', v_out);
end;
$$;

revoke execute on function public.verse_constellation_heal(text) from public, anon, authenticated;
grant execute on function public.verse_constellation_heal(text) to service_role;

-- ------------------------------------------------------------
-- 7 — the constellation op's write: heal, then lock the line's first pick
-- ------------------------------------------------------------
create or replace function public.verse_constellation_lock(p_patch_line text, p_build_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_build uuid := p_build_id;
  v_heal jsonb;
  r record;
  p record;
  v_ins int;
begin
  if p_patch_line is null or p_patch_line !~ '^\d+\.\d+$' then
    return jsonb_build_object('ok', true, 'skipped', 'no_patch_line');
  end if;
  -- A silhouettes-only run has no ship rows in its build: judge on the current builds.
  if v_build is not null and not exists (select 1 from public.codex_ships s where s.build_id = v_build) then
    v_build := null;
  end if;
  v_heal := public.verse_constellation_heal(null);

  select vc.class_name, vc.kind into r from public.verse_constellations vc where vc.patch_line = p_patch_line;
  if found then
    return jsonb_build_object('ok', true, 'locked', true, 'patch_line', p_patch_line,
                              'class_name', r.class_name, 'kind', r.kind, 'heal', v_heal);
  end if;

  select * into p from public.verse_constellation_pick(p_patch_line, v_build);
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'no_candidates', 'heal', v_heal);
  end if;
  insert into public.verse_constellations (patch_line, class_name, kind, points, source_build_id)
  values (p_patch_line, p.class_name, p.kind, p.points, coalesce(p.source_build_id, p_build_id)::text)
  on conflict (patch_line) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then
    -- Lost a race against a parallel upload of the same patch.
    select vc.class_name, vc.kind into r from public.verse_constellations vc where vc.patch_line = p_patch_line;
    return jsonb_build_object('ok', true, 'locked', true, 'patch_line', p_patch_line,
                              'class_name', r.class_name, 'kind', r.kind, 'heal', v_heal);
  end if;
  return jsonb_build_object('ok', true, 'patch_line', p_patch_line, 'class_name', p.class_name,
                            'kind', p.kind, 'rule', p.rule, 'heal', v_heal);
end;
$$;

revoke execute on function public.verse_constellation_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.verse_constellation_lock(text, uuid) to service_role;

-- ------------------------------------------------------------
-- 8 — answer + candidates on the shared pool (same signatures / contracts)
-- ------------------------------------------------------------
-- The answer of a patch's guess: the stored class when it is eligible in the
-- current builds, else its base hull (self-healing rule a, on read). No row ->
-- 'unavailable'. The answer comes from the SAME pool as the distractors, so its
-- name is built like theirs. Never executable by clients.
create or replace function public.verse_guess_answer(p_patch_line text)
returns table (class_name text, name text, entity_kind text, role text)
language sql
stable
security definer
set search_path to ''
as $$
  with c as (
    select vc.class_name from public.verse_constellations vc where vc.patch_line = p_patch_line
  ),
  -- Direct reads (not the pool function, which cannot be inlined): the explorer
  -- state calls this once or twice per patch line. COALESCE only evaluates the
  -- base-hull lookup when the stored class is not eligible.
  r as (
    select coalesce(
             (select s.class_name
                from public.codex_ships s
                join public.codex_builds b on b.id = s.build_id and b.is_current
               where lower(s.class_name) = lower(c.class_name)
                 and public.verse_guess_ship_eligible(s.class_name, s.name_localized, s.is_variant)
               limit 1),
             public.verse_constellation_base(c.class_name)) as cls
      from c
  )
  select s.class_name, s.name_localized, s.entity_kind, s.role
    from r
    join public.codex_ships s on lower(s.class_name) = lower(r.cls)
    join public.codex_builds b on b.id = s.build_id and b.is_current
   where public.verse_guess_ship_eligible(s.class_name, s.name_localized, s.is_variant)
   order by s.created_at desc
   limit 1;
$$;

revoke execute on function public.verse_guess_answer(text) from public, anon, authenticated;

create or replace function public.verse_guess_candidates(p_patch_line text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_class text;
  v_name text;
  v_kind text;
  v_role text;
  v_opts jsonb;
begin
  select a.class_name, a.name, a.entity_kind, a.role
    into v_class, v_name, v_kind, v_role
    from public.verse_guess_answer(p_patch_line) a;
  if v_class is null then
    return null;
  end if;

  with d as (
    select distinct on (g.name)
           g.class_name as cn, g.name as nm, g.role as rl
      from public.verse_guess_pool(null) g
     where lower(g.class_name) <> lower(v_class)
       and lower(g.name) <> lower(v_name)
       and g.entity_kind is not distinct from v_kind
     order by g.name, g.class_name
  ),
  pick as (
    select cn, nm from d
     order by (rl is not distinct from v_role) desc, md5(p_patch_line || ':' || cn)
     limit 6
  ),
  allopts as (
    select v_class as cn, v_name as nm, true as is_answer
    union all
    select cn, nm, false from pick
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('class_name', cn, 'name', nm, 'is_answer', is_answer)
           order by md5('shuffle:' || p_patch_line || ':' || cn)), '[]'::jsonb)
    into v_opts
    from allopts;
  return v_opts;
end;
$$;

revoke execute on function public.verse_guess_candidates(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 9 — data fix by rule: heal every stored line (4.10 -> series Avenger Stalker)
-- ------------------------------------------------------------
select public.verse_constellation_heal(null);
