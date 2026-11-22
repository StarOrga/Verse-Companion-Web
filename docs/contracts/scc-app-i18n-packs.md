# VC-App language packs on VC-Web

The desktop app's i18n pack service (`modules/desktop/src/i18n-pack-service.js` in
StarOrga/Verse-Companion-App) downloads corrected UI language packs from the website, so a
translation fix reaches players without a desktop release.

## URLs

- `GET <sccWebBase>/i18n/scc-app/<code>.json` — one pack per language (`de`, `en`, `es`, `fr`,
  `hi`, `it`, `ja`, `ko`, `pl`, `pt-BR`, `ru`, `zh-CN` today).
- `GET <sccWebBase>/i18n/scc-app/index.json` — `{ schema: "scc-app-i18n-index/1", sourceRevision,
  locales: { <code>: { packVersion, keys } } }`.
- A language without a pack answers **404**, never the SPA shell: `vercel.json` keeps
  `/i18n/scc-app/` out of the catch-all rewrite.
- Served with `Cache-Control: public, max-age=300`, so a fix is live within minutes. The packs are
  not in the PWA precache (`ngsw-config.json` matches `/i18n/*.json`, not the sub-folder).

## Pack shape

`{ schema: "scc-app-i18n/1", locale, packVersion, sourceRevision, strings: { key: text } }` — written
by the app's `scripts/i18n/packs.js export-web`; the app validates every string again on load.

## Refreshing the packs

The app repo owns the content. To publish its current packs, from this repo:

```bash
node scripts/sync-scc-app-i18n.mjs --app <path to the Verse-Companion-App checkout>
```

The script runs `export-web`, refuses anything that is not a valid pack (wrong schema, a locale
that does not match its file name, a stale `index.json`, a foreign file) and replaces
`public/i18n/scc-app/`, dropping languages that are no longer exported. Commit the result and ship;
there is no cross-repo automation.
