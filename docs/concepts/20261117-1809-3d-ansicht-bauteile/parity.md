# Parity checklist — 3D view: recognisable parts

Same checklist as [briefs/implement.md](briefs/implement.md); every line comes from round 1 (`rounds/01.html`, design d1). Status and evidence are filled in by the parity check.

Decisions: [`../../20261117-1809-3d-ansicht-bauteile-decisions.json`](../../20261117-1809-3d-ansicht-bauteile-decisions.json)
Binding visual spec: [`../rounds/01.html`](../rounds/01.html) — design `d1`, CSS block that starts with
`/* 1 · Leuchtkörper` plus the shared rules above it (classes carry the `mock-hv-` prefix). The mock is CSS 3D;
the product is three.js. Colours, the brightness ladder, timings and behaviour are binding; the box geometry is not.

## Everything the owner said, word for word

Original request (chat, 2026-11-17, German):

> a) Es sieht hübsch aus vom blauen, aber manchmal ist es dunkel, manchmal hell. das solltte nicht so sein, vor allem nicht wenn man nichts angeklickt oder geändert hat.
> b) Komponenten anklickbar sind ultra schwierig zu erkennen
> c) Hat man eine komponente im hover over oder angeklcikt ist diese sogar noch viel schlechter ztu erkennen / zu spootten. Der grüne punkt drüber hiflft eigentlich nicht, da wäre fast schon besser die Komponente einfach grün einzufärben! Warum sind andere komponenten dan nciht sogar dunkler oder so, weil die ja nicht angewählt sind? Aber immer noch gut sichtbaar, weil man ggf. zu ihnen wechseln will.
> d) Einmal eins angeklickt, kommt man nicht mehr davon weg (und damit in die übersicht rechts bzw. ohne markierung im 3d modell)
> Das schiff selber finde ich schon ziemlich gut von struktur etc. aber puhh, das muss erkennbarere sein! und auch beim drehen noch gut funktionieren

Round 1 (design round, submitted with "implement", favourite = d1 "Leuchtkörper"):

| Source | Quote |
|---|---|
| Pin answer `r1-d1-s1-a1` (selection colour) | "nicht auswählbar machen, wir machen grün" |
| Pin answer `r1-d1-s1-a2` (others drop to a third) | "ja gut" |
| Own pin on the selected part, screen Schiffsseite | "wen man nochmal draufklickt, sollte es wieder entsdelektieren!" |
| Own pin on the swatch "Grün", screen Schiffsseite | "grün entspricht auch dem r wechsel in sc, also nehmen wir grün" |
| Own pin on the stage, screen Telefon | "gut und auch horizontal machen können" |
| Note on decision "Rückwege" | "kein sichtbares x an der auswhal bitte" |
| Decision "Diagnose Helligkeit" (verify) | "Stimmt" — option consequence: "Die Durchsicht entfällt, der Rumpf verdeckt immer seine Rückseite." |
| Decision "Geltung" (multi) | chosen: "Holotisch im Codex-Schiff", "3D-Vorschau der klassischen Detailseiten", "Holotisch der Codex-Landing, nur das Grundbild" — not chosen: "2D-Ansichten Einfach, Oben, Seite und Front" |
| Decision "Klickziel" (yes/no) | "Ja, das Bauteil selbst, mit unsichtbarer Mindestfläche" |
| Decision "Erster Tipp" (single) | "Er wählt sofort und öffnet die Angaben" |
| Decision "Rückwege" (multi) | chosen: "Klick ins Leere, neben oder auf den Rumpf", "„Übersicht“ im Seitenpanel statt „Alle Bauteile“", "Escape, wie heute", "Zweiter Klick auf das gewählte Bauteil" — not chosen: "Sichtbares ✕ an der Auswahl" |
| Decision "Panel nach Abwahl" (single) | "Die Liste aller Bauteile, wie heute" |
| Decision "Drehung" (single) | "Sobald der Zeiger über dem Modell steht, und bei Auswahl" |

## Checklist (every line is owed; judge each against its quote, the quote wins)

| # | Item | Source quote |
|---|---|---|
| C1 | **No see-through on hover or selection, anywhere.** A hover or a selection never makes the hull translucent (`seeThrough` for selection/hover goes: `asset-package-viewer.component.ts:545`, `asset-package-scene.ts:367-377,386-397`, constants `HOLO_XRAY_*` in `holo-look.ts:52-54`). The hull keeps writing depth and hiding its back and inner lines. The interior layer the user switches on himself (`HULL_OPACITY_INTERIOR`) stays as it is. | "manchmal ist es dunkel, manchmal hell. das solltte nicht so sein" · "Die Durchsicht entfällt, der Rumpf verdeckt immer seine Rückseite." |
| C2 | **Brightness does not swing with the view angle.** Hull edge lines stop adding up (today additive blending, `holo-look.ts:377-380`): a dense side (the Valkyrie's underside) must not read several times brighter than a sparse one. The facing-dependent hull fill is flattened to a narrow range; the animated sweep band may stay but must not light a whole flat hull. Check top, underside and 3/4 view of `ANVL_Valkyrie`. | "manchmal dunkel, manchmal hell … vor allem nicht wenn man nichts angeklickt oder geändert hat" · diagnosis confirmed incl. "beim Blick von unten" |
| C3 | **Clickable parts are glowing bodies, no dots.** Every clickable part reads as its own lit body, clearly above the hull in the brightness ladder (mock d1 idle: line `#a6eaff`, fill `rgba(96,205,240,.36)`, soft glow; hull lines `rgba(82,193,230,.46)`). Parts inside or behind the hull stay visible through it (the mock's glass hull): render them once more where they are occluded (e.g. a pass with `depthFunc: GreaterDepth`), quieter than the visible part. The 12 px DOM rings are no longer drawn. | "Komponenten anklickbar sind ultra schwierig zu erkennen" · favourite d1, trait "Bauteile als gefüllte Leuchtkörper, ohne Punkte" |
| C4 | **The part itself takes hover and click.** Picking on the canvas (raycast against the placed part nodes, `asset-package-scene.ts` `placed`), plus an invisible minimum hit area: 24 px for a fine pointer, 48 px for a coarse one, around the part's projected centre. `cursor: pointer` over a part. A drag that rotates the model is not a click (under 4 px of travel). | "Ja, das Bauteil selbst, mit unsichtbarer Mindestfläche" |
| C5 | **Hover lights the part itself**: white line, brighter fill (mock: border `#ffffff`, fill `rgba(196,240,255,.36)`, glow), and its name tag appears at the part. Nothing else changes: the hull does not dim, no see-through. 150 ms. | "Hat man eine komponente im hover over … ist diese sogar noch viel schlechter ztu erkennen" |
| C6 | **Selection fills the part green.** One fixed colour for every ship: a new token `--sc-holo-select` (`#7dff9c`, the mock's "Grün"), not the manufacturer accent and not selectable by the user. Selected part: green fill (mock: 64 % of the colour), 2 px green outline, glow; it stays readable when the hull is in front of it (drawn on top / through the hull). The name tag turns green with dark text (`#04202e`). One ring pulse of 750 ms on select. The additive halo sprite that covers the part today (`asset-package-scene.ts:237-246`, `syncMarkers`) goes for placed parts; the ring marker for an empty slot stays. | "da wäre fast schon besser die Komponente einfach grün einzufärben!" · "nicht auswählbar machen, wir machen grün" · "grün entspricht auch dem r wechsel in sc, also nehmen wir grün" · "Der grüne punkt drüber hiflft eigentlich nicht" |
| C7 | **While a part is selected, the others drop to about a third** (mock: line `rgba(82,193,230,.42)` instead of `#a6eaff`, fill `.05` instead of `.36`, no glow) and the hull lines go from `.46` to `.30`. They stay clickable, and hovering one gives it the hover look (C5) while the selected one stays green. Today's dim factors (`HOLO_DIM_*`, `holo-look.ts:56-60`) are far too weak (about 20 %). | "Warum sind andere komponenten dan nciht sogar dunkler oder so … Aber immer noch gut sichtbaar, weil man ggf. zu ihnen wechseln will." · "ja gut" |
| C8 | **Second click on the selected part deselects.** Today `setPinned` returns early on the same id (`asset-package-viewer.component.ts:912`). | "wen man nochmal draufklickt, sollte es wieder entsdelektieren!" · "Zweiter Klick auf das gewählte Bauteil" |
| C9 | **A click on empty space deselects**: beside the model or on the hull, on the canvas. Not after a drag. The double click that re-frames the view (`(dblclick)="resetView()"`, viewer template) must not fight C8: on a part it only toggles, on empty space it re-frames. | "Einmal eins angeklickt, kommt man nicht mehr davon weg" · "Klick ins Leere, neben oder auf den Rumpf" |
| C10 | **Escape still deselects** (unchanged, `armEscape`). | "Escape, wie heute" |
| C11 | **The side panel's back control deselects and its text says where it goes.** The owner chose both "„Übersicht“ im Seitenpanel statt „Alle Bauteile“" and, for what the panel shows afterwards, "Die Liste aller Bauteile, wie heute". Orchestrator's reading (flagged in the report): the control stays, keeps clearing the selection in the model, and keeps a label that is true for where it lands, the list of all parts. If the current label is not literally that, make it so. Do not move the panel to the Einordnung tab on deselect. | "„Übersicht“ im Seitenpanel statt „Alle Bauteile“" · "Die Liste aller Bauteile, wie heute" |
| C12 | **No visible close cross at the selection** in the model: no ✕ on the name tag or callout. | "kein sichtbares x an der auswhal bitte" |
| C13 | **The turntable holds while the pointer is over the model and while a part is selected**, and runs on after the pointer leaves or the part is deselected (`effectiveSpin`, `asset-package-viewer.component.ts:1032`). Applies where a spin exists (hero preview). | "Sobald der Zeiger über dem Modell steht, und bei Auswahl" · "auch beim drehen noch gut funktionieren" |
| C14 | **Touch: the first tap selects at once**; 48 px hit area; a tap on empty space deselects; no hover state needed to find parts (C3 carries it). | "Er wählt sofort und öffnet die Angaben" |
| C15 | **Phone, both orientations.** Select, switch and deselect work in portrait and in landscape (the existing landscape overlay of the 3D view). Orchestrator's reading of the pin, flagged in the report. | "gut und auch horizontal machen können" |
| C16 | **Hero preview of the classic detail pages** (`codex-hero-holo-overlay`, classic mode): same base look, same idle/hover/selected look; a hover no longer switches the see-through on (today `viewer:545` classic branch). Its click behaviour (popup / navigation) stays. | "3D-Vorschau der klassischen Detailseiten" |
| C17 | **Codex landing holotable: base look only** (legacy `sc-ship-skin-viewer`): same stable brightness as C1/C2, no selection added. | "Holotisch der Codex-Landing, nur das Grundbild" |
| C18 | **Keyboard path stays.** The parts remain reachable by Tab (visually hidden focus targets are fine), focus gives the hover look, Enter/Space select and toggle, Escape deselects; the focus ring follows the project rule (keyboard only, `--sc-focus-ring*`). | project rule; nothing in the round removes it |
| C19 | **Reduced motion**: no pulse, state changes instant. | project rule; mock has the media query |
| C20 | **Analytics** (project rule 7): catalogue events `codex:part_select` `{ source: 'model' \| 'list' \| 'keyboard' }` and `codex:part_deselect` `{ via: 'empty' \| 'again' \| 'panel' \| 'escape' }` in `src/app/core/analytics/events.ts` (convention `docs/analytics/event-naming.md`), sent from the holo stage; a tile "Bauteil-Auswahl je Holotisch-Besuch" in the Codex dashboard of `posthog/dashboards.json`. | project rule 7 |
| C21 | **Specs follow the behaviour.** At least: `asset-package-viewer.component.spec.ts` ("a hover lights the part without the see-through, a selection turns it on and holds", "Escape clears a pin …", "a plain click on a dot selects …"), `codex-holo-stage.component.spec.ts`, `codex-hero-holo-overlay.component.spec.ts`, `holo-look.spec.ts`, `asset-package-scene.spec.ts`. New cases: second click deselects, empty click deselects, a drag does not, hover pauses the spin, selection never sets see-through. | — |
| C22 | **Living spec** `docs/concepts/codex-holotisch-ui-spec.md` gets the accepted points (C1–C17) and the rejected ones (dots, permanent labels, focus frame, visible ✕, see-through on selection). | project concept rule 5 |

## Not to build

Variants d2 "Röntgen-Fokus" (dots, focus brackets, hull turning into a contour) and d3 "Etiketten" (permanent labels, ✕ on the label); a visible ✕ at the selection; a colour picker for the selection; the same states in the 2D schema views; a jump to the Einordnung tab on deselect.

## Project rules that bite here

`CLAUDE.md` Key Rules: strings via ngx-translate (`public/i18n/{de,en}.json`), real actions are `<button>`, no native `title` tooltips (`[scTooltip]`), focus ring only via `var(--sc-focus-ring…)`, logging via `core/log.ts`, `OnPush` + signals. Timers and render loops outside the Angular zone (`NgZone.runOutsideAngular`). `npm run typecheck` does not see templates: `npm run build` is the gate for template changes. Run the test runner as its own command, never chained after another one.

## Acceptance table (return this, one row per line you own)

`C# → done / partial / not done → evidence (file:line, spec name, screenshot path)`. A line without evidence counts as not done.

## Parity result (2026-11-17, independent check by a QA agent that built nothing)

Evidence lives in `shots/` (`w1-*`, `w1b-*` rendering, `w2-*` interaction, `w3-*` independent check). Real pointer, touch and keyboard events in headless Edge (software renderer, so reduced motion unless forced).

| # | Status | Evidence |
|---|---|---|
| C1 | met | hull stays opaque on hover and select; mean luminance idle 30.9, hover 31.0; `w3-hover-large.png`, `w3-select-large.png` |
| C2 | met | idle mean canvas luminance 3/4 30.9, top 33.3, underside 33.2 (background 20.3); `w3-idle-34.png`, `w3-idle-top.jpg`, `w3-idle-below.jpg` |
| C3 | met | lit bodies, no dots, parts show through the hull; `w3-idle-34.png` |
| C4 | met | cursor pointer over a part, 24 / 48 px slop, a drag never picks; check log, viewer specs |
| C5 | met | white part plus name tag, 6 px gap to the part, hull unchanged; `w3-hover-shield-x3.jpg` |
| C6 | met | fixed green `rgb(125,255,156)` on Anvil and Drake, outline, one pulse (motion forced for the shot), no halo; `w3-select-pulse.png`, `w3-drake-select.png` |
| C7 | met, values differ from the mock | others are quiet outlines (line alpha .08, not .42), hull loses 42 % luminance (not `.30` per line): the mock's values did not show on a real wireframe; `w3-select-hover-other.jpg`, `w1b-select-large-34.png` |
| C8 | met | second click deselects; check log, viewer spec |
| C9 | met | empty click beside the model and on the hull deselects, a drag does not; dblclick off a part re-frames, on a part toggles once; check log, viewer specs |
| C10 | met | Escape deselects; check log |
| C11 | met (orchestrator's reading) | back control "‹ Alle Bauteile" clears the selection and lands on the parts list; `w3-panel-back.png` |
| C12 | met | no ✕ on the tag; shots, viewer spec |
| C13 | met | hero turntable: drifts 2.42→1.69 with the pointer away, holds 1.61→1.61 over the model and during a selection, resumes; check log |
| C14 | met (emulated touch) | first tap selects, tap on another switches, tap on empty deselects; check log |
| C15 | met (emulated, orchestrator's reading) | portrait 390×844 and landscape 844×390; `w3-phone-portrait-select.png`, `w3-phone-landscape-select.png` |
| C16 | met | `/codex/ship/ANVL_Valkyrie?view=classic` + 3D switch: hover without see-through, click opens the popup; `w3-hero-hover.jpg`, `w3-hero-click.jpg` |
| C17 | met | `/codex` landing: stable base look, no tags, no selection; `w3-landing-ship-a.png`, `w3-landing-ship-hover.png` |
| C18 | met | Tab reaches a part, Enter/Space toggle, Escape clears, ring only under Tab; `w3-keyboard-focus.jpg`, `w3-keyboard-enter.jpg` |
| C19 | met by spec | "pulses once per select, never … with reduced motion"; not observed in a browser with reduced motion as a user setting |
| C20 | met | events in `events.ts`, sent from the stage (stage spec), tile in `posthog/dashboards.json` (usage dashboard, there is no separate Codex dashboard); not read back from PostHog |
| C21 | met | full suite 7153 passed, 1 skipped |
| C22 | met | `docs/concepts/codex-holotisch-ui-spec.md`, section "Decided and built: recognisable parts in the 3D view" |

Not verified by anyone: a real GPU (frame rate with outline and ghost pass, the tween), a real touch device.
