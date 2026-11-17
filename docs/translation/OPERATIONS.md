# Game-string translation — operations

Contract: [ARCHITECTURE.md](ARCHITECTURE.md). Functions: `supabase/functions/translate-orchestrator/`
(job state machine) and `supabase/functions/translation-overlay/` (signed-in delivery).

## Secrets

| Secret | Purpose |
|---|---|
| `TRANSLATE_ANTHROPIC_API_KEY` | The only key the orchestrator uses. Create it in its **own Console workspace** with a **spend limit at or below the monthly credit** and **auto-reload off**. Never reuse the `sc-events-sync` key. Absent: jobs end `failed` with `translate.no_api_key`. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (+ optional `R2_BUCKET`) | Already set for `ingest-catalog`; the orchestrator writes `translation-tm/`, `translation-overlay/` and temporary `translation-work/<job>/` objects with them. |

```
supabase secrets set TRANSLATE_ANTHROPIC_API_KEY=sk-ant-...
npm run functions:deploy
```

## Running a tick by hand

pg_cron calls `op: "tick"` every 10 minutes with the anon key; `ingest-catalog` also fires one
after enqueuing jobs. Manually (service role, or an admin JWT):

```
curl -X POST "$SUPABASE_URL/functions/v1/translate-orchestrator" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"op":"tick"}'
```

The response lists every job it touched with `from` and `to` status (`jobs`), the background passes it
ran a slice of (`passes`), the languages whose finished learning batches it applied (`learned`), the
ended jobs whose work files it deleted (`swept`) and `heavy: false` when another request held the
heavy-work lock. A batch usually takes minutes to hours, so expect many ticks per job. Nothing is spent
unless `translation_settings.enabled` is true (a `full` job is still estimated, which costs nothing).

**What one tick does.** Every job that only waits for a batch is asked. Then ONE unit of work gets the
request, behind a lock: the learning batches that have ended (one language), else a job, else the work
files of an ended job, else a background pass. The request takes slice after slice of that unit while
it has used less than `SLICE_BUDGET_MS` (400 ms). One unit, because the CPU limit belongs to the worker
and not to the request: the platform retires a worker at about one second of CPU and kills it at about
two, a request may land on a worker that is nearly spent, and two requests slicing at once add up.

**The lock.** `lock_claim('translate-orchestrator:heavy', '150 seconds')` returns a token (the claim
time) or null when another request holds it; `lock_release(name, token)` frees it only for the request
that holds that token, so a request that outlived its claim cannot free the next one's. A killed
request's claim expires after 150 s. A lock call that fails makes the tick run no slice.

**Fast lane.** A sliced step needs many requests (the table below). Cron `translate-orchestrator-fast`
(migration `20261117150000`) asks every 10 seconds and posts `{"op":"tick","fast":true}` only while
`translation_work_pending()` is true: a job has a slice to run (the same rule as `isHeavy()` in
`_machine.ts` - keep the two in step) or is `queued`, an ended job still has work files, or a pass is
open. A fast tick skips the asking of batches and the learning results: it starts queued jobs and runs
slices. The 10-minute tick stays the
heartbeat for everything that waits; it waits up to 18 s for the lock a fast tick holds. Roll back with
`select cron.unschedule('translate-orchestrator-fast')`; the pipeline then still works, a few slices
per 10 minutes.

## Approve, cancel, full run

All with an admin JWT or the service role:

```
{"op":"approve","job_id":"<uuid>"}                      # awaiting_approval -> queued (overrides both caps)
{"op":"cancel","job_id":"<uuid>"}                       # any open job; in-flight batches are cancelled
{"op":"start_full","build_id":"<uuid>","lang":"de"}     # whole-gap job; estimates itself, then ALWAYS awaits approval
```

Modes: `delta` (automatic) translates only keys whose English is new or changed against the
previous build; unchanged untranslated back catalogue is never sent. No base build (or its R2
shards missing) ends the job `skipped` (`translate.no_base_build` / `translate.base_build_missing`).
`full` exists only through `start_full`.

`start_full` only creates the job and answers at once. The ticks estimate it in slices (a few minutes
for a whole language on the fast lane; the admin list shows a percentage), then it waits in
`awaiting_approval` with `estimate_usd` and `string_count`, whatever the caps say. The admin UI asks the
cost question when the job is approved. There is one job per build, language and mode: `start_full` on
a job that still runs or waits returns it untouched; on one that has ended it starts the same row
again (`stats.run` counts the restarts and is part of its ledger refs), and answers
`translate.job_cleanup_pending` for the moment its old work files are still being deleted.

There is no `estimate` op any more (until 0.274.0 it computed a whole plan in one request, which a
language with a community pack cannot do): the estimate is the first step of the job itself.

## Failure keys (`translation_jobs.error`)

`translate.no_api_key` · `translate.english_missing` · `translate.lang_unknown` ·
`translate.plan_missing` · `translate.results_missing` · `translate.phase_unknown` ·
`translate.resubmit_limit` (a batch create went unanswered 3 times; see "Submitting a batch at most once") ·
`translate.internal` (5 failed attempts of one step) · `translate.nothing_to_do` (skipped) ·
`translate.worker_limit` (the worker was killed by the runtime's CPU / memory limit 3 times in a row).
A transient error (network, R2) only bumps `stats.attempts`; the next tick retries the same step. The
count is of errors in a row: a slice that commits and a wait that is asked without an error both start
it again, so a job that waits a day for a batch does not end on five network errors spread over it.

A job that ends (published, failed, skipped, cancelled) carries `stats.sweep` until a later tick has
deleted `translation-work/<job>/`, 150 objects per slice.

## Submitting a batch at most once

The provider has no idempotency key or metadata for a batch (checked 2026-11-17), so a create cannot
be made repeatable. A plan is cut into batch groups (`GROUP_PARTS` = 2 plan parts, at most 30 requests,
about 3 000 strings): one batch per group, so that one request can create a group, and later read and
check it, whatever the size of the job. Every create (main and post-edit per group, the judge once)
goes through `createBatch` (`_job_run.ts`):

- Before the create it writes the intent `stats.submit` (`kind`, group, time) as a compare-and-set.
  Of two requests that reach the same group only one wins that write; the other stops before it
  creates anything. A create the provider refuses (a 4xx came back) clears the intent again; one
  whose answer never arrived, or that ended in a 5xx / 529, keeps it - the batch may exist.
- The SDK does not retry a create (`maxRetries: 0`, 90 s timeout in `_anthropic.ts`): a create it
  sent again by itself would be a second paid batch nobody knows of.
- A request that finds an intent it did not write leaves the job alone until the intent is older than
  15 minutes (`STALE_SUBMIT_MS`): the request that wrote it may still be waiting for the answer.
- The batch id is written in the compare-and-set that moves the position to the next group.

What remains is a kill between the provider's answer and the write of the batch id (one DB round
trip), or a create whose answer was lost. The next request then finds the stale intent, creates that
group again, logs `translate batch may exist twice` and counts it in `stats.resubmits`; the first batch
is an orphan (visible in the Console) that is paid and never read. `resubmits > 0` on a job is the cue
to look, and after `MAX_RESUBMITS` (3) the job fails with `translate.resubmit_limit` instead of creating
another one. The learning step's batches (`_learn_batch.ts`, ids in R2 work keys) have their own intent.

**Ending a job that has batches.** `cancel` and a failure set the status first and cancel the batches
after it, so a job that lost that race keeps its batches. A create that is in flight at that moment
loses its own compare-and-set and cancels the batch it just made. The share of the estimate that was
sent and never read is booked under the ledger ref `unread`: the real spend of those batches is not
known, and the monthly ledger may over-count but never under-count.

Spend is booked once per batch: `translation_ledger.ref` is `main:<group>`, `judge` or
`postedit:<group>` (with `#<run>` on a restarted job), unique per job, so a slice that is repeated after
a kill does not book twice.

## What a job may spend

Caps and approvals are given for an estimate; what a job really costs is known batch by batch. The
real figures are asked again wherever a decision is still open (`_job_run.ts`, tests in
`_spend.test.mjs`):

- **Budget of a job** (`budgetOf`): its estimate plus a quarter, at least 5 cents. The estimate covers
  the first attempt of every text; the judge sample and the second attempts come out of the margin,
  and so does a first attempt that costs more than estimated.
- **Probe** (jobs of several batch groups, i.e. more than ~3 000 texts). The first group is sent alone
  (`submitted` / `probe`, a wait) and read when it has ended: its bill against its own estimate is the
  ratio the rest of the job is expected to follow (`stats.probe`: `est`, `usd`, `ratio`). Inside the
  budget the other groups are sent. Above it the job goes back to `awaiting_approval` with
  `stats.hold = 'overrun'`, `estimate_usd` corrected to the projected figure and the approval it had
  removed: one group is paid, not all of them. Approved again it goes on with the second group;
  cancelled, the paid group is in the ledger already (`main:0`, booked by the probe) and nothing else
  is. A first batch that billed nothing (expired, failed as a whole) says nothing: the job goes on.
  The price of the probe is one more wait for a batch on a large job. A job of one group has nothing
  to probe - its first attempts are one batch, paid when it is sent.
- **Paid steps beyond the first attempts.** Before the judge batch and before every post-edit batch the
  job asks `spendStop`: what it was billed (`spent_usd`) plus the estimate of what it has sent and not
  read (`stats.peSent`) plus the estimate of the next batch against its budget; and, for a job no
  person approved, the month's ledger plus the reserves of the other open jobs against
  `monthly_cap_usd`. A step that is refused is left out with everything after it: the job publishes
  what passed, the texts without a second attempt stay untranslated (their QA counts them as
  `dropped`, the next job of the language takes them), post-edit batches that were sent before are
  still read, and `stats.capped` records it (`reason`: `job_budget` or `monthly_cap`, `limit`, `spent`,
  `judge` = the sample was left out, `texts` = texts without a second attempt). The admin job list
  shows a sentence for it, as it does for every reason a job waits for approval.
- **A person's approval** lifts the month's cap for that job (as before) - by its estimate, and the
  job's own budget bounds by how much more.
- **Reserve.** While a job is open, the month counts it with what it may still spend
  (`reserveOf`: budget minus `spent_usd`), not with the unspent rest of its estimate.

What this does not bound: the first attempts of a job of ONE group, and the first group of a larger
job, are a batch that is paid when it is sent. `max_tokens` of a request is 2.5 times its estimated
output (at least 2 048), which is the ceiling of what such a batch can cost; in the four delta jobs of
2026-11-11 the bill was 0.78 to 1.05 times the estimate. The output estimate uses one measured ratio
(German, `OUTPUT_TOK_PER_CHAR` in `_cost.ts`) for every language until others are measured - the
probe is what catches a language whose tokens run longer.

A job that ends early with second attempts sent and not read books their estimate under `unread`,
together with the first attempts that were sent and not read.

## A job runs in slices (why a tick cannot die on it)

A string table is ~92 000 keys per build and language in ~150 shards; a language with a community pack
has a translation memory of ~85 000 entries (~20 MB) and an overlay of ~10 MB. None of that fits one
edge request (well under 1 s of CPU, 256 MB). So every step of a job is a walk in slices whose size
does not depend on the size of the job: a delta of 500 strings and the whole gap of a language walk
the same phases, the second one just has more of them. A slice is one compare-and-set that moves the
position (`stats.est` while estimating, `stats.phase` / `stats.pos` afterwards) and leaves its output
in `translation-work/<job>/` (R2).

**Two walks.** The string tables (English, CIG's own translation, the base build) are partitioned by
KEY, the translation memory by the HASH of the English text (256 shards). A slice of the table has
hashes in every TM shard, so "8 shards of the table" used to mean "the whole TM", in every slice.
Every walk is therefore two (`_rows.ts`): `rows` by key - 8 English shards per slice, everything that
is looked up by key (CIG value, base build), one row per key written to 16 files by the first hex
digit of its hash - and then one hash digit per slice: its rows and the 16 TM shards of that digit, a
sixteenth of each. All keys with the same English text meet in one digit, so a text is decided once.

| Status | Phases (one slice each unless noted) |
|---|---|
| `estimating` | `adm` (delta: the admin entries of the TM, one digit per slice, once per language) · `rows` (8 shards; override alerts) · `diff` (one digit: counts, the texts to translate routed to the segment of their key, reference pairs, CIG label pairs) · `prep` (glossary, system prompt → `plan.json`) · `chunk` (one key segment, or several small ones: the requests → `plan-<n>.json`, 15 each) · `shots` (one plan part, at most 2 pools of reference pairs) · `clean` · `complete` (cost, caps, holds) |
| `queued` | → `submitted` |
| `submitted` | `submitting` (one batch per slice) · `probe` (wait, jobs of several groups: the first batch is read before the others are sent, see "What a job may spend") · `running` (wait) |
| `validating` | `results` (one group: read its batch, QA) · `judge_plan` · `judge_submitting` · `judge` (wait) · `judge_read` · `pe_plan` (one group: judge verdicts, the post-edit requests) |
| `post_editing` | `submitting` (one batch per slice) · `running` (wait) · `results` (one group) |
| `publishing` | `route` (one group: accepted results by hash digit) · `tm` (one digit into its 16 TM shards) · `rows` (8 shards) · `join` (one digit: overlay entries) · `assemble` (the 16 pieces become the overlay file as text, glossary rows, a learning pass is asked for) |

The requests must be in KEY order (strings of one family, `pu_mission_x_*`, belong in one request),
while a text is a hash. `segmentsOf` (`_job_estimate.ts`) is the bridge: a partition of the keys, known
from the index alone, that keeps families together; `diff` routes each text to the segment of its
smallest key and `chunk` cuts one segment at a time.

A job that has nothing to translate but whose TM can fill keys of the build (after a community import)
goes from `estimating` straight to `publishing` and writes the overlay of that build.

**Publishing beside other writers.** A job runs for hours to days (batches, an approval). When its
results reach the TM (`tm`), an entry an admin wrote for the same text stands, and so does a community
entry that is newer than the job; admin entries are also never picked for retranslation by a flagged
glossary term. The flagged terms are read once, when the diff begins (`stats.est.force`): a term flagged
while a job estimates waits for the next job. `latest.json` is written only by the job of the current
LIVE build - a PTU build's job writes `<build>.json` alone.

Known limits (decided, not bugs): a job of one batch group pays for its first attempts before any
real figure exists ("What a job may spend"); a text that was
picked for retranslation and whose rewrite failed QA is left out of that job's overlay, keeps its old
TM entry and comes back with the next overlay rebuild; two jobs of one language that run at the same
time (PTU and LIVE) both translate a text that is new to both.

**Budgets.** `_scale.test.mjs` runs every walk on a table of production size against a store that keeps
JSON text like the bucket, and fails when one slice reads or writes more than 6 MB. Measured there
(2026-11-17, 91 900 keys, a pack of 87 000 lines, 64 000 TM entries): the largest slices are the import's
`scan` (4.3 MB read: 8 shards plus the pack parts of their key groups), the digit joins (2.4 MB) and a
`rows` slice (1.5 MB read, 1.4 MB written); 100-300 ms of CPU each on a desktop CPU. Two slices are
outside that budget on purpose and do nothing else: the import's `fetch` writes a whole pack (~12 MB of
text), but in pieces of about 1 MB as the bytes arrive, and `assemble` concatenates ~14 MB of JSON text
and writes it twice (`<build>.json`, `latest.json`) without parsing it into objects. Counts on that
table: an import 53 slices, an overlay 37, a learning pass 40, a delta job about 95, the whole gap of a
language (64 000 texts in 28 batch groups) about 390.

**Memory is not bytes moved.** A worker has 256 MB for heap and buffers together, and the byte budget
above does not see what a download costs: the runtime reads a response body into a buffer of 64 KB per
read and hands out a view of the part that was filled, so a list of chunks holds 64 KB for every few KB
that came in. The first live import (2026-11-17) kept the chunks of an 11.8 MB pack to join them and
was killed with 203 MB of buffers (`reason: Memory` in the `Shutdown` log line, which carries
`memory_used.heap` / `.external` / `.total`). Since then a pack is never held: `openSource` hands out
the bytes chunk by chunk, each chunk is decoded and used before the next one is asked for
(`iniDecoder`, `lineCutter`), a piece of whole lines is stored as soon as it is full, and `split` parses
one piece per slice into files of its own (`pack-<piece>-<group>`), reading none - so the order of the
lines in a pack does not change what a slice moves. Only a `zip-entry` source is held whole, to inflate
its one entry (no licensed source is one today); its zip must stay well under 100 MB. A test body that
wipes the buffer of a chunk when the next one is asked for (`chunkedBody` in `_testkit.mjs`) fails any
reader that keeps chunks.

Hashing is synchronous (`_sha256.ts`): `crypto.subtle.digest` per string was most of the CPU of a
slice (200-750 ms for the ~5 000 strings of 8 shards, against under 40 ms).

Tunables: `SCAN_SHARDS` (`_scan.ts`, measured on production 2026-11-17: 8 shards = 150-450 ms CPU and
22-28 MB with the old whole-TM slice), `SLICE_BUDGET_MS` (`_machine.ts`), `PART_CHUNKS`, `GROUP_PARTS`
(`_job.ts`), `SEG_ITEMS`, `POOL_PAIRS`, `SHOT_POOLS` (`_job_estimate.ts`). Measure before changing one:
`function_logs`, `Shutdown` rows, `cpu_time_used` per isolate; a change mid-job is safe, a walk that
finds a file of the old layout missing starts over.

**Killed requests.** A worker the runtime kills (546) never reaches a catch block. Before every slice
the driver stamps `stats.run_at`; the slice's own compare-and-set clears it. A stamp older than
5 minutes is a dead run and bumps `stats.dead` (it restarts at 0 whenever a slice commits). The third
dead run in a row without progress ends the job `failed` / `translate.worker_limit` instead of repeating
it forever. The stamp is also the concurrency guard: a young stamp makes another tick leave the job
alone. Every slice can be repeated: it writes its files first and moves the position last, and what it
books or creates is guarded (ledger ref, batch intent).

**A table published again.** The table of a build can be published again (a new generation in its
`index.json`; the shards of the old one go away). A walk notes generation and shard count of every table
it reads with its first `rows` slice (`tableMark`, in `stats.est.mark` / `stats.pub.mark` / the pass
state) and starts over when a later slice finds another one. The digit phases only read the row files
the walk wrote, so what they join is always one publication; the estimate also keeps the layout of the
table it walked (`stats.est.ix`) and cuts its segments from that, not from the table as it is later.

**CIG's own translation.** The uploader publishes CIG's table of a language under the language code
(`codex-locale/<build>/de/`), not under the game folder name (`german_(germany)`). Until 0.274.0 the
pipeline read the folder name, found nothing and treated every key as untranslated: CIG's ~23 000
German strings were translated again and shipped in the overlay. `cigTableFor` (`_sources.ts`) is the
one place that names the table; a language whose usable source says `use_cig_table = false` (ru in the
korean slot) has none.

## Rough cost (batch prices: Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per MTok)

| Case | Order of magnitude |
|---|---|
| German full gap (`start_full`, tiered Opus for lore / Sonnet for the rest) | about 40 USD |
| Delta of one upload | about 1–5 USD |
| 5 % judge sample + one post-edit pass | a few percent on top |

The estimate stored on the job is a forecast (measured ratios: input ≈ 0.90 tokens/char, output
≈ 0.87 × English chars for German, Opus +30 % thinking). `spent_usd` and `translation_ledger` book
the real cost from each batch result's `usage` (cache read 0.1×, 1 h cache write 2×).
Ledger rows are written before the status moves on, so a crash can only over-count a month, never
under-count it.

## Room labels (`scc_room_*`)

The uploader adds room labels without German to the English table as `scc_room_*` keys
(ARCHITECTURE.md § Room labels). The first upload after uploader subtheme `ships` 13 / `strings` 2
makes them new keys, so that upload's normal delta job translates them — about 530 distinct labels,
~10 600 English characters on the 2026-11-10 LIVE data, i.e. well under 1 USD (Sonnet tier), far
below `upload_cap_usd`, so the job queues without an approval. Nothing to do by hand if
`translation_settings.enabled` is on; if it is off, no job is created and the deck plan stays English.
The website reads `translation-overlay/<lang>/rooms.json` (written with every `latest.json`), via
`translation-overlay?lang=de&ns=rooms`. It appears with the first publish or seed import after the
orchestrator deploy.

## Community seed ops (concept 2026-11-08)

All with an admin JWT or the service role (`sync_sources` also with the publishable key, for pg_cron):

```
{"op":"import_seed","source_id":"rjcncpt"}   # starts the import pass: pack -> TM (community), coverage, overlay, learning
{"op":"sync_sources"}                        # every enabled licensed|permitted source: upstream changed? start its import pass
{"op":"learn","lang":"de"}                   # starts a learning pass
{"op":"draft_outreach","source_id":"thord82"}# maintainer message draft (status draft; never sent by code)
```

- All three only start a background pass and answer at once (`{queued: true, pass_id}`; `sync_sources`:
  `{checked, changed, errors}` with `changed` = passes started). The work runs in slices on later ticks, see
  "Background passes" below. Until 0.274.0 they did everything in the one request and never finished:
  `sync_sources` answered 546 every night and no source had ever been imported.
- `import_seed` answers `409 translate.source_not_permitted` unless the source is `licensed` or `permitted`
  and enabled (fr / zh-Hans / es until a permission is recorded). What the pass itself runs into ends up in
  `translation_passes.error`: `translate.no_live_build` / `translate.english_missing` without a published
  LIVE English table, `translate.source_not_permitted` when the permission went away meanwhile; an upstream
  fetch problem (`translate.source_fetch_<http status>`, `source_too_large`, `source_asset_missing`,
  `source_entry_missing`) is retried five times and then fails the pass. Re-running an import with an
  unchanged pack changes nothing.
- Cron `translate-orchestrator-sync-sources` runs `sync_sources` daily at 04:17 UTC
  (migration `20261108170000`); roll back with `select cron.unschedule('translate-orchestrator-sync-sources')`.
  The marker per source is stored in `translation_sources.last_seen_commit`; an optional
  `GITHUB_TOKEN` function secret raises the GitHub API rate limit (60/h unauthenticated is enough for 8 sources).
- The seed itself is token-free. The arbiter, revision, learning and research steps spend through the
  normal ledger and caps (arbiter model `translation_settings.arbiter_model`, web research
  `web_research_cap_usd`, default 5 USD per month).
- Memory: a pack is ~12 MB; it is decoded once and parsed line by line. The 42kit zip is downloaded whole
  (cap 120 MB) and only the one entry is inflated; if that ever hits the edge memory limit (546), stage the
  entry elsewhere or switch the source to the `StarCitizenToolBox` raw file.
- Outreach: `draft_outreach` creates or refreshes the single open draft of a source. Approval is
  `approve_translation_outreach` (protected admins only), sending is manual (copy, then
  `mark_translation_outreach_sent`); recording the answer `granted` sets an `awaiting_permission` source to
  `permitted`, after which `import_seed` works. Plan and recipient table: [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md).

### Cost of the seed

| Case | Order of magnitude |
|---|---|
| `import_seed` / `sync_sources` | 0 USD (no model call) |
| German with seed: the remaining AI gap (about 6 % uncovered text + ~2 400 placeholder rejects) | about 2–5 USD per language instead of about 40 USD |
| Arbiter pairwise comparison (Haiku class, batch, both orders) | cents per few thousand conflicts |

## Background passes (`translation_passes`)

Three kinds of work read the whole string table (~92k keys) and the whole translation memory. In one edge
request that is several seconds of CPU; a request must stay well under one. They run as passes: one bounded
slice per request, the position in `translation_passes` (compare-and-set on `updated_at`, like a job), what a
slice found in R2 work files under `translation-work/.../<pass id>/`. A killed request loses one slice. The
walks are the two of "A job runs in slices": `rows` by key, then one hash digit per slice.

| Kind | Asked for by | Phases | Slices on a table of 150 shards |
|---|---|---|---|
| `seed` | `import_seed`, `sync_sources` | `start` · `fetch` (download; the text is stored in pieces of whole lines as it arrives) · `split` (one piece per slice: its lines by key group) · `scan` (8 shards: votes per English text, bucketed by first hash digit) · `apply` (one digit: decide - kept in `dec-<digit>` so a repeated slice decides nothing twice - and write its 16 TM shards) · `arbitrate` (one digit: its conflicts to the arbiter) · `finish` (coverage) · `follow` (asks for `overlay`, then `learn`, each with a token) · `cleanup` | about 53 |
| `overlay` | a finished import | `start` · `rows` (8 shards) · `join` (one digit: the entries the TM can fill, as a piece of JSON text) · `assemble` (join the 16 pieces, write `<build>.json`, `latest.json`, `rooms.json`) · `cleanup` | about 37 |
| `learn` | a publish, a finished import, `op: learn` | `start` (answered cards, codex names) · `rows` (8 shards) · `mine` (one digit: term votes, style counts, name counts) · `plan` (style, promotions, contested terms) · `insert` (500 glossary rows) · `detect` (one digit, only when the plan asks: example lines, lines missing a CIG term) · `submit` (Haiku, align, then web research + arbiter) · `cleanup` | about 40 |

- **Same result as one run.** Everything a slice computes merges: votes and counts add up, the smallest key
  decides a spelling, a text is decided once with every vote in hand. `_passes.test.mjs` compares the passes
  with one run over the whole table (style, glossary rows, the Haiku and align requests, the TM, the overlay).
- **One open pass per kind, language and source.** A second request while one runs sets `again` and keeps what
  it asked for in `next_state`; one more pass follows the running one, also when that one fails. A request is
  never lost and never runs twice at once. An asker that may repeat itself (a slice run again after a kill)
  passes a `token`: the same token asks once.
- **An overlay is one state of the TM.** `join` notes the TM revision (`index.json` `rev`, +1 per write);
  `assemble` compares it and joins again when a job published or another import wrote meanwhile (at most 3
  times). `latest.json` is written only for the newest LIVE build.
- **A pass always ends.** A slice that throws is retried; after 5 errors in a row the pass gives up with
  `translate.internal`, a translated verdict (`translate.source_not_permitted`, `translate.no_live_build`, …)
  at once. A slice whose request was killed leaves `run_at` behind; after `RUN_STALE_MS` (5 min) the next tick
  counts it, and three kills in a row without progress give up with `translate.worker_limit`. A pass that
  gives up goes through phase `abort`, which deletes its work files (150 per slice), and then is `failed`
  with its error.
- **Batches.** Before a learning batch is created the pass records the intent (`state.intent`); the batch id
  is saved right after the provider answered. A request killed in between leaves a paid batch nobody reads:
  the next run creates it again, logs `translate learning batch may exist twice` and counts it in
  `state.resubmits`. Spend is booked with the batch id as `translation_ledger.ref`, so reading a batch twice
  books it once.
- **Where to look.** Admin → Übersetzungen → Quellen lists the passes of the last 7 days with phase and
  progress. SQL: `select kind, lang, source_id, status, phase, pos, total, dead, attempts, error, updated_at
  from translation_passes order by created_at desc`. A failed pass is started again with the same op.
- **Size of a slice.** `SCAN_SHARDS` (8 English shards, about 4 800 keys) for a `rows` or `scan` slice, one
  hash digit for the rest; budgets and how to measure are in "A job runs in slices". The seed `fetch`
  slice stores a pack in pieces of ~1 MB (`PIECE_CHARS`) and holds one of them; `assemble` holds one
  overlay as text (~10-14 MB).
- Daily cron `translate-orchestrator-housekeeping` (04:23 UTC) deletes finished passes older than 30 days
  and the run details of the fast-lane job older than a day.

## Learning step: work keys and spend

The learning step (`_learn.ts`, `_arbiter.ts`, `_revise.ts`, `_cards.ts`) runs after every seed import
or sync and on `op: learn`. Its LLM parts (Haiku pre-decision, pairwise arbiter, B1 term alignment, web
research) are Message Batches resumed by later ticks.

**It runs as a background pass** (`_learn_pass.ts`, see "Background passes" above): a publish, a finished
import and `op: learn` only ask for one. Until 0.274.0 the pass ran in one request, read the whole English
table, the CIG table and the whole TM, and searched every line for every contested term. Inside the publish
tick it took the worker over the 2 s CPU limit right after the job was published (2026-11-17, pt-BR:
published at 14:05:10 UTC, worker killed at 14:05:30 with `CPUTime`), and it never finished once in
production: no language had a learned style, a card, a `mined` glossary row or a learning ledger row.

What a pass leaves between its slices is in `translation-work/learn-<lang>/p-<pass id>/` and deleted when it
ends. What outlives a pass lives in R2:

| Key | Content |
|---|---|
| `translation-work/learn-<lang>/state.json` | the learning batches in flight (Haiku, align, web), what the last pass was, the pairs Haiku already judged for this build |
| `translation-work/learn-<lang>/arbiter.json` | open pairwise comparisons (both orders) |
| `translation-work/learn-<lang>/revise.json` | per-release change counter (hysteresis budget) |
| `translation-work/learn-<lang>/notes.json` | admin card notes fed into prompts |
| `translation-work/learn-<lang>/decided.json` | hashes an admin decided on a card (never overturned) |
| `translation-work/learn-<lang>/judge-terms.json` | term corrections from the 5 % judge |
| `translation-work/learn-spend/<month>.json` | web-research **reservations** only (`web_reserved`), released when the batch is read |

Learning spend is booked in `translation_ledger` as job-less rows (`job_id` null, migration
`20261108180000`) with `kind` (`learn | arbiter | align | haiku | web`; job rows keep `job`) and `lang`,
when a batch's results are read. The monthly cap sums every ledger row of the month, all kinds. The
web-research cap (`web_research_cap_usd`) is the ledger sum of `kind = 'web'` for the current month plus
the open reservations in `learn-spend/<month>.json`, which stop two languages in one tick from both
passing the cap.

Wiring (index.ts): `deps.learn = makeLearnDb(admin)`, `deps.sources` (the community sources: which CIG
table to respect, and sources, attribution and game folder on every overlay), `deps.passes` /
`deps.passSteps`, `deps.lock` and `deps.alerts` (B4 override alerts during delta estimating). Without
`deps.learn` learning, arbiter and cards are no-ops.
