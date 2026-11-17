# Independent QA of the 17.11. feedback batch (5607bb4b2..707467aea)

Built nothing. Production build served on 127.0.0.1:4377 (own static server, SPA fallback), driven by headless Edge via Playwright, signed in as the test account. Screenshots: ../shots/qa/.

## 1. Gates

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 193 warnings |
| build (templates) | pass (rc 0) |
| npm test (full) | 2 FAILED, 7154 passed, 1 skipped (598 files, 1 failed). The same 2 fail when the file is run alone, so they are real |
| npm run test:functions | 646 / 646 pass |
| npm run test:gate | 167 / 167 pass |
| subtheme + build-recipe guard | ok |
| data-uploader typecheck | pass |
| data-uploader vitest | 649 / 649 pass (64 files) |
| uploader python | skipped, git diff --stat -- data-uploader/python is empty |

Failing (bundle B2 search; specs from 07c8ef588, implementation 707467aea):
- src/app/codex/search/codex-search-engine.spec.ts:359, "Enter on the greyed current row only closes ...": enterOption() returns the AEGS_Gladius_Valiant hit (no current flag) instead of the greyed current row.
- same file :376, "a navigation moves the location the rule reads": engine.here().path is the root path after navigateByUrl to /codex/ship/AEGS_Gladius, expected /codex/ship/aegs_gladius.
The live fusion bar and legacy bar behave correctly, so this is a stale or unfinished spec, or an engine path (the legacy-bar engine) whose here() does not follow navigation.

## 2. Checklist

| # | Observed | Verdict |
|---|---|---|
| C1 | .ak-tg 24x24, inward-arrows path, border 0, shadow none, transparent bg, colour fg-2 at opacity .8 (tabs: cyan, tinted bg). Hover: opacity 1, no frame. Collapsed: outward-arrows path, aria "Akte ausklappen", text hidden; click restores. aria-label + tooltip present. Keyboard focus: ring from --sc-focus-ring; rest/hover never ring. shots/qa/C1-* | met |
| C2 | .below-side count 0 at 1280 and 1920; Akte has a Kaufen tab. BUT /codex/ship/AEGS_Gladius#bezugsquelle opens the buy tab inside an Akte that is not shown: the stage stays on the Einfach surface, .holo-akte.on is false, #bezugsquelle rect is 0,0, scrollY 0 (C2-bezugsquelle-1280x800.png). codex-holo-stage.component.ts:1741-1746 only scrolls, nothing sets akteOpen (default false). The source jump lands nowhere visible (it used to land on the side card) | PARTIAL (defect 2) |
| C3 | Strip dock opened, perspective tiles vs strip groups, left/width: 1280 33/273.5, 306/273.5, 580/273.5, 853.5/273.5 for both; 1920x1080 and 1920x950 312.8/321.1, 633.9, 955, 1276.1 for both: equal (0 px). 900 px: 2 columns; 390 px: carousel of 254 px tiles, no horizontal overflow. The second, in-page mount of the same component (page end, under the parts) at 1280 is 4 x 301 (lefts 33/334/635/936) vs the strip at 273.5 (the strip reserves about 110 px for its side buttons): not aligned there; at 1920 equal. Parts area unclipped | met for the dock row (the screenshot the user sent); partial for the in-page mount at 1280 |
| C4 | No "Bewertet als ... verglichen mit N Schiffen" anywhere (.say shows only the per-tile line). Keys perspectives.lead/leadNoCohort removed, unused. Above, Einordnung shows "Leichter Jaeger" + radar; the "N x Rolle" caption (codex-rank.ts:260, holo.strip.cohortRole) did not render in my runs because the fleet comparison was still computing | met (N-ships figure not seen rendered) |
| C5 | "Alle Werte aller vier" right-aligned above the tiles, tiles keep left/width; toggling opens/closes all four (heights 203 -> 1314 -> 203); the strip handle (.hs-toggle) still opens/closes the dock (aria-expanded true/false). Hidden on phone (each tile has its own handle) | met |
| C6 | On the Gladius page the empty panel shows no Gladius anywhere; but my test account produced only recent searches in the fusion bar (no ship recents / Neu in diesem Patch); the legacy bar showed Neu in diesem Patch: Liberator, Marauder, Hyun, Galaxy, no Gladius. List length/backfill not seen | partial (not fully observable) |
| C7 | fusion: "aegis" lists Eclipse/Idris-M/Idris-P, no Gladius; "gladius valiant": Valiant only; legacy "aegis": no Gladius. "gla": only the own ship row appeared (catalogue ship rows absent at that moment, index probably still warming; not re-run) | met ("gla" inconclusive) |
| C8 | fusion + legacy: "gladius", "Aegis Gladius", "AEGS_Gladius" -> "Aegis Gladius - Du bist hier" at its rank in Schiffe, .current, aria-current=page, row text is name + hint only, no CTA / fit / icons | met |
| C9 | not seen live (no term gave an only-the-open-page result). Covered by search-current-page.spec.ts | not verifiable here |
| C10 | fusion bar: ArrowDown to the greyed row + Enter: URL unchanged, panel closed; plain click same; no new sc.codex.recentSearches entry; Ctrl+click opened a new tab on /codex/ship/AEGS_Gladius | met (fusion); legacy not driven |
| C11 | see section 3. Only own hangar variants are folded | PARTIAL |
| C12 | fusion bar and legacy Codex bar (beta shell off) tested on desktop 1280. Ctrl+K overlay and phone width not tested. The two failing engine specs belong here | partial |
| C13 | events.ts:96 search:result_open now carries area, rank, new_tab, current, variant; a tile "Suche: Du bist hier und Varianten-Links (30 Tage)" in posthog/dashboards.json (HogQL splits row / Du bist hier / Varianten-Link). docs/analytics/event-naming.md:42 still says search:result_open stays area + rank: stale (also misses new_tab) | met, doc stale |
| C14 | The new readGameIdentity against the real LIVE build_manifest.id and the real rsilauncher log.log returns version 4.10.3, buildNumber 13165946, source launcher-log. The log holds 4.10.3-live.13165946 (3x) and 4.10.2-live.12913470 (13x); manifest Branch is sc-alpha-4.10.0. The build number must match, so another build line cannot relabel it; fallback = Branch (4.10.0) | met |
| C15 | auto-run.ts decideAutoRun: runs when version differs or both builds known and differ; applyLedger then narrows to the pending parts | met |
| C16 | applyLedger: identity equal + nothing pending -> already-uploaded, nothing runs; changed identity with ledger read and nothing pending -> no run; pending parts -> exactly those. game-identity.spec.ts (207 lines) + auto-run specs green (649). Migration 20261117190000: ledger lookup by channel + numeric build, patch ignored, one row per subtheme | met (tests/trace) |
| C17 | renderer/main.ts:1791 isModelsOnly(plan.pending) -> reuseExtract of this build extract on disk -> stages extract/bundle/entries/silBuild/silUpload skipped, runModelsOnly (main.ts:2683) -> skins only: no bundle, no metadata, no new build row; a leftover job whose catalogue already landed is dropped (resume-compat.ts catalogAlreadyLanded, main.ts:531). With 7 parts held and hulls open no catalogue upload can start. GAP: if no extract is left on disk the code logs modelsOnlyNoExtract and falls through to a full run (full P4K read); and, as the builder reported, a silhouettes-only pending still extracts in full. Against the quote this holds only while the extract exists. Not run live (no Electron) | PARTIAL |
| C18 | subthemes.modelsOnly and friends, autoRun.starting (Spiel-Build geaendert ... pruefe und lade hoch, was offen ist), continuingParts, partsText exist de + en, key parity 0/0 | met |
| C19 | Migration relabels build 13165946 rows 4.10.0 -> 4.10.3 (only where none exists) and deletes the one unfinalized, non-current staging build of 17.11.; lookup ignores the patch for numeric builds, so a label change cannot orphan rows; idempotent | met (orchestrator dry-run + read) |
| C20 | Not applied, no DB access. After heal 4.10 points to the series Avenger Stalker with its old points (shape unchanged). The live page today still shows "Die Form: Aegis Avenger Stalker" and the unavailable state | not verifiable live; SQL review ok |
| C21 | Rule: eligible = verse_guess_ship_eligible (not is_variant, real name, not Edition/Special/Template) AND 7 valid stars (table check) AND new in the patch line (first_seen), else the newest earlier line with new ships, else any eligible. Self-heal: base hull by same localized name/kind, else re-pick; heal runs on every constellation op. All security definer with an empty search_path, execute revoked from public/anon/authenticated, heal/lock granted to service_role only; candidates table RLS on, no client grants. Verdicts are stored per (user, patch) with a primary key + on conflict do nothing: a re-point changes no past verdict and allows no second guess. Edge function: same body, old uploaders work; falls back to pickNewest if the migration is missing. Remaining risks: a heal that must re-pick (no base hull) changes the points under users who saw the old shape; candidates stay empty until the next upload, so a fresh patch before its first upload shows unavailable (explained, C22). No manual step per patch; no Claude API used or needed. Constellation edge tests green | met (SQL read, not run) |
| C22 | /verse/explorer, patch 4.10, de + en: no ghost tokens; "Das Raetsel ist noch nicht verfuegbar ... Fuer diese Sternkarte steht gerade kein Schiff zum Erkennen fest. Es wird automatisch gewaehlt ..." and "The guess is not available yet ... No ship to recognise is set ...". C22-explorer-4.10-de.png and -en.png | met |
| C23 | /verse page 2, footer row centre vs round launchers: 1920x950 footer y 898.1, launchers about 897 (screenshot); 1280x800 footer 748.3, launchers about 748; 1920x1080 footer 1028.1 (same 52 px bottom offset). C23-verse-page2-*.png | met |
| C24 | scrollTop + innerHeight - scrollHeight = 0 at 1920x1080 (834/1080/1914), 1280x800 (731/800/1531), 1920x950 (834/950/1784); one more wheel step does not move; back up rests at 0 at all three sizes | met |
| C25 | Cause statement is the builder part; production before-state not measured (skipped). Page 1 header looks normal in C23-verse-page1-*.png | not verifiable here (before-state) |

## 3. C11 as the user sees it today

Typing "gladius" on a non-Gladius page (fusion bar): own hangar ship "Aegis Gladius - Mein Loadout" (the saved variant is folded into it: 1 row), catalogue "Aegis Gladius", "Aegis Gladius Valiant", "Aegis Gladius Pirate" (3 separate rows); the legacy bar also "Aegis Gladius Dunlevy" as its own ship row; liveries/items ("Gladius Dunlevy", "Gladius Valiant Livery") as item rows. The note asks for one entry per ship with mini links to variants. Folded: only own saved variants (search-own.ts: one row per hangar ship, mini links when 2 or more variants). Not folded: game variants Valiant/Pirate/Dunlevy (own pages); own-ship row and catalogue-hull row stay two rows. No mini links in Ctrl+K / legacy bar. The test account Gladius has a single variant, so the mini-link row was not seen live (code + specs only). Against the quote: partial.

## 4. Defects, most severe first

1. B2 search: two red specs, codex-search-engine.spec.ts:359 and :376. Full npm test is red; the ship gate would fail.
2. B1 C2: #bezugsquelle / the search Bezugsquelle link does not make the Akte visible when the stage is not on the Akte view (not the default): codex-holo-stage.component.ts:1741-1746 scrolls to a hidden element, akteOpen is never set. Repro: open /codex/ship/AEGS_Gladius#bezugsquelle in a fresh browser.
3. B2 C11: one entry per ship + mini links only for own saved variants (section 3).
4. B1 C3: in-page mount of the perspectives row at 1280 uses 301 px columns, strip groups 273.5 px. The dock row (the user screenshot) is aligned.
5. B3 C17: models-only needs the extract on disk; without it a full run (P4K read) starts.
6. Docs: docs/analytics/event-naming.md:42 stale.
7. Environment: cloud RPCs codex_added_class_names and search_missions returned HTTP 500 during my runs (console error, no UI break; Neu in diesem Patch in the fusion bar was empty). Not attributable to this batch, but it hid the C6 empty-field lists.

## 5. Not checked

Ctrl+K overlay, phone-width search, legacy-bar keyboard/click/ctrl-click, C9 live, C11 mini links live (no account with 2 or more variants), the production before-state of C24, Electron runtime of C14-C19, the live database for C20/C21 (migrations not applied), the Einordnung N-ships caption while rendered. Console errors on the pages opened: only the two 500s above.
