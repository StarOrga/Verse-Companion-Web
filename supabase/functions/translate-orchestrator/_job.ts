// Types and small helpers of a translation job, shared by the driver (_machine.ts) and the steps
// (_job_estimate.ts, _job_run.ts, _job_publish.ts). Pure of Deno/network: everything external comes
// in through Deps (Postgres rows, R2, the Anthropic batch API), so the steps are unit-tested with fakes.

import type { AlertRow } from './_alerts.ts';
import type { Estimate, Usage } from './_cost.ts';
import type { DiffCounts } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import type { Store } from './_io.ts';
import type { LearnDb } from './_learn_db.ts';
import type { PassDb, PassKind, PassStep } from './_pass.ts';
import type { BatchParams, GlossaryRow } from './_prompt.ts';
import type { SourceDb } from './_sources.ts';

export type Status =
  | 'estimating' | 'awaiting_approval' | 'queued' | 'submitted' | 'validating' | 'post_editing'
  | 'publishing' | 'published' | 'failed' | 'cancelled' | 'skipped';

export const OPEN_STATUSES: Status[] = ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'];
export const TERMINAL_STATUSES: Status[] = ['published', 'failed', 'cancelled', 'skipped'];

export interface BatchRef {
  id: string;
  kind: 'main' | 'judge' | 'postedit';
}

export interface QaStats {
  ok: number;
  failed: number;
  reasons: Record<string, number>;
  dropped?: number;
}

/** What the estimate keeps between its slices (see _job_estimate.ts). */
export interface EstState {
  phase: 'adm' | 'rows' | 'diff' | 'prep' | 'chunk' | 'shots' | 'clean' | 'complete';
  /** adm / diff: hash digit; rows: English shard index; chunk: segment; shots: plan part. */
  cursor: number;
  /** English shard count of the walk. */
  total: number;
  /** rows: the publication of the tables the walk reads (`tableMark`). */
  mark?: string;
  /** Keys with blank English (counted by the rows walk, which writes no row for them). */
  blank?: number;
  /** Todo items per segment (`_job_estimate.ts: segmentsOf`), and the hash digits that hold some of them. */
  seg?: Record<string, number>;
  sd?: Record<string, string>;
  /** chunk: items of the current segment already chunked (a segment larger than one slice). */
  off?: number;
  /** Keys that will be translated (every key of every todo text). */
  strings?: number;
  /** Per model: requests and the token sums the estimate is computed from. */
  cost?: Record<string, { requests: number; inTok: number; outTok: number }>;
  /** Few-shot pairs over all requests. */
  shots?: number;
}

/** The plan as the later steps need it: how many parts, chunks and batches there are. */
export interface PlanShape {
  parts: number;
  chunks: number;
}

export interface Stats {
  /** Where the job is inside its status. */
  phase?: string;
  /** Position inside the phase (batch group, hash digit, English shard …). */
  pos?: number;
  hold?: string;
  attempts?: number;
  counts?: DiffCounts;
  estimate?: Estimate;
  qa?: QaStats;
  /** QA per batch group; `qa` is their sum. */
  qg?: Record<string, QaStats>;
  judge?: { n: number; mean: number } | null;
  est?: EstState;
  plan?: PlanShape;
  /** Batch groups that have a post-edit batch, in batch order. */
  pe?: number[];
  /** Publishing: when it began (TM entries of this job carry it) and the TM revision the overlay was joined at. */
  pub?: { at: string; total?: number; mark?: string; rev?: number; rejoins?: number };
  /** Heavy step in flight since (ISO); still set after RUN_STALE_MS = that run was killed (_attempts.ts). */
  run_at?: string;
  /** Killed runs in a row without progress. */
  dead?: number;
  /** A batch create in flight: written before the provider call, cleared with the saved ref (see _job_run.ts). */
  submit?: { kind: BatchRef['kind']; g: number; at: string };
  /** Batches created again after a run died with its intent open: each may exist twice at the provider. */
  resubmits?: number;
  /** The job has ended and its work files are still there: the tick deletes them in slices. */
  sweep?: boolean;
  /**
   * How often this job was started again (`start_full` on an ended run). Part of its ledger refs:
   * the batches of a second run are other batches, and their spend must not be taken for a repeat.
   */
  run?: number;
  [k: string]: unknown;
}

export interface Job {
  id: string;
  build_id: string;
  lang: string;
  mode: 'delta' | 'full';
  base_build_id: string | null;
  status: Status;
  string_count: number | null;
  estimate_usd: number | null;
  spent_usd: number;
  batch_ids: BatchRef[];
  stats: Stats | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
}

export type JobPatch = Partial<Pick<Job, 'status' | 'string_count' | 'estimate_usd' | 'spent_usd' | 'batch_ids' | 'stats' | 'error' | 'approved_by'>>;

export interface Settings {
  enabled: boolean;
  upload_cap_usd: number;
  monthly_cap_usd: number;
  lore_model: string | null;
  rest_model: string | null;
}

export interface Db {
  listOpenJobs(): Promise<Job[]>;
  /** Ended jobs whose work files are still to be deleted (`stats.sweep`). */
  listSweepJobs?(): Promise<Job[]>;
  getJob(id: string): Promise<Job | null>;
  /** The job of a build, language and mode (there is at most one). */
  findJob?(build_id: string, lang: string, mode: 'delta' | 'full'): Promise<Job | null>;
  /** Compare-and-set on id + status + updated_at; stamps updated_at; null when someone else won. */
  cas(job: Job, patch: JobPatch): Promise<Job | null>;
  insertJob(j: { build_id: string; lang: string; mode: 'delta' | 'full'; base_build_id: string | null; stats?: Stats }): Promise<Job>;
  getSettings(): Promise<Settings>;
  getLanguage(lang: string): Promise<{ lang: string; cig_folder: string | null; approved: boolean } | null>;
  listGlossary(lang: string): Promise<GlossaryRow[]>;
  insertGlossary(lang: string, rows: GlossaryRow[]): Promise<void>;
  resetRetranslate(ids: string[]): Promise<void>;
  /** Sum of estimate_usd of the other jobs of this build that are not failed/cancelled/skipped. */
  buildEstimateSum(buildId: string, excludeJobId: string): Promise<number>;
  /** Ledger sum of the month plus the unspent part of in-flight jobs (excluding `excludeJobId`). */
  monthCommitted(month: string, excludeJobId: string): Promise<number>;
  /** Books spend. With `ref`, a second booking of the same (job, ref) is ignored: a repeated slice books once. */
  addLedger(jobId: string, month: string, usd: number, ref?: string): Promise<void>;
  hasNewerPublished(job: Job): Promise<boolean>;
}

export interface BatchResult {
  custom_id: string;
  type: 'succeeded' | 'errored' | 'canceled' | 'expired';
  text?: string;
  stop_reason?: string | null;
  usage?: Usage;
  model?: string;
}

export interface Llm {
  createBatch(requests: { custom_id: string; params: BatchParams }[]): Promise<{ id: string }>;
  isEnded(id: string): Promise<boolean>;
  results(id: string): AsyncIterable<BatchResult>;
  cancel(id: string): Promise<void>;
}

export interface Deps {
  db: Db;
  store: Store;
  /** null = secret TRANSLATE_ANTHROPIC_API_KEY absent. */
  llm: Llm | null;
  now(): Date;
  /** Monotonic ms for the slice budget (default `performance.now`); fakes may pin it. */
  perfNow?(): number;
  log(msg: string, data?: Record<string, unknown>): void;
  /** Learning step adapter (`makeLearnDb`); absent = no learning, no cards (tests, older wiring). */
  learn?: LearnDb;
  /** Writes override alerts (B4, service-role client in index.ts); absent = no alerts. */
  alerts?: (lang: string, buildId: string, rows: AlertRow[]) => Promise<void>;
  /** Background passes (learn, seed import, overlay rebuild); absent = none are started or run. */
  passes?: PassDb;
  /** The step of each pass kind (index.ts: PASS_STEPS). Kept out of the driver so it stays free of the pass modules. */
  passSteps?: Record<PassKind, PassStep>;
  /** Community sources and their upstream (seed passes, overlay credits); absent = no imports, bare overlays. */
  sources?: SourceDb;
  /**
   * Lock around heavy work. Two requests that run slices at the same time would add their CPU up in
   * one worker and could rewrite the same TM shard; with the lock the second one does nothing.
   * `claim` returns the owner's token, or null when someone else holds the lock; only that token
   * gives it back. It expires by time, so a killed request frees it. Absent (tests) = no lock.
   */
  lock?: { claim(): Promise<string | null>; release(token: string): Promise<void> };
}

/** Requests per batch group is a multiple of this: plan parts hold up to PART_CHUNKS requests each. */
export const PART_CHUNKS = 15;
/** Plan parts per batch: one batch is created, and later read and checked, in one request. */
export const GROUP_PARTS = 2;
/** An intent to create a batch that is older than this belongs to a request that died. */
export const STALE_SUBMIT_MS = 15 * 60_000;
export const JUDGE_MODEL = 'claude-opus-5-5';
export const JUDGE_THRESHOLD = 6;
export const MAX_ATTEMPTS = 5;
export const JUDGE_CAP = 150;

export const round4 = (n: number) => Math.round(n * 1e6) / 1e6; // micro-dollars; the name is historical
export const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

export function addStats(job: Job, patch: Partial<Stats>): Stats {
  return { ...(job.stats ?? {}), ...patch };
}

/** A compare-and-set this request lost: the job belongs to another request now. */
export class LostRace extends Error {}

export function must(job: Job | null): Job {
  if (!job) throw new LostRace();
  return job;
}

export function requireLlm(deps: Deps): Llm {
  if (!deps.llm) throw new TranslateError('translate.no_api_key');
  return deps.llm;
}

/** Everything a job writes while it works lives under this prefix and goes when the job has ended. */
export const jobPrefix = (jobId: string) => `translation-work/${jobId}/`;
export const jobKey = (jobId: string, name: string) => `${jobPrefix(jobId)}${name}.json`;

/**
 * Ends a slice: the patch, and with it the dead-run marker (a slice that got here was not killed).
 * Throws LostRace when another request moved the job meanwhile.
 */
export async function slice(deps: Deps, job: Job, stats: Partial<Stats>, patch: JobPatch = {}): Promise<Job> {
  return must(await deps.db.cas(job, { ...patch, stats: addStats(job, { ...stats, run_at: undefined, dead: undefined, attempts: undefined }) }));
}

/** The number of batch groups of a plan. */
export const groupsOf = (parts: number) => Math.ceil(parts / GROUP_PARTS);
/** The plan parts of batch group `g`. */
export function partsOfGroup(g: number, parts: number): number[] {
  const out: number[] = [];
  for (let p = g * GROUP_PARTS; p < Math.min(parts, (g + 1) * GROUP_PARTS); p++) out.push(p);
  return out;
}
