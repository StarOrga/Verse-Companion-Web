// C · The learning step: what it computes. It is asked for after every publish, after every seed
// import / source sync and as a backfill (`op: learn`), and runs as a sliced pass (_learn_pass.ts):
// this file holds the pure parts, the batch requests and the reading of finished batches.
// Everything a slice computes can be merged with the other slices' results (votes add up, the
// smallest key decides a spelling), so the pass gives what one run over the whole table would.
// Token-free first:
//   C1 mine short pairs from the TM + CIG table → term candidates with votes
//   C2 dnt: codex names (manufacturers, ships, locations) kept verbatim in ≥ 90 % of pairs
//   C3 style statistics → translation_languages.style
//   C8 promotion: ≥ promote_min_evidence occurrences and ≥ promote_min_agreement → origin 'mined'
//   B1 terms: community/AI lines whose English has a CIG term but whose target lacks it
// then the cheap LLM steps, each a Message Batch resumed on later ticks:
//   C6 Haiku pre-decision for contested candidates (both orders) → promote, else a card
//   B1 align batch rewrites only the flagged lines with a term hint (CIG lines never change)
//   C7 web research for the top open meta/wording cards, hard monthly cap
// Every write is idempotent (insert-only glossary rows, TM upserts by hash, cards deduped), so a
// re-run after a crash or a second trigger converges instead of duplicating.

import { createCards, termCard } from './_cards.ts';
import type { ApplySummary } from './_cards.ts';
import { arbitrate } from './_arbiter.ts';
import type { ArbiterSummary, PairJudgement } from './_arbiter.ts';
import { bothOrders, hardFailures, PAIR_SCHEMA } from './_arbiter.ts';
import { priceOf } from './_cost.ts';
import type { TmEntry } from './_diff.ts';
import type { JudgeTerm } from './_glossary.ts';
import { saveTm, tmShardKey } from './_io.ts';
import type { Store } from './_io.ts';
import type { CardRow, LearnGlossaryRow, LearnSettings } from './_learn_db.ts';
import {
  adjustKind, hasLearn, jsonParams, learnKey, monthKindSpend, monthOfDate, readLearnBatch, resultJson, spendBlock,
  submitLearnBatch,
} from './_learn_batch.ts';
import type { LearnBatch, LearnDeps } from './_learn_batch.ts';
import type { BatchResult, Deps } from './_machine.ts';
import { tokensOf } from './_mask.ts';
import { glossaryBlock, LANG_NAMES, OUTPUT_SCHEMA } from './_prompt.ts';
import type { BatchParams, GlossaryRow } from './_prompt.ts';
import { containsStem, containsTerm } from './_qa.ts';
import { propagateGlossaryChange, reviseStateFor, shouldReplace } from './_revise.ts';
import type { ReviseState } from './_revise.ts';

export type LearnTrigger = 'publish' | 'seed' | 'sync' | 'backfill';
export type LineOrigin = 'admin' | 'cig' | 'community' | 'ai' | 'judge';

export const HAIKU_MODEL = 'claude-haiku-5-5';
export const WEB_MODEL = 'claude-sonnet-5-5';
const MAX_TERM_WORDS = 4;
export const HAIKU_ITEMS = 150;
const ALIGN_LINES = 400;
export const ALIGN_PER_REQUEST = 30;
const WEB_CARDS = 3;
const WEB_USD_PER_CARD = 0.08;
export const STYLE_MIN_TRUSTED = 200;

// ── pure: mining (C1 / C8) ───────────────────────────────────────────────────

export interface MineLine {
  key: string;
  en: string;
  t: string;
  o: LineOrigin;
}

export interface Variant {
  text: string;
  votes: number;
  by: Partial<Record<LineOrigin, number>>;
}

export interface Candidate {
  source: string;
  /** Variants by lower-cased target. */
  variants: Map<string, Variant>;
  keys: string[];
}

/** A short term: at most 4 words, ≤ 40 chars, a letter, no placeholder, no line break. */
export function isShortTerm(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 40 || /[\r\n]/.test(t) || !/\p{L}/u.test(t)) return false;
  if (tokensOf(t).length) return false;
  return t.split(/\s+/).length <= MAX_TERM_WORDS;
}

/** Judge votes sort after every table line, as the one-pass run appended them last. */
const JUDGE_MARK = String.fromCharCode(0xffff);
const orderOf = (l: Pick<MineLine, 'key' | 'o'>) => (l.o === 'judge' ? JUDGE_MARK + l.key : l.key);

/** One variant of a mined term; `k` is the smallest line that spelled it this way. */
export interface MinedVariant {
  t: string;
  k: string;
  n: number;
  by: Partial<Record<LineOrigin, number>>;
}

/** A mined term as a slice stores it: `k` = smallest line, `keys` = its 20 smallest lines. */
export interface MinedTerm {
  s: string;
  k: string;
  v: MinedVariant[];
  keys: string[];
}

interface AccTerm {
  s: string;
  k: string;
  v: Map<string, MinedVariant>;
  keys: string[];
}
/** Accumulator of mined terms by lower-cased source. Order-independent: any order of lines or parts gives the same result. */
export type MineAcc = Map<string, AccTerm>;

function keepSmallest(keys: string[], more: string[]): string[] {
  if (!more.length) return keys;
  const all = [...new Set([...keys, ...more])].sort();
  return all.length > 20 ? all.slice(0, 20) : all;
}

function addVariant(c: AccTerm, v: MinedVariant): void {
  const vk = v.t.toLowerCase();
  const have = c.v.get(vk);
  if (!have) {
    c.v.set(vk, { t: v.t, k: v.k, n: v.n, by: { ...v.by } });
    return;
  }
  if (v.k < have.k) {
    have.k = v.k;
    have.t = v.t;
  }
  have.n += v.n;
  for (const [o, n] of Object.entries(v.by) as [LineOrigin, number][]) have.by[o] = (have.by[o] ?? 0) + n;
}

/** Folds one slice's (or the judge's) terms into the accumulator. */
export function addMined(acc: MineAcc, terms: MinedTerm[]): MineAcc {
  for (const t of terms) {
    const k = t.s.toLowerCase();
    let c = acc.get(k);
    if (!c) acc.set(k, (c = { s: t.s, k: t.k, v: new Map(), keys: [] }));
    else if (t.k < c.k) {
      c.k = t.k;
      c.s = t.s;
    }
    for (const v of t.v) addVariant(c, v);
    c.keys = keepSmallest(c.keys, t.keys);
  }
  return acc;
}

/** Mines short pairs into mergeable terms (what a slice writes). */
export function mineLines(lines: MineLine[]): MinedTerm[] {
  const acc: MineAcc = new Map();
  for (const l of lines) {
    if (!isShortTerm(l.en) || !l.t.trim() || /[\r\n]/.test(l.t) || l.t.length > 60) continue;
    const ord = orderOf(l);
    addMined(acc, [{ s: l.en.trim(), k: ord, v: [{ t: l.t.trim(), k: ord, n: 1, by: { [l.o]: 1 } }], keys: [ord] }]);
  }
  return [...acc.values()].map((c) => ({ s: c.s, k: c.k, v: [...c.v.values()], keys: c.keys }));
}

const plainKey = (k: string) => (k.startsWith(JUDGE_MARK) ? k.slice(1) : k);

/** Candidates in the order of their first line, as one pass over the sorted table sees them. */
export function candidatesOf(acc: MineAcc): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  for (const [k, c] of [...acc].sort((x, y) => (x[1].k < y[1].k ? -1 : x[1].k > y[1].k ? 1 : 0))) {
    const variants = new Map<string, Variant>();
    for (const [vk, v] of [...c.v].sort((x, y) => (x[1].k < y[1].k ? -1 : x[1].k > y[1].k ? 1 : 0))) {
      variants.set(vk, { text: v.t, votes: v.n, by: v.by });
    }
    out.set(k, { source: c.s, variants, keys: c.keys.map(plainKey) });
  }
  return out;
}

export function mineCandidates(lines: MineLine[]): Map<string, Candidate> {
  return candidatesOf(addMined(new Map(), mineLines(lines)));
}

export interface Assessment {
  status: 'promote' | 'ambiguous' | 'weak';
  target: string;
  runnerUp: Variant | null;
  /** Votes for the target inside the authoritative pool. */
  evidence: number;
  /** target votes / pool votes. */
  agreement: number;
  /** Which pool decided: admin > cig > rest. CIG is authoritative where it has an opinion. */
  pool: 'admin' | 'cig' | 'rest';
  /** All occurrences of the term (spread of a card). */
  total: number;
}

const poolVotes = (v: Variant, pool: Assessment['pool']) =>
  pool === 'rest' ? (v.by.community ?? 0) + (v.by.ai ?? 0) + (v.by.judge ?? 0) : (v.by[pool] ?? 0);

/**
 * C8: a term becomes binding at ≥ minEvidence occurrences and ≥ minAgreement agreement.
 * The pool is the most authoritative origin that has an opinion (admin, else CIG, else the rest),
 * so CIG's own wording is taken blindly and the hybrid style of a pack cannot outvote it.
 * Contested (enough evidence, no clear majority, a runner-up exists) → ambiguous (Haiku, then card).
 * Too little evidence → weak: wait for more strings instead of asking an admin.
 */
export function assessCandidate(c: Candidate, minEvidence: number, minAgreement: number): Assessment {
  const vs = [...c.variants.values()];
  const total = vs.reduce((a, v) => a + v.votes, 0);
  const pool: Assessment['pool'] = vs.some((v) => v.by.admin) ? 'admin' : vs.some((v) => v.by.cig) ? 'cig' : 'rest';
  const ranked = vs.map((v) => ({ v, n: poolVotes(v, pool) })).filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.v.votes - a.v.votes || (a.v.text < b.v.text ? -1 : 1));
  const poolTotal = ranked.reduce((a, x) => a + x.n, 0);
  const top = ranked[0];
  const runner = ranked[1]?.v ?? null;
  if (!top) return { status: 'weak', target: '', runnerUp: null, evidence: 0, agreement: 0, pool, total };
  const agreement = top.n / poolTotal;
  // Admin pairs are reviewed: one admin vote is enough evidence.
  const enough = pool === 'admin' ? top.n >= 1 : top.n >= minEvidence;
  let status: Assessment['status'] = 'weak';
  if (enough && agreement >= minAgreement) status = 'promote';
  else if (poolTotal >= minEvidence && runner) status = 'ambiguous';
  return { status, target: top.v.text, runnerUp: runner, evidence: top.n, agreement, pool, total };
}

export interface GlossaryPlan {
  promote: LearnGlossaryRow[];
  contested: { source: string; a: Variant; b: Variant; a_ev: number; b_ev: number; keys: string[]; total: number }[];
  revise: { row: LearnGlossaryRow; source: string; target: string; evidence: number; keys: string[]; total: number }[];
}

const isProtected = (g: LearnGlossaryRow) => !!g.locked || g.origin === 'admin' || g.origin === 'cig';

export function planGlossary(
  cands: Map<string, Candidate>, glossary: LearnGlossaryRow[], s: Pick<LearnSettings, 'promote_min_evidence' | 'promote_min_agreement' | 'revise_margin'>,
): GlossaryPlan {
  const have = new Map(glossary.map((g) => [g.source_term.toLowerCase(), g]));
  const plan: GlossaryPlan = { promote: [], contested: [], revise: [] };
  for (const [k, c] of cands) {
    const a = assessCandidate(c, s.promote_min_evidence, s.promote_min_agreement);
    if (a.status === 'weak') continue;
    const row = have.get(k);
    if (row) {
      if (isProtected(row) || a.status !== 'promote') continue;
      if (row.target_term.toLowerCase() === a.target.toLowerCase()) continue;
      // Hysteresis pre-filter (B3): only a clearly better-backed variant may challenge a row.
      if (a.evidence < (row.evidence ?? 0) + s.revise_margin) continue;
      plan.revise.push({ row, source: c.source, target: a.target, evidence: a.evidence, keys: c.keys, total: a.total });
      continue;
    }
    if (a.status === 'promote') {
      plan.promote.push({
        source_term: c.source, target_term: a.target, category: a.target === c.source ? 'dnt' : 'term', origin: 'mined',
        evidence: a.evidence,
      });
    } else if (a.runnerUp) {
      const top = c.variants.get(a.target.toLowerCase())!;
      plan.contested.push({
        source: c.source, a: top, b: a.runnerUp, a_ev: poolVotes(top, a.pool), b_ev: poolVotes(a.runnerUp, a.pool), keys: c.keys,
        total: a.total,
      });
    }
  }
  plan.contested.sort((x, y) => y.total - x.total);
  plan.revise.sort((x, y) => y.total - x.total);
  return plan;
}

// ── pure: dnt from codex names (C2) ──────────────────────────────────────────

function hasWord(text: string, term: string): boolean {
  let i = text.indexOf(term);
  while (i >= 0) {
    const before = i === 0 ? '' : text[i - 1];
    const after = text[i + term.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
}

/** The names worth counting: 3-40 chars, capitalised, each once (first spelling). */
function usableNames(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 3 || name.length > 40 || seen.has(name.toLowerCase()) || !/^\p{Lu}/u.test(name)) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/** Per name `[name, pairs whose English contains it, of them kept verbatim]`; only names that occur. Sums add up across slices. */
export function dntCounts(names: string[], pairs: { en: string; t: string }[]): [string, number, number][] {
  const byFirst = new Map<string, number[]>();
  pairs.forEach((p, i) => {
    for (const w of new Set(p.en.match(/\p{Lu}[\p{L}\p{N}'-]*/gu) ?? [])) {
      let l = byFirst.get(w);
      if (!l) byFirst.set(w, (l = []));
      l.push(i);
    }
  });
  const out: [string, number, number][] = [];
  for (const name of usableNames(names)) {
    const first = name.split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]+$/u, '');
    let n = 0;
    let kept = 0;
    for (const i of byFirst.get(first) ?? []) {
      const p = pairs[i];
      if (!hasWord(p.en, name)) continue;
      n++;
      if (p.t.includes(name)) kept++;
    }
    if (n) out.push([name, n, kept]);
  }
  return out;
}

export function addDntCounts(into: Map<string, [number, number]>, part: [string, number, number][]): Map<string, [number, number]> {
  for (const [name, n, kept] of part) {
    const c = into.get(name);
    if (c) {
      c[0] += n;
      c[1] += kept;
    } else into.set(name, [n, kept]);
  }
  return into;
}

export function dntFromCounts(
  names: string[], counts: Map<string, [number, number]>, minEvidence: number, ratio = 0.9,
): LearnGlossaryRow[] {
  const out: LearnGlossaryRow[] = [];
  for (const name of usableNames(names)) {
    const [n, kept] = counts.get(name) ?? [0, 0];
    if (n >= minEvidence && kept / n >= ratio) {
      out.push({ source_term: name, target_term: name, category: 'dnt', origin: 'mined', evidence: n });
    }
  }
  return out.sort((x, y) => (y.evidence ?? 0) - (x.evidence ?? 0)).slice(0, 1000);
}

/**
 * Codex names that the translations keep verbatim in ≥ `ratio` of the pairs whose English
 * contains them (case-sensitive, whole words), with at least `minEvidence` such pairs.
 */
export function dntFromNames(
  names: string[], pairs: { en: string; t: string }[], minEvidence: number, ratio = 0.9,
): LearnGlossaryRow[] {
  return dntFromCounts(names, addDntCounts(new Map(), dntCounts(names, pairs)), minEvidence, ratio);
}

// ── pure: B1 line detection ──────────────────────────────────────────────────

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/**
 * Case-sensitive whole-word hit of a game term. A single-word term must not only stand at the
 * start of a sentence ("Open the door" is no use of the term "Open").
 */
export function termHit(en: string, term: string): boolean {
  if (/\s/.test(term.trim())) return hasWord(en, term);
  let i = en.indexOf(term);
  while (i >= 0) {
    const before = i === 0 ? '' : en[i - 1];
    const after = en[i + term.length] ?? '';
    const sentenceStart = i === 0 || /[.!?:]\s*$/.test(en.slice(Math.max(0, i - 3), i));
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after) && !sentenceStart) return true;
    i = en.indexOf(term, i + 1);
  }
  return false;
}

export interface AlignLine {
  key: string;
  h: string;
  en: string;
  entry: TmEntry;
  terms: { source: string; target: string }[];
}

/**
 * Community/AI lines whose English contains a CIG term while the target lacks the CIG target
 * (inflection-tolerant). CIG and admin lines are never candidates. dnt and label rows excluded:
 * labels are whole-string pairs, dnt names are covered by the QA gate.
 */
export function findMisaligned(
  lines: { key: string; h: string; en: string; entry: TmEntry }[], terms: GlossaryRow[], cap = ALIGN_LINES,
): AlignLine[] {
  const usable = terms.filter((g) => g.category === 'term' && g.source_term.length >= 3 && g.target_term &&
    g.source_term.toLowerCase() !== g.target_term.toLowerCase());
  if (!usable.length) return [];
  // A whole-word hit of a term means the term's first run of letters/digits is a whole token of the
  // line, so only the terms that share a token with the line are checked (thousands of terms otherwise).
  const byToken = new Map<string, number[]>();
  const loose: number[] = [];
  usable.forEach((g, i) => {
    const tok = g.source_term.match(TOKEN_RE)?.[0];
    if (!tok) loose.push(i);
    else {
      const l = byToken.get(tok);
      if (l) l.push(i);
      else byToken.set(tok, [i]);
    }
  });
  const out: AlignLine[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (out.length >= cap) break;
    if ((l.entry.o !== 'community' && l.entry.o !== 'ai') || seen.has(l.h)) continue;
    const cand = new Set<number>(loose);
    for (const tok of new Set(l.en.match(TOKEN_RE) ?? [])) for (const i of byToken.get(tok) ?? []) cand.add(i);
    const miss: { source: string; target: string }[] = [];
    for (const i of [...cand].sort((x, y) => x - y)) {
      const g = usable[i];
      if (termHit(l.en, g.source_term) && !containsStem(l.entry.t, g.target_term)) miss.push({ source: g.source_term, target: g.target_term });
      if (miss.length >= 4) break;
    }
    if (miss.length) {
      seen.add(l.h);
      out.push({ ...l, terms: miss });
    }
  }
  return out;
}

/** The first `cap` distinct lines in key order: what `findMisaligned` over the whole table returns. */
export function mergeMisaligned(parts: AlignLine[][], cap = ALIGN_LINES): AlignLine[] {
  const all = parts.flat().sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const out: AlignLine[] = [];
  const seen = new Set<string>();
  for (const l of all) {
    if (out.length >= cap) break;
    if (seen.has(l.h)) continue;
    seen.add(l.h);
    out.push(l);
  }
  return out;
}

// ── pure: example lines for the Haiku pre-decision (C6) ──────────────────────

export interface Example {
  /** Key of the line (decides which examples survive a merge). */
  k: string;
  en: string;
  t: string;
}

/**
 * For each needle (an English term and one of its translations) the first `per` lines, in key order,
 * whose English uses the term and whose translation uses that translation. Returns `[needle index, lines]`.
 */
export function findExamples(
  lines: { key: string; en: string; t: string }[], needles: { src: string; t: string }[], per = 2,
): [number, Example[]][] {
  const byToken = new Map<string, number[]>();
  const loose: number[] = [];
  needles.forEach((n, i) => {
    const tok = n.src.toLowerCase().match(TOKEN_RE)?.[0];
    if (!tok) loose.push(i);
    else {
      const l = byToken.get(tok);
      if (l) l.push(i);
      else byToken.set(tok, [i]);
    }
  });
  const found = new Map<number, Example[]>();
  for (const l of lines) {
    if (l.en.length > 200) continue;
    const lower = l.en.toLowerCase();
    const cand = new Set<number>(loose);
    for (const tok of new Set(lower.match(TOKEN_RE) ?? [])) for (const i of byToken.get(tok) ?? []) cand.add(i);
    for (const i of cand) {
      const have = found.get(i);
      if (have && have.length >= per) continue;
      const n = needles[i];
      if (!lower.includes(n.src.toLowerCase()) || !containsTerm(l.en, n.src) || !containsStem(l.t, n.t)) continue;
      if (have) have.push({ k: l.key, en: l.en, t: l.t });
      else found.set(i, [{ k: l.key, en: l.en, t: l.t }]);
    }
  }
  return [...found];
}

export function mergeExamples(parts: [number, Example[]][][], per = 2): Map<number, { en: string; t: string }[]> {
  const all = new Map<number, Example[]>();
  for (const part of parts) {
    for (const [i, ex] of part) {
      const l = all.get(i);
      if (l) l.push(...ex);
      else all.set(i, [...ex]);
    }
  }
  const out = new Map<number, { en: string; t: string }[]>();
  for (const [i, ex] of all) {
    ex.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
    out.set(i, ex.slice(0, per).map(({ en, t }) => ({ en, t })));
  }
  return out;
}

// ── judge candidates (C5) ────────────────────────────────────────────────────

export const judgeKey = (lang: string) => learnKey(lang, 'judge-terms');

/** Appends the judge's term corrections; they vote in the next mining pass (origin 'judge'). */
export async function addJudgeCandidates(store: Store, lang: string, terms: JudgeTerm[]): Promise<void> {
  const cur = ((await store.getJson(judgeKey(lang))) ?? []) as JudgeTerm[];
  await store.putJson(judgeKey(lang), [...cur, ...terms].slice(-2000));
}

// ── state ────────────────────────────────────────────────────────────────────

export interface HaikuItem {
  source: string;
  /** a = incumbent (top variant / current row), b = challenger. */
  a: string;
  b: string;
  a_ev: number;
  b_ev: number;
  total: number;
  keys: string[];
  /** Set when b challenges an existing glossary row. */
  row_id?: string;
  row_origin?: string;
  examples: { en: string; t: string }[];
}

interface WebItem {
  card_id: string;
  context: Record<string, unknown>;
  /** Reserved against the web cap at submit (month of the reservation). */
  est: number;
  month: string;
}

export interface LearnState {
  v: 1;
  haiku: LearnBatch<HaikuItem[]> | null;
  align: LearnBatch<AlignLine[]> | null;
  web: LearnBatch<WebItem[]> | null;
  last?: { trigger: LearnTrigger; at: string; build_id: string | null };
  /** Haiku pairs already judged for this build (source|a|b, lower case). */
  seen?: { build_id: string | null; sigs: Record<string, 1> };
}

export const stateKey = (lang: string) => learnKey(lang, 'state');

export async function loadState(store: Store, lang: string): Promise<LearnState> {
  const s = (await store.getJson(stateKey(lang))) as LearnState | null;
  return s && s.v === 1 ? s : { v: 1, haiku: null, align: null, web: null };
}

export interface LearnSummary {
  lang: string;
  trigger: LearnTrigger | 'resume';
  skipped?: string;
  cards?: ApplySummary;
  mined?: { candidates: number; promoted: number; contested: number; revise: number };
  dnt?: number;
  style?: boolean;
  haiku?: { submitted: number; promoted: number; replaced: number; cards: number };
  align?: { submitted: number; rewritten: number };
  web?: { submitted: number; attached: number };
  arbiter?: ArbiterSummary;
  blocked: string[];
  /** resume only: a finished batch was read and applied in this call. */
  applied?: boolean;
}

// ── run ──────────────────────────────────────────────────────────────────────

/**
 * Reads the learning batches that have ended (Haiku, align, web, arbiter) and applies them. Cheap while
 * they run; applying one writes glossary rows, cards and TM shards, so a tick does this for one language
 * at a time, as its heavy step (`applied` tells the caller that it was one).
 */
export async function resumeLearning(deps: Deps, lang: string): Promise<LearnSummary> {
  const sum: LearnSummary = { lang, trigger: 'resume', blocked: [] };
  if (!hasLearn(deps)) return { ...sum, skipped: 'no_learn_db' };
  const state = await loadState(deps.store, lang);
  const arb = await deps.store.getJson(learnKey(lang, 'arbiter')) as { queue?: unknown[]; batch?: unknown } | null;
  const busy = state.haiku || state.align || state.web || arb?.batch || (arb?.queue?.length ?? 0) > 0;
  if (!busy) return { ...sum, skipped: 'idle' };
  const settings = await deps.learn.getLearnSettings();
  await pollBatches(deps, lang, settings, state, sum);
  if (arb) sum.arbiter = await arbitrate(deps, lang, []);
  const a = sum.arbiter;
  sum.applied = !!(sum.haiku || sum.align || sum.web || (a && (a.replaced || a.kept || a.cards || a.submitted)));
  return sum;
}

export function estimateUsd(model: string, requests: number, systemTok: number, outTok: number, inTok: number): number {
  const p = priceOf(model);
  return (((requests * systemTok + inTok) * p.in + outTok * p.out) / 1e6) * 1.5;
}

// ── batches ──────────────────────────────────────────────────────────────────

const HAIKU_PER_REQUEST = 20;

function haikuSystem(lang: string, glossary: GlossaryRow[]): string {
  const name = LANG_NAMES[lang] ?? lang;
  return `You decide which ${name} term is the right translation of an English Star Citizen game term, for use everywhere in the game. Each item gives the English term, two candidate translations A and B, and example lines. Prefer the wording of CIG's official ${name} localization and consistency with the glossary below; proper names stay in English. The order A/B means nothing. Answer "tie" when both are equally right.
For each item return {"w":"A"|"B"|"tie","c":<confidence 0..1>,"why":"<at most 12 words>"}; output {"r":[...]}, input order.

GLOSSARY (English => ${name}):
${glossaryBlock(glossary, 10_000)}`;
}

export function haikuRequests(lang: string, items: HaikuItem[], glossary: GlossaryRow[]): { custom_id: string; params: BatchParams }[] {
  const reqs: { custom_id: string; params: BatchParams }[] = [];
  const system = haikuSystem(lang, glossary.filter((g) => g.origin === 'cig' || g.origin === 'admin' || g.locked));
  for (let g = 0; g * HAIKU_PER_REQUEST < items.length; g++) {
    const part = items.slice(g * HAIKU_PER_REQUEST, (g + 1) * HAIKU_PER_REQUEST);
    const fwd = part.map((x) => ({ en: x.source, A: x.a, B: x.b, examples: x.examples }));
    const rev = part.map((x) => ({ en: x.source, A: x.b, B: x.a, examples: x.examples }));
    reqs.push({ custom_id: `f${g}`, params: jsonParams(HAIKU_MODEL, system, JSON.stringify(fwd), PAIR_SCHEMA, 300 + part.length * 60) });
    reqs.push({ custom_id: `r${g}`, params: jsonParams(HAIKU_MODEL, system, JSON.stringify(rev), PAIR_SCHEMA, 300 + part.length * 60) });
  }
  return reqs;
}

function pairOf(results: Map<string, BatchResult>, id: string, j: number): PairJudgement | null {
  const o = resultJson(results.get(id)) as { r?: { w: string; c: number }[] } | null;
  const x = o?.r?.[j];
  return x && (x.w === 'A' || x.w === 'B' || x.w === 'tie') ? { w: x.w, c: Number(x.c) } : null;
}

export function alignRequests(lang: string, model: string, lines: AlignLine[]): { custom_id: string; params: BatchParams }[] {
  const name = LANG_NAMES[lang] ?? lang;
  const system = `You align existing ${name} Star Citizen translations with CIG's official terminology. Each entry is [English, current translation, required terms as "English => ${name}"]. Rewrite the current translation minimally so it uses every required ${name} term (inflect it where grammar needs); change nothing else — keep wording, style, placeholders (~mission(…), <EM1>, %s, \\n, [..]) and punctuation. Return only JSON {"t":[...]}, one string per entry, input order.`;
  const reqs: { custom_id: string; params: BatchParams }[] = [];
  for (let g = 0; g * ALIGN_PER_REQUEST < lines.length; g++) {
    const part = lines.slice(g * ALIGN_PER_REQUEST, (g + 1) * ALIGN_PER_REQUEST);
    const user = JSON.stringify(part.map((l) => [l.en, l.entry.t, l.terms.map((t) => `${t.source} => ${t.target}`)]));
    const chars = part.reduce((a, l) => a + l.entry.t.length, 0);
    reqs.push({ custom_id: `a${g}`, params: jsonParams(model, system, user, OUTPUT_SCHEMA, Math.ceil(chars * 0.9 * 2) + 300) });
  }
  return reqs;
}

export async function pollBatches(d: LearnDeps, lang: string, settings: LearnSettings, state: LearnState, sum: LearnSummary): Promise<void> {
  if (state.haiku) {
    const read = await readLearnBatch(d, state.haiku.id, 'haiku', HAIKU_MODEL, lang);
    if (read) {
      sum.haiku = { submitted: 0, ...(await applyHaiku(d, lang, settings, state.haiku.items, read.results)) };
      state.haiku = null;
      await d.store.putJson(stateKey(lang), state);
    }
  }
  if (state.align) {
    const read = await readLearnBatch(d, state.align.id, 'align', settings.arbiter_model, lang);
    if (read) {
      sum.align = { submitted: 0, rewritten: await applyAlign(d, lang, state.align.items, read.results, settings.arbiter_model) };
      state.align = null;
      await d.store.putJson(stateKey(lang), state);
    }
  }
  if (state.web) {
    const read = await readLearnBatch(d, state.web.id, 'web', WEB_MODEL, lang);
    if (read) {
      for (const it of state.web.items) await adjustKind(d.store, it.month, 'web_reserved', -it.est);
      let attached = 0;
      for (const [i, item] of state.web.items.entries()) {
        const r = read.results.get(`w${i}`);
        const text = r?.type === 'succeeded' ? (r.text ?? '').trim() : '';
        if (!text) continue;
        await d.learn.updateCardContext(item.card_id, {
          ...item.context, research: { text: text.slice(0, 2000), at: d.now().toISOString(), model: r?.model ?? WEB_MODEL },
        });
        attached++;
      }
      sum.web = { submitted: 0, attached };
      state.web = null;
      await d.store.putJson(stateKey(lang), state);
    }
  }
}

async function applyHaiku(
  d: LearnDeps, lang: string, settings: LearnSettings, items: HaikuItem[], results: Map<string, BatchResult>,
): Promise<{ promoted: number; replaced: number; cards: number }> {
  let promoted = 0;
  let replaced = 0;
  const cards: CardRow[] = [];
  const buildId = await d.learn.currentBuildId();
  let revise = reviseStateFor((await d.store.getJson(learnKey(lang, 'revise'))) as ReviseState | null, buildId);
  const tmIndex = (await d.store.getJson(`translation-tm/${lang}/index.json`)) as { count?: number } | null;
  const langStrings = Number(tmIndex?.count ?? 0);
  const rows: LearnGlossaryRow[] = [];
  items.forEach((x, i) => {
    const g = Math.floor(i / HAIKU_PER_REQUEST);
    const j = i % HAIKU_PER_REQUEST;
    const v = bothOrders(pairOf(results, `f${g}`, j), pairOf(results, `r${g}`, j));
    if (x.row_id) {
      // Row challenge (B3): both orders + evidence margin + release budget.
      const ok = v.outcome === 'challenger' && shouldReplace({
        winsForward: v.winsForward, winsReverse: v.winsReverse, evidenceNew: x.b_ev, evidenceOld: x.a_ev,
        margin: settings.revise_margin, locked: x.row_origin === 'admin', isCig: x.row_origin === 'cig',
        changedThisRelease: revise.changed, budgetPct: settings.revise_budget_pct, langStrings,
      }).replace;
      if (ok) {
        revise = { ...revise, changed: revise.changed + 1 };
        rows.push({ id: x.row_id, source_term: x.source, target_term: x.b, category: 'term', origin: x.row_origin ?? 'mined', evidence: x.b_ev });
      } else if (v.outcome === 'card') {
        cards.push(termCard({
          lang, source_term: x.source, a: { text: x.a, source: 'glossary', votes: x.a_ev }, b: { text: x.b, source: 'mined', votes: x.b_ev },
          spread: x.total, sampleKeys: x.keys, doubt: v.doubt, fresh: false, why: 'revise_disagreement',
        }));
      }
      return;
    }
    if (v.agreed) {
      const text = v.agreed === 'incumbent' ? x.a : x.b;
      rows.push({ source_term: x.source, target_term: text, category: text === x.source ? 'dnt' : 'term', origin: 'mined', evidence: Math.max(x.a_ev, x.b_ev) });
    } else {
      cards.push(termCard({
        lang, source_term: x.source, a: { text: x.a, source: 'mined', votes: x.a_ev }, b: { text: x.b, source: 'mined', votes: x.b_ev },
        spread: x.total, sampleKeys: x.keys, doubt: v.doubt, fresh: false, why: 'contested_term',
      }));
    }
  });
  for (const r of rows) {
    if (r.id) {
      if (await propagateGlossaryChange(d.learn, { id: r.id, origin: r.origin }, { target_term: r.target_term, evidence: r.evidence ?? 0 })) replaced++;
    } else promoted += await d.learn.insertGlossary(lang, [r]);
  }
  await d.store.putJson(learnKey(lang, 'revise'), revise);
  const n = cards.length ? await createCards(d.learn, cards) : 0;
  return { promoted, replaced, cards: n };
}

async function applyAlign(
  d: LearnDeps, lang: string, items: AlignLine[], results: Map<string, BatchResult>, model: string,
): Promise<number> {
  const at = d.now().toISOString();
  const writes: Record<string, TmEntry> = {};
  const shards = new Map<string, Record<string, TmEntry>>();
  for (let g = 0; g * ALIGN_PER_REQUEST < items.length; g++) {
    const part = items.slice(g * ALIGN_PER_REQUEST, (g + 1) * ALIGN_PER_REQUEST);
    const o = resultJson(results.get(`a${g}`)) as { t?: unknown } | null;
    if (!o || !Array.isArray(o.t) || o.t.length !== part.length) continue;
    for (const [j, l] of part.entries()) {
      const t = String(o.t[j] ?? '');
      if (hardFailures(l.en, t).length || !l.terms.every((x) => containsStem(t, x.target))) continue;
      // Only if the TM still holds the text we aligned (an arbiter or admin may have replaced it meanwhile).
      const hh = l.h.slice(0, 2);
      if (!shards.has(hh)) shards.set(hh, ((await d.store.getJson(tmShardKey(lang, hh))) ?? {}) as Record<string, TmEntry>);
      const cur = shards.get(hh)![l.h];
      if (!cur || cur.t !== l.entry.t || cur.o === 'admin' || cur.o === 'cig') continue;
      // A rewritten community line keeps its source and licence (a derivative stays under it).
      writes[l.h] = { ...cur, t, m: model, at };
    }
  }
  if (Object.keys(writes).length) await saveTm(d.store, lang, writes);
  return Object.keys(writes).length;
}

/** `before` runs right before the batch is created (the caller records its intent there). */
export async function submitWeb(
  d: LearnDeps, lang: string, settings: LearnSettings, state: LearnState, sum: LearnSummary, before?: () => Promise<void>,
): Promise<void> {
  if (!(settings.web_research_cap_usd > 0)) return;
  const month = monthOfDate(d.now());
  const spent = (await d.learn.monthKindSpent(month, 'web')) + (await monthKindSpend(d.store, month, 'web_reserved'));
  const open = (await d.learn.listOpenCards(lang, ['meta', 'wording'], 20)).filter((c) => !(c.context as { research?: unknown })?.research);
  const top = open.slice(0, WEB_CARDS);
  if (!top.length) return;
  // Hard cap: never submit when the month's web spend plus this batch could pass it.
  if (spent + top.length * WEB_USD_PER_CARD > settings.web_research_cap_usd) {
    sum.blocked.push('web:cap');
    return;
  }
  const block = await spendBlock(d, settings, top.length * WEB_USD_PER_CARD);
  if (block) {
    sum.blocked.push(`web:${block}`);
    return;
  }
  const name = LANG_NAMES[lang] ?? lang;
  const reqs = top.map((c, i) => {
    const ctx = (c.context ?? {}) as Record<string, unknown>;
    const user = `Star Citizen ${name} localization question for a reviewer: ${c.question}
English: ${String(ctx.en ?? ctx.term ?? '')}
Option A: ${c.option_a.text}
Option B: ${c.option_b.text}
Search the web (e.g. starcitizen.tools in ${name}, the RSI website, ${name} community wikis) for how CIG and the ${name} community write this. Report the findings in at most 80 words with the URLs you used. Do not decide; report evidence only.`;
    return {
      custom_id: `w${i}`,
      params: {
        model: WEB_MODEL,
        max_tokens: 2048,
        system: 'You research game terminology for a localization reviewer. Be brief and cite URLs.',
        messages: [{ role: 'user' as const, content: user }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      } as BatchParams,
    };
  });
  await before?.();
  const id = await submitLearnBatch(d, reqs);
  // Reserve the estimate now so two languages in one tick cannot both pass the cap; the real spend
  // is booked (ledger row, kind 'web') when the results are read, and the reservation released then.
  await adjustKind(d.store, month, 'web_reserved', top.length * WEB_USD_PER_CARD);
  state.web = {
    id, submitted_at: d.now().toISOString(),
    items: top.map((c) => ({ card_id: c.id!, context: (c.context ?? {}) as Record<string, unknown>, est: WEB_USD_PER_CARD, month })),
  };
  sum.web = { attached: 0, ...sum.web, submitted: top.length };
}
