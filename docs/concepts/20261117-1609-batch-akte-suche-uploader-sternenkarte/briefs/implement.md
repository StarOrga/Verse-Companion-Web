# Implement brief — Feedback-Paket 17.11. (Akte, Suche, Uploader, Sternenkarte)

Generated from the baked round 1, not summarised. Sources:

- Decisions: [../../20261117-1609-batch-akte-suche-uploader-sternenkarte-decisions.json](../../20261117-1609-batch-akte-suche-uploader-sternenkarte-decisions.json), raw payload [../payload-r1.json](../payload-r1.json)
- Plan, bundles, file ownership and feasibility findings (Befunde): [handoff.md](handoff.md) — binding, read your bundle's block completely
- The nine notes verbatim: [notes-verbatim.md](notes-verbatim.md); screenshots: [../shots/](../shots/) — open every screenshot of your bundle with Read before any change

On a conflict between a checklist line and its quote, the quote wins.

## The user's words, verbatim

Notes (do-batch, 16.–17.11.):

1. "fix die aktuelle sternenkarte!? da sind nur platzhalter!? außerdem kein shape erraten..."
2. "das sollte eher ein minimieren button sehr de3zent sein statt ein bild icon!" (shots/2026-11-17T11-25-02-000Z-1.png)
3. "letzteres ist in akte auf der schiffsseite" (refers to note 2: where the button is)
4. "in der suche braucht nicht in der vorauswahl oder nach dem eintippen eins angezeigt werden wo man genau gerade auf der detailsseite drauf ist, z. B. bin ich auf der gladius detailseite, dann brauche ich keine gladius suchantworten. Außer wenn es ein nahezu exact match ist und dann gern irgendwie ausggegraut / markiert, ich bin dort eh gerade schon drauf... Aber durchdenke das ncohmal mit deovps agetns!?"
5. "überprüfe wirklich nochmal data uploader, bei jedem start wird gerade 4.10.0 erkannt, obwohl das gar nicht die aktuelle verseion ist und dann noch trtoz data uploader version gleichheit bzw. gleichehit der extraktionsmechanimsmen und auch patch gleichheit immer wieder eine neue version erkannt, obwohl ich sie ja schon einmal hochgeladen habe in dem setup. Das muss extrem robust sein sonst geht so viel computing power unnötig verloren, aber auch sensitiv bzgl. änderungen an mechanismus oder patch oder fehlenden einahlten. Hier nochmal deep ran gheen !" (shots/2026-11-17T12-42-58-157Z-1.png)
6. "außerdem ggü. builds weil das ja auch was tut, also es geht um x.y.z-build - ändert sich eins von den 4 values ist das eine Änderung die checkwürdig ist, auch wenn sich ggf. nur wenig geänder that und man überspringen kann"
7. "das kannst dua us beta holotisch rausnehmen, weil wir das ja jetzt in akte drin haben 😉" (shots/2026-11-17T12-47-43-419Z-1.png)
8. "Nimm perspektiven column dort raus und ordne die anderen 4 bitte gut an aligned mit dem aus der unteren leiste." (shots/2026-11-17T12-48-39-988Z-1.png)
9. "Warum ist der footer nicht auf der linie und die seite extra noch ein wenig scorllable obwohl ich schon auf der zweiten seite gescorllt habe von zwei seiten, das macht keinen Sinn!" (shots/2026-11-17T14-39-25-706Z-1.webp)

Round 1 answers (concept page, 17.11.):

- d-min "Wie sieht der dezente Minimieren-Knopf der Akte aus?" → **"Als zwei Pfeile nach innen zeigen"** (deviates from the recommendation "Pfeilspitze")
- d-all "Wohin kommen Bewertungs-Satz und „Alle Werte aller vier“?" → none of the options; note: "schjalter benötigen wir ja noch füpr das energiepanel? den bewertungsssatz kannst du dort streichen, das haben wi rschon oben in einorndung!"
- d-rule "Stimmt die Regel: schwacher Treffer fehlt, exakter Name steht grau da?" → preselected "Stimmt, so bauen", **untouched** (not looked at); the rule is the user's own note 4, build it as shown
- d-variant "Gilt der Katalog-Treffer auf deiner eigenen Variante als „Du bist hier“?" → none of the options; note: "bitte in der suche anpassen, dass das nicht jeweils ein eintrag ist sondern ein eintrag mit mini textlinks zu varianten fallls man nicht auf den eintrag klickt, der zur default variante füphrt"
- d-actions "Behält die graue Zeile „merken“ und „vergleichen“?" → **"Nein, die Zeile zeigt nur Name und Hinweis"**
- d-ident "Welche Angabe ist das x.y.z, das der Uploader vergleicht?" → **"Das Versionsfeld der Installation nehmen"**; note: "Aber das von der installation sollte ja auch 4.10.3- buildnr sein!? Aber ja immer das lokale nehmen, ist ja der uploader, ggf. dann online matchen auf dem server, ehrlich gesagt, sollte es aber keine andere versionsnummer geben!"
- d-resume "Was macht ein Start, wenn nur noch die 3D-Modelle fehlen?" → **"Nur die 3D-Modelle fortsetzen"** (no re-read, no second metadata upload; the autostart continues silently, a window the user opened shows the countdown first)
- d-star "Stimmt der Weg: Die Karte 4.10 zeigt künftig die Avenger Stalker zum Raten?" → **"Stimmt, auf die Serien-Stalker umhängen"**; note (hesitation flagged — special attention, no silent default): "Das soll ein automatismus sein bei jedem neuen Patch, kreigire einen algorythmus dafür - wir wissen ja was neue raumschiffe sind und wednn in dem patch es keine neuen gibt, dann gern welche neuste aus dem letzten wo es welche gab! Aber ich will das hier nicht fü+r jeden aptcvh manuell korigiieren, bitte das automatisieren, u8nd wenn das so nicht geht bitte die claude code api anbindung hinzuziehen um das richtige schiff zu finden - obwohl ich glaueb das isxt nicht nötig"

## Checklist

Every implementing agent returns one row per line it owns: item → done / partial / not done → evidence (file:line, test, screenshot). A line without evidence counts as not done.

### B1 Schiffsseite / Holotisch (frontend)

- [ ] **C1** The Akte's "nur Bild / Text zeigen" toggle (`codex-holo-akte.component.ts:89-94`, `.ak-tg`) shows two arrows pointing inward instead of the picture icon, very subtle: no cyan glow frame, quieter than the tabs beside it; collapsed state shows the counterpart (arrows outward). Function, aria-label and `[scTooltip]` stay. — Quote: "das sollte eher ein minimieren button sehr de3zent sein statt ein bild icon!" · "letzteres ist in akte auf der schiffsseite" · answer "Als zwei Pfeile nach innen zeigen"
- [ ] **C2** The "Wo zu kaufen" side card is gone from the Holotisch (`codex-detail.component.ts:957-979`, slot `below-side`); the Akte's buy tab stays the only place; the source-link jump (`shipSourceFragment`, `sourceLinkRequested()`) lands on the Akte buy tab; dead CSS and specs follow. — Quote: "das kannst dua us beta holotisch rausnehmen, weil wir das ja jetzt in akte drin haben"
- [ ] **C3** The "Perspektiven" lead column is gone from the row layout; Offensive · Verteidigung · Bewegung · Signatur & Kühlung sit edge on edge above the four groups of the lower strip (measured: left edges of tile n and strip group n equal within 1px at 1280 and 1920 width); breakpoints follow. — Quote: "Nimm perspektiven column dort raus und ordne die anderen 4 bitte gut an aligned mit dem aus der unteren leiste."
- [ ] **C4** The sentence "Bewertet als …, verglichen mit N Schiffen" is removed from the perspectives row (it already stands above in "Einordnung"; verify that with file:line). — Quote: "den bewertungsssatz kannst du dort streichen, das haben wi rschon oben in einorndung!"
- [ ] **C5** The switch "Alle Werte aller vier" keeps working after the column is gone and gets a quiet place that does not shift the four columns (right-aligned above the tiles or at the strip's handle; pick the calmer one and show it). The energy panel keeps its own handle (`codex-holo-strip.component.ts:281`, "Energie und Perspektiven zeigen"); report in one sentence what each of the two controls opens, because the user asked. — Quote: "schjalter benötigen wir ja noch füpr das energiepanel?"

### B2 Suche (frontend)

- [ ] **C6** Empty field: "Zuletzt geöffnet", "Neu in diesem Patch" and category shortcuts never show the page the user is on; the list backfills to its usual length. — Quote: note 4 "in der vorauswahl … nicht … angezeigt werden wo man genau gerade auf der detailsseite drauf ist"
- [ ] **C7** Typed, weak match (score < 4): the current page is hidden; variants and other ships stay ("gla", "aegis", "gladius valiant" on Gladius). — Quote: note 4 "bin ich auf der gladius detailseite, dann brauche ich keine gladius suchantworten"
- [ ] **C8** Typed, near-exact (polyMatchScore 4: name, name without maker or class name equals the term): the row stays at its rank, greyed, labelled "Du bist hier" / "You are here" (i18n), `aria-current="page"`, without call-to-action, item-path icons, fit badge and without the quick actions "merken" / "vergleichen". — Quotes: note 4 "Außer wenn es ein nahezu exact match ist und dann gern irgendwie ausggegraut / markiert" · answer "Nein, die Zeile zeigt nur Name und Hinweis"
- [ ] **C9** Never an empty panel: if the current page would be the only row, it shows greyed.
- [ ] **C10** Enter or a plain left click (`isPlainLeftClick`) on the greyed row only closes the search: URL, query and fragment unchanged, no recent entry, no `recordOpen`, no `noteSearchArrival`; modified clicks still open a tab.
- [ ] **C11** One entry per ship instead of one entry per variant: a ship's variants no longer appear as separate result rows; the ship's row leads to the default variant and carries mini text links to its variants. Clarify in code which "variants" produce separate rows today (the user's own configurations "Meine …" with `?v=` for certain; check game editions and liveries too) and fold every kind that is the same ship page; a hull with its own page (Gladius Valiant) stays its own row — state in the acceptance row what was folded and what not, with file:line. On the current page the mini link of the open variant is marked, the others are real anchors. — Quote: "bitte in der suche anpassen, dass das nicht jeweils ein eintrag ist sondern ein eintrag mit mini textlinks zu varianten fallls man nicht auf den eintrag klickt, der zur default variante füphrt"
- [ ] **C12** The same behaviour in the fusion bar, the legacy Codex bar and the Ctrl+K overlay, phone and desktop, with specs (matrix Gladius · Valiant · Pirate · own variant; empty field; Enter).
- [ ] **C13** Analytics: `search:result_open` carries `current: boolean` (and the variant mini link is counted, either as its own catalogue event or a property — follow `docs/analytics/event-naming.md`); a PostHog tile next to "Suchen ohne Treffer (30 Tage)" in `posthog/dashboards.json` shows how often the greyed row and the variant links are chosen.

### B3 Data Uploader (core)

- [ ] **C14** The game version is read from the local installation and is the one truth; never from the branch name. Find out where "4.10.3" comes from for build 13165946 (manifest says Branch `sc-alpha-4.10.0`, Version `4.10.200.58746`; the server row says 4.10.3 — check the launcher log, Game.log, the p4k and how `--patch` / `manifest.patch_version` are filled) and make the local reading yield exactly that x.y.z plus the build. Afterwards the uploader head, the log, the ledger key and `codex_builds.patch_version` carry the same number; the server matches the local value, it never invents another. If the installation truly carries no "4.10.3" anywhere, say so with evidence and name the closest deterministic source — do not guess a mapping. — Quote: "Aber das von der installation sollte ja auch 4.10.3- buildnr sein!? Aber ja immer das lokale nehmen, ist ja der uploader, ggf. dann online matchen auf dem server, ehrlich gesagt, sollte es aber keine andere versionsnummer geben!" · note 5 "bei jedem start wird gerade 4.10.0 erkannt, obwohl das gar nicht die aktuelle verseion ist"
- [ ] **C15** Identity = x.y.z + build; a change in any of the four values makes a start check, and the check skips what is unchanged. — Quote: note 6 "es geht um x.y.z-build - ändert sich eins von den 4 values ist das eine Änderung die checkwürdig ist, auch wenn sich ggf. nur wenig geänder that und man überspringen kann"
- [ ] **C16** Same uploader mechanism (subtheme revisions) + same patch + same build + contents present on the server → a start does nothing and says so; a changed mechanism, patch, build or missing content triggers exactly the affected parts. Tests cover each of the four triggers and the "nothing to do" case, with the real manifest and the real log scenarios (15.–17.11.) as fixtures. — Quote: note 5 "trtoz data uploader version gleichheit bzw. gleichehit der extraktionsmechanimsmen und auch patch gleichheit immer wieder eine neue version erkannt, obwohl ich sie ja schon einmal hochgeladen habe … extrem robust … aber auch sensitiv bzgl. änderungen an mechanismus oder patch oder fehlenden einahlten"
- [ ] **C17** Only the 3D models open → the run continues only the 3D models: no p4k re-read for the catalogue, no bundle or metadata upload, no new `codex_builds` staging row; an interrupted 3D build resumes instead of restarting; the unattended start continues silently, a window the user opened shows the countdown first. — Answer "Nur die 3D-Modelle fortsetzen"
- [ ] **C18** The status line tells the truth: no "Neue Version erkannt (LIVE: 4.10.0 vs. 4.10.0)" when nothing is new; a pending-parts start names the parts (de + en).
- [ ] **C19** Existing uploads are not redone by the key change: the ledger rows of build 13165946 (stored under patch "4.10.0") count for the corrected identity (migration or alias, dry-run in begin/rollback first); the stray non-current staging row of 17.11. is handled, not left to confuse the next start.

### B4 Sternenkarte (core + small frontend)

- [ ] **C20** The 4.10 star map offers seven ships to guess again (`select public.verse_guess_candidates('4.10')` returns 7 options; browser check on /verse/explorer signed in); guesses already made stay valid. — Quote: note 1 "fix die aktuelle sternenkarte!? da sind nur platzhalter!? außerdem kein shape erraten..." · answer "Stimmt, auf die Serien-Stalker umhängen"
- [ ] **C21** The ship of a patch's star map is chosen automatically, with no manual correction per patch: from the ships new in that patch; when the patch has none, the newest ship from the last patch that had some; never a variant, display, mission or template copy; and when a chosen class later stops being eligible (as happened: `AEGS_Avenger_Stalker_Display` became `is_variant`), the answer resolves to its base hull or re-picks by the same rule on its own. Deterministic first; the Claude API (via the existing edge-function path, no key in the client) only if a deterministic rule provably cannot decide, and then say why. Spec'd with tests for: patch with new ships, patch without, chosen class turns variant. — Quote: "Das soll ein automatismus sein bei jedem neuen Patch, kreigire einen algorythmus dafür - wir wissen ja was neue raumschiffe sind und wednn in dem patch es keine neuen gibt, dann gern welche neuste aus dem letzten wo es welche gab! Aber ich will das hier nicht fü+r jeden aptcvh manuell korigiieren, bitte das automatisieren, u8nd wenn das so nicht geht bitte die claude code api anbindung hinzuziehen um das richtige schiff zu finden - obwohl ich glaueb das isxt nicht nötig"
- [ ] **C22** The guess track never shows seven empty ghost tokens without a word: an unavailable guess renders an explained state.

### B5 /verse hub (frontend)

- [ ] **C23** After gliding to page 2 of /verse the footer row (badge left, VERSE · CODEX · HQ centre, links right) sits on the line of the two launchers, at 1920×1080, 1280×800 and the screenshot's window height (≈ 950 px).
- [ ] **C24** No rest scroll: on page 2 `scrollTop + innerHeight === scrollHeight`, measured in a real browser before and after.
- [ ] **C25** The cause is measured first and named in one sentence for the final report (the note is a question). — Quote: "Warum ist der footer nicht auf der linie und die seite extra noch ein wenig scorllable obwohl ich schon auf der zweiten seite gescorllt habe von zwei seiten, das macht keinen Sinn!"

## Rules for every agent

- Work in the worktree `P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\batch-82d91f` on branch `claude/batch-82d91f`; touch only the files your bundle owns (handoff.md § Bündel); commit your bundle, do not push, do not ship.
- Project rules in `CLAUDE.md` apply (i18n for every string, `scAction`, real anchors, `[scTooltip]`, no native UI, `--sc-*` tokens, errors translated). `npm run typecheck` does not see templates — `npm run build` is the gate for template changes. Run test runners as their own command, never chained.
- B3: nested npm project (`data-uploader`), `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` for pytest; the subtheme guard needs a revision bump or a `Subtheme-Unchanged: <key>` trailer when a subtheme's `sources` change.
- B4: migrations get a fresh, unused timestamp prefix; dry-run in `begin … rollback` against the cloud project before anything is applied; nothing is applied to production by an agent — the migration file is the deliverable, applying happens at ship.
- An independent `devops:qax` that built nothing checks every line against its quote, the diff and screenshots of the real result before the final report.
