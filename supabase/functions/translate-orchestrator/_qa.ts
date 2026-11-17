// QA gates for one translated string (contract § QA gates).

import { maskedOutputOk, unmask } from './_mask.ts';

export interface QaGlossaryRow {
  source_term: string;
  target_term: string;
  category: 'term' | 'label' | 'unit' | 'dnt' | string;
  origin: 'cig' | 'ai' | 'admin' | string;
  locked?: boolean;
}

export interface QaResult {
  ok: boolean;
  /** The output with tokens restored (meaningful even when not ok). */
  text: string;
  /** Stable reason codes: empty · tokens · newline · glossary:<term> · too_long · url */
  reasons: string[];
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const SHORT_MAX = 40;
const RATIO_MAX = 1.4;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive, unicode-boundary match of a whole term. */
export function containsTerm(text: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Inflection-tolerant: the target without up to 2 trailing letters must appear. */
export function containsStem(text: string, target: string): boolean {
  const t = target.toLowerCase();
  const stem = t.length > 5 ? t.slice(0, t.length - 2) : t;
  return text.toLowerCase().includes(stem);
}

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/**
 * A glossary prepared for many strings. Checking a string against every row costs a regular
 * expression per row and string - 3 000 strings against 2 000 rows are six million of them, more
 * than a request has. The index finds the few rows a string can touch: labels by the whole string,
 * terms by their first word (a term that matches as a whole has its first word as a whole word of
 * the text).
 */
export interface QaIndex {
  /** Enforced rows in glossary order, with the position they had. */
  labels: Map<string, { at: number; g: QaGlossaryRow }[]>;
  byToken: Map<string, { at: number; g: QaGlossaryRow; re: RegExp }[]>;
  /** Terms without a letter or digit: checked for every string. */
  loose: { at: number; g: QaGlossaryRow; re: RegExp }[];
}

const termRe = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'iu');

export function qaIndex(glossary: QaGlossaryRow[]): QaIndex {
  const idx: QaIndex = { labels: new Map(), byToken: new Map(), loose: [] };
  glossary.forEach((g, at) => {
    if (!g.source_term || !g.target_term) return;
    // Only entries an admin/CIG put in, or do-not-translate names, are enforced; AI entries are advice.
    const enforced = g.locked || g.origin === 'admin' || g.origin === 'cig' || g.category === 'dnt';
    if (!enforced) return;
    if (g.category === 'label') {
      const k = g.source_term.trim().toLowerCase();
      const list = idx.labels.get(k);
      if (list) list.push({ at, g });
      else idx.labels.set(k, [{ at, g }]);
      return;
    }
    const row = { at, g, re: termRe(g.source_term) };
    const tok = g.source_term.toLowerCase().match(TOKEN_RE)?.[0];
    if (!tok) {
      idx.loose.push(row);
      return;
    }
    const list = idx.byToken.get(tok);
    if (list) list.push(row);
    else idx.byToken.set(tok, [row]);
  });
  return idx;
}

/** Only entries an admin/CIG put in, or do-not-translate names, are enforced; AI entries are advice. */
export function glossaryFailures(en: string, out: string, glossary: QaGlossaryRow[] | QaIndex): string[] {
  const idx = Array.isArray(glossary) ? qaIndex(glossary) : glossary;
  const hits: { at: number; code: string }[] = [];
  // Labels are whole-string pairs ("Item Type:" → "Gegenstand:").
  for (const { at, g } of idx.labels.get(en.trim().toLowerCase()) ?? []) {
    if (out.trim().toLowerCase() !== g.target_term.trim().toLowerCase()) hits.push({ at, code: `glossary:${g.source_term}` });
  }
  const cands: QaIndex['loose'] = [...idx.loose];
  if (idx.byToken.size) {
    for (const tok of new Set(en.toLowerCase().match(TOKEN_RE) ?? [])) {
      const list = idx.byToken.get(tok);
      if (list) for (const r of list) cands.push(r);
    }
  }
  for (const { at, g, re } of cands) {
    if (!re.test(en)) continue;
    const ok = g.category === 'dnt' ? out.toLowerCase().includes(g.target_term.toLowerCase()) : containsStem(out, g.target_term);
    if (!ok) hits.push({ at, code: `glossary:${g.source_term}` });
  }
  // Glossary order, as a walk over the rows would report them.
  return hits.sort((a, b) => a.at - b.at).map((h) => h.code);
}

/**
 * Checks a model output (still masked) against its source. `toks` are the source's
 * original tokens; `en` is the unmasked English. Pass a `qaIndex` when many strings are checked.
 */
export function qaCheck(en: string, outMasked: string, toks: string[], glossary: QaGlossaryRow[] | QaIndex = []): QaResult {
  const reasons: string[] = [];
  const text = unmask(outMasked, toks);
  if (!outMasked.trim()) reasons.push('empty');
  if (/[\r\n]/.test(outMasked)) reasons.push('newline');
  if (!maskedOutputOk(outMasked.replace(/[\r\n]/g, ''), toks)) reasons.push('tokens');
  if (en.length <= SHORT_MAX && text.length > en.length * RATIO_MAX && text.length - en.length >= 3) reasons.push('too_long');
  const srcUrls = new Set((en.match(URL_RE) ?? []).map((u) => u.toLowerCase()));
  for (const u of text.match(URL_RE) ?? []) {
    if (!srcUrls.has(u.toLowerCase())) {
      reasons.push('url');
      break;
    }
  }
  if (!reasons.includes('empty')) reasons.push(...glossaryFailures(en, text, glossary));
  return { ok: reasons.length === 0, text, reasons };
}

/** Plain-language hint for the post-edit prompt. */
export function reasonHint(code: string): string {
  if (code.startsWith('glossary:')) return `use the glossary translation of "${code.slice(9)}" exactly`;
  if (code.startsWith('judge:')) return `a reviewer scored the previous attempt ${code.slice(6)}/10: improve accuracy and natural fluency`;
  switch (code) {
    case 'tokens': return 'copy every ⟦n⟧ placeholder exactly once, unchanged';
    case 'newline': return 'the value must be a single line without line breaks';
    case 'too_long': return 'make it shorter: this is a short UI label';
    case 'url': return 'do not add URLs or markup the source does not contain';
    case 'empty': return 'the previous attempt was empty';
    case 'length_mismatch': return 'return exactly one entry per input string, in input order';
    default: return `previous attempt failed (${code})`;
  }
}
