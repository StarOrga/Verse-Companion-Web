/** Pure helpers of the /admin/translations page (no Angular, no I/O). */

export type JobStatus =
  | 'estimating' | 'awaiting_approval' | 'queued' | 'submitted' | 'validating'
  | 'post_editing' | 'publishing' | 'published' | 'failed' | 'cancelled' | 'skipped';

export const TERMINAL_STATUSES: readonly JobStatus[] = ['published', 'failed', 'cancelled', 'skipped'];

/** Approve is only valid while the job waits for it (orchestrator: not_awaiting_approval). */
export function canApprove(status: string): boolean {
  return status === 'awaiting_approval';
}

/** Cancel is valid for every job that is not finished (orchestrator: not_cancellable). */
export function canCancel(status: string): boolean {
  return !(TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** First day of the UTC month of `d`, as the ledger stores it (`YYYY-MM-01`). */
export function monthStartUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Sum of ledger rows (numeric columns may arrive as strings), rounded to micro-dollars. */
export function sumLedger(rows: readonly { usd: number | string | null }[]): number {
  const total = rows.reduce((s, r) => s + (Number(r.usd) || 0), 0);
  return Math.round(total * 1e6) / 1e6;
}

/** Share of the monthly cap that is spent, clamped to 0..100 (0 when there is no cap). */
export function spendPercent(spent: number, cap: number): number {
  if (!(cap > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((spent / cap) * 100)));
}

/** Mean judge score of a job's stats, or null when the judge did not run. */
export function judgeScore(stats: unknown): number | null {
  const j = (stats as { judge?: { mean?: unknown } | null } | null)?.judge;
  return typeof j?.mean === 'number' ? j.mean : null;
}

const KNOWN_JOB_ERRORS = new Set([
  'translate.base_build_missing', 'translate.conflict', 'translate.english_missing',
  'translate.job_not_found', 'translate.lang_unknown', 'translate.no_api_key',
  'translate.no_base_build', 'translate.not_awaiting_approval', 'translate.not_cancellable',
  'translate.plan_missing', 'translate.results_missing', 'translate.r2_not_configured',
  'translate.internal', 'translate.worker_limit', 'translate.no_live_build', 'translate.source_not_permitted',
  'translate.source_unknown', 'translate.nothing_to_do', 'translate.phase_unknown', 'translate.job_cleanup_pending',
  'translate.resubmit_limit',
]);

const HASH_DIGITS = 16;
const share = (pos: unknown, total: unknown): number => {
  const p = Number(pos);
  const t = Number(total);
  return t > 0 && p >= 0 ? Math.min(1, p / t) : 0;
};

/**
 * How far a job is inside a step that takes many requests (0..99), or null where the step has no
 * measure (a wait for a batch, a job that ended). Read from the position the orchestrator keeps in
 * `stats`: an estimate and a publish walk the table in slices, and without a number they look stuck.
 */
export function jobProgress(status: string, stats: unknown): number | null {
  const s = (stats ?? {}) as {
    phase?: string; pos?: number; est?: { phase?: string; cursor?: number; total?: number } | null;
    plan?: { parts?: number } | null; pub?: { total?: number } | null;
  };
  const span = (from: number, to: number, part: number) => Math.min(99, Math.round(from + (to - from) * part));
  if (status === 'estimating') {
    const e = s.est;
    if (!e) return 0;
    switch (e.phase) {
      case 'adm': return span(0, 5, share(e.cursor, HASH_DIGITS));
      case 'rows': return span(5, 35, share(e.cursor, e.total));
      case 'diff': return span(35, 65, share(e.cursor, HASH_DIGITS));
      case 'prep': return 65;
      case 'chunk': return 70;
      case 'shots': return span(78, 97, share(e.cursor, s.plan?.parts));
      case 'clean':
      case 'complete': return 98;
      default: return null;
    }
  }
  if (status === 'publishing') {
    switch (s.phase) {
      case 'route': return 5;
      case 'tm': return span(10, 35, share(s.pos, HASH_DIGITS));
      case 'rows': return span(35, 65, share(s.pos, s.pub?.total));
      case 'join': return span(65, 95, share(s.pos, HASH_DIGITS));
      case 'assemble': return 97;
      default: return null;
    }
  }
  return null;
}

const HOLDS = new Set(['full', 'upload_cap', 'monthly_cap', 'overrun']);

/** Jobs that ended without a result: what they left out for want of money is of no interest any more. */
const NO_RESULT = new Set(['cancelled', 'failed', 'skipped']);

export interface JobNote { key: string; params: Record<string, number> }

/**
 * The sentences under a job's status that say why it waits for approval, or which paid steps it left
 * out because money ran short (`stats.hold`, `stats.probe`, `stats.capped` of the orchestrator): the
 * texts without a second attempt and the judge sample are two things and each gets its own line.
 */
export function jobNotes(status: string, stats: unknown): JobNote[] {
  const s = (stats ?? {}) as {
    hold?: string; probe?: { ratio?: number } | null;
    capped?: { reason?: string; judge?: boolean; texts?: number } | null;
  };
  const base = 'admin.translations.jobs';
  if (status === 'awaiting_approval') {
    if (typeof s.hold !== 'string' || !HOLDS.has(s.hold)) return [];
    const ratio = Number(s.probe?.ratio);
    const pct = Number.isFinite(ratio) ? Math.max(0, Math.round((ratio - 1) * 100)) : 0;
    return [{ key: `${base}.hold.${s.hold}`, params: s.hold === 'overrun' ? { pct } : {} }];
  }
  const c = s.capped;
  if (!c || NO_RESULT.has(status)) return [];
  const notes: JobNote[] = [];
  const texts = Math.max(0, Math.round(Number(c.texts) || 0));
  if (texts > 0) notes.push({ key: `${base}.capped.${c.reason === 'monthly_cap' ? 'monthly_cap' : 'job_budget'}`, params: { texts } });
  if (c.judge) notes.push({ key: `${base}.capped.judge`, params: {} });
  return notes;
}

/** i18n key for a job's / orchestrator's error code; unknown codes get a generic sentence, never raw text. */
export function jobErrorKey(code: string | null | undefined): string | null {
  if (!code) return null;
  if (KNOWN_JOB_ERRORS.has(code)) return `admin.translations.jobErrors.${code.replace(/^translate\./, '')}`;
  // The pipeline only writes `translate.*` keys: anything else was put on the row by hand (SQL).
  return code.startsWith('translate.') ? 'admin.translations.jobErrors.unknown' : 'admin.translations.jobErrors.manual';
}

export type GlossaryOrigin = 'cig' | 'ai' | 'admin' | 'mined' | 'community';
export type GlossaryCategory = 'term' | 'label' | 'unit' | 'dnt';
export const GLOSSARY_ORIGINS: readonly GlossaryOrigin[] = ['cig', 'ai', 'admin', 'mined', 'community'];
export const GLOSSARY_CATEGORIES: readonly GlossaryCategory[] = ['term', 'label', 'unit', 'dnt'];

export interface GlossaryFilters {
  search: string;
  lang: string | null;
  origin: GlossaryOrigin | null;
  category: GlossaryCategory | null;
  page: number;
}

export const GLOSSARY_PAGE_SIZE = 50;

/**
 * PostgREST `or=` expression matching the term in source or target. Characters
 * that carry meaning in a filter value are dropped so a search can never break
 * out of the expression.
 */
export function glossarySearchFilter(search: string): string | null {
  const q = search.replace(/[,()*%"\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  return `source_term.ilike.%${q}%,target_term.ilike.%${q}%`;
}

export interface GlossaryQuery {
  or: string | null;
  eq: [string, string][];
  from: number;
  to: number;
}

export function buildGlossaryQuery(f: GlossaryFilters): GlossaryQuery {
  const eq: [string, string][] = [];
  if (f.lang) eq.push(['lang', f.lang]);
  if (f.origin) eq.push(['origin', f.origin]);
  if (f.category) eq.push(['category', f.category]);
  const page = Math.max(0, f.page);
  return {
    or: glossarySearchFilter(f.search),
    eq,
    from: page * GLOSSARY_PAGE_SIZE,
    to: page * GLOSSARY_PAGE_SIZE + GLOSSARY_PAGE_SIZE - 1,
  };
}

/** Fields a history "Rückgängig" writes back from the `before` snapshot. */
export function revertPatch(before: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!before) return null;
  const patch: Record<string, unknown> = {};
  for (const k of ['target_term', 'category', 'origin', 'locked', 'needs_retranslate']) {
    if (k in before) patch[k] = before[k];
  }
  return Object.keys(patch).length ? patch : null;
}

/** A source can be imported only once its licence is clear (the orchestrator refuses the rest). */
export function canImportSource(status: string): boolean {
  return status === 'licensed' || status === 'permitted';
}

/** Text coverage (%) stored in a source's `coverage` jsonb, or null when unknown. */
export function coverageText(coverage: Record<string, unknown> | null | undefined): number | null {
  const v = coverage?.['text_pct'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Flat `label: value` pairs of an orchestrator summary object (nested objects as JSON). */
/** Phases of a background pass that walk the string table: `pos` of `total` shards. */
const WALK_PHASES = new Set(['scan', 'mine', 'detect']);
/** The import writes the translation memory in 16 steps (one per first hash digit). */
const APPLY_STEPS = 16;

/** Progress of a running pass in percent; null in phases that have nothing to count. */
export function passProgress(p: { status: string; phase: string; pos: number; total: number }): number | null {
  if (p.status !== 'open') return null;
  const total = WALK_PHASES.has(p.phase) ? p.total : p.phase === 'apply' ? APPLY_STEPS : 0;
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((p.pos / total) * 100)));
}

/** Postgres insufficient-privilege (RPC rights check, e.g. approval by a non-protected admin). */
export function isRightsError(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === '42501';
}

/** Share of a language's game strings that have a translation, as a job last measured it. */
export interface LanguageCoverage {
  /** Whole percent, rounded down: 100 only when no string is missing. */
  pct: number;
  covered: number;
  total: number;
  missing: number;
  /** When it was measured: the publish of the job, else its creation. */
  at: string;
}

interface CoverageJob {
  lang: string;
  status: string;
  stats: unknown;
  created_at: string;
}

/**
 * Coverage read from one job's `stats`. Every estimate counts the whole English table of its build
 * (`counts`: keys, blank, CIG's own valid translations, TM hits), deltas included. A published job
 * also knows its overlay (`overlay_count`: every key the TM fills, its new translations included),
 * which replaces the TM hits of the estimate. Blank English is no text to translate and counts for
 * neither side. Null while the job still counts (`estimating`) or when it never reached the diff.
 */
export function jobCoverage(j: CoverageJob): LanguageCoverage | null {
  if (j.status === 'estimating') return null;
  const s = (j.stats ?? {}) as {
    counts?: { keys?: number; blank?: number; cig?: number; tm?: number } | null;
    overlay_count?: number; published_at?: string;
  };
  const c = s.counts;
  if (!c) return null;
  const total = Math.max(0, Math.round((Number(c.keys) || 0) - (Number(c.blank) || 0)));
  if (!(total > 0)) return null;
  const filled = j.status === 'published' && typeof s.overlay_count === 'number' ? s.overlay_count : Number(c.tm) || 0;
  const covered = Math.max(0, Math.min(total, Math.round((Number(c.cig) || 0) + filled)));
  return {
    pct: Math.floor((covered / total) * 100),
    covered,
    total,
    missing: total - covered,
    at: typeof s.published_at === 'string' ? s.published_at : j.created_at,
  };
}

/** Coverage of `lang` from its newest job that measured one (`jobs` newest first, as listed). */
export function languageCoverage(jobs: readonly CoverageJob[], lang: string): LanguageCoverage | null {
  for (const j of jobs) {
    if (j.lang !== lang) continue;
    const c = jobCoverage(j);
    if (c) return c;
  }
  return null;
}

/** A full run of `lang` that has not ended yet (ordering another one would only return it). */
export function hasOpenFullRun(jobs: readonly { lang: string; mode: string; status: string }[], lang: string): boolean {
  return jobs.some((j) => j.lang === lang && j.mode === 'full' && !(TERMINAL_STATUSES as readonly string[]).includes(j.status));
}

/**
 * Whether ordering a full run makes sense: only approved languages are translated at all, a running
 * one is in the job list already, and a language without a missing string has nothing to fill. At a
 * partial coverage it is the way to fill the gap: a full run only ever translates what CIG and the TM
 * lack. Unmeasured coverage keeps the button: its free estimate is what measures it.
 */
export function canStartFullRun(approved: boolean, coverage: LanguageCoverage | null, openFullRun: boolean): boolean {
  if (!approved || openFullRun) return false;
  return coverage === null || coverage.missing > 0;
}
