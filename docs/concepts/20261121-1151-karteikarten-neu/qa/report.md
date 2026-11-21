# QA report - Karteikarten neu (Wave 3)

Branch claude/karteikarten-seite-rethink-59abdb @ cae152233. Own screenshots live in this folder
(sNN-desk / phone / tab / fhd png files, mock pairs mock-sN-*.png, stress-*.png, legacy-card.png).
Real production build served on port 4220, card RPCs intercepted with contract fixtures (cards.testing.ts),
test-account session, headless Edge. All servers stopped afterwards.

## Gates
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 198 warnings |
| vitest admin/translations | 6 files, 78 passed, 0 failed |
| test:functions | 865 passed, 0 failed |
| build | pass (only a budget warning in codex-landing scss, not this branch) |

## Checklist
| Line | Quote -> observed | Verdict |
|---|---|---|
| P1 | one convention card per pattern -> spellingPattern + routePair -> upsertConvention; s2 shows ONE case-convention card for "alle 5 Sprachen" (_card_filters.ts:76, _cards.ts:214) | met |
| P2 | strip foreign brackets, one left = no card -> stripForeignBrackets, resolved/bracket (unsure) (_card_filters.ts:55,176) | met |
| P3 | >=5 votes, >=4:1 -> clearMajority exact, logged as an ai card. "reversible": the decision is status ai in language de, but the UI has no surface for judged languages (veto list only for non-judged, translation-cards.component.ts:522) | partial |
| P4 | verb form / abbr -> verbFormPattern (it, pt-BR, ru), abbreviationPattern, one convention per pattern | met |
| P5 | doubt ranks again -> disagreementDoubt 0.5..1, recomputeDoubt | met |
| P6 | KI decides + back-translation + veto -> kiDecide order majority > community > AI, _back.ts wired in _learn_pass/_learn; veto card (hero large, German meaning under, reason, Sieht falsch aus / Passt) in s6 | met |
| P7 | per-admin judged langs -> table, 2 RPCs, judgedLangs union, default de. No UI to change it (setMyLangs unused) | partial |
| P8 | one answer for all langs + exception -> convention kind + exceptions; A opens sheet, IT sent p_exceptions it=b (s2b, s2c) | met |
| P9 | question from i18n -> params only, column question dropped; DE questions render from templates | met |
| P10 | N Texte + three examples -> "betrifft N Texte", 3 rows per half (s2, s3); single-string wording card has 1 example | met |
| P11 | "ab nächstem Lernlauf" -> on every card footer | met |
| P12 | replaces Skip, leaves deck -> works for term/wording. A convention card sent with up-arrow is stranded: status ai, lang null; routeCards filters eq(lang), veto list filters c.lang = p_lang; it also blocks the pattern (dedupe index and findConvention cover status ai) | partial (defect 1) |
| P13 | undo until learn pass -> toast + Ctrl+Z called undo_translation_card, card returned (s4c); server raises 55000 after apply | met |
| P14 | 253 cards cleaned once -> cleanupOpenCards, marker-guarded, runs only at the first learn pass, not in the migration. Until then legacy rows (params empty) render a question with empty term quotes (legacy-card.png). A crash between the folded updates and the final upsertConvention loses members | partial (defect 3) |
| G1 | points/streak/goal/ranking stay, game feel -> ring, +20 chip, trophy, boxes (s1, s4, s5) | met |
| G2 | no combo -> no combo/kombo text in the DOM, reward = goal step | met |
| G3 | 20 + 180 bonus, week from Monday -> SQL translation_card_score; UI shows +points / +bonus (bonus only via fixture) | met |
| G4 | other admins by name, own "Du" -> Nova / Du / "Admin ohne Namen" (s1) | met |
| U1 | rail at left edge like HQ -> sc-section-rail wrapper, real anchors, active in admin red; below 1024 px a bottom bar | met |
| U2 | Duell-Karte, option text biggest -> s2/s3 match the mock: muted question, big options, 3 muted example rows, about 5 visual lines | met |
| U3 | tap, keys, swipe -> left/right/1/2, E, up, A, Enter, ? all driven OK; touch swipe left/right/up OK (CDP). First-load Enter is swallowed by the shell autofocused search field (works after any click) | met (note) |
| U4 | hotkey for Ausnahme -> "A" with key cap | met |
| U5 | no "Alle Tasten" -> absent in the DOM; ? opens the sheet (s2d) | met |
| U6 | app undo toast -> UndoToastService toast "Rückgängig", Ctrl+Z | met |
| U7 | no bottom bar / start button -> cover is the start, none present | met |
| U8 | left box Tagesziel & Sprachen -> ring + DE + 4 KI rows; row click opens the veto list (s6). Row order IT, JA, PT-BR, RU vs mock IT, PT-BR, JA, RU (trivial) | met |
| U9 | KI summary as special last row, no Ansehen -> "KI hat 199 entschieden, 9 unsicher, 45 warten auf dich", dashed row, no button | met |
| U10 | right box Statistik -> Platz, ranking, week points, Serie 7-day | met |
| U11 | veto in same frame, <= 5 lines -> s6 hero, German meaning, warning reason, two halves | met |
| U12 | chosen text large + goal step + "+20 Punkte · N Texte vereinheitlicht" -> exact (s4) | met |
| U13 | Stapel geschafft, no ring/card overlap -> trophy, "Alles geklärt für Deutsch", when-line (s5) | met |
| U14 | no text overflow -> 375/768/1280/1920 clean with normal text, 1280 clean in stress. At 375 the p.swipe hint with a long option label is 368 > 343 and widens .table | partial (defect 5) |
| U15 | no Kommandozentrale -> crumb Admin -> /admin/hub, no eyebrow, text absent | met |
| U16 | phone: one column, slim HUD, swipe, nothing under the launcher -> HUD strip ring/Punkte/Platz/Serie, toast above the bar, FAB lane clear; swipe hint and actions sit at the bar edge on first view | met |
| X1 | i18n -> no hardcoded UI text found; "betrifft 1 Texte" plural wrong | met (note) |
| X2 | analytics -> 6 events, 1 line in dashboards.json | met |
| X3 | errors -> cardErrorKey, error state + retry in the template (not induced live) | met |
| X4 | tests -> vitest 78, node tests 865 incl. filters and P6. No pgTAP for the new RPCs, and supabase/tests/database/translation_community_seed.test.sql still calls the dropped skip_translation_card, translation_card_stats, translation_card_leaderboard, the 5-arg answer_translation_card and inserts question | partial (defect 4) |
| X5 | conventions -> scAction, anchors, no native UI, focus-ring tokens | met |

## Open points
- (a) no Eigener Text on conventions: acceptable. A pattern question has no sensible own text and the contract rejects it. Deviation from mock s2, say so in the release text.
- (b) key caps at rest on desktop: acceptable. The mock shows them; the pin only banned the "Alle Tasten" text; hidden on touch.
- (c) violet/gold as local properties: acceptable for now, no clash with the access colours. Promote to tokens if a second page uses them.
- (d) swipe blocks vertical scroll on the card: acceptable. Verified: touch-action none on .deck, a drag on the card does not scroll. The card is about 230 px, the page scrolls from the HUD or outside; pan-y would kill swipe-up.
- (e) no UI for judged languages: acceptable as a follow-up for the single German admin, P7 stays partial.
- (f) P3 reversible only until the next pass: fix needed. Worse than stated, German auto-decisions have no review UI at all (defect 2).
- (g) one example on single-string wording cards: acceptable, only one text exists.

## Defects before ship (most severe first)
1. Convention + Nicht meine Entscheidung strands the card forever and blocks the pattern. The convention card is always the first deck card and up-arrow is one key. Fix in the RPC (reject for kind convention) or let routeCards and the veto list handle lang is null (_cards.ts:303, migration 20261121170000:353).
2. German auto-decisions (P2/P3/whitespace/casing) are status ai in a judged language with no UI surface, so P3 reversible is unmet. Show a review list for de, or keep them out of the automatic take-over.
3. Release coupling: the migration drops old RPCs/columns while the live UI still calls them, and the new UI needs the migration (ship together). Legacy open cards render empty term quotes until the first learn pass: run P14 right after db:push, or hide cards with empty params in translation_deck. Make the cleanup crash-safe (upsert before folding).
4. Stale pgTAP file (calls dropped RPCs) and no pgTAP for the new RPCs.
5. Phone: the swipe hint overflows with long option labels at 375 px. Clip it.
6. Low: "betrifft 1 Texte" plural; first-load Enter swallowed by the autofocused search field (focus the cover on mount).
