# Holotisch audit, round 3 (HEAD 5c9048596), read-only

DEV build on 127.0.0.1:4321, test account, nothing saved. Evidence in docs/qa/holotisch-qualitaet/round3/
(perf-*.json, cls*.json/out, view.json, ux-AEGS_Idris_M.json, stack*.out, v-*.png, cls-*.png, swap-*.png).

## Verdicts
| # | item | verdict | evidence |
|---|---|---|---|
| 1 | Gladius Simple + All rooms, whole shape, centred | fixed (caveat) | 1280 and phone: nose to tail visible, centred in the stage, not clipped (v-d1280-AEGS_Gladius-allrooms.png, v-phone-...). Caveat: with no room data the plan is a faint, blurred silhouette that reads like a placeholder |
| 2 | CLS Idris, 3 runs, median | partly | 1920: 0.161/0.087/0.088 median 0.088 (round 2: 0.164, round 1: 0.39). 1280: 0.100/0.150/0.168 median 0.150 (round 2: 0.084) = worse. 0.079 of every run is a start-screen root shift at about 1.7 s (not Holotisch). A probe run (150 ms polling) showed 0.23 at 1280 with a skel-stage + ASIDE.wrap shift of 0.06-0.14 at the hand-over; unprobed runs show less, so the hand-over still jumps in some runs. Skeleton now holds 820 px (1920) / 540 px (1280) and drops to the 18 px canvas without a height jump. Phone skeleton 360 px, phone CLS 0.116 (FOOTER 0->196 h, ASIDE.dial 184->236 h, from before) |
| 3a | FAB lane 1280 | fixed | view bar and dock start right of the mobile FAB (x=85) and stop left of the beta/dock FABs (x=1128); stat strip no longer clipped (v-d1280-AEGS_Idris_M-top.png). Column text at the very bottom still scrolls under FABs (normal) |
| 3b | deck chips 1280 (N6) | fixed | chips wrap to two rows, Main Deck / Turrets / Bridge all visible |
| 3c | phone reset (T3) | fixed | reset button moved to the left of the chip row, no overlap |
| 3d | phone pill (N1) | partly | mission name whole ("Combat") but the count truncates ("21 ...", "2 x...") |
| 3e | phone energy (N2) | fixed visually | segments are small 44x16 tiles, 21/21 column readable. New: they are tap targets of 16 px height (see N1 below) |
| 3f | phone FAB lane (U2) | fixed | view tiles and chip rows end before the dial, scroll padding added |
| 4 | Idris load (P2), 1280 | fixed | DOM 15.1k -> 7.6k (x1) / 7.4k (x4); load long tasks x1 8/856/2017 -> 6/448/1120 ms (count/max/sum); x4 26/5066/14082 -> 26/3034/9818; h1 9.9 s -> 6.4 s (x1), 19.2 -> 15.1 s (x4); heap 82 -> 66 MB. 1920: 6/469/1146 (round 2 8/732/1874) |
| 4 | swap picker (P1/U3) | partly / ok | open 163 -> 139 ms (x1), 4x 1320 max/2116 sum -> 952/1695; 1920 212 -> 198. Dialog top at y=152, below the bar (swap-AEGS_Idris_M-1280-x1.png). Tab stays inside (14/14 presses), Escape closes, focus returns to the Swap component button |
| 5 | stacked modal | not reachable | the only inner action in the swap picker (arrow button at the row) navigates and closes the dialog, so no stacked modal exists read-only. Single-modal state verified: 1 popup, 1 aria-modal, 57 siblings inert (2 before open), restored to baseline after Escape. Stacked behaviour rests on spec ModalInertService (5c9048596 restores inert in the opening render) |
| 6 | text under 13px | partly | leaf nodes under 13 px (same selector as rounds 1-2): 12 at 1280, 13 at 375 (round 2: 13-14). Remaining: page-header eyebrow 11-12 px (Aegis Dynamics, variant tabs), carets 9.8/11.3 px, SVG plan labels (2.5 px, scaled) |
| 7 | classic ?view=classic | unchanged | calm false, container-type normal, content-visibility visible, no holo table, no deferral, doc height 12,056 px (same as round 2), CLS 0.25 (round 2 0.31, noise) |
Other: Top view long task x1 118 ms (round 2 165), tab switches 0-208 ms, FPS 60 idle, orbit 60; no new console errors.

## New findings, ranked
- R1 (S-M, regression) Idris at 1280: the Standing/Akte card is cut off, hexagon bottom and the AGILITY / MISSILES /
  SHIELD HP labels gone (v-d1280-AEGS_Idris_M-top.png). Cause: the deck chip row now wraps to two rows
  (`.vd-row { flex-wrap: wrap }`, codex-holo-stage.component.ts, commit e17354ec6), the dock grows, the stage row and
  the Akte card shrink, and `.ak-body { overflow: auto }` (codex-holo-akte.component.ts:185) hides the radar. Fix: let the
  radar svg scale with the available height (max-height: 100%, aspect-ratio) or keep the chips on one scrolling row
  when the Akte tab is Standing.
- R2 (S) 1280 CLS median 0.15 (was 0.084): skel-stage to stage hand-over shifts the header band (ASIDE.wrap, 104 px)
  and the skeleton card in some runs. Fix: reserve the same head-band height in the skeleton and mount the stage in
  the skeleton box in one frame (codex-holo-stage.component.ts skel-stage rules, f8b6a70ef).
- R3 (S) Phone energy segment buttons are 44x16 px (62 below 44 px high, ux json tapSample); a mis-tap changes
  power. Add min-height via a 44 px hit area (padding or ::after) in codex-holo-energy.component.ts (`.seg`).
- R4 (S) Phone mission pill: name whole but count truncated ("21 ...", "2 x..."); put the count on a second line or
  drop the type word on phone (codex-holo-einsatz.component.ts).
- R5 (S) Remaining under-13 px text: page-header eyebrow and variant tabs 11-12 px (sc-page-header), carets 9.8 / 11.3 px.
- R6 (M) Deferred rows: placeholder height PH_ROW_PX = 112 (codex-hardpoint-layout.component.ts) is a fixed guess; I did
  not see jumps in the measured scroll runs (CLS after scroll 0.10-0.11 vs 0.085 before scroll, i.e. +0.02), but
  jump-to-part from the stage onto a not yet built row was not exercised; check that selecting a part scrolls to its row.
- R7 (info) Gladius All rooms silhouette is faint: use the Top-view hull when a ship has no rooms.
Servers on 4321 stopped; nothing edited.
