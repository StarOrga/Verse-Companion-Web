// The delivery overlay of one language for one build, built in slices from the translation memory.
//
// An overlay holds every key CIG leaves untranslated that the TM can fill: ~85k entries, ~10 MB for a
// language with a community pack. Building it used to mean the whole English table, the whole CIG
// table and the whole TM in one request. Here it is the two walks of _rows.ts: the rows of the table
// by key, then one hash digit per slice against a sixteenth of the TM. Each digit leaves its entries
// as a piece of JSON text; the last step joins the sixteen pieces and writes the file without parsing
// or serializing 10 MB.
//
// Two callers: a job that publishes (_machine.ts) and the `overlay` pass that follows a source import.

import type { TmEntry } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import { overlayKey, overlayMetaOf, overlayUsage, ROOM_LABEL_PREFIX, roomOverlayKey, sweepPrefix } from './_io.ts';
import type { Overlay, OverlayMeta, SourceMetaRow, Store } from './_io.ts';
import { commit, mergeState, passPrefix } from './_pass.ts';
import type { Pass, PassStep } from './_pass.ts';
import { diffRows, DIGITS, HEX, loadKeySlice, loadRows, loadTmDigit, openRowReaders, rowsOf, tableMark, tmRevision, writeRows } from './_rows.ts';
import type { Row } from './_rows.ts';
import { SCAN_SHARDS } from './_scan.ts';
import { cigTableFor } from './_sources.ts';

type Entries = Record<string, { h: string; t: string }>;

/** The overlay entries of one hash digit. */
export interface OverlayPart {
  /** Number of entries. */
  n: number;
  /** The entries as JSON text without the braces (`"key":{"h":…,"t":…},…`), keys sorted. */
  body: string;
  /** The `scc_room_*` entries again, as an object: the website reads only that slice. */
  rooms: Entries;
  /** Community sources the entries of this part come from. */
  srcs: string[];
  /** Some entry is the AI's. */
  ai: boolean;
}

export interface OverlayScan {
  /**
   * Glossary terms flagged for retranslation by the job that publishes. A string that uses one keeps
   * its place in the overlay only when that job rewrote it (`since`); the old wording is not shipped again.
   */
  forceTerms?: string[];
  /** Start of the publish (ISO): TM entries written from then on are this job's. */
  since?: string;
}

/** The entries the TM can fill among the rows of one digit. */
export async function overlayEntries(rows: Row[], tm: Record<string, TmEntry>, scan: OverlayScan = {}): Promise<Entries> {
  const diff = await diffRows(rows, tm, { mode: 'full', forceTerms: scan.forceTerms });
  const entries = diff.reused;
  if (scan.since) {
    for (const u of diff.todo) {
      const hit = tm[u.h];
      if (hit && hit.o === 'ai' && (hit.at ?? '') >= scan.since) for (const k of u.keys) entries[k] = { h: u.h, t: hit.t };
    }
  }
  return entries;
}

export function overlayPartOf(entries: Entries, tm: Record<string, TmEntry>): OverlayPart {
  const { used, ai } = overlayUsage(entries, tm);
  const keys = Object.keys(entries).sort();
  const rooms: Entries = {};
  const body: string[] = [];
  for (const k of keys) {
    const e = entries[k];
    body.push(`${JSON.stringify(k)}:${JSON.stringify({ h: e.h, t: e.t })}`);
    if (k.startsWith(ROOM_LABEL_PREFIX)) rooms[k] = { h: e.h, t: e.t };
  }
  return { n: keys.length, body: body.join(','), rooms, srcs: [...used].sort(), ai };
}

export interface AssembledOverlay {
  /** The overlay file as JSON text. */
  text: string;
  count: number;
  attribution: string;
  /** The room-label slice (same shape as an overlay). */
  rooms: Overlay;
}

/** Joins the parts into the overlay file (sources, attribution, game folder from the source rows). */
export function assembleOverlay(
  lang: string, buildId: string, parts: OverlayPart[], at: string, sourceRows: SourceMetaRow[] | null,
): AssembledOverlay {
  const used = new Set<string>();
  let ai = false;
  let count = 0;
  const rooms: Entries = {};
  for (const p of parts) {
    for (const s of p.srcs) used.add(s);
    ai = ai || p.ai;
    count += p.n;
    Object.assign(rooms, p.rooms);
  }
  const m: OverlayMeta = sourceRows ? overlayMetaOf(lang, used, ai, sourceRows) : {};
  const meta = {
    sources: m.sources ?? [], attribution: m.attribution ?? '', game_folder: m.game_folder ?? null, use_cig_table: m.use_cig_table ?? true,
  };
  const head = JSON.stringify({ v: 1, lang, build_id: buildId, generated_at: at, count });
  const tail = JSON.stringify(meta);
  const body = parts.map((p) => p.body).filter(Boolean).join(',');
  const text = `${head.slice(0, -1)},"entries":{${body}},${tail.slice(1)}`;
  return {
    text, count, attribution: meta.attribution,
    rooms: { v: 1, lang, build_id: buildId, generated_at: at, count: Object.keys(rooms).length, entries: rooms, ...meta },
  };
}

/**
 * Writes an overlay under its build key and, when it is the newest one of its language, as `latest.json`
 * with the room-label slice.
 */
export async function writeOverlayText(store: Store, lang: string, buildId: string, a: AssembledOverlay, latest: boolean): Promise<void> {
  const put = (key: string) => (store.putText ? store.putText(key, a.text) : store.putJson(key, JSON.parse(a.text)));
  await put(overlayKey(lang, buildId));
  if (!latest) return;
  await put(overlayKey(lang, 'latest'));
  await store.putJson(roomOverlayKey(lang), a.rooms);
}

export const overlayPartKey = (prefix: string, digit: number) => `${prefix}ovl-${HEX[digit]}.json`;

/** Reads the sixteen parts; null when one is missing. */
export async function loadOverlayParts(store: Store, prefix: string): Promise<OverlayPart[] | null> {
  const parts: OverlayPart[] = [];
  for (let d = 0; d < DIGITS; d++) {
    const part = (await store.getJson(overlayPartKey(prefix, d))) as OverlayPart | null;
    if (!part) return null;
    parts.push(part);
  }
  return parts;
}

// ── the `overlay` pass: rebuild latest.json of a language from its TM ─────────────────────────────

/** The TM changed under a join this often: the overlay is written as it is, the next request brings the rest. */
const MAX_REJOINS = 3;
const CLEAN_KEYS = 150;

interface OverlayPassState {
  /** The published table with CIG's own translation; null = none to respect. */
  cig?: string | null;
  /** The publication of the tables the rows walk reads (`tableMark`). */
  mark?: string;
  /** TM revision when the join began. */
  rev?: number;
  rejoins?: number;
  count?: number;
  attribution?: string;
}

export const overlayStep: PassStep = async (d, pass) => {
  const st = pass.state as OverlayPassState & { build_id?: string };
  const lang = pass.lang;
  const prefix = passPrefix(pass);

  if (pass.phase === 'start') {
    const buildId = st.build_id ?? (d.sources ? await d.sources.liveBuild() : await d.learn?.currentBuildId());
    if (!buildId) throw new TranslateError('translate.no_live_build');
    const language = await d.db.getLanguage(lang);
    if (!language) throw new TranslateError('translate.lang_unknown');
    // What the asker knew (an import knows its source) or, without it, what the sources of the language say.
    const cig = st.cig === undefined ? await cigTableFor(d, lang) : st.cig;
    const readers = await openRowReaders(d.store, buildId, null);
    if (!readers.en.index || !readers.en.index.count) throw new TranslateError('translate.english_missing');
    return commit(d, pass, { phase: 'rows', pos: 0, total: readers.en.names().length, build_id: buildId, state: { cig } });
  }

  if (pass.phase === 'rows') {
    const readers = await openRowReaders(d.store, pass.build_id!, st.cig ?? null);
    if (!readers.en.index) throw new TranslateError('translate.english_missing');
    // A table was published again while the pass ran: start over with the new one.
    const mark = tableMark(readers);
    if (readers.en.names().length !== pass.total || (pass.pos > 0 && st.mark !== mark)) return commit(d, pass, { phase: 'start', pos: 0, total: 0 });
    await writeRows(d.store, prefix, pass.pos, rowsOf(await loadKeySlice(readers, pass.pos)).byDigit);
    const next = pass.pos + SCAN_SHARDS;
    const state = mergeState(pass, { mark });
    return commit(d, pass, next >= pass.total ? { phase: 'join', pos: 0, state } : { pos: next, state });
  }

  if (pass.phase === 'join') {
    const rows = await loadRows(d.store, prefix, pass.pos, pass.total);
    if (!rows) return commit(d, pass, { phase: 'rows', pos: 0 });
    const { tm, rev } = await loadTmDigit(d.store, lang, pass.pos);
    // No `forceTerms` here: a string whose term waits for retranslation keeps the wording it has until
    // the job that rewrites it publishes.
    await d.store.putJson(overlayPartKey(prefix, pass.pos), overlayPartOf(await overlayEntries(rows, tm), tm));
    const state = pass.pos === 0 ? mergeState(pass, { rev }) : pass.state;
    return commit(d, pass, pass.pos + 1 < DIGITS ? { pos: pass.pos + 1, state } : { phase: 'assemble', pos: 0, state });
  }

  if (pass.phase === 'assemble') {
    // Someone wrote the TM while the digits were joined (a job published, another import): the parts
    // are from two states of the TM. Join again rather than put an overlay on top that lacks those writes.
    const rejoins = st.rejoins ?? 0;
    if (rejoins < MAX_REJOINS && (await tmRevision(d.store, lang)) !== (st.rev ?? 0)) {
      return commit(d, pass, { phase: 'join', pos: 0, state: mergeState(pass, { rejoins: rejoins + 1 }) });
    }
    const parts = await loadOverlayParts(d.store, prefix);
    if (!parts) return commit(d, pass, { phase: 'join', pos: 0 });
    const rows = d.sources ? await d.sources.list(lang) : null;
    const overlay = assembleOverlay(lang, pass.build_id!, parts, d.now().toISOString(), rows);
    // A newer LIVE build arrived while the pass ran: its own publish writes `latest.json`, this one must not
    // put the older build back on top of it.
    const live = d.sources ? await d.sources.liveBuild().catch(() => null) : null;
    await writeOverlayText(d.store, lang, pass.build_id!, overlay, !live || live === pass.build_id);
    return commit(d, pass, { phase: 'cleanup', pos: 0, state: mergeState(pass, { count: overlay.count, attribution: overlay.attribution }) });
  }

  if (pass.phase === 'cleanup') {
    const done = await sweepPrefix(d.store, prefix, CLEAN_KEYS);
    return commit(d, pass, done ? { status: 'done', phase: 'done', pos: 0 } : { pos: pass.pos + 1 });
  }
  throw new TranslateError('translate.pass_phase_unknown');
};
