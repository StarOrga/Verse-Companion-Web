# Analytics event naming

Every product event the web app sends to PostHog is declared once in
[`src/app/core/analytics/events.ts`](../../src/app/core/analytics/events.ts) and
sent through `AnalyticsService.track()`. Nothing else may call PostHog's
`capture` (the prebuild guard `scripts/check-analytics-events.mjs` fails the
build on it).

## Name: `category:object_action`

- **category** — the product area, one of `app`, `auth`, `codex`, `hangar`, `hq`,
  `verse`, `news`, `social`, `search`, `settings`, `feedback`, `desktop`, `admin`.
  It is the entry's `area` and must match.
- **object_action** — snake_case; the object first, then a **present-tense verb**
  from this fixed list (the guard checks it):
  `view`, `open`, `close`, `create`, `add`, `remove`, `update`, `change`, `submit`,
  `send`, `start`, `finish`, `fail`, `share`, `search`, `select`, `toggle`,
  `import`, `export`, `earn`, `request`, `sign_in`, `sign_out`, `show`.
  Never past tense (`ship_added`), never the verb first.
- Examples: `hangar:ship_add`, `auth:user_sign_in`, `codex:ship_link_create`,
  `app:error_show`, `verse:star_earn`.
- One thing, one name: a second event for the same user action is a duplicate —
  put the difference into a property (`provider`, `source`, `channel`), not into
  the name.
- Built-in PostHog events (`$pageview`, `$exception`, `$autocapture`-style
  `$…`) keep their names and are not in the catalogue.

## Properties

- snake_case keys (existing legacy keys such as `shipSlug` stay until renamed
  with the event), values are strings from a small set, numbers or booleans.
- **No personal data, ever**: no e-mail, name, user id, free text typed by a
  user, search terms, tokens or URLs with query strings. Keys, kinds, counts,
  positions and ids of public game data only. `track()` sends nothing without
  statistics consent.
- Super properties added by the service on every event: `app_version`, `release`,
  the UTM trio of the landing page, and — for signed-in users with consent — the
  person property `role` (viewer / collaborator / admin).

## Add an event

1. Add a line to `EVENTS` in `events.ts`:
   `'area:object_verb': ev<{ some_prop: string }>('area', 'Eine Zeile Deutsch: was ist passiert.')`
   (no props → `ev('area', '…')`).
2. Call `analytics.track('area:object_verb', { some_prop: '…' })` where the user
   acts — at the point the action **succeeded**.
3. `npm run check:analytics-events` (also part of `npm run build`) and
   `npm run typecheck` must be green.
4. After the first event reached PostHog: `npm run analytics:sync` (needs
   `POSTHOG_PERSONAL_API_KEY`, scope `event_definition:write`) pushes description,
   tag (= area) and `verified` to the PostHog event definitions.

## Renames and history

`LEGACY_EVENT_NAMES` in `events.ts` maps every old event name to its new one
(`hangar_ship_added` → `hangar:ship_add`, …). Old events keep their history in
PostHog under the old name; PostHog **actions** bridge old and new so one insight
covers both. When you rename an event, add the old name to that map.

## Quota

`telemetry-saver` (PostHog feature flag, set by the admin telemetry page near the
free quota) pauses session replay and heatmaps in the client. Errors
(`$exception`) and the catalogue events are never paused.
