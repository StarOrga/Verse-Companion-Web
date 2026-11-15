# Implement brief — Feedback-Paket (round 1, action implement)

Generated from the round-1 payload `docs/concepts/20261115-2122-batch-galerie-akte-login-upload/payload-r1.json`
(decisions file: `docs/concepts/20261115-2122-batch-galerie-akte-login-upload-decisions.json`).
Binding visual spec: `docs/concepts/20261115-2122-batch-galerie-akte-login-upload/rounds/01.html` — the screens named
below, their mock markup, CSS and keyframes (classes prefixed `fb-`). Original batch notes (verbatim):
`.claude/batch-2026-11-15T20-19-12-386Z.md`. Round-1 brief with code findings: `briefs/01.md` (same folder).
Attachments of the batch notes: `briefs/2026-11-15T14-38-17-455Z-1.png` (#6 login), `briefs/2026-11-15T14-40-26-388Z-1.png`
(#7 search misses card), `briefs/2026-11-15T14-43-02-743Z-1.png` (#8 silhouettes card) — open them with Read before
changing the area they belong to.

Rules for every agent: project `CLAUDE.md` (scAction tiers + the new legacy-action guard from #1155, real anchors for
navigations, ngx-translate for every string in `public/i18n/{de,en}.json`, no native dialogs/select/title, translated
errors, `--sc-accent-collab` copper for admin+collaborator, `--sc-accent-hot` red for admin-only, no visible
"Nur Admin" text, one page frame, OnPush + signals). Every new user action = a catalogue event in
`src/app/core/analytics/events.ts` (convention `docs/analytics/event-naming.md`) + a PostHog report tile in
`posthog/dashboards.json`.

The general comment of the round ("devops learn …" about splitting the concept) is a process learning, NOT a build
item — no agent acts on it.

## User's words, verbatim (round 1)

### Annotation answers
- `r1-d1-segment-a1` (d1-segment) — Q: „Die vier Ansichten als Segment rechts im Seitenkopf, neben dem Starscape-App-Knopf, keine eigene Zeile mehr. Passt der Platz?" — A: „ok! Lass uns das so machen, ja!"
- `r1-d2-zwei-a1` (d2-zwei) — Q: „Umschalter Datenblatt ↔ Beschreibung im Panelkopf. Womit soll die Akte starten — und merkt sie sich deine letzte Wahl?" — A: „Sehr gut! Letzte wahl dann aber schiffsunabhbhängig merken !"
- `r1-d2-kauf-a2` (d2-kauf) — Q: „Der Wikelo-Tausch zeigt die benötigten Teile. Soll er auch zeigen, wie viele davon du schon im Bestand hast?" — A: „ja gern!"
- `r1-d4-spalten-a1` (d4-spalten) — Q: „Download und Einrichtung links fest. Sollen die drei Schritte einklappen, sobald du schon einmal hochgeladen hast?" — A: „ja!"

### Screen comments
- d2-zwei: „das machen wir gern so!"
- d4-zeit: „das hier finde ich noch besser."

### Pins (Ctrl+click notes)
- P1 d1-segment on button „Meine Votes": „Statt meine Votes, pack hier Sammlung rein!"
- P2 d1-segment on the strip „Sammlung · 6": „brauchen diese extra ziele nicht mehr, weil wir ja rechts oben sammlung anklickbar haben"
- P3 d1-segment on a gallery tile: „Bitte lass uns das laden der Bilder hier animieren! Mir schwebt vor, das erst ein partial overlay kommt mit New, dann mit Sammlung und dann tauchen ohne ankündigung versetzt die restlichen auf. Sozusagen drei phasen wobei die erste und zweite angekü+nddigt sind. Cinestisch über dem gesamten bilderbereich angekündigt und man sieht wie sich dann die kacheln ausfüllen / hervorheben usw... Arbeite an der idee und intention mit devops agentts !"
- P4 d2-zwei on button „Beschreibung": „oder was ist wenn wir hier oben noch ein drittes toggle einfügen, nämlich Kaufen. Dort findet man dann die kaufen infos, wikelo. So benötigen wir bei Datenblatt unten nur vergliechen und bei sri anssehen, dann gern in einerzerile"
- P5 d2-kauf-ok on the eyebrow „Akte": „Das akten panel sollte immer die gleiche größe haben vertikal und horziontla!"
- P6 d2-kauf-ok on a shop row: „top 3 anzeigen (ggf. von hq akuteller oder letzter psoition am nächsten sonst einfach gruppiert, nach sternensystem, planetensystem und ort. Gern dazu eine mini suche, die robust suchen kann auch bei rechtschreibfehlern usw. also state of the art."
- P7 d3-zwei on the planet: „Das finde ich schon gut, ist mir aber zu wengig episch. Muss natürlich auch mega insizniert werden animatorisch, gern mit devops agents das hier gut ausfeilen"
- P8 d3-zwei on the login panel: „prinzipiell, auch wenn etwas leer und doppelte infos wie footer hier auch drin... gefällt mir das weil es wie sc ist"
- P9 d3-zwei on „Jetzt bewerben": „check auch nochmal ob das alles hier am besten insziniert ist und ggf. logos von discord und google dort rein!"
- P10 d3-zwei on the disclaimer: „Das ist nicht der footer den wir auf unserer login seite hanben!"
- P11 d3-eins-vor: „In der vorschau brauchen wir hier nicht im konzept, ich weiß wie das vorschau banner aussieht xD"
- P12 d4-spalten on step 3 „Star-Citizen-Ordner wählen": „nur ungemarkt, wenn dieser noch nie etwas hochgeladen hat"
- P13 d4-spalten on „Bundle-Historie": „deaktivierte auch anzeigen oder nicht, gern rechts oben als icon"
- P14 d4-spalten on a history row: „natürlich mit allen funktionalitäten wie heute, wie deaktivieren pro patch (nicht pro hochgeladneen bundle). und auch löschen pro bundle bzw. leading auswählen was benutzt wird"
- P15 d4-admin on „Telemetrie": „Auf der Seite benutzer bitte nur benutzer!"
- P16 d4-admin on „Einladen": „Finde gut, die seite auch leicht rethinken und aufzuräumen, insbeosndere aktuelle anfragen aufzulisten und als einen plus und teilen dort eine Einladung auszusprechen - beides gern in einem panel. Darunter das benujtzer panel mit den personen gern mit suche und allem drum ujnd ran, swchau dir das heutige gut an!"

### Analysis decisions
- `r1-misses` „Karte ‚Häufig ohne Treffer'": no option ticked, note: „Bitte vollständig zu posthog migrieren - dort sollte man genau das sehen!"
- `r1-gladius` „1292 Fehlsuchen ‚gladius'": no option ticked, no note → recommendation stands (investigate inside B4).
- `r1-events` „Analytics-Events im Paket": yes (codex:buy_open, codex:wishlist_add with source shop|wikelo, verse:gallery_filter_select — names adapt to the catalogue convention).

## Checklist (one line per accepted item; source quote decides)

### B1 · Verse-Galerie & Header — owns `src/app/verse/shared/verse-header.component.ts`, `src/app/shared/lightbox/lightbox.component.ts`, `src/app/starscape/**`, `src/app/verse/pages/verse-gallery*.ts`, `src/app/shared/sammlung-strip*` (if touched)
- [ ] B1.1 Star-map glyph (`<sc-explorer-glyph />`, verse-header.component.ts ~:88) no longer in the page header of Galerie, News, Patches. Quote #1: „wir brauchen … in der Galerie rechts nicht den Verweis in diesem Content-Header auf meine Sternkarten oder dass wir das Sternbild dort anzeigen oder eine 1 … Genauso auch bei Patches und bei News nicht."
- [ ] B1.2 Lightbox fullscreen: the outermost right pixel column is clickable for "next" exactly like the left edge works for "prev". Root-cause it (scrollbar / 100vw / hit area) and prove with a test at the real edge. Quote #2: „ganz rechts an den Außenrand … dann kann man nicht klicken. Nur wenn man einen Pixel weiter links geht … Auf der linken Seite funktioniert das allerdings perfekt."
- [ ] B1.3 Filter = segment in the page header, right, next to the Starscape-app button; no own row with a dropdown. Spec: screen `d1-segment` / `d1-segment-top`. Quote r1-d1-segment-a1: „ok! Lass uns das so machen, ja!"; #3: „einen besseren Weg, als so einen Dropdown in eine Zeile zu schieben".
- [ ] B1.4 Segment entry „Meine Votes" is replaced by „Sammlung" (the reader's collected = up-voted wallpapers). Quote P1: „Statt meine Votes, pack hier Sammlung rein!" — two lines: Sammlung GAINS the segment slot and opens the collected set in the grid; „Meine Votes" LOSES its segment entry and label.
- [ ] B1.5 The separate Sammlung strip above the grid (`<sc-sammlung-strip>`, starscape.component.ts ~:165) is removed. Quote P2: „brauchen diese extra ziele nicht mehr, weil wir ja rechts oben sammlung anklickbar haben". (This also retires bug #3a — the strip items that did not open fullscreen; every Sammlung image now opens through the normal tile → overlay route.)
- [ ] B1.6 Switching the filter never reloads the page / never flickers; the grid changes animated (spec: crossfade/slide keyframes in `d1-segment-top`). Quote #3: „lädt die ganze Seite neu, also alles flackert ganz komisch. Das sollte natürlich hübsch animiert sein."
- [ ] B1.7 Cinematic staged load of the gallery: phase 1 an announced partial overlay „New/Neu" over the whole image area with the new tiles filling/highlighting, phase 2 announced „Sammlung" the same way, phase 3 the remaining tiles appear staggered WITHOUT announcement. Design the motion with the designer agent first (intent, timings, reduced-motion fallback = no animation), then build. Quote P3 (full text above).
- [ ] B1.8 Event: filter selection tracked (`verse:gallery_filter_select` or catalogue-conform name) + dashboard tile. Quote r1-events: yes.

### B2 · Holotisch-Akte (beta holo table only) — owns `src/app/codex/holo/codex-holo-akte.component.ts` and new files under `src/app/codex/holo/` (e.g. a buy tab component)
- [ ] B2.1 Panel head carries a toggle Datenblatt ↔ Beschreibung (spec `d2-zwei`) — plus a THIRD tab „Kaufen". Quotes: d2-zwei „das machen wir gern so!"; P4 „noch ein drittes toggle einfügen, nämlich Kaufen. Dort findet man dann die kaufen infos, wikelo."
- [ ] B2.2 The last chosen tab is remembered ship-independently (one global preference, not per ship). Quote r1-d2-zwei-a1: „Letzte wahl dann aber schiffsunabhbhängig merken !"
- [ ] B2.3 Datenblatt tab bottom: only „Vergleichen" and „Bei RSI ansehen", in ONE row. Quote P4: „So benötigen wir bei Datenblatt unten nur vergliechen und bei sri anssehen, dann gern in einerzerile". The previous cart-popover idea (`d2-kauf`) is superseded by the Kaufen tab — the popover's content (shops, price, Wikelo, wishlist) lives in the tab.
- [ ] B2.4 The panel always has the same size, vertically and horizontally, whatever tab is open. Quote P5: „Das akten panel sollte immer die gleiche größe haben vertikal und horziontla!" The panel is smaller than today so the ship image is less covered (batch note #4), and „Nur Bild" is integrated in the panel head, no longer over the description's scrollbar.
- [ ] B2.5 Kaufen tab: where + how much (UEX shops, `src/app/codex/uex-shop.service.ts`, reuse what `codex-detail-classic.component.ts` shows), AND Wikelo trade (sources `src/app/hq/plan/hq-need-sources.service.ts` / `codex-detail.component.ts`). Quote #5: „nicht nur preis und ort aber auch aufgezeigt werden wikelo! mit wunschliste option".
- [ ] B2.6 Top 3 shops shown: nearest to the HQ's current or last position if known; otherwise grouped by star system → planet system → location. Quote P6.
- [ ] B2.7 A mini search over the buy locations that is typo-tolerant (fuzzy, state of the art). Quote P6: „Gern dazu eine mini suche, die robust suchen kann auch bei rechtschreibfehlern usw. also state of the art."
- [ ] B2.8 Every shop row and the Wikelo row: „Auf die Wunschliste" directly, with the chosen source (where you buy) stored. Use the existing wishlist (`codex-holo-hangar-menu.component.ts` / `codex-own-card.component.ts`). Quote #5: „direkt auf die wunschliste setzen mit auswahl wo man es kauft".
- [ ] B2.9 Wikelo row shows how many of the needed items the user already holds. Quote r1-d2-kauf-a2: „ja gern!"
- [ ] B2.10 Events: buy tab open + wishlist add (source shop|wikelo) + dashboard tile. Quote r1-events: yes.

### B3 · Login — owns `src/app/auth/login.component.ts` (+ new login-scene files under `src/app/auth/`)
- [ ] B3.1 Direction = „Brücke" (spec `d3-zwei`): split with the Verse planet scene, SC-like. Quote P8: „gefällt mir das weil es wie sc ist".
- [ ] B3.2 Much more epic and heavily staged with animation (intro of the planet scene, panel reveal); design the motion with the designer agent first, reduced-motion fallback. Quote P7: „zu wengig episch. Muss natürlich auch mega insizniert werden animatorisch".
- [ ] B3.3 Google and Discord buttons carry their real logos (foreign-brand rule: unaltered logo, label/border on app tokens); re-check the whole staging of the sign-in panel incl. „Jetzt bewerben". Quote P9.
- [ ] B3.4 Footer = the footer the login page has TODAY (trust links Über · Datenschutz · Impressum, fan-badge, disclaimer, RSI link, trademarks — `login.component.ts` ~:232-246), not the mock's text. Quote P10: „Das ist nicht der footer den wir auf unserer login seite hanben!"
- [ ] B3.5 The inline „Vorschau beenden und anmelden" box is removed (the top banner is the exit); the submit button is primary again. Quote #6: „vorschau beenden inline benötige ich ja nicht weil ich ja oben das banner habe!"; P11.

### B4 · Admin & Data Upload — owns `src/app/admin/admin.component.ts`, `src/app/admin/search-misses.component.ts`, `src/app/admin/silhouette-coverage.component.ts`, `src/app/desktop/desktop-download.component.ts`, `src/app/p4k/**`, new migration(s), search-miss tracking in `src/app/codex/search/**` only for the event payload
- [ ] B4.1 Data-Upload page (`apps/uploader`) rebuilt after the „Zeitleiste" direction (spec `d4-zeit`): Bundle-Historie is the page's spine, inline — no submenu/popup any more. Quotes d4-zeit „das hier finde ich noch besser."; #8 „eliminiere das untermenü mit popup bundle historie sondern mach es inline dort rein".
- [ ] B4.2 Holotable-Silhouetten coverage moves from Admin → Benutzer onto the Data-Upload page. Quote #8.
- [ ] B4.3 Setup steps (download / install / choose folder) collapse once the user has uploaded before; „Star-Citizen-Ordner wählen" is only unmarked (open) when this user never uploaded anything. Quotes r1-d4-spalten-a1 „ja!"; P12.
- [ ] B4.4 Deactivated bundles/patches can be shown or hidden via an icon top right of the history. Quote P13.
- [ ] B4.5 ALL of today's history functions stay: deactivate per patch (not per uploaded bundle), delete per bundle, choose the leading bundle that is used. Quote P14. Read `src/app/p4k/p4k-history.component.ts` first and list every current function in the acceptance table.
- [ ] B4.6 Admin → Benutzer shows ONLY users: Silhouetten card and „Häufig ohne Treffer" card gone, and any other non-user content moved to its own admin place. Quote P15: „Auf der Seite benutzer bitte nur benutzer!"
- [ ] B4.7 Benutzer page tidied: one panel with current access requests listed + a „+" / share to issue an invitation; below it the people panel with search and everything today's page offers. Quote P16 — study today's page fully first, nothing that exists today may get lost.
- [ ] B4.8 „Häufig ohne Treffer" migrated COMPLETELY to PostHog: the zero-hit search event carries the search text so PostHog shows exactly which terms found nothing (new insight/tile in `posthog/dashboards.json`); the DB counting (`supabase/migrations/20261102121000_search_counters.sql`, RPC `admin_search_misses`) and the admin card are removed (migration with drop comment, alpha policy). Quote r1-misses note: „Bitte vollständig zu posthog migrieren - dort sollte man genau das sehen!" Note: until now `search:miss_show` deliberately never sent the text (`events.ts` ~:93) — update that description and `docs/analytics` accordingly; PostHog web runs with consent only.
- [ ] B4.9 Investigate „gladius" 1292× without hits on 15.11.: real search failure or a counting loop? Fix the cause if it is a bug. Recommendation `r1-gladius` (no override).
- [ ] B4.10 Data Uploader page keeps copper `--sc-accent-collab`, admin-only parts red edge, no visible „Nur Admin" text.

## Acceptance table (every agent returns)
| line | done / partial / not done | evidence (file:line, test, screenshot) |
A line without evidence counts as not done.
