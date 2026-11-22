// Postgres adapter of the learning step (cards, learned glossary rows, style, codex names,
// learning spend). Separate from `_db.ts` so the job state machine's Db stays unchanged; wired
// as `deps.learn` (index.ts: `learn: makeLearnDb(admin)`). Without it the learning step is a no-op.
//
// Spend: job-less `translation_ledger` rows (job_id null) with `kind` + `lang`
// (migration 20261108180000). `monthCommitted` sums every row, so the monthly cap sees all kinds;
// the web-research cap sums kind='web' of the month.

import { selectAll } from './_page.ts';
import type { GlossaryRow } from './_prompt.ts';
import type { LearnedStyle } from './_style.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

export interface LearnSettings {
  enabled: boolean;
  monthly_cap_usd: number;
  arbiter_model: string;
  web_research_cap_usd: number;
  revise_margin: number;
  revise_budget_pct: number;
  promote_min_evidence: number;
  promote_min_agreement: number;
}

export const LEARN_SETTING_DEFAULTS: LearnSettings = {
  enabled: false,
  monthly_cap_usd: 190,
  arbiter_model: 'claude-haiku-5-5',
  web_research_cap_usd: 5,
  revise_margin: 3,
  revise_budget_pct: 2,
  promote_min_evidence: 5,
  promote_min_agreement: 0.9,
};

/** One side of a card (contract: docs/concepts/20261121-1151-karteikarten-neu/contract.md, P10). */
export interface CardOption {
  text: string;
  source: string;
  votes?: number;
  /** Texts this option would set. */
  count?: number;
  /** Three example strings with this option applied (fewer only when fewer exist). */
  examples?: { lang: string; key: string; en: string; text: string }[];
}

export type CardStatus = 'open' | 'answered' | 'ai' | 'parked' | 'folded';
export type CardChoice = 'a' | 'b' | 'own';

export interface CardRow {
  id?: string;
  /** null = a cross-language convention card (`langs` lists its languages). */
  lang: string | null;
  langs?: string[];
  kind: 'meta' | 'wording' | 'convention' | 'style';
  /** Kind parameters the UI renders the question from (P9): {term} | {en, key, where} | {pattern, langs}. */
  params: Record<string, unknown>;
  option_a: CardOption;
  option_b: CardOption;
  context: Record<string, unknown>;
  spread: number;
  reach: number;
  doubt: number;
  fresh: boolean;
  dedupe_key: string;
  impact: number;
  status?: CardStatus;
  answer?: CardChoice | null;
  own_text?: string | null;
  /** Convention answers: per-language exception {lang: 'a'|'b'} (P8). */
  exceptions?: Record<string, 'a' | 'b'> | null;
  note?: string | null;
  save_as_rule?: boolean;
  answered_by?: string | null;
  // KI path (P6): decision, reason code, unsure flag, German back-translation.
  ai_choice?: CardChoice | null;
  ai_text?: string | null;
  ai_basis?: string | null;
  ai_reason?: Record<string, unknown> | null;
  ai_unsure?: boolean;
  ai_back?: string | null;
  ai_decided_at?: string | null;
  /** Options an admin flagged with „Sieht falsch aus“; they never win again. */
  vetoed?: CardChoice[];
  applied_at?: string | null;
}

export interface CardQuery {
  lang?: string;
  status: CardStatus[];
  kinds?: CardRow['kind'][];
  /** status ai without a decision yet (not-mine, vetoed). */
  undecided?: boolean;
  /** KI decisions without a back-translation, not yet applied. */
  needBack?: boolean;
  limit: number;
}

export interface LearnGlossaryRow extends GlossaryRow {
  evidence?: number;
}

export interface LearnDb {
  getLearnSettings(): Promise<LearnSettings>;
  /** The current LIVE codex build (is_current), else the newest current one; null when none. */
  currentBuildId(): Promise<string | null>;
  /** Manufacturer, ship and location names of a build (English). */
  codexNames(buildId: string): Promise<string[]>;
  getStyle(lang: string): Promise<LearnedStyle | null>;
  setStyle(lang: string, style: LearnedStyle): Promise<void>;
  listGlossary(lang: string): Promise<LearnGlossaryRow[]>;
  /** Insert only; a row that exists (lang, lower(source_term)) is left alone. */
  insertGlossary(lang: string, rows: LearnGlossaryRow[]): Promise<number>;
  updateGlossary(id: string, patch: Partial<Pick<LearnGlossaryRow, 'target_term' | 'origin' | 'evidence' | 'needs_retranslate' | 'category'>>): Promise<void>;
  /** Admin rule from a card: insert, or overwrite the existing row (admin wins), with needs_retranslate. */
  upsertAdminRule(lang: string, row: { source_term: string; target_term: string; category: string }, actor: string | null): Promise<void>;
  /** false when an unanswered card with the same dedupe_key exists (23505). */
  insertCard(card: CardRow): Promise<boolean>;
  listAnsweredUnapplied(lang: string, limit: number): Promise<CardRow[]>;
  listOpenCards(lang: string, kinds: CardRow['kind'][], limit: number): Promise<CardRow[]>;
  updateCardContext(id: string, context: Record<string, unknown>): Promise<void>;
  // Concept karteikarten-neu. Optional so older adapters/fakes keep working: without them every language
  // counts as German-only judged, and the KI path, the cleanup and the convention merge are skipped.
  /** Union of the languages admins answer as cards (P7, rpc translation_judged_langs). */
  judgedLangs?(): Promise<string[]>;
  listCards?(q: CardQuery): Promise<CardRow[]>;
  updateCard?(id: string, patch: Partial<CardRow>): Promise<void>;
  /** The convention card of a pattern that is not applied yet, or null. */
  findConvention?(dedupeKey: string): Promise<CardRow | null>;
  /** Books learning spend as a job-less ledger row (see header). With `ref` (the batch id) a second booking of the same batch is ignored. */
  addLearnLedger(month: string, usd: number, kind: string, lang: string, ref?: string): Promise<void>;
  /** Ledger sum of one kind in a month (web-research cap). */
  monthKindSpent(month: string, kind: string): Promise<number>;
  /** Ledger sum of the month (all spend, the monthly cap's basis). */
  monthSpent(month: string): Promise<number>;
  listApprovedLangs(): Promise<string[]>;
}

function fail(e: { message?: string } | null): never {
  throw new Error(e?.message ?? 'db error');
}

export function makeLearnDb(sb: Client, now: () => Date = () => new Date()): LearnDb {
  return {
    async getLearnSettings() {
      const { data, error } = await sb.from('translation_settings').select('*').eq('id', 1).maybeSingle();
      if (error) fail(error);
      const s = (data ?? {}) as Partial<LearnSettings>;
      const d = LEARN_SETTING_DEFAULTS;
      return {
        enabled: s.enabled === true,
        monthly_cap_usd: Number(s.monthly_cap_usd ?? d.monthly_cap_usd),
        arbiter_model: s.arbiter_model || d.arbiter_model,
        web_research_cap_usd: Number(s.web_research_cap_usd ?? d.web_research_cap_usd),
        revise_margin: Number(s.revise_margin ?? d.revise_margin),
        revise_budget_pct: Number(s.revise_budget_pct ?? d.revise_budget_pct),
        promote_min_evidence: Number(s.promote_min_evidence ?? d.promote_min_evidence),
        promote_min_agreement: Number(s.promote_min_agreement ?? d.promote_min_agreement),
      };
    },
    async currentBuildId() {
      const { data, error } = await sb.from('codex_builds').select('id,channel,created_at').eq('is_current', true)
        .order('created_at', { ascending: false }).limit(10);
      if (error) fail(error);
      const rows = (data ?? []) as { id: string; channel: string }[];
      return (rows.find((r) => r.channel === 'LIVE') ?? rows[0])?.id ?? null;
    },
    async codexNames(buildId) {
      const out = new Set<string>();
      for (const [table, col] of [['codex_manufacturers', 'name_localized'], ['codex_ships', 'name_localized'], ['codex_locations', 'name']]) {
        let data: Record<string, string | null>[];
        try {
          data = await selectAll((from, to) => sb.from(table).select(col).eq('build_id', buildId).order(col).range(from, to));
        } catch {
          continue; // a missing table degrades to fewer names
        }
        for (const r of data) {
          const n = (r[col] ?? '').trim();
          if (n) out.add(n);
        }
      }
      return [...out];
    },
    async getStyle(lang) {
      const { data, error } = await sb.from('translation_languages').select('style').eq('lang', lang).maybeSingle();
      if (error) fail(error);
      const s = (data as { style?: LearnedStyle } | null)?.style;
      return s && typeof s === 'object' && (s as LearnedStyle).v === 1 ? s : null;
    },
    async setStyle(lang, style) {
      const { error } = await sb.from('translation_languages').update({ style }).eq('lang', lang);
      if (error) fail(error);
    },
    async listGlossary(lang) {
      return await selectAll<LearnGlossaryRow>((from, to) =>
        sb.from('translation_glossary').select('*').eq('lang', lang).order('id').range(from, to));
    },
    async insertGlossary(lang, rows) {
      const shape = (r: LearnGlossaryRow) => ({
        lang, source_term: r.source_term, target_term: r.target_term, category: r.category, origin: r.origin,
        evidence: r.evidence ?? 0,
      });
      let n = 0;
      // A first learning pass promotes hundreds of terms: one statement per 100 rows. A group that
      // holds a term the table already has fails as a whole (23505) and is repeated row by row.
      for (let i = 0; i < rows.length; i += 100) {
        const group = rows.slice(i, i + 100);
        const bulk = await sb.from('translation_glossary').insert(group.map(shape));
        if (!bulk.error) {
          n += group.length;
          continue;
        }
        if (bulk.error.code !== '23505') fail(bulk.error);
        for (const r of group) {
          const { error } = await sb.from('translation_glossary').insert(shape(r));
          if (error && error.code !== '23505') fail(error);
          if (!error) n++;
        }
      }
      return n;
    },
    async updateGlossary(id, patch) {
      const { error } = await sb.from('translation_glossary').update({ ...patch, updated_at: now().toISOString() }).eq('id', id)
        .eq('locked', false).neq('origin', 'admin');
      if (error) fail(error);
    },
    async upsertAdminRule(lang, row, actor) {
      const { data, error } = await sb.from('translation_glossary').select('id').eq('lang', lang).ilike('source_term', row.source_term.replace(/[%_\\]/g, '\\$&')).maybeSingle();
      if (error) fail(error);
      const patch = { target_term: row.target_term, category: row.category, origin: 'admin', needs_retranslate: true, updated_by: actor, updated_at: now().toISOString() };
      const res = data
        ? await sb.from('translation_glossary').update(patch).eq('id', (data as { id: string }).id)
        : await sb.from('translation_glossary').insert({ lang, source_term: row.source_term, ...patch });
      if (res.error) fail(res.error);
    },
    async insertCard(card) {
      const { error } = await sb.from('translation_cards').insert({
        lang: card.lang, langs: card.langs ?? (card.lang ? [card.lang] : []), kind: card.kind, params: card.params,
        option_a: card.option_a, option_b: card.option_b,
        context: card.context, spread: card.spread, reach: card.reach, doubt: card.doubt, fresh: card.fresh,
        dedupe_key: card.dedupe_key, impact: card.impact, status: card.status ?? 'open',
        ai_choice: card.ai_choice ?? null, ai_text: card.ai_text ?? null, ai_basis: card.ai_basis ?? null,
        ai_reason: card.ai_reason ?? null, ai_unsure: card.ai_unsure ?? false, ai_decided_at: card.ai_decided_at ?? null,
      });
      if (error && error.code === '23505') return false;
      if (error) fail(error);
      return true;
    },
    async listAnsweredUnapplied(lang, limit) {
      // Answers, KI decisions nobody vetoed in time and convention answers not yet applied to this language.
      const { data, error } = await sb.rpc('translation_cards_to_apply', { p_lang: lang, p_limit: limit });
      if (error) fail(error);
      return (data ?? []) as CardRow[];
    },
    async judgedLangs() {
      const { data, error } = await sb.rpc('translation_judged_langs');
      if (error) fail(error);
      return (data ?? []) as string[];
    },
    async listCards(q) {
      let r = sb.from('translation_cards').select('*').in('status', q.status);
      if (q.lang) r = r.eq('lang', q.lang);
      if (q.kinds?.length) r = r.in('kind', q.kinds);
      if (q.undecided) r = r.is('ai_choice', null);
      if (q.needBack) r = r.not('ai_choice', 'is', null).is('ai_back', null).is('applied_at', null);
      const { data, error } = await r.order('created_at').limit(q.limit);
      if (error) fail(error);
      return (data ?? []) as CardRow[];
    },
    async updateCard(id, patch) {
      const { error } = await sb.from('translation_cards').update(patch).eq('id', id);
      if (error) fail(error);
    },
    async findConvention(dedupeKey) {
      const { data, error } = await sb.from('translation_cards').select('*').eq('kind', 'convention').eq('dedupe_key', dedupeKey)
        .is('applied_at', null).in('status', ['open', 'answered', 'ai']).limit(1).maybeSingle();
      if (error) fail(error);
      return (data ?? null) as CardRow | null;
    },
    async listOpenCards(lang, kinds, limit) {
      const { data, error } = await sb.from('translation_cards').select('*').eq('lang', lang).eq('status', 'open').in('kind', kinds)
        .order('spread', { ascending: false }).order('reach', { ascending: false }).order('kind_rank')
        .order('doubt', { ascending: false }).limit(limit);
      if (error) fail(error);
      return (data ?? []) as CardRow[];
    },
    async updateCardContext(id, context) {
      const { error } = await sb.from('translation_cards').update({ context }).eq('id', id);
      if (error) fail(error);
    },
    async addLearnLedger(month, usd, kind, lang, ref) {
      if (!(usd > 0)) return;
      const { error } = await sb.from('translation_ledger').insert({ job_id: null, month, usd, kind, lang, ref: ref ?? null });
      // 23505 on (job, ref): this batch is booked already.
      if (error && !(ref && error.code === '23505')) fail(error);
    },
    async monthKindSpent(month, kind) {
      // The caps are read from these sums: a list cut at the API's row cap would let the pipeline overspend.
      const rows = await selectAll<{ usd: number }>((from, to) =>
        sb.from('translation_ledger').select('usd').eq('month', month).eq('kind', kind).order('id').range(from, to));
      return rows.reduce((a, r) => a + Number(r.usd), 0);
    },
    async monthSpent(month) {
      const rows = await selectAll<{ usd: number }>((from, to) =>
        sb.from('translation_ledger').select('usd').eq('month', month).order('id').range(from, to));
      return rows.reduce((a, r) => a + Number(r.usd), 0);
    },
    async listApprovedLangs() {
      const { data, error } = await sb.from('translation_languages').select('lang').eq('approved', true);
      if (error) fail(error);
      return ((data ?? []) as { lang: string }[]).map((r) => r.lang);
    },
  };
}
