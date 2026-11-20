-- Karteikarten (translation cards) for collaborators — admin feedback #387.
--
-- Collaborators may review the AI translation cards: read the queue, answer, skip, see the
-- header numbers and the leaderboard. Nothing else of the translation pipeline opens up:
-- settings, jobs, ledger, glossary, sources, outreach and override alerts stay admin-only.
--
-- public.is_collaborator() is true for 'admin' AND 'collaborator' (00003), so admins keep
-- every right they had.
--
--   * translation_cards: the select policy moves from is_admin() to is_collaborator();
--     writes still only go through the RPCs below (update stays revoked).
--   * translation_languages: an extra select-only policy for collaborators (codes and CIG
--     folder names, for the language overview); the admin "for all" policy is untouched.
--   * answer/skip_translation_card, translation_card_stats, translation_card_leaderboard:
--     guard is_admin() -> is_collaborator(); bodies otherwise unchanged from 20261108160000.
--
-- Alpha data policy: no table or column dropped. Rollback = re-run the four function bodies
-- and the cards policy from 20261108160000 and `drop policy translation_languages_collab_read`.

-- ------------------------------------------------------------ RLS
drop policy if exists translation_cards_admin_read on public.translation_cards;
drop policy if exists translation_cards_collab_read on public.translation_cards;
create policy translation_cards_collab_read on public.translation_cards
  for select to authenticated using (public.is_collaborator());

drop policy if exists translation_languages_collab_read on public.translation_languages;
create policy translation_languages_collab_read on public.translation_languages
  for select to authenticated using (public.is_collaborator());

-- ------------------------------------------------------------ RPC: cards
create or replace function public.answer_translation_card(
  p_card_id uuid, p_answer text, p_own_text text default null,
  p_note text default null, p_save_as_rule boolean default false)
returns public.translation_cards
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_cards;
begin
  if not public.is_collaborator() then
    raise exception 'collaborator only' using errcode = '42501';
  end if;
  if p_answer not in ('a','b','own') then
    raise exception 'invalid answer %', p_answer using errcode = '22023';
  end if;
  if p_answer = 'own' and coalesce(btrim(p_own_text), '') = '' then
    raise exception 'own answer needs a text' using errcode = '22023';
  end if;
  update public.translation_cards
     set status = 'answered',
         answer = p_answer,
         own_text = case when p_answer = 'own' then p_own_text else null end,
         note = nullif(btrim(coalesce(p_note, '')), ''),
         save_as_rule = coalesce(p_save_as_rule, false),
         points = 10 + round(least(impact, 500) / 10.0)::int,
         answered_by = (select auth.uid()),
         answered_at = now()
   where id = p_card_id and status in ('open','skipped')
   returning * into r;
  if not found then
    raise exception 'card not found or already answered' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public.skip_translation_card(p_card_id uuid)
returns public.translation_cards
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_cards;
begin
  if not public.is_collaborator() then
    raise exception 'collaborator only' using errcode = '42501';
  end if;
  update public.translation_cards
     set status = 'skipped', skipped_at = now()
   where id = p_card_id and status in ('open','skipped')
   returning * into r;
  if not found then
    raise exception 'card not found or already answered' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public.translation_card_leaderboard()
returns table (answered_by uuid, points bigint, answers bigint, streak_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_collaborator() then
    raise exception 'collaborator only' using errcode = '42501';
  end if;
  return query
    select c.answered_by, sum(c.points)::bigint, count(*)::bigint,
           public.translation_card_streak(c.answered_by)
      from public.translation_cards c
     where c.status = 'answered' and c.answered_by is not null
     group by c.answered_by
     order by 2 desc, 3 desc;
end $$;

create or replace function public.translation_card_stats(p_lang text default null)
returns table (open_count integer, answered_today integer, streak_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_collaborator() then
    raise exception 'collaborator only' using errcode = '42501';
  end if;
  return query
    select
      (select count(*)::int from public.translation_cards c
        where c.status in ('open','skipped') and (p_lang is null or c.lang = p_lang)),
      (select count(*)::int from public.translation_cards c
        where c.status = 'answered' and c.answered_by = (select auth.uid())
          and (c.answered_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
          and (p_lang is null or c.lang = p_lang)),
      public.translation_card_streak((select auth.uid()));
end $$;
