// A community-source import in slices (why: _pass.ts; the filter itself: _seed.ts).
//
//   start      source usable? pin the LIVE build, read the upstream marker
//   fetch      download the pack (~12 MB global.ini), store its decoded text
//   split      parse it and write one part per key group of the English table (`pack-<group>`)
//   scan       SCAN_SHARDS English shards per slice: votes per English text, bucketed by the
//              first hex digit of its hash -> `cand-<digit>-<pos>`
//   apply      one hash digit per slice: merge its buckets, decide against the 16 TM shards of
//              that digit, write them; conflicts -> `conf-<digit>`
//   arbitrate  the conflicts of one digit per slice go to the arbiter
//   finish     coverage on the source row, then an overlay pass and a learning pass are asked for
//   cleanup    the work files, CLEAN_KEYS per slice
//
// The import this replaces did all of it in one request: the whole English table, the whole pack,
// the whole TM, then the learning pass and the overlay. It answered 546 every night and no source
// was ever imported. Votes add up across slices and a text is decided once, with every vote in hand,
// so the result is the one-pass result (pinned by a test).

import { keyGroup, MISC_GROUP } from '../ingest-catalog/_locale-shards.ts';
import { arbitrate } from './_arbiter.ts';
import { sha256Hex } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import { saveTm } from './_io.ts';
import { requestLearning } from './_learn_pass.ts';
import { decodeIni, parseIni, resolveSource, upstreamToken } from './_pack.ts';
import { commit, mergeState } from './_pass.ts';
import type { Pass, PassStep } from './_pass.ts';
import { loadTmFor, SCAN_SHARDS } from './_scan.ts';
import { addCounts, decideSeed, emptySeedCounts, mergeSeedCands, packTextPct, seedCandidates } from './_seed.ts';
import type { SeedCand, SeedConflict, SeedCounts } from './_seed.ts';
import { deleteKeys, groupOfShard, HEX, loadSlice, openSliceReaders } from './_slice.ts';
import { isUsable } from './_sources.ts';

/** Work files deleted per cleanup slice. */
export const CLEAN_KEYS = 150;

interface SeedState {
  /** CIG folder to respect; null = the folder holds another language (ru in the korean slot). */
  cig: string | null;
  /** Upstream version marker read before the download (what the daily sync compares). */
  marker: string | null;
  /** Version marker of what was downloaded. */
  token?: string | null;
  at: string;
  counts: SeedCounts;
  packKeys?: number;
  /** Pack parts written by `split`. */
  groups?: string[];
  /** Hash digits whose bucket produced conflicts. */
  confs?: number[];
}

const workKey = (pass: Pass, name: string) => `translation-work/seed-${pass.id}/${name}.json`;
const stateOf = (pass: Pass) => pass.state as unknown as SeedState;

function requireSources(d: Parameters<PassStep>[0]) {
  if (!d.sources) throw new TranslateError('translate.internal');
  return d.sources;
}

export const seedStep: PassStep = async (d, pass) => {
  const sources = requireSources(d);
  const st = stateOf(pass);
  const lang = pass.lang;
  if (!pass.source_id) throw new TranslateError('translate.source_unknown');

  if (pass.phase === 'start') {
    const src = await sources.load(pass.source_id);
    if (!isUsable(src)) throw new TranslateError('translate.source_not_permitted');
    const buildId = await sources.liveBuild();
    const readers = await openSliceReaders(d.store, buildId, null);
    if (!readers.en.index || !readers.en.index.count) throw new TranslateError('translate.english_missing');
    const language = await d.db.getLanguage(lang);
    // use_cig_table=false (ru in the korean slot): CIG's table there is another language, skip nothing.
    const cig = src.use_cig_table ? (language?.cig_folder || lang) : null;
    // The marker is taken from the cheap probe the sync compares against, before the pack is fetched.
    const marker = await upstreamToken(src, sources.fetchFn, sources.ghToken).catch(() => null);
    const state: SeedState = { cig, marker, at: d.now().toISOString(), counts: emptySeedCounts() };
    return commit(d, pass, { phase: 'fetch', pos: 0, total: readers.en.names().length, build_id: buildId, state: { ...state } });
  }

  if (pass.phase === 'fetch') {
    const src = await sources.load(pass.source_id);
    const resolved = await resolveSource(src, sources.fetchFn, sources.ghToken);
    await d.store.putJson(workKey(pass, 'raw'), { text: decodeIni(resolved.bytes) });
    return commit(d, pass, { phase: 'split', state: mergeState(pass, { token: resolved.token }) });
  }

  if (pass.phase === 'split') {
    const raw = (await d.store.getJson(workKey(pass, 'raw'))) as { text?: string } | null;
    if (!raw || typeof raw.text !== 'string') return commit(d, pass, { phase: 'fetch' });
    const pack = parseIni(raw.text);
    const readers = await openSliceReaders(d.store, pass.build_id!, null);
    if (!readers.en.index) throw new TranslateError('translate.english_missing');
    // A key lives in the part of its group, exactly as the English table groups its shards, so a slice
    // of the table needs only the parts of the groups it covers.
    const own = readers.en.index.groups;
    const parts = new Map<string, Record<string, string>>();
    for (const [key, value] of pack.map) {
      const g = keyGroup(key);
      const name = g && Object.hasOwn(own, g) ? g : MISC_GROUP;
      let part = parts.get(name);
      if (!part) parts.set(name, (part = {}));
      part[key] = value;
    }
    for (const [name, part] of parts) await d.store.putJson(workKey(pass, `pack-${name}`), part);
    await d.store.deleteKey(workKey(pass, 'raw')).catch(() => {});
    return commit(d, pass, { phase: 'scan', pos: 0, state: mergeState(pass, { packKeys: pack.map.size, groups: [...parts.keys()].sort() }) });
  }

  if (pass.phase === 'scan') {
    const readers = await openSliceReaders(d.store, pass.build_id!, st.cig);
    if (!readers.en.index) throw new TranslateError('translate.english_missing');
    if (readers.en.names().length !== pass.total) return commit(d, pass, { phase: 'start', pos: 0, total: 0 });
    const sl = await loadSlice(d.store, readers, lang, pass.pos);
    const have = new Set(st.groups ?? []);
    const packs = new Map<string, Record<string, string>>();
    for (const g of new Set(sl.names.map(groupOfShard))) {
      if (have.has(g)) packs.set(g, ((await d.store.getJson(workKey(pass, `pack-${g}`))) ?? {}) as Record<string, string>);
    }
    const own = readers.en.index.groups;
    const lookup = (key: string) => {
      const g = keyGroup(key);
      const part = packs.get(g && Object.hasOwn(own, g) ? g : MISC_GROUP);
      return part && Object.hasOwn(part, key) ? part[key] : undefined;
    };
    const hash = async (s: string) => sl.hashes.get(s) ?? await sha256Hex(s);
    const { cands, counts } = await seedCandidates({ en: sl.en, cig: sl.cig, pack: lookup, hash });
    const buckets = new Map<string, SeedCand[]>();
    for (const c of cands) {
      const b = buckets.get(c.h[0]);
      if (b) b.push(c);
      else buckets.set(c.h[0], [c]);
    }
    // Every digit is written, also an empty one: a retry after a re-publish must not leave an old bucket behind.
    for (const x of HEX) await d.store.putJson(workKey(pass, `cand-${x}-${pass.pos}`), buckets.get(x) ?? []);
    const next = pass.pos + SCAN_SHARDS;
    const state = mergeState(pass, { counts: addCounts({ ...st.counts }, counts) });
    return commit(d, pass, next >= pass.total ? { phase: 'apply', pos: 0, state } : { pos: next, state });
  }

  if (pass.phase === 'apply') {
    const x = HEX[pass.pos];
    const src = await sources.load(pass.source_id);
    const parts: SeedCand[][] = [];
    for (let pos = 0; pos < pass.total; pos += SCAN_SHARDS) {
      const part = (await d.store.getJson(workKey(pass, `cand-${x}-${pos}`))) as SeedCand[] | null;
      if (!part) return commit(d, pass, { phase: 'scan', pos: 0, state: mergeState(pass, { counts: emptySeedCounts(), confs: [] }) });
      parts.push(part);
    }
    const cands = mergeSeedCands(parts);
    const { tm } = await loadTmFor(d.store, lang, cands.map((c) => c.h));
    const r = decideSeed(cands, tm, { sourceId: src.id, lic: src.license, at: st.at });
    if (Object.keys(r.updates).length) await saveTm(d.store, lang, r.updates);
    const confs = [...(st.confs ?? [])];
    if (r.conflicts.length) {
      await d.store.putJson(workKey(pass, `conf-${x}`), r.conflicts);
      if (!confs.includes(pass.pos)) confs.push(pass.pos);
    }
    const state = mergeState(pass, { counts: addCounts({ ...st.counts }, r.counts), confs });
    if (pass.pos + 1 < HEX.length) return commit(d, pass, { pos: pass.pos + 1, state });
    return commit(d, pass, { phase: confs.length ? 'arbitrate' : 'finish', pos: 0, state });
  }

  if (pass.phase === 'arbitrate') {
    const confs = st.confs ?? [];
    const x = HEX[confs[pass.pos]];
    const conflicts = ((await d.store.getJson(workKey(pass, `conf-${x}`))) ?? []) as SeedConflict[];
    if (conflicts.length) await arbitrate(d, lang, conflicts);
    return commit(d, pass, pass.pos + 1 < confs.length ? { pos: pass.pos + 1 } : { phase: 'finish', pos: 0 });
  }

  if (pass.phase === 'finish') {
    const src = await sources.load(pass.source_id);
    const c = st.counts;
    // gap_pct = share of the keys CIG leaves untranslated that the pack really translates (text_pct stays the seeded whole-table figure).
    const translated = c.imported + c.unchanged + c.conflicts + c.admin_kept + c.cig_kept;
    const coverage: Record<string, unknown> = {
      ...(src.coverage ?? {}),
      gap_pct: packTextPct(translated, c.keys - c.skipped_cig),
      pack_keys: st.packKeys ?? 0,
      keys: c.keys,
      imported: c.imported,
      unchanged: c.unchanged,
      skipped_cig: c.skipped_cig,
      skipped_same: c.skipped_same,
      rejected_qa: c.rejected_qa,
      missing: c.missing,
      conflicts: c.conflicts,
      build_id: pass.build_id,
      updated_at: st.at,
    };
    await sources.update(src.id, { coverage, last_synced_at: st.at, last_seen_commit: st.marker ?? st.token ?? src.last_seen_commit });
    // The overlay is rebuilt from the TM this import just changed; learning follows with the new lines.
    await d.passes.open({ kind: 'overlay', lang, reason: pass.reason, state: { build_id: pass.build_id, cig: st.cig } });
    await requestLearning(d, lang, pass.reason === 'sync' ? 'sync' : 'seed');
    return commit(d, pass, { phase: 'cleanup', pos: 0 });
  }

  if (pass.phase === 'cleanup') {
    const keys: string[] = [workKey(pass, 'raw')];
    for (const g of st.groups ?? []) keys.push(workKey(pass, `pack-${g}`));
    for (const x of HEX) {
      keys.push(workKey(pass, `conf-${x}`));
      for (let pos = 0; pos < pass.total; pos += SCAN_SHARDS) keys.push(workKey(pass, `cand-${x}-${pos}`));
    }
    await deleteKeys(d.store, keys.slice(pass.pos, pass.pos + CLEAN_KEYS));
    const next = pass.pos + CLEAN_KEYS;
    return commit(d, pass, next >= keys.length ? { status: 'done', phase: 'done', pos: 0 } : { pos: next });
  }
  throw new TranslateError('translate.pass_phase_unknown');
};
