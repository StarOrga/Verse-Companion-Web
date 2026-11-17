# Second independent QA of the 17.11. feedback batch (HEAD 1fcb022db)

Built nothing. Own static server on 127.0.0.1:4388 (SPA fallback) serving this checkout dist/verse-companion/browser, headless Edge via Playwright, signed in as the test account (init page scripts/playwright/test-session.cjs). Screenshots: ../shots/qa2/. Server stopped by its own PID; public/release-notes.json was not rewritten.

## 1. Gates

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 193 warnings |
| build | pass (rc 0) |
| npm test (full) | 599 files / 7180 passed, 1 skipped, 0 failed (the two red specs of the first check are green) |
| test:functions | rc 0 |
| test:gate | rc 0 |
| subtheme + build-recipe guard | ok |
| data-uploader typecheck | pass |
| data-uploader vitest | 65 files / 659 passed |

## 2. Checklist

| # | Observed | Verdict |
|---|---|---|
| C2 | Fresh context, /codex/ship/AEGS_Gladius#bezugsquelle: .holo-akte.on true, tab Kaufen aria-selected=true (tabs Datenblatt / Beschreibung / Kaufen), Akte rect y 0, h 379 (1280x800) / 613 (1920x1080), inside the viewport. Without fragment: table view, no Akte. BUT the scroll offset ignores the sticky header: the Akte top (tab row, collapse toggle) sits under the topbar / table-head, a Playwright click on .ak-tg is intercepted by .table-head / header.topbar; only the buy cards below are visible (C2-bezugsquelle-1280x800.png). Search Bezugsquelle CTA: no result row carried one in my runs, not checked | met for the mechanism (defect 1) |
| C3 | 1280: strip groups l 29 / 303.5 / 578 / 852.5, w 274.5; perspectives tiles of .below-persp 29 / 303.5, w 274.5; .holo-below kids 28 / 303 / 578 / 853, w 275 (diff <= 1 px). 1920: groups 344 / 649.5 / 955 / 1260.5 w 305.5; parts 343 / 649 / 955 / 1261 w 306. Feedback / share launchers start at x 1134 (1280) and 1774 (1920), content right edge 1128 / 1567: no overlap. 900: 2 columns; 390: carousel, document overflow -10 (none). Dock row not re-measured (0 px per first check, code unchanged) | met |
| C6 | Signed in, three ships opened via search (Sabre, Gladius, Javelin): Zuletzt gesucht holds the three terms (search terms; there is no list of opened ships), Neu in diesem Patch and Bereiche never contain the open ship. On Liberator and Galaxy pages the Neu list shows 3 rows (no backfill), but the pool is only 4 new ships (first check saw the same 4), so a backfill cannot be shown. codex_added_class_names answered 200 this time; search_missions answered 500 (console error, no UI break). C6-empty-field-*.png | partial (exclusion met; backfill not demonstrable) |
| C7 | Fusion bar 1280, /codex/ship/AEGS_Gladius: gla (after the index is warm; at 2.5 s still 0 rows, at 7 s family row first), gladius, valiant, gladius valiant: exactly ONE ship row Aegis Gladius (Du bist hier), anchor = /codex/ship/AEGS_Gladius. aegis: no Gladius row in Schiffe even after expanding the group (only the weapon Aegis Gladius: Koederwerfer): hidden as a weak term; the expectation that it stays greyed because other editions match did not occur here (no edition flagged matched), consistent with the first check C7 | met |
| C8 | Row greyed: a.hit opacity .62, Du bist hier, aria-current=page, .row.current; only when its own target is the open page (on the Valiant page the family row is not greyed) | met |
| C9 | No term gave the open page as the only hit (even AEGS_Eclipse returns Schiffe 1 greyed + 3 weapons + 6 components). Greyed-instead-of-empty is covered by search-current-page.spec.ts (green). Not seen live | not verifiable here |
| C10 | Fusion and legacy bar, Gladius page, term gladius: plain click on the greyed row and Enter on it: URL unchanged, panel closed, sc.codex.recentSearches unchanged; Ctrl+click opens a new tab on /codex/ship/AEGS_Gladius; Ctrl+click on a mini link opens that edition in a new tab; plain mini-link click goes to /codex/ship/AEGS_Gladius_Valiant; click on the here mini link keeps the URL | met |
| C11 | Family row mini links in order: editions Dunlevy /codex/ship/AEGS_Gladius_Dunlevy, Pirate .../AEGS_Gladius_PIR, Valiant .../AEGS_Gladius_Valiant (real a href), then own variant Mein Schiff /codex/ship/AEGS_Gladius?mine= (folded into the family row, no second row). Valiant page, gladius: one row Aegis Gladius (not greyed, its target is Standard), Valiant marked .here (aria-current=page, tooltip), plain click closes only. Deviation: the here member still carries an href (anchor, not plain text; the brief says not a link). Term valiant: Valiant listed first. Liveries stay item rows. Single-model Eclipse: no edition mini links (only Mein Schiff), eclipse greyed, aegis hides Eclipse. Sabre: Comet / Firebird / Peregrine / Raven and 1 more | met (here-link has an href) |
| C12 | Fusion (Ctrl+K), legacy Codex bar (beta shell off), Ctrl+K overlay (sc-quick-search, legacy shell on /hangar, gladius: same family row with Dunlevy / Pirate / Valiant / Mein Schiff). The overlay is not mounted on Codex pages (the bar takes Ctrl+K there). Phone 390x844, fusion and legacy: mini links one line, panel overflow 0, mini links do not overlap launchers. Tap targets are 20 px high with 8 to 9 px horizontal spacing, the plus-one link 15x36: NOT at least 44 px | partial (tap size) |
| C1 | .ak-tg 24x24, border 0, shadow none, transparent, opacity .8, aria Akte einklappen then Akte ausklappen after click (clicked via DOM; defect 1 blocks a pointer click in the bezugsquelle state) | met |
| C4 | No Bewertet als / verglichen mit N Schiffen in the page | met |
| C5 | Alle Werte aller vier toggles the four tiles: height 286, 1513, 286 | met |
| C22 | /verse/explorer, patch 4.10, de + en: unavailable state (Raetsel ist noch nicht verfuegbar / The guess is not available yet) with explanation, no ghost tokens (C22-explorer-4.10-*.png). Default patch 5.0 Live shows a normal map | met |
| C23 / C24 | /verse page 2: rest scroll 0 at 1280x800 (scrollTop 1164), 1920x950 (1077), 1920x1080 (991); an extra wheel step does not move; scrolling back reaches 0. Footer element centre 739 / 889 / 1019 vs launcher 748 / 898 / 1028 (9 px: element box vs button). In C23-verse-page2-1280x800.png the footer right link row runs under the round launcher | met (link row under launcher: observation) |

## 3. Uploader (commit ed8abf3f3, by reading)

Guard: data-uploader/src/renderer/main.ts:2547 (doUploadAfterAuth: if state.continuation then runContinuation and return) sits before the first window.sc.upload (bundle POST) and the catalogue upload; startStage bundle is suppressed at main.ts:2426. state.continuation is set in runRealExtract at main.ts:1831 from planContinuation (lib/auto-run.ts: isLocalOnly = pending non-empty and every key in hulls or silhouettes).

| pending | extract on disk | what runs | bundle POST / catalogue / metadata / new codex_builds row |
|---|---|---|---|
| hulls | yes | reuse, steps hulls | unreachable (guard 2547) |
| hulls | no | local: P4K read + local extract, then steps hulls | unreachable; nothing uploaded from the extract |
| silhouettes | yes / no | steps silhouettes on the published row from fetchLiveBuildId (channel + build, finalized, not superseded) | catalog-bridge.ts:591 refuses mode silhouettes without buildId (no init); no row gives noLiveBuild, nothing sent |
| hulls + silhouettes | yes / no | steps silhouettes, hulls | same |

- Held subtheme uploaded again: no path found. A continuation lists only the pending parts; a full run honours subthemePlan.skip.
- Pending catalogue part, e.g. ships + hulls: planContinuation returns null (not local-only), so a normal full run.
- Strings (de + en, subthemes.cont*, noLiveBuild, contDone, contOpen): truthful. contDone is set only when both silhouettes and hulls are on the server (a no-live-build skip leaves contOpen). Mild wording: contModelsReuse says nothing is uploaded again while the hulls themselves are uploaded (they were not before, so it holds).
- C17 against the quote (no p4k re-read for the catalogue, no bundle or metadata upload, no new codex_builds staging row; an interrupted 3D build resumes): no bundle, no metadata, no new row, resume skips built ships: met. With no extract on disk a full local extraction (P4K read, whole data set, nothing uploaded) runs: a P4K re-read, honestly announced. Verdict: met for what is uploaded, partial for no p4k re-read when the extract is gone. Not run live (no Electron).

## 4. Defects, most severe first

1. C2 / B1: the bezugsquelle fragment scrolls the Akte to y = 0 under the sticky header: tab row and collapse toggle are covered (.table-head / header.topbar intercept clicks on .ak-tg). Repro: fresh context, open /codex/ship/AEGS_Gladius#bezugsquelle (shots/qa2/C2-bezugsquelle-1280x800.png). Needs the header height as scroll offset (fragment scroll in codex-holo-stage.component.ts).
2. Raw i18n key visible in search group heads: codex.search.bar.foldedOne (Schiffe, Komponenten) in the fusion panel, desktop and phone (shots/qa2/C9-only-hit-AEGS_Eclipse.png, C7-phone-fusion-gladius-390.png). Cause: foldedKey() in src/app/codex/search/codex-search-results.component.ts:465 builds foldedOne / foldedAtLeastOne keys that are absent from public/i18n/de.json and en.json. Already on origin/main (from #745), not introduced by this batch.
3. C12 phone: mini links are 20 px high (the plus-one link 15 px wide), spacing 8 to 9 px: below 44 px. Selector .variants a.vl (fusion panel and legacy results).
4. Phone fusion panel: the key-hint footer sits under the share and feedback launchers, and document.scrollWidth minus innerWidth is 56 while the fusion search is open at 390 px (-10 without it); the panel itself does not overflow.
5. C11 detail: the here mini link is an a href instead of non-link text.
6. C23 observation: footer legal links partly under the round launcher at 1280x800.
7. C9 / C6 live proof missing: no term whose only hit is the open page; no backfill demonstrable (pool of 4 new ships).
8. Environment: search_missions RPC returns HTTP 500, not attributable to this batch.

## 5. Not checked

Search-result Bezugsquelle CTA; the strip dock row at 0 px (not re-measured); C13 to C21 beyond the uploader trace (Electron runtime, live database, migrations not applied); legacy-bar behaviour on the phone beyond the family row; C9 live; the Ctrl+K overlay on a Codex page (not mounted there by design).
