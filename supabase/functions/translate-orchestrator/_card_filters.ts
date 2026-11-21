// Pre-filters that run before anything becomes an admin card (concept 20261121-1151-karteikarten-neu,
// checklist P1–P6). Pure functions, no I/O, no AI call — `_cards.ts` wires them into card creation.
//
//   P2 stripForeignBrackets  "(Aegis Idris)" that the English source does not contain is cut off
//   P1 spellingPattern       candidates that differ only by case / hyphen / whitespace → one convention
//   P4 verbFormPattern,      imperative vs infinitive on buttons, abbreviation vs spelled out
//      abbreviationPattern   → one convention question per pattern
//   P3 clearMajority         ≥ 5 votes and ≥ 4 : 1 decides without a card (logged, vetoable)
//   P5 disagreementDoubt,    the doubt value ranks again instead of sitting at 1.0
//      recomputeDoubt
//   P6 kiDecide              tie-break for languages nobody judges: clear majority → community → AI
//
// Order inside `classifyPair`: P2, then P1, then P4, then P3. Spelling and pattern questions come before
// the majority, so one convention answer keeps a language consistent instead of each string following
// its own vote count.

export type PatternId = 'case.upper' | 'case.title' | 'compound' | 'verb.form' | 'abbr';
export const PATTERNS: readonly PatternId[] = ['case.upper', 'case.title', 'compound', 'verb.form', 'abbr'];

export interface Candidate {
  text: string;
  /** 'ai' | 'community:<src>' | 'cig' | 'admin' | 'mined' | 'glossary' */
  source: string;
  votes?: number;
}

export type ResolvedBasis = 'bracket' | 'whitespace' | 'casing_source' | 'majority';

export type Classification =
  | { type: 'resolved'; choice: 'a' | 'b' | 'own'; text: string; basis: ResolvedBasis; votes?: [number, number] }
  | { type: 'convention'; pattern: PatternId; /** option a / option b of the pattern, as this pair writes them */ a: string; b: string; /** true when candidate b of the pair is option a of the pattern */ swapped: boolean }
  | { type: 'card'; a: string; b: string; stripped: boolean };

// ── helpers ──────────────────────────────────────────────────────────────────

export const collapseWs = (s: string) => s.replace(/\s+/g, ' ').trim();
const letters = (s: string) => s.replace(/[^\p{L}]/gu, '');

/** At least two letters, all of them upper case (scripts without case never count). */
export function isAllCaps(s: string): boolean {
  const l = letters(s);
  return l.length >= 2 && l === l.toUpperCase() && l !== l.toLowerCase();
}

const fold = (s: string) => s.toLocaleLowerCase().replace(/[\s\-‐‑–_]+/g, '');
const upperCount = (s: string) => [...s].filter((ch) => ch !== ch.toLowerCase()).length;

// ── P2 ───────────────────────────────────────────────────────────────────────

/**
 * Cuts bracketed additions whose content does not occur in the English source: "Propulsore principale
 * (Aegis Idris)" for "Main Thruster" → "Propulsore principale". Only groups with a letter are touched,
 * so tokens such as "[%s]" or "(1)" stay; a group the source has ("(Lv. 2)" in "Lv. 2") stays too.
 */
export function stripForeignBrackets(text: string, en: string): string {
  const src = en.toLocaleLowerCase();
  const cut = (_m: string, inner: string) => (src.includes(inner.trim().toLocaleLowerCase()) ? _m : '');
  const out = text
    .replace(/\s*\(([^()]*\p{L}[^()]*)\)/gu, (m, inner) => cut(m, inner))
    .replace(/\s*\[([^[\]]*\p{L}[^[\]]*)\]/gu, (m, inner) => (/[~%<>{}]/.test(inner) ? m : cut(m, inner)));
  return out === text ? text : out.replace(/ {2,}/g, ' ').trim();
}

// ── P1 ───────────────────────────────────────────────────────────────────────

/**
 * Spelling-only difference of two candidates. 'whitespace' = only runs of spaces differ (no question,
 * the collapsed form wins); 'source' = one side is all caps like the English (no question, follow it).
 * Option a of every pattern is the form closer to plain writing: normal case, fewer capitals, the
 * joined compound.
 */
export function spellingPattern(a: string, b: string, en: string):
  | { pattern: PatternId; optA: 'a' | 'b' }
  | { pattern: 'whitespace' | 'source'; pick: 'a' | 'b' }
  | null {
  if (a === b) return null;
  if (collapseWs(a) === collapseWs(b)) return { pattern: 'whitespace', pick: a === collapseWs(a) ? 'a' : 'b' };
  if (fold(a) !== fold(b)) return null;
  const ua = isAllCaps(a);
  const ub = isAllCaps(b);
  if (ua !== ub) {
    if (isAllCaps(en)) return { pattern: 'source', pick: ua ? 'a' : 'b' };
    return { pattern: 'case.upper', optA: ua ? 'b' : 'a' };
  }
  const sameCase = a.toLocaleLowerCase() === b.toLocaleLowerCase();
  if (sameCase) return { pattern: 'case.title', optA: upperCount(a) <= upperCount(b) ? 'a' : 'b' };
  // Hyphen / space split (with or without case on top): the joined form is option a.
  const joined = (s: string) => (s.match(/[\s\-‐‑–_]/g) ?? []).length;
  return { pattern: 'compound', optA: joined(a) <= joined(b) ? 'a' : 'b' };
}

// ── P4 ───────────────────────────────────────────────────────────────────────

/** Infinitive endings per language (last word). Languages without a reliable ending are left out. */
const INFINITIVE: Record<string, RegExp> = {
  it: /(are|ere|ire)$/i,
  'pt-BR': /(ar|er|ir)$/i,
  ru: /(ть|ться|ти)$/i,
};

const lastWord = (s: string) => collapseWs(s).split(' ').pop() ?? '';
const commonPrefix = (x: string, y: string) => {
  let i = 0;
  while (i < x.length && i < y.length && x[i].toLowerCase() === y[i].toLowerCase()) i++;
  return i;
};

/**
 * Imperative vs infinitive on a short label ("Annulla" / "Annullare", "Confirma" / "Confirmar").
 * Option a = the imperative (the button form), option b = the infinitive.
 */
export function verbFormPattern(a: string, b: string, lang: string): { pattern: 'verb.form'; optA: 'a' | 'b' } | null {
  const inf = INFINITIVE[lang];
  if (!inf) return null;
  if (collapseWs(a).split(' ').length > 3 || collapseWs(b).split(' ').length > 3) return null;
  const wa = lastWord(a);
  const wb = lastWord(b);
  const ia = inf.test(wa);
  const ib = inf.test(wb);
  if (ia === ib) return null;
  const [infW, other] = ia ? [wa, wb] : [wb, wa];
  if (other.length > infW.length) return null;
  if (commonPrefix(infW, other) < Math.max(4, other.length - 2)) return null;
  return { pattern: 'verb.form', optA: ia ? 'b' : 'a' };
}

/**
 * Abbreviation vs spelled out: the English has an upper-case token of 2–4 letters ("XO Quarters"),
 * one candidate keeps it ("XO-Quartiere"), the other spells it out ("Quartiere des Ersten Offiziers").
 * Option a = the abbreviation.
 */
export function abbreviationPattern(a: string, b: string, en: string): { pattern: 'abbr'; optA: 'a' | 'b' } | null {
  const tokens = en.match(/\b[A-Z]{2,4}\b/g) ?? [];
  for (const t of tokens) {
    const re = new RegExp(`(^|[^\\p{L}])${t}($|[^\\p{L}])`, 'u');
    const ha = re.test(a);
    const hb = re.test(b);
    if (ha === hb) continue;
    const [withT, without] = ha ? [a, b] : [b, a];
    if (without.length > withT.length) return { pattern: 'abbr', optA: ha ? 'a' : 'b' };
  }
  return null;
}

// ── P3 ───────────────────────────────────────────────────────────────────────

export const MAJORITY_MIN_VOTES = 5;
export const MAJORITY_RATIO = 4;

/** ≥ 5 votes in total and ≥ 4 : 1 → that side; else null. */
export function clearMajority(av: number, bv: number): 'a' | 'b' | null {
  const a = Math.max(0, Number(av) || 0);
  const b = Math.max(0, Number(bv) || 0);
  if (a + b < MAJORITY_MIN_VOTES) return null;
  if (a > b && a >= MAJORITY_RATIO * b) return 'a';
  if (b > a && b >= MAJORITY_RATIO * a) return 'b';
  return null;
}

// ── classify ─────────────────────────────────────────────────────────────────

/** Runs P2, P1, P4, P3 on one pair of candidates. */
export function classifyPair(i: { lang: string; en: string; a: Candidate; b: Candidate }): Classification {
  const sa = stripForeignBrackets(i.a.text, i.en);
  const sb = stripForeignBrackets(i.b.text, i.en);
  const stripped = sa !== i.a.text || sb !== i.b.text;
  if (sa === sb) {
    const choice = sa === i.a.text ? 'a' : sa === i.b.text ? 'b' : 'own';
    return { type: 'resolved', choice, text: sa, basis: 'bracket' };
  }
  const sp = spellingPattern(sa, sb, i.en);
  if (sp && (sp.pattern === 'whitespace' || sp.pattern === 'source')) {
    const pick = (sp as { pick: 'a' | 'b' }).pick;
    const text = pick === 'a' ? sa : sb;
    const choice = text === (pick === 'a' ? i.a.text : i.b.text) ? pick : 'own';
    return { type: 'resolved', choice, text: sp.pattern === 'whitespace' ? collapseWs(text) : text, basis: sp.pattern === 'whitespace' ? 'whitespace' : 'casing_source' };
  }
  const pat = (sp as { pattern: PatternId; optA: 'a' | 'b' } | null) ?? verbFormPattern(sa, sb, i.lang) ?? abbreviationPattern(sa, sb, i.en);
  if (pat) {
    const swapped = pat.optA === 'b';
    return { type: 'convention', pattern: pat.pattern, a: swapped ? sb : sa, b: swapped ? sa : sb, swapped };
  }
  if (i.a.votes != null && i.b.votes != null) {
    const m = clearMajority(i.a.votes, i.b.votes);
    if (m) {
      const text = m === 'a' ? sa : sb;
      const orig = m === 'a' ? i.a.text : i.b.text;
      return { type: 'resolved', choice: text === orig ? m : 'own', text, basis: 'majority', votes: [i.a.votes, i.b.votes] };
    }
  }
  return { type: 'card', a: sa, b: sb, stripped };
}

// ── P5 ───────────────────────────────────────────────────────────────────────

/**
 * Doubt when the two judge orders picked opposite sides. It used to be 1.0 every time, so nothing ranked.
 * Now: 0.5 + a quarter of each order's confidence — two confident opposite verdicts (truly contested) rank
 * above two shrugs. Range 0.5..1.
 */
export function disagreementDoubt(cf: number, cr: number): number {
  const c = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5);
  return Math.round((0.5 + 0.25 * (c(cf) + c(cr))) * 1000) / 1000;
}

/** Normalised edit distance 0..1 (texts cut at 300 chars). */
export function textDistance(x: string, y: string): number {
  const a = x.slice(0, 300);
  const b = y.slice(0, 300);
  if (!a.length && !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}

/**
 * Doubt for a card without stored judge confidences (the existing cards, P14): vote closeness where
 * votes exist (13:13 → 1, 13:1 → low), else how far the two texts are apart (a one-letter difference is
 * a small question, two different wordings a big one). Range 0.05..1.
 */
export function recomputeDoubt(c: { a: Candidate; b: Candidate; judge?: { f?: number; r?: number } | null }): number {
  if (c.judge && Number.isFinite(c.judge.f) && Number.isFinite(c.judge.r)) return disagreementDoubt(c.judge.f!, c.judge.r!);
  const av = c.a.votes;
  const bv = c.b.votes;
  if (av != null && bv != null && av + bv > 0) return Math.max(0.05, Math.round((1 - Math.abs(av - bv) / (av + bv)) * 1000) / 1000);
  return Math.max(0.05, Math.round((0.5 + 0.5 * textDistance(c.a.text, c.b.text)) * 1000) / 1000);
}

// ── P6 ───────────────────────────────────────────────────────────────────────

export type KiBasis = 'majority' | 'community' | 'ai' | 'votes' | ResolvedBasis | 'only_left' | 'convention';

export interface KiDecision {
  choice: 'a' | 'b' | 'own';
  text: string;
  basis: KiBasis;
  unsure: boolean;
  /** Reason as a code + numbers; the UI renders it from i18n (`reason.<code>`). */
  reason: { code: KiBasis; a?: number; b?: number };
}

/** Doubt above this marks a community/AI pick as unsure. */
export const UNSURE_DOUBT = 0.85;

const isCommunity = (s: string) => s === 'community' || s.startsWith('community:');

/**
 * P6 fixed order when no human decides: clear majority, then the community text, then the AI text.
 * Two mined candidates without a clear majority fall back to the higher vote count (unsure).
 * `vetoed` = options an admin flagged with „Sieht falsch aus“: they never win again; with both gone
 * the decision is null (the card is parked).
 */
export function kiDecide(c: { a: Candidate; b: Candidate; doubt: number; vetoed?: ('a' | 'b' | 'own')[] }): KiDecision | null {
  const out = new Set(c.vetoed ?? []);
  const left = (['a', 'b'] as const).filter((s) => !out.has(s));
  if (!left.length) return null;
  const opt = (s: 'a' | 'b') => (s === 'a' ? c.a : c.b);
  if (left.length === 1) {
    return { choice: left[0], text: opt(left[0]).text, basis: 'only_left', unsure: true, reason: { code: 'only_left' } };
  }
  const av = c.a.votes;
  const bv = c.b.votes;
  if (av != null && bv != null) {
    const m = clearMajority(av, bv);
    if (m) return { choice: m, text: opt(m).text, basis: 'majority', unsure: false, reason: { code: 'majority', a: av, b: bv } };
  }
  const high = c.doubt >= UNSURE_DOUBT;
  const ca = isCommunity(c.a.source);
  const cb = isCommunity(c.b.source);
  if (ca !== cb) {
    const s = ca ? 'a' : 'b';
    return { choice: s, text: opt(s).text, basis: 'community', unsure: high, reason: { code: 'community' } };
  }
  const aa = c.a.source === 'ai';
  const ab = c.b.source === 'ai';
  if (aa !== ab) {
    const s = aa ? 'a' : 'b';
    return { choice: s, text: opt(s).text, basis: 'ai', unsure: true, reason: { code: 'ai' } };
  }
  const s = (bv ?? 0) > (av ?? 0) ? 'b' : 'a';
  return { choice: s, text: opt(s).text, basis: 'votes', unsure: true, reason: { code: 'votes', a: av ?? 0, b: bv ?? 0 } };
}

/**
 * KI decision for a convention card ("Nicht meine Entscheidung" on a pattern question): the members carry the
 * candidates the pairs came from, so the evidence is how many members have a community text on each side.
 * Same order as `kiDecide` (clear majority, else the higher count, unsure); a tie with no evidence picks a, unsure.
 */
export function conventionDecide(
  members: ConventionMember[], vetoed: ('a' | 'b' | 'own')[], aText: string, bText: string,
): KiDecision | null {
  const side = (s: 'a' | 'b') => members.filter((m) => {
    const e = m.entries?.[s] as { o?: string } | null | undefined;
    return e?.o === 'community';
  }).length;
  return kiDecide({
    a: { text: aText, source: 'pattern', votes: side('a') },
    b: { text: bText, source: 'pattern', votes: side('b') },
    doubt: 1, vetoed,
  });
}

// ── P10 examples ─────────────────────────────────────────────────────────────

export interface CardExample {
  lang: string;
  key: string;
  en: string;
  text: string;
}

export const EXAMPLES_PER_OPTION = 3;

/** Case-preserving replace of the first `from` in `t` (exact match first, then case-insensitive). */
function applyTerm(t: string, from: string, to: string): string | null {
  const i = t.indexOf(from);
  if (i >= 0) return t.slice(0, i) + to + t.slice(i + from.length);
  const j = t.toLocaleLowerCase().indexOf(from.toLocaleLowerCase());
  return j >= 0 ? t.slice(0, j) + to + t.slice(j + from.length) : null;
}

/**
 * Three example strings per option of a term card, each with that option applied: lines that already
 * use the option first, then lines with the other option rewritten. Fewer only when fewer lines exist.
 */
export function termExamples(
  lang: string, lines: { key?: string; k?: string; en: string; t: string }[], a: string, b: string,
): { a: CardExample[]; b: CardExample[] } {
  const side = (mine: string, other: string): CardExample[] => {
    const out: CardExample[] = [];
    const seen = new Set<string>();
    const push = (l: { key?: string; k?: string; en: string }, text: string) => {
      const key = l.key ?? l.k ?? '';
      if (out.length >= EXAMPLES_PER_OPTION || seen.has(text)) return;
      seen.add(text);
      out.push({ lang, key, en: l.en, text });
    };
    for (const l of lines) if (l.t.includes(mine)) push(l, l.t);
    for (const l of lines) {
      const r = applyTerm(l.t, other, mine);
      if (r) push(l, r);
    }
    return out;
  };
  return { a: side(a, b), b: side(b, a) };
}

export interface ConventionMember {
  lang: string;
  key: string;
  en: string;
  /** Text of the member with option a / option b of the pattern applied. */
  a: string;
  b: string;
  /** 'tm' = one string (h + both TM entries), 'term' = a glossary term. */
  type: 'tm' | 'term';
  h?: string;
  term?: string;
  entries?: { a: unknown; b: unknown };
}

/** Three examples per option of a convention card, spread over as many languages as possible. */
export function conventionExamples(members: ConventionMember[]): { a: CardExample[]; b: CardExample[] } {
  const byLang = new Map<string, ConventionMember[]>();
  for (const m of members) byLang.set(m.lang, [...(byLang.get(m.lang) ?? []), m]);
  const order: ConventionMember[] = [];
  const queues = [...byLang.values()].map((q) => [...q]);
  while (order.length < EXAMPLES_PER_OPTION && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && order.length < EXAMPLES_PER_OPTION) order.push(q.shift()!);
  }
  const ex = (side: 'a' | 'b') => order.map((m) => ({ lang: m.lang, key: m.key, en: m.en, text: m[side] }));
  return { a: ex('a'), b: ex('b') };
}

/** Members of one convention merged (one per lang + key, the newer wins). */
export function mergeMembers(have: ConventionMember[], add: ConventionMember[], cap = 1000): ConventionMember[] {
  const m = new Map(have.map((x) => [`${x.lang}\u0000${x.key}`, x]));
  for (const x of add) m.set(`${x.lang}\u0000${x.key}`, x);
  return [...m.values()].slice(0, cap);
}

/** The text a convention answer gives one member: the chosen side, or the language's exception. */
export function conventionPick(answer: 'a' | 'b', exceptions: Record<string, 'a' | 'b'> | null | undefined, lang: string): 'a' | 'b' {
  const e = exceptions?.[lang];
  return e === 'a' || e === 'b' ? e : answer;
}
