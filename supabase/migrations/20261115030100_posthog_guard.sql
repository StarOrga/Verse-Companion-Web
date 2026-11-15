-- PostHog guard (concept 20261115-0211-posthog-audit, contracts §3-§5).
--
-- WHAT THIS CREATES
--   admin_feedback.origin / external_ref   machine items on the admin board (origin 'posthog' | 'service'),
--                                          one OPEN item per external_ref (partial unique index = dedupe, H5).
--   service_health                         one row per external service (claude, posthog, supabase, r2, uex, rsi,
--                                          xai, readme), written hourly by the service-health function (I2/I4/I5).
--   admin_telemetry_seen                   an admin's last visit of the telemetry page ("seit deinem letzten Besuch").
--   guard_runs                             last run per cron mode - throttles the verify_jwt=false cron endpoints.
--   cron jobs                              posthog-signal trends 06:30 UTC daily, quota every 6 h, service-health hourly.
--
-- AUTHOR "PostHog-Wächter": a public.profiles row needs an auth.users row (profiles.id references auth.users), and
-- fabricating an auth user for a machine would show it in the user list / invite flows. So machine items are stored
-- with author_id = NULL and origin <> 'human'; the board shows them under the fixed identity
-- POSTHOG_GUARD_PROFILE_ID (supabase/functions/_shared/posthog-guard.ts, mirrored in the frontend types).
--
-- Idempotent (if not exists / drop-if-exists). pg_cron is already installed (20261016120000) - NOT created again (2BP01).
-- ROLLBACK: select cron.unschedule('posthog-signal-trends'); select cron.unschedule('posthog-signal-quota');
--           select cron.unschedule('service-health'); drop the tables; alter table admin_feedback drop column origin, external_ref.

-- ------------------------------------------------------------ board origin
alter table public.admin_feedback
  add column if not exists origin text not null default 'human',
  add column if not exists external_ref text;

alter table public.admin_feedback drop constraint if exists admin_feedback_origin_check;
alter table public.admin_feedback
  add constraint admin_feedback_origin_check check (origin in ('human', 'posthog', 'service'));

comment on column public.admin_feedback.origin is
  'human = an admin wrote it; posthog / service = machine item from the PostHog guard. The routine only diagnoses '
  'machine items and parks them as needs_input.';
comment on column public.admin_feedback.external_ref is
  'Dedupe key of a machine item (PostHog issue id, service name, quota:<product>:<period>, summary:<day>). '
  'At most one open item per ref.';

create unique index if not exists admin_feedback_external_ref_open_uidx
  on public.admin_feedback (external_ref)
  where external_ref is not null and status in ('open', 'in_progress', 'needs_input');

-- the daily cap counts today's machine items
create index if not exists admin_feedback_origin_created_idx
  on public.admin_feedback (created_at) where origin <> 'human';

-- ------------------------------------------------------------ service health (§3)
create table if not exists public.service_health (
  service              text primary key,
  level                text not null default 'unknown' check (level in ('ok', 'warn', 'error', 'unknown')),
  error_rate           numeric,
  last_ok_at           timestamptz,
  last_check_at        timestamptz,
  expected_every       interval not null default interval '1 hour',
  consecutive_failures int not null default 0,
  note                 text,
  updated_at           timestamptz not null default now()
);
comment on table public.service_health is
  'Status of the external services, written by the service-health function (hourly free probes + passive ai_calls rate). '
  'Service role writes; admins read through telemetry-overview.';
alter table public.service_health enable row level security;

insert into public.service_health (service, expected_every) values
  ('claude', interval '1 hour'), ('posthog', interval '1 hour'), ('supabase', interval '1 hour'), ('r2', interval '1 hour'),
  ('uex', interval '1 hour'), ('rsi', interval '1 hour'), ('xai', interval '1 hour'), ('readme', interval '1 hour')
on conflict (service) do nothing;

-- ------------------------------------------------------------ last visit (§5)
create table if not exists public.admin_telemetry_seen (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);
comment on table public.admin_telemetry_seen is
  'Last visit of an admin on the telemetry page; written by telemetry-overview (service role).';
alter table public.admin_telemetry_seen enable row level security;

-- ------------------------------------------------------------ cron throttle
create table if not exists public.guard_runs (
  mode        text primary key,
  last_run_at timestamptz not null default now()
);
comment on table public.guard_runs is
  'Last run per guard mode (trends, quota, health). The cron endpoints have verify_jwt=false and are throttled by it.';
alter table public.guard_runs enable row level security;

-- ------------------------------------------------------------ cron
do $$
declare j text;
begin
  foreach j in array array['posthog-signal-trends', 'posthog-signal-quota', 'service-health'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

select cron.schedule('posthog-signal-trends', '30 6 * * *', $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/posthog-signal',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{"mode":"trends"}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);

select cron.schedule('posthog-signal-quota', '7 */6 * * *', $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/posthog-signal',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{"mode":"quota"}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);

select cron.schedule('service-health', '13 * * * *', $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/service-health',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
