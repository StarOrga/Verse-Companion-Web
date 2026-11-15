-- 20261115010000_verse_rank_idea_limit_lock.sql
-- verse_submit_rank_idea checked "max 3 open ideas per user" and inserted without
-- serializing, so parallel submits from one account could all pass the count and exceed
-- the limit. A transaction-scoped advisory lock keyed on the user id serializes the
-- check + insert per user (other users are not blocked). Body otherwise unchanged
-- from 20261114130000_verse_rank_followup.sql.
-- ROLLBACK: re-create the function from 20261114130000 (drops only the lock line).

create or replace function public.verse_submit_rank_idea(p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.verse_lit_star_count(v_uid) < 18 then
    raise exception 'rank_tier_too_low' using errcode = 'P0001';
  end if;
  if char_length(v_body) < 3 or char_length(v_body) > 280 then
    raise exception 'rank_idea_invalid' using errcode = '22023';
  end if;
  -- one submitter at a time per user: the count below and the insert see each other
  perform pg_advisory_xact_lock(hashtextextended('verse_rank_idea:' || v_uid::text, 0));
  if (select count(*) from public.verse_rank_reward_ideas i
       where i.user_id = v_uid and i.archived_at is null) >= 3 then
    raise exception 'rank_idea_limit' using errcode = 'P0001';
  end if;
  insert into public.verse_rank_reward_ideas (user_id, body) values (v_uid, v_body) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.verse_submit_rank_idea(text) from public, anon;
grant execute on function public.verse_submit_rank_idea(text) to authenticated;

notify pgrst, 'reload schema';
