# Storage & caching — where each kind of data lives

Decided 2026-09-24 (storage plan, published as a claude.ai artifact). All tiers
below are free; the rule for adding a provider is **"it throttles or blocks at
its limit instead of billing"**, or, where no such tier exists (R2), the cap is
built in by design.

| Data | Home | Why |
|---|---|---|
| Relational: users, social, hangar, feedback, telemetry, codex catalog | Supabase Postgres (Free, 500 MB) | RLS, RPCs, Realtime. Blocks (402) at its limit, never bills |
| RLS-gated files (feedback attachments — private since `20260928211217`, shown via signed URLs, 1 h), codex previews | Supabase Storage (Free, 1 GB) | RLS per owner cannot be rebuilt elsewhere |
| Codex localization strings (`codex-locale/`, since 2026-10-03) | R2, same bucket and Worker | ~31 MB per build, immutable per build; see § Localization strings |
| Codex catalog lists (`codex-lists/`) and silhouettes (`codex-silhouettes/`) as files per build | R2, same bucket and Worker | Every list read cost the instance swap IO; the tables stay the source and the fallback; see § Catalog lists, § Silhouettes |
| Ship hulls + livery icons (`ship-skins`) | Cloudflare R2 `sc-companion-assets` (WEUR, account `115d75098864fcf13d36dc1aec1d874a`), read via `cloudflare/assets-worker` at `https://sc-assets.sc-assets-worker.workers.dev` (live 2026-09-25) | 0 € egress, 10 GB. A key the bucket lacks is streamed from Supabase by the Worker |
| News thumbnails (`news-images`, written by `fetch-verse-news`) | Same R2 bucket under `news-images/<hash>/w<N>.<ext>`, read via the same Worker at `/news-images/…` (code 2026-10-03, `feat/news-images-r2`) | Every thumbnail view used to count against the 5 GB/month Supabase egress. Legacy objects stay in Supabase and are streamed by the Worker |
| App bundle, icons, meshopt decoder | Vercel Hobby | Static hosting |
| Desktop installers | GitHub Releases in the public `Star-Citizen-Companion-Binaries` mirror | No bandwidth cap, trusted domain for AV scanners |
| Backups / codex build archive | *(planned)* Backblaze B2 EU with daily caps | Supabase Free has no downloadable backups |

**News images on R2.** `fetch-verse-news` PUTs new variants to R2
(`news-image-r2.ts`, R2 config + usage gate imported from `ingest-skins`) and
hands out `<ASSETS_BASE_URL>/news-images/<path>` (secret optional, defaults to
the workers.dev Worker). A refused or unknown usage gate, missing R2 secrets or
a failed PUT fall back to the Supabase upload per object, so the feed never
depends on R2. The video-retention prune deletes a cache entry from R2 *and*
Supabase and keeps the `verse_image_cache` row if either fails. Rows written
before the move keep their Supabase url in the DB; the client rewrites that
prefix to the Worker at read time (`toNewsImageUrl` in
`src/app/news/news-image-variants.ts`). `scripts/r2-migrate-news-images.mjs`
copies the existing objects (dry run unless `--apply`); a change to
`ingest-skins/_r2*.ts` does not redeploy `fetch-verse-news` by itself.

## Database budget — the codex is the only thing that grows

- One LIVE codex build is ~160 MB after VACUUM (locale strings alone ~69 MB).
  The Free plan allows 500 MB for the whole database.
- 2026-09-24: 952 MB with six builds. The four obsolete ones were deleted by
  hand and every `codex_*` table got `VACUUM FULL` → 349 MB.
- `codex_missions` (migration `20261103130000`, ingest op `missions`; since uploader subtheme `codex_extra` 6 also the ~690 career/list contracts that award a blueprint, class `contract_<debugName>`, `sc_extract/blueprint_sources.py`): ~2 700
  released contracts per build, ~2.4 MB JSON before TOAST, plain table outside
  the `codex_payloads` dedupe, cascades with its build. Read only through
  `search_missions()` / `codex_mission()` (current LIVE build).
- `prune_codex_builds(2)` runs nightly (pg_cron job `codex-build-retention`,
  migration `20260925010000`): per channel the two newest builds stay, the
  `is_current` one always stays. Two, because the Holotable patch selector and
  the inline patch diff read the previous build.
- Since `20260928231143` (plan D02) only **finalized** builds count:
  `codex_builds.finalized_at` is set by `set_current_codex_build` (ingest
  `finalize`), so a running or abandoned import never pushes the previous LIVE
  build out. Never-finalized, non-current builds are swept after 7 days. The
  app-side filter (patch selector and inline diff read finalized builds only)
  ships separately on `fix/d02-finalized-filter`, after the migration is live.
- Since `20261114120000` a re-upload of the same game build is a NEW build row
  (atomic switch at `finalize`); the build it replaces is `superseded_at`,
  invisible to clients, excluded from the retention count and deleted after an
  hour (cron `codex-superseded-prune`, hourly at :20). For that hour the DB
  holds one extra build's rows (bodies are shared via `codex_payloads`).
- **Deleting rows does not shrink `pg_database_size`.** Autovacuum makes the
  pages reusable for the next ingest, so steady state is about three builds'
  worth of disk (~480–510 MB). Only `VACUUM FULL` gives space back, and it takes
  an ACCESS EXCLUSIVE lock.
- **Nightly reclaim (migration `20261023120000`).** Measured 2026-10-23: 434 MB
  (limit 500) → **241 MB** with builds 4.10.0 and 4.10.2 intact, by a manual
  `VACUUM FULL` of `codex_locale_strings` (empty staging table, 46 MB bloated
  pkey) and every other `codex_*` table. To stop the regrowth, 14 pg_cron jobs
  `codex-storage-reclaim-<table>` run `vacuum full public.<table>` at
  04:45–04:58 UTC, one table per minute (after the 03:30 prune, clear of the
  04:15 / 04:25 / 04:40 log jobs). One job per table because pg_cron wraps a
  multi-statement string in one transaction and VACUUM refuses that. Trade-offs:
  ACCESS EXCLUSIVE per table while it runs (`codex_items` ~29 s,
  `codex_entity_strings` ~13 s, the others 1–4 s), needs temporary disk for one
  table copy, and it runs every night even when the prune deleted nothing
  (VACUUM cannot be called conditionally from SQL). A new codex table with a
  `build_id` needs its own line in a new migration. Check the first night with
  `cron.job_run_details` (query in the migration header); it is not verified
  live yet.
- **Payloads stored once (migration `20261102100000`, 2026-11-02).** The
  catalog names (`codex_items`, `_components`, `_weapons`, `_ships`,
  `_blueprints`, `_manufacturers`, `_ammunition`, `codex_silhouettes`) are
  views over `<name>_rows` + `codex_payloads(sha, body)`; a build that changes
  ~10 % of the catalog adds only those bodies. `codex_entity_strings` is a view
  derived from the payloads (no table). Retention is therefore **3** builds
  (`prune_codex_builds(3)`, same cron job, followed by `codex_gc_payloads()`
  for unreferenced bodies). The reclaim jobs vacuum the `*_rows` tables; `codex_payloads` gets **no**
  nightly VACUUM FULL (every codex read joins it — its lock would stall the
  whole Codex), GC + autovacuum reuse the space. The `codex_entity_strings`
  job is gone. Measured before:
  259 MB with 2 builds (105 MB payload, 75 MB of it distinct; strings 47 MB).
- `codex_locale_strings` moved to R2 (2026-10-03, § Localization strings).
  The table is now only an ingest's staging area.

## Catalog lists (R2 per build)

Every list read of the catalog costs the instance swap IO, so each build's lists
are published once as files and served by the Worker with a permanent cache. The
tables stay the source and the client's fallback; nothing is deleted from them.

| Key | Cache |
|---|---|
| `codex-lists/<build uuid>/index.json` | `max-age=300` (names the current gen) |
| `codex-lists/<build uuid>/<gen>/<name>.json` | immutable (a new gen per publish) |

`<name>` is `ship`, `ship-rank`, `weapon`, `component`, `item`, `ammunition`, `manufacturer`,
`blueprint`, `facets`, `missile`, `weapon-rank`, `component-rank`, `names-de` or `rank-parts`. The Worker
serves only these names (`LISTS_FILE_RE` in `cloudflare/assets-worker/src/index.js`): **a new name needs
`npx wrangler@4 deploy` there BEFORE the first publish that lists it**, or clients get a 404 for a file
the index names. A kind file holds ALL rows of the build (variants
included) in the database list order (`name_localized asc nulls last, class_name asc`),
columnar: `{ v, kind, columns, payloadKeys, rows: [[...columns, ...payload slices]] }`.
`facets.json` stores the `codex_facet_values` result per kind (ship, weapon,
component, item) unchanged. The ship payload slice is `SHIP_PAYLOAD_KEYS` in
`_list-snapshots.ts` (card keys + `sizeClass`, `career`, `dimensions`; the rank-cohort
keys hold the loadout tree and stats and live in their own file, `ship-rank.json`:
the same ship columns, `payloadKeys` = `SHIP_RANK_PAYLOAD_KEYS` (`RANK_PAYLOAD_KEYS`
of `codex.service.ts`, then `crew` and `dimensions` for the landing's class
comparison; readers look keys up by name, so a key added at the end never breaks an
older client), all ships in `ship.json` order, read in
pages of 200 because each row carries several kB; a browser reads it once per build
for the rank cohort).

Four more files (concept supabase-io-last; the client reads them instead of the database):
`missile.json` (`getMissileCohort`: items, `attach_type = 'Missile'`, named; columns `class_name,
name_localized, sub_type, size, attach_type, payload`, the LAST column is the whole payload,
`payloadKeys` empty; pages of 200), `weapon-rank.json` (weapons, named, `is_variant = false`;
columns `class_name, name_localized, sub_type, size`, payloadKeys `weaponParams`, `stats`),
`component-rank.json` (components, same filters, ALL kinds; payloadKeys `kind`, `stats`,
`weaponParams`; pages of 200). The client still applies `getItemRankCohort`'s `name_localized not like '!*'` and the
component kind filter. `names-de.json` = `{ v: 1, lang: "de", kinds: { <kind>: [[class_name,
german name]] } }` for all seven kinds, class_name order, one entry per record whose
`payload->name->>de` the `codex_search` text includes (not empty, not `@...`, not `TRANSLATION NOT
FOUND`, not equal to the English name ignoring case); the name is raw, the client folds case and
accents. `codex_search` matches `lower(unaccent(en || ' ' || de))` (or `class_name ilike`) against
EVERY token (LIKE, `*` = wildcard), ranks by `word_similarity` - that rank is not mirrored.
A failure of one of these four (or of `rank-parts.json`, below) is logged, the name stays out of
`index.json` and the publish result lists it in `failed`; the client treats a name missing from the
index as not published.

**`rank-parts.json`** (`_rank-parts.ts`; client `codex-rank-parts.ts`) carries what the "Einordnung"
rank cohort (`getRankCohort`) reads of the parts in the ships' stock loadouts. Measured 2026-11-20 on
LIVE 4.10.3: a cold ship detail page read the FULL payload of 5 553 parts (and asked for 5 600
ammunition names) in 116 requests, 26.5 MB, 20 MB of it `stats`; the cohort reads nine top-level
keys and six `stats` structs. The file: 8.1 MB, about 0.1 MB over the wire (brotli).
`{ v: 1, kind: "rank-parts", payloadKeys, ammoKeys, absent, rows: [[class_name, table, slice]],
ammo: [[class_name, slice]] }`. A `slice` is an object with exactly those of `payloadKeys`
(`ammoKeys`) the payload HAS: an absent key is not in it, a JSON null is there as null (`subType`
is null on 3 120 of the 5 553 parts; `in` and `=== null` tell the two apart, a `payload->key`
select does not, which is why the publisher reads the whole payload). `rows` = every class name anywhere in a
ship's `defaultLoadout` tree (collected while `ship-rank` is built, no second read of the ships),
from the first of weapons / components / items that holds it (`table`, the lookup order of
`getEntityPayloads`); `absent` = the names no table holds; `ammo` = ALL ammunition rows, so the
publisher never derives which ammunition a weapon names. Inside `stats` and `raw` a child that is a
plain object and whose lower-cased key contains none of `STAT_KEEP` (`itemresourcecomponentparams`,
`physics`, `shield`, `quantum`, `armor`, `missile`: the struct hints of the cohort's `findStat`
reads) / `RAW_KEEP` (`projectileparams`) is replaced in place by the string `"\u0000"` (jsonb cannot
hold U+0000, so it is never data; key order stays, `findStat` scans in it). Scalars and arrays are
never cut. **The file can only answer what the database would have answered:** the client turns
every cut into an object that throws `SnapshotCut` on any read and wraps each payload so that a
read of a top-level key outside `payloadKeys` (or an enumeration of the payload) throws too. Every
such read is also counted (`RankParts.cutReads()`), so a `try/catch` somewhere on the scoring path
that swallows the throw changes nothing: `getRankCohort` drops the file as a whole when scoring
threw anything or the count moved (logged once) and scores from the database as before.
So a change to the KPI code that reads something new costs speed until the keep lists follow, never
correctness. A class name the client asks for and the file neither holds nor lists as absent is read
from the database alone. The publisher reads the three tables in chunks of 200 names (each table only
the names no earlier one held, 71 requests for LIVE), slices and cuts each payload in the function and
keeps each row as JSON text, never as an object. It is by far the heaviest read of the publish (about
26 MB through the function), so it runs LAST, after the index is live and the old generations are
collected: the file is put, then the index is put once more with its entry (only while the bucket's
index still names this generation). A failure, or a worker killed over it (CPU time, memory), costs
this one file and never the publish. Why not the finished cohort
instead: scoring the fleet takes 5.7 s of CPU on a desktop (the function has 2 s) and runs through
`codex-loadout-stats`, `codex-power`, `codex-em-model` and more of the Angular source, which the
function cannot import.

Publish (`_list-publish.ts`; put order ship, ship-rank, the other kinds, facets, missile, weapon-rank,
component-rank, names-de, index, then rank-parts and the index again): one file at a time (pages of 1000, one file, then
dropped), facets, one file of the new generation read back through the public Worker, then the
index (last), the index read back from the bucket, then only generations older than
this publish and not named by that index are deleted (a failed read-back puts no
index and deletes nothing). It runs after `finalize` as a request of its own, behind the
same R2 usage gate as the locale publish: `finalize` calls the function itself with
`{ "op": "lists_publish", "build_id": "<uuid>", "detach": true }` (`_self-call.ts`, service
key in both headers), that request answers `202 { ok, started }` at once and
publishes after its response, where a failure is only logged. A refusal (error status:
nothing ran) is retried once; a request that threw is not, because it may have arrived
and two publishes of one build at once can leave the index naming a generation the other
one collected. Both sides log a worker id (`finalize <build> answered on worker <id>`,
`lists publish <build> (worker <id>)`): a worker past its soft CPU limit takes no new
request, one below it still does, so a different worker is likely and not promised. The
lists read only the catalog tables and the facet RPC, never the locale rows. The worker that answers
`finalize` has spent most of its 2 s of CPU on the ingest (1 756 ms on 2026-11-19) and
still carries the locale publish; on it the lists publish (624 ms by itself) could be the
step that gets the worker killed, and a kill over the locale publish took the lists with
it. The call is started before the locale publish. `detach` is honoured for the service
key only; without it `lists_publish` (`{ "op": "lists_publish", "build_id": "<uuid>" }`)
answers with the result and
redoes it for one build. `locale_gc` also removes the `codex-lists/` prefixes of
builds gone from `codex_builds` (report under `lists`).

**Client read path** (`src/app/codex/`): `CodexListSnapshots` (`codex-list-snapshots.ts`)
fetches the index and the files through the Worker, keeps the parsed files of the
current build in memory (they are the list cache) and answers `null` for anything
it cannot use: index 404 (not published yet — remembered 5 min, not logged), a
failed download (HTTP error, network, or the 30 s fetch abort; logged once, not
retried for 60 s), an unexpected shape (logged once, never fetched again for that
gen — files are immutable), or a file still downloading after 3 s (that call uses
the database; later calls skip the wait until the same download lands). Any throw
while answering from a file is logged once and falls back to the database. The pure
`codex-list-engine.ts` answers a read from the rows with PostgREST semantics (default
browse filters, every `filteredListQuery` filter incl. NULL handling, the ILIKE
token groups plus `searchMatcher`, paging, exact counts) and declines (`null`) on
`payload: 'full'`, a payload key the file lacks, a regex outside its POSIX subset,
an unknown filter key or a column the table lacks. `CodexService` tries the file
first in `listByKind`, `countByKind`, `countSearchMatches`, `countItemsByAttachType`,
`facetValues` (+ ship sizes), `weaponFacets`, `listFpsCatalog`, `backfillCohortNames`
`allShipRows` (whole cohort from `ship-rank.json`) and `listSkinSiblings` /
`listEditionSiblings` (ILIKE prefix; above 200 matches the database answers, its
collation decides the cut); on `null` the old query runs unchanged. From the files,
`countSearchMatches` counts like `listByKind` (token groups + matcher), so "also
found in …" equals the list's count. `getMissileCohort` reads `missile.json`,
`getItemRankCohort` reads `weapon-rank.json` / `component-rank.json` (the client
applies the `'!'` name filter and the component kind; the silhouettes for the
missile measurements still come from `codex_silhouettes`). The German-name
fallback of `listByKind` matches locally when `names-de.json` and the kind's list
file are both there (`germanListFromSnapshot`: `codex_search`'s row test — every
token against the folded `en de` text or ILIKE the class name, `*` wildcard,
`%`/`_`/`\` literal — then the list's own filters); it does not rank by
`word_similarity` nor cut at 100 names, so a broad German term lists all its
matches. Without either file the `codex_search` RPC + `in` list read run as before.
Reads by class name (`.in('class_name', …)`) go through `snapshotByName` →
`recordsByClassName`: `resolveEntities` (the five kind files, merged in table
order), `getShipsByClassNames` (`ship.json`, or `ship-rank.json` for rank keys),
`getPayloadKeys` (card keys from the kind file, everything else from the rank
slice of ships / weapons / components), `getComponentKeyStats` (the four values
picked out of `component-rank.json`'s `stats`) and `blueprintCategories` (distinct
`category` of `blueprint.json`). A kind file holds the whole table, so a name it
lacks is simply absent; `weapon-rank` / `component-rank` are filtered, so a name
they lack is looked up in the kind file: absent there = not in the build, present
there (a variant, an unnamed record) = the one name the old query still reads. A
file published before a key existed declines, and the old query runs for every name.
The rank cohort's part payloads (`getEntityPayloads` / `getAmmoPayloads` inside `getRankCohort`)
come from `rank-parts.json` (above); every other caller of those two still reads the database,
a handful of names at a time.
Still on the database: `listBlueprints` (full payload, no file; no caller today),
the `codex_search_suggest` "did you mean" RPC, detail pages, the patch tables
(`codex_patch_*`, `codex_added_class_names`, `codex_patch_news`: across builds, not
per build) and every other non-list read. The silhouettes have their own files
(§ Silhouettes). `searchAll` pages through `listByKind`, so it reads the files too. Specs never reach the Worker: `vitest-setup.ts` answers
`/codex-lists/` and `/codex-silhouettes/` with 404.

## Silhouettes (R2 per build, shards)

Every list view read its rows' outlines from `codex_silhouettes` (measured 2026-11-20:
869 kB for a ship page, 436 kB components, 118 kB weapons) and only memory kept them,
so every session read them again. One build holds ~53 MB of them as JSON (355 ships
6.5 MB, 775 weapons 5.3 MB, 1 581 components 10.3 MB, 4 560 items 31 MB), so they are
published once per build as shard files. The table stays the source and the client's
fallback; nothing is deleted from it.

| Key | Cache |
|---|---|
| `codex-silhouettes/<build uuid>/index.json` | `max-age=300` (names the gen and, per kind, `count` and `shards`) |
| `codex-silhouettes/<build uuid>/<gen>/<kind>/names.json` | immutable: `{ v, kind, shards: [[class names]] }` |
| `codex-silhouettes/<build uuid>/<gen>/<kind>/<n>.json` | immutable: one shard |
| `codex-silhouettes/<build uuid>/<gen>/plan.json` | publisher only, the Worker does not serve it |

`<kind>` is `ship`, `weapon`, `component`, `item` or `armor` (the table's `kind`); the
index names all five, `count: 0` for a kind the build has no outline of.

**Why not hashed shards like the locale strings.** A list page asks for its 60 rows
(`PAGE_SIZE`), a detail page for one. A hash spreads 60 names over 60 shards, and four
of five item rows have no outline at all yet would still cost a shard each. So the
shards follow the **list order** of the kind's catalog table (name asc nulls last, then
class name, the order of `codex-lists/<kind>.json`; classes the table lacks come last by
class name): a page's rows are neighbours. `names.json` lists every class that has an
outline, shard by shard, so the client knows a name's shard without a hash and answers
"no outline" without any request. A shard holds a fixed number of **rows** (ship 6,
every other kind 16: ~110 kB before folding, `ROWS_PER_SHARD`), not a byte target, so
the split is known from the names alone and the publish can run in independent slices.
Rows that share one shape (a ship and its variants, one door mesh on many ships: 4 201
shapes for 7 271 rows) are stored once per shard: `{ v, kind, shard, columns,
shapeColumns, shapes: [[view_box, path, edges, bbox, anchors, unresolved]], rows:
[[class_name, shape index, meta, generated_at, channel, patch_version, build_number]] }`.
The client rebuilds the table's row from it and hands it to the same
`parseHoloSilhouette`, so a file answer is the database answer.

**Publish** (`_silhouette-shards.ts`, `_silhouette-publish.ts`; op `silhouettes_publish`).
An edge worker has 2 s of CPU for its whole life and 256 MB; the worker that answered
`finalize` on 2026-11-19 was at 1 756 ms before any of this. So the publish is small
calls, each one request, with no state outside R2:

1. **plan** (no `gen`): usage gate, a new generation, per kind the class names with a row
   and the catalog's list order (pages of 1 000, names only) → `names.json`; `plan.json` last.
2. **slice** (`cursor: { kind, from }`): 16 shards (at most 256 rows, ~1.8 MB), rows read
   50 names at a time, one shard built, put and dropped. Repeatable.
3. **commit** (`cursor: "commit"`): every key the plan names must be in the bucket, the
   table must still hold exactly the planned class names (`changed: <kind>` otherwise: a
   class missing from `names.json` would read as "no outline"), one shard is read back
   through the public Worker, a newer generation in the bucket's index stops it
   (`superseded`), then `index.json`, the index read back from the bucket, and only
   generations **older** than this one that the index does not name are deleted. Two
   commits of one build can still interleave (the put is not conditional): when this
   generation's files are gone right after its index went in, the newer publish's index
   is put back from its `plan.json`. `chain` is honoured for the service key only.

Each answer carries `gen` and `next`. After `finalize` the function calls itself for the
next step (`chain: true`, service key in both headers, one retry, at most 400 hops), started
before the locale and list publish. A broken chain writes no index, clients keep reading
the table, and the next publish's commit collects the unfinished generation. Redo or
backfill: `node scripts/codex-silhouettes-to-r2.mjs` (dry run) → `--apply` (`--build <uuid>`,
`--pause <ms>`); it needs only `SUPABASE_ACCESS_TOKEN` and drives the same steps one call
at a time. `locale_gc` also removes the `codex-silhouettes/` prefixes of builds gone from
`codex_builds` (report under `silhouettes`).

**Client read path.** `CodexService.silhouette()` / `silhouettes()` →
`CodexSilhouetteShards.resolve` (`src/app/codex/codex-silhouette-shards.ts`): index
(404 = not published, remembered 5 min, not logged), the kind's `names.json`, then one
request per needed shard, all kept as promises (the last 64 parsed shards; the browser's
HTTP cache holds the rest for good). It answers rows, `absent` names (not in `names.json`,
or a kind with `count: 0`: remembered as "no outline", like an empty table answer) and
`open` names (their shard failed: HTTP error, network, the 10 s abort, an unexpected shape;
not asked again for 60 s, a malformed file never) or `null` (no index, a kind the index does
not name, `names.json` unreadable). `null` and `open` run the unchanged
`codex_silhouettes` query, for the open names only. A shard the index names but the bucket
lacks (published again, old generation collected) drops the index, so the next call reads
the new one with `cache: 'no-cache'` (the browser may hold the old index for five more
minutes). Callers are unchanged: the browse tiles, `SilThumbsService`, the fusion search,
`getMissileCohort`, the holotable and the item stage all go through the two methods.

**Measured 2026-11-20 on LIVE 4.10.3** (build `eaec8352`, 7 271 rows). Publish: 493 shards
(ship 60, weapon 49, component 99, item 285) + 4 names files, 38.5 MB written for 53 MB of
rows; the script took 164 s, the self-calling chain 120 s for its 34 slices. The workers'
`Shutdown` rows: at most 648 ms CPU per worker (several slices each, limit 2 000) and
15-16 MB, every reason `EarlyDrop`. A shard is 47-70 kB of JSON and 4-20 kB on the wire
(brotli by the Worker), `item/names.json` 171 kB / 31 kB. Page loads counted with Playwright
(requests to `/rest/v1/codex_silhouettes` → requests to `/codex-silhouettes/`, index and
names included): ship list 2 → 0 database, 15 files; weapons 2 → 0, 6; components 2 → 0, 8;
items 2 → 0, 5; a ship detail 2 → 0, 3. The same number of outlines is drawn before and
after, and 167 sampled rows rebuilt from the shards are deep-equal to the table's rows.
Cost guard: one publish is ~500 Class A writes and ~38 MB per build (three builds kept:
~115 MB of the 8 GB gate); a page costs the Worker 3-15 requests once per browser and build
against its 100k a day.

**A Worker deploy replaces the whole script.** On the same day a second session deployed
`cloudflare/assets-worker` from its own tree 19 minutes after this change's deploy; every
`codex-silhouettes/` URL answered 404 until the next deploy. Nothing broke (clients fell
back to the table, a commit running meanwhile refused with `verified: false` and deleted
nothing), but: deploy the Worker - and `ingest-catalog` - only from a tree that has every
key shape and op that is already live, and check `npx wrangler@4 deployments list` when a
published file suddenly answers 404.

## Localization strings (R2 since 2026-10-03)

Measured 2026-10-03 before the move: database 496 MB, `codex_locale_strings`
185 MB (117 MB heap + 68 MB pkey) for two builds (4.9.0, 4.10.0), 11
languages each, ~323k rows and ~31 MB of raw text per build (English 90k
keys / 10 MB, German 23k / 2.2 MB). Later the same day, before any backfill,
the database read 385 MB and the table 137 MB (not this change).

**Layout** (`supabase/functions/ingest-catalog/_locale-shards.ts`, the one
source of truth; the client copy in `src/app/codex/codex-locale-shards.ts` is
pinned to it by shared golden vectors in both test suites):

| Key | Cache |
|---|---|
| `codex-locale/<build uuid>/<lang>/index.json` | `max-age=300` (names the current gen) |
| `codex-locale/<build uuid>/<lang>/<gen>/<shard>.json` | immutable (a new gen per publish) |

A page needs few keys (a detail page 1-5, `/codex/keybinds` ~1 250 `ui_*`
keys), so neither one file per language (10 MB) nor one per key fits. Keys
are grouped by their lower-cased first `_` segment (`ui`, `item`, `pu`, …);
a group of at least 16 kB gets `ceil(bytes / 96 kB)` shards picked by
FNV-1a of the key, everything smaller lands in hashed `_misc-<n>` shards. The
index stores the split, so a client computes a key's shard with no extra
lookup. Keybinds then loads ~3 shards per language.

**All languages (since 2026-10-29).** ingest-catalog no longer filters to de/en:
every language the uploader sends reaches the staging table and the R2 publish
(the translation pipeline needs English as source and CIG's own tables as
memory; `docs/translation/ARCHITECTURE.md`). The numbers above already counted
11 languages per build (~323k rows, ~95 MB staging while an ingest runs), so
the budget is unchanged; the staging rows are deleted after a verified publish.
After a verified publish, if `translation_settings.enabled`, it also opens
`translation_jobs` per approved language and pokes `translate-orchestrator`.

**Write path.** The uploader is unchanged: it still sends row chunks
(`locale_strings` op), so the table stays the staging area of a running
ingest (~95 MB for one build while it runs). After `finalize` answers,
ingest-catalog publishes every language (`EdgeRuntime.waitUntil`): keyset-paged
export RPC (`codex_locale_export`, 20k rows per call — the authenticator's
8 s statement_timeout: the whole English export took 5.0 s, its delete
6.4 s), shards, then the index, read-back of index and one shard **through the
public Worker**, removal of older gens, and only then the paged row delete
(`codex_locale_delete`). Same cost guard as ingest-skins (usage gate + bucket
quota) before any write. Any failure leaves the rows; the client keeps
reading them. Redo: `locale_publish` op or the backfill script.

**Read path.** `CodexService.resolveLocaleKeys` → `CodexLocaleShards.resolve`:
index per build+language (404 = "not in R2", remembered → database table;
outage → database, asked again next time), then one request per needed
shard, both cached as promises for the session. A missing key or a failed
shard leaves the key raw, as a missing row did. The Worker host is already in
`connect-src`.

**Backfill / redo.** `node scripts/codex-locale-to-r2.mjs` (dry run) →
`--apply` → `--apply --delete-source`; `--build`, `--lang` narrow it. It only
needs `SUPABASE_ACCESS_TOKEN` and calls `locale_publish` with the service key,
so no R2 credentials leave the edge function. Order of deployment: migration
`20261003150000` (db push), Worker (`wrangler deploy` in
`cloudflare/assets-worker`, without it the read-back fails and nothing is
deleted), `functions deploy ingest-catalog`, the web app, then the script.
Deleting rows does not shrink the database file: `vacuum full
public.codex_locale_strings;` off-hours afterwards.

**Garbage collection (`locale_gc` op, since 2026-10-23).** A build pruned by
`prune_codex_builds` leaves its `codex-locale/<build>/` prefix in R2 (~10 MB as
JSON per build, counts against the 8 GB write gate). `ingest-catalog` op
`locale_gc` (service-role key only, not the uploader gates) lists
`codex-locale/`, reads every id in `codex_builds` first, and deletes the
prefixes whose id is gone. Selection is pure (`_locale-gc.ts`, tests in
`_locale-gc.test.mjs`): a live id is never selected, an empty or failed id read
selects nothing, keys not shaped `codex-locale/<uuid>/<object>` are ignored.
**Dry run is the default**; send `dry_run: false` to delete:

```
# report (dry run)
curl -s -X POST "$SUPABASE_URL/functions/v1/ingest-catalog" \
  -H "authorization: Bearer $SB_SECRET" -H "apikey: $SB_SECRET" \
  -H "content-type: application/json" \
  -d '{"op":"locale_gc"}'

# delete
curl -s -X POST "$SUPABASE_URL/functions/v1/ingest-catalog" \
  -H "authorization: Bearer $SB_SECRET" -H "apikey: $SB_SECRET" \
  -H "content-type: application/json" \
  -d '{"op":"locale_gc","dry_run":false}'
```

**Both headers, and the new secret key.** `$SB_SECRET` is the project's
`sb_secret_…` key — the same value the edge runtime sees as
`SUPABASE_SERVICE_ROLE_KEY`. The gateway checks `apikey`; with only
`authorization` it answers `Invalid API key` before the function runs. The
legacy `service_role` JWT passes the gateway but gets a 401 from the function.
Fetch the key from the Management API with the CLI token, straight into a
variable, never printed:

```
SB_SECRET=$(curl -s "https://api.supabase.com/v1/projects/hcnqhvzlavdycidqyaai/api-keys?reveal=true" \
  -H "authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).find(k=>k.type==="secret").api_key))')
```

`scripts/codex-locale-to-r2.mjs` does the same (`serviceKey()`, both headers
on `locale_publish`).

It is a manual/operator step (not scheduled: pg_cron would need an HTTP
extension and the service key in the DB). Run it after a prune has removed a
build, e.g. together with a check of the nightly reclaim.

Only `de` and `en` reach the staging table: the `locale_strings` op drops every
other language (the app reads no other), which halves an ingest's temporary
table growth and the R2 writes. A publish the R2 usage gate refuses leaves the
rows in place and clients keep reading the table; the catalog import is never
aborted for it.

The assets Worker also serves `news-images/<hash>/<variant>.<webp|jpg|jpeg|png|gif|avif>`
with the short cache and a stream-from-Supabase fallback to the public
`news-images` bucket (the fallback bucket is the key's first segment).

## Log retention

- `api_request_log`: 1 day (pg_cron `api-request-log-purge`, 04:15 UTC). The
  API rate limiter only reads the last minute.
- `telemetry_events`: 120 days (pg_cron `telemetry-events-retention`, 04:25
  UTC) — the admin telemetry dashboard's widest window is 90 days, plus a
  30-day buffer. `ingest-telemetry` caps `detail` at 4 KiB (larger values
  become `{ _truncated: true, bytes }`).
- Both since `20260928231143_delete_paths_and_log_retention.sql` (plan D02).

## 3D asset packages (ships, FPS weapons)

Pre-built by the uploader, so the web only fetches and displays. All keys sit in
R2 under `ship-skins/` and are content-addressed (sha256 of the bytes), so the
Worker serves them `public, max-age=31536000, immutable`:

| Key | What | Size |
|---|---|---|
| `_hulls/<sha>.glb` | ship hull (existing hull flow) | ~0.6 MB |
| `_parts/<sha>.glb` | shared geometry-only part; an FPS weapon's root too | 10-300 kB |
| `_interiors/<sha>.glb` | optional ship interior | a few MB |
| `_manifests/<sha>.json` | the package manifest (plain JSON) | ~100 kB |
| `_blueprints/<sha>.svg` | ship blueprint drawing, `full` (top + side) or `icon` (top), drawn by the uploader from the hull ([blueprint.md](../../data-uploader/docs/blueprint.md)); R2 only, sandboxed SVG CSP | full ~80-135 kB, icon ~2-3 kB |

A ship package is ~1.3-2.9 MB before cross-ship dedup (parts are shared across
ships, so the bucket grows far less than packages x ships). The DB holds only
`asset_packages` (PK `kind, entity_class`; manifest sha, root/interior sha,
counts, bytes) — public read, writes by `ingest-skins` (service role) only.
Web path: row -> `/ship-skins/_manifests/<manifest_sha256>.json` -> each part at
`/ship-skins/_parts/<sha>.glb`. Orphans (a replaced manifest and parts no
manifest names any more) are not collected yet; a GC pass would list the three
prefixes, subtract everything the current manifests name, delete the rest. They
count against the 8 GB write gate like everything else.

## R2 cost guard (R2 has no hard spending cap)

- **Reads** only through the Worker on `*.workers.dev`. Its Free plan stops at
  100k requests/day, below R2's free 10M Class-B ops/month. No public bucket,
  no `r2.dev`.
- **Writes** only through presigned PUTs that ingest-skins hands out after the
  usual JWT + release-token + role gate. `sign` refuses with 507 once the bucket
  holds `R2_QUOTA_BYTES` (default 8 GB of the free 10 GB).
- **Usage gate = the kill-switch** (`ingest-skins/_r2-usage.ts`, 0.100.0).
  Before signing, it reads this month's account-wide usage (storage, Class A,
  Class B) from the GraphQL Analytics API with `CF_ANALYTICS_TOKEN`, an
  Account Analytics Read token. At 80 % of any allowance it returns 507
  `r2_free_tier_guard`. If usage cannot be read it returns 503
  `r2_usage_unknown`: it fails closed, and unknown is never zero. Exception
  (D13): a good reading of the same calendar month, at most 24 h old, still
  decides while Analytics is down (`usageGate`). That reading lives per warm
  isolate only, so a cold start during an outage stays fail-closed. The
  uploader stops the whole livery run at the first gate refusal.
  - Only the edge function holds the R2 secret, so "stop signing" works as
    "stop writing".
  - **Deliberately not a token-deleting switch.** Deleting or disabling a
    token needs *Account API Tokens Write*, which can mint tokens with any
    permission. That makes it account-admin, and it would sit in a secret
    store.
  - If the R2 secret ever leaks, revoke the token by hand in the dashboard
    (R2 → Manage API Tokens). The Access Key ID is the token id.
- Cloudflare has **no** R2 spend cap and no suspend API. Budget alerts
  ($1 set) only send email, only after overage has started. Webhook alerts
  need a Pro zone.
- **Money-side cap:** the user withdraws Cloudflare's PayPal debit
  authorization (decided 2026-09-25). A charge then fails instead of going
  through. Any invoice still stands legally, so the gate above is what keeps
  it at $0.
- The API token is scoped to the one bucket and lives only as an Edge-Function
  secret.
- `*.workers.dev` may get the same Kaspersky treatment as `vercel.app`. A custom
  domain (~10 €/yr, not free) is the durable fix for both, and would also enable
  the Cloudflare CDN cache and an R2 custom domain.

## Caching — why there is no Redis

- Traffic is ~430 Supabase requests/day. Catalog and asset data change once
  per patch, so browser + ngsw caching with ETag revalidation beats a server
  cache: no network hop and nothing to meter.
- The API rate limiter is deliberately Postgres (`api/_rate-limit.ts`). RSI
  and UEX responses already sit in Postgres cache tables.
- Add **Upstash Redis Free** (Frankfurt, 256 MB, 500k commands/month, throttles
  rather than bills, no card) only when `api_request_log` or the proxy caches
  show measurable DB load, or once traffic is above ~5k requests/day.
  Cloudflare Workers KV is the alternative that hard-errors at its limit.

## Ruled out (2026-09-24 recheck)

AWS S3 (no always-free tier any more; the 6-month free plan closes the account),
Azure Blob (12 months / $200 for 30 days), GCS (free tier US regions only),
Vercel Blob (1 GB, and going over locks it for 30 days), Oracle Always Free
(reclaim risk; everything is deleted if more than 20 GB is held when the trial
ends). Also out: Storj, Tebi, IDrive e2, Wasabi, Bunny, Momento (free tier gone
or a minimum charge).

## Open: alpha installers are public

Every desktop build, alpha ring included, lands in the public binaries mirror.
The SQL ring clamp (`desktop_release_for_channel`) only hides the metadata. If
alpha must stay internal: publish only stable to the mirror, and put
alpha/beta in R2 under a prefix the Worker does **not** serve, handed out as a
5-minute presigned GET by an edge function after the role check.

## Deployment order for the codex storage reclaim (2026-10-23)

1. `npm run db:push` — creates the 14 `codex-storage-reclaim-*` cron jobs
   (idempotent). Nothing runs until 04:45 UTC.
2. `supabase functions deploy ingest-catalog` — adds the `locale_gc` op.
3. `locale_gc` with the default dry run, read the list of orphan builds, then
   repeat with `dry_run: false`.
4. Next morning: `cron.job_run_details` for the reclaim jobs, and
   `select pg_size_pretty(pg_database_size(current_database()))`.
