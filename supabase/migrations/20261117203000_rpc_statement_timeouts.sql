-- RPCs that ran into the role statement timeout (anon 3 s / authenticated 8 s).
--
-- Production 2026-11-17, 12:00-17:40 UTC: PostgREST 500 "canceling statement due to
-- statement timeout" on hq_fleet_patch (14x), codex_swap_candidates (4x),
-- codex_added_class_names (3x), codex_facet_values (2x), search_missions (2x).
-- Measured as the real roles inside rolled-back transactions; numbers in the PR.
--
--   * hq_fleet_patch: joined the reader's <= 60 owned class names against the FULL
--     catalog of the current and the previous build (4 views x 2 builds, ~49 000
--     rows, each view left-joining codex_payloads - one seq scan of codex_payloads
--     per build plus ~8 000 pkey probes). ~44 000 buffers per call; with a cold cache
--     6.2 s, pg_stat_statements mean 4.6 s over 111 calls. Now one natkey lookup
--     (build_id, class_name) per wanted class and table: a few hundred buffers.
--   * search_missions: reward and variant count per title were correlated subqueries
--     over the hits CTE - quadratic in the number of hits. A two-letter term ("de")
--     matches most missions of the build: 10 s warm, every time. Now one window
--     aggregate over the hits.
--   * codex_facet_values: the manufacturer facet detoasted the payload of every
--     coded row (items: 8 610 payloads, 70 000 buffers, 4.6 s cold for anon) to pick
--     the first row per maker whose name resolves. Now it reads payloads per maker in
--     class_name order and stops at the first resolved one (an index on
--     (build_id, manufacturer_code, class_name) keeps that walk ordered).
--   * codex_swap_candidates: no defect in isolation (7-730 ms cold and warm as anon,
--     the broadest slot - helmets, 500 rows - is the slowest); it reads through the
--     swap worker as anon (3 s) and failed only in the 17:02 burst. Unchanged.
--   * codex_added_class_names: no defect (3-70 ms cold and warm); it failed only in the
--     17:02 burst of parallel page loads. Unchanged.
--
-- Same signatures, same results (md5 of old vs new output compared in a rolled-back
-- dry run), same volatility and search_path. CREATE OR REPLACE keeps the existing
-- ACLs, so no grant changes; none of these functions is SECURITY DEFINER.
--
-- Alpha-phase data policy: purely additive (one index, function bodies replaced).

-- ~4 MB for ~61 000 rows; builds in well under a second.
create index if not exists codex_items_build_maker_idx
  on public.codex_items_rows (build_id, manufacturer_code, class_name);

-- ---------------------------------------------------------------------------
-- hq_fleet_patch
-- ---------------------------------------------------------------------------
create or replace function public.hq_fleet_patch()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cur  record;
  prev record;
  result jsonb;
begin
  -- Newest current build, LIVE preferred; the previous build of the same channel.
  select b.id, b.channel, b.patch_version, b.created_at into cur
    from public.codex_builds b
   where b.is_current
   order by (b.channel = 'LIVE') desc, b.created_at desc
   limit 1;
  if cur.id is null then
    return jsonb_build_object('build', null, 'previous', null, 'lines', '[]'::jsonb);
  end if;

  select b.id, b.patch_version into prev
    from public.codex_builds b
   where b.channel = cur.channel and b.patch_version is distinct from cur.patch_version
     and b.created_at < cur.created_at   -- skip re-ingests of the same patch
   order by b.created_at desc
   limit 1;
  if prev.id is null then
    return jsonb_build_object('build', cur.patch_version, 'previous', null, 'lines', '[]'::jsonb);
  end if;

  with owned as materialized (
    -- (class_name, kind, set) of everything the user owns / put into a set
    select s.ship_class_name as class_name, 'ship'::text as entity_kind,
           null::text as set_kind, null::uuid as set_id, s.custom_name as set_name
      from public.hangar_ships s
     where s.status = 'owned' and s.deleted_at is null
    union all
    select e.value ->> 'className', 'part', 'ship', c.id, c.name
      from public.hangar_ship_configs c
      cross join lateral jsonb_array_elements(c.loadout) e
     where e.value ->> 'className' is not null and c.deleted_at is null
    union all
    select e.value ->> 'className', 'part', 'fps', l.id, l.name
      from public.hangar_role_loadouts l
      cross join lateral jsonb_array_elements(l.items) e
     where e.value ->> 'className' is not null and l.deleted_at is null
  ),
  wanted as materialized (
    select distinct o.class_name from owned o limit 60
  ),
  -- Per wanted class a lateral natkey lookup: a plain join against the union of the
  -- four views made the planner read (and payload-join) every row of the build.
  rows_cur as materialized (
    select x.class_name, x.payload
      from wanted w
      cross join lateral (
        select t.class_name, t.payload from public.codex_ships t
         where t.build_id = cur.id and t.class_name = w.class_name
        union all
        select t.class_name, t.payload from public.codex_weapons t
         where t.build_id = cur.id and t.class_name = w.class_name
        union all
        select t.class_name, t.payload from public.codex_components t
         where t.build_id = cur.id and t.class_name = w.class_name
        union all
        select t.class_name, t.payload from public.codex_items t
         where t.build_id = cur.id and t.class_name = w.class_name
      ) x
  ),
  rows_prev as materialized (
    select x.class_name, x.payload
      from wanted w
      cross join lateral (
        select t.class_name, t.payload from public.codex_ships t
         where t.build_id = prev.id and t.class_name = w.class_name
        union all
        select t.class_name, t.payload from public.codex_weapons t
         where t.build_id = prev.id and t.class_name = w.class_name
        union all
        select t.class_name, t.payload from public.codex_components t
         where t.build_id = prev.id and t.class_name = w.class_name
        union all
        select t.class_name, t.payload from public.codex_items t
         where t.build_id = prev.id and t.class_name = w.class_name
      ) x
  ),
  flat_cur as materialized (
    select r.class_name, f.path, f.val
      from rows_cur r, lateral public.hq_flatten_numeric(r.payload) f
  ),
  flat_prev as materialized (
    select r.class_name, f.path, f.val
      from rows_prev r, lateral public.hq_flatten_numeric(r.payload) f
  ),
  diffs as materialized (
    select c.class_name, c.path, p.val as old_val, c.val as new_val,
           (c.val - p.val) / p.val as pct
      from flat_cur c
      join flat_prev p on p.class_name = c.class_name and p.path = c.path
     where p.val <> 0
       and c.val <> p.val
       and abs((c.val - p.val) / p.val) >= 0.01
       and c.path !~* '(^|\.)(id|guid|hash|version|index|order|sort|seed|crc)([._]|$)'
  ),
  best as (
    select distinct on (d.class_name) d.*
      from diffs d
     order by d.class_name, abs(d.pct) desc, d.path
  ),
  top2 as (
    select b.*, row_number() over (order by abs(b.pct) desc, b.class_name) as rn
      from best b
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'class_name', t.class_name,
             'entity_kind', o.entity_kind,
             'category', split_part(t.path, '.', 1),
             'path', t.path,
             'old', t.old_val,
             'new', t.new_val,
             'pct', round(t.pct * 100, 1),
             'set_kind', o.set_kind,
             'set_id', o.set_id,
             'set_name', o.set_name)
           order by t.rn), '[]'::jsonb)
    into result
    from top2 t
    cross join lateral (
      -- the most relevant owner of the class: a ship itself first, else any set that uses it
      select ow.entity_kind, ow.set_kind, ow.set_id, ow.set_name
        from owned ow
       where ow.class_name = t.class_name
       order by (ow.entity_kind = 'ship') desc, ow.set_name nulls last
       limit 1
    ) o
   where t.rn <= 2;

  return jsonb_build_object('build', cur.patch_version, 'previous', prev.patch_version, 'lines', coalesce(result, '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- search_missions
-- ---------------------------------------------------------------------------
create or replace function public.search_missions(p_query text, p_limit integer default 8)
returns table (class_name text, title text, type_name text, giver_name text, location_name text, reward_amount integer, variants integer, total integer)
language sql
stable
set search_path = public, extensions
as $$
  with q as (
    select lower(left(btrim(coalesce(p_query, '')), 80)) as t
  ),
  esc as (
    select t, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as e from q
  ),
  b as (
    select id from public.codex_builds
     where channel = 'LIVE' and is_current
     order by created_at desc
     limit 1
  ),
  hits as materialized (
    select m.class_name, m.title, m.type_name, m.giver_name, m.location_name, m.reward_amount,
           lower(m.title) as lt,
           (lower(m.title) like esc.e || '%') as prefix,
           word_similarity(esc.t, m.search_text) as sim
      from public.codex_missions m, b, esc
     where m.build_id = b.id
       and char_length(esc.t) >= 2
       and (m.search_text like '%' || esc.e || '%' or word_similarity(esc.t, m.search_text) >= 0.5)
  ),
  -- One window pass instead of two correlated subqueries per hit (quadratic: 10 s for
  -- a two-letter term). A null title matched nothing in the old `lower(x.title) =
  -- lower(h.title)` subqueries, hence null / 0 there.
  grouped as (
    select distinct on (h.lt)
           h.class_name, h.title, h.type_name, h.giver_name, h.location_name,
           h.prefix, h.sim,
           (case when h.lt is not null then max(h.reward_amount) over per_title end)::int as reward_amount,
           (case when h.lt is not null then count(*) over per_title else 0 end)::int as variants
      from hits h
    window per_title as (partition by h.lt)
     order by h.lt, h.class_name
  )
  select g.class_name, g.title, g.type_name, g.giver_name, g.location_name,
         g.reward_amount, g.variants, (count(*) over ())::int as total
    from grouped g
   order by g.prefix desc, g.sim desc, g.title
   limit least(greatest(coalesce(p_limit, 8), 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- codex_facet_values
-- ---------------------------------------------------------------------------
create or replace function public.codex_facet_values(p_build_id uuid, p_kind text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_table text;
  v_where text;
  v_has_manufacturer boolean := false;
  v_has_size boolean := false;
  v_has_grade boolean := false;
  v_has_component_kind boolean := false;
  v_manufacturers jsonb := '[]'::jsonb;
  v_sizes jsonb := '[]'::jsonb;
  v_grades jsonb := '[]'::jsonb;
  v_component_kinds jsonb := '[]'::jsonb;
begin
  case p_kind
    when 'ship' then
      v_table := 'codex_ships';
      v_has_manufacturer := true;
    when 'weapon' then
      v_table := 'codex_weapons';
      v_has_manufacturer := true;
      v_has_size := true;
      v_has_grade := true;
    when 'component' then
      v_table := 'codex_components';
      v_has_manufacturer := true;
      v_has_size := true;
      v_has_grade := true;
      v_has_component_kind := true;
    when 'item' then
      v_table := 'codex_items';
      v_has_manufacturer := true;
      v_has_size := true;
      v_has_grade := true;
    else
      -- ammunition/manufacturer/blueprint: no such facets in the list UI.
      return jsonb_build_object(
        'manufacturers', '[]'::jsonb,
        'sizes', '[]'::jsonb,
        'grades', '[]'::jsonb,
        'componentKinds', '[]'::jsonb
      );
  end case;

  -- Mirrors applyDefaultBrowseFilters (codex.service.ts): buyable-only, no
  -- placeholder/untranslated names, ships additionally drop the non-ship
  -- vehicle prefixes.
  v_where := format('build_id = %L and is_variant = false and (name_localized is null or name_localized not like %L)',
    p_build_id, '!%');
  if p_kind = 'ship' then
    v_where := v_where || format(
      ' and class_name not ilike %L and class_name not ilike %L and class_name not ilike %L',
      'SalvageableDebris%', 'Orbital_Sentry%', 'probe_%'
    );
  end if;

  if v_has_manufacturer then
    -- One entry per manufacturer_code: the first row (by class_name) whose payload
    -- actually resolves a name (not an unresolved '@key'), else the first row of
    -- the code at all - same as manufacturerFacetOptions' "first resolved name
    -- wins" client rule. 'UNKN' is the catalog's own "no known maker" code
    -- (UNKNOWN_MANUFACTURER_CODE in codex.service.ts) — never offered as a filter
    -- value. Paint items carry their livery token in manufacturer_code
    -- ("Paint_400i_Black_Orange_Logo", 940 one-off codes in the items table of
    -- build 4.9), each named after the real maker — only real code shapes become
    -- options (MANUFACTURER_CODE_SHAPE).
    -- The codes come from the lean columns (the view's payload join drops out);
    -- payloads are read per code in class_name order only until the first
    -- resolved name. The old form sorted every coded row by a payload expression:
    -- 8 610 detoasts on items, 4.6 s cold - over the anon timeout.
    execute format(
      $q$select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name',
                coalesce(
                  (select t.payload->'manufacturer'->'name'
                     from public.%1$I t
                    where %2$s and t.manufacturer_code = c.code
                      and coalesce(t.payload->'manufacturer'->'name'->>'en', '') <> ''
                      and (t.payload->'manufacturer'->'name'->>'en') not like '@%%'
                    order by t.class_name
                    limit 1),
                  (select t.payload->'manufacturer'->'name'
                     from public.%1$I t
                    where %2$s and t.manufacturer_code = c.code
                    order by t.class_name
                    limit 1)))
              order by c.code), '[]'::jsonb)
         from (
           select distinct manufacturer_code as code
           from public.%1$I
           where %2$s and manufacturer_code is not null and manufacturer_code <> 'UNKN'
             and manufacturer_code ~ '^[A-Z0-9]{2,6}$'
         ) c$q$,
      v_table, v_where
    ) into v_manufacturers;
  end if;

  if v_has_size then
    execute format(
      $q$select coalesce(jsonb_agg(size order by size), '[]'::jsonb)
         from (select distinct size from public.%I where %s and size is not null) s$q$,
      v_table, v_where
    ) into v_sizes;
  end if;

  if v_has_grade then
    execute format(
      $q$select coalesce(jsonb_agg(grade order by grade), '[]'::jsonb)
         from (select distinct grade from public.%I where %s and grade is not null) s$q$,
      v_table, v_where
    ) into v_grades;
  end if;

  if v_has_component_kind then
    execute format(
      $q$select coalesce(jsonb_agg(kind order by kind), '[]'::jsonb)
         from (select distinct kind from public.%I where %s and kind is not null) s$q$,
      v_table, v_where
    ) into v_component_kinds;
  end if;

  return jsonb_build_object(
    'manufacturers', v_manufacturers,
    'sizes', v_sizes,
    'grades', v_grades,
    'componentKinds', v_component_kinds
  );
end;
$$;

notify pgrst, 'reload schema';
