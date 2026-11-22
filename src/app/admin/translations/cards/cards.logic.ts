import { logWarn } from '../../../core/log';
import { toErrorKey } from '../../../core/describe-error';
import type {
  BoardLang,
  BoardRow,
  CardBoard,
  CardOption,
  KiDecision,
  PatternId,
  TranslationCard,
} from '../translations.service';

/**
 * Pure logic of the Karteikarten tab (concept 20261121-1151-karteikarten-neu, design „Duell-Karte“):
 * hotkeys, swipe, the question text from i18n templates (P9), the side-box rows and the error keys.
 * No Angular here, so every rule is a unit test.
 */

const I18N = 'admin.translations.cards';

// ── Hotkeys (U3, U4, U5, U6) ────────────────────────────────────────────────

/** What the stage shows: the closed deck, a question card, the moment after an answer, a KI card, nothing to act on. */
export type StageMode = 'cover' | 'card' | 'moment' | 'veto' | 'idle';

export type CardAction =
  | { kind: 'turn' }
  | { kind: 'pick'; choice: 'a' | 'b' }
  | { kind: 'own' }
  | { kind: 'notMine' }
  | { kind: 'exception' }
  | { kind: 'wrong' }
  | { kind: 'ok' }
  | { kind: 'undo' }
  | { kind: 'keys' };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}

/** The key caps shown on the card, one place so the sheet and the caps never disagree. */
export const CARD_KEYS = {
  left: '←',
  right: '→',
  own: 'E',
  notMine: '↑',
  exception: 'A',
  turn: 'Enter',
  keys: '?',
  undo: 'Strg+Z',
} as const;

function tagOf(t: EventTarget | null | undefined): string {
  const el = t as { tagName?: unknown } | null | undefined;
  return typeof el?.tagName === 'string' ? el.tagName.toUpperCase() : '';
}

/** A text field (or contenteditable) has focus: every letter belongs to it. */
export function isTypingTarget(t: EventTarget | null | undefined): boolean {
  const tag = tagOf(t);
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (t as { isContentEditable?: boolean } | null)?.isContentEditable === true;
}

/**
 * The shell's search field takes the caret on load (op-hybrid autofocus) and is still empty: nobody is typing in it,
 * so Enter on the closed deck must turn the deck instead of being swallowed there. A field the reader typed in
 * (or any other input) keeps every key.
 */
export function isIdleShellSearch(t: EventTarget | null | undefined): boolean {
  if (tagOf(t) !== 'INPUT') return false;
  const el = t as { value?: unknown; closest?: (sel: string) => unknown };
  if (String(el.value ?? '').trim() !== '' || typeof el.closest !== 'function') return false;
  return !!el.closest('sc-fusion-search');
}

/** A button or link has focus: Enter / Space belong to it, never to the deck. */
function isControlTarget(t: EventTarget | null | undefined): boolean {
  const tag = tagOf(t);
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
}

/**
 * The deck's key map. Desktop: ← / 1 = left option, → / 2 = right option, E = own text, ↑ = not mine,
 * A = exception for one language (convention cards), Enter turns the deck, ? opens the key sheet,
 * Ctrl/⌘+Z undoes. On a KI card ← is „Sieht falsch aus“ and → „Passt“. Nothing while typing or under a dialog.
 */
export function cardKeyAction(e: KeyLike, mode: StageMode, underDialog: boolean): CardAction | null {
  const idleSearch = e.key === 'Enter' && mode === 'cover' && isIdleShellSearch(e.target);
  if (e.defaultPrevented || e.repeat || (isTypingTarget(e.target) && !idleSearch) || underDialog) return null;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === 'z') return { kind: 'undo' };
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (k === '?') return { kind: 'keys' };
  if (e.shiftKey) return null;
  const lower = k.toLowerCase();
  switch (mode) {
    case 'cover':
    case 'moment':
      return k === 'Enter' && !isControlTarget(e.target) ? { kind: 'turn' } : null;
    case 'card':
      if (k === 'ArrowLeft' || k === '1') return { kind: 'pick', choice: 'a' };
      if (k === 'ArrowRight' || k === '2') return { kind: 'pick', choice: 'b' };
      if (k === 'ArrowUp') return { kind: 'notMine' };
      if (lower === 'e') return { kind: 'own' };
      if (lower === 'a') return { kind: 'exception' };
      return null;
    case 'veto':
      if (k === 'ArrowLeft' || k === '1') return { kind: 'wrong' };
      if (k === 'ArrowRight' || k === '2') return { kind: 'ok' };
      if (lower === 'e') return { kind: 'own' };
      return null;
    default:
      return null;
  }
}

// ── Swipe (U3, U16) ─────────────────────────────────────────────────────────

export type SwipeDir = 'left' | 'right' | 'up';

/** Minimum travel (px) before a drag counts as a swipe. */
export const SWIPE_MIN_PX = 60;

/** Direction of a finished drag: the longer axis wins, a short or downward drag is no swipe (the page scrolls). */
export function swipeDirection(dx: number, dy: number, min = SWIPE_MIN_PX): SwipeDir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay > ax) return dy <= -min ? 'up' : null;
  if (ax < min) return null;
  return dx < 0 ? 'left' : 'right';
}

/** Swipe → action: left/right = the two halves (on a KI card „Sieht falsch aus“ / „Passt“), up = not mine. */
export function swipeAction(dir: SwipeDir | null, mode: StageMode): CardAction | null {
  if (!dir) return null;
  if (mode === 'card') {
    if (dir === 'up') return { kind: 'notMine' };
    return { kind: 'pick', choice: dir === 'left' ? 'a' : 'b' };
  }
  if (mode === 'veto') {
    if (dir === 'left') return { kind: 'wrong' };
    if (dir === 'right') return { kind: 'ok' };
  }
  return null;
}

// ── Questions from templates (P9) ───────────────────────────────────────────

export interface Text {
  /** i18n key; when absent, `text` is literal game text. */
  key?: string;
  params?: Record<string, unknown>;
  text?: string;
}

const patternSegment = (p: PatternId | string): string => String(p).replace(/\./g, '_');

export function patternOf(c: TranslationCard): PatternId | null {
  return c.kind === 'convention' && 'pattern' in c.params ? c.params.pattern : null;
}

/** The English term / line a term or wording card is about („Open“), null for a convention. */
export function subjectOf(c: TranslationCard): string | null {
  if ('term' in c.params) return c.params.term;
  if ('en' in c.params) return c.params.en;
  return null;
}

/** The question in the UI language, never stored prose: kind + params → template. */
export function cardQuestion(c: TranslationCard): Text {
  const pattern = patternOf(c);
  if (pattern) return { key: `${I18N}.q.${patternSegment(pattern)}` };
  if (c.kind === 'term') return { key: `${I18N}.q.term`, params: { term: subjectOf(c) ?? '' } };
  return { key: `${I18N}.q.wording`, params: { en: subjectOf(c) ?? '' } };
}

/** Label of one half: a convention names the rule („Normal“ / „GROSS“), the others show the option text itself. */
export function optionLabel(c: TranslationCard, side: 'a' | 'b'): Text {
  const pattern = patternOf(c);
  if (pattern) return { key: `${I18N}.opt.${patternSegment(pattern)}.${side}` };
  return { text: optionOf(c, side).text };
}

export function optionOf(c: TranslationCard, side: 'a' | 'b'): CardOption {
  return (side === 'a' ? c.option_a : c.option_b) ?? { text: '', source: '' };
}

/** P10: exactly three examples (fewer where fewer texts exist). */
export function examplesOf(o: CardOption): NonNullable<CardOption['examples']> {
  return (o.examples ?? []).slice(0, 3);
}

/** P10 „betrifft N Texte“ of one option; falls back to the card's spread. */
export function optionCount(c: TranslationCard, side: 'a' | 'b'): number {
  return optionOf(c, side).count ?? c.spread;
}

/** Convention cards may name an exception for one language (P8); own text is not allowed there (contract 22023). */
export function canException(c: TranslationCard): boolean {
  return c.kind === 'convention' && c.langs.length > 1;
}

export function canOwnText(c: TranslationCard): boolean {
  return c.kind !== 'convention';
}

/** The text an answer stands for — the hero of the moment after it. */
export function chosenText(c: TranslationCard, choice: 'a' | 'b' | 'own', own?: string | null): string {
  if (choice === 'own') return (own ?? '').trim();
  return optionOf(c, choice).text;
}

// ── KI card (P6, U11) ───────────────────────────────────────────────────────

/** The reason line of a KI decision from its code; majority / votes put the larger number first. */
export function reasonText(ai: KiDecision): Text {
  const { code, a, b } = ai.reason ?? { code: ai.basis };
  if (code === 'majority' || code === 'votes') {
    const x = Number(a) || 0;
    const y = Number(b) || 0;
    return { key: `${I18N}.reason.${code}`, params: { a: Math.max(x, y), b: Math.min(x, y) } };
  }
  return { key: `${I18N}.reason.${code}` };
}

// ── Side boxes (U8, U9, U10, G4) ────────────────────────────────────────────

export interface LangRow {
  lang: string;
  judged: boolean;
  /** i18n key + params of the small second line. */
  line: Text;
  /** Unsure count in the warning colour (KI rows only). */
  unsure: number;
  /** Judged language: automatic decisions (bracket cut, clear majority, spelling) an admin can still review (P3). */
  auto: number;
}

export function langRows(board: CardBoard | null): LangRow[] {
  return (board?.langs ?? []).map((l: BoardLang) => ({
    lang: l.lang,
    judged: l.judged,
    line: l.judged
      ? l.deck_open > 0
        ? { key: `${I18N}.row.deck`, params: { count: l.deck_open } }
        : (l.deck_waiting ?? 0) > 0
          ? { key: countKey(`${I18N}.row.legacy`, l.deck_waiting!), params: { count: l.deck_waiting! } }
          : { key: `${I18N}.row.clear` }
      : { key: `${I18N}.row.ki`, params: { count: l.ai_decided } },
    unsure: l.judged ? 0 : l.ai_unsure,
    auto: l.judged ? l.ai_review : 0,
  }));
}

/**
 * Where the KI summary row leads (U9): the KI language with the most unsure decisions, else the most
 * waiting ones, else the first KI language; null when every language is judged by the admin.
 */
export function kiTargetLang(board: CardBoard | null): string | null {
  const ki = (board?.langs ?? []).filter((l) => !l.judged);
  if (!ki.length) return null;
  const best = [...ki].sort((x, y) => y.ai_unsure - x.ai_unsure || y.ai_review - x.ai_review || x.lang.localeCompare(y.lang))[0];
  return best.lang;
}

/** The language the tab opens with: the query's, else the admin's first own language, else German. */
export function defaultLang(board: CardBoard | null, requested: string | null): string {
  if (requested) return requested;
  return board?.my_langs?.[0] ?? 'de';
}

/** `?review=1` on a judged language: its automatic decisions as a veto list (P3 „logged and reversible“). */
export function isReview(board: CardBoard | null, lang: string, requested: string | null): boolean {
  return requested === '1' && isJudged(board, lang);
}

/**
 * Singular/plural of a counted string: `key` is the plural („betrifft {{count}} Texte“), `keyOne` the singular
 * („betrifft 1 Text“) — one pair of i18n keys, never an inline plural rule.
 */
export function countKey(key: string, count: number): string {
  return count === 1 ? `${key}One` : key;
}

export function isJudged(board: CardBoard | null, lang: string): boolean {
  if (!board) return lang === 'de';
  const row = board.langs.find((l) => l.lang === lang);
  return row ? row.judged : board.my_langs.includes(lang);
}

/** Leaderboard name: „Du“ for the own row, the display name, else a neutral fallback (G4). */
export function boardName(r: BoardRow): Text {
  if (r.is_me) return { key: `${I18N}.stats.you` };
  const n = (r.name ?? '').trim();
  return n ? { text: n } : { key: `${I18N}.stats.unnamed` };
}

/** Rank line: the gap to the next place up, or the lead over the second (contract: computed client-side). */
export function rankLine(board: CardBoard | null): Text | null {
  if (!board) return null;
  const rows = [...board.leaderboard].sort((x, y) => x.rank - y.rank);
  const rank = board.week.rank;
  if (!rows.length || rank < 1) return null;
  if (rank === 1) {
    const second = rows.find((r) => !r.is_me);
    if (!second) return { key: `${I18N}.stats.alone` };
    const lead = Math.max(0, board.week.points - second.points);
    return { key: countKey(`${I18N}.stats.lead`, lead), params: { points: lead } };
  }
  const above = rows.find((r) => r.rank === rank - 1) ?? rows[rank - 2];
  if (!above) return null;
  const gap = Math.max(0, above.points - board.week.points);
  return { key: countKey(`${I18N}.stats.gap`, gap), params: { points: gap, place: rank - 1 } };
}

/** Bar width (percent) of a leaderboard row against the leader. */
export function barPct(points: number, rows: readonly BoardRow[]): number {
  const top = Math.max(0, ...rows.map((r) => r.points));
  if (top <= 0) return 0;
  return Math.round((Math.max(0, points) / top) * 100);
}

// ── Ring (U8, U13, U16) ─────────────────────────────────────────────────────

/** `stroke-dasharray` of the goal ring: the done share of the circumference, the rest gap. */
export function ringDash(done: number, target: number, radius: number): string {
  const c = 2 * Math.PI * radius;
  const share = target > 0 ? Math.min(1, Math.max(0, done / target)) : 0;
  return `${(c * share).toFixed(1)} ${c.toFixed(1)}`;
}

/** The ten pips around the ring, one per card of the daily goal (positions in a 160 box). */
export function ringPips(target: number, cx = 80, cy = 80, r = 66): { x: number; y: number }[] {
  const n = Math.max(1, Math.min(20, target));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return { x: +(cx + r * Math.cos(a)).toFixed(1), y: +(cy + r * Math.sin(a)).toFixed(1) };
  });
}

// ── Finished deck (U13) ─────────────────────────────────────────────────────

export interface SessionAnswer {
  card: TranslationCard;
  choice: 'a' | 'b' | 'own';
  text: string;
  points: number;
  bonus: number;
}

export interface FinishSummary {
  cards: number;
  texts: number;
  points: number;
  base: number;
  bonus: number;
}

export function finishSummary(done: readonly SessionAnswer[]): FinishSummary {
  let texts = 0;
  let base = 0;
  let bonus = 0;
  for (const d of done) {
    texts += d.choice === 'own' ? d.card.spread : optionCount(d.card, d.choice);
    base += d.points;
    bonus += d.bonus;
  }
  return { cards: done.length, texts, points: base + bonus, base, bonus };
}

// ── Errors (X3) ─────────────────────────────────────────────────────────────

/** The card RPCs' refusals (contract § Errors) have their own sentence; everything else goes the standard way. */
const CARD_REFUSALS: Readonly<Record<string, string>> = {
  '22023': 'errors.translation.cards.invalid',
  P0002: 'errors.translation.cards.gone',
  '55000': 'errors.translation.cards.applied',
  '42501': 'errors.translation.cards.forbidden',
};

export function cardErrorKey(op: string, err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const key = typeof code === 'string' ? CARD_REFUSALS[code] : undefined;
  if (key) {
    logWarn('admin-translations', `cards ${op} refused`, { error: err });
    return key;
  }
  return toErrorKey('admin-translations', `cards-${op}`, err);
}

/** A refusal that means the card is no longer what the client thinks: reload deck and board. */
export function needsReload(key: string): boolean {
  return key === 'errors.translation.cards.gone' || key === 'errors.translation.cards.applied';
}
