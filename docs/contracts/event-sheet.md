# Event data sheet (contract)

Contract version: 1 (2026-11-08). Concept: `docs/concepts/20261108-1130-hq-events-nachschub/`.

One JSON sheet per event describes what the event asks, what it gives and where it applies. Owner rule: **the
mechanism is flexible** - nothing is locked to today's events. Every value may be `unknown`, every list is open.

## Single source of truth

`supabase/functions/_shared/event-sheet.ts` - pure TypeScript with no imports, usable by the Deno edge functions
(`import ... from '../_shared/event-sheet.ts'`), by `node --test` and by the web client, which re-exports it from
`src/app/hq/events/event-sheet.ts`. Do not copy the types; import them. Tests:
`supabase/functions/_shared/event-sheet.test.mjs` (node) and `src/app/hq/events/event-sheet.spec.ts` (Vitest).

## Shape

```jsonc
{
  "schema": 1,                       // EVENT_SHEET_SCHEMA; also sc_events.sheet_schema
  "fields": {
    "venues":        F<string[]>,    // open slugs; suggestions: verse, arena-commander, star-marine, website, twitch, unknown
    "area":          F<{kind, systems[], places[]}>,   // kind open; suggestions: none, system, places, any
    "tasks":         F<{id, label, trackId|null}[]>,
    "progress":      F<{model, tracks:[{id,label,unit|null,tiers:[{at,label,rewardIds[]}]}]}>, // model open: none, once, tiers, daily, group, community
    "rewards":       F<{id,name,className|null,variant|null,channel,timing:{kind,date|null},trackId|null,tier|null}[]>,
    "prerequisites": F<PrereqNode>,  // gear AND/OR tree, see below
    "start":         F<string>,      // ISO date or instant
    "end":           F<string>
  }
}
// F<T> = { "value": T | null, "confidence": 0..1, "source": slug, "review": "auto"|"pending"|"approved"|"edited"|"rejected" }
```

- `value: null` is **unknown**. A malformed value is normalised to unknown (`normalizeSheet` never throws).
- Ids (`venues`, `area.kind`, `progress.model`, gear, track/reward ids) are lowercase slugs
  (`[a-z0-9-]`); unknown slugs are **kept**, not rejected.
- A venue is independent of the area: an event can list `["verse","arena-commander"]` with an area of its own. Arena
  Commander is matched by the VC-App mode, not by place (`isInEventArea`).
- `rewards[].channel`: `pledge | ingame | both | unknown`. `timing.kind`: `immediate | after-end | date | unknown`
  (`after-end` rewards show as "wartet auf Verteilung" until ticked). `className` is the exact Codex class_name of what
  is delivered; wishlist dedupe compares exactly this value (never the base item).
- `prerequisites` (C4) is an estimate of the gear needed: `{op:"and"|"or", items:[...]}` or a leaf
  `{gear, label|null}`. Gear ids are open (suggestions: `fps-combat-set`, `combat-ship`, `salvage-ship`, ...). The
  normaliser **drops** patch / alpha / game package / edition / account entries (`isForbiddenGear`); a group of one
  collapses to its member, empty groups vanish. **"No gear needed" is the leaf `{gear:"none"}`** (`noPrerequisites`,
  `isNoPrereq`; only as the whole tree, dropped inside a group). Owner rule (#364): prerequisites nothing was found for
  read "none", never unknown - the extractor fills it (`defaultPrerequisites`, source `default`, 0.8 = released) and a
  default never displaces a found value in `mergeSheets`.

## Review (C3)

- Extraction output goes through `gateSheet`: every machine field with `confidence < 0.8` (`SHEET_CONFIDENCE_MIN`) and
  review `auto` becomes `pending`.
- The **public** sheet (`sc_events.sheet`, readable by every signed-in user) has `pending` and `rejected` fields
  blanked (`publicSheet`; the SQL function does the same). The **full** sheet is `sc_event_sheet_drafts` (admin-only).
- Admin: `setByAdmin` (confidence 1, source `admin`, review `edited`), `approveField` (review `approved`).
- Every write goes through `sc_event_sheet_apply(p_event_id text, p_sheet jsonb, p_actor_kind 'ai'|'admin', p_actor_id text)`
  (service role or admin): stores draft + public sheet + one row in `sc_event_sheet_history` (admin-only read).

## Related tables (migrations `20261108190000`, `20261108190100`)

`user_event_state` (per user, see `docs/contracts/scc-app-event-progress.md`), `hq_supply_packages.type/event_id`,
`hq_einsaetze.event_id/area`, `hq_einsatz_steps.kind='event'/event_id/area`, `hq_inventory_items.origin`.

## End chain (C5)

`resolveEventEnd`: official end (sheet `end`, else `sc_events.end_date` when `date_status='confirmed'`) > estimated next
patch (caller passes `computeNextPatch(...).atIso`) labelled as an estimate > unknown. An extension just changes the
official end. An estimate never closes an event or archives its Nachschub; only an official end in the past does.

## Extraction (C2/C3) - edge function `sc-event-sheet`

`supabase/functions/sc-event-sheet/` (pure logic in `_extract.ts`, handler in `index.ts`, recorded events in
`fixtures/`, tests `extract.test.mjs`). pg_cron `sc-event-sheet` (every 6 h at :37) posts `{}`; the function picks the
events that need a pass: new related comm-link, running event once a day (20 h), upcoming event (<= 21 days) every 3
days, one last pass up to 3 days after the end, and - backfill (#364) - every event never read by the current extractor
major (any upcoming one, past ones up to 400 days after their end), ranked after those. At most 4 LLM calls per run, in
parallel (sequential calls do not fit the 150 s wall clock); none when the source text is unchanged (hash kept in the
history row's `actor_id = sc-event-sheet:<major>:<hash>`; a v1 id `sc-event-sheet:<hash>` counts as major 1, so a major
bump re-reads every sheet). `POST {eventId, force?}` re-extracts one event; `POST {backfill: true}` is one automatic pass
without the 10-min throttle and answers `due` (events still waiting) - the admin page's "Fehlende auswerten" loops it.
Both: service-role key or admin only.

Sources (each best-effort, a failed one is skipped): the event's own comm-link fetched BY ID (`source_comm_link_id`, else
the id in `sc_events.url`; a weekly roundup is cut to the passages naming the event), a title search over ALL comm-links
of the Comm-Link Wiki API (`filter[title]` per search term: name stem, its "A / B" parts, a CamelCase brand word) - a
title with this edition's real or in-game year counts whatever its import date, a title with another year never does -
plus the newest 200 comm-links for mention excerpts near the dates; the community wiki page (title resolved
case-insensitively via opensearch, this edition's `== <name> <year> ==` section first); RSI page meta tags. Diagnosis
#364: before v2 only the newest 200 comm-links were read and only events in the run window were picked, so 28 of 30
events never got a sheet. An edition with no post of its own yet (announced later) reads the previous edition's posts,
labelled `PREVIOUS EDITION`; all its fields are capped at 0.6 and wait in the admin review. Text-less events skip the
model. Start/end the model leaves unknown come from the calendar row (`fillDatesFromCalendar`: confirmed = `official`
0.85, released; estimated = `ai` 0.4, review). The model
(`claude-sonnet-5-5`, secret `ANTHROPIC_API_KEY`, override `SC_EVENT_SHEET_MODEL`) answers through a tool call
with the sheet shape. Then: review forced to `auto` -> `validateSheet` -> sanity checks (end before start, dates far from a
confirmed calendar row, no named source: confidence drops) -> `gateSheet` (< 0.8 = `pending`) -> `mergeSheets` with the stored
draft (admin `approved`/`edited` fields stay; a `rejected` reading stays rejected while repeated; an unknown reading never wipes a
known value; a weak new reading never displaces a released value) -> `sc_event_sheet_apply(..., 'ai', 'sc-event-sheet:<major>:<hash>')`,
i.e. every run writes a history row. Pending fields are unknown publicly and show in the admin draft.

### Source authority and confidence (extractor v3, #364 follow-up)

The model no longer picks the confidence. Per field it names the sources behind the value (`basis`: SOURCE numbers of the
bundle) and `support` (`stated` / `inferred` / `conflicting`); `scoreField` turns the strongest cited authority into
the number (`AUTHORITY_CONFIDENCE`):

| Authority | Sources | stated | inferred | field `source` |
| --- | --- | --- | --- | --- |
| official | RSI comm-link of this edition, RSI page, CIG staff post or reply on Spectrum | 0.95 | 0.85 | `comm-link` / `rsi-page` / `spectrum-cig` |
| community | starcitizen.tools wiki | 0.65 | 0.5 | `wiki` |
| previous | last year's official posts (edition not announced yet) | 0.55 | 0.45 | `previous-edition` |

`conflicting` = 0.35; no usable citation = the model's own number capped at 0.6, source `ai`. Calendar dates carry
source `calendar`. So official text is released (>= 0.8), community and previous-edition readings wait in the review.
Diagnosis: v2 let the model choose, and it gave official RSI text 0.3-0.7.

**Spectrum (CIG staff only):** one relevance search per event, `POST /api/spectrum/search/content/extended`
`{community_id:"1", text:"<name stem> <in-game year>", type:["op","reply"], page:1, visibility:"nonerased"}` with
`X-Tavern-Id: 1` (no `sort` = relevance; `sort:"relevance"` is refused). A hit is staff when the member has
`isGM`, the post has a `highlight_role_id` (staff role) or the name ends in `-CIG`; community posts are never read.
`selectSpectrum` keeps up to 3 staff posts of this edition (subject year, else written near the dates; a mere mention
is cut to the passage). Spectrum answers `ErrThrottleLimit` to a burst, so the searches run one at a time, 1.2 s apart.
A staff post counts as this edition's own source (no previous-edition fallback then).

**Rewards** = everything handed out (mode rewards, participation gifts, contest prizes, goals), not store sales. For an
edition not announced yet the previous edition's rewards are kept as an expected hint (`previous-edition`, review).
