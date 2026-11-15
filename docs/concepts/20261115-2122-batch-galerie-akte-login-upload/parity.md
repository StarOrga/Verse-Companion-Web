# Parity checklist

The parity checklist of this design implement is the checklist in `briefs/implement.md` (lines B1.1-B4.10); each line names its spec screen in `rounds/01.html`. Animations without a mock (B1.7, B3.2) are designed by the designer agent first; their timings/keyframes are added here once fixed.

## B1.6 filter-switch motion (complements `d1-segment-top`)

The mock covers the arrival only (`fbFade`: opacity 0 + blur 3px → 1, 0.5 s ease). Built as:

- **Hold:** on a segment pick the wall keeps the tiles it shows (no skeleton wall, no empty state, no layout
  jump) and dims them to opacity 0.4 over 160 ms ease, `pointer-events: none`, `aria-busy="true"`.
- **Arrive:** when the new view's first page lands, the wall element is re-created and runs `fbFade`
  exactly as the mock: 0.5 s ease, opacity 0 → 1, blur 3px → none (no blur on `pointer: coarse`).
- **Reduced motion:** no dim transition, no fade — the list swaps in place.

## B1.7 motion spec — staged gallery load

**Intent.** Opening the gallery should read like a briefing coming online, not like a grid popping in: first the
gallery tells you what is new, then what is yours, then the rest of the wall arrives on its own. Two phases are
announced (word over the image area), the third is not.

**When it plays.** Only when the first page of the *Alle* view arrives in this mount (a cold load — the gallery's
rows live in a root service, so coming back within the SPA paints at once and does not replay it), not while a
deep-linked image is opening, and never under `prefers-reduced-motion: reduce`. Only the first painted chunk
(24 tiles) is staged; later chunks and pages appear as before.

**Sets.** *Neu* = tiles published within the last 14 days. *Sammlung* = tiles in the reader's Sammlung
(up-voted; signed out = empty). A tile in both counts as *Neu*. An empty set skips its phase (no word without
tiles behind it); the timeline closes up.

**Timeline** (each phase starts when the previous one ends; t in ms from the page's arrival):

| phase | span | announcement | tiles |
| --- | --- | --- | --- |
| 1 Neu | 0–1100 | veil + word „NEU" | its tiles in, 70 ms apart, + accent mark |
| 2 Sammlung | +0–1100 | veil + word „SAMMLUNG" | its tiles in, 70 ms apart, + accent mark |
| 3 rest | +0–≤900 | none | remaining tiles in, 30 ms apart (stagger capped at 600 ms) |

- **Veil (partial overlay):** absolutely over the wall, covering its top `min(100%, 70vh)` — the image area the
  reader sees — `pointer-events: none`, `aria-hidden`. Radial darkening `rgba(2,7,13,.55)` → transparent plus
  one thin cyan scan line. Keyframe `stgVeil` 1100 ms: opacity 0 → 1 (0–20 %), hold, → 0 (75–100 %).
- **Word:** display font, uppercase, cyan, centred in the veil. Keyframe `stgWord` 1100 ms
  `cubic-bezier(.2,.7,.2,1)`: opacity 0 + letter-spacing 0.6em + translateY(8px) → opacity 1 +
  letter-spacing 0.32em (0–25 %), hold, fade out (75–100 %).
- **Tile in:** keyframe `stgIn` 420 ms `cubic-bezier(.2,.7,.2,1)` both: opacity 0, scale(.96), blur(6px) → none
  (no blur on `pointer: coarse`). Before its delay a tile is invisible (fill-mode both) but stays clickable.
- **Accent mark (phases 1–2):** keyframe `stgMark` 900 ms ease-out, starting with the tile: box-shadow
  0 → `0 0 0 1px var(--sc-accent), 0 0 22px accent 45 %` (30 %) → 0.
- **Cost:** CSS animations only, all one-shot; one `setTimeout` drops the staging class when the timeline ends.
  No `requestAnimationFrame` loop, nothing runs after ~3.1 s.
- **Reduced motion:** no veil, no word, no stagger — the wall paints at once (also guarded in CSS).
