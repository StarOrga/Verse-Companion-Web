-- Drop the xAI (Grok) service (admin feedback #356).
--
-- The product never calls xAI: GROK_API_KEY was only a dead fallback in sc-events-sync (Claude, then OpenAI, stay) and
-- an hourly service-health probe that kept filing "Dienst xai ist ausgefallen" (HTTP 403, no credits). The code paths
-- are gone; this removes the data trace.
--
-- DROPS
--   public.service_health row service = 'xai' (seeded by 20261115030100_posthog_guard.sql; there is no check constraint
--   or enum on service, so nothing else to alter). ai_calls.provider has no check constraint and held no 'xai' rows.
--   The open machine board item (external_ref 'xai') stays; the routine closes it.
--
-- ROLLBACK: insert into public.service_health (service, expected_every) values ('xai', interval '1 hour');
-- After the merge: supabase secrets unset GROK_API_KEY.

delete from public.service_health where service = 'xai';
