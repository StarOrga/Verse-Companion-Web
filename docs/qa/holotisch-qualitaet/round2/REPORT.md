# Holotisch audit, round 2 (verification of commits 4956e4b5e..b5f152e1c)

Same scripts, DEV build on 127.0.0.1:4311, test account, read-only. Evidence: docs/qa/holotisch-qualitaet/round2/
(perf-*.json, ux-AEGS_Idris_M.json, s-*.png, c-classic-*.png, swap-*.png, cul.out). Dev timings are noisy (first run
after a cold compile: Idris 1280 x1 showed CLS 0.41 once, a rerun gave 0.084; treated as an outlier).

## Round-1 findings: verdict, before -> after
| id | verdict | evidence |
|---|---|---|
| U1 column names at 1280 | fixed | names whole, headline figure drops under the name (s-d1280-1700.png); was one letter per line |
| U2 FAB lane | partly | 1280: dock bar and view row now stop at x=1128 (lane kept) but the stat strip (DEFENSIVE) and column bottoms still run under the left mobile FAB (s-d1280-900.png, -1700.png). Phone: FAB dial (121,435 232x200) still sits over the Side view tile and deck chips (s-phone-0.png) |
| P3 CLS 1920 Idris | partly | 0.39 -> 0.164; remaining shift is the skeleton: sc-card skel-stage 520 -> 370 px high (cul.out, 0.154). 1280 0.084-0.10 |
| A1 drawer unfold | partly | brightness filters removed (stage dk-*), unfold/fold now animates grid-template-rows 0fr->1fr instead of height: still a layout property, not compositor-only. Not frame-sampled |
| P1 swap picker open | partly | 211/252 ms -> 163/212 ms (1280/1920 x1); 4x: 1238 ms max, 2383 sum -> 1320 max, 2116 sum. Profile now: focus 404 ms + getBoundingClientRect 418 ms (was hasGeometry 677 + publishHeight 453). The scan is gone but focus() on a 15k-node document still forces layout |
| U3 swap below bar | fixed | dialog top y=152 under the bar (swap-AEGS_Idris_M-1280-x1.png), was 65 |
| U4 Low Poly twin | fixed | list 2 of 9 -> 1 of 8, single Destroyer Mass Driver Cannon |
| U5 Einsatz tooltip | fixed | no tooltip over the open menu (s-einsatz-open.png) |
| T1 phone height | fixed | Idris 18,563 -> 7,288 px, tablet 13,045 -> 5,779; blocks fold on phone (energy block still tall, see N2) |
| T2 phone pill | partly / regressed | count now visible ("2 x Frigate") but the mission name truncates to "Co..." (s-phone-0.png) |
| T3 chip rows / reset | not fixed | area chip row still cuts "W" under the reset button (s-phone-0.png) though a fade mask was added |
| P2 Idris load | not fixed | long tasks 9/max 899/sum 2016 -> 8/856/2017; DOM 15.1k -> 15.1k; at 4x 31/6059 -> 26/5066 (noise level). content-visibility skips paint, not DOM creation |
| P4 ph-scan | fixed (code) | moved to transform |
| A2 reduced motion | fixed (code) | einsatz, hangar-menu, interior-chips now carry rules; no animation running with reduce emulated |
| U7 text under 13px | partly | smallN still 13-14 leaf nodes on all viewports (ux json); inspector/patch/share/strip rules touched but count unchanged |
| U6, U8 | not touched | |

Other numbers: Starlifter 1280 x1 LT 10/750 -> 6/492, CLS 0.096 -> 0.085, h1 6.1 s -> 5.2 s (improved). Idris 1280 x4
Top view long task 369 -> 930 ms (single sample, possibly noise; recheck). FPS 60 unchanged, no console errors.

## New findings
- N1 (S) Phone pill shows "Co..." for the mission name: let the name keep min-width and truncate the frigate count
  instead, or shrink the hangar pill. src/app/codex/holo/codex-holo-einsatz.component.ts (pill) / head layout.
- N2 (M) Phone energy block renders giant square bars (s-phone-1400.png, one 52 px tile per segment): cap segment size
  on phone in codex-holo-energy.component.ts.
- N3 (S) Dialog focus still forces layout (focus 404 ms at 4x): focus the dialog container immediately and move focus to
  the search input in the next animation frame, or set scDialogInitialFocus to container for the swap picker.
  src/app/shared/dialog/sc-dialog.directive.ts:~105 / codex-swap-picker.component.ts.
- N4 (S) fusion-bar publishHeight re-arms its settle timer for as long as a modal is open (fusion-bar.component.ts:~991):
  it polls instead of reacting to ModalInertService closing; subscribe to depth 0 instead.
- N5 (S) Skeleton stage is 520 px, real stage 370 px at 1920: match the skeleton height
  (codex-holo-stage skel-stage) to remove the remaining 0.154 shift.
- N6 (S) Deck chip row at 1280 ends at x=1100 with Turrets/Bridge hidden behind the fade, no scroll hint.

## Classic page (?view=classic, shared code)
Unchanged by the new rules: host .calm false, container-type normal, .mod-sec content-visibility visible, no holo table,
all loadout open states as before (code gate: new hardpoint rules are :host(.calm) only; phone folding is calm()-gated).
Screenshots c-classic-0.png / c-classic-loadout.png. Not compared pixel-for-pixel against a main build (none built).
Classic CLS 0.31 and tertiary-scAction console warnings exist but were not compared with main either.
sc-dialog change is shared by all dialogs: focus order now selector-based (first tabbable, 12 tries); no console errors seen.
