// The learning pass in slices (why: _pass.ts; what it computes: _learn.ts).
//
//   start    answered cards, pin the build, fetch the codex names
//   mine     SCAN_SHARDS English shards per slice -> `mine-<pos>`: term votes, style counts, name counts
//   plan     merge the parts: style, promotions, contested terms, CIG terms -> `plan`
//   insert   the glossary rows of the plan, INSERT_ROWS per slice
//   detect   second walk, only when the plan asks questions: example lines for contested terms,
//            community/AI lines that miss a CIG term -> `det-<pos>`
//   submit   one batch per slice: Haiku pre-decision, align, then web research + arbiter + done
//
// The one-request run this replaces read the whole table and the whole TM, and searched every line
// for every contested term; it never finished once in production. Merging the parts gives exactly
// what that run computed (pinned by tests that compare slice sizes).

import { applyAnsweredCards } from './_cards.ts';
import { arbitrate } from './_arbiter.ts';
import { isCigValid } from './_diff.ts';
import type { TmEntry } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import type { JudgeTerm } from './_glossary.ts';
import {
  addDntCounts, addMined, alignRequests, ALIGN_PER_REQUEST, assessCandidate, candidatesOf, dntCounts, dntFromCounts,
  estimateUsd, findExamples, findMisaligned, HAIKU_ITEMS, HAIKU_MODEL, haikuRequests, judgeKey, loadState, mergeExamples,
  mergeMisaligned, mineLines, planGlossary, resumeLearning, stateKey, STYLE_MIN_TRUSTED, submitWeb,
} from './_learn.ts';
import type { AlignLine, Example, HaikuItem, LearnSummary, LearnTrigger, MineAcc, MinedTerm, MineLine } from './_learn.ts';
import { hasLearn, learnKey, spendBlock, submitLearnBatch } from './_learn_batch.ts';
import type { LearnDeps } from './_learn_batch.ts';
import type { LearnGlossaryRow } from './_learn_db.ts';
import type { Deps } from './_machine.ts';
import { advancePass, commit, memPasses, mergeState } from './_pass.ts';
import type { Pass, PassDb, PassKind, PassStep } from './_pass.ts';
import type { GlossaryRow } from './_prompt.ts';
import { SCAN_SHARDS } from './_scan.ts';
import { deleteKeys, loadSlice, openSliceReaders } from './_slice.ts';
import type { Slice } from './_slice.ts';
import { emptyStyleCounts, mergeStyleCounts, styleCounts, styleFromCounts } from './_style.ts';
import type { StyleCounts } from './_style.ts';

/** Glossary rows written per slice (bulk inserts, see `insertGlossary`). */
export const INSERT_ROWS = 500;

const STYLE_ORIGINS = ['admin', 'cig', 'community'] as const;
type StyleOrigin = typeof STYLE_ORIGINS[number];

interface MinePart {
  terms: MinedTerm[];
  style: Partial<Record<StyleOrigin, StyleCounts>>;
  dnt: [string, number, number][];
}

interface LearnPlan {
  /** Rows to insert: the promotions first, then the do-not-translate names. */
  rows: LearnGlossaryRow[];
  promote: number;
  /** Contested terms and row challenges for Haiku, still without example lines. */
  items: HaikuItem[];
  /** Terms a community/AI line must use (empty when an align batch is already in flight). */
  cigTerms: GlossaryRow[];
}

interface DetectPart {
  ex: [number, Example[]][];
  mis: AlignLine[];
}

interface PassState {
  sum: LearnSummary;
  /** CIG folder of the language. */
  cig?: string;
  /** A batch create in flight: written before the provider call, cleared with the step. */
  intent?: { kind: string; at: string };
  /** Batches created again after a request died with its intent open: each may exist twice. */
  resubmits?: number;
}

type D = LearnDeps & { passes: PassDb };

const workKey = (pass: Pass, name: string) => `translation-work/learn-${pass.lang}/p-${pass.id}/${name}.json`;
const stateOf = (pass: Pass) => pass.state as unknown as PassState;

/** The pass belongs to another request now: stop without touching anything. */
class Lost extends Error {}

/** One line per key with its current target and origin (CIG valid -> CIG, else the TM). */
function linesOf(sl: Slice): { lines: MineLine[]; tmLines: { key: string; h: string; en: string; entry: TmEntry }[] } {
  const lines: MineLine[] = [];
  const tmLines: { key: string; h: string; en: string; entry: TmEntry }[] = [];
  for (const key of sl.keys) {
    const e = sl.en[key];
    if (!e || !e.trim()) continue;
    if (isCigValid(e, sl.cig[key])) {
      lines.push({ key, en: e, t: sl.cig[key], o: 'cig' });
      continue;
    }
    const h = sl.hashes.get(e);
    const hit = h ? sl.tm[h] : undefined;
    if (!h || !hit) continue;
    lines.push({ key, en: e, t: hit.t, o: hit.o });
    tmLines.push({ key, h, en: e, entry: hit });
  }
  return { lines, tmLines };
}

function done(d: D, pass: Pass, sum: LearnSummary): Promise<Pass | null> {
  return commit(d, pass, { status: 'done', phase: 'done', pos: 0, state: { sum } });
}

async function start(d: D, pass: Pass): Promise<Pass | null> {
  const lang = pass.lang;
  const seed = (pass.state.seed ?? {}) as Partial<LearnSummary>;
  const sum: LearnSummary = { ...seed, lang, trigger: pass.reason as LearnTrigger, blocked: [] };
  sum.cards = await applyAnsweredCards(d, lang);
  const buildId = await d.learn.currentBuildId();
  const language = await d.db.getLanguage(lang);
  if (!buildId || !language) return done(d, pass, { ...sum, skipped: buildId ? 'lang_unknown' : 'no_build' });
  const readers = await openSliceReaders(d.store, buildId, null);
  if (!readers.en.index || !readers.en.index.count) return done(d, pass, { ...sum, skipped: 'english_missing' });
  const names = await d.learn.codexNames(buildId).catch(() => [] as string[]);
  await d.store.putJson(workKey(pass, 'names'), names);
  return commit(d, pass, {
    phase: 'mine', pos: 0, total: readers.en.names().length, build_id: buildId,
    state: { sum, cig: language.cig_folder || lang },
  });
}

/** The readers of the pinned build; null when the table was published again and the walk must restart. */
async function readersFor(d: D, pass: Pass) {
  const readers = await openSliceReaders(d.store, pass.build_id!, stateOf(pass).cig ?? pass.lang);
  if (!readers.en.index) throw new TranslateError('translate.english_missing');
  return readers.en.names().length === pass.total ? readers : null;
}

const restart = (d: D, pass: Pass) => commit(d, pass, { phase: 'start', pos: 0, total: 0 });

async function mine(d: D, pass: Pass): Promise<Pass | null> {
  const readers = await readersFor(d, pass);
  if (!readers) return restart(d, pass);
  const sl = await loadSlice(d.store, readers, pass.lang, pass.pos);
  const { lines } = linesOf(sl);
  const names = ((await d.store.getJson(workKey(pass, 'names'))) ?? []) as string[];
  const style: MinePart['style'] = {};
  for (const o of STYLE_ORIGINS) {
    const of = lines.filter((l) => l.o === o);
    if (of.length) style[o] = styleCounts(pass.lang, of);
  }
  const part: MinePart = { terms: mineLines(lines), style, dnt: names.length ? dntCounts(names, lines) : [] };
  await d.store.putJson(workKey(pass, `mine-${pass.pos}`), part);
  const next = pass.pos + SCAN_SHARDS;
  return commit(d, pass, next >= pass.total ? { phase: 'plan', pos: 0 } : { pos: next });
}

async function plan(d: D, pass: Pass): Promise<Pass | null> {
  const { store, learn } = d;
  const lang = pass.lang;
  const sum = stateOf(pass).sum;
  const settings = await learn.getLearnSettings();

  const acc: MineAcc = new Map();
  const style: Record<StyleOrigin, StyleCounts> = { admin: emptyStyleCounts(), cig: emptyStyleCounts(), community: emptyStyleCounts() };
  const dnt = new Map<string, [number, number]>();
  for (let pos = 0; pos < pass.total; pos += SCAN_SHARDS) {
    const part = (await store.getJson(workKey(pass, `mine-${pos}`))) as MinePart | null;
    // A part vanished (a cleanup raced a retry): walk again.
    if (!part) return commit(d, pass, { phase: 'mine', pos: 0 });
    addMined(acc, part.terms);
    for (const o of STYLE_ORIGINS) if (part.style[o]) style[o] = mergeStyleCounts(style[o], part.style[o]!);
    addDntCounts(dnt, part.dnt);
  }

  // C3 style: CIG + admin teach it; the community joins only where CIG says too little.
  const trusted = mergeStyleCounts(style.cig, style.admin);
  const useCommunity = trusted.n < STYLE_MIN_TRUSTED;
  const counts = useCommunity ? mergeStyleCounts(trusted, style.community) : trusted;
  if (counts.n) {
    const from = STYLE_ORIGINS.filter((o) => style[o].n > 0 && (o !== 'community' || useCommunity));
    await learn.setStyle(lang, { ...styleFromCounts(lang, counts, [...from].sort()), at: d.now().toISOString() });
    sum.style = true;
  }

  // C1 + C5 candidates (the judge's votes count after every table line), C8 promotion.
  const judge = ((await store.getJson(judgeKey(lang))) ?? []) as JudgeTerm[];
  addMined(acc, mineLines(judge.map((j, i) => ({ key: `judge:${String(i).padStart(6, '0')}`, en: j.source, t: j.target, o: 'judge' as const }))));
  const cands = candidatesOf(acc);
  const glossary = await learn.listGlossary(lang);
  const gp = planGlossary(cands, glossary, settings);
  sum.mined = { candidates: cands.size, promoted: 0, contested: gp.contested.length, revise: gp.revise.length };

  // C2 dnt from codex names, without the terms the glossary has or is about to get.
  const names = ((await store.getJson(workKey(pass, 'names'))) ?? []) as string[];
  let dntRows: LearnGlossaryRow[] = [];
  if (names.length) {
    const have = new Set([...glossary, ...gp.promote].map((g) => g.source_term.toLowerCase()));
    dntRows = dntFromCounts(names, dnt, settings.promote_min_evidence).filter((r) => !have.has(r.source_term.toLowerCase()));
    sum.dnt = 0;
  }

  // C6: contested candidates and row challenges. Never ask twice in one release: a term with an open
  // card, or a pair Haiku already judged for this build, waits (for the admin, or for the next build).
  const state = await loadState(store, lang);
  let items: HaikuItem[] = [];
  if (!state.haiku && (gp.contested.length || gp.revise.length)) {
    const openTerms = new Set((await learn.listOpenCards(lang, ['meta', 'wording', 'style'], 1000)).map((c) => c.dedupe_key));
    const seen = state.seen?.build_id === pass.build_id ? state.seen.sigs : {};
    const fresh = (x: HaikuItem) => !openTerms.has(`term:${x.source.toLowerCase()}`) && !seen[sigOf(x)];
    items = [
      ...gp.revise.map((r): HaikuItem => ({
        source: r.source, a: r.row.target_term, b: r.target, a_ev: r.row.evidence ?? 0, b_ev: r.evidence, total: r.total, keys: r.keys,
        row_id: r.row.id, row_origin: r.row.origin, examples: [],
      })),
      ...gp.contested.map((c): HaikuItem => ({
        source: c.source, a: c.a.text, b: c.b.text, a_ev: c.a_ev, b_ev: c.b_ev, total: c.total, keys: c.keys, examples: [],
      })),
    ].filter(fresh).slice(0, HAIKU_ITEMS);
  }

  // B1: CIG terms = protected rows plus the candidates CIG itself decides this run (pool cig/admin).
  let cigTerms: GlossaryRow[] = [];
  if (!state.align) {
    cigTerms = glossary.filter((g) => g.origin === 'cig' || g.origin === 'admin' || g.locked);
    const known = new Set(cigTerms.map((g) => g.source_term.toLowerCase()));
    for (const c of cands.values()) {
      if (known.has(c.source.toLowerCase())) continue;
      const a = assessCandidate(c, settings.promote_min_evidence, settings.promote_min_agreement);
      if (a.status === 'promote' && a.pool !== 'rest' && /\p{Lu}/u.test(c.source)) {
        cigTerms.push({ source_term: c.source, target_term: a.target, category: 'term', origin: 'cig' });
      }
    }
    // Only what `findMisaligned` can use travels with the plan (label rows alone are ~1 500).
    cigTerms = cigTerms.filter((g) => g.category === 'term' && g.source_term.length >= 3 && g.target_term &&
      g.source_term.toLowerCase() !== g.target_term.toLowerCase())
      .map((g) => ({ source_term: g.source_term, target_term: g.target_term, category: 'term', origin: g.origin }));
  }

  const p: LearnPlan = { rows: [...gp.promote, ...dntRows], promote: gp.promote.length, items, cigTerms };
  await store.putJson(workKey(pass, 'plan'), p);
  const next = p.rows.length ? 'insert' : (p.items.length || p.cigTerms.length ? 'detect' : 'submit');
  return commit(d, pass, { phase: next, pos: 0, state: mergeState(pass, { sum }) });
}

const sigOf = (x: Pick<HaikuItem, 'source' | 'a' | 'b'>) => `${x.source.toLowerCase()}|${x.a.toLowerCase()}|${x.b.toLowerCase()}`;

async function readPlan(d: D, pass: Pass): Promise<LearnPlan> {
  return ((await d.store.getJson(workKey(pass, 'plan'))) ?? { rows: [], promote: 0, items: [], cigTerms: [] }) as LearnPlan;
}

async function insert(d: D, pass: Pass): Promise<Pass | null> {
  const p = await readPlan(d, pass);
  const sum = stateOf(pass).sum;
  const to = Math.min(p.rows.length, pass.pos + INSERT_ROWS);
  const promote = p.rows.slice(pass.pos, Math.min(to, p.promote));
  const dnt = p.rows.slice(Math.max(pass.pos, p.promote), to);
  if (promote.length && sum.mined) sum.mined.promoted += await d.learn.insertGlossary(pass.lang, promote);
  if (dnt.length) sum.dnt = (sum.dnt ?? 0) + await d.learn.insertGlossary(pass.lang, dnt);
  if (to < p.rows.length) return commit(d, pass, { pos: to, state: mergeState(pass, { sum }) });
  const next = p.items.length || p.cigTerms.length ? 'detect' : 'submit';
  return commit(d, pass, { phase: next, pos: 0, state: mergeState(pass, { sum }) });
}

async function detect(d: D, pass: Pass): Promise<Pass | null> {
  const readers = await readersFor(d, pass);
  if (!readers) return restart(d, pass);
  const p = await readPlan(d, pass);
  const sl = await loadSlice(d.store, readers, pass.lang, pass.pos);
  const { lines, tmLines } = linesOf(sl);
  const needles = p.items.flatMap((x) => [{ src: x.source, t: x.a }, { src: x.source, t: x.b }]);
  const part: DetectPart = {
    ex: needles.length ? findExamples(lines, needles) : [],
    mis: p.cigTerms.length ? findMisaligned(tmLines, p.cigTerms) : [],
  };
  await d.store.putJson(workKey(pass, `det-${pass.pos}`), part);
  const next = pass.pos + SCAN_SHARDS;
  return commit(d, pass, next >= pass.total ? { phase: 'submit', pos: 0 } : { pos: next });
}

async function detectParts(d: D, pass: Pass): Promise<DetectPart[]> {
  const out: DetectPart[] = [];
  for (let pos = 0; pos < pass.total; pos += SCAN_SHARDS) {
    const part = (await d.store.getJson(workKey(pass, `det-${pos}`))) as DetectPart | null;
    if (part) out.push(part);
  }
  return out;
}

/**
 * Records the intent to create a batch before the provider is asked. The provider has no idempotency
 * key, so a request killed between its answer and the saved batch id leaves a paid batch nobody reads;
 * the next run finds the intent, creates the batch again and counts it (`resubmits`).
 */
async function claimIntent(d: D, pass: Pass, kind: string): Promise<Pass> {
  const st = stateOf(pass);
  const again = st.intent?.kind === kind;
  if (again) d.log('translate learning batch may exist twice', { pass: pass.id, lang: pass.lang, kind, since: st.intent!.at });
  const next = await d.passes.cas(pass, {
    state: mergeState(pass, { intent: { kind, at: d.now().toISOString() }, resubmits: again ? (st.resubmits ?? 0) + 1 : st.resubmits }),
  });
  if (!next) throw new Lost();
  return next;
}

/** A refusal with an HTTP status created nothing: the intent goes, so the retry is not counted as a duplicate. */
async function create<T>(d: D, pass: () => Pass, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (typeof (e as { status?: unknown })?.status === 'number') {
      await d.passes.cas(pass(), { state: mergeState(pass(), { intent: undefined }) });
    }
    throw e;
  }
}

async function submit(d: D, pass: Pass): Promise<Pass | null> {
  const { store, learn } = d;
  const lang = pass.lang;
  const sum = stateOf(pass).sum;
  const settings = await learn.getLearnSettings();
  const state = await loadState(store, lang);
  const p = await readPlan(d, pass);
  let cur = pass;
  const stepDone = (patch: Record<string, unknown>) =>
    commit(d, cur, { ...patch, state: mergeState(cur, { sum, intent: undefined }) });

  if (pass.pos === 0) {
    // C6: one Haiku batch, both orders.
    if (!state.haiku && p.items.length) {
      const ex = mergeExamples((await detectParts(d, pass)).map((x) => x.ex));
      const items = p.items.map((x, i) => ({ ...x, examples: [...(ex.get(2 * i) ?? []), ...(ex.get(2 * i + 1) ?? [])] }));
      const est = estimateUsd(HAIKU_MODEL, items.length * 2, 2500, items.length * 2 * 50, items.length * 2 * 400);
      const block = await spendBlock(d, settings, est);
      if (block) sum.blocked.push(`haiku:${block}`);
      else {
        const glossary = await learn.listGlossary(lang);
        cur = await claimIntent(d, cur, 'haiku');
        const id = await create(d, () => cur, () => submitLearnBatch(d, haikuRequests(lang, items, glossary)));
        state.haiku = { id, submitted_at: d.now().toISOString(), items };
        const sigs = { ...(state.seen?.build_id === pass.build_id ? state.seen.sigs : {}) };
        for (const x of items) sigs[sigOf(x)] = 1;
        state.seen = { build_id: pass.build_id, sigs };
        await store.putJson(stateKey(lang), state);
        sum.haiku = { promoted: 0, replaced: 0, cards: 0, ...sum.haiku, submitted: items.length };
      }
    }
    return stepDone({ pos: 1 });
  }

  if (pass.pos === 1) {
    // B1: align community/AI lines to CIG terms.
    if (!state.align && p.cigTerms.length) {
      const mis = mergeMisaligned((await detectParts(d, pass)).map((x) => x.mis));
      if (mis.length) {
        const chars = mis.reduce((a, l) => a + l.en.length + l.entry.t.length, 0);
        const est = estimateUsd(settings.arbiter_model, Math.ceil(mis.length / ALIGN_PER_REQUEST), 1500, Math.ceil(chars * 0.6), chars * 0.9);
        const block = await spendBlock(d, settings, est);
        if (block) sum.blocked.push(`align:${block}`);
        else {
          cur = await claimIntent(d, cur, 'align');
          const id = await create(d, () => cur, () => submitLearnBatch(d, alignRequests(lang, settings.arbiter_model, mis)));
          state.align = { id, submitted_at: d.now().toISOString(), items: mis };
          await store.putJson(stateKey(lang), state);
          sum.align = { rewritten: 0, ...sum.align, submitted: mis.length };
        }
      }
    }
    return stepDone({ pos: 2 });
  }

  // C7: web research for the top open meta/wording cards, hard monthly cap.
  if (!state.web) {
    await create(d, () => cur, () => submitWeb(d, lang, settings, state, sum, async () => {
      cur = await claimIntent(d, cur, 'web');
    }));
    if (state.web) await store.putJson(stateKey(lang), state);
  }
  // The arbiter queue (conflicts from seed/sync) advances with every pass as well.
  if (await store.getJson(learnKey(lang, 'arbiter'))) sum.arbiter = await arbitrate(d, lang, []);

  state.last = { trigger: pass.reason as LearnTrigger, at: d.now().toISOString(), build_id: pass.build_id };
  await store.putJson(stateKey(lang), state);
  const files = ['names', 'plan'];
  for (let pos = 0; pos < pass.total; pos += SCAN_SHARDS) files.push(`mine-${pos}`, `det-${pos}`);
  await deleteKeys(store, files.map((n) => workKey(pass, n)));
  // The marker 0.273.4 wrote at a publish, before passes existed.
  await store.deleteKey(learnKey(lang, 'due')).catch(() => {});
  return commit(d, cur, { status: 'done', phase: 'done', pos: 0, state: { sum } });
}

export const learnStep: PassStep = async (deps, pass) => {
  if (!hasLearn(deps)) {
    return commit(deps, pass, { status: 'done', phase: 'done', state: { sum: { lang: pass.lang, trigger: pass.reason, blocked: [], skipped: 'no_learn_db' } } });
  }
  const d = deps as D;
  try {
    switch (pass.phase) {
      case 'start': return await start(d, pass);
      case 'mine': return await mine(d, pass);
      case 'plan': return await plan(d, pass);
      case 'insert': return await insert(d, pass);
      case 'detect': return await detect(d, pass);
      case 'submit': return await submit(d, pass);
      default: throw new TranslateError('translate.pass_phase_unknown');
    }
  } catch (e) {
    if (e instanceof Lost) return null;
    throw e;
  }
};

/** Asks for a learning pass of one language (a second request while one runs makes it run once more). */
export async function requestLearning(deps: Deps, lang: string, reason: LearnTrigger): Promise<Pass | null> {
  if (!deps.learn || !deps.passes) return null;
  return await deps.passes.open({ kind: 'learn', lang, reason });
}

/**
 * Runs a whole learning pass in this process: finished batches first, then every slice.
 * For tests and scripts only. An edge request must never call it - that is the unsliced run again.
 */
export async function runLearning(deps: Deps, lang: string, trigger: LearnTrigger): Promise<LearnSummary> {
  if (!hasLearn(deps)) return { lang, trigger, blocked: [], skipped: 'no_learn_db' };
  const passes = deps.passes ?? memPasses(deps.now);
  const d = { ...deps, passes };
  const resumed = await resumeLearning(d, lang);
  let pass = await passes.open({
    kind: 'learn', lang, reason: trigger, state: { seed: { haiku: resumed.haiku, align: resumed.align, web: resumed.web } },
  });
  const steps = { learn: learnStep } as Record<PassKind, PassStep>;
  for (let i = 0; i < 100_000 && pass.status === 'open'; i++) {
    await advancePass(d, pass, steps);
    pass = (await passes.get(pass.id))!;
  }
  if (pass.status === 'failed') throw new Error(pass.error ?? 'learning pass failed');
  return stateOf(pass).sum;
}
