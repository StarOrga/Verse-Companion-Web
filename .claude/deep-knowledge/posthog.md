# PostHog — the single source for telemetry

Since the PostHog audit (concept `docs/concepts/20261115-0211-posthog-audit/`) everything the product measures goes
to ONE place: PostHog EU (`eu.posthog.com`). The admin telemetry page only mirrors a few findings back (top 3 per
card + deep links); browsing, funnels and error triage happen in PostHog. Own telemetry tables are gone
(`telemetry_events`, `get_telemetry_stats`).

## What PostHog holds

| Source | Sent when | Identity | Content |
|---|---|---|---|
| **Web** (`AnalyticsService`) | only with statistics consent | pseudonymous person; signed-in users with consent: salted hash of the account id + person property `role` | catalogue events, `$pageview`, `$exception`, `$web_vitals`, replay of sessions with an error (inputs masked), dead clicks, heatmaps. Browser traffic goes through `/ingest` on the app domain (Vercel rewrite) |
| **Server** (Edge Functions, `_shared/posthog.ts`) | always, no consent needed | `server:<function>`, `$process_person_profile: false` | `$exception` (failures, 5xx), `server:cron_run_finish` (every pg_cron run: `ok`, `duration_ms`), `$ai_generation` (Claude call metadata: model, tokens, cost, latency, error — never prompt or output) |
| **Desktop** (`ingest-telemetry` forwards, HMAC check kept) | always, no consent needed | hashed install id, no person profile | `desktop:usage_metric`, `desktop:extract_abort`, `desktop:job_diagnostics_report` (log = R2 ref `r2://…` + size, 30 days), `$exception` for crashes |

Every event carries `app_version` / `release`; production source maps are uploaded at build time
(`scripts/posthog-sourcemaps.mjs`, release = app version) so stack traces are readable.

**Never sent:** e-mail, name, user id in clear, IP-derived data on server/desktop events, free text typed by a user,
search terms, prompts or model output, tokens/secrets, URLs with query strings, log content (only the R2 reference).

## Naming

`category:object_action`, present tense, snake_case — typed in `src/app/core/analytics/events.ts` (the only list; the
prebuild guard `check:analytics-events` refuses raw `capture('…')`). Rules and "add an event":
`docs/analytics/event-naming.md`. Old names are bridged by PostHog actions (`Bridge: <new name>`, generated from
`LEGACY_EVENT_NAMES`).

## The three dashboards (as code: `posthog/dashboards.json`)

Applied with `npm run posthog:apply` (idempotent by name; plan/replay: `docs/analytics/posthog-setup.md`). About 30 % simple
reports, 70 % cross-flow (funnels, retention, paths, lifecycle, stickiness). Everything captured is reachable from them;
the per-area table on „Wird es genutzt?“ lists every catalogue event by `category`.

| Dashboard | Answers | Tiles (examples) |
|---|---|---|
| **Läuft es?** | Is something broken? | errors by source (web/server/desktop), new error issues, cron failures per function, server errors per function (service health), LCP/INP p75, desktop crash rate, error → return/paths/lifecycle |
| **Wird es genutzt?** | Who uses what, do they come back? | DAU/WAU, events per area, the seven flows as funnels (`posthog/flows.json`: onboard, codex, error, hangar, feedback, desktop, verse), retention, lifecycle, stickiness, paths |
| **Was kostet es?** | What does it cost / use up? | `$ai_generation` cost by function and model, tokens, error rate and latency p95, event volume by event (quota optimisation), replay count |

## Ask PostHog first (analysis and diagnosis)

- **MCP:** `.mcp.json` has the `posthog` server (`https://mcp-eu.posthog.com/mcp`, bearer from env
  `POSTHOG_PERSONAL_API_KEY`, same pattern as Supabase). Without the variable the tools stay unavailable — say so, do not guess.
- **HogQL** (via the MCP query tool or the Query API `POST /api/environments/@current/query/`):

```sql
-- top errors, last 7 days
select toString(properties.$exception_issue_id) issue, any(toString(properties.$exception_types)) type,
       any(toString(properties.source)) source, count() hits
from events where event = '$exception' and timestamp >= now() - interval 7 day
group by issue order by hits desc limit 10

-- conversion of a two-step flow within 14 days (people at step 1 vs. step 2)
select countIf(level >= 1) step1, countIf(level >= 2) step2 from (
  select person_id, windowFunnel(1209600)(timestamp, event = 'auth:access_request', event = 'auth:user_sign_in') level
  from events where timestamp >= now() - interval 30 day group by person_id)

-- AI cost by function, month to date
select toString(properties.function) fn, round(sum(toFloat(properties.$ai_total_cost_usd)), 2) usd,
       count() calls, countIf(properties.$ai_is_error = true) errors
from events where event = '$ai_generation' and timestamp >= toStartOfMonth(now())
group by fn order by usd desc
```

Funnels are easier to read in the saved insights („Wird es genutzt?“ → `Flow …`); use HogQL for one-off questions.
Server and desktop events have no person: count them by `distinct_id` / `properties.function` / `properties.product`.

## Quotas and the saver flag

Free-tier limits per product: events, exceptions, replay, LLM events, flag requests. The admin telemetry page shows
usage vs. limit (PostHog billing API, `billing:read`), warns from 80 % or a linear forecast above 100 %, and offers two CTAs:
„Sparvorschlag als Feedback“ and „Plan in PostHog ↗“. At a forecast ≥ 95 % `posthog-signal` (mode `quota`, cron every 6 h)
switches the feature flag `telemetry-saver` on: the client then pauses session replay and heatmaps; errors and catalogue
events are never paused. The flag is created inactive by `posthog:apply`; the client reads it only with consent.
Feature flags are NOT used for admin/collaborator UI (browser-evaluated, consent-gated, flippable in DevTools) — roles stay RLS + route guards.

## The guard (`posthog-signal`, `service-health`)

- `posthog-signal` modes: **webhook** (PostHog error-tracking alert → header `x-signal-secret` = `POSTHOG_SIGNAL_SECRET`),
  **trends** (daily 06:30 UTC: LCP p75 +25 %, login funnel −10 pt, new error groups), **quota** (every 6 h).
  `service-health` probes `claude, posthog, supabase, r2, uex, rsi, xai, readme` hourly (green < 10 % errors and in rhythm,
  yellow 10–50 % or rhythm ×2, red last 3 failed / key missing).
- Findings land on the admin board as `admin_feedback` rows with `origin` ('posthog' | 'service'), author „PostHog-Wächter“,
  `external_ref` = PostHog issue id / service name (same issue = one item, repeats are thread replies). **Cap 3 new items per
  UTC day**, overflow goes into one summary item. Recovery closes service items.
- **needs_input flow:** the feedback routine (`docs/routine/tasks/scc-feedback-headless/SKILL.md`, rule b0) only DIAGNOSES such
  items — reads the PostHog link via MCP, finds the code cause, posts problem + link + solution proposal, sets `needs_input`.
  It builds only after a human admin answered approving it.

## Secrets (never in the repo or the bundle)

| Secret | Where | Used by |
|---|---|---|
| `POSTHOG_PERSONAL_API_KEY` | Supabase secret; local env for MCP / `posthog:apply` / `analytics:sync` | `telemetry-overview`, `posthog-signal`, `service-health` (read scopes + `billing:read`, `feature_flag:write`) |
| `POSTHOG_SIGNAL_SECRET` | Supabase secret + PostHog webhook header | `posthog-signal` webhook |
| `POSTHOG_PROJECT_TOKEN` (public ingest key) | Supabase secret, falls back to the key in `environment.prod.ts` | server/desktop capture |
| `POSTHOG_PROJECT_ID` (optional) | Supabase secret | skips the project lookup |
| `POSTHOG_CLI_TOKEN`, `POSTHOG_CLI_ENV_ID` | Vercel env | source-map upload in `scripts/vercel-build.sh` |
| `R2_*` | Supabase secrets | diagnostic logs (`diag/`, presigned 24 h for admins) |

Owner steps (keys cannot be created by Claude): `docs/analytics/posthog-setup.md`.
