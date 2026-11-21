// node --test supabase/functions/translate-orchestrator/_cards_v2.test.mjs
// Card creation through the pre-filters, the KI path, conventions across languages, the P14 cleanup and
// the application of conventions / KI decisions — against an in-memory LearnDb with the v2 methods.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backRequests, parseBack } from './_back.ts';
import {
  applyAnsweredCards, cleanupMarkerKey, cleanupOpenCards, conventionsKey, createCards, routeCards, termCard, tmCard,
  upgradeLegacyCard,
} from './_cards.ts';
import { loadTm } from './_io.ts';

const ai = (t) => ({ t, o: 'ai' });
const com = (t) => ({ t, o: 'community', src: 'rjcncpt', lic: 'CC-BY-NC-SA-4.0' });
const H = (n) => n.toString(16).padStart(2, '0') + 'a'.repeat(62);

function world({ judged = ['de'], cards = [] } = {}) {
  const files = new Map();
  const store = {
    async getJson(k) { return files.has(k) ? structuredClone(files.get(k)) : null; },
    async putJson(k, v) { files.set(k, structuredClone(v)); },
    async deleteKey(k) { files.delete(k); },
  };
  const rows = cards.map((c, i) => ({ id: `old${i}`, status: 'open', ...c }));
  const glossary = [];
  let n = 0;
  const learn = {
    rows, glossary,
    async judgedLangs() { return judged; },
    async insertCard(c) {
      if (rows.some((x) => x.dedupe_key === c.dedupe_key && (x.lang ?? '*') === (c.lang ?? '*') && ['open', 'ai'].includes(x.status) && !x.applied_at)) return false;
      rows.push({ id: `c${n++}`, status: 'open', vetoed: [], ...structuredClone(c) });
      return true;
    },
    async listCards(q) {
      return rows.filter((c) => q.status.includes(c.status) && (!q.lang || c.lang === q.lang) && (!q.kinds || q.kinds.includes(c.kind))
        && (!q.undecided || !c.ai_choice) && (!q.needBack || (c.ai_choice && !c.ai_back && !c.applied_at))).slice(0, q.limit).map((c) => structuredClone(c));
    },
    async updateCard(id, patch) { Object.assign(rows.find((c) => c.id === id), structuredClone(patch)); },
    async findConvention(key) { return structuredClone(rows.find((c) => c.kind === 'convention' && c.dedupe_key === key && !c.applied_at && ['open', 'answered', 'ai'].includes(c.status)) ?? null); },
    async listAnsweredUnapplied(lang) {
      return rows.filter((c) => (c.kind === 'convention'
        ? c.langs.includes(lang) && !(c.context.applied_langs ?? []).includes(lang) && (c.status === 'answered' || (c.status === 'ai' && c.ai_choice))
        : c.lang === lang && !c.applied_at && (c.status === 'answered' || (c.status === 'ai' && c.ai_choice && (c.ai_back || c.ai_accepted_at))))).map((c) => structuredClone(c));
    },
    async listOpenCards() { return []; },
    async updateCardContext(id, ctx) { rows.find((c) => c.id === id).context = ctx; },
    async listGlossary() { return glossary.map((g) => ({ ...g })); },
    async insertGlossary(_l, rs) { for (const r of rs) glossary.push({ id: `g${glossary.length}`, ...r }); return rs.length; },
    async updateGlossary(id, p) { Object.assign(glossary.find((g) => g.id === id), p); },
    async upsertAdminRule(_l, r) { glossary.push({ ...r, origin: 'admin' }); },
  };
  const deps = { store, learn, now: () => new Date('2026-11-21T12:00:00Z'), files };
  return { deps, learn, rows, files, store };
}

const tm = (lang, i, en, a, b, key = `ui_k${i}`) => tmCard({ lang, key, keys: [key], h: H(i), en, a, b, doubt: 0.9, fresh: true, why: 'arbiter_disagreement' });

describe('createCards through P1–P7', () => {
  it('no English question is stored (P9); options carry count + examples (P10)', () => {
    const c = termCard({
      lang: 'de', source_term: 'Open', a: { text: 'Öffnen', source: 'mined', votes: 5 }, b: { text: 'Offen', source: 'mined', votes: 2 },
      spread: 10, sampleKeys: ['ui_a'], examples: [{ k: 'ui_a', en: 'Open', t: 'Öffnen' }, { k: 'ui_b', en: 'Open Hatch', t: 'Luke Öffnen' }, { k: 'ui_c', en: 'Status: Open', t: 'Status: Offen' }],
      doubt: 0.6, fresh: false, why: 'x',
    });
    assert.equal(c.question, undefined);
    assert.deepEqual(c.params, { term: 'Open', where: 'ui' });
    assert.equal(c.option_a.count, 10);
    assert.equal(c.option_a.examples.length, 3);
    assert.equal(c.option_b.examples.length, 3);
    assert.ok(c.option_b.examples.every((e) => e.text.includes('Offen')));
  });

  it('casing pairs of two languages fold into ONE convention card (P1, P8)', async () => {
    const w = world();
    await createCards(w.learn, [tm('de', 1, 'Lounge', ai('Lounge'), com('LOUNGE'))], 40, w.store, w.deps.now);
    await createCards(w.learn, [tm('pt-BR', 2, 'Medium', ai('Médio'), com('MÉDIO')), tm('de', 3, 'Cargo Hold', com('FRACHTRAUM'), ai('Frachtraum'))], 40, w.store, w.deps.now);
    const conv = w.rows.filter((c) => c.kind === 'convention');
    assert.equal(conv.length, 1);
    assert.equal(conv[0].lang, null);
    assert.deepEqual(conv[0].langs, ['de', 'pt-BR']);
    assert.equal(conv[0].spread, 3);
    assert.deepEqual(conv[0].params, { pattern: 'case.upper', langs: ['de', 'pt-BR'] });
    assert.deepEqual(conv[0].option_a.examples.map((e) => e.text), ['Lounge', 'Médio', 'Frachtraum']);
    assert.deepEqual(conv[0].option_b.examples.map((e) => e.text), ['LOUNGE', 'MÉDIO', 'FRACHTRAUM']);
    assert.equal(w.rows.filter((c) => c.kind !== 'convention').length, 0);
  });

  it('a foreign bracket and a clear majority never reach the deck (P2, P3), they are vetoable KI decisions', async () => {
    const w = world({ judged: ['de'] });
    const cards = [
      termCard({ lang: 'de', source_term: 'Weapons', a: { text: 'Waffen', source: 'mined', votes: 6 }, b: { text: 'Waffenauswahl', source: 'mined', votes: 1 }, spread: 7, sampleKeys: ['ui_w'], doubt: 1, fresh: false, why: 'x' }),
      termCard({ lang: 'it', source_term: 'Main Thruster', a: { text: 'Propulsore principale (Aegis Idris)', source: 'mined', votes: 3 }, b: { text: 'Propulsore principale (Aegis)', source: 'mined', votes: 2 }, spread: 4, sampleKeys: ['item_t'], doubt: 1, fresh: false, why: 'x' }),
    ];
    await createCards(w.learn, cards, 40, w.store, w.deps.now);
    assert.equal(w.rows.filter((c) => c.status === 'open').length, 0);
    const [weap, thr] = w.rows;
    assert.deepEqual([weap.status, weap.ai_choice, weap.ai_basis, weap.ai_unsure], ['ai', 'a', 'majority', false]);
    assert.deepEqual(weap.ai_reason, { code: 'majority', a: 6, b: 1 });
    assert.deepEqual([thr.ai_choice, thr.ai_text, thr.ai_basis, thr.ai_unsure], ['own', 'Propulsore principale', 'bracket', true]);
  });

  it('a language nobody judges gets a KI decision, a judged one an open card (P6, P7)', async () => {
    const w = world({ judged: ['de'] });
    await createCards(w.learn, [tm('de', 4, 'Open the door', ai('Öffne die Tür'), com('Tür öffnen')), tm('ja', 5, 'Confirm', ai('確認'), com('確定'))], 40, w.store, w.deps.now);
    const de = w.rows.find((c) => c.lang === 'de');
    const ja = w.rows.find((c) => c.lang === 'ja');
    assert.equal(de.status, 'open');
    assert.deepEqual([ja.status, ja.ai_choice, ja.ai_basis], ['ai', 'b', 'community']);
    // An admin adds Japanese: the next card in ja is a deck card.
    const w2 = world({ judged: ['de', 'ja'] });
    await createCards(w2.learn, [tm('ja', 5, 'Confirm', ai('確認'), com('確定'))], 40, w2.store, w2.deps.now);
    assert.equal(w2.rows[0].status, 'open');
  });

  it('a decided convention resolves later pairs of the pattern without a card', async () => {
    const w = world();
    await w.store.putJson(conventionsKey, { 'case.upper': { answer: 'a', exceptions: { 'pt-BR': 'b' } } });
    await createCards(w.learn, [tm('de', 6, 'Lounge', com('LOUNGE'), ai('Lounge')), tm('pt-BR', 7, 'Medium', ai('Médio'), com('MÉDIO'))], 40, w.store, w.deps.now);
    const [de, pt] = w.rows;
    assert.deepEqual([de.status, de.ai_text, de.ai_basis], ['ai', 'Lounge', 'convention']);
    assert.deepEqual([pt.ai_text, pt.ai_choice], ['MÉDIO', 'b']);
  });
});

describe('KI path (P12 not-mine, P6 veto)', () => {
  it('a not-mine card gets a KI decision at the next pass; a vetoed option never wins again; both vetoed → parked', async () => {
    const w = world({ judged: ['de'] });
    await createCards(w.learn, [tm('de', 8, 'Open the door', ai('Öffne die Tür'), com('Tür öffnen'))], 40, w.store, w.deps.now);
    const c = w.rows[0];
    // not_mine_translation_card: status ai without a decision
    Object.assign(c, { status: 'ai', ai_choice: null, not_mine_by: 'u1' });
    let s = await routeCards(w.deps, 'de');
    assert.equal(s.decided, 1);
    assert.deepEqual([c.status, c.ai_choice, c.ai_basis], ['ai', 'b', 'community']);
    // veto_translation_decision: b is out
    Object.assign(c, { ai_choice: null, ai_text: null, vetoed: ['b'] });
    await routeCards(w.deps, 'de');
    assert.deepEqual([c.ai_choice, c.ai_text, c.ai_unsure], ['a', 'Öffne die Tür', true]);
    Object.assign(c, { ai_choice: null, vetoed: ['b', 'a'] });
    s = await routeCards(w.deps, 'de');
    assert.equal(s.parked, 1);
    assert.equal(c.status, 'parked');
  });

  it('a convention card sent with "Nicht meine Entscheidung" is decided for every member language, not stranded (P12)', async () => {
    const w = world({ judged: ['de'] });
    await createCards(w.learn, [tm('de', 30, 'Lounge', ai('Lounge'), com('LOUNGE')), tm('it', 31, 'Medium', ai('Medio'), com('MEDIO')), tm('it', 32, 'Cargo', ai('Carico'), com('CARICO'))], 40, w.store, w.deps.now);
    const conv = w.rows.find((c) => c.kind === 'convention');
    assert.equal(conv.lang, null);
    // not_mine_translation_card on it: status ai without a decision (lang stays null)
    Object.assign(conv, { status: 'ai', ai_choice: null, not_mine_by: 'u1' });
    // the dedupe index still covers 'ai': the pattern is blocked until the card is decided
    assert.equal(await w.learn.insertCard({ ...conv, id: undefined, status: 'open' }), false);
    const s = await routeCards(w.deps, 'de');
    assert.equal(s.decided, 1, 'the convention is picked up although lang is null');
    assert.equal(conv.status, 'ai');
    assert.ok(conv.ai_choice && conv.ai_text, 'decided: choice and text');
    assert.equal(conv.ai_unsure, true, 'no evidence in the options, so an admin looks (veto list)');
    // the other member language finds it decided already
    assert.deepEqual({ ...(await routeCards(w.deps, 'it')) }, { decided: 0, parked: 0, rerouted: 0 });
    // „Sieht falsch aus“ on both sides parks it, never strands it
    Object.assign(conv, { ai_choice: null, vetoed: ['a', 'b'] });
    assert.equal((await routeCards(w.deps, 'it')).parked, 1);
    assert.equal(conv.status, 'parked');
  });

  it('a convention with more community members on one side is decided for that side', async () => {
    const w = world({ judged: ['de'] });
    await createCards(w.learn, [tm('de', 33, 'Lounge', ai('Lounge'), com('LOUNGE')), tm('de', 34, 'Cargo', ai('Fracht'), com('FRACHT'))], 40, w.store, w.deps.now);
    const conv = w.rows.find((c) => c.kind === 'convention');
    Object.assign(conv, { status: 'ai', ai_choice: null });
    await routeCards(w.deps, 'de');
    assert.equal(conv.ai_choice, 'b');
    assert.equal(conv.ai_reason.code, 'votes');
  });

  it('open cards of a language nobody judges any more are rerouted', async () => {
    const w = world({ judged: ['de'] });
    w.rows.push({ ...tm('it', 9, 'Cancel', ai('Annullare il'), com('Cancella')), id: 'x', status: 'open', vetoed: [] });
    const s = await routeCards(w.deps, 'it');
    assert.equal(s.rerouted, 1);
    assert.equal(w.rows[0].status, 'ai');
  });

  it('back-translation requests and parsing', () => {
    const items = [{ card_id: 'c1', en: 'Main Thruster', text: 'Propulsore principale' }, { card_id: 'c2', en: 'Cancel', text: 'Annulla' }];
    const reqs = backRequests('it', items);
    assert.equal(reqs.length, 1);
    assert.match(reqs[0].params.system[0].text, /German/);
    const got = parseBack(items, new Map([['b0', { custom_id: 'b0', type: 'succeeded', text: JSON.stringify({ t: ['Haupttriebwerk', 'Abbrechen'] }) }]]));
    assert.deepEqual([...got], [['c1', 'Haupttriebwerk'], ['c2', 'Abbrechen']]);
    assert.equal(parseBack(items, new Map([['b0', { custom_id: 'b0', type: 'succeeded', text: '{"t":["x"]}' }]])).size, 0);
  });
});

describe('application at the next learn pass', () => {
  it('a convention answer writes every member of the language, with the per-language exception (P8, P11)', async () => {
    const w = world();
    await createCards(w.learn, [tm('de', 10, 'Lounge', com('LOUNGE'), ai('Lounge')), tm('pt-BR', 11, 'Medium', ai('Médio'), com('MÉDIO'))], 40, w.store, w.deps.now);
    const conv = w.rows.find((c) => c.kind === 'convention');
    Object.assign(conv, { status: 'answered', answer: 'b', exceptions: { de: 'a' }, answered_by: 'u1' });
    const de = await applyAnsweredCards(w.deps, 'de');
    assert.equal(de.tm, 1);
    const tde = await loadTm(w.store, 'de');
    assert.deepEqual([tde[H(10)].t, tde[H(10)].o], ['Lounge', 'ai']);
    assert.deepEqual(conv.context.applied_langs, ['de']);
    assert.ok(conv.applied_at);
    const pt = await applyAnsweredCards(w.deps, 'pt-BR');
    assert.equal(pt.tm, 1);
    const tpt = await loadTm(w.store, 'pt-BR');
    assert.deepEqual([tpt[H(11)].t, tpt[H(11)].o], ['MÉDIO', 'community']);
    assert.deepEqual(conv.context.applied_langs, ['de', 'pt-BR']);
    assert.deepEqual(w.files.get(conventionsKey)['case.upper'], { answer: 'b', exceptions: { de: 'a' } });
    // applied once per language
    assert.equal((await applyAnsweredCards(w.deps, 'de')).applied, 0);
  });

  it('a KI decision is taken over once its back-translation is there (doing nothing accepts)', async () => {
    const w = world({ judged: ['de'] });
    await createCards(w.learn, [tm('it', 12, 'Offline', ai('Spento'), com('Disconnesso'))], 40, w.store, w.deps.now);
    const c = w.rows[0];
    assert.equal((await applyAnsweredCards(w.deps, 'it')).applied, 0); // no back-translation yet, not accepted
    c.ai_back = 'Getrennt';
    const s = await applyAnsweredCards(w.deps, 'it');
    assert.deepEqual([s.applied, s.ai], [1, 1]);
    const t = await loadTm(w.store, 'it');
    assert.deepEqual([t[H(12)].t, t[H(12)].o], ['Disconnesso', 'community']);
    assert.ok(c.applied_at);
  });
});

describe('P14 cleanup of the existing open cards', () => {
  const legacy = (lang, i, en, a, b, extra = {}) => ({
    lang, kind: 'wording', question: `Which translation fits "${en}" better?`,
    option_a: { text: a.t, source: a.o === 'community' ? 'community:rjcncpt' : a.o }, option_b: { text: b.t, source: b.o === 'community' ? 'community:rjcncpt' : b.o },
    context: { type: 'tm', key: `ui_k${i}`, keys: [`ui_k${i}`], h: H(i), en, entries: { a, b } }, spread: 1, reach: 3, doubt: 1, fresh: true, dedupe_key: `tm:${H(i)}`, impact: 1, ...extra,
  });
  it('folds, decides, keeps and re-ranks once; a second run is a no-op', async () => {
    const term = {
      lang: 'de', kind: 'meta', question: 'How should "Weapons" be translated everywhere?',
      option_a: { text: 'Waffen', source: 'mined (6×)' }, option_b: { text: 'Waffenauswahl', source: 'mined (1×)' },
      context: { type: 'term', term: 'Weapons', en: 'Weapons', keys: ['ui_w'] }, spread: 7, reach: 3, doubt: 1, fresh: false, dedupe_key: 'term:weapons', impact: 7,
    };
    const w = world({
      judged: ['de'],
      cards: [
        legacy('de', 20, 'Lounge', ai('Lounge'), com('LOUNGE')),
        legacy('de', 21, 'Passenger Quarters', ai('Passagierquartiere'), com('PASSAGIER-QUARTIERE')),
        legacy('de', 22, 'Open the door', ai('Öffne die Tür'), com('Tür öffnen')),
        legacy('it', 23, 'Offline', ai('Spento'), com('Disconnesso')),
        term,
      ],
    });
    const s = await cleanupOpenCards(w.deps);
    assert.deepEqual({ ...s }, { seen: 5, decided: 2, folded: 2, open: 1 });
    const by = Object.fromEntries(w.rows.map((r) => [r.dedupe_key, r]));
    assert.equal(by[`tm:${H(20)}`].status, 'folded');
    const conv = w.rows.find((r) => r.kind === 'convention');
    assert.equal(conv.spread, 2);
    const kept = by[`tm:${H(22)}`];
    assert.equal(kept.status, 'open');
    assert.ok(kept.doubt < 1, `doubt ${kept.doubt} recomputed`);
    assert.equal(kept.option_a.examples.length, 1);
    assert.equal(by[`tm:${H(23)}`].status, 'ai');
    assert.deepEqual([by['term:weapons'].ai_basis, by['term:weapons'].option_a.votes, by['term:weapons'].option_a.source], ['majority', 6, 'mined']);
    assert.ok(w.files.get(cleanupMarkerKey));
    const again = await cleanupOpenCards(w.deps);
    assert.equal(again.skipped, 'done');
  });
  describe('an interrupted run loses no convention member', () => {
    const rows = () => [
      legacy('de', 20, 'Lounge', ai('Lounge'), com('LOUNGE')),
      legacy('de', 21, 'Passenger Quarters', ai('Passagierquartiere'), com('PASSAGIER-QUARTIERE')),
      legacy('it', 24, 'Medium', ai('Medio'), com('MEDIO')),
    ];
    const members = (w) => w.rows.filter((r) => r.kind === 'convention').flatMap((r) => r.context.members.map((m) => m.h)).sort();
    it('crash while folding: the convention already holds every member, the rerun finishes without duplicates', async () => {
      const w = world({ judged: ['de'], cards: rows() });
      const real = w.learn.updateCard;
      let calls = 0;
      w.learn.updateCard = async (id, patch) => {
        // the convention is created by insertCard, so the first updateCard is a fold: die on the second one
        if (++calls === 2) throw new Error('boom');
        return real(id, patch);
      };
      await assert.rejects(cleanupOpenCards(w.deps), /boom/);
      assert.equal(w.files.get(cleanupMarkerKey), undefined, 'no marker after a crash');
      assert.deepEqual(members(w), [H(20), H(21), H(24)].sort(), 'no member only lives in an already folded row');
      w.learn.updateCard = real;
      const s = await cleanupOpenCards(w.deps);
      assert.ok(!s.skipped);
      assert.deepEqual(members(w), [H(20), H(21), H(24)].sort());
      assert.equal(w.rows.filter((r) => r.kind === 'convention').length, 1);
      assert.ok(w.rows.filter((r) => r.id.startsWith('old')).every((r) => r.status === 'folded' || r.context.v2));
      assert.ok(w.files.get(cleanupMarkerKey));
    });
    it('crash while writing the convention: every old row is untouched and the rerun does it all', async () => {
      const w = world({ judged: ['de'], cards: rows() });
      const real = w.learn.insertCard;
      w.learn.insertCard = async () => { throw new Error('boom'); };
      await assert.rejects(cleanupOpenCards(w.deps), /boom/);
      assert.ok(w.rows.every((r) => r.status === 'open' && !r.context.v2), 'nothing was folded');
      w.learn.insertCard = real;
      await cleanupOpenCards(w.deps);
      assert.deepEqual(members(w), [H(20), H(21), H(24)].sort());
    });
  });
  it('legacy votes move out of the source text', () => {
    const c = upgradeLegacyCard({ lang: 'de', kind: 'meta', option_a: { text: 'A', source: 'mined (13×)' }, option_b: { text: 'B', source: 'glossary (3×)' }, context: { type: 'term', term: 'X' }, spread: 4 });
    assert.deepEqual([c.option_a.votes, c.option_a.source, c.option_b.votes, c.option_b.source], [13, 'mined', 3, 'glossary']);
    assert.ok(c.doubt < 0.5);
  });
});
