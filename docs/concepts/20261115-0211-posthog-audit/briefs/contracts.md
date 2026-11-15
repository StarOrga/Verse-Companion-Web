# Contracts between the implement agents (fixed before wave 1)

All three wave-1 agents and every later agent build against these. Change one only by reporting it back — never silently.

## 1. Server-side PostHog helper — `supabase/functions/_shared/posthog.ts` (owner: core-A)

Pure-ish Deno module, no SDK, EU ingest host `https://eu.i.posthog.com`. Project token from env `POSTHOG_PROJECT_TOKEN` (public ingest key, same value as `environment.prod.ts` → `posthog.key`; fall back to that literal when the env is unset). Never throws; a failed send is logged and swallowed.

```ts
export function serverDistinctId(fn: string): string;            // 'server:<fn>'
export async function captureServer(event: string, props: Record<string, unknown>, opts?: { fn?: string; distinctId?: string; timestamp?: string }): Promise<void>;
export async function captureBatch(events: { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp?: string }[]): Promise<void>;
export async function captureServerException(fn: string, err: unknown, extra?: Record<string, unknown>): Promise<void>; // $exception with $exception_list, redacted like the web's redactErrorText
export async function captureAiGeneration(g: { fn: string; model: string; provider?: 'anthropic' | 'openai' | 'xai'; inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; latencyMs: number; ok: boolean; status?: number; error?: string; traceId?: string }): Promise<void>; // $ai_generation, metadata only, never prompt/output text
export function withPosthog(fn: string, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>; // reports thrown errors and 5xx as $exception, rethrows/returns unchanged
```
Every server event sets `$process_person_profile: false`, `source: 'server'`, `function: <fn>`, `release`/`app_version` when known.

## 2. Claude call ledger — table `public.ai_calls` (owner: core-A)

`id bigserial, at timestamptz default now(), function text, model text, provider text, input_tokens int, output_tokens int, cache_read_tokens int, cache_write_tokens int, cost_usd numeric(12,6), latency_ms int, ok boolean, status int, error text, probe boolean default false`. RLS on, no client policies (service role writes, admin reads via the overview function). Helper in `_shared/ai-ledger.ts`: `recordAiCall(row)` writes the row AND calls `captureAiGeneration`. Every Claude call site (7 functions + translate-orchestrator) goes through one wrapper `callClaude()` or calls `recordAiCall` after its fetch.

## 3. Service health — table `public.service_health` (owner: core-B)

`service text primary key, level text check (level in ('ok','warn','error','unknown')), error_rate numeric, last_ok_at timestamptz, last_check_at timestamptz, expected_every interval, consecutive_failures int, note text, updated_at timestamptz`. Services: `claude`, `posthog`, `supabase`, `r2`, `uex`, `rsi`, `xai`, `readme`. Rules (d-thresh): ok = last success within rhythm and 24 h error rate < 10 %; warn = 10–50 % or rhythm exceeded 2×; error = last 3 attempts failed or key missing.

## 4. Admin board origin (owner: core-B)

`admin_feedback` gains `origin text not null default 'human' check (origin in ('human','posthog','service'))` and `external_ref text` (PostHog issue id / service name, unique per open item for dedupe). A system profile „PostHog-Wächter“ (fixed uuid, constant in `_shared/posthog-guard.ts` and in `src/app/feedback/feedback.types.ts` as `POSTHOG_GUARD_PROFILE_ID`) authors machine items. Items with origin ≠ human start as `open` but the routine only diagnoses them and sets `needs_input` (doc change, owner: docs agent).

## 5. Admin overview endpoint — Edge Function `telemetry-overview` (owner: core-B, consumer: frontend-C)

`GET /functions/v1/telemetry-overview` with the admin's session JWT (verify admin via `is_admin()` RPC or profiles role). Cached server-side for 5 min. `POST` with `{ "seen": true }` stores the admin's last visit (table `admin_telemetry_seen(user_id uuid pk, seen_at timestamptz)`). Response:

```ts
type Level = 'ok' | 'warn' | 'error' | 'unknown';
interface TopItem { label: string; value?: string; badge?: 'web' | 'server' | 'desktop'; level?: Level; url?: string;
  feedback?: { title: string; body: string } }          // prefilled composer text incl. PostHog link (r2-convert)
interface Card {
  id: 'quota' | 'errors' | 'services' | 'usage' | 'ai' | 'desktop';
  level: Level;
  kpi: { value: number | null; display: string; unitKey: string };   // unitKey = i18n key suffix
  delta?: { value: number; unit: 'pct' | 'abs' | 'pt'; better: 'up' | 'down' };
  forecast?: { display: string; pct?: number };
  spark?: number[];                                     // 7 points, usage card only
  bar?: { pct: number; monthPct: number };              // quota card
  top: TopItem[];                                       // max 3
  links: { labelKey: string; url: string }[];           // PostHog deep links, first = primary
  feedbackCta?: { title: string; body: string };        // quota card: „Sparvorschlag als Feedback“
  upgradeUrl?: string;                                  // quota card
  boardWaiting?: number;                                // errors card: machine items waiting
  calmKey?: string;                                     // shown when level ok and top empty
}
interface Overview {
  generatedAt: string; lastVisitAt: string | null;
  posthogReachable: boolean;                            // false → page shows „Daten nicht verfügbar“, never all-green
  attention: number;                                    // cards with level warn|error
  cards: Card[];                                        // sorted: error, warn, ok, unknown
  quotas: { product: 'events' | 'exceptions' | 'replay' | 'llm' | 'flags'; usage: number; limit: number; pct: number; forecastPct: number }[];
}
```

Data sources: PostHog billing API (`billing:read`) for quotas; HogQL query API (`query:read`) for errors (new issues since last visit by source), usage (7-day actives + delta + spark + three movers), desktop (installs by product/version from forwarded events); `ai_calls` for AI cost (month to date + linear forecast + top 3 functions); `service_health` for services. Without `POSTHOG_PERSONAL_API_KEY` the PostHog-backed cards come back `level: 'unknown'` with `posthogReachable: false`, the rest still works.

## 6. Analytics client API (owner: frontend-A, consumer: frontend-B)

`AnalyticsService.track<E extends EventName>(event: E, props: EventProps[E])` with the typed catalogue in `src/app/core/analytics/events.ts` (`category:object_action`). `capture()` stays private/internal. A prebuild guard (`scripts/check-analytics-events.mjs`) fails on `.capture('` outside `src/app/core/analytics*`, on unknown names and on duplicates. `npm run analytics:sync` pushes descriptions to PostHog event definitions (needs the personal key; no-op with a clear message without it).
