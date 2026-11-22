-- Karteikarten (translation cards v2) for collaborators — admin feedback #387, rebuilt on v2.
--
-- The first version of this change (PR #1220, file 20261121120000_translation_cards_collaborators)
-- was written against the v1 card RPCs that 20261121170000_translation_cards_v2 dropped; it never
-- ran (its version number was already taken on the remote by api_rate_limit_atomic) and is gone.
--
-- Collaborators may now do what a card reviewer does in v2: pick the languages they speak,
-- read the deck and the veto list, answer, "Nicht meine Entscheidung", judge a single KI decision
-- (veto / accept), undo their OWN last action and see the board (goal, week, leaderboard).
-- Admin-only stays: accept_translation_decisions ("Rest übernehmen" — a whole language at once,
-- no points, no undo) and everything outside the cards (settings, jobs, ledger, glossary,
-- sources, outreach, alerts). No table policy changes: v2 reads and writes only through these
-- security-definer RPCs. public.is_collaborator() is true for 'admin' AND 'collaborator' (00003),
-- so admins keep every right they had.
--
-- How: each function's v2 body is re-created with exactly its guard line swapped, read from the
-- live definition (pg_get_functiondef), so the bodies stay byte-identical to v2 otherwise. A
-- function whose guard is not found exactly once aborts the migration instead of guessing.
--
-- translation_judged_langs(): a language a collaborator answers as cards is "judged" too (it
-- leaves the KI path and comes as deck cards), exactly like an admin's languages (P7).
--
-- Alpha data policy: nothing dropped, no rows touched.
-- Rollback: run the same block with the two guard strings swapped back, and restore
-- translation_judged_langs from 20261121170000 (`where p.role = 'admin'`).

do $mig$
declare
  fn text;
  src text;
  dst text;
  admin_guard constant text := 'if not public.is_admin() then raise exception ''admin only'' using errcode = ''42501''; end if;';
  collab_guard constant text := 'if not public.is_collaborator() then raise exception ''collaborator only'' using errcode = ''42501''; end if;';
begin
  foreach fn in array array[
    'public.translation_my_langs()',
    'public.set_translation_my_langs(text[])',
    'public.translation_deck(text, integer)',
    'public.translation_veto_list(text, integer)',
    'public.answer_translation_card(uuid, text, text, jsonb)',
    'public.not_mine_translation_card(uuid)',
    'public.veto_translation_decision(uuid)',
    'public.accept_translation_decision(uuid)',
    'public.undo_translation_card(uuid)',
    'public.translation_card_board()'
  ] loop
    src := pg_get_functiondef(fn::regprocedure);
    if (length(src) - length(replace(src, admin_guard, ''))) / length(admin_guard) <> 1 then
      raise exception 'translation_cards_collaborators: guard of % not found exactly once', fn;
    end if;
    dst := replace(src, admin_guard, collab_guard);
    execute dst;
  end loop;
end
$mig$;

-- A collaborator's languages count as judged, like an admin's.
create or replace function public.translation_judged_langs()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct l order by l), '{}')
    from public.profiles p
    cross join lateral unnest(public.translation_my_langs_of(p.id)) as l
   where p.role in ('admin', 'collaborator');
$$;
revoke all on function public.translation_judged_langs() from public, anon, authenticated;
grant execute on function public.translation_judged_langs() to service_role;
