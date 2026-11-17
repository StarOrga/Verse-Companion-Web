// Publishing a job in slices: its translations go into the TM, then the overlay of the build is
// built from the TM (everything CIG leaves untranslated that the TM can fill - what this job wrote,
// what earlier jobs wrote, what a community pack brought).
//
//   route     one batch group per slice: its accepted results by hash digit -> `p/tmu-<digit>-<g>`,
//             and the proper nouns the model kept (`p/ait-<g>`)
//   tm        one hash digit per slice: the results of that digit into its 16 TM shards
//   rows      SCAN_SHARDS English shards per slice: the rows of the table by hash digit (_rows.ts)
//   join      one hash digit per slice: the overlay entries of that digit (_overlay.ts)
//   assemble  the sixteen parts become the overlay file; glossary rows; `published`
//
// The results are written per batch group (the order of the requests); the TM is addressed by hash.
// `route` is the turn from one to the other, so that `tm` opens 16 shards per slice, not all 256.
//
// The one-request publish this replaces loaded the plan, every result and the whole TM, and wrote the
// overlay from memory. That holds for a delta of a few hundred strings against an empty TM, and for
// nothing larger.

import { unmask } from './_mask.ts';
import type { TmEntry } from './_diff.ts';
import { TranslateError } from './_errors.ts';
import { aiTermCounts, aiTermsFromCounts, mergeAiTermCounts, newRows } from './_glossary.ts';
import type { AiTermCounts } from './_glossary.ts';
import { inPool, saveTm } from './_io.ts';
import { groupsOf, jobKey, jobPrefix, partsOfGroup, slice } from './_job.ts';
import type { Deps, Job } from './_job.ts';
import { readPlan, readPlanPart } from './_job_estimate.ts';
import { resKey } from './_job_run.ts';
import type { ResMap } from './_job_run.ts';
import { requestLearning } from './_learn_pass.ts';
import { assembleOverlay, loadOverlayParts, overlayEntries, overlayPartKey, overlayPartOf, writeOverlayText } from './_overlay.ts';
import { DIGITS, HEX, loadKeySlice, loadRows, loadTmDigit, openRowReaders, rowsOf, tmRevision, writeRows } from './_rows.ts';
import { SCAN_SHARDS } from './_scan.ts';
import { cigTableFor } from './_sources.ts';

/** The TM changed under a join this often: the overlay is written as it is. */
const MAX_REJOINS = 3;
const READ_CONCURRENCY = 12;

/** `[hash, text, model]` of an accepted result. */
type TmUpdate = [h: string, t: string, m: string];

const workPrefix = (jobId: string) => `${jobPrefix(jobId)}p/`;
const tmuKey = (jobId: string, digit: number, g: number) => jobKey(jobId, `p/tmu-${HEX[digit]}-${g}`);
const aitKey = (jobId: string, g: number) => jobKey(jobId, `p/ait-${g}`);

export async function stepPublishing(deps: Deps, job: Job): Promise<void> {
  const { db, store } = deps;
  const phase = job.stats?.phase ?? 'route';
  const pos = job.stats?.pos ?? 0;
  const groups = groupsOf(job.stats?.plan?.parts ?? 0);
  // Fixed with the first slice: every TM entry of this job carries it, and the overlay asks for it.
  const pub = job.stats?.pub ?? { at: deps.now().toISOString() };
  const prefix = workPrefix(job.id);

  if (phase === 'route') {
    if (pos >= groups) {
      await slice(deps, job, { pub, phase: groups ? 'tm' : 'rows', pos: 0 });
      return;
    }
    const res = (await store.getJson(resKey(job.id, pos))) as ResMap | null;
    if (!res) throw new TranslateError('translate.results_missing');
    const byDigit: TmUpdate[][] = Array.from({ length: DIGITS }, () => []);
    for (const h of Object.keys(res).sort()) {
      const r = res[h];
      if (r.ok) byDigit[parseInt(h[0], 16)].push([h, r.t, r.m]);
    }
    await inPool(byDigit.map((list, d) => ({ list, d })), READ_CONCURRENCY, async ({ list, d }) => {
      await store.putJson(tmuKey(job.id, d, pos), list);
    });
    // Proper nouns the model kept verbatim become do-not-translate rows (counted per group, decided at the end).
    const pairs: { en: string; t: string }[] = [];
    for (const p of partsOfGroup(pos, job.stats?.plan?.parts ?? 0)) {
      const part = await readPlanPart(deps, job, p);
      for (const c of part.chunks) for (const it of c.items) if (res[it.h]?.ok) pairs.push({ en: unmask(it.m, it.toks), t: res[it.h].t });
    }
    await store.putJson(aitKey(job.id, pos), aiTermCounts(pairs));
    await slice(deps, job, { pub, ...(pos + 1 < groups ? { pos: pos + 1 } : { phase: 'tm', pos: 0 }) });
    return;
  }

  if (phase === 'tm') {
    const updates: Record<string, TmEntry> = {};
    for (let g = 0; g < groups; g++) {
      const list = (await store.getJson(tmuKey(job.id, pos, g))) as TmUpdate[] | null;
      if (!list) throw new TranslateError('translate.results_missing');
      for (const [h, t, m] of list) updates[h] = { t, o: 'ai', m, at: pub.at };
    }
    if (Object.keys(updates).length) await saveTm(store, job.lang, updates);
    await slice(deps, job, pos + 1 < DIGITS ? { pos: pos + 1 } : { phase: 'rows', pos: 0 });
    return;
  }

  if (phase === 'rows') {
    const readers = await openRowReaders(store, job.build_id, await cigTableFor(deps, job.lang));
    if (!readers.en.index || !readers.en.index.count) throw new TranslateError('translate.english_missing');
    const total = readers.en.names().length;
    // The table was published again since the walk began: its shards are other shards now.
    const cursor = pub.total === total ? pos : 0;
    await writeRows(store, prefix, cursor, rowsOf(await loadKeySlice(readers, cursor)).byDigit);
    const next = cursor + SCAN_SHARDS;
    await slice(deps, job, { pub: { ...pub, total }, ...(next >= total ? { phase: 'join', pos: 0 } : { pos: next }) });
    return;
  }

  if (phase === 'join') {
    const rows = await loadRows(store, prefix, pos, pub.total ?? 0);
    if (!rows) {
      await slice(deps, job, { phase: 'rows', pos: 0, pub: { ...pub, total: undefined } });
      return;
    }
    const head = await readPlan(deps, job);
    const { tm, rev } = await loadTmDigit(store, job.lang, pos);
    const entries = await overlayEntries(rows, tm, { forceTerms: head.forceTerms, since: pub.at });
    await store.putJson(overlayPartKey(prefix, pos), overlayPartOf(entries, tm));
    const next = pos === 0 ? { ...pub, rev } : pub;
    await slice(deps, job, { pub: next, ...(pos + 1 < DIGITS ? { pos: pos + 1 } : { phase: 'assemble', pos: 0 }) });
    return;
  }

  if (phase === 'assemble') {
    // An import or another job wrote the TM while the digits were joined: join again rather than
    // publish an overlay that lacks those writes.
    const rejoins = pub.rejoins ?? 0;
    if (rejoins < MAX_REJOINS && (await tmRevision(store, job.lang)) !== (pub.rev ?? 0)) {
      await slice(deps, job, { phase: 'join', pos: 0, pub: { ...pub, rejoins: rejoins + 1 } });
      return;
    }
    const parts = await loadOverlayParts(store, prefix);
    if (!parts) {
      await slice(deps, job, { phase: 'join', pos: 0 });
      return;
    }
    const head = await readPlan(deps, job);
    // A6: sources + uniform attribution + game folder.
    let sourceRows = null;
    if (deps.sources) {
      try {
        sourceRows = await deps.sources.list(job.lang);
      } catch (e) {
        deps.log('translate overlay meta failed', { lang: job.lang, error: String((e as Error)?.message ?? e) });
      }
    }
    const at = deps.now().toISOString();
    const overlay = assembleOverlay(job.lang, job.build_id, parts, at, sourceRows);
    await writeOverlayText(store, job.lang, job.build_id, overlay, !(await db.hasNewerPublished(job)));

    const counts: AiTermCounts[] = [];
    for (let g = 0; g < groups; g++) counts.push(((await store.getJson(aitKey(job.id, g))) ?? {}) as AiTermCounts);
    const ai = newRows(await db.listGlossary(job.lang), aiTermsFromCounts(mergeAiTermCounts(counts)));
    if (ai.length) await db.insertGlossary(job.lang, ai);
    if (head.forceIds.length) await db.resetRetranslate(head.forceIds);

    // C0: learning from what was just published is asked for, never run in this request. The token
    // makes a repeat of this slice find the pass it opened.
    await requestLearning(deps, job.lang, 'publish', `job:${job.id}`).catch((e) =>
      deps.log('translate learning request failed', { lang: job.lang, error: String((e as Error)?.message ?? e) })
    );
    await slice(deps, job, {
      phase: undefined, pos: undefined, pub: undefined, published_at: at, overlay_count: overlay.count, sweep: true,
    }, { status: 'published' });
    return;
  }
  throw new TranslateError('translate.phase_unknown');
}
