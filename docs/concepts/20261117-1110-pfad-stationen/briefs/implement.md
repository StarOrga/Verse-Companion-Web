# Implement brief — "Pfad eines Gegenstands": wishes assigned to an Operation

Concept: `docs/concepts/20261117-1110-pfad-stationen` · decisions:
[`../../20261117-1110-pfad-stationen-decisions.json`](../../20261117-1110-pfad-stationen-decisions.json) · living spec
this continues: `docs/concepts/nachschub-hq-ui-spec.md` · mock ↔ line map: [`../parity.md`](../parity.md).

The owner clicked "Mit Feedback implementieren" on round 4. This file is the binding order. **Every checklist line
carries the owner's own words; on a conflict between a line and its quote, the quote wins.** Later rounds override
earlier ones. The complete, unshortened feedback of all four rounds is in the appendix at the end (generated from the
submitted payloads).

Binding visual spec (the mocks): `rounds/04.html` (designs `pfad`, `entfernen`) and, for rows and cards only,
`rounds/03.html` screen `pfad-liste`. The round-4 remarks below **override** the round-4 mocks where they differ
(lines B4, B5, C1, C7, D2).

Project rules that bind every line: `CLAUDE.md` (all strings via ngx-translate in `public/i18n/{de,en}.json`,
navigations are real anchors, one action control `scAction`, no native dialogs → `ScConfirmService` / `[scDialog]`,
a modal closes only by X / Abbrechen / Escape, focus ring rules, errors via `toErrorKey`, phones: nothing under the
feedback launcher, `dvh` for tall sheets, new user action = an event from the catalogue).

## What stays as it is

- Code identifiers keep the word `nachschub` (types, services, files, tables, existing analytics event names). Only
  **visible** texts change to "Operation".
- No change to how Einsätze are planned, to the 7 slots, the name limits, the sale and event types.
- Search rows and cards never assign; they only show the sign.

## Checklist

Status per line in the acceptance table: `done` / `partial` / `not done` + evidence (file:line, test, screenshot).

### A · Rules and data (domain: core)

- **A1 — A wish stays a wish when it is assigned.** Assigning pieces of a wish to an Operation no longer lowers the
  wishlist quantity; the wish keeps its quantity and gains a link to the Operation's line(s). Today
  `NachschubService.createFromWishlist` / `addFromWishlist` move the quantity off the wishlist (`shiftWishes(…
  delta: -qty)`), and "leeren" gives it back; that contract flips.
  > R1: "Oder wir machen das wording weg und am Ende hat man in der ... Einsatzgruppe... (anderer Name!) einfach elemente der wunschliste. Sprich Wünsche sind einer Einsatzgruppe zugeordnet, was hier dann eher unter wünsche fallen würde, statt ein dritter kasten. Ich tendiere zu letzteren"
  > R2 decision "Wunsch bleibt Wunsch": `bleibt` (as recommended).
- **A2 — The header counter and the wishlist keep counting an assigned wish.**
  > R2 decision "Zähler im Kopf": `yes`.
- **A3 — Invariant.** For one item (kind + className [+ forClassName]) the pieces assigned over all active
  Operationen never exceed the wished quantity. `free = wished − assigned`. Every write path keeps it (service
  level, covered by unit tests).
- **A4 — Free pieces go first, without a question.** Lowering a wish takes free pieces first; as long as they cover
  it nothing is asked, the result carries an undo.
  > R3 decision "Freie Stücke zuerst": `yes`.
- **A5 — A removal that cuts into assigned pieces is asked first, with a quantity.** Nothing changes before the
  dialog is confirmed; the chosen pieces leave the wishlist **and** their Operation(s).
  > R2 note on "Entfernen, wenn zugeordnet": "Genau, aber man muss sich entscheiden, wenn man so viele von der wunschliste von dem gegenstand entfernt, dass nur noch die übrig bleiben die zugeordnet sind, dann solld er nutzer gefragt werden, ob und wie viele entfernt werden sollen, und das diese aus dem projekt auch entefrfertn werden - ggf. inkl. hinweis, dass dadurch dasg esamte projekt aufgelöst ist, falls das so ist und das das einzige drin war. Denke das ochmla tief durhc"
  > R3 decision "Was der Dialog fragt": `menge` (as recommended).
- **A6 — Several Operationen hold the item:** the most recently assigned one gives first; the user can shift the
  split per Operation; the parts must add up.
  > R3 decision "Mehrere Operationen": `neueste`. R3 pin on the screen: "sehr gut!"
- **A7 — An Operation that loses its last wish:** it stays when it has at least one Einsatz (planned or done), and
  the dialog offers an unticked "Operation auch auflösen"; with no Einsatz at all it is dissolved along with the
  wish, and the dialog says so before the click.
  > R3 decision "Operation ohne Wunsch": `einsaetze`. R3 pins on both screens: "sehr gut!" / "Sehr gut!"
- **A8 — A fulfilled wish stays in the Operation as reached.** When the item arrives in Inventar / Hangar the
  Operation's line is ticked and stays visible; nothing is asked.
  > R3 decision "Wunsch erfüllt": `yes`.
- **A9 — Releasing a wish inside the HQ always asks.** The wish stays on the wishlist and becomes free again, unless
  the user picks the third, red choice, which also deletes it from the wishlist (line C7).
  > R3 decision "Lösen im HQ" ("ohne Nachfrage?"): `no`. R4 decision "Nachfrage im HQ": `immer`.
  > R4 pin on the confirmation: "oder die option sie auch von der wunschliste zu löschen als dritten button!? rot"
- **A10 — One undo restores everything of one action:** the wish quantity, the assignments and a dissolved
  Operation (with its name and slot) in one step.
- **A11 — Existing data.** Open lines that today sit in an active Nachschub and came from the wishlist had their
  quantity moved off the wishlist. After the change they must read as "wished and assigned": bring the quantities
  back onto the wishlist once (migration or a one-time client reconcile, idempotent), documented in the migration /
  code comment. Closed lines and event / sale lines are untouched. (Alpha data policy applies; say what was done.)
- **A12 — Analytics.** Two events in the catalogue `src/app/core/analytics/events.ts`, named per
  `docs/analytics/event-naming.md`, fired from the surfaces below: `hq:path_group_assign { surface, created }`
  (surface = `codex` | `hq` | `wishlist`, created = a new Operation was made) and `hq:path_group_release { surface,
  pieces, dissolved }`. Report: the funnel "wish → assigned → fulfilled" on the HQ dashboard in PostHog (needs the
  owner's `npm run analytics:sync` / `posthog:apply`; name it in the result, do not run it).

### B · The path control in the Codex (domain: frontend) — mocks `rounds/04.html` design `pfad`

- **B1 — Two stations only: wish and ownership. The assignment lives inside the wish station.** No third station.
  > R2 favourite: design "Am Wunsch". R2 pin: "finde ich gut hier!"
- **B2 — Both stations are built alike:** head (icon, word, − n + counter) → a status strip only when there is
  something to say → otherwise only the action button.
  > R3 user pin on "Ins Inventar": "Wenn es im inventar ist, sieht man darunter auch so eine leiste, die z. B. anzeigt wo? Ich würde gern die beiden kästen ähnlich halten !"
- **B3 — Not assigned: only the button "Zuordnen"**, same tier, size and place as "Ins Inventar" (the existing
  empty-state button of the ownership station in `src/app/shared/item-path/item-path.component.ts`; read its markup
  and classes there and mirror them).
  > R3 user pin on "Keiner Operation zugeordnet · Zuordnen": "wenn keiner operation zugeordnet, reicht einfach der zuronden button ohne die ganze leiste, analog zu ins inventar!"
- **B4 — Assigned: the strip** with the Route glyph, "N in Operation „Name“", **then the progress marks, then the
  text "1 von 4 Einsätzen"** (marks before the text), as a real link into the HQ to that Operation.
  > R4 user pin on "1 von 4 Einsätzen": "1 von 4... sollte nach den balken stehne, oder?"
  > R2 pin: "sehr gut" (the assign control in the wish station).
- **B5 — Ownership strip in one line:** "N× im Inventar · <one place>" plus a hint for further places ("+2 weitere
  Orte"); the other places are reached through the existing link "Im Inventar ansehen". Which place: the one
  nearest to the player's current position when the app knows it (check what the HQ live data offers,
  `src/app/hq/now/hq-live.util.ts` `placeLabel` and the inventory places of `ItemPathState`); otherwise a stable,
  documented fallback (e.g. "bei mir" first, then the place with the most pieces). Never more than one line. A ship
  shows "Im Hangar" without a place.
  > R4 pin: "perfekt, double check wie du das in eine zeile bekommst bei mehrere orten oder du zeigst mir nur den nähsten ort geografpisch von meiner position und einen hinweis auf weitere orte, die anderen sieht man dann ja bei klicka uf inventar"
- **B6 — The picker hangs on its button:** it opens directly under "Zuordnen" with a caret pointing at it, the
  button shows its open state (as "Ins Inventar" does while "Wo liegt es?" is open); it never covers the button.
  Reuse the popup mechanics the ownership station already uses (`sc-popup` in the same component).
  > R3 user pin on the picker title: "finde ich super, aber irgendwie nicht zugeordnet zu dem zurodnen button!? Das sollte sich ja visuell daran anschließen"
- **B7 — The picker's content:** quantity stepper preset to the whole free quantity; the active Operationen ordered
  by creation, newest first, each with its progress; "Neue Operation" as the last row (created with a name only, the
  name is proposed; Einsätze are planned in the HQ afterwards); footer "N von 7 Plätzen belegt · Einsätze planst du
  im HQ" where "im HQ" is a real anchor to `/hq#planen`. With all 7 slots taken "Neue Operation" is disabled with
  the reason.
  > R2 pin: "sehr gut, immer das maximale vorgeschlagne" · R2 pin: "Das macht Sinn!" (new one by name only)
  > R3 user pin: "Ich denke es wäre gut, dass danach anzuordnen welcher als letztes erstellt wurde oben und neue operation unten belassen"
  > R3 user pin on the footer: "hq als link!? zur planen sektion!?"
  > R2 decisions: "Weg zum Zuordnen" `auswahl`, "Wie viel" `alle`, "Neue Gruppe aus dem Codex" `yes`.
- **B8 — Rows and cards (search, Codex lists):** the wish circle keeps its solid ring; a small Route badge marks an
  assigned wish; rows do not assign. Mock: `rounds/03.html` screen `pfad-liste`.
  > R2 pin: "gestrichelt ist zu viel, aber das projekt icon ist supoer" · R3 pin: "ja" · R2 decision "Zuordnen in Suchzeilen": `nur-detail`.
- **B9 — The symbol of the group is the Route glyph** (paths `M5 17v-4a3 3 0 0 1 3-3h8a3 3 0 0 0 3-3`,
  `M5 17a2 2 0 1 0 0 4a2 2 0 1 0 0-4z`, `M19 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z`) wherever the tray icon stood for a
  Nachschub (`PATH_ICONS.nachschub`, `NACHSCHUB_ICON_PATHS` and their users).
  > R2 decision "Symbol der Gruppe": `route`.
- **B10 — Phone:** the picker sits in the flow under its button, names wrap instead of being cut, nothing lies
  under the feedback launcher.

### C · Removing and releasing (domain: frontend) — mocks `rounds/04.html` design `entfernen`

- **C1 — The removal dialog:** title "<Item> entfernen", stepper "Wie viele entfernen?" (1 … wished, preset to
  what the user triggered), the caption "Diese N Stücke gehen:" and one segmented bar whose segments carry their
  own labels ("2 frei", "3 aus „Bodentrupp ausrüsten“"), no separate legend. **All segments share one style (same
  background and border); the Route icon and the text alone mark the Operation segments.** A label that does not
  fit hangs under its segment on a tick.
  > R3 pin: "jain, die balken waren mir nicht zugeordnet genugg zur legende, sprich was die balken zu tun haben dort war erst auf dem driitten blick kalr"
  > R4 pin: "jetzt besser wobei der untershciedliche farbakzent nicht hilfreich ist vom background und linike. 2 frei und das angelichen dahingehend! generell  vom style. Durch das icon und den vielen text ist shcon klar genug, das das nicht freie sind und was besonderes."
- **C2 — Several Operationen:** one row per Operation with its own stepper, the hint "zuletzt zugeordnet" on the
  preset one, and the sum line "4 von 4 verteilt".
  > R3 pin: "sehr gut!"
- **C3 — Last wish, Operation stays:** hint "„Name“ hat danach keinen Wunsch mehr. Die N Einsätze bleiben." and the
  unticked checkbox "Operation auch auflösen"; default-tone action.
  > R3 pin: "sehr gut!"
- **C4 — Last wish, empty Operation:** hint in the danger colour "„Name“ hat keinen Einsatz und wird mit
  aufgelöst." and the danger-tone action "Entfernen und auflösen".
  > R3 pin: "Sehr gut!"
- **C5 — The same bar in all four dialogs**, also with a single segment.
  > R3 user pin on the last-wish dialog: "aber dann hier ohne balken? Naja, das balken thema eh nochmal überarbeiten"
- **C6 — One dialog for every way to remove or lower a wish:** the wishlist row (− and the bin), the cart counter on
  a Codex detail page, the wish button of the path. Free-only changes never open it (A4).
- **C7 — Releasing in the HQ:** a short confirmation "<Item> aus der Operation lösen?" with the text "Die N Stücke
  bleiben auf deiner Wunschliste und werden wieder frei." and **three** buttons: "Abbrechen", "Lösen" (default
  tone) and a red, danger-tone "Auch von der Wunschliste löschen". If that release empties the Operation, the rule
  of A7 applies and the dialog says so.
  > R4 pin: "oder die option sie auch von der wunschliste zu löschen als dritten button!? rot"
- **C8 — Phone:** dialogs are bottom sheets sized with `dvh`, scroll inside when taller than the screen.

### D · The undo toast (domain: frontend) — mock `rounds/04.html` screen `entfernen-frei`

- **D1 — The new look:** a solid surface with a cyan accent edge on the left, an icon in the accent tint, the
  message with the item name bold, an optional quiet second line, a clearly visible pill "Rückgängig" and a thin
  line along the bottom that runs out with the time left to undo. About 440px wide on desktop, full width minus
  gutters on the phone, clear of the feedback launcher.
  > R3 pin: "der ist noch nicht so suppper hübsch... gern polishen! Muss mehr eye catching sein"
- **D2 — Everywhere.** Every toast in the app that offers "Rückgängig" gets this look: change the shared component
  (`src/app/shared/undo-toast/`, `toast-stack`) rather than one caller, and check each caller still reads well.
  > R4 pin: "viel besser ja! BITTE GENERELL FÜR ALLE rückgängig toast einführen!"
- **D3 — The changed counter in the row is highlighted briefly** after a removal, so the eye connects row and toast
  (respecting reduced motion).

### E · Words (domain: frontend, one owner for `public/i18n/*`)

- **E1 — "Operation" replaces "Nachschub" in every visible German text** (about 69 lines of `public/i18n/de.json`,
  compounds included: "Nachschub-Slots" → "Operationen" / "Plätze" as the sentence needs), with matching English
  ("Operation") in `en.json`. Grammar is adjusted per sentence (die Operation, Plural Operationen), never a blind
  search-and-replace. `docs` that describe the feature to users follow.
  > R2 decision "Wort Nachschub" (does it disappear?): `yes`. R4 decision "Das Wort Operation" (stays?): `yes`.
  > R2 note: "Projekt finde ich gut, aber wenig thematisch und klingt nach monaten des beschäftigens hmmm"
- **E2 — "Einsatzgruppe" is never used for this** (it names friends groups and is historically loaded).
- **E3 — Every new text is an i18n key in both languages;** no hard-coded UI text.

### F · Proof

- **F1 — Tests:** unit tests for A1–A11 (service level: assign keeps the wish, invariant, free first, split over
  several Operationen, last wish with and without Einsätze, undo, the data reconcile), component tests for the path
  control states (not assigned / assigned / owned / picker) and the removal dialog; the existing specs that assert
  the old "moves off the wishlist" contract are rewritten, not deleted.
- **F2 — Gates:** `npm run typecheck`, `npm run lint`, `npm test` (area runs while building, the full run once),
  `npm run build` (templates are only checked by the build).
- **F3 — The living spec** `docs/concepts/nachschub-hq-ui-spec.md` records the new rules (two stations, assignment
  in the wish station, the removal rules, the word) and marks the overruled old lines ("One path: Wunschliste →
  Nachschub → Bestand", "No Nachschub node outside HQ") as replaced.

## Appendix — the owner's feedback of every round, word for word

Generated from the submitted `/decisions` payloads. Nothing is shortened or corrected.

### Round 1 — action `iterate`, favourite `d2`

- Pin `r1-d2-schiff-a1` (screen `d2-schiff`) — question: "Nachschub erscheint nur, wenn etwas unterwegs ist. Soll die Station stattdessen immer zu sehen sein, auch leer?"

  > Ja, immer  ansehen. Und lass uns Nachschub umbenennen auch von der ikonografie. Man versteht aktuell nicht, dass es eher ein Einsatzgruppe ist, in der man mehrere Einsätze macht (darunter Typen Missionen vom Spiel oder auch nur Sammeln, tranpsortieren usw.) um dann letztlich sich u. A. hier die Polaris als Nachschub zu erspielen. 
  > Wir könnten nachschub auch lassen und dafür einfach hier und im HQ hervorheben das der Hauptpunkt der Einsatzgruppe an sich ist und dabei fällt dann Nachschub für Inventar und Hagnar usw. ab.
  > Oder wir machen das wording weg und am Ende hat man in der ... Einsatzgruppe... (anderer Name!) einfach elemente der wunschliste. Sprich Wünsche sind einer Einsatzgruppe zugeordnet, was hier dann eher unter wünsche fallen würde, statt ein dritter kasten.
  > 
  > Ich tendiere zu letzteren, aber lass uns das bitte in der nächsten Runde nbochmal intensiv concepten.

- Pin `r1-d2-schiff-a2` (screen `d2-schiff`) — question: "Ein Klick führt ins HQ zum Paket. Soll man von hier aus auch selbst etwas in einen Nachschub legen können?"

  > Ja schon, aber wie, wie viel. Check auch das mit devops agents und mach vorschläge..

- Pin `r1-d2-liste-a1` (screen `d2-liste`) — question: "In Zeilen wird Nachschub zum dritten Kreis, sobald etwas unterwegs ist. Auch hier zeigen, oder nur auf der Detailseite?"

  > Hmmm, hänmgt von der schiffseite ab den überlegungen

### Round 2 — action `iterate`, favourite `wunsch`

- Decision `d-name` "Name der Gruppe": `Projekt` (recommended `projekt`)

  > Projekt finde ich gut, aber wenig thematisch und klingt nach monaten des beschäftigens hmmm
  > 
  > Weitere vorhscläge?

- Decision `d-icon` "Symbol der Gruppe": `route` (recommended `route`)

- Decision `d-wort` "Wort Nachschub": `{"answer":"yes","alt":""}` (recommended `yes`)

- Decision `d-menge` "Wunsch bleibt Wunsch": `bleibt` (recommended `bleibt`)

- Decision `d-zaehler` "Zähler im Kopf": `{"answer":"yes","alt":""}` (recommended `yes`)

- Decision `d-entfernen` "Entfernen, wenn zugeordnet": `fragen` (recommended `fragen`)

  > Genau, aber man muss sich entscheiden, wenn man so viele von der wunschliste von dem gegenstand entfernt, dass nur noch die übrig bleiben die zugeordnet sind, dann solld er nutzer gefragt werden, ob und wie viele entfernt werden sollen, und das diese aus dem projekt auch entefrfertn werden - ggf. inkl. hinweis, dass dadurch dasg esamte projekt aufgelöst ist, falls das so ist und das das einzige drin war. Denke das ochmla tief durhc

- Decision `d-weg` "Weg zum Zuordnen": `auswahl` (recommended `auswahl`)

- Decision `d-wieviel` "Wie viel": `alle` (recommended `alle`)

- Decision `d-neu` "Neue Gruppe aus dem Codex": `{"answer":"yes","alt":""}` (recommended `yes`)

- Decision `d-zeilen` "Zuordnen in Suchzeilen": `nur-detail` (recommended `nur-detail`)

- Pin `r2-wunsch-schiff-a1` (screen `wunsch-schiff`) — question: "Die Zuordnung steht als Zeile im Wunsch-Kasten, so wie du es zuletzt beschrieben hast. Fällt sie dir hier genug auf, oder geht sie unter?"

  > finde ich gut hier!

- Pin `r2-wunsch-offen-a1` (screen `wunsch-offen`) — question: "Der Knopf zum Zuordnen sitzt im Wunsch-Kasten. Richtige Stelle, oder gehört er prominenter hin?"

  > sehr gut

- Pin `r2-wunsch-zuordnen-a1` (screen `wunsch-zuordnen`) — question: "Voreingestellt ist die ganze Wunschmenge, hier 3. Passt das, oder soll erst einmal nur 1 Stück vorgeschlagen werden?"

  > sehr gut, immer das maximale vorgeschlagne

- Pin `r2-wunsch-zuordnen-a2` (screen `wunsch-zuordnen`) — question: "Von hier aus entsteht ein neues Projekt nur mit Namen, ohne Einsatz. Die Einsätze planst du danach im HQ. In Ordnung so?"

  > Das macht Sinn!

- Pin `r2-wunsch-liste-a1` (screen `wunsch-liste`) — question: "Gestrichelter Ring plus kleines Zeichen am Wunsch-Kreis heißt: gehört zu einem Projekt. Erkennst du das in Zeilen und Karten?"

  > gestrichelt ist zu viel, aber das projekt icon ist supoer

### Round 3 — action `iterate`, favourite `none`

- Decision `r3-d-name3` "Name der Gruppe": `Operation` (recommended `operation`, untouched)

- Decision `r3-d-frei` "Freie Stücke zuerst": `{"answer":"yes","alt":""}` (recommended `yes`)

- Decision `r3-d-dialog` "Was der Dialog fragt": `menge` (recommended `menge`)

- Decision `r3-d-mehrere` "Mehrere Operationen": `neueste` (recommended `neueste`)

- Decision `r3-d-leer` "Operation ohne Wunsch": `einsaetze` (recommended `einsaetze`)

- Decision `r3-d-erfuellt` "Wunsch erfüllt": `{"answer":"yes","alt":""}` (recommended `yes`)

- Decision `r3-d-hq` "Lösen im HQ": `{"answer":"no","alt":""}` (recommended `yes`, **deviates**)

- Pin `r3-pfad-liste-a1` (screen `pfad-liste`) — question: "Der Ring ist wieder durchgezogen, nur das kleine Zeichen zeigt die Operation. Reicht das, um zugeordnete Wünsche zu erkennen?"

  > ja

- Pin `r3-entfernen-frei-a1` (screen `entfernen-frei`) — question: "Hier fragt nichts nach, unten erscheint nur der Hinweis mit „Rückgängig“. Fällt er dir auf, oder übersiehst du ihn?"

  > der ist noch nicht so suppper hübsch... gern polishen! Muss mehr eye catching sein

- Pin `r3-entfernen-dialog-a1` (screen `entfernen-dialog`) — question: "Unter dem Zähler steht sofort, was frei ist und was aus der Operation fällt. Verstehst du diese Zeile auf einen Blick?"

  > jain, die balken waren mir nicht zugeordnet genugg zur legende, sprich was die balken zu tun haben dort war erst auf dem driitten blick kalr

- Pin `r3-entfernen-mehrere-a1` (screen `entfernen-mehrere`) — question: "Jede Operation hat ihre eigene Zeile mit Zähler, darunter steht die Summe. Siehst du auf einen Blick, was aus welcher Operation fällt?"

  > sehr gut!

- Pin `r3-entfernen-letzter-a1` (screen `entfernen-letzter`) — question: "Der Hinweis sagt, dass die Operation ohne Wunsch zurückbleibt, darunter sitzt der Haken zum Auflösen. Klar genug, oder zu viel Text?"

  > sehr gut!

- Pin `r3-entfernen-aufgeloest-a1` (screen `entfernen-aufgeloest`) — question: "Hinweis und Knopf sind hier rot, weil die Operation mit verschwindet. Angemessen deutlich, oder zu alarmierend?"

  > Sehr gut!

- Own pin `up-mwknv49q9yz4` (screen `pfad-offen`, on span.ipr-free "Keiner Operation zugeordnetZuordnen")

  > wenn keiner operation zugeordnet, reicht einfach der zuronden button ohne die ganze leiste, analog zu ins inventar!

- Own pin `up-mwknvhorsj2w` (screen `pfad-offen`, on span.ipm-btn "Ins Inventar")

  > Wenn es im inventar ist, sieht man darunter auch so eine leiste, die z. B. anzeigt wo? Ich würde gern die beiden kästen ähnlich halten !

- Own pin `up-mwknxddbg0ea` (screen `pfad-zuordnen`, on b.ipm-pt "Einer Operation zuordnen")

  > finde ich super, aber irgendwie nicht zugeordnet zu dem zurodnen button!? Das sollte sich ja visuell daran anschließen

- Own pin `up-mwknxx4s1r5z` (screen `pfad-zuordnen`, on span.ipm-prow.on "Flotte ausbauen2/5")

  > Ich denke es wäre gut, dass danach anzuordnen welcher als letztes erstellt wurde oben und neue operation unten belassen

- Own pin `up-mwknyuuim75d` (screen `pfad-zuordnen`, on span.ipm-mut.ipm-pf "3 von 7 Plätzen belegt · Einsätze planst")

  > hq als link!? zur planen sektion!?

- Own pin `up-mwko3wxxjgj1` (screen `entfernen-letzter`, on span "1 aus Operation „Flotte ausbauen“")

  > aber dann hier ohne balken? Naja, das balken thema eh nochmal überarbeiten

### Round 4 — action `implement`, favourite `none`

- Decision `r4-d-name4` "Das Wort Operation": `{"answer":"yes","alt":""}` (recommended `yes`)

- Decision `r4-d-hqfrage` "Nachfrage im HQ": `immer` (recommended `immer`)

- Pin `r4-pfad-beides-a1` (screen `pfad-beides`) — question: "Die Leiste im Besitz-Kasten zeigt Menge und Ort. Ist der Ort das, was du dort sehen willst, oder etwas anderes?"

  > perfekt, double check wie du das in eine zeile bekommst bei mehrere orten oder du zeigst mir nur den nähsten ort geografpisch von meiner position und einen hinweis auf weitere orte, die anderen sieht man dann ja bei klicka uf inventar

- Pin `r4-entfernen-frei-a1` (screen `entfernen-frei`) — question: "Der Hinweis ist jetzt breiter, hat eine Akzentkante und einen deutlichen Knopf. Fällt er dir so auf?"

  > viel besser ja! BITTE GENERELL FÜR ALLE rückgängig toast einführen!

- Pin `r4-entfernen-dialog-a1` (screen `entfernen-dialog`) — question: "Die Beschriftung steht jetzt im Balken, die Legende ist weg. Ist auf den ersten Blick klar, welche Stücke gehen?"

  > jetzt besser wobei der untershciedliche farbakzent nicht hilfreich ist vom background und linike. 2 frei und das angelichen dahingehend! generell  vom style. Durch das icon und den vielen text ist shcon klar genug, das das nicht freie sind und was besonderes.

- Pin `r4-entfernen-hq-a1` (screen `entfernen-hq`) — question: "Du wolltest hier eine Nachfrage. Ist diese kurze Bestätigung das, was du meintest?"

  > oder die option sie auch von der wunschliste zu löschen als dritten button!? rot

- Own pin `up-mwkq4yet4dzb` (screen `pfad-beides`, on span.ipm-mut "1 von 4 Einsätzen")

  > 1 von 4... sollte nach den balken stehne, oder?
