-- Translation flash cards rebuilt ("Karteikarten neu gedacht"): the deck holds only real decisions.
-- Concept docs/concepts/20261121-1151-karteikarten-neu (brief briefs/implement.md, checklist P1-P14,
-- G1-G4); RPC contract for the UI: docs/concepts/20261121-1151-karteikarten-neu/contract.md.
--
-- What changes on public.translation_cards
--   * P9  a card stores kind + parameters (`params`), never an English question: column `question` DROPPED.
--   * P10 option_a / option_b carry {text, source, votes?, count, examples[3]} (written by the pipeline).
--   * P8  kind 'convention' = one cross-language card per spelling/pattern (lang null, `langs` lists the
--         languages); an answer may carry per-language `exceptions` {lang: 'a'|'b'}.
--   * P6  status 'ai' = the KI path: ai_choice/ai_text/ai_basis/ai_reason (code + numbers)/ai_unsure/
--         ai_back (German back-translation)/ai_decided_at; `vetoed` = options flagged „Sieht falsch aus“.
--         status 'parked' = every option vetoed, nothing is applied; 'folded' = an old single card that
--         became a member of a convention card (P14).
--   * P12 "Nicht meine Entscheidung" replaces Skip: status 'skipped' is gone (existing rows -> 'open'),
--         column `skipped_at` DROPPED, rpc skip_translation_card DROPPED; `not_mine_by` records who.
--   * P13 `undo` = snapshot of the row before the last admin action; undo is possible while `applied_at`
--         (new column, backfilled from context.applied_at) is null.
--   * G3  points: 20 per decision (`points`) + `bonus` 180 on the decision that fills the daily goal of 10.
--         Weekly points, week starts Monday (Europe/Berlin). No combo anywhere (G2).
-- New: public.translation_admin_langs (P7) - the languages an admin answers as cards, default {de}.
--
-- Alpha data policy: drops `question`, `skipped_at` and the old card RPCs (answer_translation_card with
-- note/save_as_rule, skip_translation_card, translation_card_stats, translation_card_leaderboard).
-- The only row changes here are mechanical (status skipped -> open, langs/applied_at backfill, kind
-- style -> wording, of which none exist). The P14 clean-up of the open cards through the pre-filters is
-- NOT run here: the learn pass runs it once (`cleanupOpenCards`, marker translation-work/cards/cleanup-v2.json).
--
-- ROLLBACK (alpha; cards created after this migration lose their v2 fields):
--   drop function public.translation_deck(text, integer), public.translation_veto_list(text, integer),
--     public.translation_card_board(), public.answer_translation_card(uuid, text, text, jsonb),
--     public.not_mine_translation_card(uuid), public.undo_translation_card(uuid),
--     public.veto_translation_decision(uuid), public.accept_translation_decision(uuid),
--     public.accept_translation_decisions(text), public.translation_my_langs(),
--     public.set_translation_my_langs(text[]), public.translation_judged_langs(),
--     public.translation_cards_to_apply(text, integer), public.translation_card_json(public.translation_cards, uuid),
--     public.translation_card_goal(uuid), public.translation_card_score(uuid),
--     public.translation_card_snapshot(public.translation_cards, uuid), public.translation_card_rules();
--   drop table public.translation_admin_langs;
--   then re-run the card part of 20261108160000_translation_community_seed.sql (columns question/skipped_at,
--   the old checks, indexes and RPCs).

-- ------------------------------------------------------------ columns
alter table public.translation_cards
  add column if not exists params        jsonb not null default '{}'::jsonb,
  add column if not exists langs         text[] not null default '{}',
  add column if not exists exceptions    jsonb,
  add column if not exists bonus         integer not null default 0 check (bonus >= 0),
  add column if not exists ai_choice     text check (ai_choice in ('a','b','own')),
  add column if not exists ai_text       text,
  add column if not exists ai_basis      text,
  add column if not exists ai_reason     jsonb,
  add column if not exists ai_unsure     boolean not null default false,
  add column if not exists ai_back       text,
  add column if not exists ai_decided_at timestamptz,
  add column if not exists ai_accepted_by uuid references auth.users(id) on delete set null,
  add column if not exists ai_accepted_at timestamptz,
  add column if not exists vetoed        text[] not null default '{}',
  add column if not exists not_mine_by   uuid references auth.users(id) on delete set null,
  add column if not exists applied_at    timestamptz,
  add column if not exists undo          jsonb;

-- Old checks (auto-named in 20261108160000): kind, status, answered<->answer, own text.
alter table public.translation_cards
  drop constraint if exists translation_cards_kind_check,
  drop constraint if exists translation_cards_status_check,
  drop constraint if exists translation_cards_check,
  drop constraint if exists translation_cards_check1;
drop index if exists public.translation_cards_queue_idx;
drop index if exists public.translation_cards_dedupe_uidx;

-- Mechanical backfill (see header).
update public.translation_cards set status = 'open' where status = 'skipped';
update public.translation_cards set kind = 'wording' where kind = 'style';
update public.translation_cards set langs = array[lang] where lang is not null and langs = '{}';
update public.translation_cards set applied_at = (context->>'applied_at')::timestamptz
 where applied_at is null and context ? 'applied_at';

alter table public.translation_cards drop column if exists question;
alter table public.translation_cards drop column if exists skipped_at;
alter table public.translation_cards drop column if exists kind_rank;
alter table public.translation_cards alter column lang drop not null;
alter table public.translation_cards add column kind_rank smallint generated always as (
  case kind when 'convention' then 0 when 'meta' then 1 when 'wording' then 2 else 3 end) stored;

alter table public.translation_cards
  add constraint translation_cards_kind_check check (kind in ('meta','wording','convention')),
  add constraint translation_cards_status_check check (status in ('open','answered','ai','parked','folded')),
  add constraint translation_cards_lang_kind_check check ((lang is null) = (kind = 'convention')),
  add constraint translation_cards_answer_status_check check ((status = 'answered') = (answer is not null)),
  add constraint translation_cards_own_text_check check (answer is distinct from 'own' or coalesce(btrim(own_text), '') <> '');

-- One unapplied card per conflict and language (conventions: one per pattern, lang null -> '*').
create unique index if not exists translation_cards_dedupe_uidx
  on public.translation_cards (coalesce(lang, '*'), dedupe_key)
  where dedupe_key is not null and status in ('open','ai') and applied_at is null;
-- Deck order: kind (convention, term, wording), spread, reach, doubt, fresh.
create index if not exists translation_cards_deck_idx
  on public.translation_cards (lang, kind_rank, spread desc, reach desc, doubt desc, fresh desc)
  where status = 'open';
create index if not exists translation_cards_conv_langs_idx
  on public.translation_cards using gin (langs) where kind = 'convention' and status = 'open';
create index if not exists translation_cards_ai_idx
  on public.translation_cards (lang, ai_unsure desc, spread desc) where status = 'ai';
create index if not exists translation_cards_scored_idx
  on public.translation_cards (answered_by, answered_at desc) where points > 0;

-- ------------------------------------------------------------ per-admin languages (P7)
create table if not exists public.translation_admin_langs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  langs      text[] not null default '{de}',
  updated_at timestamptz not null default now()
);
alter table public.translation_admin_langs enable row level security;
drop policy if exists translation_admin_langs_own_read on public.translation_admin_langs;
create policy translation_admin_langs_own_read on public.translation_admin_langs
  for select to authenticated using (user_id = (select auth.uid()) and public.is_admin());
revoke all on public.translation_admin_langs from anon;
revoke insert, update, delete, truncate on public.translation_admin_langs from authenticated;

-- ------------------------------------------------------------ helpers (not callable by clients)
-- Scoring constants (G3); the board returns them so the UI never hard-codes them.
create or replace function public.translation_card_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('points', 20, 'goal', 10, 'bonus', 180, 'tz', 'Europe/Berlin');
$$;

create or replace function public.translation_my_langs_of(p_user uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce((select t.langs from public.translation_admin_langs t where t.user_id = p_user), array['de']);
$$;

-- Decisions of a user today (Berlin) and whether today's bonus is taken.
create or replace function public.translation_card_goal(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with t as (
    select count(*)::int as n, coalesce(sum(c.bonus), 0)::int as b
      from public.translation_cards c
     where c.answered_by = p_user and c.points > 0
       and (c.answered_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
  )
  select jsonb_build_object('done', t.n, 'target', (public.translation_card_rules()->>'goal')::int,
    'full', t.n >= (public.translation_card_rules()->>'goal')::int, 'bonus_taken', t.b > 0) from t;
$$;

-- Points + bonus for the next decision of a user: the decision that fills the goal gets the bonus, once a day.
create or replace function public.translation_card_score(p_user uuid, out points integer, out bonus integer)
language plpgsql stable security definer set search_path = '' as $$
declare g jsonb := public.translation_card_goal(p_user); r jsonb := public.translation_card_rules();
begin
  points := (r->>'points')::int;
  bonus := case when (g->>'done')::int + 1 >= (r->>'goal')::int and not (g->>'bonus_taken')::boolean
                then (r->>'bonus')::int else 0 end;
end $$;

-- The row as it was before an action (P13 undo), plus who acted.
create or replace function public.translation_card_snapshot(c public.translation_cards, p_by uuid)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    '_by', p_by, 'status', c.status, 'answer', c.answer, 'own_text', c.own_text, 'exceptions', c.exceptions,
    'points', c.points, 'bonus', c.bonus, 'answered_by', c.answered_by, 'answered_at', c.answered_at,
    'ai_choice', c.ai_choice, 'ai_text', c.ai_text, 'ai_basis', c.ai_basis, 'ai_reason', c.ai_reason,
    'ai_unsure', c.ai_unsure, 'ai_back', c.ai_back, 'ai_decided_at', c.ai_decided_at,
    'ai_accepted_by', c.ai_accepted_by, 'ai_accepted_at', c.ai_accepted_at, 'vetoed', to_jsonb(c.vetoed),
    'not_mine_by', c.not_mine_by);
$$;

-- What the UI gets for a card (contract `Card`): no pipeline internals (TM entries, members, hashes).
create or replace function public.translation_card_json(c public.translation_cards, p_me uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'kind', case c.kind when 'meta' then 'term' else c.kind end, 'lang', c.lang, 'langs', to_jsonb(c.langs),
    'params', c.params, 'option_a', c.option_a, 'option_b', c.option_b,
    'spread', c.spread, 'reach', c.reach, 'doubt', c.doubt, 'fresh', c.fresh, 'status', c.status,
    'answer', c.answer, 'own_text', c.own_text, 'exceptions', c.exceptions,
    'points', coalesce(c.points, 0), 'bonus', c.bonus,
    'ai', case when c.ai_choice is null then null else jsonb_build_object(
      'choice', c.ai_choice, 'text', c.ai_text, 'basis', c.ai_basis, 'reason', c.ai_reason,
      'unsure', c.ai_unsure, 'back_de', c.ai_back, 'decided_at', c.ai_decided_at,
      'accepted', c.ai_accepted_at is not null) end,
    'vetoed', to_jsonb(c.vetoed),
    'can_undo', c.undo is not null and c.applied_at is null and (c.undo->>'_by')::uuid = p_me,
    'created_at', c.created_at);
$$;

-- A KI decision is taken over at the next learn pass when an admin accepted it, when its back-translation
-- was there to be read, or after 3 days (no API key = no back-translation must not block it forever).
create or replace function public.translation_cards_to_apply(p_lang text, p_limit integer default 200)
returns setof public.translation_cards language sql stable security definer set search_path = '' as $$
  select c.* from public.translation_cards c
   where (
       (c.kind <> 'convention' and c.lang = p_lang and c.applied_at is null and (
          c.status = 'answered'
          or (c.status = 'ai' and c.ai_choice is not null
              and (c.ai_accepted_at is not null or c.ai_back is not null or c.ai_decided_at < now() - interval '3 days'))))
    or (c.kind = 'convention' and p_lang = any(c.langs)
        and not (coalesce(c.context->'applied_langs', '[]'::jsonb) ? p_lang)
        and (c.status = 'answered'
             or (c.status = 'ai' and c.ai_choice is not null
                 and (c.ai_accepted_at is not null or c.ai_decided_at < now() - interval '3 days'))))
   )
   order by c.answered_at nulls last, c.ai_decided_at
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- Union of the languages admins answer as cards (P7); every other language goes the KI + veto path.
create or replace function public.translation_judged_langs()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct l order by l), '{}')
    from public.profiles p
    cross join lateral unnest(public.translation_my_langs_of(p.id)) as l
   where p.role = 'admin';
$$;

revoke all on function public.translation_card_rules(), public.translation_my_langs_of(uuid),
  public.translation_card_goal(uuid), public.translation_card_score(uuid),
  public.translation_card_snapshot(public.translation_cards, uuid),
  public.translation_card_json(public.translation_cards, uuid),
  public.translation_cards_to_apply(text, integer), public.translation_judged_langs()
from public, anon, authenticated;
grant execute on function public.translation_cards_to_apply(text, integer), public.translation_judged_langs() to service_role;

-- Streak (G1): consecutive Berlin days with at least one scored decision, ending today or yesterday.
create or replace function public.translation_card_streak(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  with d as (
    select distinct (answered_at at time zone 'Europe/Berlin')::date as day
      from public.translation_cards where answered_by = p_user and points > 0
  ), g as (
    select day, day - (row_number() over (order by day))::int as grp from d
  ), runs as (
    select max(day) as last_day, count(*)::int as len from g group by grp
  )
  select coalesce((select len from runs
    where last_day >= (now() at time zone 'Europe/Berlin')::date - 1 order by last_day desc limit 1), 0);
$$;
revoke all on function public.translation_card_streak(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ old RPCs
drop function if exists public.answer_translation_card(uuid, text, text, text, boolean);
drop function if exists public.skip_translation_card(uuid);
drop function if exists public.translation_card_stats(text);
drop function if exists public.translation_card_leaderboard();

-- ------------------------------------------------------------ RPC: languages (P7)
create or replace function public.translation_my_langs()
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return public.translation_my_langs_of((select auth.uid()));
end $$;

create or replace function public.set_translation_my_langs(p_langs text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare v text[];
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct l order by l), '{}') into v from unnest(coalesce(p_langs, '{}')) as l;
  if exists (select 1 from unnest(v) l where not exists (select 1 from public.translation_languages t where t.lang = l)) then
    raise exception 'unknown language' using errcode = '22023';
  end if;
  insert into public.translation_admin_langs (user_id, langs, updated_at) values ((select auth.uid()), v, now())
  on conflict (user_id) do update set langs = excluded.langs, updated_at = excluded.updated_at;
  return v;
end $$;

-- ------------------------------------------------------------ RPC: deck + veto list (reads)
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
  ), top as (
    select s.* from scope s order by s.kind_rank, s.spread desc, s.reach desc, s.doubt desc, s.fresh desc, s.created_at limit n
  )
  select jsonb_build_object(
    'lang', p_lang,
    'open_total', (select count(*) from scope),
    'affected_total', (select coalesce(sum(spread), 0) from scope),
    'deck_affected', (select coalesce(sum(spread), 0) from top),
    'cards', coalesce((select jsonb_agg(public.translation_card_json(t, me)
      order by t.kind_rank, t.spread desc, t.reach desc, t.doubt desc, t.fresh desc, t.created_at) from top t), '[]'::jsonb))
  into out;
  return out;
end $$;

create or replace function public.translation_veto_list(p_lang text, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n int := greatest(1, least(coalesce(p_limit, 50), 200)); out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  with scope as (
    select c.* from public.translation_cards c
     where c.status = 'ai' and c.lang = p_lang and c.ai_choice is not null
       and c.applied_at is null and c.ai_accepted_at is null
  ), top as (
    select s.* from scope s order by s.ai_unsure desc, s.spread desc, s.ai_decided_at limit n
  )
  select jsonb_build_object(
    'lang', p_lang,
    'total', (select count(*) from scope),
    'unsure', (select count(*) from scope where ai_unsure),
    'items', coalesce((select jsonb_agg(public.translation_card_json(t, me) order by t.ai_unsure desc, t.spread desc, t.ai_decided_at)
      from top t), '[]'::jsonb))
  into out;
  return out;
end $$;

-- ------------------------------------------------------------ RPC: actions
-- Answer a deck card (a | b | own) or overrule a KI decision with an own text (P8 exceptions for conventions).
create or replace function public.answer_translation_card(
  p_card_id uuid, p_answer text, p_own_text text default null, p_exceptions jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.translation_cards; s record; ex jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_answer not in ('a','b','own') then raise exception 'invalid answer %', p_answer using errcode = '22023'; end if;
  if p_answer = 'own' and coalesce(btrim(p_own_text), '') = '' then
    raise exception 'own answer needs a text' using errcode = '22023';
  end if;
  select * into c from public.translation_cards
   where id = p_card_id and status in ('open','ai') and applied_at is null for update;
  if not found then raise exception 'card not found or already decided' using errcode = 'P0002'; end if;
  ex := nullif(p_exceptions, '{}'::jsonb);
  if ex is not null then
    if c.kind <> 'convention' or p_answer = 'own' or jsonb_typeof(ex) <> 'object' then
      raise exception 'exceptions only for a/b on a convention' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each_text(ex) e where not (e.key = any(c.langs)) or e.value not in ('a','b') or e.value = p_answer) then
      raise exception 'invalid exception' using errcode = '22023';
    end if;
  end if;
  if c.kind = 'convention' and p_answer = 'own' then
    raise exception 'a convention has no own text' using errcode = '22023';
  end if;
  select * into s from public.translation_card_score(me);
  update public.translation_cards set
    undo = public.translation_card_snapshot(c, me),
    status = 'answered', answer = p_answer,
    own_text = case when p_answer = 'own' then btrim(p_own_text) else null end,
    exceptions = ex, points = s.points, bonus = s.bonus, answered_by = me, answered_at = now()
   where id = c.id returning * into c;
  return jsonb_build_object('card', public.translation_card_json(c, me), 'points', s.points, 'bonus', s.bonus,
    'goal', public.translation_card_goal(me));
end $$;

-- P12 "Nicht meine Entscheidung": out of every deck, onto the KI path (decided at the next learn pass).
create or replace function public.not_mine_translation_card(p_card_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.translation_cards;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.translation_cards where id = p_card_id and status = 'open' for update;
  if not found then raise exception 'card not found or already decided' using errcode = 'P0002'; end if;
  update public.translation_cards set
    undo = public.translation_card_snapshot(c, me), status = 'ai', not_mine_by = me,
    ai_choice = null, ai_text = null, ai_basis = null, ai_reason = null, ai_unsure = false, ai_back = null, ai_decided_at = null
   where id = c.id returning * into c;
  return jsonb_build_object('card', public.translation_card_json(c, me), 'goal', public.translation_card_goal(me));
end $$;

-- P6 „Sieht falsch aus“: the KI pick is withdrawn and never wins again; the next learn pass decides anew.
create or replace function public.veto_translation_decision(p_card_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.translation_cards; s record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.translation_cards
   where id = p_card_id and status = 'ai' and ai_choice is not null and applied_at is null and ai_accepted_at is null for update;
  if not found then raise exception 'decision not found or already taken over' using errcode = 'P0002'; end if;
  select * into s from public.translation_card_score(me);
  update public.translation_cards set
    undo = public.translation_card_snapshot(c, me),
    vetoed = (select array_agg(distinct v) from unnest(c.vetoed || c.ai_choice) v),
    ai_choice = null, ai_text = null, ai_basis = null, ai_reason = null, ai_unsure = false, ai_back = null, ai_decided_at = null,
    points = s.points, bonus = s.bonus, answered_by = me, answered_at = now()
   where id = c.id returning * into c;
  return jsonb_build_object('card', public.translation_card_json(c, me), 'points', s.points, 'bonus', s.bonus,
    'goal', public.translation_card_goal(me));
end $$;

-- P6 „Passt“: the KI pick is taken over at the next learn pass (doing nothing does the same, later).
create or replace function public.accept_translation_decision(p_card_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.translation_cards; s record;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.translation_cards
   where id = p_card_id and status = 'ai' and ai_choice is not null and applied_at is null and ai_accepted_at is null for update;
  if not found then raise exception 'decision not found or already taken over' using errcode = 'P0002'; end if;
  select * into s from public.translation_card_score(me);
  update public.translation_cards set
    undo = public.translation_card_snapshot(c, me), ai_accepted_by = me, ai_accepted_at = now(),
    points = s.points, bonus = s.bonus, answered_by = me, answered_at = now()
   where id = c.id returning * into c;
  return jsonb_build_object('card', public.translation_card_json(c, me), 'points', s.points, 'bonus', s.bonus,
    'goal', public.translation_card_goal(me));
end $$;

-- „Rest übernehmen“: every open KI decision of a language at once; no points (it is not a judgement), no undo.
create or replace function public.accept_translation_decisions(p_lang text)
returns integer language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n int;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.translation_cards set ai_accepted_by = me, ai_accepted_at = now(), undo = null
   where status = 'ai' and lang = p_lang and ai_choice is not null and applied_at is null and ai_accepted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- P13: back to the state before the caller's last action, while no learn pass applied it.
create or replace function public.undo_translation_card(p_card_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.translation_cards; r public.translation_cards;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into c from public.translation_cards where id = p_card_id for update;
  if not found then raise exception 'card not found' using errcode = 'P0002'; end if;
  if c.undo is null or (c.undo->>'_by')::uuid is distinct from me then
    raise exception 'nothing to undo' using errcode = 'P0002';
  end if;
  if c.applied_at is not null or coalesce(jsonb_array_length(c.context->'applied_langs'), 0) > 0 then
    raise exception 'already applied by a learn pass' using errcode = '55000';
  end if;
  r := jsonb_populate_record(c, (c.undo - '_by') || jsonb_build_object('vetoed', coalesce(c.undo->'vetoed', '[]'::jsonb)));
  update public.translation_cards set
    status = r.status, answer = r.answer, own_text = r.own_text, exceptions = r.exceptions,
    points = r.points, bonus = r.bonus, answered_by = r.answered_by, answered_at = r.answered_at,
    ai_choice = r.ai_choice, ai_text = r.ai_text, ai_basis = r.ai_basis, ai_reason = r.ai_reason,
    ai_unsure = r.ai_unsure, ai_back = r.ai_back, ai_decided_at = r.ai_decided_at,
    ai_accepted_by = r.ai_accepted_by, ai_accepted_at = r.ai_accepted_at, vetoed = r.vetoed,
    not_mine_by = r.not_mine_by, undo = null
   where id = c.id returning * into c;
  return jsonb_build_object('card', public.translation_card_json(c, me), 'goal', public.translation_card_goal(me));
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
      (select count(*) from public.translation_cards c where c.status = 'open'
         and (c.lang = l.lang or (c.kind = 'convention' and l.lang = any(c.langs))))::int as deck_open,
      (select count(*) from public.translation_cards c where c.lang = l.lang and c.ai_choice is not null
         and c.status = 'ai')::int as ai_decided,
      (select count(*) from public.translation_cards c where c.lang = l.lang and c.status = 'ai' and c.ai_choice is not null
         and c.applied_at is null and c.ai_accepted_at is null)::int as ai_review,
      (select count(*) from public.translation_cards c where c.lang = l.lang and c.status = 'ai' and c.ai_choice is not null
         and c.ai_unsure and c.applied_at is null and c.ai_accepted_at is null)::int as ai_unsure,
      (select count(*) from public.translation_cards c where c.lang = l.lang and c.status = 'ai' and c.ai_choice is null)::int as ai_pending
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
    'langs', (select coalesce(jsonb_agg(jsonb_build_object('lang', p.lang, 'judged', p.judged, 'deck_open', p.deck_open,
        'ai_decided', p.ai_decided, 'ai_review', p.ai_review, 'ai_unsure', p.ai_unsure, 'ai_pending', p.ai_pending)
        order by p.judged desc, p.lang), '[]'::jsonb) from per p),
    'ai_summary', (select jsonb_build_object('decided', coalesce(sum(ai_decided), 0), 'review', coalesce(sum(ai_review), 0),
        'unsure', coalesce(sum(ai_unsure), 0)) from per where not judged),
    'leaderboard', (select coalesce(jsonb_agg(jsonb_build_object('user_id', r.uid, 'name', r.name, 'points', r.pts,
        'rank', r.rk, 'is_me', r.uid = me) order by r.rk, r.name nulls last), '[]'::jsonb) from ranked r)
  ) into out;
  return out;
end $$;

-- ------------------------------------------------------------ grants
revoke all on function
  public.translation_my_langs(), public.set_translation_my_langs(text[]),
  public.translation_deck(text, integer), public.translation_veto_list(text, integer),
  public.answer_translation_card(uuid, text, text, jsonb), public.not_mine_translation_card(uuid),
  public.veto_translation_decision(uuid), public.accept_translation_decision(uuid),
  public.accept_translation_decisions(text), public.undo_translation_card(uuid), public.translation_card_board()
from public, anon;
grant execute on function
  public.translation_my_langs(), public.set_translation_my_langs(text[]),
  public.translation_deck(text, integer), public.translation_veto_list(text, integer),
  public.answer_translation_card(uuid, text, text, jsonb), public.not_mine_translation_card(uuid),
  public.veto_translation_decision(uuid), public.accept_translation_decision(uuid),
  public.accept_translation_decisions(text), public.undo_translation_card(uuid), public.translation_card_board()
to authenticated;
