-- One scope for "open" on /admin/translations (feedback #396): the language row of the board counted every
-- open card, the deck only those with params. A card from before karteikarten-neu has no params until the P14
-- cleanup of the next learn pass upgrades it, so the board said "54 offen" while the deck showed
-- "Alles geklärt". Both now count the same deck scope (`params <> '{}'`), and both name the legacy cards that
-- wait for the cleanup separately (`deck_waiting` on the board row, `waiting_total` on the deck) so the page
-- says they come back after the next learn pass instead of hiding them. Additive: create or replace only.

create or replace function public.translation_deck(p_lang text, p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n int := greatest(1, least(coalesce(p_limit, 10), 50)); out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from public.translation_languages t where t.lang = p_lang) then
    raise exception 'unknown language' using errcode = '22023';
  end if;
  with scope as (
    select c.* from public.translation_cards c
     where c.status = 'open' and (c.lang = p_lang or (c.kind = 'convention' and p_lang = any(c.langs)))
       -- A pre-v2 row has no params until the P14 cleanup ran: it would render empty term quotes, so it stays out.
       and c.params <> '{}'::jsonb
  ), top as (
    select s.* from scope s order by s.kind_rank, s.spread desc, s.reach desc, s.doubt desc, s.fresh desc, s.created_at limit n
  )
  select jsonb_build_object(
    'lang', p_lang,
    'open_total', (select count(*) from scope),
    'waiting_total', (select count(*) from public.translation_cards c
       where c.status = 'open' and (c.lang = p_lang or (c.kind = 'convention' and p_lang = any(c.langs)))
         and c.params = '{}'::jsonb),
    'affected_total', (select coalesce(sum(spread), 0) from scope),
    'deck_affected', (select coalesce(sum(spread), 0) from top),
    'cards', coalesce((select jsonb_agg(public.translation_card_json(t, me)
      order by t.kind_rank, t.spread desc, t.reach desc, t.doubt desc, t.fresh desc, t.created_at) from top t), '[]'::jsonb))
  into out;
  return out;
end $$;

-- ------------------------------------------------------------ RPC: board (G1, G3, G4, U8, U10)
-- Daily goal, per-language rows, KI summary, weekly points + rank, leaderboard with names, 7-day row.
create or replace function public.translation_card_board()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  mine text[];
  wk timestamp := date_trunc('week', now() at time zone 'Europe/Berlin');
  out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  mine := public.translation_my_langs_of(me);
  with langs as (
    select t.lang from public.translation_languages t where t.approved order by t.lang
  ), per as (
    select l.lang, l.lang = any(mine) as judged,
      -- Same scope as translation_deck: a legacy row without params is not in the deck, it waits for P14.
      (select count(*) from public.translation_cards c where c.status = 'open' and c.params <> '{}'::jsonb
         and (c.lang = l.lang or (c.kind = 'convention' and l.lang = any(c.langs))))::int as deck_open,
      (select count(*) from public.translation_cards c where c.status = 'open' and c.params = '{}'::jsonb
         and (c.lang = l.lang or (c.kind = 'convention' and l.lang = any(c.langs))))::int as deck_waiting,
      (select count(*) from public.translation_cards c where c.status = 'ai' and c.ai_choice is not null
         and (c.lang = l.lang or (c.kind = 'convention' and l.lang = any(c.langs))))::int as ai_decided,
      (select count(*) from public.translation_cards c where c.status = 'ai' and c.ai_choice is not null
         and (c.lang = l.lang or (c.kind = 'convention' and l.lang = any(c.langs)))
         and c.applied_at is null and c.ai_accepted_at is null)::int as ai_review,
      (select count(*) from public.translation_cards c where c.status = 'ai' and c.ai_choice is not null and c.ai_unsure
         and (c.lang = l.lang or (c.kind = 'convention' and l.lang = any(c.langs)))
         and c.applied_at is null and c.ai_accepted_at is null)::int as ai_unsure,
      (select count(*) from public.translation_cards c where c.status = 'ai' and c.ai_choice is null
         and (c.lang = l.lang or (c.kind = 'convention' and l.lang = any(c.langs))))::int as ai_pending
    from langs l
  ), week as (
    select c.answered_by as uid, sum(c.points + c.bonus)::int as pts
      from public.translation_cards c
     where c.points > 0 and c.answered_by is not null and (c.answered_at at time zone 'Europe/Berlin') >= wk
     group by c.answered_by
  ), board as (
    select w.uid, w.pts from week w
    union all select me, 0 where not exists (select 1 from week where uid = me)
  ), ranked as (
    select b.uid, b.pts, rank() over (order by b.pts desc)::int as rk,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), null) as name
      from board b left join public.profiles p on p.id = b.uid
  ), days as (
    select (wk::date + i) as day from generate_series(0, 6) i
  )
  select jsonb_build_object(
    'rules', public.translation_card_rules(),
    'my_langs', to_jsonb(mine),
    'goal', public.translation_card_goal(me),
    'streak_days', public.translation_card_streak(me),
    'week', jsonb_build_object(
      'start', wk::date,
      'points', (select pts from ranked where uid = me),
      'rank', (select rk from ranked where uid = me),
      'days', (select jsonb_agg(jsonb_build_object('date', d.day,
          'active', exists (select 1 from public.translation_cards c where c.answered_by = me and c.points > 0
                             and (c.answered_at at time zone 'Europe/Berlin')::date = d.day),
          'today', d.day = (now() at time zone 'Europe/Berlin')::date) order by d.day) from days d)),
    'langs', (select coalesce(jsonb_agg(jsonb_build_object('lang', p.lang, 'judged', p.judged, 'deck_open', p.deck_open, 'deck_waiting', p.deck_waiting,
        'ai_decided', p.ai_decided, 'ai_review', p.ai_review, 'ai_unsure', p.ai_unsure, 'ai_pending', p.ai_pending)
        order by p.judged desc, p.lang), '[]'::jsonb) from per p),
    -- Over the cards themselves, not the per-language rows: a convention card counts once, not once per language.
    'ai_summary', (select jsonb_build_object('decided', count(*), 'review', count(*) filter (where c.applied_at is null and c.ai_accepted_at is null),
        'unsure', count(*) filter (where c.ai_unsure and c.applied_at is null and c.ai_accepted_at is null))
        from public.translation_cards c
       where c.status = 'ai' and c.ai_choice is not null
         and (c.lang <> all(mine) or (c.kind = 'convention' and exists (select 1 from unnest(c.langs) x where x <> all(mine))))),
    'leaderboard', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.uid, 'name', r.name, 'points', r.pts,
        'rank', r.rk, 'is_me', r.uid = me) order by r.rk, r.name nulls last), '[]'::jsonb) from ranked r)
  ) into out;
  return out;
end $$;
