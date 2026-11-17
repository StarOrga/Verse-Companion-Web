// Community sources: the rows, starting an import, the daily sync, outreach drafts (ops of index.ts).
// Runs with the service-role client; auth happens in index.ts. Contract: docs/translation/ARCHITECTURE.md.
// The import itself is a sliced pass (_seed_pass.ts); nothing in this file reads a table or a pack.

import { TranslateError } from './_errors.ts';
import type { SourceMetaRow } from './_io.ts';
import type { Deps } from './_job.ts';
import { upstreamToken } from './_pack.ts';
import type { FetchFn, PackSource } from './_pack.ts';
import { buildOutreachDraft } from './_outreach.ts';

// deno-lint-ignore no-explicit-any
type Client = any;

export interface SourceRow extends PackSource, SourceMetaRow {
  last_seen_commit: string | null;
  last_synced_at: string | null;
  coverage: Record<string, unknown> | null;
}

/** What `import_seed` answers: the import runs as a pass, its result lands on the source row. */
export interface ImportStarted {
  source_id: string;
  lang: string;
  queued: true;
  pass_id: string;
}

export interface SyncResult {
  checked: number;
  /** Sources whose upstream changed: an import pass was started for each. */
  changed: number;
  errors: { source_id: string; error: string }[];
}

/** The source table and the upstream as the passes see them (index.ts wires it; tests pass a fake). */
export interface SourceDb {
  load(id: string): Promise<SourceRow>;
  list(lang?: string): Promise<SourceRow[]>;
  /** Newest current build of the LIVE channel. */
  liveBuild(): Promise<string>;
  /** Records a finished import on the source row. */
  update(id: string, patch: { coverage: Record<string, unknown>; last_synced_at: string; last_seen_commit: string | null }): Promise<void>;
  fetchFn?: FetchFn;
  ghToken?: string;
}

function fail(e: { message?: string } | null): never {
  throw new Error(e?.message ?? 'db error');
}

export const isUsable = (s: Pick<SourceRow, 'status' | 'enabled'>) =>
  s.enabled && (s.status === 'licensed' || s.status === 'permitted');

/**
 * The published table that holds CIG's own translation into a language, or null when there is none to respect.
 *
 * It is the table under the language's short code: the uploader publishes every `global.ini` of the game
 * under the code of `localization.py` (`de`, `ja`, …). `translation_languages.cig_folder` is the folder
 * name inside the game (`german_(germany)`), which only the app needs. Until 0.274.0 the pipeline read
 * the table `<cig_folder>`, found nothing, and so never respected a single line of CIG's own translation
 * (German: 22 993 keys) - every one of them was a candidate for the AI and for a community pack.
 *
 * null: a usable source of the language says the folder it installs into holds another language
 * (`use_cig_table = false`, ru in the korean slot).
 */
export async function cigTableFor(deps: Pick<Deps, 'sources'>, lang: string): Promise<string | null> {
  const rows = deps.sources ? await deps.sources.list(lang) : [];
  return rows.some((r) => isUsable(r) && r.use_cig_table === false) ? null : lang;
}

export async function loadSource(sb: Client, id: string): Promise<SourceRow> {
  const { data, error } = await sb.from('translation_sources').select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) throw new TranslateError('translate.source_unknown');
  return data as SourceRow;
}

export async function listSources(sb: Client, lang?: string): Promise<SourceRow[]> {
  let q = sb.from('translation_sources').select('*').order('id');
  if (lang) q = q.eq('lang', lang);
  const { data, error } = await q;
  if (error) fail(error);
  return (data ?? []) as SourceRow[];
}

/** Newest current build of the LIVE channel (`codex_builds.is_current`, one per channel). */
export async function currentLiveBuild(sb: Client): Promise<string> {
  const { data, error } = await sb.from('codex_builds').select('id').eq('channel', 'LIVE').eq('is_current', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) fail(error);
  if (!data) throw new TranslateError('translate.no_live_build');
  return (data as { id: string }).id;
}

export function makeSourceDb(sb: Client, opts: { fetchFn?: FetchFn; ghToken?: string } = {}): SourceDb {
  return {
    load: (id) => loadSource(sb, id),
    list: (lang) => listSources(sb, lang),
    liveBuild: () => currentLiveBuild(sb),
    async update(id, patch) {
      const { error } = await sb.from('translation_sources').update(patch).eq('id', id);
      if (error) fail(error);
    },
    fetchFn: opts.fetchFn,
    ghToken: opts.ghToken,
  };
}

/**
 * A4: asks for the import of one source. The pack is filtered into the TM (`o:'community'`), the
 * coverage lands on the source row, then the overlay is rebuilt and learning follows - all of it in
 * the seed pass, slice by slice. Idempotent: a second request while one runs makes it run once more.
 */
export async function startImport(deps: Deps, sourceId: string, reason: 'seed' | 'sync' = 'seed'): Promise<ImportStarted> {
  if (!deps.sources || !deps.passes) throw new TranslateError('translate.internal');
  const src = await deps.sources.load(sourceId);
  if (!isUsable(src)) throw new TranslateError('translate.source_not_permitted');
  const pass = await deps.passes.open({ kind: 'seed', lang: src.lang, source_id: src.id, reason });
  return { source_id: src.id, lang: src.lang, queued: true, pass_id: pass.id };
}

/** A5: compare the upstream marker with `last_seen_commit`; start an import for what changed. */
export async function syncSources(deps: Deps): Promise<SyncResult> {
  const out: SyncResult = { checked: 0, changed: 0, errors: [] };
  if (!deps.sources || !deps.passes) return out;
  const { sources, passes } = deps;
  const running = new Set((await passes.listOpen()).filter((p) => p.kind === 'seed').map((p) => p.source_id));
  for (const src of (await sources.list()).filter(isUsable)) {
    out.checked++;
    try {
      // An import of this source is under way: it records the marker when it is done.
      if (running.has(src.id)) continue;
      const marker = await upstreamToken(src, sources.fetchFn, sources.ghToken);
      // No marker to compare (no ETag at all): do not re-download daily, only when never imported.
      if (marker !== null ? marker === src.last_seen_commit : src.last_synced_at !== null) continue;
      await passes.open({ kind: 'seed', lang: src.lang, source_id: src.id, reason: 'sync' });
      out.changed++;
    } catch (e) {
      const error = String((e as Error)?.message ?? e);
      deps.log('sync_sources: source failed', { source_id: src.id, error });
      out.errors.push({ source_id: src.id, error });
    }
  }
  return out;
}

/** E3: deterministic draft; an existing unsent draft of the same kind is refreshed, not duplicated. */
export async function draftOutreach(sb: Client, sourceId: string): Promise<Record<string, unknown>> {
  const src = await loadSource(sb, sourceId);
  const d = buildOutreachDraft(src as unknown as Parameters<typeof buildOutreachDraft>[0]);
  const have = await sb.from('translation_outreach').select('id').eq('source_id', sourceId).eq('kind', d.kind).eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (have.error) fail(have.error);
  const fields = { kind: d.kind, message_lang: d.message_lang, subject: d.subject, body: d.body };
  const res = have.data
    ? await sb.from('translation_outreach').update(fields).eq('id', (have.data as { id: string }).id).select('*').single()
    : await sb.from('translation_outreach').insert({ source_id: sourceId, ...fields, status: 'draft' }).select('*').single();
  if (res.error) fail(res.error);
  return res.data as Record<string, unknown>;
}
