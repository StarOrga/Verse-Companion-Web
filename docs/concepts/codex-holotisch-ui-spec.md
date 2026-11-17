# Holotable (ship detail page): living UI spec

The Holotable is the default view of the ship page (`src/app/codex/holo/`). The
classic view has its own spec, `codex-schiffsseite-ui-spec.md`; the Holotable on
the Codex landing (`codex/landing/*`) is a different surface and not covered
here. Read this file before any concept for this page and continue it, do not
start over (project rule, `.claude/skills/concept/SKILL.md` rule 5).

Sources: `S` = concept 2026-09-20 "cinematisch" decisions (git dfdfb935, the page
was deleted in #636), `C` = `20261102-2215-holotisch-loadout-callouts`,
`H` = `2026-10-25-header-footer-subheader-analyse`, `T` =
`20261106-1207-holotisch-tiefenanalyse` (this analysis, its decisions file holds the
open questions below once answered).

## Standing constraints from the owner

- The site only renders what the uploader prepared: "nix zu erfinden". A missing value renders `—`, never 0 or an estimate. (S)
- "KEINE information oder funktion" may get lost between the two views; a switch between classic and Holotable stays. (S)
- The words are `Einsatz` (not Rolle, Profil, Linse). (S)

## Accepted

- Three panels in one frame, symmetric, collapsible rails. (S it4)
- 3D leads: a hull with a model opens in 3D. (2026-10-02)
- Arrival fully automatic, "no 5 seconds"; parallax, glow, count-up, scan line, sounds (off by default). (S)
- Patch selector with diff; schema and build details for admins and collaborators only. (S)
- Hangar tab docked above the table, no scrollbars in its overlay. (S)
- Perspectives as tiles with expand; sticky strip: Einsatz, three mini perspectives, ring joint, Signatur & Kühlung, open/close toggle; energy only when expanded. (S)
- Undo as a toast. (S)
- Phone: stacked by default, optional two tabs Tisch / Daten. (S)

## Built from T without a decision (2026-11-06)

Owner's explicit requests:

- No Einsatz bar over the 3D model; the strip's Einsatz field is the picker.
- Schema has sub-views: Einfach (top-down silhouette with leader lines, swappable parts only), Draufsicht, Seitensicht, Frontsicht (blueprint drawing, every hardpoint marked). The front view needs the uploader change plus a data upload; until then its button is disabled and says why.

Baseline fixes, reversible and not contested:

- Hover in 3D keeps the hull readable (softer, tweened focus); neighbours stay reachable (no tooltip bubble over them, label only blocks on its controls, stacked hotspots fan out).
- Leaving a hover waits 120 ms everywhere, so the highlight does not drop between rows.
- The part under inspection stays lit on the hull.
- 3D opens only when the model's bytes are cached; silhouette and pins stay until then. Never under a busy pointer or after working with a pin.
- Table height follows the window (400 to 820 px).
- A picked Schema sub-view is remembered across hulls; picking 3D returns to the default.
- The draft save bar floats above the strip, independent of rails and scrolling.
- Where to buy also lives in the details drawer; the search CTA "Bezugsquelle" opens it there.
- Pins and the inspector list name the gun, not its mount.

## Decided in T round 1 (2026-11-06), not built yet

Layout: the Pult is the favourite (model left, one panel right with tabs); Werkbank and Bühne are out. Scope until it is final: the first screen without scrolling, always fitting vertically, inside the subheader's width. The lower part follows afterwards.

- Hover does not dim; a click shows the hull see-through. A click opens the panel and holds; Ctrl and middle click open the Codex page.
- Dots: swappable parts by default; a toggle in the chip row shows all parts.
- Wheel scrolls the page, Ctrl zooms.
- No Einsatz bar anywhere; the strip picks. Start Einsatz follows the career (owner did not touch this, recommendation stands).
- Compare with the same role first. Percent reads "Besser als N %", once per value, not in the strip.
- Bergbau and Bergung say honestly that the data is missing. Short arrival on a hull change. Phone starts on Einfach, may open 3D fullscreen in landscape. Details drawer opens from the panel.
- Lists under the model go; the panel list takes over their grouped chip look.
- Callouts sit left or right of the model, never over it; only line and marker touch it. Same width and height: name, three top values, icon button to swap. The panel adds more values and a preview of the part's detail page with a real link.
- The strip is always on the first screen and sticks to the bottom edge when scrolling.
- The Einordnung with its hexagon lives in the panel and follows the Einsatz. The page shows the Einsatz subtly; Alles stays app blue, others get a quiet hue plus a symbol, never red or the warning colour.

## Decided in T round 2 (2026-11-06), not built yet

Glas is the favourite: no frame around the model, the panel is one sheet of glass, tabs are a sliding pill, the strip is one capsule. Gutters for callouts stay free; the model does not move while the mouse searches. Comparison group shows the group's own name ("Alle Leichten Jäger"), no term. Another Einsatz keeps other parts lit and quiets the rest. The panel head carries no Einsatz tag; the strip shows it.

Owner's direction: the hexagon's axes follow the ship's class, and stay when comparing with all ships. Rim = 100 % of the group, the median sits on the same scale (the live page already does this, `groupScale`).

## Decided in T round 3 and built (2026-11-06)

Rounds 1 and 2 above are built on the branch as well; the implement click covered all three rounds. Details: `20261106-1207-holotisch-tiefenanalyse/briefs/implement.md`.

- Hexagon axes: seven, with a profile per ship class; missions such as transport and mining keep their own axes (owner note: several missions exist).
- Scale rim: 95th percentile of the group. Helps sustained DPS and boost; alpha and shield stay under 3 % against all ships (open, needs another scale).
- Group name: the ship's class.
- Ship actions: split between the panel and the open block.

Close-out follow-ups, routed by the owner to "build now" (2026-11-06):

- Phone landscape: the 3D view is a fixed overlay with a close button, no Fullscreen API (iPhone Safari lacks it). Turning the phone again brings it back.
- Hexagon radius: square root on the holotable only. The rim stays 100 % of the group (95th percentile), the rings stay on 33 and 67 %, the numbers stay linear. This was my call: revert it in `radial()` in `codex-rank-card.component.ts` if it reads wrong.
- Part panel makers: a slot without a kind resolves through the component facet.

Filed: idle and true max EM (#967), hull variants counted once (#968). Dropped: where the ship actions sit.

## Decided and built: lower part + hangar (concept 20261107-0250, 2026-11-07)

Source: `20261107-0250-holotisch-unten-hangar/briefs/implement.md` (verbatim notes, checklist C1–C33), favourite design d2 "Seitenspalte".

- Lower part order: Bauteile im Detail first, Perspektiven last. Bauteile in **4 columns aligned to the strip areas** (Offensive … Signatur & Kühlung), no filter chips there.
- Left side column with the **width of the Einsatz column**: Beschreibung (with "Bei RSI"), Wo zu kaufen (with the wishlist control), one box "Varianten & Vergleich". No loose buttons under it.
- Strip: narrow Einsatz on the left, four areas evenly distributed; no minimise button, only the expand arrow. The arrow opens the dock anywhere: energy as its own row, then the four perspective areas. At page end the perspectives stand on their own. Phone: areas swipe sideways.
- Schema: deck plan as chips in Einfach (Außen / Deck n; one deck → Außen / Innen; no room data → none). No list under the drawing; markers are keyboard buttons. Einfach shows all callouts at once (not deselectable); the other views and 3D show a callout only on click.
- Panel tabs: Einordnung first and default, Bauteile second; picking a part brings Bauteile forward.
- Groups under 8 ships stay pickable with "nur N Schiffe". Default = narrowest group; a picked group is remembered **per ship for 12 h** (classic view keeps its account-wide choice).
- Shell beta: no hangar button anywhere (classic page loses only that row). Own ship in the Holotable: rename, note, pin, remove (remove confirms) — holotable variant only.

## Decided and built: recognisable parts in the 3D view (concept 20261117-1809, 2026-11-17)

Source: `20261117-1809-3d-ansicht-bauteile/briefs/implement.md` (verbatim notes, checklist C1–C22), favourite design d1 "Leuchtkörper". Applies to the Codex-ship holotable, the 3D preview of the classic detail pages (hero overlay), and, base look only, the Codex landing holotable; not to the 2D views.

- **Stable brightness:** no see-through on hover or selection anywhere, the hull always hides its back and inner lines (the user's own interior layer stays); hull edge lines no longer add up, so a dense underside reads like a sparse top. (C1, C2, C17)
- **Parts are lit bodies, no dots:** every clickable part is its own glowing body above the hull, parts inside the hull stay visible through it, quieter. The 12 px DOM rings are gone; invisible keyboard targets remain (Tab reaches every part, focus gives the hover look, Enter/Space select and toggle, Escape deselects, focus ring only under Tab). (C3, C18)
- **The part takes the pointer itself** (`PackageScene.pick`): a ray hit on the part, else its projected centre within an invisible 24 px (mouse) / 48 px (touch, pen) area; `cursor: pointer` over a part; a press that travels 4 px or more is a rotate and never selects or deselects. (C4)
- **Hover** lights the part (white line, brighter fill, 150 ms) and shows its **name tag** at the part, beside or above it, never on it, kept inside the stage and following the turn. Nothing else changes. (C5)
- **Selection is green** for every ship (`--sc-holo-select` `#7dff9c`, not the maker accent, not user-selectable): green fill, 2 px green outline readable through the hull, one 750 ms pulse; its name tag stays and turns green with dark text (`--sc-holo-select-ink`). The other parts drop to about a third and the hull lines to `.30`; they stay clickable and hoverable. Only the hovered and the selected part carry a tag. (C6, C7)
- **Ways out:** a second click on the selected part, a click into empty space (beside the model or on the hull), Escape, and the panel's back control "Alle Bauteile", which clears the selection and lands on the list of all parts (never on Einordnung). A double click re-frames only off a part; on a part it toggles once. No visible ✕ at the selection. (C8–C12)
- **Turntable** (hero preview) holds while the pointer is over the model and while a part is selected, then runs on. Touch: the first tap selects and opens the details at once; select, switch and deselect work in portrait and in the landscape overlay. Reduced motion: no pulse, instant states. (C13–C15, C19)
- **Classic detail pages** keep their click behaviour (popup / navigation), with the same idle / hover / selected look. (C16)
- Analytics: `codex:part_select { source: model | list | keyboard }`, `codex:part_deselect { via: empty | again | panel | escape }`; tile "Bauteil-Auswahl je Holotisch-Besuch" in the Nutzung dashboard. (C20)

## Rejected, do not re-propose without saying so

- In the 3D view (concept 20261117-1809): dots or rings over the parts; permanent name labels on every part (d3 "Etiketten"); a focus frame / brackets and a hull turning into a contour (d2 "Röntgen-Fokus"); a visible ✕ at the selection ("kein sichtbares x an der auswhal bitte"); see-through of the hull on hover or selection; a colour picker for the selection colour ("nicht auswählbar machen, wir machen grün"); the same selection states in the 2D schema views.
- Compare button on the ship page ("eher auf der Landing ... Richtung Simulation"). (S hv-s2)
- "Schiff wechseln" and a share button in the toolbar. (S hv3-s2)
- Global density setting; density lives inside the boxes. (S hv5-s3)
- An "Ursache" tile or a "Sichtbar als" label in the strip; an energy segment in the collapsed strip. (S it7, it10)
- Boxed ports ("zu unruhig, zu präsent"). (S hv4-s4)
- Scrollbars in the hangar overlay. (S hv6-s2)

## Open

See `20261106-1207-holotisch-tiefenanalyse-decisions.json` once the round is answered. Older open points:

- Rank cohort by size class: no size field exists, so the scope is disabled.
- Turret and gimbal arcs: extracted (`turretMovement`), no UI (#788).
- Hull HP in the Verteidigung panel: hard-wired gap (`codex-loadout-stats.ts:637`, `codex-detail-facts.ts:306`) while the strip reads `hull.hp`.
