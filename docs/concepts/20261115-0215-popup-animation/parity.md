# Parity checklist: popup animation

Every line maps a mock behaviour to the implementation. Mock = `rounds/02.html`, design `r2d2` (classes `.pa-e2`), unless noted. Timeline in the mock: a 5 s loop, open click at 500 ms, close click at 3600 ms; `o(f)` = open start + f × open duration, `c(f)` = close start + f × close duration.

| # | Behaviour | Mock source | Keyframes / timing | Implementation must |
|---|---|---|---|---|
| P1 | Spark at the trigger (anchored) or the centre (dialog, large) | round 1 `d1` (praised), round 2 `.pa-spark`, `.pa-spark-c` | `pa2e2{k}-spark`: 0→1.1 scale by o(.12), fades by o(.5); re-flash at c(.85..1) | keep, but per the round-2 pin never at full size while the line is at full length (C2) |
| P2 | Light line expands from the origin | `.pa-scan` top / mid / bottom | `pa2e2{k}-line`: scaleX 0→1 from o(.1) to o(.38); mid lines fade to 0 by o(.9), top/bottom rest at .4 | shorter and softer per the pin; blends into the outline instead of overshooting it |
| P3 | Outline unrolls from the line | `.pa-wire` (1 px `#bff1ff`, glow) | `pa2e2{k}-wire`: clip from the line band to full o(.12)→o(.5); fades to .35 by o(1.3) | same; faint edge remains |
| P4 | Fill fills from the top | `.pa-fill` with a mask | `pa2e2{k}-fill`: o(.42)→o(.8) | same |
| P5 | Content resolves from blur | `.pa-dlg > *`, `.pa-it`, headers | `pa2e2{k}-content`: blur(4px) brightness(1.5) → none, o(.62)→o(.97) | same |
| P6 | Rows: light edge, no flicker | `.pa-tbl tbody tr` | `pa2-row`: clip-path reveal + gradient sweep, o(.6)→o(.85), 30 ms stagger, 6 rows | same |
| P7 | Close: collapse to the line, line into the spark | all surfaces | panel clip full → band c(.2)→c(.75), line scaleX→0 c(.75)→c(.95), spark c(.85..1) | same, durations C4 |
| P8 | Durations | `SURF` table in the generator | menu 300/160, dialog 500/250, large 900/400, toast 300/160, lightbox 650/300, phone 500/250 (open/close ms) | same |
| P9 | Lightbox holo zoom | screen `r2d2-lb` | `pa2-lbzoom` translate/scale from the thumbnail, `pa2-lbtint` blue tint fades by o(1.2), `pa2-lbimg` desaturated → colour | same, real thumbnail rect as origin |
| P10 | Phone fullscreen from the button | screen `r2d2-phone` | `.pa-full` grows from the top-right trigger, outline + fill as P3/P4 | same, origin = trigger rect |
| P11 | Scrim with faint dot grid | `.pa-r2 .pa-scrim` | opacity with the open | replaces the horizon/star plate of the old large kind |
| P12 | Toast from its corner | screen `r2d2-toast` | bottom band, origin bottom right | same |
