-- Sign-up gate + lockdown of unapproved accounts
-- (20261115233000_signup_gate_unapproved_lockdown.sql, security audit 2026-11-15).
--
--   hook_before_user_created(jsonb)   Supabase Auth asks it before it creates an
--     account; only an address on allowed_emails passes. Clients cannot call it.
--   handle_new_user()                 approves an allowlisted sign-up, also when
--     the allowlist row was written with capitals.
--   current_user_role()               an unapproved or suspended account is a
--     viewer, whatever profiles.role says.
--   *_approved_gate / *_approved_writer / profiles_unapproved_identity_freeze
--     an unapproved raw session can neither write its own rows, nor write
--     through the SECURITY DEFINER game RPCs, nor rename itself.
--   list_users_for_admin()            returns is_approved.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- Fixture -------------------------------------------------------------------
insert into public.allowed_emails (email, role) values ('PgTap-Invited@example.test', 'collaborator');

-- ...f001 stranger (not allowlisted), ...f002 allowlisted, ...f003 approved
-- viewer, ...f004 admin. Profile rows come from on_auth_user_created.
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-00000000f001', 'pgtap-stranger@example.test'),
  ('00000000-0000-4000-a000-00000000f002', 'pgtap-invited@example.test'),
  ('00000000-0000-4000-a000-00000000f003', 'pgtap-member@example.test'),
  ('00000000-0000-4000-a000-00000000f004', 'pgtap-boss@example.test');

update public.profiles set is_approved = true where id = '00000000-0000-4000-a000-00000000f003';
update public.profiles set role = 'admin', is_approved = true where id = '00000000-0000-4000-a000-00000000f004';

-- 1. The hook ---------------------------------------------------------------
-- Allowlisted is necessary, not sufficient: the path must prove the mailbox.
select is(
  public.hook_before_user_created('{"user":{"email":"pgtap-stranger@example.test","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}}') -> 'error' ->> 'message',
  'signup_not_allowed', 'a stranger''s verified Google sign-up is rejected');
select is(
  (public.hook_before_user_created('{"user":{"email":"pgtap-stranger@example.test","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}}') -> 'error' ->> 'http_code')::int,
  403, 'the rejection is a 403');
select is(
  public.hook_before_user_created('{"user":{"email":"pgtap-invited@EXAMPLE.test","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}}'),
  '{}'::jsonb, 'an allowlisted address passes through Google, whatever its case');
select ok(public.hook_before_user_created('{"user":{"email":"pgtap-invited@example.test","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":false}}}') ? 'error',
  'Google reporting an unverified address is rejected');
select ok(public.hook_before_user_created('{"user":{"email":"pgtap-invited@example.test","app_metadata":{"provider":"discord"}}}') ? 'error',
  'another provider without a verified address is rejected');
select is(
  public.hook_before_user_created('{"user":{"email":"pgtap-invited@example.test","app_metadata":{"provider":"discord"},"user_metadata":{"email_verified":true}}}'),
  '{}'::jsonb, 'another provider with a verified address passes');
select ok(public.hook_before_user_created('{"user":{"email":"pgtap-invited@example.test","app_metadata":{"provider":"email"}}}') ? 'error',
  'a password sign-up for an allowlisted address is rejected while no invite is in flight');
update public.allowed_emails set invite_started_at = now() - interval '3 minutes' where email = 'pgtap-invited@example.test';
select ok(public.hook_before_user_created('{"user":{"email":"pgtap-invited@example.test","app_metadata":{"provider":"email"}}}') ? 'error',
  '... and when the invite stamp is older than two minutes');
update public.allowed_emails set invite_started_at = now() where email = 'pgtap-invited@example.test';
select is(
  public.hook_before_user_created('{"user":{"email":"pgtap-invited@example.test","app_metadata":{"provider":"email"}}}'),
  '{}'::jsonb, 'an e-mail account passes while an admin invite is in flight');
select ok(public.hook_before_user_created('{"user":{"email":"pgtap-invited@example.test"}}') ? 'error', 'a sign-up without a provider is rejected');
select ok(public.hook_before_user_created('{"user":{"email":""}}') ? 'error', 'an empty e-mail is rejected');
select ok(public.hook_before_user_created('{}') ? 'error', 'an empty event is rejected');

select ok(not has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute'),
  'anon cannot call the hook (it would answer "is this address invited?")');
select ok(not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'),
  'authenticated cannot call the hook');
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
  'Supabase Auth can call the hook');

-- 2. handle_new_user --------------------------------------------------------
select is(
  (select role || ':' || is_approved::text from public.profiles where id = '00000000-0000-4000-a000-00000000f001'),
  'viewer:false', 'a non-allowlisted account starts as an unapproved viewer');
select is(
  (select role || ':' || is_approved::text from public.profiles where id = '00000000-0000-4000-a000-00000000f002'),
  'collaborator:true', 'an allowlisted account is approved at its role although the allowlist row has capitals');

-- 3. Role clamp ---------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000f004","role":"authenticated"}', true);
select ok(public.is_admin(), 'an approved admin is an admin');

-- An unapproved account promoted by mistake: the role column says admin.
update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-00000000f001';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000f001","role":"authenticated"}', true);
select is(public.current_user_role(), 'viewer', 'an unapproved account is a viewer whatever its role column says');
select ok(not public.is_admin(), '... and not an admin');
select ok(not public.is_collaborator(), '... and not a collaborator');
update public.profiles set role = 'viewer' where id = '00000000-0000-4000-a000-00000000f001';

update public.profiles set suspended_at = now() where id = '00000000-0000-4000-a000-00000000f004';
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000f004","role":"authenticated"}', true);
select ok(not public.is_admin(), 'a suspended admin is not an admin');
update public.profiles set suspended_at = null where id = '00000000-0000-4000-a000-00000000f004';

-- 4. A raw session of the unapproved account ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000f001","role":"authenticated"}', true);

select throws_ok($$
  insert into public.verse_seen (user_id, item_key) values ('00000000-0000-4000-a000-00000000f001', 'pgtap')
$$, '42501', null, 'an unapproved account cannot write a self-scoped table (approved gate)');

select throws_ok($$
  select public.verse_submit_prediction('9.99', current_date + 30)
$$, '42501', 'not approved', 'an unapproved account cannot write through a SECURITY DEFINER game RPC');

select throws_ok($$
  update public.profiles set display_name = 'Admin' where id = '00000000-0000-4000-a000-00000000f001'
$$, '42501', null, 'an unapproved account cannot rename itself');

select throws_ok($$ select public.set_username('pgtap_squat') $$,
  '42501', null, 'an unapproved account cannot take a username');

select is((select count(*)::int from public.list_users_for_admin()), 0,
  'list_users_for_admin answers nothing to a non-admin');

-- 5. An approved account is not affected -------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000f003","role":"authenticated"}', true);

select lives_ok($$ select public.verse_submit_prediction('9.99', current_date + 30) $$,
  'an approved account still writes through the game RPC');
select lives_ok($$
  update public.profiles set display_name = 'Member' where id = '00000000-0000-4000-a000-00000000f003'
$$, 'an approved account still renames itself');

-- 6. The admin list says who is not approved ----------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-00000000f004","role":"authenticated"}', true);
select is(
  (select is_approved from public.list_users_for_admin() where id = '00000000-0000-4000-a000-00000000f001'),
  false, 'list_users_for_admin returns is_approved');

reset role;
select * from finish();
rollback;
