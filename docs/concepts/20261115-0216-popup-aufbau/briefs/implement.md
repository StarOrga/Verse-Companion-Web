# Implement brief — Popup-Aufbau (one scaffold for every popup)

Decisions log: [../../20261115-0216-popup-aufbau-decisions.json](../../20261115-0216-popup-aufbau-decisions.json)
Binding spec (mock markup + CSS): [../rounds/01.html](../rounds/01.html), design **d3 "Kommando-Spalte"** (`section[data-design="d3"]`, screens `d3-all`, `d3-dlg`, `d3-form`, `d3-big`, `d3-panel`; CSS rules `.ps-d3 …`).
Parity checklist: [../parity.md](../parity.md)
Submitted: round 1, action `implement`, 2026-11-15. Only one round exists — round 1 is the whole spec.

Related, NOT this brief: the open/close animation is a separate concept (`docs/concepts/20261115-0215-popup-animation.html`, run by another session). Build the scaffold so open/close motion has exactly one home (the existing `src/app/shared/popup-motion/` directive stays the hook) — do not design or change the animation itself.

## Superseding decision (2026-11-15, from the concept „Popup-Animation“)

The user decided in the Popup-Animation concept: **on phones every dialog, panel and large window becomes FULLSCREEN**, growing from the click source (no bottom sheet). This settles r1-phone below and replaces its `sheet` value; the r1-phone note ("teste gut, ob nicht alles Vollbild besser ist … für Fettfinger …") is answered by it. Menus and notices are not covered by that decision and stay as they are (menu card, toast). The growth-from-the-click-source motion is the animation concept's work; the scaffold only has to render the fullscreen state (radius 0, 100% × 100dvh, safe-area padding, ≥ 48 px targets) and keep the motion hook.

The replacement question **r1-back** („Was schließt die Zurück-Geste?“) was added to round 1 after the user submitted, so it is unanswered here — see the session for the user's answer before building back-gesture handling.

## Fixed before round 1 (from the round intro, not up for discussion)

- A modal popup closes only through ✕, Abbrechen or Escape, never through a click on its scrim — **today `sc-confirm-dialog` still closes on a scrim click: fix it.**
- Buttons are `scAction`, at most one `primary` per popup.
- Every popup has exactly one title.
- Content areas stay free; the scaffold fixes header, close, content area, footer and widths.

## Favourite

`favorite: "d3"` — **Kommando-Spalte**: motto "Die Farbspalte sagt, was es ist"; traits: "Farbige Spalte links mit Symbol und senkrechter Augenbraue | Alles links in Leserichtung, Hauptaktion zuerst | Spaltenfarbe zeigt Art oder Folge" (the last trait is settled by annotation a1 below: kind, never consequence).

## Decisions (all = the recommendation)

| id | question | chosen | option text on the page |
|---|---|---|---|
| r1-types | Welche Arten | `five` | Fünf Arten: Menü, Panel, Dialog, Großfenster, Hinweis; Suche und Bildbetrachter als Sonderformen — Jede Art hat ein festes Gerüst; die zwei Sonderformen teilen nur Schleier und ✕. |
| r1-sizes | Breiten | `tokens` | Die vier vorhandenen: Menü, S, M und Bereich — Menüs 20 rem, Fragen 28 rem, Dialoge 48 rem, Großfenster so breit wie der Seitenbereich. (`--sc-ov-menu/s/m/area`; the hard-coded widths of apps menu `min(22rem, …)`, Merkliste `min(27rem, …)`, Übergabe and Wunschkorb go.) |
| r1-stack | Popup über Popup | `confirm` | Nur eine Rückfrage über einem Dialog oder Großfenster — Höchstens zwei Ebenen, der zweite Schleier dunkelt nicht weiter ab. |
| r1-head | Bausteine im Kopf | `title` + `eyebrow` (NOT `icon`, NOT `sub`) | Titel als Überschrift (jedes Popup hat genau eine, auch für Screenreader) + Augenbraue mit Bereich oder Gegenstand („Nachschub“, „Waffe · S3 · Nase“). Untertitel als zweite Zeile was **not** chosen → no subtitle slot in the head (the d3 mock's `.ps-sub` lines are dropped). In d3 the symbol lives in the rail, not before the title. |
| r1-close | Wann ein ✕ | `modal` | Jedes Panel, jeder Dialog, jedes Großfenster; Menüs und Hinweise nicht — Auch Bestätigen bekommt ein ✕ neben Abbrechen. |
| r1-scroll | Langer Inhalt | `body` | Nur der Inhalt scrollt, Kopf und Fuß bleiben stehen — Übernehmen und ✕ sind immer erreichbar. (The HQ dialogs' `.dlg-body { flex:1; min-height:0; overflow-y:auto }` is the model.) |
| r1-build | Wie gebaut | `comp` | Eine Komponente mit Plätzen für Kopf, Inhalt und Fuß — Jedes Popup füllt nur seinen Inhalt; Kopf, ✕, Fuß und Breite kommen aus einer Stelle. Sketch shown: `<sc-popup kind="dialog" eyebrow="Nachschub" title="Ziel für Quantanium"> … Inhalt … <ng-container popupActions>…</ng-container></sc-popup>` |
| r1-phone | Auf dem Handy | `sheet` + note (**flagged: the user hesitated, 66 s, 56-word note**) | Dialoge und Panels als Blatt von unten, Großfenster als Vollbild. |
| r1-role | Admin und Collaborator | `edge` | Oberkante in der Rollenfarbe: Rot für Admin (`--sc-accent-hot`), Kupfer für Collaborator (`--sc-accent-collab`) — Inhalt bleibt in den normalen Farben. |

## User's words, verbatim

**r1-phone note** (decision note, flagged hesitation — treat with special attention, no silent default):
> aber teste gut, aob nicht alles vollbild besser ist, dass soll ncihht fusselig sein und für fettfinger gedacht, aber andereseites verstehe ich das für harmlose dialog e mitz zwei button s und einer confirm nachricht nicht vollbild nötig ist, dann ggf. prüfen ob man zu mindest ehorizontal ordentlich platz einnimmt. Aber visuell mit dem subehader syncen!

**Annotation r1-d3-dlg-a1** — question: „Die farbige Spalte trägt Bereich und Symbol und wird bei Löschen rot. Soll ihre Farbe die Art oder die Folge zeigen?“ — answer:
> Immer die Art für symbol und farbe! Denn folge ist immer teil des popups bzw. buttons im content bereich!

**Annotation r1-d3-form-a2** — question: „Die Hauptaktion steht links unter dem Inhalt, in Leserichtung. Logisch oder gewöhnungsbedürftig?“ — answer:
> warum nicht ienfach als hinweistext im input field. Ich denke es ist klar, wenn was drin steht was man dort auswählt ;)

**Annotation r1-d3-big-a3** — question: „Die Augenbraue steht senkrecht in der Spalte. Lesbar genug?“ — answer:
> ja klar

**Annotation r1-d3-all-a4** — question: „Auch Hinweise bekommen die Spalte. Bleibt ein Hinweis so klein genug?“ — no answer (the d3 mock stands: toasts carry a narrow 36 px rail with the symbol, no eyebrow).

General comment: none. Pins: none. Attachments: none.

## Interpretation notes (the orchestrator's reading — flag in the report if the build had to decide otherwise)

1. **a1 → the rail never turns red.** Rail colour and symbol come from the popup's kind/area, never from the consequence; a destructive action shows its danger only on its own button (`scAction tone="danger"`) in the popup. The d3 mock's `.ps-t-danger { --rail: var(--dg) }` is NOT built. Kind colours must stay inside the project's colour rules (CLAUDE.md "Two colours mark elevated access"): `--sc-accent-hot` / `--sc-accent-collab` / `--sc-danger` / `--sc-warning` are never a kind colour. If the token set has no neutral per-kind tones, every kind uses `--sc-accent` and the kinds differ by symbol — say which in the acceptance table.
2. **a2 → field labels inside the field.** The answer does not address the action position (so d3's "primary action first, left, in reading order" stays). It reads as a remark on the form rows ("Menge", "Ort" labels beside the fields): put the hint into the field. A bare placeholder disappears once a value is in and is not a label for assistive tech, so the form pattern inside popups is an **in-field (floating) label**: the label sits inside the empty field and shrinks to the field's top edge once a value is in, still a real `<label>`. Applies to popup forms the scaffold migration touches; content areas otherwise stay free.
3. **r1-phone (flagged).** Default per the decision: dialogs and panels = bottom sheet, large windows = full screen. The note demands real testing at phone width (375 × 812 and 390 × 844) of **whether full screen would be better** for dialogs/panels with fields or lists; a harmless two-button confirm stays a sheet. Every sheet takes the full horizontal width (edge to edge, safe-area padding), touch targets ≥ 48 px ("für Fettfinger", not fiddly), and **visually syncs with the subheader** (same inline edges / width B `--sc-b-w`, same surface and border language as the subheader bar). Document the fullscreen-vs-sheet finding per kind with screenshots in the report; if full screen is clearly better for a kind, build that and say so.
4. **Menus** keep d3's narrow rail with the symbol only, no eyebrow, no ✕, no head. **Hinweise (toasts)** keep the 36 px rail with the symbol, no ✕.
5. **Sonderformen** (quick search, lightbox) share only scrim and ✕ with the scaffold.

## Mapping — the 48 popups and their kind (user-confirmed, no changes against the proposal)

- **Menü (6):** apps_menu, account_menu, admin_menu, column_menu, hangar_menu, place_select
- **Panel (14):** merkliste, beta, handoff, footer_bubble, item_path, hero_part, holo_overlay, browse_sheet, landing_news, missions_popover, live_ticker, status_chip, star_dome, starmap_tour
- **Dialog (12):** confirm, add_to_set, event_claim, nachschub_target, nachschub_remove, reserve, einsatz_pick, log_dialog, hq_stats, social_vis, desktop_dl, api_tokens
- **Großfenster (10):** wish_cart, component_modal, swap_picker, compare_tray, upcoming, nachschub_flow, blueprint_picker, stock_popup, patch_dossier, news_item
- **Hinweis (4):** star_toast, undo_toast, app_launch, app_notice
- **Sonderform (2):** quick_search, lightbox

(Counts as assigned in the payload; ids are the concept's own — resolve each to its component in `src/app` first.)

## Checklist (one line per accepted item)

- [ ] C1 `sc-popup` component in `src/app/shared/` with slots for head (title as the popup's one heading + eyebrow), body and footer (`popupActions`), kinds `menu | panel | dialog | large | notice`; standalone, OnPush, signals.
- [ ] C2 d3 look: coloured rail on the left with the kind's symbol and the vertical eyebrow (writing-mode vertical, rotated, uppercase); title + ✕ in the head row; footer actions left in reading order, primary first, status text right.
- [ ] C3 Rail colour + symbol = kind/area, never consequence; no red rail for delete (a1).
- [ ] C4 Widths only via `--sc-ov-menu / -s / -m / -area`; remove hard-coded widths in apps menu, Merkliste, Übergabe, Wunschkorb; `scripts/check-overlay-sizes.mjs` stays green.
- [ ] C5 ✕ on every panel, dialog and large window (confirm gets ✕ beside Abbrechen); none on menus and notices; ✕ is a tertiary `scAction` with aria-label + `[scTooltip]`.
- [ ] C6 Modal popups never close on a scrim click — fix `sc-confirm-dialog`; Escape + ✕ + Abbrechen close; `[scDialog]` focus trap/return.
- [ ] C7 Only the body scrolls; head and footer stay (max height `--sc-ov-max-h`).
- [ ] C8 Stacking: at most one confirm over a dialog/large window; the second scrim does not darken further.
- [ ] C9 Head has no subtitle slot (r1-head without `sub`); no icon before the title (the symbol is in the rail).
- [ ] C10 Role edge: a popup reachable only by admins gets a top edge in `--sc-accent-hot`, admin+collaborator popups in `--sc-accent-collab`; content stays in normal colours; no visible role words (sr-only text allowed).
- [ ] C11 Phone: dialogs + panels as bottom sheet, large windows full screen, sheets full width, ≥ 48 px targets, visually synced with the subheader; fullscreen-vs-sheet tested per kind and documented (flagged r1-phone note).
- [ ] C12 Popup form fields use in-field (floating) labels (a2 interpretation).
- [ ] C13 Notices (toasts) carry the narrow symbol rail, no ✕ (a4 unanswered → mock stands).
- [ ] C14 Migrate every popup of the mapping onto `sc-popup` per its kind (menus, panels, dialogs, large windows, notices); Sonderformen share scrim + ✕ only. The six separate CSS stacks (`HQ_DIALOG_STYLES`, `sc-overlay-frame`, `.cm-panel`, `.pick-win`, `sc-confirm-dialog`, `.qs-*`) end up on the shared scaffold.
- [ ] C15 All new strings via ngx-translate (`public/i18n/{de,en}.json`); errors/logging per project rules; no native dialogs/tooltips/selects.
- [ ] C16 Tests: unit specs for `sc-popup` (kinds, ✕ presence, scrim click does not close a modal, Escape closes, body scroll, stacking) + existing specs of migrated popups stay green; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green.
