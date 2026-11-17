// Two walks instead of one, because the tables are partitioned two ways.
//
// The string tables (English, CIG's own translation, the base build, a community pack) are addressed by KEY:
// shards per key group. The translation memory is addressed by the HASH of the English text: 256 shards by
// the first two hex characters. A slice of the string table (8 shards, ~4 800 keys) has hashes in every one
// of those 256 shards, so "one slice of the table" used to mean "the whole TM" - ~20 MB of JSON for a
// language with a community pack, in every slice. That does not fit an edge request (~1 s of CPU that is
// safe, see OPERATIONS.md), and it grows with every import.
//
//   rows   by key: SCAN_SHARDS English shards per slice. Everything that is looked up by key happens
//          here (CIG value, base build). The result is one row per key, written to 16 files by the
//          first hex digit of the row's hash.
//   digit  by hash: one hex digit per slice. Its rows (all slices) and the 16 TM shards of that digit -
//          a sixteenth of the table and a sixteenth of the TM, whatever their size.
//
// All keys with the same English text share a hash, so they meet in one digit: what must be decided once
// per text (a translation, a vote) is decided there with every key in hand.
//
// Pure of Deno and of the state machine: only a Store comes in.

import { diffStrings, isCigValid, sha256Hex } from './_diff.ts';
import type { DiffResult, TmEntry } from './_diff.ts';
import { inPool, tmIndexKey, tmShardKey } from './_io.ts';
import type { Store } from './_io.ts';
import { openTable, SCAN_SHARDS } from './_scan.ts';
import { sha256HexSync } from './_sha256.ts';
import type { TableReader } from './_scan.ts';

const READ_CONCURRENCY = 12;

export const HEX = '0123456789abcdef';
export const DIGITS = HEX.length;

/** CIG's own value is a real translation of this English (it is in the row). */
export const F_CIG = 1;
/** The base build has the same English under this key (rows of a delta walk only). */
export const F_SAME = 2;

/** One key: `[key, sha256(english), english, CIG's valid translation or '', flags]`. Blank English has no row. */
export type Row = [k: string, h: string, e: string, c: string, f: number];

export interface RowReaders {
  en: TableReader;
  /** null = this language has no usable CIG table (ru in the korean slot). */
  cig: TableReader | null;
  /** English table of the base build (delta walks). */
  base?: TableReader | null;
  /** CIG table of the base build (override alerts). */
  baseCig?: TableReader | null;
}

export async function openRowReaders(
  store: Store, buildId: string, cigFolder: string | null, baseBuildId: string | null = null,
): Promise<RowReaders> {
  return {
    en: await openTable(store, buildId, 'en'),
    cig: cigFolder ? await openTable(store, buildId, cigFolder) : null,
    base: baseBuildId ? await openTable(store, baseBuildId, 'en') : null,
    baseCig: baseBuildId && cigFolder ? await openTable(store, baseBuildId, cigFolder) : null,
  };
}

/** What a slice of the English table holds once everything addressed by key is joined. No TM. */
export interface KeySlice {
  /** Shard names this slice covers (`<group>-<n>`). */
  names: string[];
  /** Keys of the slice, sorted. */
  keys: string[];
  en: Record<string, string>;
  /** CIG's value for the same keys (only the keys it has). */
  cig: Record<string, string>;
  /** Base build: English of the same keys; null when the walk has no base. */
  baseEn: Record<string, string> | null;
  baseCig: Record<string, string>;
  /** English text -> sha256, for every non-blank text of the slice. */
  hashes: Map<string, string>;
}

export async function loadKeySlice(r: RowReaders, from: number, count = SCAN_SHARDS): Promise<KeySlice> {
  const names = r.en.names().slice(from, from + count);
  const en: Record<string, string> = {};
  await inPool(names, READ_CONCURRENCY, async (n) => {
    Object.assign(en, await r.en.shard(n));
  });
  const keys = Object.keys(en).sort();

  // The other tables have their own shard layout: read each shard a key of this slice lives in once.
  const cig = r.cig ? await r.cig.many(keys) : {};
  const baseEn = r.base ? await r.base.many(keys) : null;
  const baseCig = r.base && r.baseCig ? await r.baseCig.many(keys) : {};

  const hashes = new Map<string, string>();
  for (const k of keys) {
    const e = en[k];
    if (e && e.trim() && !hashes.has(e)) hashes.set(e, sha256HexSync(e));
  }
  return { names, keys, en, cig, baseEn, baseCig, hashes };
}

export interface RowsOfSlice {
  /** Rows by the first hex digit of their hash; always DIGITS lists. */
  byDigit: Row[][];
  keys: number;
  blank: number;
}

export function rowsOf(ks: KeySlice): RowsOfSlice {
  const byDigit: Row[][] = Array.from({ length: DIGITS }, () => []);
  let blank = 0;
  for (const k of ks.keys) {
    const e = ks.en[k];
    if (!e || !e.trim()) {
      blank++;
      continue;
    }
    const h = ks.hashes.get(e)!;
    const c = ks.cig[k];
    const cigOk = isCigValid(e, c);
    const f = (cigOk ? F_CIG : 0) | (ks.baseEn && ks.baseEn[k] === e ? F_SAME : 0);
    byDigit[parseInt(h[0], 16)].push([k, h, e, cigOk ? c : '', f]);
  }
  return { byDigit, keys: ks.keys.length, blank };
}

export const rowsKey = (prefix: string, digit: number, from: number) => `${prefix}rows-${HEX[digit]}-${from}.json`;

/** Every digit is written, also an empty one: a missing file then always means "walk again". */
export async function writeRows(store: Store, prefix: string, from: number, byDigit: Row[][]): Promise<void> {
  await inPool(byDigit.map((rows, d) => ({ rows, d })), READ_CONCURRENCY, async ({ rows, d }) => {
    await store.putJson(rowsKey(prefix, d, from), rows);
  });
}

/** The rows of one digit over the whole walk, sorted by key; null when a file is missing. */
export async function loadRows(store: Store, prefix: string, digit: number, total: number, step = SCAN_SHARDS): Promise<Row[] | null> {
  const froms: number[] = [];
  for (let from = 0; from < total; from += step) froms.push(from);
  const parts: (Row[] | null)[] = new Array(froms.length).fill(null);
  await inPool(froms.map((from, i) => ({ from, i })), READ_CONCURRENCY, async ({ from, i }) => {
    const part = await store.getJson(rowsKey(prefix, digit, from));
    parts[i] = Array.isArray(part) ? part as Row[] : null;
  });
  const rows: Row[] = [];
  for (const p of parts) {
    if (!p) return null;
    for (const r of p) rows.push(r);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows;
}

export function rowsFiles(prefix: string, total: number, step = SCAN_SHARDS): string[] {
  const out: string[] = [];
  for (let from = 0; from < total; from += step) for (let d = 0; d < DIGITS; d++) out.push(rowsKey(prefix, d, from));
  return out;
}

export interface TmDigit {
  tm: Record<string, TmEntry>;
  /** The language has a TM at all (any digit). */
  nonEmpty: boolean;
  /** Revision of the TM index when the digit was read (0 = an index from before revisions). */
  rev: number;
}

/** The TM entries whose hash starts with this digit: at most 16 shards. */
export async function loadTmDigit(store: Store, lang: string, digit: number): Promise<TmDigit> {
  const index = await store.getJson(tmIndexKey(lang)) as { shards?: string[]; rev?: number } | null;
  const all = index?.shards ?? [];
  const want = all.filter((hh) => hh[0] === HEX[digit]);
  const tm: Record<string, TmEntry> = {};
  await inPool(want, READ_CONCURRENCY, async (hh) => {
    const shard = await store.getJson(tmShardKey(lang, hh));
    if (shard && typeof shard === 'object') Object.assign(tm, shard as Record<string, TmEntry>);
  });
  return { tm, nonEmpty: all.length > 0, rev: Number(index?.rev ?? 0) };
}

/** Revision of a language's TM: it changes with every write (`saveTm`). */
export async function tmRevision(store: Store, lang: string): Promise<number> {
  const index = await store.getJson(tmIndexKey(lang)) as { rev?: number } | null;
  return Number(index?.rev ?? 0);
}

export interface DiffRowsOptions {
  /** 'delta': an untranslated key whose row carries F_SAME is back catalogue. */
  mode: 'delta' | 'full';
  forceTerms?: string[];
}

/** `diffStrings` over the rows of one digit (the rows carry what it would look up by key). */
export async function diffRows(rows: Row[], tm: Record<string, TmEntry>, opts: DiffRowsOptions): Promise<DiffResult> {
  const en: Record<string, string> = {};
  const cig: Record<string, string> = {};
  const baseEn: Record<string, string> = {};
  const hashes = new Map<string, string>();
  for (const [k, h, e, c, f] of rows) {
    en[k] = e;
    if (f & F_CIG) cig[k] = c;
    if (f & F_SAME) baseEn[k] = e;
    hashes.set(e, h);
  }
  return await diffStrings({
    en, cig, tm, mode: opts.mode, baseEn: opts.mode === 'delta' ? baseEn : null, forceTerms: opts.forceTerms,
    hash: async (s) => hashes.get(s) ?? await sha256Hex(s),
  });
}

/** The group of a shard name (`item-12` -> `item`, `_misc-0` -> `_misc`). */
export function groupOfShard(name: string): string {
  const i = name.lastIndexOf('-');
  return i > 0 ? name.slice(0, i) : name;
}
