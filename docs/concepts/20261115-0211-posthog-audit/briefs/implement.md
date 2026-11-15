# Implement brief — PostHog-Audit (concept 20261115-0211-posthog-audit)

Decisions (typed, per round): [`../../20261115-0211-posthog-audit-decisions.json`](../../20261115-0211-posthog-audit-decisions.json)
Binding spec for the admin page: [`../rounds/02.html`](../rounds/02.html), design `karten` (★ favourite), screens `r2-d1-s1` „Mit Handlungsbedarf“ and `r2-d1-s2` „Alles ruhig“.
Round 1 findings with the evidence behind every item: [`../rounds/01.html`](../rounds/01.html).

## The user's words, verbatim

### Round 1

- **general:** „btw, füge auch in das projektspezifische wissen / extendsiions von claude ein, dass es diese posthog daten gibt und ggf. bei analysen oder umsetzungen miteinbezogen werden könneen! also nicht nur für mich als memory, sondern richtig im git tracked claude infos...“
- **d-proxy (Werbeblocker):** „ja genau, außerdem in telemetrie könnten wir keine doppelführung von errors machen bzw. ggf. nur noch top 3 oder so und posthog link! Weil ja alles zu posthog gerouted werden sollte, auch die infos der telemetrie der desktop app“
- **d-identify (Wiederkehr messen):** „ayber bitte im admin panel unter telemetrie sichtbar machen wenn >80% von irgendeinen freikontingent von posthog augebrraucht ist mit call to action! => Entweder ki generierter feedback vorschlag, also man kann die warnung in ein feedback umwandeln oder cta zu posthog selber dort bezahlte fversion aufzusteigen! Beides wäre ja eine lösung (optimieren der applikation wie viel gesendet wird vs mehr kontingent kaufen)“
- **d-events (Fehlende Events):** „Keine dopplujngen anostnen aber wirklich breit aufstsellen. Dabei eine eigene auch abgespeicherte im projekt namenskonvention einfügen und in posthog auch bitte als folgeactions mit cdp edge chrome plugin zugriff workflows definieren, welche dann diese realen workflows abbilden etc.
Also in posthog bitte reports anlegen die nützlifch sind, dabei bitte 30% einfache reports und 70% die übergreifende flows ziegen usw.! Gerade auch die wo man events gut kennen sollte. Bitte auch entsprechende dashboards (maximal 3) in posthog. Am ende sollte alles was erfasst wird auch über diese drei dashboards zugänglich sein direkt oder indirekt, damit der admin sich in posthog zurec ht findet!“
- **d-srv (Was der Server meldet):** „wir nehmen sonstige telemitrie raus, wir machen alles nur noch über posthog und ggf. spiegeln von posthog die infos wieder zurück ins admin panel. Single source of trouth!“
- **d-place (Wo es steht):** „Räume wegen dieser intensiven änderunge btte nochmal das amdin telemetrie panel auf und rethink es! Analysiere mit devops agents recherchiert best practices für geleegenheitsadmins und rethink komplett den inhalt der seite und die visualisierung! basierend auf dem neuen vverfahren posthog first! Die seite soll aufmerksam machen, top 3 infos jeweils anzeigen um zu teasern was das tehema dort gerade jeweils ist aber nicht zum reinfujchsen in einzelne fflows oder events etc. sein, da kommt posthog ins spiel“

### Round 2

- **favourite:** design `karten` (Themen-Karten).
- **r2-quota-scope (Welche Kontingente):** „könnten wir in dem zug nicht feature flags auch nutzen? z. B. für die admin / collaborateur funktionen? Das sind doch feature flags weil wir ja elemente anzeigen zbw. nicht anzeigen und das je rolle?! oder ist das security technisch doof!?“
- **r2-ascode (Wie der Aufbau entsteht) — „Keine passt“, the note is the answer:** „Mir geht es darum, dass wenn wir hier alles machen, haben wir ja in posthog viele daten, aber posthog beietet jha auch tolle visualisierungen und dashbaords etc. diese sollst du dort in posthog konfigurieren, dass wenn ein admin nicht zu einenm thema / warning abspringt sondern eeinfach mal für einen überblick dort hin geht, stöbern kann! Wenn du es per api machne kannst super oder posthog mcp ansonsten diese dashboards und berichte und flows und co. in posthog per browser automatisiert durch diech erstellen / konfigurieren, überprüfen und etesten !“
- No annotation answers, no pins.

## Checklist — one line per accepted item

Later rounds override earlier ones. `[web]` Angular app · `[fn]` Edge Functions · `[db]` migrations · `[ci]` build/CI · `[ph]` PostHog project configuration · `[doc]` repo docs/Claude knowledge.

### A · Integration fixes (round 1, topic 1)
- [ ] A1 `[web]` d-flags=yes: when PostHog's remote config reports no feature flags, flags settle immediately (no 2.5 s wait); a later flag still works as a kill switch.
- [ ] A2 `[ci][web]` d-maps=yes: production source maps uploaded to PostHog at build time, never shipped in the bundle; every event carries the app version / release.
- [ ] A3 `[web]` d-proxy=yes: browser events go through `/ingest` on the app domain (existing Vercel rewrite), `ui_host` = EU PostHog; CSP no longer needs the PostHog hosts for capture.
- [ ] A4 `[web]` d-vitals=ph: own `web_vitals` event and its service removed; PostHog's own web-vitals capture stays on.

### B · More with consent (round 1, topic 2)
- [ ] B1 `[web]` d-identify=role: signed-in users with statistics consent are identified by a salted hash of the account id, with `role` (viewer/collaborator/admin) as person property; no name, no e-mail. Privacy text updated.
- [ ] B2 `[web][ph]` d-replay=onerror: session replay only for sessions with an `$exception`, all inputs masked.
- [ ] B3 `[web]` d-clicks=dead+heat: dead clicks and heatmaps on; no blanket autocapture.
- [ ] B4 `[web]` d-events = errshown, codex, feedback, login, search — superseded in breadth by E3 (all areas); `errshown` = an error state shown, with its `errors.*` key.

### C · Server signals (round 1, topic 3)
- [ ] C1 `[fn]` d-srv: every Edge Function reports failures as `$exception` (server, no person profile); every cron run reports its outcome; every Claude call reports (C2); desktop app crashes go to PostHog (see D1).
- [ ] C2 `[fn]` d-llm=meta: every Claude call sends `$ai_generation` with model, tokens, cost, latency, error — never prompt or output text.
- [ ] C3 `[web]` d-legal=ok: privacy page gets a paragraph: the server reports its own errors and run times to PostHog, without IP, user id or content.

### D · One source: PostHog (round 2 topic A; round 1 notes on d-proxy/d-srv)
- [ ] D1 `[fn]` r2-desktop=fwd: `ingest-telemetry` keeps its HMAC check and forwards to PostHog instead of the own table; apps unchanged.
- [ ] D2 `[fn]` r2-logs=r2: diagnostic logs go to R2 for 30 days, the PostHog event carries the link (+ size); the „Log als Feedback“ path keeps working with the R2 file.
- [ ] D3 `[db][web]` r2-old=now: switch over and drop `telemetry_events` + `get_telemetry_stats` at once (alpha data policy, documented in the migration comment); the old admin telemetry sections go.
- [ ] D4 `[web]` r2-convert=yes: every top-3 item of the admin page has „In Feedback umwandeln“, prefilled with the finding and its PostHog link.
- [ ] D5 `[web]` round-1 note d-proxy: no duplicated error lists in the admin — top 3 + PostHog link only.

### E · Quota (round 2 topic B; round 1 note on d-identify)
- [ ] E1 `[fn][web]` r2-quota-scope = events, exceptions, replay, llm, flags: the admin page shows usage vs. free limit for all five (PostHog billing API, `billing:read`).
- [ ] E2 `[web]` note d-identify: above 80 % of any free quota → warning with two CTAs: „Sparvorschlag als Feedback“ (feedback item, routine writes the optimisation proposal) and „Plan in PostHog ↗“ (upgrade).
- [ ] E3 `[web]` r2-forecast=yes: a linear forecast above 100 % is already yellow.
- [ ] E4 `[fn][web]` r2-throttle=lowfirst: at a forecast ≥ 95 % a flag `telemetry-saver` pauses replay and heatmaps; errors and core events never.
- [ ] E5 answer the user's question on r2-quota-scope (feature flags for admin/collaborator UI) in the final report — see „Decisions taken here“.

### F · Event catalogue (round 2 topic C; round 1 note on d-events)
- [ ] F1 `[web][doc]` r2-naming=ph: `category:object_action`, present tense, snake_case; the 30 existing events are renamed, old names bridged by PostHog actions.
- [ ] F2 `[web][ci]` r2-catalog=typed: typed catalogue in code (`events.ts`), `track()` accepts only catalogue names, a prebuild guard refuses raw `capture('…')` outside the service; descriptions synced to PostHog event definitions.
- [ ] F3 `[web]` r2-areas = codex, hq, verse, news, social, search, settings, auth, feedback, desktop, admin — instrumented broadly, no duplicates.
- [ ] F4 `[doc]` the naming convention is stored in the repo (user: „eine eigene auch abgespeicherte im projekt namenskonvention“).

### G · PostHog setup (round 2 topic D; round 1 note on d-events; r2-ascode note)
- [ ] G1 `[ph]` r2-ascode = the note: dashboards, reports and flows configured IN PostHog so an admin can browse there; via API/MCP if possible, otherwise browser automation; then verified and tested.
- [ ] G2 `[ph]` r2-dash=question: exactly three dashboards — „Läuft es?“, „Wird es genutzt?“, „Was kostet es?“; everything captured is reachable from them directly or indirectly.
- [ ] G3 `[ph]` 30 % simple reports, 70 % cross-flow reports (funnels, paths, retention…), favouring ones where the events are worth knowing.
- [ ] G4 `[ph]` r2-flows order: onboard, codex, error, hangar, feedback, desktop, verse.
- [ ] G5 `[ph]` actions modelling the real workflows (note d-events) + actions bridging old event names (F1).

### H · Signal → task (round 1 topic 4)
- [ ] H1 `[fn][ph]` d-trigger=both: PostHog error-tracking alert (issue created/reopened) → webhook Edge Function `posthog-signal`; daily cron for trends (LCP p75, login funnel, top errors).
- [ ] H2 `[doc]` d-ai=routine: the feedback routine diagnoses with PostHog via MCP (no API tokens).
- [ ] H3 `[db][fn][doc]` d-mode=diagnose: items from PostHog carry an origin; the routine only diagnoses, posts problem + PostHog link + proposal, sets `needs_input`; builds only after an admin answer.
- [ ] H4 `[db]` d-author=system: own sender „PostHog-Wächter“ visible to all admins, recognisable as machine.
- [ ] H5 `[fn]` d-cap=3: at most 3 new items per day; the same PostHog issue = one item (repeats as thread reply); overflow goes into one summary item.
- [ ] H6 `[fn]` d-secret=yes: secrets `POSTHOG_PERSONAL_API_KEY` (read scopes) and `POSTHOG_SIGNAL_SECRET`; the function writes to the board with the service role, no user API token.

### I · External services (round 1 topic 5; round 2 design)
- [ ] I1 `[web]` d-place → round 2 favourite `karten`: the admin telemetry page is rebuilt as the Themen-Karten design (status line with „seit deinem letzten Besuch“, six cards sorted by urgency: Kontingent, Fehler, Externe Dienste, Nutzung, KI-Kosten, Desktop-Apps; each KPI + delta/forecast + top 3 + CTA; calm state per card; screen „Alles ruhig“).
- [ ] I2 `[fn][web]` d-svc = claude, posthog, supa, r2, uex, rsi, xai, readme.
- [ ] I3 `[db][fn]` d-usage=ledger: own per-call table for Claude (function, model, tokens, cost, ok/error).
- [ ] I4 `[fn]` d-health=both: status from real calls + hourly free probes.
- [ ] I5 `[fn][web]` d-thresh=ok: green < 10 % errors and in rhythm; yellow 10–50 % or rhythm 2× exceeded; red last 3 attempts failed or key missing.
- [ ] I6 `[fn]` d-escalate=yes: a service on red creates a board item (same cap and approval as H), recovery closes it.

### J · Claude project knowledge (round 1 general note; round 2 r2-knowledge)
- [ ] J1 `[doc]` `.claude/deep-knowledge/posthog.md`: catalogue + schema, the three dashboards, queries via MCP/HogQL, quotas, what is never sent.
- [ ] J2 `[doc]` CLAUDE.md: Deep-Knowledge line + Key Rule („new user action = catalogue event; analysis = ask PostHog first“).
- [ ] J3 `[doc]` feedback routine: PostHog MCP access + prompt (repo copy) for origin-posthog items.
- [ ] J4 `[doc]` project skill extensions (concept, ship) ask which events / which report.

## Decisions taken here (not asked)

- **Feature flags for admin/collaborator UI (user question on r2-quota-scope): no.** PostHog flags are evaluated in the browser and load only with statistics consent; anyone can flip them in DevTools, and an admin without consent would lose the admin UI. Roles stay enforced by RLS and route guards; flags are for rollout and kill switches only.
- **A PostHog personal API key cannot be created by Claude** (access keys are the owner's to create). Everything that needs it is built to read it from secrets; activation is a 👉 step for the owner.
