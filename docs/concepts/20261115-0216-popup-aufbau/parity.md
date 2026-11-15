# Parity checklist — Popup-Aufbau (design d3 "Kommando-Spalte")

Source of every line: `rounds/01.html` (the only round), design `d3`, payload in `../20261115-0216-popup-aufbau-decisions.json`. Same checklist ids as `briefs/implement.md`. QA proves each line with paired screenshots (mock screen vs. real popup) at desktop 1280 × 800 and phone 375 × 812.

| id | line | mock reference | evidence |
|---|---|---|---|
| P1 | Rail: left column, 46 px wide (36 px for menu + notice), vertical gradient of the rail colour (28 % → 8 %), 2 px right border in the rail colour, symbol on top, gap 14 px | `.ps-d3 .ps-rail`, screens `d3-all`, `d3-dlg` | |
| P2 | Eyebrow: vertical (`writing-mode: vertical-rl; rotate(180deg)`), uppercase, letter-spacing .2em, ~10.5 px, weight 600, rail colour; absent on menus and notices | `.ps-d3 .ps-ev`, `d3-big` ("Waffe · S3 · Nase") | |
| P3 | Rail colour = kind/area, never consequence (no red rail on "Gladius entfernen?"; danger only on the button) | `d3-dlg` + annotation a1 | |
| P4 | Head row: title (the popup's one heading) left, optional tools (‹ ›) before the ✕, ✕ right; no subtitle line, no icon before the title | `.ps-h`, `d3-big` | |
| P5 | Footer: actions left in reading order, primary first (`Speichern`, `Übernehmen`), then `Abbrechen`, spacer, status text right (`3 von 5 Zielen belegt`) | `.ps-f`, `d3-form`, `d3-big` | |
| P6 | Body scrolls alone; head + footer fixed | r1-scroll, `.dlg-body` model | |
| P7 | Popup frame: 1 px border, radius 6 px, shadow `0 30px 80px rgba(0,0,0,.55)`, overflow hidden | `.ps-d3 .ps-pop` | |
| P8 | ✕ on panel / dialog / large, none on menu / notice; confirm has ✕ + Abbrechen | `d3-all` | |
| P9 | Widths: menu `--sc-ov-menu`, question `--sc-ov-s`, dialog `--sc-ov-m`, large `--sc-ov-area` | r1-sizes | |
| P10 | Second layer: one confirm over a dialog/large window, its scrim does not darken further | r1-stack | |
| P11 | Role edge: top edge red (admin) / copper (admin + collaborator) | r1-role | |
| P12 | Phone: dialog + panel = bottom sheet, full width, ≥ 48 px targets, synced with the subheader; large = full screen with radius 0; fullscreen-vs-sheet test documented per kind | phone viewport of `d3-*`, r1-phone note | |
| P13 | Form fields: in-field (floating) label instead of a label beside the field | `d3-form` + annotation a2 | |
| P14 | Notice: narrow rail with symbol, message + `Rückgängig`, progress line, no ✕ | `d3-all-toast` | |
