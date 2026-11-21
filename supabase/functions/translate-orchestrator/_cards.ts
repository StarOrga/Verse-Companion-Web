// D1 admin cards ("Karteikarten"): created ONLY as the last resort — arbiter disagreement or low
// confidence, learning conflicts the Haiku pre-decision could not settle. Clear cases never
// become cards. An answered card has no DB side effect of its own (w1-contract); the
// orchestrator applies it here at the start of the next learn pass: a|b → winner into the TM,
// own → TM admin entry, term → glossary row, convention → every member string of a language.
//
// Concept 20261121-1151-karteikarten-neu (contract: docs/concepts/20261121-1151-karteikarten-neu/contract.md):
//   * a card stores kind + parameters, never an English question (P9); each option carries its
//     affected-text count and three examples with the option applied (P10)
//   * every pair runs the pre-filters of `_card_filters.ts` first (P1–P4): resolved pairs become a KI
//     decision without a card, spelling / pattern pairs join ONE cross-language convention card (P8)
//   * a language no admin judges gets no A/B card: the KI decides (P6/P7), the admins get a veto list
//   * "Nicht meine Entscheidung" and „Sieht falsch aus“ send a card to the KI path (`routeCards`, P12/P6)
//   * `cleanupOpenCards` runs the existing open cards through all of that once (P14)

import {
  classifyPair, conventionExamples, conventionPick, EXAMPLES_PER_OPTION, kiDecide, mergeMembers, recomputeDoubt, termExamples,
} from './_card_filters.ts';
import type { Candidate, CardExample, ConventionMember, KiDecision, PatternId } from './_card_filters.ts';
import type { TmEntry } from './_diff.ts';
import { saveTm } from './_io.ts';
import type { Store } from './_io.ts';
import type { CardOption, CardRow, LearnDb } from './_learn_db.ts';

export type CardKind = CardRow['kind'];

/** Visibility of a key: UI/HUD 3 > item/vehicle 2 > mission/lore/dialogue 1 > everything else 0. */
export function reachOf(key: string): number {
  if (/^(ui_|hud_|mobiglas|interaction|pause_|frontend|menu|options|keybind|inventory|mfd)/i.test(key)) return 3;
  if (/^(item_|vehicle_|ship_|weapon_|commodity|shop_)/i.test(key)) return 2;
  if (/^(pu_|mission|dlg|dialog|lore|galactapedia|journal|news|contract)/i.test(key) || /desc/i.test(key)) return 1;
  return 0;
}

/** Deck order of the kinds: conventions (one answer, many strings) before terms before single wordings. */
const KIND_RANK: Record<string, number> = { convention: 0, meta: 1, wording: 2, style: 3 };

/** Deck order (kind, spread, reach, doubt, fresh). Mirrors translation_cards_deck_idx. */
export function compareCards(
  a: Pick<CardRow, 'spread' | 'reach' | 'kind' | 'doubt' | 'fresh'> & { status?: string },
  b: Pick<CardRow, 'spread' | 'reach' | 'kind' | 'doubt' | 'fresh'> & { status?: string },
): number {
  return (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) ||
    b.spread - a.spread ||
    b.reach - a.reach ||
    b.doubt - a.doubt ||
    Number(b.fresh) - Number(a.fresh);
}

export interface TmCardInput {
  lang: string;
  kind?: CardKind;
  key: string;
  keys: string[];
  h: string;
  en: string;
  a: TmEntry;
  b: TmEntry;
  /** 0..1: how unsure the arbiter was. */
  doubt: number;
  fresh: boolean;
  neighbours?: { key: string; en: string }[];
  why: string;
  /** Confidences of the two judge orders (P5), kept for a later re-ranking. */
  judge?: { f: number; r: number } | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 1));
const srcOf = (e: TmEntry) => (e.o === 'community' && e.src ? `community:${e.src}` : e.o);

function whereOf(key: string): string {
  const r = reachOf(key);
  return r === 3 ? 'ui' : r === 2 ? 'item' : r === 1 ? 'mission_lore' : 'other';
}

/** Card for one string whose two candidates the arbiter could not separate (kind wording). */
export function tmCard(i: TmCardInput): CardRow {
  const keys = i.keys.length ? i.keys : [i.key];
  const ex = (text: string): CardExample[] =>
    keys.slice(0, EXAMPLES_PER_OPTION).map((key) => ({ lang: i.lang, key, en: i.en, text }));
  return {
    lang: i.lang,
    kind: i.kind ?? 'wording',
    params: { en: i.en, key: i.key, where: whereOf(i.key) },
    option_a: { text: i.a.t, source: srcOf(i.a), count: keys.length, examples: ex(i.a.t) },
    option_b: { text: i.b.t, source: srcOf(i.b), count: keys.length, examples: ex(i.b.t) },
    context: {
      type: 'tm', key: i.key, keys: keys.slice(0, 50), h: i.h, en: i.en, why: i.why,
      neighbours: (i.neighbours ?? []).slice(0, 4), where: whereOf(i.key),
      entries: { a: i.a, b: i.b }, ...(i.judge ? { judge: i.judge } : {}), v2: true,
    },
    spread: keys.length,
    reach: Math.max(...keys.map(reachOf), reachOf(i.key)),
    doubt: clamp01(i.doubt),
    fresh: i.fresh,
    dedupe_key: `tm:${i.h}`,
    impact: keys.length,
  };
}

export interface TermCardInput {
  lang: string;
  kind?: CardKind;
  source_term: string;
  a: { text: string; source: string; votes: number };
  b: { text: string; source: string; votes: number };
  /** Strings that contain the term. */
  spread: number;
  sampleKeys: string[];
  /** Lines with the term (P10 examples); absent = examples from the keys only. */
  examples?: { k?: string; key?: string; en: string; t: string }[];
  doubt: number;
  fresh: boolean;
  why: string;
}

/** Card for a glossary term with two competing targets (kind meta: one answer fixes every string). */
export function termCard(i: TermCardInput): CardRow {
  const ex = termExamples(i.lang, i.examples ?? [], i.a.text, i.b.text);
  const fill = (list: CardExample[], text: string) =>
    list.length ? list : i.sampleKeys.slice(0, EXAMPLES_PER_OPTION).map((key) => ({ lang: i.lang, key, en: i.source_term, text }));
  return {
    lang: i.lang,
    kind: i.kind ?? 'meta',
    params: { term: i.source_term, where: i.sampleKeys.length ? whereOf(i.sampleKeys[0]) : null },
    option_a: { text: i.a.text, source: i.a.source, votes: i.a.votes, count: i.spread, examples: fill(ex.a, i.a.text) },
    option_b: { text: i.b.text, source: i.b.source, votes: i.b.votes, count: i.spread, examples: fill(ex.b, i.b.text) },
    context: {
      type: 'term', term: i.source_term, en: i.source_term, keys: i.sampleKeys.slice(0, 20), why: i.why,
      where: i.sampleKeys.length ? whereOf(i.sampleKeys[0]) : null, v2: true,
    },
    spread: i.spread,
    reach: i.sampleKeys.length ? Math.max(...i.sampleKeys.map(reachOf)) : 0,
    doubt: clamp01(i.doubt),
    fresh: i.fresh,
    dedupe_key: `term:${i.source_term.toLowerCase()}`,
    impact: i.spread,
  };
}

// ── conventions (P1, P4, P8) ─────────────────────────────────────────────────

export const conventionKey = (p: PatternId) => `conv:${p}`;
/** Conventions decided (and applied once): later pairs of the pattern follow them without a card. */
export const conventionsKey = 'translation-work/cards/conventions.json';
export type ConventionRules = Record<string, { answer: 'a' | 'b'; exceptions: Record<string, 'a' | 'b'> }>;

/** One cross-language convention card (lang null) for a pattern and its member strings. */
export function conventionCard(pattern: PatternId, members: ConventionMember[], fresh = false): CardRow {
  const langs = [...new Set(members.map((m) => m.lang))].sort();
  const ex = conventionExamples(members);
  const n = members.length;
  return {
    lang: null,
    langs,
    kind: 'convention',
    params: { pattern, langs },
    option_a: { text: ex.a[0]?.text ?? '', source: 'pattern', count: n, examples: ex.a },
    option_b: { text: ex.b[0]?.text ?? '', source: 'pattern', count: n, examples: ex.b },
    context: { type: 'convention', pattern, members, v2: true },
    spread: n,
    reach: Math.max(0, ...members.map((m) => reachOf(m.key))),
    doubt: 0.5,
    fresh,
    dedupe_key: conventionKey(pattern),
    impact: n,
  };
}

// ── pair → row ───────────────────────────────────────────────────────────────

const optCand = (o: CardOption): Candidate => ({ text: o.text, source: o.source, ...(o.votes != null ? { votes: o.votes } : {}) });
const enOf = (c: CardRow) => String((c.context as { en?: unknown; term?: unknown }).en ?? (c.context as { term?: unknown }).term ?? '');

/** Legacy option sources carried the votes as text: "mined (13×)". */
export function legacyVotes(o: { source?: string; votes?: number }): number | undefined {
  if (typeof o.votes === 'number') return o.votes;
  const m = /\((\d+)×\)\s*$/.exec(o.source ?? '');
  return m ? Number(m[1]) : undefined;
}

/** A KI decision written onto a card row (status ai). `back` comes later from the back-translation batch. */
export function withDecision(c: CardRow, d: KiDecision, at: string): CardRow {
  return {
    ...c, status: 'ai', ai_choice: d.choice, ai_text: d.text, ai_basis: d.basis, ai_reason: d.reason, ai_unsure: d.unsure,
    ai_decided_at: at,
  };
}

/** The member a single pair adds to its convention. */
function memberOf(c: CardRow, cls: { a: string; b: string; swapped: boolean }): ConventionMember | null {
  const ctx = c.context as Record<string, unknown>;
  if (!c.lang) return null;
  if (ctx.type === 'tm' && typeof ctx.h === 'string') {
    const e = (ctx.entries ?? {}) as { a?: TmEntry; b?: TmEntry };
    const [ea, eb] = cls.swapped ? [e.b, e.a] : [e.a, e.b];
    return { lang: c.lang, key: String(ctx.key ?? ''), en: String(ctx.en ?? ''), a: cls.a, b: cls.b, type: 'tm', h: ctx.h, entries: { a: ea ?? null, b: eb ?? null } };
  }
  if (ctx.type === 'term' && typeof ctx.term === 'string') {
    const keys = (ctx.keys as string[] | undefined) ?? [];
    return { lang: c.lang, key: keys[0] ?? ctx.term, en: ctx.term, a: cls.a, b: cls.b, type: 'term', term: ctx.term };
  }
  return null;
}

export type Routed =
  | { to: 'insert'; row: CardRow }
  | { to: 'convention'; pattern: PatternId; member: ConventionMember };

/**
 * One raw pair card through P1–P7: KI decision without a card, a convention member, an open card
 * (the language is judged by an admin) or a KI-decided card (nobody judges the language).
 */
export function routePair(c: CardRow, judged: ReadonlySet<string>, rules: ConventionRules, at: string): Routed {
  const lang = c.lang ?? '';
  const cls = classifyPair({ lang, en: enOf(c), a: optCand(c.option_a), b: optCand(c.option_b) });
  if (cls.type === 'resolved') {
    const reason = { code: cls.basis, ...(cls.votes ? { a: cls.votes[0], b: cls.votes[1] } : {}) };
    // A cut bracket rewrote both candidates: an admin should look, so it is unsure (concept: "Schiffsname entfernt" ⚠).
    return { to: 'insert', row: withDecision(c, { choice: cls.choice, text: cls.text, basis: cls.basis, unsure: cls.basis === 'bracket', reason }, at) };
  }
  if (cls.type === 'convention') {
    const rule = rules[cls.pattern];
    const member = memberOf(c, cls);
    if (rule && member) {
      const side = conventionPick(rule.answer, rule.exceptions, lang);
      const text = side === 'a' ? cls.a : cls.b;
      const choice = text === c.option_a.text ? 'a' : text === c.option_b.text ? 'b' : 'own';
      return { to: 'insert', row: withDecision(c, { choice, text, basis: 'convention', unsure: false, reason: { code: 'convention' } }, at) };
    }
    if (member) return { to: 'convention', pattern: cls.pattern, member };
  }
  const row: CardRow = cls.type === 'card' && cls.stripped
    ? { ...c, option_a: { ...c.option_a, text: cls.a }, option_b: { ...c.option_b, text: cls.b } }
    : c;
  if (judged.has(lang)) return { to: 'insert', row: { ...row, status: 'open' } };
  const d = kiDecide({ a: optCand(row.option_a), b: optCand(row.option_b), doubt: row.doubt });
  return { to: 'insert', row: d ? withDecision(row, d, at) : { ...row, status: 'parked' } };
}

/** Languages admins answer as cards (P7): the union over every admin, default German. */
export async function judgedLangs(learn: LearnDb): Promise<Set<string>> {
  const l = learn.judgedLangs ? await learn.judgedLangs() : ['de'];
  return new Set(l);
}

/** Adds members to the open convention card of a pattern, or creates it. */
async function upsertConvention(learn: LearnDb, pattern: PatternId, members: ConventionMember[]): Promise<boolean> {
  const have = learn.findConvention ? await learn.findConvention(conventionKey(pattern)) : null;
  if (have?.id && learn.updateCard) {
    const merged = mergeMembers(((have.context as { members?: ConventionMember[] }).members ?? []), members);
    const next = conventionCard(pattern, merged, have.fresh);
    await learn.updateCard(have.id, {
      langs: next.langs, params: next.params, option_a: next.option_a, option_b: next.option_b,
      context: { ...(have.context as Record<string, unknown>), members: merged }, spread: next.spread, impact: next.impact, reach: next.reach,
    });
    return false;
  }
  return learn.insertCard({ ...conventionCard(pattern, members, true), status: 'open' });
}

/** Rows a learn run may insert: open cards for the human deck are capped, KI decisions get a wider cap. */
export const OPEN_CAP = 40;
export const AI_CAP = 200;

/**
 * Inserts cards (best first, capped); returns how many were new. Duplicates of unapplied cards are
 * skipped. Every pair runs `routePair` first, so only real questions reach a judged deck.
 */
export async function createCards(learn: LearnDb, cards: CardRow[], cap = OPEN_CAP, store?: Store, now: () => Date = () => new Date()): Promise<number> {
  const judged = await judgedLangs(learn);
  const rules = (store ? ((await store.getJson(conventionsKey)) ?? {}) : {}) as ConventionRules;
  const at = now().toISOString();
  const open: CardRow[] = [];
  const ai: CardRow[] = [];
  const conv = new Map<PatternId, ConventionMember[]>();
  for (const c of cards) {
    const r = routePair(c, judged, rules, at);
    if (r.to === 'convention') conv.set(r.pattern, [...(conv.get(r.pattern) ?? []), r.member]);
    else if (r.row.status === 'open') open.push(r.row);
    else ai.push(r.row);
  }
  let n = 0;
  for (const [p, members] of conv) if (await upsertConvention(learn, p, members)) n++;
  for (const c of open.sort(compareCards).slice(0, cap)) if (await learn.insertCard(c)) n++;
  for (const c of ai.sort(compareCards).slice(0, AI_CAP)) if (await learn.insertCard(c)) n++;
  return n;
}

// ── KI path: not-mine, veto, languages nobody judges (P6, P7, P12) ───────────

export interface RouteSummary {
  decided: number;
  parked: number;
  rerouted: number;
}

/**
 * Learn-pass start, after the answers are applied: (1) cards sent to the KI path without a decision
 * ("Nicht meine Entscheidung", „Sieht falsch aus“) get one — never a vetoed option; (2) open cards of
 * a language no admin judges any more (an admin changed the setting) go the KI path too.
 */
export async function routeCards(deps: { learn?: LearnDb; now(): Date }, lang: string): Promise<RouteSummary> {
  const sum: RouteSummary = { decided: 0, parked: 0, rerouted: 0 };
  const learn = deps.learn;
  if (!learn?.listCards || !learn.updateCard) return sum;
  const at = deps.now().toISOString();
  const judged = await judgedLangs(learn);
  const pending = await learn.listCards({ lang, status: ['ai'], undecided: true, limit: 500 });
  const stale = judged.has(lang) ? [] : await learn.listCards({ lang, status: ['open'], kinds: ['meta', 'wording'], limit: 500 });
  for (const c of [...pending, ...stale]) {
    const d = kiDecide({ a: optCand(c.option_a), b: optCand(c.option_b), doubt: Number(c.doubt ?? 0.5), vetoed: c.vetoed ?? [] });
    if (!d) {
      await learn.updateCard(c.id!, { status: 'parked' });
      sum.parked++;
      continue;
    }
    const r = withDecision(c, d, at);
    await learn.updateCard(c.id!, {
      status: 'ai', ai_choice: r.ai_choice, ai_text: r.ai_text, ai_basis: r.ai_basis, ai_reason: r.ai_reason, ai_unsure: r.ai_unsure,
      ai_decided_at: at, ai_back: null,
    });
    if (c.status === 'open') sum.rerouted++;
    else sum.decided++;
  }
  return sum;
}

// ── P14: the existing open cards once through P1–P7 ──────────────────────────

/** Written when the one-shot cleanup is done; its presence makes the cleanup a no-op. */
export const cleanupMarkerKey = 'translation-work/cards/cleanup-v2.json';

export interface CleanupSummary {
  seen: number;
  decided: number;
  folded: number;
  open: number;
  skipped?: string;
}

/** The legacy row (question prose, votes inside the source text) in the v2 shape. */
export function upgradeLegacyCard(c: CardRow): CardRow {
  const ctx = (c.context ?? {}) as Record<string, unknown>;
  const a: CardOption = { ...c.option_a, votes: legacyVotes(c.option_a) };
  const b: CardOption = { ...c.option_b, votes: legacyVotes(c.option_b) };
  if (a.votes == null) delete a.votes;
  if (b.votes == null) delete b.votes;
  const keys = ((ctx.keys as string[] | undefined) ?? []).filter((k) => typeof k === 'string');
  const en = enOf(c);
  const ex = (text: string) => keys.slice(0, EXAMPLES_PER_OPTION).map((key) => ({ lang: c.lang ?? '', key, en, text }));
  const count = Number(c.spread ?? keys.length) || keys.length;
  const params = ctx.type === 'term' ? { term: String(ctx.term ?? en), where: ctx.where ?? null } : { en, key: String(ctx.key ?? keys[0] ?? ''), where: ctx.where ?? null };
  return {
    ...c,
    kind: c.kind === 'style' ? 'wording' : c.kind,
    params,
    option_a: { text: a.text, source: String(a.source ?? '').replace(/\s*\(\d+×\)\s*$/, ''), ...(a.votes != null ? { votes: a.votes } : {}), count, examples: a.examples?.length ? a.examples : ex(a.text) },
    option_b: { text: b.text, source: String(b.source ?? '').replace(/\s*\(\d+×\)\s*$/, ''), ...(b.votes != null ? { votes: b.votes } : {}), count, examples: b.examples?.length ? b.examples : ex(b.text) },
    doubt: recomputeDoubt({ a, b, judge: (ctx.judge as { f?: number; r?: number } | undefined) ?? null }),
    context: { ...ctx, v2: true },
  };
}

/**
 * P14, flag-guarded and idempotent: every open card that predates the concept (no `context.v2`) runs
 * through P1–P7 once. Resolved → KI decision (vetoable), spelling / pattern → folded into its
 * convention card (status folded), real question in a judged language → stays open with a recomputed
 * doubt, else → KI decision. The marker file makes every later call a no-op; a crash before the marker
 * repeats the work only for rows still without `v2`.
 */
export async function cleanupOpenCards(deps: { store: Store; learn?: LearnDb; now(): Date }): Promise<CleanupSummary> {
  const sum: CleanupSummary = { seen: 0, decided: 0, folded: 0, open: 0 };
  const learn = deps.learn;
  if (!learn?.listCards || !learn.updateCard) return { ...sum, skipped: 'no_db' };
  if (await deps.store.getJson(cleanupMarkerKey)) return { ...sum, skipped: 'done' };
  const judged = await judgedLangs(learn);
  const rules = ((await deps.store.getJson(conventionsKey)) ?? {}) as ConventionRules;
  const at = deps.now().toISOString();
  const rows = (await learn.listCards({ status: ['open'], kinds: ['meta', 'wording', 'style'], limit: 5000 }))
    .filter((c) => !(c.context as { v2?: unknown })?.v2);
  const conv = new Map<PatternId, ConventionMember[]>();
  for (const old of rows) {
    sum.seen++;
    const c = upgradeLegacyCard(old);
    const r = routePair(c, judged, rules, at);
    if (r.to === 'convention') {
      conv.set(r.pattern, [...(conv.get(r.pattern) ?? []), r.member]);
      await learn.updateCard(c.id!, { status: 'folded', context: { ...c.context, folded_into: conventionKey(r.pattern) } });
      sum.folded++;
      continue;
    }
    const row = r.row;
    await learn.updateCard(c.id!, {
      kind: row.kind, params: row.params, option_a: row.option_a, option_b: row.option_b, doubt: row.doubt, context: row.context,
      status: row.status, ai_choice: row.ai_choice ?? null, ai_text: row.ai_text ?? null, ai_basis: row.ai_basis ?? null,
      ai_reason: row.ai_reason ?? null, ai_unsure: row.ai_unsure ?? false, ai_decided_at: row.ai_decided_at ?? null,
    });
    if (row.status === 'open') sum.open++;
    else sum.decided++;
  }
  for (const [p, members] of conv) await upsertConvention(learn, p, members);
  await deps.store.putJson(cleanupMarkerKey, { at, ...sum });
  return sum;
}

// ── notes: admin hints for the prompt ────────────────────────────────────────

export interface Notes {
  v: 1;
  byKey: Record<string, string>;
  byTerm: Record<string, string>;
  general: string[];
}

export const notesKey = (lang: string) => `translation-work/learn-${lang}/notes.json`;
/** Strings an admin decided on a card (h → text): the arbiter keeps them against later challengers. */
export const decidedKey = (lang: string) => `translation-work/learn-${lang}/decided.json`;

export async function loadNotes(store: Store, lang: string): Promise<Notes> {
  const n = (await store.getJson(notesKey(lang))) as Notes | null;
  return n && n.v === 1 ? n : { v: 1, byKey: {}, byTerm: {}, general: [] };
}

export interface ApplySummary {
  applied: number;
  tm: number;
  rules: number;
  notes: number;
  /** KI decisions taken over (nobody vetoed them before this learn pass). */
  ai?: number;
}

/** Side and text a row resolves to: the admin's answer, else the KI decision. */
function chosenOf(c: CardRow): { side: 'a' | 'b' | 'own'; text: string; human: boolean } | null {
  if (c.status === 'answered' || c.answer) {
    const side = c.answer as 'a' | 'b' | 'own';
    const text = side === 'a' ? c.option_a.text : side === 'b' ? c.option_b.text : (c.own_text ?? '').trim();
    return text ? { side, text, human: true } : null;
  }
  if (c.status === 'ai' && c.ai_choice && c.ai_text) return { side: c.ai_choice, text: c.ai_text, human: false };
  return null;
}

/**
 * Applies every answered card and every KI decision nobody vetoed in time, for one language.
 * Idempotent: applied cards carry `applied_at` (column; `context.applied_at` for adapters without it),
 * a convention card carries `context.applied_langs` and is applied once per member language.
 */
export async function applyAnsweredCards(
  deps: { store: Store; now(): Date; learn?: LearnDb },
  lang: string,
): Promise<ApplySummary> {
  const sum: ApplySummary = { applied: 0, tm: 0, rules: 0, notes: 0 };
  const learn = deps.learn;
  if (!learn) return sum;
  const cards = await learn.listAnsweredUnapplied(lang, 200);
  if (!cards.length) return sum;
  const at = deps.now().toISOString();
  const notes = await loadNotes(deps.store, lang);
  const decided = ((await deps.store.getJson(decidedKey(lang))) ?? {}) as Record<string, string>;
  const rules = ((await deps.store.getJson(conventionsKey)) ?? {}) as ConventionRules;
  let rulesChanged = false;
  const tm: Record<string, TmEntry> = {};
  const done: [CardRow, Record<string, unknown>][] = [];

  const writeTm = (h: string, picked: TmEntry | undefined | null, text: string, admin: boolean) => {
    // a|b keeps the winner's origin (and its source/licence); own text is an admin entry (a KI own text, e.g. a cut
    // bracket, keeps the origin of the candidate it came from).
    tm[h] = picked ? { ...picked, t: text, at } : admin ? { t: text, o: 'admin', m: 'card', at } : { t: text, o: 'ai', m: 'card', at };
    decided[h] = text;
    sum.tm++;
  };
  const writeTerm = async (term: string, text: string, asAdmin: boolean, actor: string | null, evidence: number) => {
    // A term answer is a decision for every string with the term. Own text → admin row; a plain pick → a
    // mined row backed by the choice (still re-decidable by an admin).
    if (asAdmin) {
      await learn.upsertAdminRule(lang, { source_term: term, target_term: text, category: term === text ? 'dnt' : 'term' }, actor);
    } else {
      const have = (await learn.listGlossary(lang)).find((g) => g.source_term.toLowerCase() === term.toLowerCase());
      if (have?.id) await learn.updateGlossary(have.id, { target_term: text, origin: 'mined', needs_retranslate: true });
      else await learn.insertGlossary(lang, [{ source_term: term, target_term: text, category: term === text ? 'dnt' : 'term', origin: 'mined', evidence }]);
    }
    sum.rules++;
  };

  for (const c of cards) {
    const ctx = (c.context ?? {}) as Record<string, unknown>;
    const ch = chosenOf(c);
    if (!ch) continue;
    if (!ch.human) sum.ai = (sum.ai ?? 0) + 1;
    if (ctx.type === 'convention') {
      const side = ch.side === 'b' ? 'b' : 'a';
      const pattern = String(ctx.pattern ?? '');
      for (const m of ((ctx.members ?? []) as ConventionMember[]).filter((x) => x.lang === lang)) {
        const s = conventionPick(side, c.exceptions, lang);
        const text = s === 'a' ? m.a : m.b;
        if (m.type === 'tm' && m.h) writeTm(m.h, (m.entries?.[s] as TmEntry | null) ?? null, text, false);
        else if (m.type === 'term' && m.term) await writeTerm(m.term, text, false, c.answered_by ?? null, 0);
      }
      if (pattern && !rules[pattern]) {
        rules[pattern] = { answer: side, exceptions: (c.exceptions ?? {}) as Record<string, 'a' | 'b'> };
        rulesChanged = true;
      }
      const langs = [...new Set([...(((ctx.applied_langs ?? []) as string[])), lang])];
      done.push([c, { ...ctx, applied_langs: langs, applied_at: at }]);
      continue;
    }
    if (ctx.type === 'tm' && typeof ctx.h === 'string') {
      const entries = (ctx.entries ?? {}) as { a?: TmEntry; b?: TmEntry };
      const picked = ch.side === 'a' ? entries.a : ch.side === 'b' ? entries.b
        : ch.human ? undefined : (entries.a ?? entries.b);
      writeTm(ctx.h, picked, ch.text, ch.human);
      if (ch.human && c.save_as_rule && typeof ctx.en === 'string' && ctx.en.length <= 60 && !/[\r\n]/.test(ctx.en)) {
        await learn.upsertAdminRule(lang, { source_term: ctx.en.trim(), target_term: ch.text, category: 'term' }, c.answered_by ?? null);
        sum.rules++;
      }
    } else if (ctx.type === 'term' && typeof ctx.term === 'string') {
      await writeTerm(ctx.term, ch.text, ch.human && (!!c.save_as_rule || ch.side === 'own'), c.answered_by ?? null, Number(c.spread ?? 0));
    } else if (c.kind === 'style' && c.save_as_rule && ch.text) {
      if (!notes.general.includes(ch.text)) notes.general.push(ch.text);
      sum.rules++;
    }
    const note = (c.note ?? '').trim();
    if (note) {
      if (ctx.type === 'term' && typeof ctx.term === 'string') notes.byTerm[ctx.term] = note;
      else if (typeof ctx.key === 'string') for (const k of (ctx.keys as string[] | undefined) ?? [ctx.key]) notes.byKey[k] = note;
      else notes.general.push(note);
      sum.notes++;
    }
    done.push([c, { ...ctx, applied_at: at }]);
  }
  if (Object.keys(tm).length) await saveTm(deps.store, lang, tm);
  notes.general = notes.general.slice(-30);
  await deps.store.putJson(notesKey(lang), notes);
  await deps.store.putJson(decidedKey(lang), decided);
  if (rulesChanged) await deps.store.putJson(conventionsKey, rules);
  // Marked only after TM/notes are written: a crash in between re-applies (harmless), never loses an answer.
  for (const [c, ctx] of done) {
    if (learn.updateCard) await learn.updateCard(c.id!, { context: ctx, applied_at: c.applied_at ?? at });
    else await learn.updateCardContext(c.id!, ctx);
    sum.applied++;
  }
  return sum;
}
