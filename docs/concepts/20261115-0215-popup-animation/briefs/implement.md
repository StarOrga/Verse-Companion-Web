# Implement brief: popup animation (Vektor-Aufriss)

Decisions log: [`../../20261115-0215-popup-animation-decisions.json`](../../20261115-0215-popup-animation-decisions.json).
Binding spec: the mock fragments `../rounds/01.html` (round 1, design `d1` Hologramm-Projektion) and `../rounds/02.html` (round 2, design `r2d2` Vektor-Aufriss, CSS classes `.pa-e2`, keyframes `pa2e2*`, `pa2-row`, `pa2-lbzoom`, `pa2-lbtint`, `pa2-lbimg`). Line-by-line parity checklist: [`../parity.md`](../parity.md).

## The user's words, verbatim

### Round 1 (favourite: `d1` Hologramm-Projektion)

Annotations:
- `r1-d1-menu-a1` (Q: "Ein Funke am Auslöser zeigt, wer das Menü geöffnet hat. Hilfreich oder Spielerei?"): "sehr gut!"
- `r1-d1-menu-a2` (Q: "Die Scanlinien liegen eine halbe Sekunde über dem Inhalt. Länger, kürzer oder weg?"): "etwas länger ein ticken wäre ok, was ich doof finde sind die horizontalen vielen sacan linien bevor der eigentliche inhalt erschient. Gern das nochmal reviewen, gern eine bessere, alternative dafür speeeeziell finden"
- `r1-d1-dlg-a3` (Q: "Beim Schließen fällt der Dialog zu einer Linie zusammen. Liest sich das als „abgebrochen“ oder als „erledigt“?"): "sehr gut!"
- `r1-d1-big-a4` (Q: "Zeilen flackern einzeln herein wie ein Hologramm. Passt Flackern zu einer Tabelle, die du lesen willst?"): "sehr gut, aber bitte wie ein hologramm hochwertig und nciht wie   ein grk lag"

Screen note `d1-toast`: "top"

Decision notes:
- `r1-scope`: "beim bildbetrachter gern auch nochmal rkrtitisch die animation reviewen sollte ähnlich sein nur eher zoom charakter aber halt auch holografisch !"
- `r1-phone`: "naja, eingie buttons sind ja oben,  wenn man die drückt kommt ein popup / popout, dann wäre ein blatt von unten  komisch, gern eine vollbild überblendung mti ggf. animation di ändlich ist und wenn möglich auch von der quelle des klicks (wenn es eine gibt kommt wie in dekstop!)"

Decisions:
| id | answer | recommended |
|---|---|---|
| `r1-dur` | staged: small 300 ms, dialog 500 ms, large 900 ms | short |
| `r1-close` | own short close, about half the open time | own |
| `r1-stagger` | short cascade: first 6 rows, 30 ms apart | short |
| `r1-origin` | anchored popups grow from their trigger, dialogs from the centre (untouched = recommendation) | anchored |
| `r1-input` | input accepted immediately, the animation runs underneath | now |
| `r1-interrupt` | a second click reverses from the current state | continue |
| `r1-scope` | menus, dialogs, large windows, toasts, overlay pages, quick search, corner panels (+ lightbox via the note above) | all but lightbox |
| `r1-reduced` | no animation at all | fade |
| `r1-phone` | fullscreen overlay, from the click source where there is one | sheet |

### Round 2 (favourite: `r2d2` Vektor-Aufriss, action: implement)

Annotation `r2-r2d2-phone-a3` (Q: "Auf dem Handy wächst das Vollbild aus dem Knopf oben rechts. So gemeint?"): "sehr gut!"

Pin `up-mwh69euek1t9` on `r2d2-big`, target `div.pa-scrim` (x 26.6 %, y 50.4 %):
> "wobei der anfangsstirch irgendwie nicht so richtig passt, ist zu groß, geht schlecht über und wieder zu zu dem restlichen teil der aniimatio, bitte pstark polishen! und der kreis in der mitte ist unnötig solange der strich noch existiiert, ansonsten gern in den kreis reinfahren lassen bzw. damit visuell den rkreis aufbauen in der  mitte durch reinfahren bzw. rausfahrena ber beides soltle nicht in voller größe gleichzeitig excistieren"

Unanswered annotation (keep as mocked): `r2-r2d2-dlg-a2` "Der Umriss bleibt nach dem Öffnen schwach stehen. Soll er ganz verschwinden?", so the outline stays as a faint edge.

## Checklist (one line per accepted item, owner in brackets)

- [ ] C1 Motion engine `scPopupMotion` rebuilt as Vektor-Aufriss: origin spark → light line → glowing outline unrolls from the line → fill fills from the top → content resolves from blur; outline stays as a faint edge. (frontend)
- [ ] C2 Pin polish: the opening line is shorter and blends into the outline (no hard hand-off); the centre spark never coexists at full size with the line, the line contracts into the spark / the spark grows out of the line. Same on close. (frontend + designer review)
- [ ] C3 Durations: menu, panel, toast 300 ms; dialog 500 ms; large 900 ms; lightbox 650 ms; phone fullscreen 500 ms. (frontend)
- [ ] C4 Close: own short collapse to a line, then the line shrinks into the spark; about half the open time (160 / 250 / 400 / 300 ms). No reversed open. (frontend)
- [ ] C5 Rows: soft light edge sweeps across each row with a slight blur, no flicker; only the first 6 rows, 30 ms apart. (frontend)
- [ ] C6 Origin: anchored popups (menus, panels, toasts) grow from their trigger or corner, dialogs and large windows from the centre. (frontend)
- [ ] C7 Input: focus and clicks work from the first frame; the animation never delays `scDialog` focus. (frontend)
- [ ] C8 Interrupt: re-open during a close reverses from the current state (no restart from 0). (frontend)
- [ ] C9 Scope: the shared motion on every popup kind: menus (apps, account, admin, column menu, holo hangar menu, place select), dialogs (confirm, HQ dialogs, wish cart, social visibility, add to set, ...), large windows (swap picker, component modal, compare tray, patch dossier), toasts, overlay pages (`sc-overlay-frame`), quick search, corner panels (beta, handoff), lightbox. Own keyframes (`dlg-in`, `sheet-in`, `grow`) and no-motion surfaces are replaced. (frontend)
- [ ] C10 Lightbox: holographic zoom from the thumbnail; arrives blue-tinted, then takes its colours; outline as in C1; closes back into the thumbnail. (frontend)
- [ ] C11 Reduced motion: no animation at all (instant show/hide). (frontend)
- [ ] C12 Phone: dialogs, panels and large windows become fullscreen and grow from the click source (trigger) where there is one, otherwise from the centre. (frontend)
- [ ] C13 Scene: the old horizon/star plate and the `sc-scene-pushin` page zoom of the Kamera-Welt large kind are dropped in favour of the scrim with the faint dot grid from the mock. (frontend)
- [ ] C14 Tests: unit specs for the directive (timings, reduced motion, interrupt, exit promise), existing popup specs green; build, lint, typecheck green. (qax)

Parallel work to respect: a separate session runs the concept "Popup-Aufbau" (`docs/concepts/20261115-0216-popup-aufbau*`) about popup markup and structure. Change markup only as far as the motion needs it (attach the directive, wrappers); do not restructure popup headers, footers or widths.
