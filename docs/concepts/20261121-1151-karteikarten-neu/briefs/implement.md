# Implement brief — Karteikarten neu gedacht

Generated from every baked round of `docs/concepts/20261121-1151-karteikarten-neu/` (later rounds override earlier
ones). Decisions file: `docs/concepts/20261121-1151-karteikarten-neu-decisions.json`. Rethink artefacts:
`.claude/rethink/2026-11-21-translation-cards/` (brief, approaches, decision).

**Binding visual spec:** `docs/concepts/20261121-1151-karteikarten-neu/rounds/05.html` (round 5, design `d1`
Duell-Karte, screens `r5-d1-s1` … `s6`, desktop + phone) — build to that mock, with the round-5 pins below applied.
Earlier rounds only where a line cites them. Screenshots of round 5: session scratchpad `shots5/`.

## Every user remark, verbatim (all rounds)

### Runde 1 (action: iterate)

- Entscheidung `d-finding` (Befund zu den offenen Karten): **"ok"**
- Entscheidung `d-filter` (Vorfilter vor jeder Karte): **["casing","bracket","majority","patterns","doubt"]** (weicht von Empfehlung "casing bracket majority patterns" ab)
- Entscheidung `d-foreign` (Karten in fremden Sprachen): **"veto"**
- Entscheidung `d-xlang` (Konvention für alle Sprachen): **{"answer":"yes","alt":""}**
- Entscheidung `d-session` (Was beim Öffnen erscheint): **"deck"** (unberührt)
- Entscheidung `d-answer` (Art der Antwort): **"tap"** — Notiz: „Ja plus bitte tasten auch verwenden hotkeys, aber auch auf dem handy swipen!“
- Entscheidung `d-preview` (Zu jeder Entscheidung): **["count","when","lang","notmine"]**
- Entscheidung `d-game` (Punkte und Rangliste): **"keep"** (weicht von Empfehlung "none" ab) — Notiz: „Gern neu gedacht und schön integriert, aufgemacht. Das ganze view soll eher wie ein spiel wirken !“
- Allgemeine Notiz: „das nächste bitte /  / und anbei devopos learn, lvie treue sollte bei hover over die hinweise einblenden. Außerdem der grüne punkt auf dem notiz fab ist unnötig und hässlich, den einfach weg“ (Anhang: .claude/concepts/20261121-1151-karteikarten-neu/attachments/7813b727ce480053d896a5a0a6c4872d4f00b730573f5fbb45923d3cae96537e.png)

### Runde 2 (action: iterate, Favorit: d2)

- `anno-r2-d2-s3-a1`: „k“
- `anno-r2-d2-s4-a1`: „sehr gut, gern noch ein ticken mehr highlighten“
- `anno-r2-d2-s5-a1`: „namen“
- `d3-s6`: „diese Veto Liste hmm, fühlt sich unintegriert an ggü. dem rest. Gtu weil es was anderes ist, aber hmmm / AUßerdem finde ich gut, dass man es per sprache sehr gut im überblick sieht“
- Screen-Notiz `d3-s6`: „diese Veto Liste hmm, fühlt sich unintegriert an ggü. dem rest. Gtu weil es was anderes ist, aber hmmm / AUßerdem finde ich gut, dass man es per sprache sehr gut im überblick sieht“
- Pin `d1-s1` auf button.mock-tab "Übersicht": „mach dieses menü genau links am seitenrand wie in hq etc. wollen das gleich haben“
- Pin `d2-s1` auf span "Collaborator": „genua hier unten die anderne namen der anderen leite. Du bleibt bei du ist ok!“
- Pin `d2-s1` auf div.d2-stat "Punkte1 240": „Die drei kästen hier links naja, etwas langweilig“
- Pin `d2-s1` auf div.d2-stage "Tagesziel 0 / 10 DEDeutsch · 10 Karten≈ ": „Tagesziel finde ich gut,“
- Pin `d2-s2` auf h3 "Normale Schreibweise": „hier sollte bitte etwas mit abständen aufräumen etc. man kann es schlecht erfassen“
- Pin `d2-s2` auf button.d2-sbtn.d2-sbtn--r "GROSSBUCHSTABEN →": „Kann nicht sein, dass es textuell übersteht“
- Pin `d2-s2` auf div.d2-podium "21 24011 4803310": „ich weiß gar nicht ob wir hier rechts so "dicke kästen brauchen hmm“
- Pin `d2-s3` auf div.d2-ctop "BegriffEnglisch: Open2 / 10": „gern nochmal varianten der karten hier, denke gut drüber nach“
- Pin `d2-s4` auf text "5": „was soll hier die 5?!“
- Pin `d2-s4` auf span "Nächste Karte in 3 s": „Die leiste hier unten finde ich super inhaltlich, aber da springt viel etc. wenig wiederkennungswert, welche buttons wofür etc...“
- Pin `d2-s4` auf div.d2-undo.mock-desk "5Rückgängig Strg+ZNächste Karte in 3 sWe": „rückgängig haben wir doch eine reguläre darstelujn!?“
- Pin `d2-s5` auf div.d2-empty "Alles geklärt für Deutsch10 Karten · 74 ": „die idee mit dem ring gut, aber irgendwie doof, mit dem überlappten zum quadrat karteikarten...“
- Pin `d2-s6` auf div.d2-vhead "Fremde Sprachen: KI hat 199 entschieden,": „das sieht mir viel zu anders aus! ALs der ander eworkflow :/“

### Runde 3 (action: iterate, Favorit: d1)

- `anno-r3-d1-s1-a2`: „Das ist doch viel besser!“
- `anno-r3-d1-s1-a3`: „passt“
- `anno-r3-d1-s2-a3`: „drei beispiele reichen, aber irgendwie sind da viele formen, viel weiße text zeiel n usw. edas macht alles unruhig in dieser riesen karte  un d nciht light weiehhgt obwohl  ich die inhalte alle super finde“
- `anno-r3-d1-s4-a2`: „sehr gut, genau. Wobei, was wollen wir eigtnlich mit kombo? Ist das nicht einfach das was wir in tageszeil schon haben, naja....“
- Pin `r3-d1-s1` auf a.mk-act.mk-act--s "Ansehen": „finde ich sehr gut“
- Pin `r3-d1-s1` auf button.mk-act.mk-act--p "Stapel aufdecken Enter": „brauchen wir den button hier?! haben doch obenb schon alles“
- Pin `r3-d1-s2` auf div.mk-gamebar "Karte1 von 10 Combonoch keine Als Nächst": „ich weiß gar nicht ob wir das hier unten als balken überhaput brauchen... haben doch schon alles sichtbar darüber“
- Pin `r3-d1-s6` auf a.mk-backl "Zurück zum Stapel": „das zurück ist doof hier, wir haben doch rechts eh die auswahl...“
- Pin `r3-d1-s6` auf div.mk-frame "Kommandozentrale Admin KI-Übersetzung Cl": „sollte das hier rechts nicht eher links stehen und rechts das was links steht“
- Pin `r3-d1-s6` auf i: „Diese woche würde ich auch in dem kasten integrtieren, dafür mit tagesziel tauschen!  / So haben wir einen kasten mit statstitim diese woche, punkte usw. und eine mit tagesziel und Sprachne“

### Runde 4 (action: iterate)

- Allgemeine Notiz: „schau mal, 11 Zeilen! und das was am wichtigsten ist nicht klar groß :/“ (Anhang: .claude/concepts/20261121-1151-karteikarten-neu/attachments/9dbe2c2664fe72bc299d3dc7e8cde10e153bec99b688fbf36af9ae7e048cd28c.png)

### Runde 5 (action: implement)

- Allgemeine Notiz: „devops learn warum live treue nicht wirklich echt ist im sinne von z. BV. ist das seitenlogo nicht das originale unangefasste, auch der setien name... die buttons rechts oben usw... das haben wir aj alles nicht angetastet und doch ist es nicht original, auch der background nicht..“
- Pin `r5-d1-s1` auf a.d5-act.d5-act--s "Ansehen": „den button bruachen wir hier nicht, es sollte reichen wenn ich darüber die entsprehcenden anklicke und für ki hat ... gib dem einfach auch gern eine sonderzeile amende ähnlicher style wie die sprachen!“
- Pin `r5-d1-s2` auf span.d5-keys.d5-desk "Alle Tasten ?": „Alle tasten brauchen wir da nicht textuell stehen!“
- Pin `r5-d1-s2` auf button.d5-act.d5-act--s "Ausnahme für eine Sprache": „hotkey fehlt hierfür“
- Pin `r5-d1-s3` auf a "Kommandozentrale": „steht da wirklich kommandozentrale?! Wi rhaben doch schon admin als label der gesamtgroßseite“

## Checklist — one line per accepted item (each line carries its source; judge against the quote)

### Pipeline (`supabase/functions/translate-orchestrator/` — `_cards.ts`, `_learn.ts`, `_arbiter.ts`, `_learn_pass.ts`; new migration if the schema changes)

- [ ] **P1 Schreibweisen bündeln** — candidates that differ only by case / hyphen / whitespace never become single A/B cards; they become ONE convention card per pattern. Source R1 `d-filter` = casing.
- [ ] **P2 Fremde Klammerzusätze abschneiden** — bracketed text absent from the English source (e.g. „(Aegis Idris)“) is stripped before comparing; if one candidate remains, no card. Source R1 `d-filter` = bracket.
- [ ] **P3 Klare Mehrheit gewinnt** — ≥ 5 votes and ≥ 4 : 1 decides without a card; logged and reversible. Source R1 `d-filter` = majority.
- [ ] **P4 Weitere Muster bündeln** — verb form on buttons (Annulla/Annullare), abbreviation vs. spelled out (XO / Erster Offizier) → one convention question per pattern. Source R1 `d-filter` = patterns.
- [ ] **P5 Zweifelswert neu berechnen** — doubt is no longer 1.0 whenever the two judge orders disagree; it ranks again. Source R1 `d-filter` = doubt (the user added it beyond the recommendation).
- [ ] **P6 Fremde Sprachen: KI entscheidet + Veto** — for languages the admin cannot judge, no A/B cards: the pipeline decides (clear majority, then community text, then AI text), stores a German back-translation + one-line reason + unsure flag; „Sieht falsch aus“ sends it back, doing nothing accepts. Source R1 `d-foreign` = veto; R2 screen note d3-s6 „gut, dass man es per sprache sehr gut im überblick sieht“.
- [ ] **P7 Beurteilbare Sprachen pro Admin** — the set of languages an admin answers as cards is stored per admin (default: German); every other language goes the KI + veto path. Source R1 `d-foreign` context („Jeder Admin legt das einmal fest“).
- [ ] **P8 Konvention für alle Sprachen** — one convention answer applies to all languages, with a per-language exception. Source R1 `d-xlang` = yes; R4/R5 button „Ausnahme für eine Sprache“.
- [ ] **P9 Frage in der UI-Sprache** — cards store kind + parameters (term, examples, counts); the question text comes from de/en i18n templates, never stored English prose. Source R1 `d-preview` = lang.
- [ ] **P10 Wirkung vorab** — each option carries „betrifft N Texte“ and exactly three example strings with the option applied. Source R1 `d-preview` = count; R3 anno r3-d1-s2-a3 „drei beispiele reichen“.
- [ ] **P11 Wann es wirkt** — card states „ab nächstem Lernlauf“ (answers are applied at the next learn pass). Source R1 `d-preview` = when; R5 wording.
- [ ] **P12 Nicht meine Entscheidung** — replaces Skip: the card leaves the admin's deck and goes the KI path, never reappears at the end. Source R1 `d-preview` = notmine.
- [ ] **P13 Rückgängig bis zum Lernlauf** — an answer not yet applied can be undone (server side: back to open). Source R1 `d-answer` = tap „mit Rückgängig“.
- [ ] **P14 Bestand bereinigen** — the 253 open cards run through P1–P7 once (migration or one-shot pass), so the deck starts clean.

### Game layer (DB + UI)

- [ ] **G1 Punkte, Serie, Tagesziel, Rangliste bleiben, neu gedacht** — Source R1 `d-game` = keep, note „Gern neu gedacht und schön integriert, aufgemacht. Das ganze view soll eher wie ein spiel wirken !“.
- [ ] **G2 Combo gestrichen** — no combo anywhere; the reward moment after an answer is the daily-goal step (+ points). Source R3 anno r3-d1-s4-a2 „was wollen wir eigentlich mit kombo? Ist das nicht einfach das was wir in tageszeil schon haben“.
- [ ] **G3 Punkte** — 20 per decision + a bonus when the daily goal (10) is full; weekly points (week starts Monday). Source: round-4/5 mock (s4–s5), accepted by the implement click.
- [ ] **G4 Rangliste mit Namen** — other admins by display name, own row „Du“. Source R2 pin „genua hier unten die anderne namen der anderen leite. Du bleibt bei du ist ok!“, R2 anno „namen“, R3 anno „passt“.

### UI (`src/app/admin/translations/translation-cards.component.ts` rewrite + shell `translations.component.ts`)

- [ ] **U1 Menü links am Seitenrand wie HQ** — the six tabs leave the horizontal pill row and become the shared section rail at the page edge (`src/app/shared/section-rail/section-rail.component.ts`, as wrapped by `src/app/hq/hq-rail.component.ts`; phone: bottom page bar like `src/app/hq/hq-page-bar.component.ts`). Tabs become real anchors. Source R2 pin „mach dieses menü genau links am seitenrand wie in hq etc. wollen das gleich haben“.
- [ ] **U2 Duell-Karte** — one card, the two options as its two halves, three examples each, muted meta, the option text the brightest and largest. Source R3 favourite d1; R3 anno „viele formen, viel weiße text zeilen … nicht lightweight“; R4 general „11 Zeilen! und das was am wichtigsten ist nicht klar groß“.
- [ ] **U3 Antippen = Antwort, Hotkeys, Wischen** — tap answers + auto-advance; desktop ←/→ (or 1/2), E = eigener Text, ↑ = Nicht meine Entscheidung, Enter turns the deck; phone swipe left/right = option, up = nicht meine Entscheidung. Source R1 `d-answer` note „Ja plus bitte tasten auch verwenden hotkeys, aber auch auf dem handy swipen!“; R2 anno r2-d2-s3-a1 „k“.
- [ ] **U4 Hotkey für „Ausnahme für eine Sprache“** — Source R5 pin r5-d1-s2 „hotkey fehlt hierfür“.
- [ ] **U5 Kein „Alle Tasten“-Text** — no visible „Alle Tasten“ label on the card; the `?` key may still open the key sheet. Source R5 pin r5-d1-s2 „Alle tasten brauchen wir da nicht textuell stehen!“.
- [ ] **U6 Rückgängig = App-Undo-Toast** — use `UndoToastService` / `src/app/shared/undo-toast/` (Strg+Z too), no own undo bar. Source R2 pin „rückgängig haben wir doch eine reguläre darstelujn!?“.
- [ ] **U7 Keine Leiste unten, kein Start-Knopf** — the deck itself is the start (tap / Enter turns it). Source R3 pins „brauchen wir den button hier?! haben doch obenb schon alles“ and „ich weiß gar nicht ob wir das hier unten als balken überhaput brauchen“.
- [ ] **U8 Box links „Tagesziel & Sprachen“** — daily-goal ring + one row per language (Deutsch = your deck, the four KI languages with count + unsure); clicking a row opens that deck / that veto list. Source R3 pins „sollte das hier rechts nicht eher links stehen und rechts das was links steht“ and „… einen kasten mit statistik diese woche, punkte usw. und eine mit tagesziel und Sprachen“.
- [ ] **U9 KI-Zusammenfassung als Sonderzeile, kein „Ansehen“-Knopf** — the „KI hat 199 entschieden, 9 unsicher“ summary becomes a special last row styled like the language rows; the „Ansehen“ button goes. Source R5 pin r5-d1-s1 „den button bruachen wir hier nicht, es sollte reichen wenn ich darüber die entsprehcenden anklicke und für ki hat ... gib dem einfach auch gern eine sonderzeile amende ähnlicher style wie die sprachen!“ (replaces R3 „finde ich sehr gut“ on „Ansehen“).
- [ ] **U10 Box rechts „Statistik“** — Platz, Rangliste (G4), Punkte dieser Woche, Serie (7-day row). Source R3/R4 as U8.
- [ ] **U11 Veto im selben Spielrahmen** — veto items are cards in the same Duell language (hero = KI text large, German meaning directly under it, ⚠ reason, „Sieht falsch aus“ / „Passt“), ≤ 5 lines, same rail and boxes. Source R2 pin „das sieht mir viel zu anders aus! ALs der ander eworkflow :/“; R4 general „11 Zeilen!“.
- [ ] **U12 Nach der Antwort** — chosen text large + the daily-goal step highlighted + „+20 Punkte · N Texte vereinheitlicht“. Source R2 anno „gern noch ein ticken mehr highlighten“; G2.
- [ ] **U13 Stapel geschafft** — „Alles geklärt für Deutsch“, what changes and when, the ring never overlapping square cards. Source R2 pin „die idee mit dem ring gut, aber irgendwie doof, mit dem überlappten zum quadrat karteikarten...“.
- [ ] **U14 Kein Text-Überstand** — no text overflows a button or card at any width. Source R2 pin „Kann nicht sein, dass es textuell übersteht“.
- [ ] **U15 Keine „Kommandozentrale“-Dopplung** — this page's header does not show „Kommandozentrale“ as crumb next to the „Admin“ eyebrow; the way back to the admin hub stays (crumb labelled „Admin“ → `/admin/hub`, eyebrow not repeating it). Source R5 pin r5-d1-s3 „steht da wirklich kommandozentrale?! Wi rhaben doch schon admin als label der gesamtgroßseite“.
- [ ] **U16 Phone** — one column, a slim HUD strip (ring, Punkte, Platz, Serie), swipe, nothing under the feedback launcher (`--sc-float-bottom`, `.sc-dock-phone`, `dvh`). Source R2–R5 phone screens.

### Cross-cutting (project rules, CLAUDE.md)

- [ ] **X1 i18n** — every string in `public/i18n/{de,en}.json`; card questions from templates (P9).
- [ ] **X2 Analytics** — catalogue events in `src/app/core/analytics/events.ts` for deck start, answer, not-mine, undo, veto flag, deck finished; a PostHog tile in `posthog/dashboards.json` showing whether decks get finished (project concept rule 7).
- [ ] **X3 Errors** — failures via `toErrorKey` / `describeError`, an error state with retry.
- [ ] **X4 Tests** — Vitest specs for the new component logic, `node --test` for the pipeline filters (P1–P5, the P6 tie-break), DB test for new RPCs.
- [ ] **X5 Conventions** — `scAction` for actions, real anchors for navigation, no native dialogs / tooltips / selects, focus ring keyboard-only; admin-only marked by colour only; worse values `--sc-warning`.

## Not in scope

- The user's plugin feedback (Live-Treue hover hints JerryT2T/dotclaude#1179, note-FAB dot #1180, „Concept öffnen“ button #1186, and the round-5 note on Live-Treue fidelity) — filed against the devops plugin, not this repo.

## Acceptance

Each implementing agent returns one row per checklist line it owns: line → done / partial / not done → evidence
(file:line, test, screenshot). An independent `devops:qax` compares every line and quote against the diff and
screenshots of the real result before the final report.
