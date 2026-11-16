/**
 * Typo-tolerant matching for the Akte's "Kaufen" mini search (concept batch-galerie-akte-login-upload, B2.7).
 * Pure: folds case and diacritics, then ranks a haystack against a query by, in order, an exact / prefix /
 * substring hit, a token-wise Damerau-Levenshtein match (one slip per ~4 letters, transpositions count as one)
 * and a trigram Dice overlap as the last resort. Score 0 = no match; higher is better.
 */

/** Lower case, diacritics and punctuation folded away: "Teach’s Ship Shop" -> "teachs ship shop". */
export function foldText(s: string): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Optimal-string-alignment distance (Damerau-Levenshtein with adjacent transpositions), capped by `max`. */
export function osaDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

function dice(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return (2 * hit) / (ta.size + tb.size || 1);
}

/** Allowed edits for a query token: none for 1-3 letters, 1 up to 6, 2 beyond. */
function allowance(len: number): number {
  return len <= 3 ? 0 : len <= 6 ? 1 : 2;
}

/** Score of one query against one haystack text; 0 = no match. */
export function fuzzyScore(query: string, haystack: string): number {
  const q = foldText(query);
  const h = foldText(haystack);
  if (!q) return 1;
  if (!h) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 90;
  if (h.includes(q)) return 80;
  const hTokens = h.split(' ');
  const qTokens = q.split(' ');
  let total = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const ht of hTokens) {
      if (ht.startsWith(qt)) { best = Math.max(best, 60); continue; }
      const allow = allowance(qt.length);
      // A typo may sit in the tail of a longer word the reader has only half typed: compare the prefix too.
      const d = Math.min(osaDistance(qt, ht, allow), osaDistance(qt, ht.slice(0, qt.length), allow));
      if (d <= allow) best = Math.max(best, 50 - d * 10);
    }
    if (best === 0) {
      const d = dice(qt, h);
      if (qt.length >= 4 && d >= 0.5) best = 20 + Math.round(d * 10);
    }
    if (best === 0) return 0;
    total += best;
  }
  return Math.min(79, Math.round(total / qTokens.length));
}

/** The items that match `query`, best first (stable for equal scores); an empty query keeps the order. */
export function fuzzyFilter<T>(query: string, items: readonly T[], text: (item: T) => string): T[] {
  if (!foldText(query)) return [...items];
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.item);
}
