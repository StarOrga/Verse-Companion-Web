# Parity — which mock binds which checklist line

The checklist itself is `briefs/implement.md` (one list, not two). This file only maps each visible line to the
mock that shows it. Mocks are the round fragments; open the built page
`docs/concepts/20261117-1110-pfad-stationen.html` over the bridge, or read the fragment. Viewports: desktop and
phone (portrait and landscape) for every line. The mocks contain no animation except the toast's time line and the
counter highlight (D1, D3); both are static in the mock, the implementation animates them and respects
`prefers-reduced-motion`.

| Line | Mock (fragment · design · screen) | What must match | Overridden by a later remark |
|---|---|---|---|
| B1, B2, B3 | `rounds/04.html` · `pfad` · `pfad-offen` | two stations, each: head with counter, then only its button | — |
| B2, B4, B5 | `rounds/04.html` · `pfad` · `pfad-beides` | both strips, same construction | B4: marks before the text "1 von 4 Einsätzen"; B5: one place + hint for more, one line |
| B4 | `rounds/04.html` · `pfad` · `pfad-schiff` | ship: strip in the wish station, button "In den Hangar" | B4 order as above |
| B6, B7 | `rounds/04.html` · `pfad` · `pfad-zuordnen` | picker under the button with caret, open state, newest first, "Neue Operation" last, footer with link | — |
| B8 | `rounds/03.html` · `pfad` · `pfad-liste` | solid ring, small Route badge on assigned rows and cards | — |
| B9 | every screen | Route glyph for the group | — |
| B10 | `rounds/04.html` · `pfad` · all, phone view | picker in the flow, names wrap | — |
| D1, D3 | `rounds/04.html` · `entfernen` · `entfernen-frei` | toast with accent edge, icon, bold name, second line, pill, time line; highlighted counter | D2: the look applies to every undo toast of the app |
| C1 | `rounds/04.html` · `entfernen` · `entfernen-dialog` | dialog, stepper, caption, self-labelled bar | C1: all segments one style, no colour difference |
| C2 | `rounds/04.html` · `entfernen` · `entfernen-mehrere` | per-Operation rows with steppers, sum line, label hanging under a narrow segment | C1 style |
| C3, C5 | `rounds/04.html` · `entfernen` · `entfernen-letzter` | hint, checkbox, single-segment bar | C1 style |
| C4, C5 | `rounds/04.html` · `entfernen` · `entfernen-aufgeloest` | danger hint, danger action, single-segment bar | C1 style |
| C7 | `rounds/04.html` · `entfernen` · `entfernen-hq` | short confirmation in the HQ | C7: a third, red button "Auch von der Wunschliste löschen" |
| C8 | `rounds/04.html` · `entfernen` · all, phone view | bottom sheets, landscape scrolls inside | — |

Lines without a mock (rules, data, words, analytics, tests): A1–A12, C6, E1–E3, F1–F3. They are judged against
their quotes and by tests.
