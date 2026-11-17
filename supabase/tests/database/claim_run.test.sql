-- claim_run: the atomic run claim of the cron-called edge functions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(public.claim_run('pgtap-claim', interval '10 minutes'), 'first claim passes');
select ok(not public.claim_run('pgtap-claim', interval '10 minutes'), 'second claim inside the interval is refused');
select ok(public.claim_run('pgtap-other', interval '10 minutes'), 'a different name is independent');

update public.guard_runs set last_run_at = now() - interval '11 minutes' where mode = 'pgtap-claim';
select ok(public.claim_run('pgtap-claim', interval '10 minutes'), 'an expired claim can be taken again');
select ok(not public.claim_run('pgtap-claim', interval '10 minutes'), 'and is then held again');

select throws_ok($$select public.claim_run('x', interval '0')$$, '22023', null, 'zero interval is rejected');

select ok(
  not has_function_privilege('anon', 'public.claim_run(text, interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_run(text, interval)', 'execute')
  and has_function_privilege('service_role', 'public.claim_run(text, interval)', 'execute'),
  'only service_role may execute');

select * from finish();
rollback;
