import de from '../../../../../public/i18n/de.json';
import en from '../../../../../public/i18n/en.json';
import {
  barPct,
  boardName,
  canException,
  canOwnText,
  cardErrorKey,
  cardKeyAction,
  cardQuestion,
  defaultLang,
  examplesOf,
  finishSummary,
  isJudged,
  kiTargetLang,
  langRows,
  needsReload,
  optionLabel,
  rankLine,
  reasonText,
  ringDash,
  swipeAction,
  swipeDirection,
} from './cards.logic';
import { board, conventionCard, kiCard, termCard } from './cards.testing';

const key = (k: string, extra: Record<string, unknown> = {}) => ({ key: k, target: null, ...extra });

describe('Karteikarten logic: hotkeys', () => {
  it('maps the card keys: ←/1 and →/2 answer, E own text, ↑ not mine, A exception', () => {
    expect(cardKeyAction(key('ArrowLeft'), 'card', false)).toEqual({ kind: 'pick', choice: 'a' });
    expect(cardKeyAction(key('1'), 'card', false)).toEqual({ kind: 'pick', choice: 'a' });
    expect(cardKeyAction(key('ArrowRight'), 'card', false)).toEqual({ kind: 'pick', choice: 'b' });
    expect(cardKeyAction(key('2'), 'card', false)).toEqual({ kind: 'pick', choice: 'b' });
    expect(cardKeyAction(key('e'), 'card', false)).toEqual({ kind: 'own' });
    expect(cardKeyAction(key('E'), 'card', false)).toEqual({ kind: 'own' });
    expect(cardKeyAction(key('ArrowUp'), 'card', false)).toEqual({ kind: 'notMine' });
    expect(cardKeyAction(key('a'), 'card', false)).toEqual({ kind: 'exception' });
  });

  it('Enter turns the deck and skips the moment, never while a button has focus', () => {
    expect(cardKeyAction(key('Enter'), 'cover', false)).toEqual({ kind: 'turn' });
    expect(cardKeyAction(key('Enter'), 'moment', false)).toEqual({ kind: 'turn' });
    expect(cardKeyAction(key('Enter', { target: { tagName: 'BUTTON' } }), 'cover', false)).toBeNull();
    expect(cardKeyAction(key('ArrowLeft'), 'cover', false)).toBeNull();
  });

  it('on a KI card ← is „Sieht falsch aus“, → „Passt“, E own text', () => {
    expect(cardKeyAction(key('ArrowLeft'), 'veto', false)).toEqual({ kind: 'wrong' });
    expect(cardKeyAction(key('ArrowRight'), 'veto', false)).toEqual({ kind: 'ok' });
    expect(cardKeyAction(key('e'), 'veto', false)).toEqual({ kind: 'own' });
    expect(cardKeyAction(key('ArrowUp'), 'veto', false)).toBeNull();
  });

  it('Ctrl/⌘+Z undoes and ? (with Shift) opens the key sheet in every mode', () => {
    expect(cardKeyAction(key('z', { ctrlKey: true }), 'idle', false)).toEqual({ kind: 'undo' });
    expect(cardKeyAction(key('Z', { metaKey: true }), 'card', false)).toEqual({ kind: 'undo' });
    expect(cardKeyAction(key('?', { shiftKey: true }), 'idle', false)).toEqual({ kind: 'keys' });
  });

  it('stays quiet while typing, under a dialog, on repeats and with other modifiers', () => {
    expect(cardKeyAction(key('e', { target: { tagName: 'INPUT' } }), 'card', false)).toBeNull();
    expect(cardKeyAction(key('e', { target: { tagName: 'DIV', isContentEditable: true } }), 'card', false)).toBeNull();
    expect(cardKeyAction(key('ArrowLeft'), 'card', true)).toBeNull();
    expect(cardKeyAction(key('ArrowLeft', { repeat: true }), 'card', false)).toBeNull();
    expect(cardKeyAction(key('ArrowLeft', { altKey: true }), 'card', false)).toBeNull();
    expect(cardKeyAction(key('ArrowLeft', { shiftKey: true }), 'card', false)).toBeNull();
    expect(cardKeyAction(key('z', { ctrlKey: true, shiftKey: true }), 'card', false)).toBeNull();
  });
});

describe('Karteikarten logic: swipe', () => {
  it('the longer axis wins; short and downward drags are no swipe', () => {
    expect(swipeDirection(-90, 10)).toBe('left');
    expect(swipeDirection(90, -20)).toBe('right');
    expect(swipeDirection(10, -90)).toBe('up');
    expect(swipeDirection(10, 90)).toBeNull();
    expect(swipeDirection(40, 5)).toBeNull();
  });

  it('left/right = the two halves, up = not mine; on a KI card left/right = wrong/ok', () => {
    expect(swipeAction('left', 'card')).toEqual({ kind: 'pick', choice: 'a' });
    expect(swipeAction('right', 'card')).toEqual({ kind: 'pick', choice: 'b' });
    expect(swipeAction('up', 'card')).toEqual({ kind: 'notMine' });
    expect(swipeAction('left', 'veto')).toEqual({ kind: 'wrong' });
    expect(swipeAction('right', 'veto')).toEqual({ kind: 'ok' });
    expect(swipeAction('up', 'veto')).toBeNull();
    expect(swipeAction('left', 'cover')).toBeNull();
    expect(swipeAction(null, 'card')).toBeNull();
  });
});

describe('Karteikarten logic: questions from templates (P9)', () => {
  it('a convention asks by its pattern and names its options by the rule', () => {
    const c = conventionCard();
    expect(cardQuestion(c)).toEqual({ key: 'admin.translations.cards.q.case_upper' });
    expect(optionLabel(c, 'b')).toEqual({ key: 'admin.translations.cards.opt.case_upper.b' });
    expect(canException(c)).toBe(true);
    expect(canOwnText(c)).toBe(false);
  });

  it('term and wording cards carry their English subject as a parameter and show the option text itself', () => {
    const t = termCard();
    expect(cardQuestion(t)).toEqual({ key: 'admin.translations.cards.q.term', params: { term: 'Open' } });
    expect(optionLabel(t, 'a')).toEqual({ text: 'Öffnen' });
    const w = termCard('w1', { kind: 'wording', params: { en: 'Open the door', key: 'ui_door', where: 'ui' } });
    expect(cardQuestion(w)).toEqual({ key: 'admin.translations.cards.q.wording', params: { en: 'Open the door' } });
    expect(canException(t)).toBe(false);
    expect(canOwnText(t)).toBe(true);
  });

  it('shows at most three examples (P10)', () => {
    const o = { text: 'x', source: 'ai', examples: [1, 2, 3, 4].map((i) => ({ lang: 'de', key: `k${i}`, en: `e${i}`, text: `t${i}` })) };
    expect(examplesOf(o).map((e) => e.text)).toEqual(['t1', 't2', 't3']);
  });

  it('renders a KI reason from its code, the larger number first', () => {
    expect(reasonText(kiCard().ai!)).toEqual({ key: 'admin.translations.cards.reason.bracket' });
    const ai = { ...kiCard().ai!, reason: { code: 'majority' as const, a: 1, b: 6 } };
    expect(reasonText(ai)).toEqual({ key: 'admin.translations.cards.reason.majority', params: { a: 6, b: 1 } });
  });
});

describe('Karteikarten logic: boxes', () => {
  it('one row per language: own deck with open count, KI languages with decided and unsure counts', () => {
    const rows = langRows(board());
    expect(rows[0]).toEqual({ lang: 'de', judged: true, line: { key: 'admin.translations.cards.row.deck', params: { count: 10 } }, unsure: 0 });
    expect(rows[1]).toEqual({ lang: 'it', judged: false, line: { key: 'admin.translations.cards.row.ki', params: { count: 67 } }, unsure: 3 });
    const clear = langRows(board({ langs: [{ lang: 'de', judged: true, deck_open: 0, ai_decided: 0, ai_review: 0, ai_unsure: 0, ai_pending: 0 }] }));
    expect(clear[0].line).toEqual({ key: 'admin.translations.cards.row.clear' });
  });

  it('the KI row leads to the language with the most unsure decisions; none when every language is judged', () => {
    expect(kiTargetLang(board())).toBe('it');
    expect(kiTargetLang(board({ langs: board().langs.map((l) => ({ ...l, judged: true })) }))).toBeNull();
  });

  it('opens the requested language, else the first own one; judged = in my_langs', () => {
    expect(defaultLang(board(), null)).toBe('de');
    expect(defaultLang(board(), 'it')).toBe('it');
    expect(defaultLang(null, null)).toBe('de');
    expect(isJudged(board(), 'de')).toBe(true);
    expect(isJudged(board(), 'it')).toBe(false);
  });

  it('names the leaderboard: „Du“ for the own row, the display name, a neutral fallback for null (G4)', () => {
    const [nova, me, unnamed] = board().leaderboard;
    expect(boardName(nova)).toEqual({ text: 'Nova' });
    expect(boardName(me)).toEqual({ key: 'admin.translations.cards.stats.you' });
    expect(boardName(unnamed)).toEqual({ key: 'admin.translations.cards.stats.unnamed' });
    expect(boardName({ ...unnamed, name: '   ' })).toEqual({ key: 'admin.translations.cards.stats.unnamed' });
  });

  it('computes the gap to the next place, or the lead on place 1', () => {
    expect(rankLine(board())).toEqual({ key: 'admin.translations.cards.stats.gap', params: { points: 240, place: 1 } });
    const first = board({
      week: { ...board().week, rank: 1, points: 1620 },
      leaderboard: [
        { user_id: 'me', name: 'J', points: 1620, rank: 1, is_me: true },
        { user_id: 'u1', name: 'Nova', points: 1480, rank: 2, is_me: false },
      ],
    });
    expect(rankLine(first)).toEqual({ key: 'admin.translations.cards.stats.lead', params: { points: 140 } });
    expect(barPct(310, board().leaderboard)).toBe(21);
  });

  it('draws the goal ring as a share of its circumference', () => {
    const c = (2 * Math.PI * 66).toFixed(1);
    expect(ringDash(0, 10, 66)).toBe(`0.0 ${c}`);
    expect(ringDash(15, 10, 66)).toBe(`${c} ${c}`);
  });
});

describe('Karteikarten logic: finish and errors', () => {
  it('sums the session: cards, texts of the chosen options, base points and the bonus', () => {
    const s = finishSummary([
      { card: conventionCard(), choice: 'a', text: 'Normal', points: 20, bonus: 0 },
      { card: termCard(), choice: 'b', text: 'Offen', points: 20, bonus: 180 },
    ]);
    expect(s).toEqual({ cards: 2, texts: 18, points: 220, base: 40, bonus: 180 });
  });

  it('maps the card RPC refusals to their own keys and reloads on gone / applied', () => {
    expect(cardErrorKey('answer', { code: '22023', message: 'x' })).toBe('errors.translation.cards.invalid');
    expect(cardErrorKey('answer', { code: 'P0002', message: 'x' })).toBe('errors.translation.cards.gone');
    expect(cardErrorKey('undo', { code: '55000', message: 'x' })).toBe('errors.translation.cards.applied');
    expect(cardErrorKey('board', { code: '42501', message: 'x' })).toBe('errors.translation.cards.forbidden');
    expect(cardErrorKey('board', new TypeError('Failed to fetch'))).toMatch(/^errors\./);
    expect(needsReload('errors.translation.cards.gone')).toBe(true);
    expect(needsReload('errors.translation.cards.invalid')).toBe(false);
  });
});

describe('Karteikarten i18n (X1)', () => {
  const leaves = (o: unknown, p = ''): string[] =>
    o && typeof o === 'object' ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k)) : [p];
  const has = (cat: unknown, k: string) => typeof k.split('.').reduce<unknown>((n, part) => (n as Record<string, unknown> | undefined)?.[part], cat) === 'string';

  it('de and en carry the same card keys', () => {
    expect(leaves(de.admin.translations.cards).sort()).toEqual(leaves(en.admin.translations.cards).sort());
  });

  it('every template, option, reason and error key the cards produce exists in both catalogues', () => {
    const patterns = ['case.upper', 'case.title', 'compound', 'verb.form', 'abbr'] as const;
    const keys: string[] = [];
    for (const p of patterns) {
      const c = conventionCard('c', { params: { pattern: p, langs: ['de'] } });
      keys.push(cardQuestion(c).key!, optionLabel(c, 'a').key!, optionLabel(c, 'b').key!);
    }
    keys.push(cardQuestion(termCard()).key!, cardQuestion(termCard('w', { kind: 'wording', params: { en: 'x', key: 'k', where: null } })).key!);
    for (const code of ['majority', 'community', 'ai', 'votes', 'bracket', 'whitespace', 'casing_source', 'convention', 'only_left'] as const) {
      keys.push(reasonText({ ...kiCard().ai!, reason: { code } }).key!);
    }
    for (const code of ['22023', 'P0002', '55000', '42501']) keys.push(cardErrorKey('x', { code }));
    for (const k of keys) {
      expect(has(de, k), `de: ${k}`).toBe(true);
      expect(has(en, k), `en: ${k}`).toBe(true);
    }
  });
});
