# Parity checklist

The parity checklist of this design implement is the checklist in `briefs/implement.md` (lines B1.1-B4.10); each line names its spec screen in `rounds/01.html`. Animations without a mock (B1.7, B3.2) are designed by the designer agent first; their timings/keyframes are added here once fixed.

## B3.2 motion spec

Intent: the visitor does not open a form, they **arrive on a ship's bridge above a planet** — the canopy goes from black to
the Verse, microTech rises into the window, the sun's light sweeps across the glass, the HUD frames lock on and the
sign-in console powers up beside it. One take, ~2 s, then the scene breathes quietly; nothing loops on the main thread.

Built in `src/app/auth/login-scene.component.ts` (scene) and `src/app/auth/login.component.ts` (header, panel,
footer). Every phase is a CSS keyframe with `animation-fill-mode: both`; the resting styles ARE the final frame.

| # | phase | element | from → to | delay | duration | easing |
|---|-------|---------|-----------|-------|----------|--------|
| 1 | Void → stars | `.ls-stars` (two layers) | opacity 0, scale 1.06 → 1, 1 | 0 ms | 900 ms | `cubic-bezier(.16,1,.3,1)` (expo-out) |
| 2 | Planet rise | `.ls-world` (CSS disc + atmosphere + canvas) | translateY(22%) scale(.9), opacity 0, brightness .4 → rest | 150 ms | 1400 ms | expo-out |
| 2b | Ring draw | `.ls-ring` | clip-path inset(0 100% 0 0) → inset(0) | 600 ms | 1100 ms | `cubic-bezier(.65,0,.35,1)` |
| 3 | Light sweep | `.ls-sweep` (diagonal light band over the canopy) | translateX(-120%) → translateX(120%), opacity 0 → .9 → 0 | 750 ms | 900 ms | `cubic-bezier(.65,0,.35,1)` |
| 3b | HUD lock-on | `.ls-hud` corner brackets + readout | scale 1.08, opacity 0 → 1, 1 (a 2-step flicker at 60 %) | 900 ms | 500 ms | `steps`-free ease-out |
| 4 | Header / footer | `.lg-head`, `.lg-foot` | translateY(∓8px), opacity 0 → rest | 200 ms / 1300 ms | 500 ms | ease-out |
| 5 | Panel materialises | `.lg-panel` | translateX(32px), opacity 0, blur(6px) → rest; its left edge glows once (`::before` scan line top → bottom) | 950 ms | 650 ms (scan 700 ms) | `cubic-bezier(.2,.8,.2,1)` |
| 5b | Panel content | `.lg-panel .st` children | translateY(8px), opacity 0 → rest, stagger 55 ms | 1100 ms + i·55 | 380 ms | ease-out |
| 6 | Hero copy | `.lg-hero .st` children (word, tag, join, pitch, perks, CTA) | translateY(12px), opacity 0 → rest, stagger 80 ms | 1150 ms + i·80 | 520 ms | expo-out |
| 7 | CTA settle | primary submit | one accent glow ring (box-shadow 0 → 14px → 0) | 1750 ms | 600 ms | ease-out |
| 8 | Living planet | `<canvas>` of the shared Verse body engine (`VerseBodiesService`, microTech) | attached at 1800 ms (after the intro, so its worker / shader warm-up never competes with it); fades in over the CSS disc | ≥1800 ms | 700 ms | ease |

Idle (after ~2 s): the stars twinkle (two layers, CSS opacity, 5 s / 7 s alternate), the atmosphere breathes
(CSS, 9 s alternate). The planet turns in the app's shared body engine — an OffscreenCanvas worker that is
already the Verse hub's planet renderer, pauses when the tab is hidden or the canvas leaves the view and
lingers warm for the hub after sign-in. No `requestAnimationFrame` loop on the main thread, no JS timers
besides the single 1800 ms attach.

`prefers-reduced-motion: reduce`: every animation is `none` — the page renders the final frame at once; the body
engine is created with `still: true` (draws one frame, never turns) and is attached immediately.

Phones (≤ 860 px): the scene becomes a band on top (`clamp(170px, 30dvh, 260px)` under the header), the header keeps
the shell's brand plate and the band carries „Join the Club.“ + tagline (the hero word mark stays the page `<h1>` for
assistive tech only, no second brand plate); the panel rises from below (translateY(24px)) instead of from the right.
Same timings.

Panel switches after the intro (apply / reset / back): the host gets `.switched` and the console's content crossfades
in 220 ms (translateY 8px → 0) — the 1100 ms intro stagger never replays.

Without WebGL / before the maps load: the CSS disc (radial gradients, no SVG filters — cheap first paint) stays.
