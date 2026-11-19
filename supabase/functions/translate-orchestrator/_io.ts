// R2 access for the orchestrator: the translation memory and the delivery overlay. (The string
// tables are read through _scan.ts, shard by shard.)

import type { TmEntry } from './_diff.ts';

export interface Store {
  /** Parsed JSON, or null when the object does not exist. */
  getJson(key: string): Promise<unknown | null>;
  putJson(key: string, value: unknown): Promise<void>;
  deleteKey(key: string): Promise<void>;
  /** Writes JSON text as it is (an overlay of ~10 MB is put together as text and stored under two keys). */
  putText?(key: string, text: string): Promise<void>;
  /** Keys under a prefix. Absent (a plain test store) = work files cannot be swept by prefix. */
  list?(prefix: string): Promise<string[]>;
}

const READ_CONCURRENCY = 12;

export async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/** Deletes objects in small parallel batches; a missing one is not an error. */
export async function deleteKeys(store: Store, keys: string[]): Promise<void> {
  await inPool(keys, READ_CONCURRENCY, async (k) => {
    await store.deleteKey(k).catch(() => {});
  });
}

/**
 * Deletes up to `max` objects under a prefix and says whether none is left. A delete is a signed request
 * of its own, so a few hundred of them are a slice, not an afterthought. Without `list` there is nothing
 * to find: done.
 */
export async function sweepPrefix(store: Store, prefix: string, max: number): Promise<boolean> {
  if (!store.list) return true;
  const keys = await store.list(prefix);
  await deleteKeys(store, keys.slice(0, max));
  return keys.length <= max;
}

// ── translation memory: translation-tm/<lang>/index.json + <hh>.json (first two hash chars) ──

export const tmIndexKey = (lang: string) => `translation-tm/${lang}/index.json`;
export const tmShardKey = (lang: string, hh: string) => `translation-tm/${lang}/${hh}.json`;
/**
 * The admin entries of a TM once more, in one small file (hash -> text). The override alerts ask
 * "does an admin text hang on this English?" for keys all over the table; with this file they do not
 * have to open the TM for it. `full` = every shard has been looked at (a job's `adm` phase does that
 * once per language); `saveTm` keeps it current from then on.
 */
export const tmAdminKey = (lang: string) => `translation-tm/${lang}/admin.json`;

export interface TmAdmin {
  full: boolean;
  entries: Record<string, string>;
}

export async function loadTmAdmin(store: Store, lang: string): Promise<TmAdmin> {
  const a = await store.getJson(tmAdminKey(lang)) as Partial<TmAdmin> | null;
  return { full: a?.full === true, entries: a?.entries && typeof a.entries === 'object' ? a.entries : {} };
}

/** Adds admin entries (and removes hashes an admin entry no longer holds); `full` is only ever switched on. */
export async function mergeTmAdmin(
  store: Store, lang: string, add: Record<string, string>, full = false, remove: string[] = [],
): Promise<void> {
  const cur = await loadTmAdmin(store, lang);
  const entries = { ...cur.entries, ...add };
  for (const h of remove) delete entries[h];
  await store.putJson(tmAdminKey(lang), { full: cur.full || full, entries });
}
const HEX2 = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** The whole TM of a language. For tests and tools: a request reads one hash digit (`loadTmDigit`), never this. */
export async function loadTm(store: Store, lang: string): Promise<Record<string, TmEntry>> {
  const index = await store.getJson(tmIndexKey(lang)) as { shards?: string[] } | null;
  const names = index?.shards ?? [];
  const tm: Record<string, TmEntry> = {};
  await inPool(names, READ_CONCURRENCY, async (hh) => {
    const shard = await store.getJson(tmShardKey(lang, hh));
    if (shard && typeof shard === 'object') Object.assign(tm, shard as Record<string, TmEntry>);
  });
  return tm;
}

interface TmIndex {
  shards?: string[];
  count?: number;
  /** Entries per shard, for the shards written since counts exist. */
  counts?: Record<string, number>;
  /** Goes up with every write: a reader that kept the number sees whether the TM changed under it. */
  rev?: number;
}

/**
 * Read-modify-write of only the touched shards, then the index (idempotent for the same updates).
 * The entry count is kept per shard and summed, so a write that is repeated after a kill between the
 * shards and the index counts nothing twice and loses nothing.
 */
export async function saveTm(store: Store, lang: string, updates: Record<string, TmEntry>): Promise<number> {
  const byShard = new Map<string, Record<string, TmEntry>>();
  for (const [h, e] of Object.entries(updates)) {
    const hh = h.slice(0, 2);
    if (!HEX2.includes(hh)) continue;
    let s = byShard.get(hh);
    if (!s) byShard.set(hh, (s = {}));
    s[h] = e;
  }
  const index = await store.getJson(tmIndexKey(lang)) as TmIndex | null;
  const known = new Set(index?.shards ?? []);
  const counts: Record<string, number> = { ...(index?.counts ?? {}) };
  let added = 0;
  // Shards written before counts existed are in `count` only; that share shrinks to nothing as they
  // are written again.
  let legacy = Math.max(0, (index?.count ?? 0) - Object.values(counts).reduce((a, n) => a + n, 0));
  const adminAdd: Record<string, string> = {};
  const adminGone: string[] = [];
  await inPool([...byShard], READ_CONCURRENCY, async ([hh, upd]) => {
    const cur = (await store.getJson(tmShardKey(lang, hh)) ?? {}) as Record<string, TmEntry>;
    const before = Object.keys(cur).length;
    for (const h of Object.keys(upd)) {
      if (!(h in cur)) added++;
      if (upd[h].o === 'admin') adminAdd[h] = upd[h].t;
      else if (cur[h]?.o === 'admin') adminGone.push(h);
    }
    const next = { ...cur, ...upd };
    await store.putJson(tmShardKey(lang, hh), next);
    known.add(hh);
    if (!(hh in counts)) legacy = Math.max(0, legacy - before);
    counts[hh] = Object.keys(next).length;
  });
  await store.putJson(tmIndexKey(lang), {
    v: 1,
    lang,
    shards: [...known].sort(),
    count: legacy + Object.values(counts).reduce((a, n) => a + n, 0),
    counts,
    rev: (index?.rev ?? 0) + 1,
    updated_at: new Date().toISOString(),
  });
  if (Object.keys(adminAdd).length || adminGone.length) await mergeTmAdmin(store, lang, adminAdd, false, adminGone);
  return added;
}

// ── overlay ──

export interface OverlaySource {
  id: string;
  name: string;
  url: string;
  /** SPDX-ish licence of the source text. */
  license: string;
  /** Plain credit name shown in the attribution line. */
  attribution: string;
}

export interface Overlay {
  v: 1;
  lang: string;
  build_id: string;
  generated_at: string;
  count: number;
  entries: Record<string, { h: string; t: string }>;
  /** Every source that contributed at least one entry (+ 'scc-ai' when AI entries exist). */
  sources: OverlaySource[];
  /** One uniform credit line (de text for de, en text otherwise). */
  attribution: string;
  /** Data/Localization/<folder> the app writes into; null = the app's own mapping. */
  game_folder: string | null;
  /** false when the folder's CIG table is a different language (ru in the korean slot). */
  use_cig_table: boolean;
}

export type OverlayMeta = Partial<Pick<Overlay, 'sources' | 'attribution' | 'game_folder' | 'use_cig_table'>>;

export const overlayKey = (lang: string, buildOrLatest: string) => `translation-overlay/${lang}/${buildOrLatest}.json`;

/**
 * Room labels (E14): the uploader adds every room label the game ships without German as an English
 * string `scc_room_<slug>` (data-uploader/python/sc_extract/ship_rooms.py), so a delta job translates
 * them like any new key. The website reads only that slice: `translation-overlay/<lang>/rooms.json`,
 * written next to every `latest.json` (_overlay.ts), a few kB instead of the whole overlay.
 */
export const ROOM_LABEL_PREFIX = 'scc_room_';
export const roomOverlayKey = (lang: string) => `translation-overlay/${lang}/rooms.json`;

/** Overlay v1 + the additive source/attribution fields; `meta` is optional (older callers). */
export function makeOverlay(
  lang: string,
  buildId: string,
  entries: Record<string, { h: string; t: string }>,
  at: string,
  meta: OverlayMeta = {},
): Overlay {
  return {
    v: 1,
    lang,
    build_id: buildId,
    generated_at: at,
    count: Object.keys(entries).length,
    entries,
    sources: meta.sources ?? [],
    attribution: meta.attribution ?? '',
    game_folder: meta.game_folder ?? null,
    use_cig_table: meta.use_cig_table ?? true,
  };
}

export interface SourceMetaRow {
  id: string;
  lang: string;
  name: string;
  repo_url: string | null;
  license: string;
  license_kind: string;
  attribution: string;
  game_folder: string | null;
  use_cig_table: boolean;
  enabled: boolean;
  status: string;
}

/** Source id of the AI contribution in `sources`. */
export const AI_SOURCE_ID = 'scc-ai';
const NC_SA = 'CC-BY-NC-SA-4.0';

/**
 * Uniform credit line, the same form for every language (d2-license note); only the words
 * follow the target language: `Community-Übersetzung: A, B (MIT) · KI-Ergänzung: Verse Companion`.
 */
export function attributionLine(lang: string, sources: OverlaySource[]): string {
  const de = lang === 'de';
  const community = sources.filter((s) => s.id !== AI_SOURCE_ID);
  const parts: string[] = [];
  if (community.length) {
    const names = community.map((s) => s.attribution || s.name).join(', ');
    const lics = [...new Set(community.map((s) => s.license).filter(Boolean))].join(', ');
    parts.push(`${de ? 'Community-Übersetzung' : 'Community translation'}: ${names}${lics ? ` (${lics})` : ''}`);
  }
  if (sources.some((s) => s.id === AI_SOURCE_ID)) parts.push(`${de ? 'KI-Ergänzung' : 'AI supplement'}: Verse Companion`);
  return parts.join(' · ');
}

/**
 * sources / attribution / game_folder / use_cig_table for one language's overlay.
 * `tm` is only read for the entries' hashes (`src` of community entries, `o` of the rest).
 * An NC-SA contribution makes the whole overlay CC-BY-NC-SA 4.0 (SCC stays free for it).
 */
export function buildOverlayMeta(
  lang: string,
  entries: Record<string, { h: string; t: string }>,
  tm: Record<string, { o: string; src?: string }>,
  sourceRows: SourceMetaRow[],
): Required<OverlayMeta> {
  const { used, ai } = overlayUsage(entries, tm);
  return overlayMetaOf(lang, used, ai, sourceRows);
}

/** Which community sources the entries come from, and whether any is the AI's. Adds up across slices. */
export function overlayUsage(
  entries: Record<string, { h: string; t: string }>,
  tm: Record<string, { o: string; src?: string }>,
): { used: Set<string>; ai: boolean } {
  const used = new Set<string>();
  let ai = false;
  for (const e of Object.values(entries)) {
    const hit = tm[e.h];
    if (!hit) continue;
    if (hit.o === 'community' && hit.src) used.add(hit.src);
    else if (hit.o === 'ai') ai = true;
  }
  return { used, ai };
}

/** `buildOverlayMeta` from the usage alone (what a sliced build has after merging its parts). */
export function overlayMetaOf(lang: string, used: Set<string>, ai: boolean, sourceRows: SourceMetaRow[]): Required<OverlayMeta> {
  const rows = sourceRows.filter((r) => r.lang === lang);
  const contributing = rows.filter((r) => used.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
  const nc = contributing.some((r) => r.license_kind === 'nc_sa');
  const sources: OverlaySource[] = contributing.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.repo_url ?? '',
    license: r.license,
    attribution: r.attribution || r.name,
  }));
  if (ai) {
    sources.push({
      id: AI_SOURCE_ID,
      name: 'Verse Companion KI',
      url: 'https://versecompanion-alpha.vercel.app',
      license: nc ? NC_SA : 'Verse Companion',
      attribution: 'Verse Companion',
    });
  }
  // Folder and CIG-table flag come from the contributing source, else from any usable source.
  const usable = rows.filter((r) => r.enabled && (r.status === 'licensed' || r.status === 'permitted'));
  const ref = contributing[0] ?? usable[0];
  return {
    sources,
    attribution: attributionLine(lang, sources),
    game_folder: ref?.game_folder ?? null,
    use_cig_table: ref ? ref.use_cig_table : true,
  };
}
