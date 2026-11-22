// node --test supabase/functions/translate-orchestrator/_card_filters.test.mjs
// Card pre-filters P1–P6 (concept 20261121-1151-karteikarten-neu) on the real cards of 2026-11-21.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abbreviationPattern, classifyPair, clearMajority, conventionExamples, conventionPick, disagreementDoubt, kiDecide,
  mergeMembers, recomputeDoubt, spellingPattern, stripForeignBrackets, termExamples, verbFormPattern,
} from './_card_filters.ts';
import { bothOrders } from './_arbiter.ts';

const com = (text, votes) => ({ text, source: 'community:rjcncpt', votes });
const ai = (text) => ({ text, source: 'ai' });
const mined = (text, votes) => ({ text, source: 'mined', votes });

describe('P2 stripForeignBrackets', () => {
  it('cuts a ship name the English does not have', () => {
    assert.equal(stripForeignBrackets('Propulsore principale (Aegis Idris)', 'Main Thruster'), 'Propulsore principale');
  });
  it('keeps a bracket the English has, tokens and numbers', () => {
    assert.equal(stripForeignBrackets('Laser (S2)', 'Laser (S2)'), 'Laser (S2)');
    assert.equal(stripForeignBrackets('Wert [%s]', 'Value [%s]'), 'Wert [%s]');
    assert.equal(stripForeignBrackets('Stufe (1)', 'Tier'), 'Stufe (1)');
  });
  it('both candidates equal after the cut → resolved, no card', () => {
    const c = classifyPair({ lang: 'it', en: 'Main Thruster', a: mined('Propulsore principale (Aegis Idris)', 3), b: mined('Propulsore principale (Aegis)', 2) });
    assert.deepEqual(c, { type: 'resolved', choice: 'own', text: 'Propulsore principale', basis: 'bracket' });
  });
  it('one candidate keeps its text when only the other had the addition', () => {
    const c = classifyPair({ lang: 'it', en: 'Main Thruster', a: mined('Propulsore principale', 3), b: mined('Propulsore principale (Aegis)', 2) });
    assert.equal(c.type, 'resolved');
    assert.equal(c.choice, 'a');
  });
});

describe('P1 spelling → one convention per pattern', () => {
  it('all caps vs normal, normal is option a', () => {
    assert.deepEqual(spellingPattern('Lounge', 'LOUNGE', 'Lounge'), { pattern: 'case.upper', optA: 'a' });
    assert.deepEqual(spellingPattern('PASSAGIER-QUARTIERE', 'Passagierquartiere', 'Passenger Quarters'), { pattern: 'case.upper', optA: 'b' });
  });
  it('the English written in caps decides without a question', () => {
    const c = classifyPair({ lang: 'de', en: 'LOUNGE', a: ai('Lounge'), b: com('LOUNGE') });
    assert.equal(c.type, 'resolved');
    assert.equal(c.basis, 'casing_source');
    assert.equal(c.text, 'LOUNGE');
  });
  it('title case and hyphen splits are their own patterns; whitespace only is resolved', () => {
    assert.equal(spellingPattern('Tür öffnen', 'Tür Öffnen', 'Open door').pattern, 'case.title');
    assert.equal(spellingPattern('Frachtraum', 'Fracht-Raum', 'Cargo Hold').pattern, 'compound');
    const w = classifyPair({ lang: 'de', en: 'Cargo', a: ai('Fracht  raum'), b: com('Fracht raum') });
    assert.equal(w.type, 'resolved');
    assert.equal(w.basis, 'whitespace');
  });
  it('the pair is oriented onto the pattern (swapped)', () => {
    const c = classifyPair({ lang: 'de', en: 'Passenger Quarters', a: com('PASSAGIER-QUARTIERE'), b: ai('Passagierquartiere') });
    assert.deepEqual(c, { type: 'convention', pattern: 'case.upper', a: 'Passagierquartiere', b: 'PASSAGIER-QUARTIERE', swapped: true });
  });
  it('a casing pair never becomes an A/B card even with a clear majority', () => {
    assert.equal(classifyPair({ lang: 'de', en: 'Lounge', a: mined('Lounge', 12), b: mined('LOUNGE', 1) }).type, 'convention');
  });
});

describe('P4 patterns', () => {
  it('Italian imperative vs infinitive', () => {
    assert.deepEqual(verbFormPattern('Annulla', 'Annullare', 'it'), { pattern: 'verb.form', optA: 'a' });
    assert.deepEqual(verbFormPattern('Confermare', 'Conferma', 'it'), { pattern: 'verb.form', optA: 'b' });
    assert.equal(verbFormPattern('Annulla', 'Annullare', 'de'), null);
    assert.equal(verbFormPattern('Chiudi la porta adesso subito', 'Chiudere', 'it'), null);
  });
  it('Japanese synonyms stay a real card', () => {
    assert.equal(classifyPair({ lang: 'ja', en: 'Confirm', a: mined('確認', 3), b: mined('確定', 2) }).type, 'card');
  });
  it('abbreviation vs spelled out, the abbreviation is option a', () => {
    assert.deepEqual(abbreviationPattern('QUARTIERE DES ERSTEN OFFIZIERS', 'XO-Quartiere', 'XO Quarters'), { pattern: 'abbr', optA: 'b' });
    const c = classifyPair({ lang: 'de', en: 'XO Quarters', a: ai('XO-Quartiere'), b: com('QUARTIERE DES ERSTEN OFFIZIERS') });
    assert.equal(c.type, 'convention');
    assert.equal(c.pattern, 'abbr');
    assert.equal(c.a, 'XO-Quartiere');
  });
});

describe('P3 clearMajority', () => {
  it('≥ 5 votes and ≥ 4 : 1', () => {
    assert.equal(clearMajority(6, 1), 'a');
    assert.equal(clearMajority(3, 13), 'b');
    assert.equal(clearMajority(4, 1), 'a');
    assert.equal(clearMajority(3, 1), null); // 4 votes
    assert.equal(clearMajority(7, 2), null); // 3.5 : 1
    assert.equal(clearMajority(5, 0), 'a');
  });
  it('decides a term pair without a card ("Waffen" 6× vs "Waffenauswahl" 1×)', () => {
    const c = classifyPair({ lang: 'de', en: 'Weapons', a: mined('Waffen', 6), b: mined('Waffenauswahl', 1) });
    assert.deepEqual(c, { type: 'resolved', choice: 'a', text: 'Waffen', basis: 'majority', votes: [6, 1] });
  });
  it('without a majority it stays a card', () => {
    assert.equal(classifyPair({ lang: 'de', en: 'Open', a: mined('Öffnen', 5), b: mined('Offen', 2) }).type, 'card');
  });
});

describe('P5 doubt ranks again', () => {
  it('opposite verdicts no longer all sit at 1.0', () => {
    const sure = bothOrders({ w: 'A', c: 0.95 }, { w: 'A', c: 0.9 });
    const shrug = bothOrders({ w: 'A', c: 0.3 }, { w: 'A', c: 0.2 });
    assert.equal(sure.outcome, 'card');
    assert.equal(shrug.outcome, 'card');
    assert.ok(sure.doubt > shrug.doubt, `${sure.doubt} > ${shrug.doubt}`);
    assert.ok(shrug.doubt < 1);
    assert.equal(disagreementDoubt(0, 0), 0.5);
  });
  it('existing cards get a doubt from votes or text distance', () => {
    const close = recomputeDoubt({ a: mined('Öffnen', 5), b: mined('Offen', 5) });
    const clear = recomputeDoubt({ a: mined('Öffnen', 12), b: mined('Offen', 1) });
    assert.ok(close > clear);
    const small = recomputeDoubt({ a: ai('Frachtraum'), b: com('Frachtraeume') });
    const big = recomputeDoubt({ a: ai('Frachtraum'), b: com('Laderaum des Schiffes') });
    assert.ok(big > small);
    assert.equal(recomputeDoubt({ a: ai('x'), b: com('y'), judge: { f: 0.2, r: 0.2 } }), 0.6);
  });
});

describe('P6 kiDecide tie-break', () => {
  it('clear majority first, not unsure', () => {
    const d = kiDecide({ a: mined('Annullare', 3), b: mined('Annulla', 13), doubt: 1 });
    assert.equal(d.choice, 'b');
    assert.equal(d.basis, 'majority');
    assert.equal(d.unsure, false);
    assert.deepEqual(d.reason, { code: 'majority', a: 3, b: 13 });
  });
  it('then the community text, unsure only with high doubt', () => {
    assert.deepEqual(
      kiDecide({ a: ai('Spento'), b: com('Disconnesso'), doubt: 0.6 }),
      { choice: 'b', text: 'Disconnesso', basis: 'community', unsure: false, reason: { code: 'community' } },
    );
    assert.equal(kiDecide({ a: ai('Spento'), b: com('Disconnesso'), doubt: 0.9 }).unsure, true);
  });
  it('then the AI text (unsure); two mined without a majority → more votes (unsure)', () => {
    const d = kiDecide({ a: { text: 'X', source: 'glossary' }, b: ai('Y'), doubt: 0.5 });
    assert.equal(d.choice, 'b');
    assert.equal(d.basis, 'ai');
    assert.equal(d.unsure, true);
    const v = kiDecide({ a: mined('確認', 3), b: mined('確定', 2), doubt: 0.5 });
    assert.equal(v.choice, 'a');
    assert.equal(v.basis, 'votes');
  });
  it('a vetoed option never wins again; both vetoed → parked (null)', () => {
    const d = kiDecide({ a: ai('Spento'), b: com('Disconnesso'), doubt: 0.6, vetoed: ['b'] });
    assert.equal(d.choice, 'a');
    assert.equal(d.basis, 'only_left');
    assert.equal(d.unsure, true);
    assert.equal(kiDecide({ a: ai('Spento'), b: com('Disconnesso'), doubt: 0.6, vetoed: ['a', 'b'] }), null);
  });
});

describe('P10 examples, P8 exceptions', () => {
  it('three examples per option with the option applied', () => {
    const lines = [
      { k: 'ui_door_open', en: 'Open', t: 'Öffnen' },
      { k: 'ui_hatch', en: 'Open Hatch', t: 'Luke Öffnen' },
      { k: 'ui_status', en: 'Status: Open', t: 'Status: Offen' },
      { k: 'ui_cargo', en: 'Open Cargo', t: 'Fracht Öffnen' },
    ];
    const ex = termExamples('de', lines, 'Öffnen', 'Offen');
    assert.equal(ex.a.length, 3);
    assert.equal(ex.b.length, 3);
    assert.ok(ex.a.every((e) => e.text.includes('Öffnen')));
    assert.ok(ex.b.every((e) => e.text.includes('Offen')));
    assert.equal(ex.b[0].text, 'Status: Offen');
  });
  it('convention examples spread over languages', () => {
    const m = (lang, key, a, b) => ({ lang, key, en: key, a, b, type: 'tm' });
    const ex = conventionExamples([m('de', 'k1', 'Schließen', 'SCHLIESSEN'), m('de', 'k2', 'Frachtraum', 'FRACHTRAUM'), m('pt-BR', 'k3', 'Médio', 'MÉDIO'), m('de', 'k4', 'x', 'X')]);
    assert.deepEqual(ex.a.map((e) => e.lang), ['de', 'pt-BR', 'de']);
    assert.deepEqual(ex.b.map((e) => e.text), ['SCHLIESSEN', 'MÉDIO', 'FRACHTRAUM']);
    assert.equal(mergeMembers([m('de', 'k1', 'a', 'A')], [m('de', 'k1', 'b', 'B'), m('it', 'k1', 'c', 'C')]).length, 2);
  });
  it('one answer for all languages, an exception per language', () => {
    assert.equal(conventionPick('a', { it: 'b' }, 'de'), 'a');
    assert.equal(conventionPick('a', { it: 'b' }, 'it'), 'b');
    assert.equal(conventionPick('b', null, 'ru'), 'b');
  });
});
