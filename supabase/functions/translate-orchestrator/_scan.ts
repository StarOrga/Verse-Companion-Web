// Sliced estimating: the diff of one job (the work `computePlan` does in one go) in bounded steps.
//
// Why: the English tables are ~10 MB / ~90k keys per build. Loading en + base en + the CIG table + the
// TM into one isolate and hashing every string costs several seconds of CPU and far more than the
// edge runtime allows (~2 s CPU, ~256 MB), so a tick died with 546 and repeated the same work forever.
//
// A slice reads a few English shards of the job's build, looks the same keys up in the base / CIG
// tables through the shard layout (never whole tables) and loads only the TM shards its hashes need.
// Everything a slice finds is written as one part file; `mergeParts` folds the parts into what
// `diffStrings` + the label / few-shot inputs would have produced in one pass. Pure of Deno and of the
// state machine: only a Store comes in.

import { indexKey, isLocaleIndex, MISC_GROUP, shardFor, shardKey } from '../ingest-catalog/_locale-shards.ts';
import type { LocaleIndex } from '../ingest-catalog/_locale-shards.ts';
import { detectOverrideAlerts } from './_alerts.ts';
import type { AdminTerm, AlertRow } from './_alerts.ts';
import { diffStrings, isCigValid, sha256Hex } from './_diff.ts';
import type { DiffCounts, TmEntry, UniqueText } from './_diff.ts';
import { inPool, tmIndexKey, tmShardKey } from './_io.ts';
import type { Store } from './_io.ts';
import type { CigPair } from './_prompt.ts';

/**
 * English shards per slice (~600 keys each). Measured on production (2026-11-17): a slice of 8 costs 150-450 ms CPU
 * of the 2 000 ms an isolate gets, and 22-28 MB. A slice that dies costs a dead run, one that is small only costs
 * ticks, so 16 is the most this leaves room for; measure again before going there (docs/translation/OPERATIONS.md).
 * A change mid-job is safe: finalize finds a part missing and rescans.
 */
export const SCAN_SHARDS = 8;
/** Chunks per few-shot slice (`pickSimilar` scores a pool of up to 2 500 pairs per chunk). */
export const SHOT_CHUNKS = 15;

const READ_CONCURRENCY = 12;
const LABEL_KEY_RE = /^(item_Name|vehicle_Name|ui_|hud_|mobiGlas)/i;

/** One build's table for one language, read shard by shard. */
export interface TableReader {
  index: LocaleIndex | null;
  names(): string[];
  shard(name: string): Promise<Record<string, string>>;
  get(key: string): Promise<string | undefined>;
}

export async function openTable(store: Store, buildId: string, lang: string): Promise<TableReader> {
  const raw = await store.getJson(indexKey(buildId, lang));
  const index = isLocaleIndex(raw, buildId, lang) ? raw : null;
  const cache = new Map<string, Promise<Record<string, string>>>();
  const shard = (name: string) => {
    let p = cache.get(name);
    if (!p) {
      p = (async () => {
        const s = await store.getJson(shardKey(buildId, lang, index!.gen, name));
        return (s && typeof s === 'object' ? s : {}) as Record<string, string>;
      })();
      cache.set(name, p);
    }
    return p;
  };
  return {
    index,
    names() {
      if (!index) return [];
      const out: string[] = [];
      for (const [g, n] of Object.entries(index.groups)) for (let i = 0; i < n; i++) out.push(`${g}-${i}`);
      for (let i = 0; i < index.misc; i++) out.push(`${MISC_GROUP}-${i}`);
      return out;
    },
    shard,
    async get(key) {
      if (!index) return undefined;
      return (await shard(shardFor(index, key)))[key];
    },
  };
}

export interface ScanContext {
  store: Store;
  buildId: string;
  lang: string;
  mode: 'delta' | 'full';
  baseBuildId: string | null;
  cigFolder: string;
  forceTerms: string[];
  adminGlossary: AdminTerm[];
}

export interface ScanPart {
  todo: UniqueText[];
  reused: Record<string, { h: string; t: string }>;
  counts: DiffCounts;
  pairs: CigPair[];
  /** Short CIG label rows `[key, en, cig]` (input of `deriveCigLabels`, which needs no more than these). */
  labels: [string, string, string][];
  alerts: AlertRow[];
}

/** Readers a job's slices share: opened once per slice (the index files are small). */
export interface ScanReaders {
  en: TableReader;
  base: TableReader | null;
  cig: TableReader;
  baseCig: TableReader | null;
}

export async function openReaders(ctx: ScanContext): Promise<ScanReaders> {
  const en = await openTable(ctx.store, ctx.buildId, 'en');
  const base = ctx.mode === 'delta' && ctx.baseBuildId ? await openTable(ctx.store, ctx.baseBuildId, 'en') : null;
  const cig = await openTable(ctx.store, ctx.buildId, ctx.cigFolder);
  const baseCig = base && ctx.baseBuildId ? await openTable(ctx.store, ctx.baseBuildId, ctx.cigFolder) : null;
  return { en, base, cig, baseCig };
}

/** The TM shards that hold any of `hashes`; entries are only returned for those shards. */
async function loadTmFor(store: Store, lang: string, hashes: Iterable<string>): Promise<{ tm: Record<string, TmEntry>; nonEmpty: boolean }> {
  const index = await store.getJson(tmIndexKey(lang)) as { shards?: string[] } | null;
  const known = new Set(index?.shards ?? []);
  const want = new Set<string>();
  for (const h of hashes) if (known.has(h.slice(0, 2))) want.add(h.slice(0, 2));
  const tm: Record<string, TmEntry> = {};
  await inPool([...want], READ_CONCURRENCY, async (hh) => {
    const shard = await store.getJson(tmShardKey(lang, hh));
    if (shard && typeof shard === 'object') Object.assign(tm, shard as Record<string, TmEntry>);
  });
  return { tm, nonEmpty: known.size > 0 };
}

/** Scans English shards `[from, from + count)` of the job's build. */
export async function scanSlice(ctx: ScanContext, r: ScanReaders, from: number, count = SCAN_SHARDS): Promise<ScanPart> {
  const names = r.en.names().slice(from, from + count);
  const en: Record<string, string> = {};
  await inPool(names, READ_CONCURRENCY, async (n) => {
    Object.assign(en, await r.en.shard(n));
  });
  const keys = Object.keys(en).sort();

  const cig: Record<string, string> = {};
  const baseEn: Record<string, string> | null = r.base ? {} : null;
  const baseCig: Record<string, string> = {};
  await inPool(keys, READ_CONCURRENCY * 4, async (k) => {
    const c = await r.cig.get(k);
    if (c !== undefined) cig[k] = c;
    if (r.base && baseEn) {
      const b = await r.base.get(k);
      if (b !== undefined) baseEn[k] = b;
      const bc = await r.baseCig?.get(k);
      if (bc !== undefined) baseCig[k] = bc;
    }
  });

  // One hash per distinct text: the English of the slice plus the OLD English of changed keys (alerts).
  const hashes = new Map<string, string>();
  const need: string[] = [];
  for (const k of keys) {
    const e = en[k];
    if (e && e.trim() && !hashes.has(e)) {
      hashes.set(e, '');
      need.push(e);
    }
    const o = baseEn?.[k];
    if (o && o.trim() && o !== e && !hashes.has(o)) {
      hashes.set(o, '');
      need.push(o);
    }
  }
  for (const s of need) hashes.set(s, await sha256Hex(s));
  const hash = async (s: string) => hashes.get(s) ?? await sha256Hex(s);

  const { tm, nonEmpty } = await loadTmFor(ctx.store, ctx.lang, hashes.values());
  const diff = await diffStrings({ en, cig, tm, mode: ctx.mode, baseEn, forceTerms: ctx.forceTerms, hash });

  const pairs: CigPair[] = [];
  const labels: [string, string, string][] = [];
  for (const k of keys) {
    const e = en[k];
    if (!e) continue;
    if (LABEL_KEY_RE.test(k) && e.length <= 40 && cig[k] !== undefined) labels.push([k, e, cig[k]]);
    if (e.length > 300) continue;
    if (isCigValid(e, cig[k])) {
      pairs.push({ key: k, en: e, t: cig[k], o: 'cig' });
      continue;
    }
    if (!nonEmpty) continue;
    const hit = tm[hashes.get(e) ?? ''];
    if (hit && hit.o !== 'cig') pairs.push({ key: k, en: e, t: hit.t, o: hit.o });
  }

  let alerts: AlertRow[] = [];
  if (baseEn && r.baseCig) {
    alerts = await detectOverrideAlerts({ baseEn, en, baseCig, cig, tm, adminGlossary: ctx.adminGlossary, hash });
  }
  return { todo: diff.todo, reused: diff.reused, counts: diff.counts, pairs, labels, alerts };
}

export interface MergedScan {
  todo: UniqueText[];
  reused: Record<string, { h: string; t: string }>;
  counts: DiffCounts;
  pairs: CigPair[];
  labelEn: Record<string, string>;
  labelCig: Record<string, string>;
}

/** Folds slice parts (in any order) into the result one `diffStrings` pass over the whole table gives. */
export function mergeParts(parts: ScanPart[]): MergedScan {
  const counts: DiffCounts = { keys: 0, cig: 0, blank: 0, tm: 0, forced: 0, todo: 0, unchanged: 0 };
  const byHash = new Map<string, UniqueText>();
  const reused: MergedScan['reused'] = {};
  const pairs: CigPair[] = [];
  const labelEn: Record<string, string> = {};
  const labelCig: Record<string, string> = {};
  for (const p of parts) {
    for (const k of Object.keys(counts) as (keyof DiffCounts)[]) counts[k] += p.counts[k] ?? 0;
    for (const u of p.todo) {
      const have = byHash.get(u.h);
      if (have) have.keys.push(...u.keys);
      else byHash.set(u.h, { h: u.h, en: u.en, keys: [...u.keys] });
    }
    Object.assign(reused, p.reused);
    pairs.push(...p.pairs);
    for (const [k, e, t] of p.labels) {
      labelEn[k] = e;
      labelCig[k] = t;
    }
  }
  const todo = [...byHash.values()];
  for (const u of todo) u.keys.sort();
  todo.sort((a, b) => (a.keys[0] < b.keys[0] ? -1 : a.keys[0] > b.keys[0] ? 1 : 0));
  counts.todo = todo.length;
  pairs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { todo, reused, counts, pairs, labelEn, labelCig };
}

export const scanPartKey = (jobId: string, cursor: number) => `translation-work/${jobId}/scan-${cursor}.json`;
export const shotsPartKey = (jobId: string, from: number) => `translation-work/${jobId}/shots-${from}.json`;
