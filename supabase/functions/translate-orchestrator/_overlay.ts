// The delivery overlay of one language for one build, built in slices from the translation memory.
//
// An overlay holds every key CIG leaves untranslated that the TM can fill: ~85k entries, ~10 MB for a
// language with a community pack. Building it used to mean the whole English table, the whole CIG
// table and the whole TM in one request. Here a slice walks a few English shards, looks its keys up
// and writes the entries it found as a part; the last step only merges the parts and writes the file.
//
// Two callers: a job that publishes (_machine.ts) and the `overlay` pass that follows a source import.

import { diffStrings, sha256Hex } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import { makeOverlay, overlayMetaOf, overlayUsage, writeOverlay } from './_io.ts';
import type { Overlay, OverlayMeta, SourceMetaRow, Store } from './_io.ts';
import { commit, mergeState } from './_pass.ts';
import type { Pass, PassStep } from './_pass.ts';
import { SCAN_SHARDS } from './_scan.ts';
import { deleteKeys, loadSlice, openSliceReaders } from './_slice.ts';
import type { SliceReaders } from './_slice.ts';

export interface OverlayPart {
  entries: Record<string, { h: string; t: string }>;
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

/** The overlay entries of English shards `[pos, pos + count)`. */
export async function overlaySlice(
  store: Store, readers: SliceReaders, lang: string, pos: number, scan: OverlayScan = {}, count = SCAN_SHARDS,
): Promise<OverlayPart> {
  const sl = await loadSlice(store, readers, lang, pos, count);
  const hash = async (s: string) => sl.hashes.get(s) ?? await sha256Hex(s);
  const diff = await diffStrings({ en: sl.en, cig: sl.cig, tm: sl.tm, mode: 'full', forceTerms: scan.forceTerms, hash });
  const entries = diff.reused;
  if (scan.since) {
    for (const u of diff.todo) {
      const hit = sl.tm[u.h];
      if (hit && hit.o === 'ai' && (hit.at ?? '') >= scan.since) for (const k of u.keys) entries[k] = { h: u.h, t: hit.t };
    }
  }
  const { used, ai } = overlayUsage(entries, sl.tm);
  return { entries, srcs: [...used].sort(), ai };
}

export function mergeOverlayParts(parts: OverlayPart[]): { entries: OverlayPart['entries']; used: Set<string>; ai: boolean } {
  const entries: OverlayPart['entries'] = {};
  const used = new Set<string>();
  let ai = false;
  for (const p of parts) {
    Object.assign(entries, p.entries);
    for (const s of p.srcs) used.add(s);
    ai = ai || p.ai;
  }
  return { entries, used, ai };
}

/** Merges the parts into the overlay (sources, attribution, game folder from the source rows). */
export function assembleOverlay(
  lang: string, buildId: string, parts: OverlayPart[], at: string, sourceRows: SourceMetaRow[] | null,
): Overlay {
  const { entries, used, ai } = mergeOverlayParts(parts);
  const meta: OverlayMeta = sourceRows ? overlayMetaOf(lang, used, ai, sourceRows) : {};
  return makeOverlay(lang, buildId, entries, at, meta);
}

// ── the `overlay` pass: rebuild latest.json of a language from its TM ─────────────────────────────

const workKey = (pass: Pass, name: string) => `translation-work/ovl-${pass.id}/${name}.json`;

interface OverlayPassState {
  /** CIG folder to respect; null = the table in that folder is another language. */
  cig?: string | null;
  count?: number;
  attribution?: string;
}

export const overlayStep: PassStep = async (d, pass) => {
  const st = pass.state as OverlayPassState & { build_id?: string };
  const lang = pass.lang;

  if (pass.phase === 'start') {
    const buildId = st.build_id ?? (d.sources ? await d.sources.liveBuild() : await d.learn?.currentBuildId());
    if (!buildId) throw new TranslateError('translate.no_live_build');
    const language = await d.db.getLanguage(lang);
    if (!language) throw new TranslateError('translate.lang_unknown');
    const cig = st.cig === undefined ? (language.cig_folder || lang) : st.cig;
    const readers = await openSliceReaders(d.store, buildId, null);
    if (!readers.en.index || !readers.en.index.count) throw new TranslateError('translate.english_missing');
    return commit(d, pass, { phase: 'scan', pos: 0, total: readers.en.names().length, build_id: buildId, state: { cig } });
  }

  if (pass.phase === 'scan') {
    const readers = await openSliceReaders(d.store, pass.build_id!, st.cig ?? null);
    if (!readers.en.index) throw new TranslateError('translate.english_missing');
    // The table was published again while the pass ran: start over with the new layout.
    if (readers.en.names().length !== pass.total) return commit(d, pass, { phase: 'start', pos: 0, total: 0 });
    await d.store.putJson(workKey(pass, `part-${pass.pos}`), await overlaySlice(d.store, readers, lang, pass.pos));
    const next = pass.pos + SCAN_SHARDS;
    return commit(d, pass, next >= pass.total ? { phase: 'assemble', pos: 0 } : { pos: next });
  }

  if (pass.phase === 'assemble') {
    const parts: OverlayPart[] = [];
    const names: string[] = [];
    for (let pos = 0; pos < pass.total; pos += SCAN_SHARDS) {
      const part = (await d.store.getJson(workKey(pass, `part-${pos}`))) as OverlayPart | null;
      if (!part) return commit(d, pass, { phase: 'scan', pos: 0 });
      parts.push(part);
      names.push(workKey(pass, `part-${pos}`));
    }
    const rows = d.sources ? await d.sources.list(lang) : null;
    const overlay = assembleOverlay(lang, pass.build_id!, parts, d.now().toISOString(), rows);
    // A newer LIVE build arrived while the pass ran: its own publish writes `latest.json`, this one must not
    // put the older build back on top of it.
    const live = d.sources ? await d.sources.liveBuild().catch(() => null) : null;
    await writeOverlay(d.store, overlay, !live || live === pass.build_id);
    await deleteKeys(d.store, names);
    return commit(d, pass, {
      status: 'done', phase: 'done', pos: 0, state: mergeState(pass, { count: overlay.count, attribution: overlay.attribution }),
    });
  }
  throw new TranslateError('translate.pass_phase_unknown');
};
