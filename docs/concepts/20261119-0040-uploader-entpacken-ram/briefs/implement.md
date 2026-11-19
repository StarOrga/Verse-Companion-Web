# Implement brief: uploader extraction spike (round 1)

Decisions: [`../../20261119-0040-uploader-entpacken-ram-decisions.json`](../../20261119-0040-uploader-entpacken-ram-decisions.json)
Concept page: `docs/concepts/20261119-0040-uploader-entpacken-ram.html`, round fragment `rounds/01.html`.

## User comments, annotation answers, pins

None. Round 1 was submitted with `action: implement`, every decision touched, no notes, no pins, an empty general comment.

## Measured facts the decisions rest on (spike, LIVE 4.10.3 Data.p4k, 12 cores / 32 GB)

- Serial codex extract (`--skip-generic --workers 1`): peak working set 4,476 MB, peak private 4,829 MB, 23.5 min, read 4,590 MB, wrote 191 MB in 29,572 files.
- RAM ramp while opening: 0 → 1,283 → 2,356 → 2,870 → 3,115 MB at 0/20/40/60/80 s. The DataCore (341 MB raw) follows the open.
- Hull probe (open the P4K + mirror and convert one hull): peak working set 2,738 MB, read 482 MB (the central directory), open 59.8 s, 1,399,137 entries.
- `presetLimits('gaming')` on this machine: `ramScaleMb` = 26,152 MB × 0.15 → snapped 3,840 MB (3.75 GB), below the measured 4.48 GB of a single extract.
- Harness scripts: `measure.py` (peak WS / private / IO counters via ctypes) and `hull_probe.py`, in the session scratchpad. Copy them into the repo if the prototype needs them.

## Checklist (one line per accepted item, with the source quote)

1. **d-codex → keep. No code change.**
   Quote: „Weiter als Dateien auf der Platte“, „Resume bleibt, kein Umbau.“

2. **d-mirror → keep. No code change.**
   Quote: „Weiter über einen kurzen Spiegel-Ordner“, „0,6 s Schreiben je Hülle, gleich danach gelöscht.“

3. **d-budget → floor: the RAM limit never goes below the measured need of one run.**
   Quote: „Untergrenze auf den Mindestbedarf heben“, „Der Regler beginnt bei rund 5 GB und zeigt ehrlich, was ein Lauf braucht.“
   - `data-uploader/src/lib/resource-limits.ts`: introduce a named, documented floor constant derived from the measurement (≈ 5 GB = 4.48 GB peak plus margin; cite the numbers above in the comment). `rangesFor().ramMb.min` and `presetLimits()` (today `Math.max(1536, …)`) use it, so "Gaming" starts at the floor instead of 3.75 GB. On a machine whose `ramScaleMb` is below the floor, min = max = the scale top (never a slider whose min exceeds its max).
   - `clampLimits` / migration of stored settings: a stored `ramMb` below the new floor is raised to it.
   - The renderer slider (settings dialog / resource dock) picks up the new min from `rangesFor`; check there is no second hard-coded minimum.
   - The floor constant is the single place to lower once item 4 lands (say so in its comment).
   - Tests: update/add unit tests in the uploader suite (`resource-limits` tests) for the floor, the small-machine case and the stored-value migration.

4. **d-index → yes: build a compact P4K index, measured first with a prototype.**
   Quote: „Ja, kompakten Index bauen“, „Geschätzt unter 0,5 GB statt rund 2,5 GB je Prozess. Vorher mit einem Prototyp messen.“
   - Today every process opens the archive through `scdatatools.p4k.P4KFile` (+ `p4k_compat.apply_p4k_compat()`), which keeps one `P4KInfo` object per entry (1.4 M) — ≈ 2.5 GB per process; every 3D worker pays it again (`SKIN_WORKER_MB = 3072`).
   - **Step 4a — prototype + measurement (gate):** a compact index that parses the central directory into packed arrays (names in one buffer + offsets; header offset, sizes, compression method, encryption flag as typed arrays), with the same lookups the callers use (`namelist()`, `getinfo()` / name → entry, case-insensitive lookup as hull3d's `_lower`, `open(info).read()`), reading data through the existing scdatatools decompression / decryption path or an equivalent. Measure with the spike harness against the real P4K: peak working set after open, open time, and byte-identical `read()` results for a sample of entries (DataCore `.dcb`, a `.cga`, a `.cgam`, a `.mtl`, a `.dds` / `.dds.N`, an encrypted entry if any). Record the numbers in the brief's acceptance table.
   - **Step 4b — integrate, only if 4a meets the goal** (peak after open clearly below 1 GB and byte-identical reads): switch the open sites (`extract.py`, `skin_export_app.py`, `silhouette_build_app.py`, `silhouette_build.py`, `ship_export.py`, `cutlass_pilot.py`) to the compact index behind one factory, keep `apply_p4k_compat` semantics, and lower `SKIN_WORKER_MB` / the item-3 floor to the new measured values. If 4a misses the goal, stop after 4a and report it as a shortfall with the numbers; do not integrate.
   - Output must stay byte-identical (codex JSON, previews, hulls), so no subtheme / recipe bump is needed; if anything does change, follow the subtheme-guard rule (`Subtheme-Unchanged:` trailers) and say so.
   - Tests: pytest for the index (synthetic fixture via `python/scripts/build-synthetic-fixture.py`), `PYTHONPATH` + embedded Python as in the project notes; `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`.

## Acceptance table (each agent fills its own lines)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | d-codex keep | | |
| 2 | d-mirror keep | | |
| 3 | RAM floor | | |
| 4a | Index prototype + measurement | | |
| 4b | Index integration | | |
