# PostHog setup — owner checklist

Everything below needs an account owner: Claude cannot create PostHog keys. Background:
[`.claude/deep-knowledge/posthog.md`](../../.claude/deep-knowledge/posthog.md), event names:
[`event-naming.md`](event-naming.md).

## 1. Personal API key

PostHog → Settings → Personal API keys → create with these scopes:
`query:read`, `error_tracking:read`, `billing:read`, `feature_flag:write`, `insight:write`, `dashboard:write`,
`action:write`, `event_definition:write`, `project:read`.

Use it as:
- Supabase secret `POSTHOG_PERSONAL_API_KEY` (`supabase secrets set POSTHOG_PERSONAL_API_KEY=phx_…`) — admin overview,
  guard, service probes.
- Local env `POSTHOG_PERSONAL_API_KEY` — for `npm run posthog:apply`, `npm run analytics:sync` and the PostHog MCP
  server in `.mcp.json` (EU host `https://mcp-eu.posthog.com/mcp`).

## 2. Secrets and env

| Where | Name | Value |
|---|---|---|
| Supabase secrets | `POSTHOG_SIGNAL_SECRET` | a long random string (also used as the webhook header below) |
| Supabase secrets | `POSTHOG_PERSONAL_API_KEY` | the key from step 1 |
| Vercel env (Production + Preview) | `POSTHOG_CLI_TOKEN` | a PostHog personal API key with `error_tracking:write` (source-map upload; may be the same key plus that scope) |
| Vercel env | `POSTHOG_CLI_ENV_ID` | the PostHog environment id (Settings → Project → ID) |
| GitHub | nothing | CI does not talk to PostHog; the source-map upload happens in the Vercel build |

Without the Vercel pair the build logs `posthog-sourcemaps: … not set` and ships without uploading (errors stay minified).
The `.map` files never reach users either way: they are hidden in the build and deleted from `dist` before Vercel serves it.

## 3. PostHog project settings

1. **Session replay** on, recording condition: only sessions with an error (the app sets this; `onerror`), inputs masked.
2. **Error tracking → Alerts:** destination *Webhook* for "issue created" and "issue reopened":
   URL `https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/posthog-signal`, header `x-signal-secret: <POSTHOG_SIGNAL_SECRET>`,
   body `{"issue_id": "{event.properties.$exception_issue_id}", "title": "{event.properties.$exception_types} {event.properties.$exception_values}", "kind": "{event.event}", "url": "{event.url}"}`.
3. **Web vitals** autocapture on (Settings → Web vitals).

## 4. Cloudflare R2

Lifecycle rule on the bucket `sc-companion-assets`: delete objects with prefix `diag/` after **30 days**
(belt to the application purge in `ingest-telemetry`). The assets Worker does not serve `diag/`; admins get presigned 24 h links.

## 5. Create the dashboards, flows and actions

```
npm run posthog:apply -- --dry-run     # print the plan (no network)
npm run posthog:apply                  # needs POSTHOG_PERSONAL_API_KEY
npm run analytics:sync                 # event descriptions, after the first event of each name has arrived
```

`posthog:apply` is idempotent by name (dashboards, insights, actions; feature flags by key): it looks the object up and PATCHes,
else POSTs. It creates the three dashboards from `posthog/dashboards.json` (`Läuft es?`, `Wird es genutzt?`, `Was kostet es?`),
the seven flow funnels from `posthog/flows.json` (a missing file only skips those tiles), the workflow actions from
`posthog/actions.json`, one `Bridge: <new name>` action per renamed event (from `LEGACY_EVENT_NAMES`) and the feature flag
`telemetry-saver` (inactive). Edit the JSON, re-run — nothing is duplicated; renaming a tile creates a new one (delete the old
one in PostHog).

### Replay the plan from a logged-in browser tab (no API key)

`buildPlan` is a pure function (`scripts/lib/posthog-plan.mjs`, re-exported by `scripts/posthog-apply.mjs`):

```js
buildPlan(spec, existing = {}) // → [{ method, path, body, kind, name, ref, id? }]
```

`spec` = `{ dashboards, feature_flags, flows, actions, legacy }` (`loadSpec()` in `posthog-apply.mjs` assembles it).
`existing` = `{ dashboards, insights, actions, feature_flags }` as `name → id` maps (`fetchExisting(send)`; omit for "all POST").
Bodies hold `$ref:dashboard:<name>` placeholders that `executePlan(plan, send)` fills from earlier responses.
`node scripts/posthog-apply.mjs --emit-plan` prints the plan as JSON. In a browser tab on `https://eu.posthog.com`
the transport is:

```js
const csrf = document.cookie.match(/posthog_csrftoken=([^;]+)/)?.[1];
const send = async ({ method, path, body }) => {
  const r = await fetch(path, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
```

(paths are relative: `/api/environments/@current/…` and `/api/projects/@current/…`, the tab's own origin.)

## 6. Check

- Three dashboards exist, each tile loads (a HogQL tile on an event that has not arrived yet is simply empty).
- Admin → Telemetrie shows the six cards; "Daten nicht verfügbar" means the Supabase secret is missing.
- `telemetry-saver` is listed in Feature flags, inactive.
