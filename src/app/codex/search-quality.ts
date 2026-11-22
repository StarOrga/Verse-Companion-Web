// Match quality of a search term against a record's names — pure, framework-free.
// -----------------------------------------------------------------------------
// `searchScore` (codex-search) answers "how well does the NAME match" in five
// coarse steps; the search panel needs finer ones to order rows AND groups
// (admin feedback #395: "liber" put "Interner Tank" — a class-name-only hit —
// above "INTK ANVL Liberator", and the group with the exact ship sat third).
//
// The scale is 0..100 with gaps of at least 10 between the real-match tiers, so
// the small group bonuses of search-rank.ts (size hierarchy + context, together
// < 10) can only ever break ties inside a tier, never lift a weaker tier over a
// stronger one. Fuzzy (typo) matches stay strictly below every real match.
//
// Cost: runs per hit per keystroke over a few dozen hits. Names are normalised
// once per string (memo), the edit distance is bounded and exits early.

import { normalizeSearch, searchScore, searchTokens } from './codex-search';

/** The quality tiers. Higher is better. */
export const MATCH = {
  /** The name (or the name without its maker) equals the term. */
  exact: 100,
  /** The class name equals the term ("aegs_gladius"). */
  exactId: 90,
  /** The name (or class name) starts with the term. */
  prefix: 80,
  /** Every term word is a whole word of the name ("liberator" in "INTK ANVL Liberator"). */
  word: 70,
  /** The term starts a word of the name ("liber" in "INTK ANVL Liberator"). */
  wordPrefix: 60,
  /** Every term word starts a word of the name, not in a row ("liberator anvil"). */
  tokens: 55,
  /** The name contains the term somewhere. */
  substring: 45,
  /** Only the class name contains it. */
  idOnly: 30,
  /** Best typo match (one edit); every further edit costs FUZZY_STEP down to FUZZY_MIN. */
  fuzzy: 20,
  none: 0,
} as const;

const FUZZY_STEP = 3;
const FUZZY_MIN = 8;
/** Shorter term words must match exactly — "ar" one edit away matches half the catalog. */
const FUZZY_MIN_TOKEN = 4;

/** Edits a term word of this length may be away from a name word (scaled to length). */
export function maxEdits(length: number): number {
  if (length < FUZZY_MIN_TOKEN) return 0;
  if (length <= 5) return 1;
  if (length <= 8) return 2;
  return 3;
}

/**
 * Damerau-Levenshtein distance (optimal string alignment: insert, delete,
 * substitute, swap two neighbours), or `max + 1` as soon as it must exceed `max`.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

const WORD_SPLIT = /[\s\-_/.,;:()'"]+/;
const wordMemo = new Map<string, readonly string[]>();
const WORD_MEMO_MAX = 4000;

/** The normalised words of a name, memoised (names repeat on every keystroke). */
export function nameWords(name: string): readonly string[] {
  let w = wordMemo.get(name);
  if (!w) {
    if (wordMemo.size >= WORD_MEMO_MAX) wordMemo.clear();
    w = normalizeSearch(name).split(WORD_SPLIT).filter(Boolean);
    wordMemo.set(name, w);
  }
  return w;
}

/** Fewest edits between a term word and a name word or its start (typing in progress); -1 when out of reach. */
function tokenEdits(token: string, words: readonly string[]): number {
  const max = maxEdits(token.length);
  if (max === 0) return words.some((w) => w.startsWith(token)) ? 0 : -1;
  let best = max + 1;
  for (const w of words) {
    if (w.startsWith(token)) return 0;
    best = Math.min(best, boundedEditDistance(token, w, max));
    // "libera" mistyped as "lbiera": compare with the word's start of the same length (+1: it is unfinished).
    if (w.length > token.length) best = Math.min(best, boundedEditDistance(token, w.slice(0, token.length), max) + 1);
    if (best === 0) return 0;
  }
  return best <= max ? best : -1;
}

/**
 * Typo-tolerant quality: every term word must be within its edit budget of a
 * name word. Always below {@link MATCH.idOnly}; {@link MATCH.none} when a word is out of reach.
 */
export function fuzzyQuality(term: string, names: readonly (string | null | undefined)[]): number {
  const tokens = searchTokens(term).map((t) => t.replace(/\*/g, '')).filter(Boolean);
  if (!tokens.length) return MATCH.none;
  const words = names.flatMap((n) => (n ? nameWords(n) : []));
  if (!words.length) return MATCH.none;
  let edits = 0;
  for (const t of tokens) {
    const d = tokenEdits(t, words);
    if (d < 0) return MATCH.none;
    edits += d;
  }
  if (edits === 0) return MATCH.fuzzy; // every word found, only not in a way the tiers above name
  return Math.max(FUZZY_MIN, MATCH.fuzzy - FUZZY_STEP * (edits - 1));
}

/** True when every term word equals a whole word of one of the names. */
function wholeWords(term: string, names: readonly (string | null | undefined)[]): boolean {
  const tokens = searchTokens(term);
  return tokens.length > 0 && names.some((n) => {
    if (!n) return false;
    const words = nameWords(n);
    return tokens.every((t) => words.includes(t));
  });
}

/** True when every term word starts some word of one of the names (any order). */
function tokensStartWords(term: string, names: readonly (string | null | undefined)[]): boolean {
  const tokens = searchTokens(term);
  return tokens.length > 1 && names.some((n) => {
    if (!n) return false;
    const words = nameWords(n);
    return tokens.every((t) => words.some((w) => w.startsWith(t)));
  });
}

/**
 * How well `term` answers a record (see {@link MATCH}). `names` are display
 * names (any language, with and without the maker), `ids` technical class
 * names: they only count fully for an exact or prefix hit.
 */
export function termQuality(
  term: string,
  names: readonly (string | null | undefined)[],
  ids: readonly (string | null | undefined)[] = [],
): number {
  if (!normalizeSearch(term).replace(/\*/g, '')) return MATCH.none;
  const byName = searchScore(term, ...names);
  if (byName === 4) return MATCH.exact;
  const byId = searchScore(term, ...ids);
  if (byId === 4) return MATCH.exactId;
  if (byName === 3 || byId === 3) return MATCH.prefix;
  if (byName === 2) return wholeWords(term, names) ? MATCH.word : MATCH.wordPrefix;
  if (tokensStartWords(term, names)) return MATCH.tokens;
  if (byName === 1) return MATCH.substring;
  if (byId >= 1) return MATCH.idOnly;
  return fuzzyQuality(term, names);
}

/** The coarse 0..4 `searchScore` of a record mapped onto the quality scale (own rows, sources). */
export function qualityOfScore(score: number): number {
  return [MATCH.none, MATCH.substring, MATCH.wordPrefix, MATCH.prefix, MATCH.exact][Math.max(0, Math.min(4, score))];
}
