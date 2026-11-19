# Close-out brief — five follow-ups the owner routed to "Jetzt umsetzen"

The owner read the final report of concept `20261117-1110-pfad-stationen` (round 6) and sent the close-out sheet
with **all five findings on "build now"** and **ship afterwards**. No notes, no pins. The findings, verbatim from the
sheet, are the orders below. Everything of rounds 1–5 stays as built (`briefs/implement.md` A1–F3,
`briefs/implement-r5.md` G1–G10).

Machine state: the load governor reports pressure (a game runtime has priority). One implementing agent at a
time; agents run only the specs of the area they touch, the orchestrator runs the full suite and the build once.

## H1 — `oq-undo` · [BUG] Undo of a wish removal restores absolute values and drops a ship wish's name and notes

> Concept 20261117-1110-pfad-stationen, checklist line A10 (one undo restores everything). Two gaps remain in the undo of applyWishRemoval / release (src/app/hq/nachschub/nachschub.service.ts) and of the ship wish path (src/app/hq/data/item-path.service.ts, src/app/hq/data/wishlist.store.ts): (1) undo writes back the absolute line and wish values captured before the removal, so a change made in between (another tab or device, a fulfilment) is overwritten instead of merged; restore by delta or refuse when the row changed since. (2) A ship wish lowered to 0 is deleted; undo re-creates it without its custom name and notes; capture and restore the full row. Add specs for both.

## H2 — `oq-offline` · [BUG] An offline second device can reopen a fulfilled wish line

> Concept 20261117-1110-pfad-stationen, checklist line A8 (a fulfilled wish stays in its Operation as reached). A met wish line switches its source from 'wish' to 'wish_met' through a conditional update (casSource in src/app/hq/hq-supplies.service.ts) and lowers the wish once. A second device that edited the same line while offline still holds source 'wish' and pushes it on reconnect; last write wins, the line reads as open again and the next fulfilment would lower the wish a second time (redteam round 2, left open). The client cannot prevent this. Fix on the server: a trigger on public.hq_supplies that refuses the transition wish_met -> wish (or keeps the greater state), shipped as a migration with a begin/rollback dry run.

Orchestrator's findings (verify the one assumption each rests on, then build):

- `wish_met -> wish` is ALSO the legitimate way back: a met line that is unticked or restored by an undo is moved
  back by `casSource(ids, 'wish_met', 'wish')` and the wish is raised once (see the comment of the fulfil pass in
  `nachschub.service.ts`, "A `wish_met` line that is open again ... gives the pieces back the same way", and the
  migration `20261117155000_hq_supplies_source_wish.sql`). A trigger that refuses the transition outright breaks
  that. The server must tell the deliberate compare-and-set apart from a stale full-row upsert.
- Direction (free to improve, not to weaken): a small SQL function for the compare-and-set that marks its own
  transaction (`set_config(..., true)`), called by `casSource` through `rpc`; a `before update` trigger on
  `public.hq_supplies` that, when `old.source = 'wish_met'` and `new.source = 'wish'` and the mark is absent, keeps
  `source` and `done` of the old row (the met state wins, every other column of the newer write still applies).
- `hq_supplies` already has two triggers, `hq_supplies_a_sync` (generic last-write-wins on `updated_at`, skips stale
  writes) and `hq_supplies_b_cap` (`supabase/migrations/20261101000000_hq_supplies.sql`). Triggers fire in name
  order. The bug only bites when the offline edit is NEWER than the met transition.
- After the coerced push the stale device must end up with the server's row (met, ticked) on its next pull; check
  how `pull` merges a row whose local copy is not dirty any more and cover it with a spec.
- Production today: 2 Operationen, 1 line with source `wish`. Deploy order stays "migration before client".
- The agent has no database access. It writes the migration AND a self-contained dry-run script
  (`begin; <migration>; <test cases with raise exception on a wrong outcome>; rollback;`) into
  `supabase/tests/` or next to the brief; the orchestrator runs it against the live project.

## H3 — `oq-archiv` · [FEATURE] Delete an archived Operation from the Archiv

> Found during the independent check of concept 20261117-1110-pfad-stationen: the Archiv in HQ Planen offers only 'Wieder aktivieren' per archived Operation. To delete one, the user has to reactivate it (which needs a free slot of the 7) and delete it from the active list. Add a delete control to the archive rows (scAction tertiary, tone danger, ScConfirmService with the same wording and wish rule as the active delete: wishes stay on the wishlist unless the box says otherwise). Files: the Archiv component under src/app/hq/plan/ and NachschubService.remove.

Orchestrator's finding: the Archiv list is rendered in `src/app/hq/plan/hq-nachschub-dialogs.component.ts`
(`svc.archived()`), the count on the board in `hq-nachschub-board.component.ts`.

## H4 — `oq-altdaten` · [FEATURE] Count plain item and ship lines of old Operationen back onto the wishlist

> Concept 20261117-1110-pfad-stationen, checklist line A11 (existing data): before this change, putting a wish into a Nachschub moved the quantity off the wishlist. The one-time client reconcile (reconcileLegacyWishLines / isLegacyWishLine in src/app/hq/nachschub/nachschub.service.ts) counts back only lines that provably came from a wish (kind neither item nor ship, or carrying forClassName; no stops, step, SCU or minQuality). Plain item and ship lines of Operationen that existed before the change are deliberately left alone, because they cannot be told apart from Bestand lines planned without a place, and counting them back would create wishes the owner never made (redteam finding H3). Result: such old lines are not shown as 'gewünscht und zugeordnet'. A safe rule needs a discriminator the data does not have today (e.g. a server-side marker written at assignment time, or asking the owner once per old Operation). Decide the rule first, then build it with a dry run against production data.

The rule (decided by the orchestrator from the two options the finding itself names; the owner chose "build now"
over "issue"): **the owner is asked, per Operation, and nothing changes without their click.** No automatic
count-back, so no wish the owner never made.

- Candidates: open lines of an ACTIVE normal Operation with `source === 'search'`, a class, kind `item` or `ship`,
  no `forClassName`, no stops / step / SCU amount / minimum quality (the lines `isLegacyWishLine` skips on purpose).
- Where: in the Operation in HQ Planen, one quiet hint row above its lines when it has candidates:
  "N Zeilen sind noch keine Wünsche" with two actions, "Als Wünsche führen" and "So lassen" (wording to be
  refined by the builder in the tone of the page; DE and EN).
- "Als Wünsche führen": per wish position, compare-and-set `search -> wish` on the server first, then ONE wishlist
  write that raises the wish by what was won (the exact mechanics of `reconcileLegacyWishLines`: 999 cap, label
  reverted when the wishlist write fails). One undo toast restores lines and wishes.
- "So lassen": the lines get a marker that survives a reload and a second device, so the question never comes
  back for them: `source` moves `search -> manual` by the same compare-and-set (a `manual` line is what the app
  already calls a line planned by hand; verify that nothing else reads `search` on an item/ship line in a way that
  makes this a visible change, else pick another existing value or say so).
- Lines added after this release never become candidates when they come from a wish (they are written as `wish`);
  a plain `search` line added later by the Bestand flow WOULD match the candidate rule. Check which flows still
  write `search` item/ship lines today; if any does, the hint must not show for those (e.g. restrict candidates to
  lines created before the release date `2026-11-17`, the day the `wish` source went live) — state what you chose.
- Production today: 8 such lines in 2 Operationen of 2 users.

## H5 — `oq-names` · [BUG] Edge function nachschub-names answers 401 when the HQ wizard opens

> Found during the independent check of concept 20261117-1110-pfad-stationen (test account, local dev server against the cloud project): every time the HQ wizard or the 'In eine Operation' flow opened, the browser console showed POST https://<project>.supabase.co/functions/v1/nachschub-names -> 401. The name proposal still worked (it falls back to the item name), so the user sees nothing. Not caused by this concept's diff as far as checked; not compared against main. Check verify_jwt and the Authorization header the client sends (supabase/functions/nachschub-names, the caller in src/app/hq/nachschub/), and whether the function is deployed with the expected secret.

Investigated by the orchestrator itself (read-only first).

## Order and ownership

1. Core agent: H1 + H2 (`nachschub.service.ts`, `item-path.service.ts`, `wishlist.store.ts`,
   `hq-supplies.service.ts`, their specs, one new migration + dry-run script).
2. Frontend agent: H3 + H4 (`src/app/hq/plan/*`, the count-back method in `nachschub.service.ts` after the core
   agent is done, `public/i18n/{de,en}.json`, specs).
3. Orchestrator: H5, the migration dry run, full suite, build, an independent check in the real app, ship.

An item that turns out to need a decision of the owner, or that cannot be made safe, is STOPPED and reported, never
built as a guess: the report names it as not delivered.
