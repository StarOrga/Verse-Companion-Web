-- ============================================================
-- 20261115233000_signup_gate_unapproved_lockdown.sql
--
-- Security audit 2026-11-15: a stranger signed in with Google on 2026-11-12.
-- The account was never approved (profiles.is_approved = false) and held no
-- data, but the audit showed how much an unapproved account still was:
--
--   * Supabase Auth created the account at all. "Invite only" was enforced
--     AFTER the fact, by the approval flag, on every table and function that
--     remembered to ask for it.
--   * The admin people list showed it as an ordinary viewer:
--     list_users_for_admin() did not return is_approved.
--   * 17 self-scoped tables had no approval gate, 6 game tables were written
--     by SECURITY DEFINER RPCs that only asked for auth.uid(), and
--     current_user_role() ignored approval and suspension, so an unapproved
--     account promoted by mistake would have been an admin for RLS.
--
-- What this migration does:
--
--   1. hook_before_user_created(jsonb)  the Supabase Auth "before user
--        created" hook: no account is created unless the e-mail is on
--        allowed_emails AND comes through a path that proves the mailbox
--        (verified OAuth, or an admin invite in flight:
--        allowed_emails.invite_started_at), or is the bootstrap founder of
--        an empty database.
--        ENABLING it is project auth config, not SQL (Management API /
--        dashboard: hook_before_user_created_enabled + _uri
--        pg-functions://postgres/public/hook_before_user_created). Until it is
--        enabled, 2-6 below are the gate, as before.
--   2. handle_new_user()                bootstrap branch only while no admin
--        exists (it could never fire again legitimately; it must not be able
--        to fire illegitimately).
--   3. current_user_role()              answers 'viewer' for an unapproved or
--        suspended account, which closes is_admin() / is_collaborator() and
--        every policy and RPC built on them in one place.
--   4. <table>_approved_gate            the RESTRICTIVE is_approved() policy
--        on the self-scoped tables that were still missing it.
--   5. require_approved_writer()        trigger on the tables written through
--        SECURITY DEFINER RPCs (RLS does not reach those writes).
--   6. profiles_unapproved_identity_freeze  an unapproved account cannot set
--        username / display_name / rsi_handle (handle squatting, and the
--        display name is what an admin reads in the people list).
--   7. list_users_for_admin()           returns is_approved + approved_at.
--
-- No data is changed. Existing accounts keep their state: approved accounts
-- are unaffected by 3-6, and no unapproved account holds a role above viewer
-- (checked on prod 2026-11-15: 0 rows).
--
-- ROLLBACK: disable the auth hook first (auth config), then
--   drop function public.hook_before_user_created(jsonb);
--   restore handle_new_user() from 20260805120000 and current_user_role()
--     from 00003; drop the *_approved_gate policies listed in section 4;
--   drop the require_approved_writer triggers + function (section 5);
--   drop trigger profiles_unapproved_identity_freeze + its function;
--   restore list_users_for_admin() from 20260921220000.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Sign-up gate — Supabase Auth "before user created" hook
-- ------------------------------------------------------------
-- Called by Supabase Auth (role supabase_auth_admin) for every account that is
-- about to be created, whatever the path: OAuth, e-mail sign-up, invite.
-- Returning an `error` object rejects the request and no auth.users row is
-- written. invite-user upserts allowed_emails BEFORE it invites, so an invited
-- address always passes.
--
-- search_path is empty, so the citext `=` operator (schema public) is out of
-- reach: compare lower(text) explicitly instead of relying on it.
--
-- Being on the allowlist is not enough: the account must also come from
-- somebody who has shown they own the mailbox (red-team review 2026-11-15).
-- Otherwise anyone who knows an allowlisted, not-yet-joined address could
-- create the account with a password of their own; handle_new_user() approves
-- it at the allowlisted role, and the real owner only has to click the
-- confirmation mail they were expecting.
--   google           trusted unless the provider says email_verified = false
--   other OAuth      only with email_verified = true (Discord can report an
--                    unverified address)
--   email            only while an admin invite for that address is in flight
--                    (invite-user stamps allowed_emails.invite_started_at just
--                    before inviteUserByEmail and clears it right after, on
--                    success and on failure; the 2-minute limit only covers a
--                    function that died in between). The login page offers no
--                    password sign-up, so nothing reachable is lost; a direct
--                    POST /auth/v1/signup is what this closes.
alter table public.allowed_emails add column if not exists invite_started_at timestamptz;

comment on column public.allowed_emails.invite_started_at is
  'Stamped by the invite-user edge function right before it sends an invite mail and cleared right after. '
  'hook_before_user_created() lets an e-mail (password / invite) account be created only within 2 minutes of it.';

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email    text := lower(nullif(btrim(coalesce(event -> 'user' ->> 'email', '')), ''));
  v_provider text := lower(coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', ''));
  v_verified text := lower(coalesce(event -> 'user' -> 'user_metadata' ->> 'email_verified', ''));
  v_invite   timestamptz;
  v_listed   boolean := false;
begin
  if v_email is not null then
    select true, a.invite_started_at into v_listed, v_invite
      from public.allowed_emails a
     where lower(a.email::text) = v_email
     limit 1;

    if coalesce(v_listed, false) then
      if v_provider = 'google' and v_verified <> 'false' then
        return '{}'::jsonb;
      elsif v_provider = 'email' and v_invite is not null and v_invite > now() - interval '2 minutes' then
        return '{}'::jsonb;
      elsif v_provider not in ('google', 'email', '') and v_verified = 'true' then
        return '{}'::jsonb;
      end if;
    end if;

    -- Bootstrap: the founder of a database that has no admin yet (a fresh
    -- local stack). Matched by digest, the address is not in the repo.
    if not exists (select 1 from public.profiles p where p.role = 'admin')
       and encode(sha256(convert_to(v_email, 'UTF8')), 'hex')
           = 'd6deeeba4dcdf15e121a7a1b0ce98f1c4c0330cd77d272d86f254c49ad12d687' then
      return '{}'::jsonb;
    end if;
  end if;

  -- The message is a stable marker the web client matches on
  -- (src/app/auth): it is never shown to the user as is.
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'signup_not_allowed'
    )
  );
end;
$$;

comment on function public.hook_before_user_created(jsonb) is
  'Supabase Auth before-user-created hook: allows a new account only for an e-mail on allowed_emails '
  '(or the bootstrap founder while no admin exists). EXECUTE for supabase_auth_admin only: callable by '
  'a client it would be an "is this address invited?" oracle.';

-- Default privileges hand EXECUTE on every new function to anon,
-- authenticated and service_role. None of them may call this one.
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ------------------------------------------------------------
-- 2. handle_new_user() — bootstrap only while no admin exists
-- ------------------------------------------------------------
-- Body as in 20260805120000 except two things.
--   * Bootstrap predicate: before, the founder digest alone made a new account
--     an approved admin; had that account ever been removed, the next sign-up
--     with its address would have become one.
--   * Allowlist match: `a.email = new.email` compared citext with varchar,
--     which PostgreSQL resolves as text = text, i.e. case-SENSITIVE. An
--     allowlist row written with a capital letter never matched (dry run
--     2026-11-15). Compared in lower case now, like the hook above, so "may
--     sign up" and "is approved" cannot disagree.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_bootstrap boolean :=
    encode(sha256(convert_to(lower(new.email), 'UTF8')), 'hex')
      = 'd6deeeba4dcdf15e121a7a1b0ce98f1c4c0330cd77d272d86f254c49ad12d687'
    and not exists (select 1 from public.profiles p where p.role = 'admin');
  -- inviteUserByEmail stamps invited_at; open sign-ups leave it null.
  is_invited   boolean := new.invited_at is not null;
  allow_row    public.allowed_emails%rowtype;
  is_approved  boolean;
  assigned_role text;
begin
  select * into allow_row from public.allowed_emails a
   where lower(a.email::text) = lower(new.email);

  is_approved := is_bootstrap or is_invited or (allow_row.email is not null);
  assigned_role := case
    when is_bootstrap then 'admin'
    when allow_row.email is not null then allow_row.role
    else 'viewer'
  end;

  insert into public.profiles (id, display_name, role, is_approved)
  values (
    new.id,
    split_part(new.email, '@', 1),
    assigned_role,
    is_approved
  )
  on conflict (id) do nothing;

  if allow_row.email is not null then
    update public.allowed_emails
      set consumed_at = now()
      where email = allow_row.email and consumed_at is null;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3. current_user_role() — an unapproved or suspended account is a viewer
-- ------------------------------------------------------------
-- is_admin(), is_collaborator() and the release-ring clamps all read this.
-- The predicate is the one is_approved() uses (20260904020000): approved and
-- carrying no active suspension.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
             when p.is_approved
              and (p.suspended_at is null
                   or (p.suspended_until is not null and p.suspended_until <= now()))
             then p.role
             else 'viewer'
           end
    from public.profiles p
    where p.id = auth.uid()
  ), 'viewer');
$$;

comment on function public.current_user_role() is
  'Effective role of the caller: profiles.role for an approved account without an active suspension, '
  'else ''viewer''. is_admin() / is_collaborator() build on it, so approval is part of every role check.';

-- ------------------------------------------------------------
-- 4. RESTRICTIVE approval gate on the remaining self-scoped tables
-- ------------------------------------------------------------
-- Same shape as 20260805120000 / 20261101080000: ANDed on top of the owner
-- policies, which stay as they are. Public-read tables are not listed: an
-- unapproved session may read what an anonymous visitor may read.
do $$
declare
  t text;
begin
  foreach t in array array[
    'feedback_read_state',
    'hq_inventory_removals', 'hq_inventory_reservations', 'hq_inventory_stacks',
    'hq_item_marks', 'hq_supply_packages',
    'patch_prediction', 'patch_readiness',
    'search_wishlist', 'user_event_state', 'user_news_collected', 'user_spots',
    'verse_seen', 'verse_suggestions',
    'verse_constellation_guesses', 'verse_patch_version_tips', 'verse_star_progress'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'approved gate: table public.% does not exist', t;
    end if;
    execute format('drop policy if exists %I on public.%I;', t || '_approved_gate', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.is_approved()) with check (public.is_approved());',
      t || '_approved_gate', t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5. Writes through SECURITY DEFINER RPCs
-- ------------------------------------------------------------
-- verse_earn_star(), verse_submit_prediction(), verse_guess_constellation(),
-- verse_submit_version_prediction(), verse_submit_rank_idea() and
-- verse_vote_rank_idea() only ask for auth.uid(), and they write as the
-- function owner, past RLS. A trigger sees the write whatever issued it, and
-- it survives a later `create or replace` of any of those functions.
--
-- auth.uid() is null for the service role, pg_cron and migrations, which pass.
-- INSERT/UPDATE only: deletes (account removal cascades) are never blocked.
create or replace function public.require_approved_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_approved() then
    raise exception 'not approved' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.require_approved_writer() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'verse_star_progress', 'patch_prediction', 'verse_constellation_guesses',
    'verse_patch_version_tips', 'verse_rank_reward_ideas', 'verse_rank_reward_idea_votes'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'approved writer: table public.% does not exist', t;
    end if;
    execute format('drop trigger if exists %I on public.%I;', t || '_approved_writer', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.require_approved_writer();',
      t || '_approved_writer', t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6. An unapproved account cannot name itself
-- ------------------------------------------------------------
-- profiles_self_update (00001) has no column list. username is the public
-- handle (unique, so it can be squatted), display_name is what an admin reads
-- in the people list. The service role and admin RPCs acting on somebody
-- else's row are not the row's own session and pass.
create or replace function public.profiles_unapproved_identity_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.id
     and not old.is_approved
     and (new.username     is distinct from old.username
       or new.display_name is distinct from old.display_name
       or new.rsi_handle   is distinct from old.rsi_handle) then
    raise exception 'not approved: an unapproved account cannot change its name or handle'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_unapproved_identity_freeze() from public, anon, authenticated;

drop trigger if exists profiles_unapproved_identity_freeze on public.profiles;
create trigger profiles_unapproved_identity_freeze
  before update on public.profiles
  for each row execute function public.profiles_unapproved_identity_freeze();

-- ------------------------------------------------------------
-- 7. list_users_for_admin() — say who is not approved
-- ------------------------------------------------------------
-- RETURNS TABLE grows by two columns, so the function is dropped and
-- re-created (as in 20260921220000). Body unchanged otherwise. Old clients
-- ignore the new columns; the new client treats a missing is_approved as true.
drop function if exists public.list_users_for_admin();

create function public.list_users_for_admin()
returns table (
  id                uuid,
  email             text,
  display_name      text,
  username          citext,
  role              text,
  protected         boolean,
  report_count      bigint,
  suspended         boolean,
  suspended_at      timestamptz,
  suspended_until   timestamptz,
  suspension_reason text,
  created_at        timestamptz,
  last_sign_in_at   timestamptz,
  last_seen_at      timestamptz,
  is_approved       boolean,
  approved_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    u.email,
    p.display_name,
    p.username,
    p.role,
    exists (select 1 from public.protected_admins pa where pa.user_id = p.id) as protected,
    (select count(*) from public.user_reports r where r.target_id = p.id and r.status = 'open') as report_count,
    (p.suspended_at is not null and (p.suspended_until is null or p.suspended_until > now())) as suspended,
    p.suspended_at,
    p.suspended_until,
    p.suspension_reason,
    p.created_at,
    u.last_sign_in_at,
    -- greatest() skips NULLs: an account that never signed in since the
    -- column exists still shows its last sign-in, and vice versa.
    greatest(u.last_sign_in_at, p.last_seen_at) as last_seen_at,
    p.is_approved,
    p.approved_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by
    case p.role when 'admin' then 0 when 'collaborator' then 1 else 2 end,
    p.created_at desc
$$;

revoke all on function public.list_users_for_admin() from public, anon;
grant execute on function public.list_users_for_admin() to authenticated;

-- PostgREST caches function signatures; without this the changed RETURNS
-- TABLE answers PGRST202 until the next restart.
notify pgrst, 'reload schema';
