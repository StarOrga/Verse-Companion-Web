# Implement brief — Etappe A (Versionsanzeige)

Decisions: `../../20261121-1500-uploader-version-update-decisions.json` · Round fragment (binding spec): `../rounds/01.html`, design `d3` ("Vergleich im Popover").

## User input, verbatim (round 1)

- Favourite: **d3** (Vergleich im Popover)
- Annotation d3-s1-a1 — Q: "Die Kopfzeile nennt nur den Kanal. Grün heißt: Server und Spiel haben denselben Stand, gelb heißt: der Server hinkt hinterher. Reicht dir die Ampel ohne Nummer?" — A: **"Perfekt"**
- Annotation d3-s1-a3 — Q: "Soll die Mail-Adresse in der Kopfzeile bleiben, oder reicht sie im Popover?" — A: **"reicht im popover"**
- Pin on d3-s1, `div.mock-status.mock-d3-status "Noch offen: 3D-Hüllen. Setze automatisch"`: **"Das hier unten weiß nicht, gern das auch oben in das popout rein, ist ja wie ein hinweis warum das gelb ist dann im popout"**
- No answers on d3-s2-a1 (comparison table) and d3-s3-a1 (error as dot + popover) → accepted as designed.

## Checklist (Bündel B1, from the batch hand-off; owner: inline)

1. Header chip shows only status dot + channel tag as a traffic light, no patch number — quote: "Perfekt" (d3-s1-a1). Green = server has the local build; yellow = server differs or parts are still open.
2. Email leaves the header chip, stays in the popover — quote: "reicht im popover" (d3-s1-a3). Two lines (moved role): chip loses the email; popover keeps it.
3. Popover compares local and server identity as rows "Dein Spiel" / "Server-Codex" with "✓ gleich" / "⚠ anderer Stand", entry count labelled ("454.632 Einträge") with freshness — d3-s2 mock.
4. Open parts appear in the popover as the reason for yellow — quote: "gern das auch oben in das popout rein, ist ja wie ein hinweis warum das gelb ist dann im popout".
5. Status line keeps "Noch offen: …" but no longer repeats channel/patch (d3-s1 mock `.mock-d3-status`); the countdown banner likewise drops `{{patch}}` in its parts text.
6. One identity format everywhere it is shown: `4.10.3 · Build 13165946` (d3-s2 table).
7. Update error: no raw HttpError text in the window; a translated sentence + "v… laden"/download + "Protokoll" in the popover, a yellow dot as attention mark — d3-s3 mock. Main process sends only an error code (`unknown-build | offline | server | other`), full message only in main.log.
