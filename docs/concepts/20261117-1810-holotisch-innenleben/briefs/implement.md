# Implement brief — Holotisch Innenleben (beta holotable interior)

Concept: `docs/concepts/20261117-1810-holotisch-innenleben.html`
Rounds (binding spec, mock markup + CSS): `rounds/01.html`, `rounds/02.html`
Decisions: `docs/concepts/20261117-1810-holotisch-innenleben-decisions.json`
Prototype extractor + render code and real outputs: `prototype/`
(`probe_interior3.py` = interior extract, `compose.py` = deck merge rules,
`render.py` / `render3d.py` = top view + 3D projection used by the mocks,
`*.interior.json` = real LIVE Data.p4k output for Idris-P, Starlancer MAX,
Reclaimer, `relay_summary.txt` = relay probe result).

## Verbatim user words (all rounds; later rounds override earlier ones)

### Origin prompt (chat)
> im beta holotisch Decks werrden nicht gut angezeigt! a) visuell ist es kein charme, gerade wenn man einzelne räume anklickt sollte kein schwarzerr rand kommen und rechts unter bauteile etwaige bauteile zugänglich aus dem raum erscheinen, ggf. weitere infos. b) mir fehlen die ganzen angaben bzgl. INNEN, die auch https://maps.adi.sc/?ship=idris&deck=3&variant=P hat. Die machen das schon richitg gut, siehe anbei, mit floor plan, diversen wichtigen kompnenten, laufwege deck wechsel. Visuell allerdings kein highlight 🙂 Analysiere sie aber noch viel tiefer,wir können das gleiche aus der data p4k holen und viel besser visualisieren! c) mir fehlt eine 3d ansicht innen wo man durch die decks sich klicken kann! Btw, Treppen, Leitern und Aufzüge ganz wichtig nebst rampen! d) unter bauteile sollte dann sozusagen eine überischt der innelemente kommen bzw. wenn angeklickt das element, von escape pods bis zu aufzügen über türen, alles was für das gameplay / engineering wichtig ist, recherchiere nochmal gut! Auch waffenschränke usw.! gern unter bauteile dann auch eine minisuche auch für den außen bzw. komponenten part, damit man das richtige bauteil auch suchen kann auf einer lupe. Bitte mache hier lokal teilextraktionen um das selbst zu verstehen und zu testen anhand beispiel schiffen. Bitte nimm dir internet daten zu dem schiff um zu schauen welche decks es actually hat hier nur zur verifikation. Alles um den data uploader top zu machen!

> Außerdem will ich im innenleben auch die cargo grids deutlich sehen! auch in data p4k zu finden! Die sind sher wichtig für das fracht gfameplay

### Round 1 (iterate)
- General: „auf der genannten vergleichswebsite war noch so cool drumherum in 3D das schiffe ganz leicht gezeichnet und man wusste wo das deck gerade amm schiff ist und konnte es auch drehen. Ich sehe das so wie außen, dort gibt es die 3d und die einfache ansicht. dafür jeweeils noch eine fitler mit dem ausgewählten deck! Dann können wir uns außen und innen sparen, es gibt nurr noch 3d einfach und die seitenansichten und zusätzlich decks als filterauswahl unten! Nebst den komponenten die angezeigt werden sollten (standardmäßig nach typ ausgewählt, e.g. frachter sollen cargo decks vorausgewählt habnen, medic schiffe, medic sachen und kampfschiffe eher kampf sachen).“
- d1 Deckplan 2D: „das ist super!“ · d2 3D-Schnitt (exploded stack): „das geht gar nicht!“ · d3 Bauteile & Suche: „das finde ich auch nicht schlecht!“
- r1-decks = **lifts** („Aufzug-Halte und Bereichs-Container legen die Decks fest — Idris 6 Decks, Starlancer 2; Zwischenebenen gehören zum Deck darüber“), note: „und leitern!“
- r1-scope = **cargo, wege, med, gear, fire, tech, home, doors** (all 8; doors deviates from the recommendation), note: „auch türen sind wichtig für das gameplay!“
- r1-3d = **extrude** (3D interior = extruded room floor plans from the extract)
- r1-coverage = **all** („Für jedes Schiff mit Innen-Containern — auch kleine Schiffe zeigen Cockpit, Bett, Spind.“)
- r1-relay = **yes** (probe done → each container names its powering relay; relay → single component edge is empty in the item records)
- r1-gaps = **show** („Lücke offen ausweisen und im Upload-Log warnen — Summe stimmt nie heimlich“)
- r1-events = **yes**, the four proposed events:
  `'codex:deck_select' { ship, deck, view: '2d' | '3d' }`, `'codex:interior_filter_toggle' { group, on }`,
  `'codex:interior_element_select' { ship, kind, deck }`, `'codex:parts_search' { scope: 'outer' | 'inner' | 'both', hits }`
  plus a tile „Innen genutzt“ (deck switches and searches per week) in the Codex PostHog dashboard.

### Round 2 (implement)
- General: „wichtig nur umsetzung für beta holotisch“
- r2d1 „3D mit Hülle“: „sehr gut so machen!“ (r2d2 Einfach + Deckfilter and r2d3 Bauteile & Suche got no remark; they carry the round-1 approvals of d1 and d3)
- r2-presets = **yes** („Fünf Rollen-Gruppen, jede mit Filter und Start-Deck“; unknown roles fall to „Sonstige“; examples: Idris-P Kampfschiff · Fregatte → Waffen, Türen, Wege, Medizin · Start Hauptdeck; Starlancer Mittlerer Frachter → Fracht, Wege, Türen · Start Unteres Deck; Reclaimer Bergung → Fracht, Technik, Wege · Start Deck 01 Laderaum)
- r2-remember = **none** (deviates; „Nichts merken — Jedes Öffnen startet mit der Rollen-Vorauswahl.“)
- r2-doors = **kind, breach, panel, cell** (not access rights)

## Checklist (one line per accepted item; acceptance is judged against the quote)

### A · Uploader / extract (devops:core, Python `data-uploader/python/sc_extract/`)
- [ ] A1 Interior payload per ship: `interior` on `ShipPayload` with `pois[]`, `cargoGrids[]`, `lifts[]`, counts; POI `{cat, kind?, pos[x,y,z], deck, room?, container}` in the hull model frame. Quote: „wir können das gleiche aus der data p4k holen“. Port from `prototype/probe_interior3.py`.
- [ ] A2 Element categories (all 8 groups of r1-scope): Fracht (cargo grids), Wege (lift, stairs, ladder, ramp, airlock, docking), Medizin (medBed, respawn), Ausrüstung (weaponRack, locker), Brandschutz (fireExt), Technik (relay, powerPlant, cooler, shield, quantumDrive, jumpDrive, lifeSupport, radar, fuelTank, maintenance), Wohnen (bed, head), Türen. Escape pods when present. Quote: „von escape pods bis zu aufzügen über türen … Auch waffenschränke“.
- [ ] A3 Doors: real doors only (filter `door_navlink` and `Door_Ship_Sensor_Proximity`); per door `kind` (room / inner+hatch / lift / hangar / bow / airlock / ramp / cell), `breachable` bool, `panel` (nearest door control panel position or null), cell doors flagged. Quote r2-doors + „auch türen sind wichtig für das gameplay!“. Idris expectation: 94 doors (71 room, 13 inner/hatch, 3 lift, 3 hangar, 2 bow, 2 airlock).
- [ ] A4 Cargo grids: from the loadout (`*_CargoGrid*`), `interiorDimensions` → dims, SCU = floor(x/1.25)·floor(y/1.25)·floor(z/1.25), position from hardpoint transforms, deck assigned. Idris-P sum 1374 SCU. Quote: „cargo grids deutlich sehen! auch in data p4k“.
- [ ] A5 Gaps shown: located SCU vs `cargoScu`; a grid port without item class is listed as a gap in the payload (`cargoGaps`) and warned in the uploader log. Starlancer MAX: 96 of 224 located. Quote r1-gaps „Lücke offen ausweisen und im Upload-Log warnen“.
- [ ] A6 Decks from lift stops + area containers (r1-decks = lifts, „und leitern!“): derived-deck hulls (Idris) merge to 6 decks (Argo, Hangar, Oberer Hangar, Hauptdeck, Geschütz, Brücke) per `prototype/compose.py`; ladders and stairs count as deck connectors too; Starlancer lower rooms land on the lower deck (lift stops −4.4 / +0.7). Verify against the ATLAS counts (Idris 6, Starlancer 2, Reclaimer 5).
- [ ] A7 Lifts: `{at[x,y], stops[z…], decks[…]}` clustered per shaft; ladders and stairs as POIs with their deck span.
- [ ] A8 Relay per room: each object container's `resourceNetworkItemportName` → room `poweredBy` (relay port). No relay→component edge (data does not carry it).
- [ ] A9 Coverage: every ship with interior containers (r1-coverage = all), small ships included.
- [ ] A10 Ingest + types: `supabase/functions/ingest-catalog` passes the new fields through (check validation / stripping); `ShipPayload` / `ShipDeck` / `ShipDeckRoom` types extended in `src/app/codex/codex.types.ts`; payload stays compact (arrays, rounded to 0.1 m) — mind the 500 MB DB budget and TOAST notes in `.claude/deep-knowledge/storage.md`. Python tests for the new extract (pytest, `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`). Commit trailer rules: memory "Subtheme-Guard" — `dataforge_extract.py` changes need `Subtheme-Unchanged:` trailers for every subtheme not bumped.

### B · Beta holotable UI (devops:frontend + devops:designer) — „nur umsetzung für beta holotisch“
- [ ] B1 View row: no Außen/Innen split any more. One group „Ansicht“: Akte · 3D · Einfach · Oben · Seite · Front; decks become a **filter** row next to it („Deck · Filter“: Alle + each deck, with SCU per deck when > 0). Quote: „Dann können wir uns außen und innen sparen, es gibt nurr noch 3d einfach und die seitenansichten und zusätzlich decks als filterauswahl unten!“ — moved role = two lines: B1a the deck filter gains deck selection for 3D AND Einfach; B1b the „Innen“ view group and its deck thumbnails are removed (`codex-holo-stage.component.ts` `viewGroups`, ~l.1351).
- [ ] B2 3D mit Hülle (r2d1, „sehr gut so machen!“): in 3D with a deck picked, the hull is a light ghost (rings + ribs from the ship's silhouette, as in `rounds/02.html` r2d1 / `prototype/render3d.py`), the focused deck solid (extruded room floors + low walls, r1-3d = extrude), other decks faint; cargo grids as 3D boxes; lifts as glowing vertical lines with stop dots; ladders as their own lines; POIs of the filtered groups as icons. Drag rotates, wheel zooms (mock legend „ziehen · drehen · Rad · zoomen“). „Alle“ shows all decks equal. Quote: „in 3D das schiffe ganz leicht gezeichnet und man wusste wo das deck gerade amm schiff ist und konnte es auch drehen“ + „3d ansicht innen wo man durch die decks sich klicken kann“.
- [ ] B3 Einfach + deck filter (d1 „das ist super!“): top plan of the picked deck with rooms, cargo grids (with SCU), POI icons of the filtered groups, doors as small dots when Türen is on.
- [ ] B4 No black frame on a clicked room (`src/app/codex/ship-deck-plan.component.ts`: room `g` takes focus → browser default outline `rgb(16,16,16) auto 5px`; the selected label's `paint-order: stroke` with `--sc-bg-0`). Keyboard focus keeps the project focus ring (`--sc-focus-ring*`), mouse click none. Quote: „sollte kein schwarzerr rand kommen“.
- [ ] B5 Room selection fills Bauteile: the elements in / reachable from the room, its deck, relay („Versorgt von Relais …“), SCU of grids in it. Quote: „rechts unter bauteile etwaige bauteile zugänglich aus dem raum erscheinen, ggf. weitere infos“.
- [ ] B6 Bauteile overview of interior elements grouped by type with counts (per deck when a deck is picked); clicking an element selects it and shows it in the view. Quote: „unter bauteile … eine überischt der innelemente … bzw. wenn angeklickt das element“.
- [ ] B7 Mini search (magnifier) in Bauteile across exterior parts/components AND interior elements, rooms, doors; a hit jumps to it. Quote: „eine minisuche auch für den außen bzw. komponenten part … auf einer lupe“.
- [ ] B8 Element group filter chips (Fracht, Wege, Medizin, Waffen, Spinde, Brandschutz, Technik, Wohnen, Türen) with a role preset on open: five role groups (Kampf → Waffen, Türen, Wege, Medizin; Fracht → Fracht, Wege, Türen; Medizin → Medizin, Wege, Türen; Industrie/Bergung → Fracht, Technik, Wege; Sonstige → Wege, Türen), each with a start deck (deck with most of the preset's elements / most SCU for cargo). Chip „Voreinstellung <Rolle>“ + „zurücksetzen“. Quote: „standardmäßig nach typ ausgewählt, e.g. frachter sollen cargo decks vorausgewählt habnen, medic schiffe, medic sachen und kampfschiffe eher kampf sachen“.
- [ ] B9 Nothing remembered (r2-remember = none): every open starts from the role preset; no persistence of filter changes.
- [ ] B10 Gaps visible: when located SCU < ship SCU, the deck filter / Bauteile say so (e.g. „96 von 224 SCU verortet“). r1-gaps = show.
- [ ] B11 Analytics: the four events in `src/app/core/analytics/events.ts` fired at the matching actions (convention `docs/analytics/event-naming.md`); dashboard tile noted as follow-up only if the PostHog MCP is unavailable (it is failing to connect this session).
- [ ] B12 Project rules: all strings via ngx-translate (de + en), `scAction` for actions, `[scTooltip]` not `title`, no native dialogs, `OnPush` + signals, colours from tokens (cargo amber, ways cyan, med green, weapons orange-red …, as in the mocks), works at phone width (deck filter scrolls), unit specs for the new logic (Vitest).

## Out of scope
- The classic (non-beta) codex ship page beyond the shared deck-plan focus fix (B4).
- Door access rights (not chosen).
