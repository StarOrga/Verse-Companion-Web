// One slice of a build's English table with everything a pass needs for its keys: the CIG values of
// the same keys, one hash per distinct text, and the translation-memory shards those hashes live in.
// Never a whole table, never the whole TM - that is what took the unsliced passes over the edge limits.
//
// The estimate has its own reader (`scanSlice`, which also needs the base build); every pass uses this one.

import { sha256Hex } from './_diff.ts';
import type { TmEntry } from './_diff.ts';
import { inPool } from './_io.ts';
import type { Store } from './_io.ts';
import { loadTmFor, openTable, SCAN_SHARDS } from './_scan.ts';
import type { TableReader } from './_scan.ts';

const READ_CONCURRENCY = 12;

export interface Slice {
  /** Shard names this slice covers (`<group>-<n>`). */
  names: string[];
  /** Keys of the slice, sorted. */
  keys: string[];
  en: Record<string, string>;
  /** CIG's value for the same keys (only the keys it has). */
  cig: Record<string, string>;
  /** English text -> sha256, for every non-blank text of the slice. */
  hashes: Map<string, string>;
  /** The TM shards the slice's hashes need (whole shards: they may hold other entries too). */
  tm: Record<string, TmEntry>;
  tmNonEmpty: boolean;
}

export interface SliceReaders {
  en: TableReader;
  /** null = this language has no usable CIG table (ru in the korean slot). */
  cig: TableReader | null;
}

export async function openSliceReaders(store: Store, buildId: string, cigFolder: string | null): Promise<SliceReaders> {
  return { en: await openTable(store, buildId, 'en'), cig: cigFolder ? await openTable(store, buildId, cigFolder) : null };
}

export async function loadSlice(
  store: Store, r: SliceReaders, lang: string, from: number, count = SCAN_SHARDS,
): Promise<Slice> {
  const names = r.en.names().slice(from, from + count);
  const en: Record<string, string> = {};
  await inPool(names, READ_CONCURRENCY, async (n) => {
    Object.assign(en, await r.en.shard(n));
  });
  const keys = Object.keys(en).sort();

  const cig: Record<string, string> = {};
  if (r.cig?.index) {
    await inPool(keys, READ_CONCURRENCY * 4, async (k) => {
      const c = await r.cig!.get(k);
      if (c !== undefined) cig[k] = c;
    });
  }

  const hashes = new Map<string, string>();
  for (const k of keys) {
    const e = en[k];
    if (e && e.trim() && !hashes.has(e)) hashes.set(e, await sha256Hex(e));
  }
  const { tm, nonEmpty } = await loadTmFor(store, lang, hashes.values());
  return { names, keys, en, cig, hashes, tm, tmNonEmpty: nonEmpty };
}

/** The group of a shard name (`item-12` -> `item`, `_misc-0` -> `_misc`). */
export function groupOfShard(name: string): string {
  const i = name.lastIndexOf('-');
  return i > 0 ? name.slice(0, i) : name;
}

/** Deletes work files in small parallel batches; a missing file is not an error. */
export async function deleteKeys(store: Store, keys: string[]): Promise<void> {
  await inPool(keys, READ_CONCURRENCY, async (k) => {
    await store.deleteKey(k).catch(() => {});
  });
}

export const HEX = '0123456789abcdef';
