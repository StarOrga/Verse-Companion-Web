# Holotisch quality audit, round 1 (read-only)

Method: ng serve DEV build (127.0.0.1:4311), Playwright chromium, test account, cloud data. A prod build served
statically was signed out (test-session guard), so all timings are DEV timings (unminified JS, 39 MB decoded,
resource buffer capped at 250 entries). Prod initial chunks (build.log) are about 50 kB brotli each, so transfer size
is not the bottleneck; CPU and long tasks are. 4x = CDP CPU throttle.
Not covered: real WebGL model-viewer/three view (default holo view is the SVG deck plan, 3D is an isometric plan),
focus ring after click, immersive mode, ship switch, Javelin / 890 / Hercules C2 (measured: Idris M, Carrack,
Starlifter C2, Gladius). Evidence: docs/qa/holotisch-qualitaet/round1/ (perf-*.json, *.png, ux-*.json).

## Numbers (ms). LT = long tasks during load: count / max / sum
| ship / viewport / cpu | h1 | stage+table | net idle | heap MB | DOM | LT load | CLS | FPS idle / scroll / orbit (max frame) |
|---|---|---|---|---|---|---|---|---|
| Gladius 1280 x1 | 3819 | 3842 | 6043 | 65 | 8.3k | 6/384/991 | 0.10 | 60 / 60 / 60 |
| Gladius 1280 x4 | 15545 | 16313 | 17312 | 81 | 8.0k | 37/2925/10708 | 0.09 | 34 / 31 (150) / 51 (117) |
| Idris M 1280 x1 | 7227 | 7272 | 12217 | 68 | 15.1k | 9/899/2016 | 0.10-0.13 | 60 / 60 (50) / 60 |
| Idris M 1280 x4 | 19115 | 19953 | 27705 | 78 | 14.9k | 31/6059/14791 | 0.09-0.12 | 31 (700) / 53 (150) / 47 (67) |
| Idris M 1920 x1 | 5629 | 5658 | 10004 | 74 | 15.2k | 7/750/1722 | 0.39 | 60 / 59 (83) / 60 |
| Starlifter C2 1280 x1 | 6130 | 6203 | 11243 | 74 | 9.4k | 10/750/2005 | 0.10-0.11 | 60 / 59 (50) / 60 |
| Carrack 1280 x1 | 8841 | 8962 | 9108 | 71 | 10.2k | 9/722/1957 | 0.17-0.20 | 60 / 59 (50) / 60 |

Interactions (longest long task, 1.5 s window): Idris x1: view Top 147, swap picker open 211 (2 tasks).
Idris x4: Top 369, Parts 83, Changes 106, Einsatz open 98, swap picker open 1238 (8 tasks, 2.4 s blocked).
Gladius x4 swap 1530. Doc height Idris 8269 px at 1280, 15k DOM nodes. No console errors (only the Lit dev warning).

## Performance
- P1 Swap picker open blocks the main thread (Idris 211 ms, 1.2 s at 4x). Profile at 4x: hasGeometry (cdk a11y)
  677 ms + publishHeight 453 ms. Cause: scDialog runs focusInitialElement() and inert registration over a 15k-node
  DOM (src/app/shared/dialog/sc-dialog.directive.ts:96-110); the body ResizeObserver then runs
  FusionBarComponent.publishHeight with forced reflow (src/app/shell/fusion-bar/fusion-bar.component.ts:649-660,
  985-999). Fix: initial focus via container/ref instead of the tabbable scan in codex-swap-picker.component.ts
  (~l.793); skip publishHeight while a modal is open; content-visibility:auto on off-screen columns. Effort S-M.
- P2 Initial render of big ships is long-task heavy: Idris load 9 long tasks, max 899 ms (6.1 s at 4x), stage at
  7.3 s dev / 20 s at 4x, 15k DOM nodes (all four columns render every slot at once). Fix: lazy rows below the fold
  (defer on viewport or content-visibility:auto + contain-intrinsic-size) in codex-holo-table.component.ts and
  codex-holo-strip.component.ts. Effort M-L. Confirm on a signed-in prod build.
- P3 CLS 0.39 at 1920x1080 on Idris (poor, over 0.25; 0.10 at 1280). Shifts: ASIDE.wrap 920 to 868 y, .statics
  289 to 254 y, A.cohort-link 16 to 0 h as data arrives. Fix: reserve height for statics / cohort row / stage box
  (codex-holo-stage.component.ts ~l.995 .statics). Effort S.
- P4 ph-scan animates bottom while loading (codex-holo-table.component.ts:576). Effort S.
- FPS is 60 unthrottled everywhere incl. orbit; 4x idle 31-34 fps with a 700 ms frame on Idris during settling.

## Animation
- A1 Layout-property animations: drawer unfold/fold animates height + margin-top (codex-holo-stage.component.ts
  :1123-1126); ph-scan animates bottom (table:576); dk-holo / dk-dock / dk-ignite animate filter brightness on the
  whole dock (stage:954-977), repaint heavy at 4x. Fix: grid-template-rows 0fr to 1fr or transform/opacity on a clipped
  wrapper; drop the brightness filter or scope it to a small overlay. Effort M.
- A2 prefers-reduced-motion missing in codex-holo-einsatz, codex-holo-hangar-menu, codex-holo-interior-chips
  (transitions present, zero reduced-motion rules; other holo files have one). With reduce emulated, no animation
  ran after load, so the gap is only in these popovers. Effort S.
- Popup/dock/tab open frames: no long task over 50 ms unthrottled except Top view 147 ms and a scroll frame of 83 ms at 1920.

## UX / UI
- U1 Four-column dock crushes names at 1280 (idris-scroll2.png): Decoy launcher, Mass Driver Cannon, Internal
  Tank wrap one letter per line; value labels (TOTAL ROUNDS CARRIED, FUEL CAPACITY) collide with names. Cause: 4
  columns with a fixed stat block at 1280 and below in codex-holo-table.component.ts row grid. Fix: container query so
  the stat block drops under the name below ~300 px column width, 3 columns up to 1360 px. Effort M.
- U2 Floating buttons cover content (project rule: nothing floats under the feedback launcher): at 1280 the
  mobile-link FAB overlaps the ENERGY heading and clips DEFENSIVE in the stat strip; beta + dock FABs cover the right
  end of the deck chip row (Bridge cut). On phone the FAB dial sits over the view tiles (Side cut) and deck chips (Han).
  Fix: reserve --sc-fab-clear-inline/-block for the view/deck bar and strip, .sc-dock-phone padding.
  codex-holo-stage.component.ts + codex-holo-strip.component.ts. Effort S-M.
- U3 Swap picker top edge (y=65) sits under the fusion bar: bar text bleeds over the dialog corner (swap-*.png).
  Raise dialog stacking / top inset to the bar height (codex-swap-picker host). Effort S.
- U4 Swap picker lists the same component twice (Destroyer Mass Driver Cannon: KLA Gun vs KLA Low Poly). Filter the
  Low Poly proxy from candidates. Effort S.
- U5 Tooltip Choose a mission stays over the open Einsatz menu (einsatz-*.png). Suppress scTooltip while the popover
  is open (codex-holo-einsatz.component.ts). Effort S.
- U6 At 1920 the plan occupies a 600 px strip inside the 1280 page frame; stage could scale the plan up. Effort M, low.
- U7 Text under 13 px, 13-14 leaf nodes: .size-tag 10px (codex-holo-inspector.component.ts:376), link 11px (:409),
  .hk badges (codex-holo-patch.component.ts:281, codex-holo-share.component.ts:197), .statics .v 12.5px (stage:995),
  strip small 10px / .tv .v 12.5px (strip:474,520,563). Effort S.
- U8 All decks chip renders greyed on Idris without a hint (add scTooltip). Not fully verified.
- Desktop tap targets under 44 px: 434 (expected on desktop). No raw i18n keys found (UI was English; DE unchecked).

## Phone 375x812 / tablet 768x1024
- T1 Phone page is 18,563 px tall (Idris), tablet 13,045 px: all columns stacked fully expanded. Fix: accordions on
  phone (weapons open by default) in codex-holo-table.component.ts. Effort M.
- T2 Head band wastes about 130 px; mission pill truncated to Combat 2... hides the frigate count
  (ux-AEGS_Idris_M-phone-top.png). Effort S.
- T3 Area / deck chip rows clip mid-chip (W, Han) and the reset button overlaps the last chip: fade mask +
  scroll-snap padding. Feedback launcher overlap: see U2. Effort S.
- No horizontal scroll (phone 0, tablet -10). Phone tap targets under 44 px: only 2 hidden 1x1 labels. Tablet
  breadcrumb links Codex / Ships measure 38x15 and 33x15 px. Effort S.

## Fix bundles (disjoint files)
1. Stage + dock bar + chips: src/app/codex/holo/codex-holo-stage.component.ts, codex-holo-strip.component.ts,
   codex-holo-interior-chips.component.ts. Ids: U2, U6, U7 (stage/strip), A1 (unfold, dk-*), P3, A2 (chips), T2, T3.
2. Columns: codex-holo-table.component.ts, codex-holo-inspector.component.ts, codex-holo-patch.component.ts,
   codex-holo-share.component.ts. Ids: U1, T1, P2, P4, U7 (rest).
3. Popovers + swap picker + dialog: codex-holo-einsatz.component.ts, codex-holo-hangar-menu.component.ts,
   src/app/codex/codex-swap-picker.component.ts, src/app/shared/dialog/sc-dialog.directive.ts. Ids: P1 (dialog part),
   U3, U4, U5, A2 (popovers), U8.
4. Shell: src/app/shell/fusion-bar/fusion-bar.component.ts. Ids: P1 (publishHeight), tablet breadcrumb tap target.
