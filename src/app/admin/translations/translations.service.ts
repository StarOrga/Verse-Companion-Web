import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { GlossaryFilters, buildGlossaryQuery, monthStartUtc, revertPatch, sumLedger } from './translations.logic';

export interface TranslationSettings {
  enabled: boolean;
  upload_cap_usd: number;
  monthly_cap_usd: number;
}

export interface TranslationLanguage {
  lang: string;
  cig_folder: string;
  approved: boolean;
}

export interface TranslationJob {
  id: string;
  build_id: string;
  lang: string;
  mode: 'delta' | 'full';
  status: string;
  string_count: number | null;
  estimate_usd: number | null;
  spent_usd: number;
  stats: unknown;
  error: string | null;
  created_at: string;
  build: { patch_version: string; channel: string; build_number: string } | null;
}

export interface CurrentBuild {
  id: string;
  patch_version: string;
  channel: string;
  build_number: string;
}

export interface GlossaryEntry {
  id: string;
  lang: string;
  source_term: string;
  target_term: string;
  category: string;
  origin: string;
  locked: boolean;
  needs_retranslate: boolean;
  updated_at: string;
}

export type GlossaryPatch = Partial<
  Pick<GlossaryEntry, 'target_term' | 'category' | 'origin' | 'locked' | 'needs_retranslate'>
>;

export interface GlossaryHistoryEntry {
  id: number;
  glossary_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

// ── Karteikarten v2 (contract: docs/concepts/20261121-1151-karteikarten-neu/contract.md) ──

export type CardKind = 'convention' | 'term' | 'wording';
export type CardStatus = 'open' | 'answered' | 'ai' | 'parked' | 'folded';
export type CardChoice = 'a' | 'b' | 'own';
export type PatternId = 'case.upper' | 'case.title' | 'compound' | 'verb.form' | 'abbr';
export type ReasonCode =
  | 'majority'
  | 'community'
  | 'ai'
  | 'votes'
  | 'bracket'
  | 'whitespace'
  | 'casing_source'
  | 'convention'
  | 'only_left';
export type Where = 'ui' | 'item' | 'mission_lore' | 'other';

export interface CardExample {
  lang: string;
  key: string;
  en: string;
  text: string;
}

export interface CardOption {
  text: string;
  source: string;
  votes?: number;
  count?: number;
  examples?: CardExample[];
}

export type CardParams =
  | { pattern: PatternId; langs: string[] }
  | { term: string; where: Where | null }
  | { en: string; key: string; where: Where | null };

export interface KiDecision {
  choice: CardChoice;
  text: string;
  basis: ReasonCode;
  reason: { code: ReasonCode; a?: number; b?: number };
  unsure: boolean;
  back_de: string | null;
  decided_at: string;
  accepted: boolean;
}

export interface TranslationCard {
  id: string;
  kind: CardKind;
  lang: string | null;
  langs: string[];
  params: CardParams;
  option_a: CardOption;
  option_b: CardOption;
  spread: number;
  reach: number;
  doubt: number;
  fresh: boolean;
  status: CardStatus;
  answer: CardChoice | null;
  own_text: string | null;
  exceptions: Record<string, 'a' | 'b'> | null;
  points: number;
  bonus: number;
  ai: KiDecision | null;
  vetoed: CardChoice[];
  can_undo: boolean;
  created_at: string;
}

export interface CardGoal {
  done: number;
  target: number;
  full: boolean;
  bonus_taken: boolean;
}

/** Result of every action RPC that scores. */
export interface CardActionResult {
  card: TranslationCard;
  points: number;
  bonus: number;
  goal: CardGoal;
}

/** `not_mine_translation_card` / `undo_translation_card`: no score of their own. */
export interface CardMoveResult {
  card: TranslationCard;
  goal: CardGoal;
}

export interface CardDeck {
  lang: string;
  open_total: number;
  affected_total: number;
  deck_affected: number;
  cards: TranslationCard[];
}

export interface VetoList {
  lang: string;
  total: number;
  unsure: number;
  items: TranslationCard[];
}

export interface BoardLang {
  lang: string;
  judged: boolean;
  deck_open: number;
  ai_decided: number;
  ai_review: number;
  ai_unsure: number;
  ai_pending: number;
}

export interface BoardRow {
  user_id: string;
  name: string | null;
  points: number;
  rank: number;
  is_me: boolean;
}

export interface CardBoard {
  rules: { points: number; goal: number; bonus: number; tz: string };
  my_langs: string[];
  goal: CardGoal;
  streak_days: number;
  week: {
    start: string;
    points: number;
    rank: number;
    days: { date: string; active: boolean; today: boolean }[];
  };
  langs: BoardLang[];
  ai_summary: { decided: number; review: number; unsure: number };
  leaderboard: BoardRow[];
}

export interface CardAnswerInput {
  answer: CardChoice;
  /** Only with `answer: 'own'` (never on a convention card). */
  own_text?: string | null;
  /** Convention answers only: languages that take the other option (P8). */
  exceptions?: Record<string, 'a' | 'b'> | null;
}

export interface TranslationSource {
  id: string;
  lang: string;
  name: string;
  license: string | null;
  license_kind: 'permissive' | 'nc_sa' | 'none';
  status: 'licensed' | 'awaiting_permission' | 'permitted' | 'refused';
  enabled: boolean;
  game_folder: string | null;
  last_synced_at: string | null;
  coverage: Record<string, unknown> | null;
}

/** `import_seed` and `learn` only start a background pass; its result lands on the source row / in the glossary. */
export interface PassStarted {
  lang: string;
  queued: boolean;
  pass_id: string | null;
  source_id?: string;
}

/** A background pass of the pipeline (table `translation_passes`): it runs in slices, `pos` of `total` in countable phases. */
export interface TranslationPass {
  id: string;
  kind: 'learn' | 'seed' | 'overlay';
  lang: string;
  source_id: string | null;
  reason: string;
  status: 'open' | 'done' | 'failed';
  phase: string;
  pos: number;
  total: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncSourcesResult {
  checked: number;
  /** Sources whose upstream changed: an import pass was started for each. */
  changed: number;
  errors: { source_id: string; error: string }[] | number;
}

export interface OutreachDraft {
  id: string;
  source_id: string;
  kind: 'notify' | 'permission';
  message_lang: string;
  subject: string;
  body: string;
  status: 'draft' | 'approved' | 'sent' | 'answered';
  approved_at: string | null;
  sent_at: string | null;
  answer: string | null;
  answer_at: string | null;
  decision: 'granted' | 'refused' | null;
  created_at: string;
}

export interface OverrideAlert {
  id: string;
  lang: string;
  key: string;
  en_old: string | null;
  en_new: string | null;
  cig_old: string | null;
  cig_new: string | null;
  admin_text: string;
  status: 'open' | 'kept' | 'adopted' | 'edited';
  created_at: string;
}

export interface AdminPerson {
  id: string;
  name: string;
  isProtected: boolean;
}

const num = (v: unknown): number => Number(v) || 0;

/** Admin data access of /admin/translations. Reads carry the app-wide read deadline; writes none. */
@Injectable({ providedIn: 'root' })
export class TranslationsService {
  private readonly sb = inject(SupabaseClientProvider);

  private async rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
    const { data, error } = await q;
    if (error) throw error;
    return data as T;
  }

  async getSettings(): Promise<TranslationSettings> {
    const r = await this.rows<Record<string, unknown>>(
      this.sb.client.from('translation_settings').select('enabled,upload_cap_usd,monthly_cap_usd').eq('id', 1).single(),
    );
    return { enabled: !!r['enabled'], upload_cap_usd: num(r['upload_cap_usd']), monthly_cap_usd: num(r['monthly_cap_usd']) };
  }

  async saveSettings(patch: Partial<TranslationSettings>): Promise<void> {
    await this.rows(this.sb.client.from('translation_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1));
  }

  async listLanguages(): Promise<TranslationLanguage[]> {
    return this.rows(this.sb.client.from('translation_languages').select('lang,cig_folder,approved').order('lang'));
  }

  async setApproved(lang: string, approved: boolean): Promise<void> {
    await this.rows(
      this.sb.client
        .from('translation_languages')
        .update({ approved, approved_at: approved ? new Date().toISOString() : null })
        .eq('lang', lang),
    );
  }

  async listJobs(): Promise<TranslationJob[]> {
    const data = await this.rows<Record<string, unknown>[]>(
      this.sb.client
        .from('translation_jobs')
        .select(
          'id,build_id,lang,mode,status,string_count,estimate_usd,spent_usd,stats,error,created_at,build:codex_builds!translation_jobs_build_id_fkey(patch_version,channel,build_number)',
        )
        .order('created_at', { ascending: false })
        .limit(100),
    );
    return (data ?? []).map((r) => ({
      ...(r as unknown as TranslationJob),
      estimate_usd: r['estimate_usd'] == null ? null : num(r['estimate_usd']),
      spent_usd: num(r['spent_usd']),
    }));
  }

  async currentBuilds(): Promise<CurrentBuild[]> {
    return this.rows(
      this.sb.client.from('codex_builds').select('id,patch_version,channel,build_number').eq('is_current', true),
    );
  }

  /** Spend of the current UTC month (sum of the ledger). */
  async monthSpend(now: Date = new Date()): Promise<number> {
    const rows = await this.rows<{ usd: number | string }[]>(
      this.sb.client.from('translation_ledger').select('usd').eq('month', monthStartUtc(now)),
    );
    return sumLedger(rows ?? []);
  }

  /** Orchestrator op; an `{error}` answer (also on non-2xx) is thrown as an Error carrying the code. */
  async orchestrator<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.client.functions.invoke('translate-orchestrator', { body });
    let code: string | null = (data as { error?: string } | null)?.error ?? null;
    if (error && !code) {
      const ctx = (error as { context?: Response }).context;
      try {
        code = ((await ctx?.json()) as { error?: string } | undefined)?.error ?? null;
      } catch {
        code = null;
      }
      if (!code) throw error;
    }
    if (code) throw Object.assign(new Error(code), { code });
    return data as T;
  }

  approve(jobId: string) {
    return this.orchestrator({ op: 'approve', job_id: jobId });
  }

  cancel(jobId: string) {
    return this.orchestrator({ op: 'cancel', job_id: jobId });
  }

  /**
   * Orders a full run. Nothing is spent by it: the job is estimated in the background (a few minutes
   * for a whole language) and then waits for approval with its cost and string count.
   */
  startFull(buildId: string, lang: string) {
    return this.orchestrator({ op: 'start_full', build_id: buildId, lang });
  }

  // ── glossary ───────────────────────────────────────────────────────────────

  async listGlossary(f: GlossaryFilters): Promise<{ rows: GlossaryEntry[]; total: number }> {
    const q = buildGlossaryQuery(f);
    let b = this.sb.client
      .from('translation_glossary')
      .select('id,lang,source_term,target_term,category,origin,locked,needs_retranslate,updated_at', { count: 'exact' });
    if (q.or) b = b.or(q.or);
    for (const [col, val] of q.eq) b = b.eq(col, val);
    const { data, error, count } = await b.order('source_term').range(q.from, q.to);
    if (error) throw error;
    return { rows: (data ?? []) as GlossaryEntry[], total: count ?? data?.length ?? 0 };
  }

  async updateGlossary(id: string, patch: GlossaryPatch): Promise<void> {
    await this.rows(this.sb.client.from('translation_glossary').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
  }

  /** A target edit is an admin edit: origin flips to 'admin'. */
  saveTarget(id: string, target: string) {
    return this.updateGlossary(id, { target_term: target, origin: 'admin' });
  }

  async addGlossary(e: { lang: string; source_term: string; target_term: string; category: string }): Promise<void> {
    await this.rows(this.sb.client.from('translation_glossary').insert({ ...e, origin: 'admin' }));
  }

  async history(id: string): Promise<GlossaryHistoryEntry[]> {
    return this.rows(
      this.sb.client
        .from('translation_glossary_history')
        .select('id,glossary_id,before,after,at')
        .eq('glossary_id', id)
        .order('at', { ascending: false })
        .limit(20),
    );
  }

  /** Restore the `before` snapshot of a history row; the restore is itself a new history row. */
  async revert(entry: GlossaryHistoryEntry): Promise<void> {
    const patch = revertPatch(entry.before);
    if (!patch) return;
    await this.updateGlossary(entry.glossary_id, patch as GlossaryPatch);
  }

  // ── community seed: cards, sources, outreach, alerts ───────────────────────

  // ── Karteikarten v2: every read and write goes through the card RPCs (all security definer, admin only) ──

  /** The admin's deck for one language: conventions first, then terms, then wordings (server order). */
  deck(lang: string, limit = 10): Promise<CardDeck> {
    return this.rows(this.sb.client.rpc('translation_deck', { p_lang: lang, p_limit: limit }));
  }

  answerCard(id: string, a: CardAnswerInput): Promise<CardActionResult> {
    const own = a.answer === 'own' ? (a.own_text ?? '').trim() : null;
    const exceptions = a.answer !== 'own' && a.exceptions && Object.keys(a.exceptions).length ? a.exceptions : null;
    return this.rows(
      this.sb.client.rpc('answer_translation_card', {
        p_card_id: id,
        p_answer: a.answer,
        p_own_text: own,
        p_exceptions: exceptions,
      }),
    );
  }

  /** „Nicht meine Entscheidung“: the card leaves the deck for the KI path (P12). */
  notMineCard(id: string): Promise<CardMoveResult> {
    return this.rows(this.sb.client.rpc('not_mine_translation_card', { p_card_id: id }));
  }

  /** Undoes the caller's last action on the card until the next learn pass applies it (P13). */
  undoCard(id: string): Promise<CardMoveResult> {
    return this.rows(this.sb.client.rpc('undo_translation_card', { p_card_id: id }));
  }

  vetoList(lang: string, limit = 50): Promise<VetoList> {
    return this.rows(this.sb.client.rpc('translation_veto_list', { p_lang: lang, p_limit: limit }));
  }

  /** „Sieht falsch aus“ on a KI decision. */
  vetoDecision(id: string): Promise<CardActionResult> {
    return this.rows(this.sb.client.rpc('veto_translation_decision', { p_card_id: id }));
  }

  /** „Passt“ on a KI decision. */
  acceptDecision(id: string): Promise<CardActionResult> {
    return this.rows(this.sb.client.rpc('accept_translation_decision', { p_card_id: id }));
  }

  /** „Rest übernehmen“: takes over every waiting KI decision of the language; no points, no undo. */
  async acceptDecisions(lang: string): Promise<number> {
    return num(await this.rows<unknown>(this.sb.client.rpc('accept_translation_decisions', { p_lang: lang })));
  }

  myLangs(): Promise<string[]> {
    return this.rows(this.sb.client.rpc('translation_my_langs'));
  }

  setMyLangs(langs: readonly string[]): Promise<string[]> {
    return this.rows(this.sb.client.rpc('set_translation_my_langs', { p_langs: [...langs] }));
  }

  /** Daily goal, streak, week points, place, the per-language rows and the named leaderboard (G1–G4). */
  cardBoard(): Promise<CardBoard> {
    return this.rows(this.sb.client.rpc('translation_card_board'));
  }


  /** Admin accounts by id (display name + protected flag): names for the leaderboard, protected status for approvals. */
  async people(): Promise<Map<string, AdminPerson>> {
    const d = await this.rows<
      { id: string; display_name: string | null; username: string | null; email: string; protected: boolean | null }[]
    >(this.sb.client.rpc('list_users_for_admin'));
    return new Map(
      (d ?? []).map((u) => [u.id, { id: u.id, name: u.display_name || u.username || u.email, isProtected: u.protected === true }]),
    );
  }

  listSources(): Promise<TranslationSource[]> {
    return this.rows(
      this.sb.client
        .from('translation_sources')
        .select('id,lang,name,license,license_kind,status,enabled,game_folder,last_synced_at,coverage')
        .order('lang'),
    );
  }

  importSeed(sourceId: string) {
    return this.orchestrator<PassStarted>({ op: 'import_seed', source_id: sourceId });
  }

  /** Running passes plus those that ended in the last `days` days, newest first. */
  listPasses(days = 7, now: Date = new Date()): Promise<TranslationPass[]> {
    const since = new Date(now.getTime() - days * 86_400_000).toISOString();
    return this.rows(
      this.sb.client
        .from('translation_passes')
        .select('id,kind,lang,source_id,reason,status,phase,pos,total,error,created_at,updated_at')
        .or(`status.eq.open,updated_at.gte.${since}`)
        .order('created_at', { ascending: false })
        .limit(30),
    );
  }

  syncSources() {
    return this.orchestrator<SyncSourcesResult>({ op: 'sync_sources' });
  }

  draftOutreach(sourceId: string) {
    return this.orchestrator<Record<string, unknown>>({ op: 'draft_outreach', source_id: sourceId });
  }

  learn(lang: string) {
    return this.orchestrator<PassStarted>({ op: 'learn', lang });
  }

  listOutreach(): Promise<OutreachDraft[]> {
    return this.rows(
      this.sb.client
        .from('translation_outreach')
        .select('id,source_id,kind,message_lang,subject,body,status,approved_at,sent_at,answer,answer_at,decision,created_at')
        .order('source_id')
        .order('created_at', { ascending: false }),
    );
  }

  async saveOutreachDraft(id: string, p: { subject: string; body: string; message_lang: string }): Promise<void> {
    await this.rows(this.sb.client.from('translation_outreach').update(p).eq('id', id));
  }

  approveOutreach(id: string): Promise<OutreachDraft> {
    return this.rows(this.sb.client.rpc('approve_translation_outreach', { p_id: id }).single());
  }

  markOutreachSent(id: string): Promise<OutreachDraft> {
    return this.rows(this.sb.client.rpc('mark_translation_outreach_sent', { p_id: id }).single());
  }

  recordOutreachAnswer(id: string, answer: string, decision: 'granted' | 'refused'): Promise<OutreachDraft> {
    return this.rows(
      this.sb.client.rpc('record_translation_outreach_answer', { p_id: id, p_answer: answer, p_decision: decision }).single(),
    );
  }

  listAlerts(): Promise<OverrideAlert[]> {
    return this.rows(
      this.sb.client
        .from('translation_override_alerts')
        .select('id,lang,key,en_old,en_new,cig_old,cig_new,admin_text,status,created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
    );
  }

  resolveAlert(id: string, resolution: 'kept' | 'adopted' | 'edited', editedText?: string): Promise<OverrideAlert> {
    return this.rows(
      this.sb.client
        .rpc('resolve_override_alert', {
          p_alert_id: id,
          p_resolution: resolution,
          p_edited_text: resolution === 'edited' ? (editedText ?? '').trim() : null,
        })
        .single(),
    );
  }
}
