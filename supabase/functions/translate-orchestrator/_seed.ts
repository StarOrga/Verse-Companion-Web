// Community-seed filter (pure): which pack lines become TM entries (concept 2026-11-08, A4).
// Precedence: admin > CIG (blind) > community vs AI (the arbiter decides conflicts, never this file).
//
// Two steps, so an import can run in slices: `seedCandidates` collects, per English text, the votes of
// the keys that carry it (a slice of the table at a time), `decideSeed` turns merged candidates into TM
// writes and conflicts. `seedEntries` is both in one go.

import { isCigValid, sha256Hex } from './_diff.ts';
import type { TmEntry } from './_diff.ts';
import { sameMultiset, tokensOf } from './_mask.ts';
import { normalizeKey } from './_pack.ts';

export interface SeedConflict {
  key: string;
  h: string;
  en: string;
  incumbent: TmEntry;
  challenger: TmEntry;
}

export interface SeedCounts {
  /** English keys looked at (non-blank). */
  keys: number;
  /** Keys CIG translates validly: the pack is irrelevant there. */
  skipped_cig: number;
  /** Pack value blank, identical to English or a `NOT FOUND` marker. */
  skipped_same: number;
  /** Key absent from the pack. */
  missing: number;
  /** Placeholder multiset differs from English. */
  rejected_qa: number;
  /** Distinct English texts that got / refreshed a TM entry. */
  imported: number;
  /** Distinct English texts whose TM entry already holds exactly this text. */
  unchanged: number;
  /** Distinct English texts that go to the arbiter. */
  conflicts: number;
  /** Distinct English texts protected by an admin entry. */
  admin_kept: number;
  /** Distinct English texts where CIG's own (TM) translation stays. */
  cig_kept: number;
}

/** The counts that are per key (they add up across slices). */
export type KeyCounts = Pick<SeedCounts, 'keys' | 'skipped_cig' | 'skipped_same' | 'missing' | 'rejected_qa'>;
/** The counts that are per distinct English text (known once the candidates are merged). */
export type TextCounts = Pick<SeedCounts, 'imported' | 'unchanged' | 'conflicts' | 'admin_kept' | 'cig_kept'>;

export const emptySeedCounts = (): SeedCounts => ({
  keys: 0, skipped_cig: 0, skipped_same: 0, missing: 0, rejected_qa: 0,
  imported: 0, unchanged: 0, conflicts: 0, admin_kept: 0, cig_kept: 0,
});

export function addCounts<T extends Partial<SeedCounts>>(into: SeedCounts, part: T): SeedCounts {
  for (const [k, n] of Object.entries(part) as [keyof SeedCounts, number][]) into[k] = (into[k] ?? 0) + (n ?? 0);
  return into;
}

export interface SeedResult {
  updates: Record<string, TmEntry>;
  conflicts: SeedConflict[];
  counts: SeedCounts;
}

export type PackLookup = Map<string, string> | Record<string, string> | ((normalizedKey: string) => string | undefined);

export interface SeedInput {
  en: Record<string, string>;
  cig: Record<string, string>;
  pack: PackLookup;
  sourceId: string;
  lic: string;
  at: string;
  /** Existing translation memory of the language (hash → entry). */
  tm?: Record<string, TmEntry>;
  hash?: (s: string) => Promise<string>;
}

/** Pack lines that are not a translation: blank, the English itself, `! … NOT FOUND` markers. */
export function isPackNoise(en: string, v: string): boolean {
  if (!v.trim() || v === en) return true;
  if (v.startsWith('! ') || /TRANSLATION NOT FOUND/i.test(v)) return true;
  return false;
}

/** Placeholder multiset of the pack value must equal the English one (QA gate, `_mask.ts`). */
export function placeholdersMatch(en: string, v: string): boolean {
  return sameMultiset(tokensOf(en), tokensOf(v)) && !/[\r\n]/.test(v);
}

/** One translation of an English text: how many keys carry it and the smallest of them. */
export interface SeedVote {
  v: string;
  n: number;
  k: string;
}

/** One TM slot: an English text with the votes of its keys. `key` is the smallest key carrying it. */
export interface SeedCand {
  h: string;
  en: string;
  key: string;
  votes: SeedVote[];
}

/** Folds candidates of several slices into one per English text (votes add up, the smallest key stays). */
export function mergeSeedCands(parts: SeedCand[][]): SeedCand[] {
  const by = new Map<string, { en: string; key: string; votes: Map<string, SeedVote> }>();
  for (const part of parts) {
    for (const c of part) {
      let m = by.get(c.h);
      if (!m) by.set(c.h, (m = { en: c.en, key: c.key, votes: new Map() }));
      else if (c.key < m.key) m.key = c.key;
      for (const v of c.votes) {
        const have = m.votes.get(v.v);
        if (!have) m.votes.set(v.v, { ...v });
        else {
          have.n += v.n;
          if (v.k < have.k) have.k = v.k;
        }
      }
    }
  }
  return [...by].map(([h, m]) => ({ h, en: m.en, key: m.key, votes: [...m.votes.values()] }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export async function seedCandidates(
  input: Pick<SeedInput, 'en' | 'cig' | 'pack' | 'hash'>,
): Promise<{ cands: SeedCand[]; counts: KeyCounts }> {
  const hash = input.hash ?? sha256Hex;
  const pack = input.pack;
  const get = typeof pack === 'function' ? pack : pack instanceof Map
    ? (k: string) => pack.get(k)
    : (k: string) => (Object.hasOwn(pack, k) ? pack[k] : undefined);
  const counts: KeyCounts = { keys: 0, skipped_cig: 0, skipped_same: 0, missing: 0, rejected_qa: 0 };
  const one: SeedCand[] = [];
  const cache = new Map<string, string>();

  for (const key of Object.keys(input.en).sort()) {
    const en = input.en[key];
    if (!en || !en.trim()) continue;
    counts.keys++;
    if (isCigValid(en, input.cig[key])) {
      counts.skipped_cig++;
      continue;
    }
    const v = get(normalizeKey(key));
    if (v === undefined) {
      counts.missing++;
      continue;
    }
    if (isPackNoise(en, v)) {
      counts.skipped_same++;
      continue;
    }
    if (!placeholdersMatch(en, v)) {
      counts.rejected_qa++;
      continue;
    }
    let h = cache.get(en);
    if (!h) cache.set(en, (h = await hash(en)));
    one.push({ h, en, key, votes: [{ v, n: 1, k: key }] });
  }
  return { cands: mergeSeedCands([one]), counts };
}

/** Merged candidates against the TM: what to write, what the arbiter must decide. */
export function decideSeed(
  cands: SeedCand[], tm: Record<string, TmEntry>, src: { sourceId: string; lic: string; at: string },
): { updates: Record<string, TmEntry>; conflicts: SeedConflict[]; counts: TextCounts } {
  const counts: TextCounts = { imported: 0, unchanged: 0, conflicts: 0, admin_kept: 0, cig_kept: 0 };
  const updates: Record<string, TmEntry> = {};
  const conflicts: SeedConflict[] = [];
  for (const c of cands) {
    // Most frequent translation among the keys sharing this English; ties keep the one seen first (smallest key).
    let best: SeedVote | null = null;
    for (const v of c.votes) if (!best || v.n > best.n || (v.n === best.n && v.k < best.k)) best = v;
    if (!best) continue;
    const t = best.v;
    const challenger: TmEntry = { t, o: 'community', src: src.sourceId, lic: src.lic, at: src.at };
    const inc = Object.hasOwn(tm, c.h) ? tm[c.h] : undefined;
    if (!inc) {
      updates[c.h] = challenger;
      counts.imported++;
    } else if (inc.o === 'admin') counts.admin_kept++;
    else if (inc.o === 'cig') counts.cig_kept++;
    else if (inc.t === t) counts.unchanged++;
    else if (inc.o === 'community' && inc.src === src.sourceId) {
      // The same source changed its own text: a refresh, not a dispute.
      updates[c.h] = challenger;
      counts.imported++;
    } else {
      conflicts.push({ key: c.key, h: c.h, en: c.en, incumbent: inc, challenger });
      counts.conflicts++;
    }
  }
  return { updates, conflicts, counts };
}

export async function seedEntries(input: SeedInput): Promise<SeedResult> {
  const { cands, counts: perKey } = await seedCandidates(input);
  const d = decideSeed(cands, input.tm ?? {}, input);
  return { updates: d.updates, conflicts: d.conflicts, counts: { ...perKey, ...d.counts } };
}

/** Share (0..100, one decimal) of the non-blank English keys the pack really translates. */
export function packTextPct(translated: number, keys: number): number {
  return keys ? Math.round((translated / keys) * 1000) / 10 : 0;
}
