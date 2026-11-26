# Implement brief — Schiffskategorien nach Einsatz

Concept: `docs/concepts/20261123-2030-kategorien-nach-einsatz/` · decisions log:
[`../../20261123-2030-kategorien-nach-einsatz-decisions.json`](../../20261123-2030-kategorien-nach-einsatz-decisions.json)
(payload 1 = round 1, 2 = round 2, 3 = round 3; later rounds override earlier ones).

**Binding spec (mocks):**
- `rounds/02.html` design **d2 „Werteliste nach Einsatz“** (round 2 favourite): the list per column, sorted by
  Einsatz, „Alle Werte“ continuing the same list inside the column; analysis view of round 2 (Leitwert table
  under `r2-d-leitwert`).
- `rounds/03.html` design **d1 „Balken ab Basislinie“** (round 3 favourite, action `implement`): the row's
  comparison display. Screens `r3-d1-s1` … `r3-d1-s4`.
- Live CSS used by the mocks: `assets/03/holo-row.css` (extracted from the live component).

Where the live code sits: `src/app/codex/holo/codex-holo-perspectives.component.ts` (the four columns,
`layout="row"`), `src/app/codex/holo/codex-holo-stage.component.ts` (`PERSPECTIVE_LEAD`, `perspectiveTiles`,
`perspectiveViews`, `sayFor`, around lines 260 and 2940–3010), `src/app/codex/codex-build-compare.ts`
(`PERSPECTIVE_KPIS`), `src/app/codex/codex-mission.ts` (`MissionId`, `missionDisabledReasonKey`),
`src/app/codex/codex-mission-bar.component.ts` (the existing disabled-with-reason pattern),
`src/app/codex/holo/codex-holo-strip.component.ts` (strip + Einsatz picker on the Holotisch),
`src/app/codex/detail/codex-loadout-draft.store.ts` (draft vs saved), `src/app/codex/holo/codex-holo-changes.component.ts`
(„Änderungen“, compares against the factory loadout).

Scope: the Holotisch beta view of the ship page only (the classic detail page stays untouched, project rule).

## Every user remark, verbatim

Round 1 (general note, the only comment):
> „ne ganz falsche ransatz, die spaltenlogik in der leiste sollen bleiben, bitte nur in den spalten überarbeiten!“

Round 2 (favourite **d2**):
- Pin on d2 „Gladius · Kampf“, row „Burst-DPS 1.640“:
  > „rangbalken hmm visualis8ierung finde ich gut, aber es geht eher darum wie verhält sie sich zur entweder werkskonfiguration oder letzten gespeicherten“
- `r2-d-rang` „Keine passt“:
  > „ggü. werk bzw. gespeicehrte versioN! Damit man die untsfheide sieht, rang ist dort egal, das sieht man unter einordnung !“
- `r2-d-ohnedaten` „Keine passt“:
  > „manche schiffe sind ja auch nicht für bestimmte einsätze, dann gewrn die einsätze nicht auswählbar machen“
- Touched and chosen: `r2-d-default` = role · `r2-d-fracht` = lead · `r2-d-detail` = flat · `r2-d-gruppe` = group ·
  `r2-d-luecken` = count · `r2-d-doppel` = need · `r2-d-messen` = ok.

Round 3 (favourite **d1**, action **implement**):
- Annotation `r3-d1-s1-a2` (question: „Vergleich: Werk | Gespeichert“ über der Spaltenreihe: richtiger Platz, oder lieber im Kopfband?):
  > „Ja, wobei immer gepsichert immer vorranigg ausgewählt. Bzw. ne, implizit soll das sein, nänlich in den balken markiert ggü. werk imemr !“
- Annotation `r3-d1-s1-a3` (question: Nicht passende Einsätze grau mit Grund in der Zeile: klar genug?):
  > „klar genug, aber die aktiven zu wenig offensichtlich !“
- `r3-d-patch` „Keine passt“:
  > „ne, patch ist nur üpber einordnujngzus sehen das reicht!“
- `r3-d-luecke` „Keine passt“:
  > „das sollte es niccht geben,da nn pass den uploader an, bis er alles davon hat! Ggf. haben aber einige schiffe nicht alles, weil sie einfach z. B. kein mining schiff sind oder m odular ggf. mining oder nicht“
- Touched and chosen: `r3-d-basis` = saved · `r3-d-gleich` = values · `r3-d-alles` = neutral · `r3-d-leitwert` = ok ·
  `r3-d-werkzeug` = offensive.

**Reading of `r3-d-basis` + annotation a2 (the later, more specific remark wins):** there is **no visible
Werk | Gespeichert switch**. The bar always measures against the factory loadout (Werk). When the ship has a
saved configuration, the saved value is **marked on the same bar** (a quiet tick), so „gespeichert“ is visible
implicitly. Name this reading in the final report.

## Checklist (one line per accepted item; the quote decides acceptance)

| # | Item | Source quote | Owner |
|---|------|--------------|-------|
| 1 | Four columns stay exactly as live: order Offensive · Verteidigung · Bewegung · Signatur & Kühlung, edge on edge, aligned over the strip's four areas. No fifth column, no re-sorting. Only the content inside a column changes. | R1 „die spaltenlogik in der leiste sollen bleiben, bitte nur in den spalten überarbeiten!“ | web |
| 2 | Each column shows a value list whose rows and order depend on the active Einsatz (round 2 d2). The Leitwert table of `r2-d-leitwert` defines the first row (★) per Einsatz and which columns are quiet: Kampf DPS★/Schild HP★/SCM/IR · Transport DPS leise/Rumpf HP★/Fracht★ (+Q-Reichweite)/Querschnitt leise · Reisen DPS leise/Rumpf HP/Q-Reichweite★ (+Fracht)/Kühllast · Schleichen Alpha leise/Schild HP/SCM/IR★ (+EM) · Bergbau Bergbaulaser★/Schild HP/Q-Reichweite (+Erz)/Kühllast★ · Bergung Bergungswerkzeug★/Rumpf HP/Fracht★/Kühllast leise. | R2 favourite d2; `r3-d-leitwert` = ok | web |
| 3 | Einsatz „Alles“: fixed neutral lead per column — Dauer-DPS · Schild HP · SCM · IR — for every ship. | `r3-d-alles` = neutral | web |
| 4 | The page opens on the Einsatz derived from the ship role (Hercules → Transport, Gladius → Kampf); the reader's choice per ship stays remembered. | `r2-d-default` = role | web |
| 5 | Fracht (SCU) is the lead of Bewegung for Transport and Reisen; under Kampf, SCM leads Bewegung again. The old „Stärkste Achse FRACHT (P72)“ sentence goes. | `r2-d-fracht` = lead | web |
| 6 | Mining / salvage tool stands in Offensive instead of „keine Waffen“; ships with weapons and a tool show both, one under the other. | `r3-d-werkzeug` = offensive | web |
| 7a | **Columns lose every rank:** no P-ring, no P-numbers, no „besser als … %“, no rank words, no rank bars, no „Stärkste/Schwächste Achse“ sentence inside the four columns. | R2 „rang ist dort egal, das sieht man unter einordnung !“ | web |
| 7b | **Einordnung keeps the rank:** the Einsatzordnung / „Einordnung“ tab in the side panel still shows the cohort rank unchanged. | same quote | web (verify only) |
| 8 | Each row compares against the **factory loadout (Werk)** with a diverging bar around a centre mark (= Werk): grows right when better, left when worse, per-metric direction (lower is better for IR, EM, Querschnitt, Masse, Kühllast …). The delta in small text beside it (e.g. „+120“). Exactly as `rounds/03.html` d1. | R2 pin „wie verhält sie sich zur entweder werkskonfiguration oder letzten gespeicherten“; R3 favourite d1; a2 „in den balken markiert ggü. werk imemr“ | web |
| 9 | When the ship has a saved configuration, the saved value is marked on the same bar (quiet tick + accessible label/tooltip „Gespeichert: <value>“). No visible Werk/Gespeichert switch anywhere. | a2 „implizit soll das sein, nänlich in den balken markiert ggü. werk imemr !“; `r3-d-basis` = saved | web |
| 10 | A row whose current value equals Werk (and there is no differing saved value) shows only the value — no bar, no tick, no delta. | `r3-d-gleich` = values | web |
| 11 | A worse delta uses `--sc-warning`, a better one the success token; never `--sc-danger` (project rule: a worse comparison value is not an error). | project rule (CLAUDE.md) + d1 colours | web |
| 12a | **Columns lose the patch ghost** (the „4.3.1 · 1.120“ comparison from the patch chooser) inside the four columns. | R3 „ne, patch ist nur üpber einordnujngzus sehen das reicht!“ | web |
| 12b | **Einordnung keeps the patch comparison** where it lives today. | same quote | web (verify only) |
| 13 | „Alle Werte“ opens **inside the column** as a flat list grouped by topic, only this column's values, no second head, no broken table heads (replaces opening the old analysis panels `sc-codex-offensive-panel` / `-defensive-panel` / `-ship-panel` from the columns). Rows use the same comparison display as #8–#10. | `r2-d-detail` = flat; R2 favourite d2 „Alle Werte continues the list“ | web |
| 14 | Same weapons are grouped: „8 × KLWE Laser Repeater S3“ with the summed values, expandable to the individual ports. | `r2-d-gruppe` = group | web |
| 15 | A value missing in the game data is hidden from the list; one counter at the end „n Werte fehlen ▾“ lists the missing ones with reason on click. | `r2-d-luecken` = count | web |
| 16 | Columns may repeat a strip value when the Einsatz needs it (no dedup against the strip). | `r2-d-doppel` = need | web |
| 17 | Einsätze a ship is not equipped for are **not selectable** on the Holotisch Einsatz picker: disabled, reason in `[scTooltip]` + `.sc-sr-only` (keys `codex.mission.disabled.*`, mechanism as `codex-mission-bar.component.ts:40-58`). Modular ships: availability follows the fitted module (e.g. a mining module enables Bergbau). | R2 „dann gewrn die einsätze nicht auswählbar machen“; R3 „einige schiffe nicht alles, weil sie einfach z. B. kein mining schiff sind oder m odular ggf. mining oder nicht“ | web |
| 18 | The **selectable** Einsätze are clearly more prominent than the disabled ones (contrast, weight, the active one unmistakable), not only the disabled ones greyed. | a3 „klar genug, aber die aktiven zu wenig offensichtlich !“ | web |
| 19 | No „fehlt in den Spieldaten“ state for an Einsatz the ship is equipped for. Where the extract lacks the values (e.g. mining laser power, salvage tool values), the **data uploader** is extended to extract them. | R3 „das sollte es niccht geben,da nn pass den uploader an, bis er alles davon hat!“ | uploader (analyse first, build if contained; else shortfall + issue) |
| 20 | Analytics: two catalogue events `codex:einsatz_select {mission, source: default \| user}` and `codex:perspective_detail_open {perspective, mission}` in `src/app/core/analytics/events.ts`, fired from the picker and „Alle Werte“; a dashboard tile „Einsatz-Wahl und Alle Werte“ on the Codex dashboard. | `r2-d-messen` = ok | web (+ PostHog tile) |
| 21 | All new strings localized (de + en), StarUI tokens, `scAction` / `[scTooltip]` / `<sc-select>` rules, `ds-new:` / `ds-ok:` on anything new or off-scale (the diverging bar is new → `ds-new`). | project rules | web |

Acceptance per agent: one row per owned line → `done` / `partial` / `not done` → evidence (file:line, test,
screenshot). A line without evidence counts as `not done`.
