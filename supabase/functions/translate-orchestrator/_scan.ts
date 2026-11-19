// One build's string table for one language, read shard by shard, and the size of a slice of it.
//
// Why slices: the English tables are ~10 MB / ~90k keys per build. Loading a whole table, the CIG
// table, the base build and the TM into one worker and hashing every string costs several seconds of
// CPU and far more than the edge runtime allows, so a tick died with 546 and repeated the same work
// forever. What a slice does with its shards is in _rows.ts. Pure of Deno and of the state machine:
// only a Store comes in.

import { indexKey, isLocaleIndex, MISC_GROUP, shardFor, shardKey } from '../ingest-catalog/_locale-shards.ts';
import type { LocaleIndex } from '../ingest-catalog/_locale-shards.ts';
import { inPool } from './_io.ts';
import type { Store } from './_io.ts';

/**
 * English shards per slice (~600 keys each). Measured on production (2026-11-17): a slice of 8 costs 150-450 ms CPU
 * and 22-28 MB. A request must stay well under one second of CPU (the platform retires a worker at about one and
 * kills it at about two, and a request may land on a worker that is nearly spent), so 8 is the size; measure again
 * before changing it (docs/translation/OPERATIONS.md). A change mid-job is safe: a walk that finds a file of the
 * old size missing starts over.
 */
export const SCAN_SHARDS = 8;

/** One build's table for one language, read shard by shard. */
export interface TableReader {
  index: LocaleIndex | null;
  names(): string[];
  shard(name: string): Promise<Record<string, string>>;
  get(key: string): Promise<string | undefined>;
  /** The values of these keys (only the keys the table has): each shard is read once, then looked up. */
  many(keys: string[]): Promise<Record<string, string>>;
}

const SHARD_READS = 12;

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
      const s = await shard(shardFor(index, key));
      return Object.hasOwn(s, key) ? s[key] : undefined;
    },
    async many(keys) {
      const out: Record<string, string> = {};
      if (!index) return out;
      const byShard = new Map<string, string[]>();
      for (const k of keys) {
        const name = shardFor(index, k);
        const list = byShard.get(name);
        if (list) list.push(k);
        else byShard.set(name, [k]);
      }
      await inPool([...byShard], SHARD_READS, async ([name, ks]) => {
        const s = await shard(name);
        for (const k of ks) if (Object.hasOwn(s, k)) out[k] = s[k];
      });
      return out;
    },
  };
}
