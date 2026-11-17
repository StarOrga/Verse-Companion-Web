# Implement brief, part 2 — round 5: the two stations on item and ship pages, and the Holotisch menu

Continues `briefs/implement.md` (lines A1–F3, all built). The owner answered round 5
(`docs/concepts/20261117-1110-pfad-stationen/rounds/05.html`, frozen) with the action **implement**. Decisions file:
`docs/concepts/20261117-1110-pfad-stationen-decisions.json`. Everything of rounds 1–4 stays as built; this part only
decides and builds **where the two stations live**.

## What the owner said in round 5 — verbatim

- Favourite design: **`kaesten`** ("Zwei Kästen": the card goes, item and ship pages show the two stations).
- Decision `r5-d-bauplan` ("Bauplan- und Vorschau-Seiten: wann zeigen sie die zwei Kästen?"): **`immer`** — "Immer,
  wenn du angemeldet bist". (The recommendation was `gewuenscht`; the owner chose otherwise, on purpose.)
- Decision `r5-d-einfach` ("Soll die Ansicht „Klassisch“ von Gegenständen eine Wunsch-Steuerung bekommen?"): **`ja`**
  — "Ja, dieselbe Steuerung unter dem Kopf der Seite".
- Decision `r5-d-holo` ("Schiffe im Holotisch … Wo zuordnen?"): left on the recommendation **`menue`** — "Im
  Hangar-Menü unter „Wunschliste“" — and then widened by the note below.
- General note, with a screenshot of the Holotisch hangar menu in the beta shell
  (**[Anhang-Datei]** `.claude/concepts/20261117-1110-pfad-stationen/attachments/cb8e8d66f274ff725741a2e5358b1e03dbb78dbf5e4fecc8f4290a2db4e04343.png`
  — Read it before changing anything; it shows the trigger "1× im Hangar · Werk ▾" and its menu with the groups
  AUSSTATTUNG (Werk, Codex-Loadout), HANGAR ("+ Als Exemplar in den Hangar", "+ Noch eine Anvil Liberator in den
  Hangar", "Im Hangar öffnen ›") and WÜNSCHE ("♡ Zu den Wünschen")):

  > im holotisch in beta haben wir auß0erdem eine andere visualisierung, rethink die ggf. inkl. der neuen karten logik dort für den wiederkennugnswert - oder wenn der nicht benötigt, weil einzige stelle (abgesehne von klaassicsher beta nanischt), dann gern nochmal die darstellung generell r ethinken und mergen damit . Btw. du brauchst nur beta versionen anzugleichen!

  Reading (the orchestrator's, labelled as such): the Holotisch's hangar menu is a third way of showing wish and
  ownership. The owner wants it rethought so that the logic of the two stations is recognisable there too, or the
  presentations merged into one. And only the **beta** versions of the pages have to be brought in line; the
  non-beta shell may stay as it is, as long as nothing in it breaks.
- No pin of round 5 was answered.

## Checklist — one line per accepted item

### G · Where the two stations live (domain: frontend) — mocks `rounds/05.html`, design `kaesten`

- **G1 — Item pages (Holotisch view of an item, the side panel `aside.it-panel`) and ship pages (classic view, under
  the picture) show the two stations of round 4 in place of the card** `sc-codex-own-card` ("Haben?" / "Dein Lager"
  / "Dein Exemplar"). Item page: the panel is narrow, the stations stand one under the other (screens
  `kaesten-offen`, `kaesten-zugeordnet`, `kaesten-besitz`). Ship page: side by side with the connector, as on the
  blueprint page (screen `kaesten-schiff`). Phone: stacked, picker in the flow (screen `kaesten-handy`).
  > R5 favourite: design "Zwei Kästen".
- **G2 — Nothing the card could do is lost.** In the head of the ownership station, as icon buttons (scAction
  tertiary, aria-label + tooltip): items → note, pin, remove (with the existing confirm); ships → rename, note,
  pin, remove (the existing `sc-codex-own-ship-actions`). An item's note text stays visible. A ship's own name
  stands in the ownership strip ("Im Hangar · „Name“"); the link at the end of the strip ("Im Inventar ansehen" /
  "Im Hangar ansehen") replaces "Im HQ zeigen". Kept as well: the signed-out state (hint and the sign-in link), the
  blueprint "Sammlung" variant, the HQ-hosted page (`forceOwned`), the jump and flash from the head strip segment
  (`revealOwnCard`), the hint that a ship sits in an Operation, translated errors.
- **G3 — Blueprint and preview pages show the full two-station form always when the reader is signed in**, not
  only when they come from the HQ or a set (`src/app/codex/path-level.util.ts`). Signed out: as today.
  > R5 decision `r5-d-bauplan`: "Immer, wenn du angemeldet bist".
- **G4 — The classic view of an item page gets the same control under the head of the page.**
  > R5 decision `r5-d-einfach`: "Ja, dieselbe Steuerung unter dem Kopf der Seite".
- **G5 — Holotisch (ships): the hangar menu is rethought so that it reads as the same two stations.** The trigger
  keeps its sentence ("N× im Hangar · <Ausstattung> ▾"). Inside: AUSSTATTUNG stays first (it chooses what the table
  shows). Below it the **wish station** and the **hangar station**, built from the same parts as everywhere else
  (head with icon, word and counter → strip only when there is something to say → otherwise only the action
  button): the wish station with its counter (lowering through the one removal flow, C6), the Operation strip(s),
  "Zuordnen" with the picker working inside the menu (in the flow, never a second floating layer that closes the
  menu), and the wishes that carry a loadout as before; the hangar station with what the HANGAR group offers today
  (as exemplar into the hangar, another one into the hangar, open in the hangar, and the selected exemplar's
  rename / note / pin / remove). The Route badge on the trigger when a wish of this hull is assigned.
  > R5 note: "im holotisch in beta haben wir auß0erdem eine andere visualisierung, rethink die ggf. inkl. der neuen karten logik dort für den wiederkennugnswert - oder wenn der nicht benötigt, weil einzige stelle (abgesehne von klaassicsher beta nanischt), dann gern nochmal die darstellung generell r ethinken und mergen damit ."
  > R5 decision `r5-d-holo`: "Im Hangar-Menü unter „Wunschliste“" (recommendation, left standing).
- **G6 — Scope: the beta shell.** Bring the beta versions in line (`BetaService.isEnabled('shell')`); the non-beta
  shell may keep what it has, and nothing in it may break. Where one template serves both, the new form may show
  in both.
  > R5 note: "Btw. du brauchst nur beta versionen anzugleichen!"
- **G7 — No dead code.** Where the card is replaced and no caller is left, the component, its specs and its i18n
  keys go. Where the non-beta shell still uses it, it stays and keeps working.
- **G8 — The rules of rounds 1–4 hold in every new place:** free pieces first, the removal dialog when assigned
  pieces are hit (C6), never more assigned than wished (A3), "Zuordnen" busy while the Operationen load
  (`assignmentsKnown`), the Route glyph, the wording "N in Operation „Name“", marks before "k von n Einsätzen",
  one-line ownership strip with the nearest place.
- **G9 — Proof:** specs for every new place (item panel, ship classic, blueprint always, classic item view,
  Holotisch menu), `npm run typecheck`, `npm run build`, the touched spec areas green.
- **G10 — The living spec says where the stations live** (`docs/concepts/nachschub-hq-ui-spec.md`): one short
  section, old statements marked as replaced.

## Parity map — mock screen → checklist line

| Screen in `rounds/05.html` (design `kaesten`) | Line |
|---|---|
| `kaesten-offen` (item, wished, nothing assigned: stacked stations, "Zuordnen", "Ins Inventar") | G1, G8 |
| `kaesten-zugeordnet` (item, strip + marks + "Zuordnen" for the free pieces, picker on click) | G1, G8 |
| `kaesten-besitz` (item owned and wished: icons in the ownership head, place strip) | G1, G2 |
| `kaesten-schiff` (ship, classic view: side by side, name in the strip, four icons) | G1, G2 |
| `kaesten-handy` (phone: stacked, picker in the flow) | G1, G8 |
| analysis `r5-d-bauplan`, `r5-d-einfach`, `r5-d-holo` | G3, G4, G5 |

The Holotisch menu (G5) has no mock: the owner asked for a rethink and gave the direction in words. The builder
designs it from the parts above and documents the result with screenshots for the final report.
