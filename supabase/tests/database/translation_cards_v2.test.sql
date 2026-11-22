-- Translation cards v2 (migration 20261121170000_translation_cards_v2.sql, concept karteikarten-neu).
--
-- Pins: admin-only RPCs, the deck (kind order, conventions per member language, legacy rows without params
-- hidden), answers (points 20, exceptions, errors), "Nicht meine Entscheidung", undo (and 55000 after a learn
-- pass applied it), the KI path (veto list incl. convention cards, veto, accept, accept-all), the veto of a
-- decision in a judged language reopening the card, per-admin languages, the board (daily goal bonus 180 on
-- the 10th decision, weekly points, leaderboard names, is_me).
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- Fixtures (as the migration owner) ----------------------------------------
-- ...e0031 admin "Nova", ...e0032 admin "Jerry", ...e0033 viewer.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000e0031', 'pgtap-cards-1@example.test'),
  ('00000000-0000-4000-a000-0000000e0032', 'pgtap-cards-2@example.test'),
  ('00000000-0000-4000-a000-0000000e0033', 'pgtap-cards-3@example.test');
update public.profiles set role = 'admin', is_approved = true, display_name = 'Nova'
 where id = '00000000-0000-4000-a000-0000000e0031';
update public.profiles set role = 'admin', is_approved = true, display_name = 'Jerry'
 where id = '00000000-0000-4000-a000-0000000e0032';

insert into public.translation_cards (id, lang, langs, kind, params, option_a, option_b, spread, reach, doubt, dedupe_key, status) values
  ('00000000-0000-4000-a000-0000000c0101', 'de', '{de}', 'meta', '{"term":"Open","where":"ui"}',
    '{"text":"Oeffnen","source":"mined","votes":5,"count":9}', '{"text":"Offen","source":"mined","votes":2,"count":9}', 9, 3, 0.6, 'term:open', 'open'),
  ('00000000-0000-4000-a000-0000000c0102', 'de', '{de}', 'wording', '{"en":"Open the door","key":"ui_door","where":"ui"}',
    '{"text":"Oeffne die Tuer","source":"ai","count":1}', '{"text":"Tuer oeffnen","source":"community:x","count":1}', 1, 3, 0.9, 'tm:door', 'open'),
  ('00000000-0000-4000-a000-0000000c0103', null, '{de,it}', 'convention', '{"pattern":"case.upper","langs":["de","it"]}',
    '{"text":"Lounge","source":"pattern","count":4}', '{"text":"LOUNGE","source":"pattern","count":4}', 4, 3, 0.5, 'conv:case.upper', 'open'),
  -- a pre-v2 row: no params until the P14 cleanup ran
  ('00000000-0000-4000-a000-0000000c0104', 'de', '{de}', 'wording', '{}',
    '{"text":"x","source":"ai"}', '{"text":"y","source":"ai"}', 50, 3, 1, 'tm:legacy', 'open'),
  ('00000000-0000-4000-a000-0000000c0107', 'de', '{de}', 'wording', '{"en":"Close","key":"ui_close","where":"ui"}',
    '{"text":"Schliessen","source":"ai","count":1}', '{"text":"Zu","source":"ai","count":1}', 1, 3, 0.5, 'tm:close', 'open');
insert into public.translation_cards (id, lang, langs, kind, params, option_a, option_b, spread, dedupe_key, status,
                                      ai_choice, ai_text, ai_basis, ai_reason, ai_unsure, ai_decided_at) values
  -- Italian: nobody judges it (KI + veto path)
  ('00000000-0000-4000-a000-0000000c0105', 'it', '{it}', 'wording', '{"en":"Cancel","key":"ui_cancel","where":"ui"}',
    '{"text":"Annulla","source":"ai"}', '{"text":"Cancella","source":"community:x"}', 3, 'tm:cancel', 'ai',
    'b', 'Cancella', 'community', '{"code":"community"}', true, now()),
  ('00000000-0000-4000-a000-0000000c0108', 'it', '{it}', 'wording', '{"en":"Back","key":"ui_back","where":"ui"}',
    '{"text":"Indietro","source":"ai"}', '{"text":"Dietro","source":"community:x"}', 2, 'tm:back', 'ai',
    'b', 'Dietro', 'community', '{"code":"community"}', false, now()),
  ('00000000-0000-4000-a000-0000000c0109', 'it', '{it}', 'wording', '{"en":"Next","key":"ui_next","where":"ui"}',
    '{"text":"Avanti","source":"ai"}', '{"text":"Prossimo","source":"community:x"}', 2, 'tm:next', 'ai',
    'a', 'Avanti', 'ai', '{"code":"ai"}', true, now()),
  -- German: an admin judges it (an automatic decision there must be reversible)
  ('00000000-0000-4000-a000-0000000c0106', 'de', '{de}', 'wording', '{"en":"Cargo Hold","key":"ui_cargo","where":"ui"}',
    '{"text":"Frachtraum","source":"ai"}', '{"text":"FRACHTRAUM","source":"community:x"}', 2, 'tm:cargo', 'ai',
    'a', 'Frachtraum', 'casing_source', '{"code":"casing_source"}', false, now()),
  -- a decided convention (after "Nicht meine Entscheidung")
  ('00000000-0000-4000-a000-0000000c0110', null, '{de,it}', 'convention', '{"pattern":"compound","langs":["de","it"]}',
    '{"text":"Landeplatz","source":"pattern","count":2}', '{"text":"Lande-Platz","source":"pattern","count":2}', 2, 'conv:compound', 'ai',
    'a', 'Landeplatz', 'votes', '{"code":"votes","a":0,"b":0}', true, now());
-- ten fresh cards for the daily goal of the second admin
insert into public.translation_cards (lang, langs, kind, params, option_a, option_b, spread, dedupe_key, status)
select 'de', '{de}', 'wording', jsonb_build_object('en', 'g' || i, 'key', 'ui_g' || i, 'where', 'ui'),
       '{"text":"a","source":"ai"}', '{"text":"b","source":"ai"}', 1, 'tm:goal' || i, 'open'
  from generate_series(1, 10) i;

-- Viewer: nothing --------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0033","role":"authenticated"}', true);
select throws_ok($$ select public.translation_deck('de') $$, '42501', null, 'a viewer cannot read the deck');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0101', 'a') $$, '42501', null, 'a viewer cannot answer');
select throws_ok($$ select public.not_mine_translation_card('00000000-0000-4000-a000-0000000c0101') $$, '42501', null, 'a viewer cannot send a card to the KI');
select throws_ok($$ select public.translation_card_board() $$, '42501', null, 'a viewer cannot read the board');
select throws_ok($$ select public.set_translation_my_langs(array['de']) $$, '42501', null, 'a viewer cannot set languages');
select ok(not has_function_privilege('anon', 'public.translation_deck(text, integer)', 'EXECUTE'), 'anon cannot call the deck');
select ok(not has_function_privilege('authenticated', 'public.translation_cards_to_apply(text, integer)', 'EXECUTE'), 'the learn pass helper is not callable by clients');

-- Admin 1: languages, deck -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0031","role":"authenticated"}', true);
select is(public.translation_my_langs(), array['de'], 'the default of an admin is German only');
select throws_ok($$ select public.set_translation_my_langs(array['xx']) $$, '22023', null, 'an unknown language is rejected');
select is(public.set_translation_my_langs(array['it', 'de', 'it']), array['de', 'it'], 'languages are sorted and deduped');
select is(public.set_translation_my_langs(array['de']), array['de'], 'languages can be set back');

select is((public.translation_deck('de', 50)->>'open_total')::int, 14, 'the German deck counts its cards, the convention and ten goal cards, not the legacy row');
select is(public.translation_deck('de', 50)->'cards'->0->>'kind', 'convention', 'a convention comes first');
select is(public.translation_deck('de', 50)->'cards'->1->>'kind', 'term', 'then terms (DB meta is returned as term)');
select ok(not (public.translation_deck('de', 50)->'cards' @> '[{"id":"00000000-0000-4000-a000-0000000c0104"}]'::jsonb),
  'a legacy card without params never reaches the deck');
select is((public.translation_deck('it', 50)->>'open_total')::int, 1, 'the convention also covers a member language');
select throws_ok($$ select public.translation_deck('xx') $$, '22023', null, 'an unknown language is rejected');
select is(jsonb_array_length(public.translation_deck('de', 2)->'cards'), 2, 'the limit cuts the deck');
select is((public.translation_deck('de', 50)->>'waiting_total')::int, 1, 'the deck names the legacy card that waits for the cleanup');
select is((select (e->>'deck_open')::int from jsonb_array_elements(public.translation_card_board()->'langs') e where e->>'lang' = 'de'),
  (public.translation_deck('de', 50)->>'open_total')::int, 'the board row counts the same open cards as the deck (#396)');
select is((select (e->>'deck_waiting')::int from jsonb_array_elements(public.translation_card_board()->'langs') e where e->>'lang' = 'de'),
  1, 'the board row names the legacy card apart');

-- Answers ---------------------------------------------------------------------------------
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0101', 'x') $$, '22023', null, 'an invalid answer is rejected');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0101', 'own') $$, '22023', null, 'an own answer needs a text');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0101', 'a', null, '{"it":"b"}') $$,
  '22023', null, 'exceptions are for conventions only');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0103', 'a', null, '{"ja":"b"}') $$,
  '22023', null, 'an exception needs a language of the card');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0103', 'a', null, '{"it":"a"}') $$,
  '22023', null, 'an exception must differ from the answer');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0103', 'own', 'x') $$,
  '22023', null, 'a convention has no own text');
select is((public.answer_translation_card('00000000-0000-4000-a000-0000000c0103', 'a', null, '{"it":"b"}')->>'points')::int, 20, 'an answer scores 20 points');
select is(public.answer_translation_card('00000000-0000-4000-a000-0000000c0101', 'b')->'card'->>'can_undo', 'true', 'the answer can be undone');
select is((select exceptions->>'it' from public.translation_cards where id = '00000000-0000-4000-a000-0000000c0103'), 'b', 'the convention keeps its per-language exception');
select throws_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0101', 'a') $$,
  'P0002', null, 'an answered card cannot be answered again');

-- Undo --------------------------------------------------------------------------------------
select is(public.undo_translation_card('00000000-0000-4000-a000-0000000c0101')->'card'->>'status', 'open', 'undo puts the card back to open');
select is((select coalesce(points, 0)::text || '/' || coalesce(answer, '-') from public.translation_cards where id = '00000000-0000-4000-a000-0000000c0101'), '0/-',
  'undo restores the state before the action (answer and points gone)');
select throws_ok($$ select public.undo_translation_card('00000000-0000-4000-a000-0000000c0101') $$, 'P0002', null, 'a second undo has nothing to undo');
select lives_ok($$ select public.answer_translation_card('00000000-0000-4000-a000-0000000c0107', 'a') $$, 'a card to be applied is answered');
reset role;
update public.translation_cards set applied_at = now() where id = '00000000-0000-4000-a000-0000000c0107';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0031","role":"authenticated"}', true);
select throws_ok($$ select public.undo_translation_card('00000000-0000-4000-a000-0000000c0107') $$, '55000', null, 'undo after a learn pass applied it raises 55000');

-- Nicht meine Entscheidung ------------------------------------------------------------------------
select is(public.not_mine_translation_card('00000000-0000-4000-a000-0000000c0102')->'card'->>'status', 'ai', 'not mine sends the card to the KI path');
select is((select ai_choice is null and not_mine_by = '00000000-0000-4000-a000-0000000e0031' from public.translation_cards where id = '00000000-0000-4000-a000-0000000c0102'),
  true, 'it is undecided and records who sent it');
select is((public.translation_deck('de', 50)->>'open_total')::int, 11, 'the card left the deck');
select is(public.undo_translation_card('00000000-0000-4000-a000-0000000c0102')->'card'->>'status', 'open', 'not mine can be undone');
select throws_ok($$ select public.not_mine_translation_card('00000000-0000-4000-a000-0000000c0105') $$, 'P0002', null, 'only an open card can be sent');

-- Veto list, veto, accept -----------------------------------------------------------------------------
select is((public.translation_veto_list('it')->>'total')::int, 4, 'the Italian list holds the KI decisions and the decided convention');
select is((public.translation_veto_list('it')->>'unsure')::int, 3, 'unsure ones are counted (the convention is unsure too)');
select is(public.translation_veto_list('it')->'items'->0->'ai'->>'unsure', 'true', 'unsure decisions come first');
select is((public.translation_veto_list('de')->>'total')::int, 2, 'a judged language lists its automatic decisions (and the convention)');
select is(public.veto_translation_decision('00000000-0000-4000-a000-0000000c0105')->'card'->'vetoed', '["b"]'::jsonb,
  'Sieht falsch aus withdraws the decision and remembers the option');
select is((select status || '/' || (ai_choice is null)::text from public.translation_cards where id = '00000000-0000-4000-a000-0000000c0105'),
  'ai/true', 'in a language nobody judges the card goes back to the KI');
select is(public.veto_translation_decision('00000000-0000-4000-a000-0000000c0106')->'card'->>'status', 'open',
  'a vetoed decision in a judged language reopens as a deck card');
select is((public.translation_deck('de', 50)->>'open_total')::int, 13, 'the reopened card is back in the German deck');
select is(public.undo_translation_card('00000000-0000-4000-a000-0000000c0106')->'card'->>'status', 'ai', 'the reopen can be undone');
select is(public.accept_translation_decision('00000000-0000-4000-a000-0000000c0108')->'card'->'ai'->>'accepted', 'true', 'Passt marks the decision accepted');
select throws_ok($$ select public.accept_translation_decision('00000000-0000-4000-a000-0000000c0108') $$, 'P0002', null, 'an accepted decision cannot be accepted twice');
select is(public.accept_translation_decisions('it'), 2, 'accept all takes over what is still open (decision + convention)');

-- Admin 2: board, goal bonus, leaderboard ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000e0032","role":"authenticated"}', true);
select lives_ok($$ select public.answer_translation_card(id, 'a') from public.translation_cards where dedupe_key like 'tm:goal%' and dedupe_key <> 'tm:goal10' $$,
  'nine decisions are made');
select is((public.translation_card_board()->'goal'->>'done')::int, 9, 'the daily goal counts the decisions');
select is(public.answer_translation_card((select id from public.translation_cards where dedupe_key = 'tm:goal10'), 'b')->>'bonus', '180',
  'the decision that fills the goal carries the 180 bonus');
select is((public.translation_card_board()->'week'->>'points')::int, 10 * 20 + 180, 'weekly points are points plus bonus');
select is(public.translation_card_board()->'goal'->>'full', 'true', 'the goal is full');
select is((select count(*)::int from jsonb_array_elements(public.translation_card_board()->'leaderboard') e where (e->>'is_me')::boolean), 1, 'exactly one leaderboard row is me');
select is((select e->>'name' from jsonb_array_elements(public.translation_card_board()->'leaderboard') e where e->>'name' = 'Nova'), 'Nova', 'other admins appear by display name');
select is((public.translation_card_board()->'week'->>'rank')::int, 1, 'the rank follows the weekly points');
select is(jsonb_array_length(public.translation_card_board()->'week'->'days'), 7, 'the week row has seven days');
select is((public.translation_card_board()->'ai_summary'->>'decided')::int, 3, 'the KI summary counts each card once, over the languages nobody judges');

select * from finish();
rollback;
