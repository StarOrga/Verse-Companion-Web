/**
 * Fixtures of the Karteikarten tab in the shape of the v2 contract
 * (docs/concepts/20261121-1151-karteikarten-neu/contract.md). Shared by the specs and the visual harness;
 * imported by specs only (not part of tsconfig.app.json).
 */
import type { CardBoard, CardDeck, TranslationCard, VetoList } from '../translations.service';

const ex = (lang: string, key: string, en: string, text: string) => ({ lang, key, en, text });

export function conventionCard(id = 'conv1', extra: Partial<TranslationCard> = {}): TranslationCard {
  return {
    id,
    kind: 'convention',
    lang: null,
    langs: ['de', 'it', 'ja', 'pt-BR', 'ru'],
    params: { pattern: 'case.upper', langs: ['de', 'it', 'ja', 'pt-BR', 'ru'] },
    option_a: {
      text: 'Schließen',
      source: 'pattern',
      count: 14,
      examples: [ex('de', 'ui_close', 'Close', 'Schließen'), ex('de', 'ui_cargo', 'Cargo Hold', 'Frachtraum'), ex('pt-BR', 'ui_mid', 'Medium', 'Médio')],
    },
    option_b: {
      text: 'SCHLIESSEN',
      source: 'pattern',
      count: 14,
      examples: [ex('de', 'ui_close', 'Close', 'SCHLIESSEN'), ex('de', 'ui_cargo', 'Cargo Hold', 'FRACHTRAUM'), ex('pt-BR', 'ui_mid', 'Medium', 'MÉDIO')],
    },
    spread: 14,
    reach: 3,
    doubt: 0.4,
    fresh: true,
    status: 'open',
    answer: null,
    own_text: null,
    exceptions: null,
    points: 0,
    bonus: 0,
    ai: null,
    vetoed: [],
    can_undo: false,
    created_at: '2026-11-21T10:00:00Z',
    ...extra,
  };
}

export function termCard(id = 'term1', extra: Partial<TranslationCard> = {}): TranslationCard {
  return {
    ...conventionCard(id),
    kind: 'term',
    lang: 'de',
    langs: ['de'],
    params: { term: 'Open', where: 'ui' },
    option_a: {
      text: 'Öffnen',
      source: 'community:1',
      votes: 5,
      count: 10,
      examples: [ex('de', 'door_sw', 'Door switch', 'Öffnen'), ex('de', 'cargo_hatch', 'Cargo hatch', 'Öffnen'), ex('de', 'door_state', 'Door state', 'Öffnen')],
    },
    option_b: {
      text: 'Offen',
      source: 'ai',
      votes: 2,
      count: 4,
      examples: [ex('de', 'door_sw', 'Door switch', 'Offen'), ex('de', 'cargo_hatch', 'Cargo hatch', 'Offen'), ex('de', 'door_state', 'Door state', 'Offen')],
    },
    spread: 10,
    ...extra,
  };
}

export function kiCard(id = 'ki1', extra: Partial<TranslationCard> = {}): TranslationCard {
  return {
    ...termCard(id),
    lang: 'it',
    langs: ['it'],
    params: { term: 'Main Thruster', where: 'item' },
    option_a: { text: 'Propulsore principale (Aegis Idris)', source: 'community:2' },
    option_b: { text: 'Propulsore principale', source: 'ai' },
    spread: 4,
    status: 'ai',
    ai: {
      choice: 'own',
      text: 'Propulsore principale',
      basis: 'bracket',
      reason: { code: 'bracket' },
      unsure: true,
      back_de: 'Haupttriebwerk',
      decided_at: '2026-11-21T09:00:00Z',
      accepted: false,
    },
    ...extra,
  };
}

export function deckOf(cards: TranslationCard[], extra: Partial<CardDeck> = {}): CardDeck {
  return { lang: 'de', open_total: 54, affected_total: 300, deck_affected: 74, cards, ...extra };
}

export function vetoOf(items: TranslationCard[], extra: Partial<VetoList> = {}): VetoList {
  return { lang: 'it', total: items.length, unsure: items.filter((i) => i.ai?.unsure).length, items, ...extra };
}

export function board(extra: Partial<CardBoard> = {}): CardBoard {
  return {
    rules: { points: 20, goal: 10, bonus: 180, tz: 'Europe/Berlin' },
    my_langs: ['de'],
    goal: { done: 0, target: 10, full: false, bonus_taken: false },
    streak_days: 3,
    week: {
      start: '2026-11-16',
      points: 1240,
      rank: 2,
      days: ['16', '17', '18', '19', '20', '21', '22'].map((d, i) => ({ date: `2026-11-${d}`, active: i >= 2 && i <= 4, today: i === 5 })),
    },
    langs: [
      { lang: 'de', judged: true, deck_open: 10, ai_decided: 0, ai_review: 0, ai_unsure: 0, ai_pending: 0 },
      { lang: 'it', judged: false, deck_open: 0, ai_decided: 67, ai_review: 20, ai_unsure: 3, ai_pending: 1 },
      { lang: 'ja', judged: false, deck_open: 0, ai_decided: 45, ai_review: 12, ai_unsure: 3, ai_pending: 0 },
      { lang: 'pt-BR', judged: false, deck_open: 0, ai_decided: 52, ai_review: 8, ai_unsure: 2, ai_pending: 0 },
      { lang: 'ru', judged: false, deck_open: 0, ai_decided: 35, ai_review: 5, ai_unsure: 1, ai_pending: 0 },
    ],
    ai_summary: { decided: 199, review: 45, unsure: 9 },
    leaderboard: [
      { user_id: 'u1', name: 'Nova', points: 1480, rank: 1, is_me: false },
      { user_id: 'me', name: 'Jerry', points: 1240, rank: 2, is_me: true },
      { user_id: 'u3', name: null, points: 310, rank: 3, is_me: false },
    ],
    ...extra,
  };
}
