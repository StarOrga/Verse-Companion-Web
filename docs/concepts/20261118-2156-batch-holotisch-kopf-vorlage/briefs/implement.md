# Implement brief — batch-holotisch-kopf-vorlage (round 1, implement)

Decisions: `../payload-r1.json` (round 1 payload, verbatim; `-decisions.json` is written at close-out).
Mock (binding spec for the head): `../rounds/01.html`, design **d2 "Kommandoleiste"** (favourite), screens `r1-d2-s1` (top), `r1-d2-s2` (scrolled), `r1-d2-s3` (P4-AR). CSS classes `.mock-hk-d2 .mock-hk-head` / `.slim`.
Living spec to continue: `docs/concepts/codex-holotisch-ui-spec.md` (append a section at close-out).
Source notes (verbatim, archived): `.claude/batch-2026-11-18T20-53-04-495Z.md`.

## User's words, verbatim

Batch notes:
- #1 „Warum ist dort eine hässliche lücke!?  fix das“ — attachment `.claude/batch-assets/2026-11-17T16-15-58-539Z-1.webp` (OPEN IT before changing anything: gap between the Ansicht/Teile bar under the holotable and the sticky KPI strip, across the full width; small tab stub under „Akte/3D“).
- #2 „Im holotisch gefällt mir in beta noch nicht der obere bereich markiert. Ich habe das gefühl das sollte auch irgendwie an den subheader stickien, auch dann beim runterscrollen mitlaufen und visuell stimmiger sein! Ich finde die leichtgewichtigkeit gut, aber hmmm...“ — attachment `.claude/batch-assets/2026-11-17T16-15-26-902Z-t1.webp`.
- #3 „bitte gleiche für alle anderen gegenstandstypen, z. B. die p4-ar detailsseite die holotisch variante in der beta an die der schiffseite soweit sinnvoll an! Ich will nicht das das zwei verschiedene template codes sind sondern einer und sich je nach gegenstandstyp elemnete und oc anders aktivieren, ggf. andere content aufteilung haben etc. Die sollten so nah beieinander sein ohne das die anderen geegenstandstypen nciht auch funktionieren wenn sie ienfach sind (z. B. Eisen oder Rucksack oder wasser) oder wenn sie weitere infos brauchen, z. B. statt Bauteile eher ... Aber wenn ich die schiffsdetailsetite weiterentwcikle im holotisch beta, dann will ich auch das die ander egegenstandstypen detailsseite auch sich dadurch verebssert (falls es ncihts schiffstypisches ist)“
- #5 „die breadcurmb leiste fehlt wenn man in hq ist !“ — attachments `.claude/batch-assets/2026-11-17T22-07-33-237Z-1.png`, `-2.png` (subheader on /hq#inventar shows only „HQ“).
- #6 „die sterne mit sternschnuppe sollte eher im background sein, als ein eigenes element in dem popout. Außerdem wenn man auf wünsche suchen klickt im popup dort das gleiche. Somit ist das pnael auch konsistenter und leer etwas veritkal kleiner“ — attachments `.claude/batch-assets/2026-11-17T22-11-49-268Z-1.png`, `-2.png`.

Round 1 (favourite d2):
- Annotation r1-d2-s1-a1 („Das Band ist halbtransparentes Glas ohne Oberkante, es wächst sichtbar aus dem Subheader heraus. Wirkt das noch leicht genug?“) → „joa, gern polishen!“
- Pin d2/s1 on the head: „gern dann  mitscrollen lassen“
- Pin d2/s1 on the Einsatz pill: „gern das hier auch mit einsatz... redesignenen, die leiste soll immer oben sein“
- Pin d2/s1 on the hangar pill: „das hangar auch redesignen.“
- Pin d2/s2 on the slim bar: „finde ich gut, dass die zeile kleiner wird, bitte visuell auch ggü. der unteren zeile unddem subehader sehen,d dass es in der höhe etc. sinnvoll passt“

Decisions (all = recommendation): r1-tpl `shell` (one detail shell with a kind profile) · r1-tabs `werte, bezug, verbaut, aenderungen` · r1-simple `compact` (small stage, wider panel, no strip) · r1-order `together` (shell scaffold first, the head as its first shared part) · r1-gap yes · r1-crumb yes · r1-wish yes.

## Checklist (each line: quote → requirement)

B1 — Head + one template (owner: frontend)
- H1 „sollte auch irgendwie an den subheader stickien … beim runterscrollen mitlaufen“, „gern dann mitscrollen lassen“, „die leiste soll immer oben sein“ → the holotable head is a sticky glass band directly under the shell subheader (d2), stays visible while scrolling; never scrolls away.
- H2 „finde ich gut, dass die zeile kleiner wird … ggü. der unteren zeile und dem subheader … in der höhe etc. sinnvoll passt“ → once scrolled the band shrinks to one row (name + maker small, Einsatz, Hangar); its height, radius, border and inner padding are tuned to the subheader above and the KPI strip below so the three read as one family (measure all three, state the values).
- H3 „joa, gern polishen!“ (glass band without top edge growing out of the subheader) → glass band, no top border, attached to the subheader's bottom edge, soft cyan hairline glow at the bottom; light, not a heavy box.
- H4 „gern das hier auch mit einsatz... redesignenen“ → Einsatz control (`sc-codex-holo-einsatz`) redesigned to fit the band: one consistent pill language with the hangar control, works in both band sizes.
- H5 „das hangar auch redesignen.“ → hangar control (`sc-codex-holo-hangar-menu` trigger) redesigned in the same language as H4.
- H6 „Ich finde die leichtgewichtigkeit gut“ → no extra solid panel; transparency and hairlines only.
- T1 r1-tpl shell + #3 „nicht … zwei verschiedene template codes sondern einer“ → one detail shell for ship and non-ship beta pages: head band, stage slot, right panel with tabs, optional strip — driven by a per-kind profile (stage kind, tabs, strip cells). The separate `.item-page` layout in `codex-detail.component.ts:380–454` goes into that shell.
- T2 #3 „wenn ich die schiffsdetailseite weiterentwickle … soll sich die andere … auch verbessern (falls es nichts schiffstypisches ist)“ → head band, panel chrome, tab pill and strip are shared components; ship-only parts (hardpoints, decks, loadout, hexagon cohort by ship class) stay behind the ship profile.
- T3 r1-tabs → non-ship tabs: Einordnung (where data exists), Werte, Bezug, Verbaut in, Änderungen; a tab without data is not shown.
- T4 r1-simple compact → simple items (Eisen, Rucksack, Wasser): small stage, wider panel, no strip; same head band.
- T5 r1-order together → build the shell scaffold first and the new head as its first shared part (P4-AR and Liberator get the band at the same time).
- T6 project rule: missing values render „—“, never 0.
- T7 analytics: `codex:detail_tab_select { kind, tab }` in `src/app/core/analytics/events.ts` + tile in the Nutzung dashboard (`posthog/dashboards.json`).

B2 — Gap (owner: frontend, after B1 if the stage file is touched)
- G1 #1 „hässliche lücke … fix das“ + r1-gap yes → the KPI strip joins the Ansicht/Teile bar flush, no empty band, the tab stub under „Akte/3D“ is gone; checked at page end and mid-scroll at 1920×1080.

B3 — HQ crumbs (owner: frontend)
- C1 #5 „die breadcrumb leiste fehlt wenn man in hq ist“ + r1-crumb yes → HQ pages publish their crumbs via `ShellChromeService.publishCrumbs`: e.g. „HQ › Lager › Inventar“, „HQ › Lager › Hangar“, a locker entry with its name; each part a real anchor.

B4 — Wish sky (owner: frontend)
- W1 #6 „sterne mit sternschnuppe … eher im background … als ein eigenes element“ + r1-wish yes → `sc-wish-sky` becomes the absolutely positioned background of the empty wish panel (behind title, hint and button), no framed box.
- W2 „wenn man auf wünsche suchen klickt im popup dort das gleiche“ → the same in the wish cart dialog (`wish-cart-dialog.component.ts:48–50`).
- W3 „panel … leer etwas vertikal kleiner“ → the empty panel is visibly shorter (state before/after heights); text stays readable; reduced motion stops the shooting star.

Every agent returns an acceptance table: line → done / partial / not done → evidence (file:line, spec, screenshot).
