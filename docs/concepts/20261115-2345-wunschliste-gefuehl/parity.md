# Parity checklist — design 3 "Sternschnuppe"

Source for every line: `rounds/01.html`, `section[data-design="d3"]`, and the round's `<style>` block (classes `wl-*`).
Sizes are the mock's; colours map to app tokens (`--a` → `--sc-accent`, `--edge` → `--sc-border`, `--ink` → `--sc-fg-0`,
`--mut` → `--sc-fg-2`).

| # | Screen | What must match | Mock source |
|---|---|---|---|
| 1 | all | Icon: 4-point star top right + three trails to bottom left; paths `M16 3.5l1.3 3.2 3.2 1.3-3.2 1.3L16 12.5l-1.3-3.2L11.5 8l3.2-1.3z`, `M11.5 12.5L4 20`, `M8.5 10.5L5 14`, `M13.5 15.5L10 19`; 24-unit viewBox, stroke, round caps; "on" = filled 30 % of the stroke colour | `I.shoot`, `.wl-i`, `.wl-i.on` |
| 2 | Leer | Popout: accent edge only, title "Wünsche", ✕; body order: sky, headline, text, primary action; no footer | `#d3-leer .wl-pop` |
| 3 | Leer | Sky: 136 px high, radius 8, radial gradient brighter at the top right, 1 px border; 10 dots (2 px) twinkling `wl-tw` 3.2 s ease-in-out infinite, staggered 0.37 s; two streaks `wl-shoot` 5 s ease-in infinite (96 px and 64 px long, the second delayed 2.6 s), bright head leading, flying from top right to bottom left at −24° and fading out | `.wl-sky`, `.wl-dot`, `.wl-shoot`, `.wl-shoot2`, `@keyframes wl-tw`, `wl-shoot` |
| 4 | Leer | Headline "Wünsch dir was" (display font), text "Jede Sternschnuppe ein Wunsch. Such dir deinen ersten aus.", primary action "Wunsch suchen" with the search glyph before the label, centred | `.wl-et`, `.wl-ex`, `.wl-cta` |
| 5 | Leer → Suche geöffnet | The action closes the popout and opens the page's search with focus in the field | `data-screen-link="d3-suche"` |
| 6 | Suche geöffnet | Each result row: wish action = shooting star, outlined when off, filled and accent-bordered when on; the news row keeps the bookmark | `#d3-suche .wl-act` |
| 7 | Gefüllt | Rows: thumb · name + type · stepper · Nachschub · remove (unchanged); thumb carries a 4 px star dot top right with glow, `wl-tw` 3.2 s; footer: "Alle Wünsche" pill left, "3 Wünsche" right | `#d3-voll`, `.wl--d3 .wl-row .wl-th::after` |
| 8 | Großes Fenster | Rail: shooting star + vertical "HQ"; title "Wünsche"; sky strip 84 px above the groups (same sky, same motion); groups with the star dot on thumbs; footer: "In einen Nachschub" (primary), "Alle abwählen", status "3 Wünsche · 3 Gruppen" and "2 gewählt" | `#d3-gross`, `.wl-art--strip` |
| 9 | Im Codex | Path: wish node first, label "Wünsche", then Nachschub · Inventar · Hangar · Sammlungen with their existing icons | `#d3-codex .wl-path` |
| 10 | Im Codex | Add moment: a 46 px streak flies in from the top right (`wl-star-in`, visible 24–47 % of 5 s on the mock = about 1.1 s once in the app), the node pulses (`wl-add`: border and colour to accent, ring 8 px at 22 %, scale 1.14, back to rest with the accent kept) and the icon fills (`wl-fill`). In the app it plays ONCE per add, not as a loop | `.wl-add`, `.wl--d3 .wl-add::before`, `@keyframes wl-add`, `wl-fill`, `wl-star-in` |
| 11 | Im Codex | Fulfilled toast: rail with the shooting star, line 1 "„Polaris“ ist da", line 2 "Dein Wunsch ist in Erfüllung gegangen"; the icon falls in from the top right (`wl-fall`: translate(8px,−12px) and transparent → in place and opaque), once | `.wl-toast`, `.wl-fall`, `@keyframes wl-fall` |
| 12 | Im Codex | The news tile shows the bookmark for "gemerkt", not the shooting star | `.wl-news` |
| 13 | all | `prefers-reduced-motion: reduce`: no animation, static picture complete (dots visible, no streak) | `@media (prefers-reduced-motion: reduce)` |
| 14 | phone | Popout full width / sheet; sky, headline, action stay in this order; path wraps | `@container (max-width: 600px)` |
