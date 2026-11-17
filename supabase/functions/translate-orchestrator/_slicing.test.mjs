// node --test supabase/functions/translate-orchestrator/_slicing.test.mjs
// A job in slices: the estimate must find what one pass over the whole table finds, a job of many
// batch groups must end with every text translated once, and a job whose worker keeps getting killed
// must end `failed`, not be retried identically forever.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advance, isHeavy, tick, tickAll } from './_machine.ts';
import { buildShards } from '../ingest-catalog/_locale-shards.ts';
import { familyOf } from './_chunk.ts';
import { diffStrings, sha256Hex } from './_diff.ts';
import { MAX_DEAD_ATTEMPTS, RUN_STALE_MS, runVerdict, WORKER_LIMIT_KEY } from './_attempts.ts';
import { loadTm, overlayKey } from './_io.ts';
import { GROUP_PARTS, PART_CHUNKS } from './_job.ts';
import { poolSampling, POOL_PAIRS, SEG_ITEMS, segmentsOf } from './_job_estimate.ts';
import { judgeCount } from './_job_run.ts';
import { SCAN_SHARDS } from './_scan.ts';
import { askedOf, fakeDb, fakeDeps, fakeLlm, NEW, OLD, putTable, putTm, textStore } from './_testkit.mjs';

const STAMP = '2020-01-01T00:00:00.000Z';
const ONE = { sliceBudgetMs: 0 };

/** A table big enough for many shards (each key ~ 90 bytes, shards ~ 96 KB). */
function bigTables(n) {
  const en = {};
  const cig = {};
  const base = {};
  for (let i = 0; i < n; i++) {
    const group = ['ui', 'item', 'pu'][i % 3];
    const k = `${group}_k${String(i).padStart(5, '0')}`;
    en[k] = `Text number ${i % 700} of the ${group} family with some padding to fill the shards up`;
    base[k] = i % 11 === 0 ? 'changed in the new build' : en[k];
    if (i % 5 === 0) cig[k] = `Translated ${i % 700}`;
  }
  en.ui_label_a = 'Open';
  cig.ui_label_a = 'Oeffnen';
  base.ui_label_a = 'Open';
  en.ui_blank = '  ';
  return { en, cig, base };
}

function world({ tables, tm = {}, mode = 'delta', llm = fakeLlm(), settings, glossary, extra } = {}) {
  const ts = textStore();
  const { en, cig, base } = tables ?? bigTables(20000);
  putTable(ts, NEW, 'en', en);
  if (base) putTable(ts, OLD, 'en', base);
  if (cig && Object.keys(cig).length) putTable(ts, NEW, 'de', cig);
  if (Object.keys(tm).length) putTm(ts, 'de', tm);
  const db = fakeDb({ settings, glossary });
  const deps = fakeDeps({ ts, db, llm, extra });
  const newJob = () => db.insertJob({ build_id: NEW, lang: 'de', mode, base_build_id: mode === 'delta' ? OLD : null });
  return { ts, db, deps, llm, jobs: db.jobs, newJob, en, cig, base };
}

async function until(w, done, opts = ONE, max = 3000) {
  for (let i = 0; i < max; i++) {
    if (done()) return i;
    await tickAll(w.deps, opts);
  }
  throw new Error(`never got there: ${[...w.jobs.values()].map((j) => `${j.status}/${j.stats?.phase}/${j.stats?.est?.phase}:${j.stats?.est?.cursor} ${j.error ?? ''}`)}`);
}

async function planOf(w, job) {
  const chunks = [];
  for (let p = 0; p < job.stats.plan.parts; p++) {
    const part = w.ts.json(`translation-work/${job.id}/plan-${p}.json`);
    assert.ok(part.chunks.length <= PART_CHUNKS);
    for (const c of part.chunks) chunks.push({ ...c, shots: part.fewShot[c.id] ?? [] });
  }
  return chunks;
}

describe('the sliced estimate equals one pass over the whole table', () => {
  it('counts, the texts to translate with their smallest key, the string count', async () => {
    const { en, cig, base } = bigTables(6000);
    const hAdmin = await sha256Hex(en.ui_k00000); // a key CIG translates: the admin entry wins there
    const hAi = await sha256Hex(en.ui_k00003);
    const tm = { [hAdmin]: { t: 'Admin', o: 'admin' }, [hAi]: { t: 'KI', o: 'ai' } };
    const w = world({ tables: { en, cig, base }, tm });
    const job = await w.newJob();
    const slices = await until(w, () => w.jobs.get(job.id).status !== 'estimating');
    assert.ok(slices > 20, `expected many slices, got ${slices}`);
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'queued', done.error);

    const whole = await diffStrings({ en, cig, tm, mode: 'delta', baseEn: base });
    assert.deepEqual(done.stats.counts, whole.counts);
    assert.ok(whole.counts.blank === 1 && whole.counts.cig > 0 && whole.counts.tm > 0 && whole.counts.unchanged > 0 && whole.counts.todo > 0);
    assert.equal(done.string_count, whole.todo.reduce((a, u) => a + u.keys.length, 0));
    const chunks = await planOf(w, done);
    const items = chunks.flatMap((c) => c.items);
    assert.deepEqual(items.map((it) => [it.h, it.key]).sort(), whole.todo.map((u) => [u.h, u.keys[0]]).sort());
    assert.equal(done.stats.plan.chunks, chunks.length);
    assert.deepEqual(chunks.map((c) => c.id), chunks.map((_, i) => `c${i}`), 'request ids run through the parts');
    // Reference pairs: CIG's own lines of the same key head, and what the TM holds.
    assert.ok(chunks.every((c) => c.shots.length > 0));
    assert.ok(chunks.flatMap((c) => c.shots).every((p) => p.o === 'cig' || p.o === 'ai' || p.o === 'admin'));
    assert.ok(done.estimate_usd > 0);
    // Only the plan is left of the estimate.
    assert.deepEqual([...w.ts.files.keys()].filter((k) => k.startsWith('translation-work/') && !/\/plan(-\d+)?\.json$/.test(k)), []);
  });

  it('a small job is chunked in one go, in key order (what the unsliced plan did)', async () => {
    const en = { ui_b_2: 'Two', ui_b_1: 'One', pu_lore_1: 'A long story', item_x: 'Thing', ui_old: 'Old' };
    const w = world({ tables: { en, cig: {}, base: { ui_old: 'Old' } } });
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).status !== 'estimating');
    const chunks = await planOf(w, w.jobs.get(job.id));
    assert.deepEqual(chunks.map((c) => [c.model, c.items.map((it) => it.key)]), [
      ['claude-opus-5-5', ['pu_lore_1']],
      ['claude-sonnet-5-5', ['item_x', 'ui_b_1', 'ui_b_2']],
    ]);
  });

  it('the same English under keys of two groups is one text, asked once', async () => {
    const en = { ui_close: 'Close', item_close: 'Close', pu_close: 'Close', ui_other: 'Other' };
    const w = world({ tables: { en, cig: {}, base: null }, mode: 'full' });
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).status !== 'estimating');
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'awaiting_approval');
    assert.deepEqual([done.stats.counts.todo, done.string_count], [2, 4]);
    const items = (await planOf(w, done)).flatMap((c) => c.items);
    // The smallest key stands for the text; a lore key among them routes it to the lore model.
    assert.deepEqual(items.map((it) => it.key).sort(), ['item_close', 'ui_other']);
    assert.equal((await planOf(w, done)).find((c) => c.items.some((it) => it.key === 'item_close')).model, 'claude-opus-5-5');
  });
});

describe('segments', () => {
  const index = buildShards(NEW, 'en', 'gen001', bigTables(20000).en).index;

  it('a family (the key up to its last `_`) stays in one segment; large groups are split, small ones share', () => {
    const idx = { groups: { pu: 28, item: 27, human: 4, ui: 4, dlg: 3, aa: 1, zz: 1 }, misc: 14 };
    const segs = segmentsOf(idx);
    // pu 4 + item 4 + (aa, dlg, human = 8 shards) + (ui, zz) + misc 2
    assert.equal(segs.count, 12);
    const of = (k) => segs.of(k);
    assert.equal(of('pu_mission_x_title'), of('pu_mission_x_desc'));
    assert.equal(of('odd_one'), of('odd_two'), 'keys without a group of their own: by family');
    const pu = new Set(Array.from({ length: 400 }, (_, i) => of(`pu_mission_${i}_title`)));
    assert.equal(pu.size, 4);
    assert.equal(of('aa_1'), of('human_9'));
    assert.notEqual(of('ui_1'), of('human_9'));
    for (const k of ['pu_a_b', 'item_a', 'human_x', 'ui_y', 'zz_1', 'nogroup']) assert.ok(of(k) >= 0 && of(k) < segs.count);
  });

  it('every key of a real index lands in a segment, and the segments are of a size a slice can take', () => {
    const { en } = bigTables(20000);
    const segs = segmentsOf(index);
    const n = new Array(segs.count).fill(0);
    const fam = new Map();
    for (const k of Object.keys(en)) {
      const s = segs.of(k);
      n[s]++;
      const f = familyOf(k);
      assert.equal(fam.get(f) ?? s, s);
      fam.set(f, s);
    }
    // Only the segment of the keys without a group may be empty (this table has none).
    assert.deepEqual(n.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0), [segs.count - 1], `empty segment: ${n}`);
    assert.ok(Math.max(...n) < 3 * SCAN_SHARDS * 1200, `a segment holds ${Math.max(...n)} keys`);
  });

  it('reference pools: a head larger than the pool keeps every n-th pair, small heads keep all', () => {
    const s = poolSampling({ groups: { pu: 28, item: 27, ui: 4 }, misc: 14, count: 91861 });
    const perShard = 91861 / 73;
    assert.equal(s.ofHead('pu'), Math.ceil((28 * perShard) / POOL_PAIRS));
    assert.equal(s.ofHead('ui'), Math.ceil((4 * perShard) / POOL_PAIRS));
    assert.equal(s.ofHead('nogroup'), 1);
    assert.equal(s.all, Math.ceil(91861 / POOL_PAIRS));
    assert.deepEqual([poolSampling({ groups: { ui: 1 }, misc: 1, count: 40 }).all, poolSampling({ groups: { ui: 1 }, misc: 1, count: 40 }).ofHead('ui')], [1, 1]);
  });
});

describe('a job of many batch groups', () => {
  const N = 9000;
  /** N texts in two key groups: several segments, plan parts and batch groups. */
  function manyTexts() {
    const en = {};
    for (let i = 0; i < N; i++) {
      const g = i % 2 ? 'pu' : 'item';
      en[`${g}_fam${String(i % 300).padStart(3, '0')}_${String(i).padStart(5, '0')}`] = `String ${i} with ~mission(Target|Name) inside and enough words to be a sentence of its own`;
    }
    return { en, cig: {}, base: null };
  }

  it('every text is translated once, read once and published; QA, judge sample and spend add up over the groups', async () => {
    // One text in ten fails its first attempt; the judge fails the texts it sees whose number ends in 7.
    const bad = (text) => /String \d*5 /.test(text);
    const judge = (s) => (/String \d*7 /.test(s.en) ? 3 : 9);
    const w = world({ tables: manyTexts(), mode: 'full', llm: fakeLlm({ bad, judge }) });
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).status === 'awaiting_approval');
    const planned = w.jobs.get(job.id);
    const chunks = await planOf(w, planned);
    const groups = Math.ceil(planned.stats.plan.parts / GROUP_PARTS);
    assert.ok(planned.stats.plan.parts > 2 * GROUP_PARTS && groups >= 3, `parts ${planned.stats.plan.parts}`);
    assert.ok(Object.keys(planned.stats.counts).length && planned.stats.counts.todo === N);
    // Families are not torn apart by the segments: a family is in consecutive requests of one model.
    const where = new Map();
    chunks.forEach((c, i) => c.items.forEach((it) => where.set(familyOf(it.key), [...(where.get(familyOf(it.key)) ?? []), i])));
    for (const [, at] of where) assert.ok(at[at.length - 1] - at[0] <= 1, 'a family spans at most two neighbouring requests');
    assert.ok(planned.stats.est === undefined);

    await w.db.cas(w.jobs.get(job.id), { status: 'queued', approved_by: 'admin' });
    await until(w, () => ['published', 'failed'].includes(w.jobs.get(job.id).status));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);

    const main = w.llm.batches.filter((b) => b.requests[0].custom_id.startsWith('c'));
    const post = w.llm.batches.filter((b) => b.requests[0].custom_id.startsWith('p'));
    const judged = w.llm.batches.filter((b) => b.requests[0].custom_id === 'j0');
    assert.equal(main.length, groups);
    assert.ok(main.every((b) => b.requests.length <= GROUP_PARTS * PART_CHUNKS));
    assert.equal(judged.length, 1);
    const asked = main.flatMap((b) => b.requests.flatMap(askedOf));
    assert.equal(asked.length, N);
    assert.equal(new Set(asked.map((a) => a.key)).size, N, 'no text is asked twice');

    // The judge saw the smallest hashes that passed, 5 % of them at most 150.
    const firstOk = N - N / 10;
    const sample = JSON.parse(judged[0].requests[0].params.messages[0].content);
    assert.equal(sample.length, judgeCount(firstOk));
    const failedByJudge = sample.filter((s) => judge(s) < 6).length;
    assert.ok(failedByJudge > 0);
    assert.deepEqual(done.stats.judge, { n: sample.length, mean: Math.round((sample.reduce((a, s) => a + judge(s), 0) / sample.length) * 1e6) / 1e6 });

    // Post-edit: what failed QA and what the judge failed, each asked once more, in the batch of its group.
    const redo = post.flatMap((b) => b.requests.flatMap(askedOf));
    assert.equal(redo.length, N / 10 + failedByJudge);
    assert.deepEqual(done.stats.pe.length, post.length);
    assert.deepEqual(done.stats.qa, { ok: N, failed: 0, reasons: {}, dropped: 0 });

    // Spend: one ledger row per batch, nothing twice.
    assert.deepEqual(w.db.ledger.map((r) => r.ref).sort(), [
      'judge', ...main.map((_, g) => `main:${g}`), ...done.stats.pe.map((g) => `postedit:${g}`),
    ].sort());
    assert.ok(Math.abs(done.spent_usd - w.db.ledger.reduce((a, r) => a + r.usd, 0)) < 1e-6);

    // Every text is in the TM as the AI's, and its key in the overlay.
    const tm = await loadTm(w.deps.store, 'de');
    assert.equal(Object.keys(tm).length, N);
    assert.ok(Object.values(tm).every((e) => e.o === 'ai' && e.t.startsWith('DE: ') && e.at === Object.values(tm)[0].at));
    const overlay = w.ts.json(overlayKey('de', NEW));
    assert.equal(overlay.count, N);
    assert.deepEqual(Object.keys(overlay.entries).sort(), Object.keys(manyTexts().en).sort());
    assert.match(overlay.entries.item_fam000_00000.t, /~mission\(Target\|Name\)/);
    assert.deepEqual(w.ts.json(overlayKey('de', 'latest')), overlay);

    await until(w, () => !w.jobs.get(job.id).stats.sweep);
    assert.deepEqual([...w.ts.files.keys()].filter((k) => k.startsWith('translation-work/')), []);
  });

  it('nothing to translate but a TM that fills the gap: the job publishes the overlay of the build', async () => {
    const en = { ui_a: 'Open', ui_b: 'Close', ui_c: 'Third' };
    const tm = { [await sha256Hex('Open')]: { t: 'Öffnen', o: 'community', src: 'pack' }, [await sha256Hex('Close')]: { t: 'Schließen', o: 'community', src: 'pack' } };
    const w = world({ tables: { en, cig: {}, base: { ...en } }, tm });
    const job = await w.newJob();
    await until(w, () => !isHeavy(w.jobs.get(job.id)));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    assert.equal(w.llm.batches.length, 0);
    assert.deepEqual(Object.keys(w.ts.json(overlayKey('de', NEW)).entries).sort(), ['ui_a', 'ui_b']);
  });

  it('a string whose glossary term waits for retranslation is asked again, and only the new wording is published', async () => {
    const en = { ui_a: 'Open the Hull', ui_b: 'Close', ui_c: 'Hull breach' };
    const tm = {};
    for (const e of Object.values(en)) tm[await sha256Hex(e)] = { t: `ALT ${e}`, o: 'ai', at: '2026-01-01T00:00:00.000Z' };
    const glossary = [{ id: 'g1', source_term: 'Hull', target_term: 'Rumpf', category: 'term', origin: 'admin', needs_retranslate: true }];
    // The model uses the term in ui_a and misses it in ui_c on both attempts: the old wording of ui_c
    // must not come back.
    const w = world({ tables: { en, cig: {}, base: { ...en } }, tm, glossary });
    w.llm.results = (function (orig) {
      return async function* (id) {
        for await (const r of orig(id)) yield r.custom_id === 'j0' ? r : { ...r, text: r.text.replace('Open the Hull', 'Open the Rumpf') };
      };
    })(w.llm.results.bind(w.llm));
    const job = await w.newJob();
    await until(w, () => ['published', 'failed'].includes(w.jobs.get(job.id).status));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    assert.equal(done.stats.counts.forced, 2);
    const overlay = w.ts.json(overlayKey('de', NEW));
    assert.deepEqual(Object.fromEntries(Object.entries(overlay.entries).map(([k, v]) => [k, v.t])), { ui_a: 'DE: Open the Rumpf', ui_b: 'ALT Close' });
    assert.equal(done.stats.qa.dropped, 1);
  });
});

describe('runVerdict', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  it('no stamp: go with the stored dead count', () => {
    assert.deepEqual(runVerdict(undefined, now), { kind: 'go', dead: 0 });
    assert.deepEqual(runVerdict({ dead: 1 }, now), { kind: 'go', dead: 1 });
  });
  it('a young stamp means another tick is running', () => {
    assert.deepEqual(runVerdict({ run_at: new Date(now - 60_000).toISOString() }, now), { kind: 'busy' });
  });
  it('an old stamp is a dead run; the MAX_DEAD_ATTEMPTS-th in a row fails', () => {
    const old = new Date(now - RUN_STALE_MS - 1).toISOString();
    assert.deepEqual(runVerdict({ run_at: old }, now), { kind: 'go', dead: 1 });
    assert.deepEqual(runVerdict({ run_at: old, dead: MAX_DEAD_ATTEMPTS - 2 }, now), { kind: 'go', dead: MAX_DEAD_ATTEMPTS - 1 });
    assert.deepEqual(runVerdict({ run_at: old, dead: MAX_DEAD_ATTEMPTS - 1 }, now), { kind: 'fail', dead: MAX_DEAD_ATTEMPTS });
  });
  it('an unparsable stamp counts as dead', () => {
    assert.deepEqual(runVerdict({ run_at: 'nope' }, now), { kind: 'go', dead: 1 });
  });
});

describe('slices and ticks', () => {
  it('one slice per tick when the budget is spent; progress persists and the job ends queued', async () => {
    const w = world();
    const job = await w.newJob();
    const cursors = [];
    let ticks = 0;
    while (w.jobs.get(job.id).status === 'estimating') {
      await tickAll(w.deps, ONE);
      ticks++;
      const st = w.jobs.get(job.id).stats;
      cursors.push(`${st.est?.phase}:${st.est?.cursor}`);
      assert.equal(st.run_at, undefined, 'the stamp is cleared when a run ends cleanly');
      assert.ok(ticks < 200, `did not converge: ${cursors}`);
    }
    assert.ok(ticks > 20, `expected many ticks, got ${ticks}: ${cursors}`);
    assert.equal(cursors[0], `rows:${SCAN_SHARDS}`);
    assert.ok(cursors.includes('diff:15') && cursors.includes('chunk:0') && cursors.includes('shots:0') && cursors.includes('complete:0'), String(cursors));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'queued');
    assert.ok(done.estimate_usd > 0 && done.string_count > 0);
    assert.equal(done.stats.est, undefined);
  });

  it('with time left one tick runs every slice of the estimate (same result)', async () => {
    const a = world();
    const b = world();
    const ja = await a.newJob();
    const jb = await b.newJob();
    await tick(a.deps);
    await until(b, () => b.jobs.get(jb.id).status !== 'estimating');
    const [x, y] = [a.jobs.get(ja.id), b.jobs.get(jb.id)];
    assert.deepEqual([x.status, x.string_count, x.estimate_usd, x.stats.counts, x.stats.plan], [y.status, y.string_count, y.estimate_usd, y.stats.counts, y.stats.plan]);
    assert.deepEqual(await planOf(a, x), await planOf(b, y));
  });

  it('only one heavy job is advanced per tick', async () => {
    const w = world();
    const a = await w.newJob();
    const b = await w.db.insertJob({ build_id: NEW, lang: 'it', mode: 'delta', base_build_id: OLD });
    const out = await tick(w.deps);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, a.id);
    assert.equal(w.jobs.get(b.id).stats.est, undefined);
  });

  it('SEG_ITEMS texts are the least a chunk slice takes: small segments are chunked together', async () => {
    const w = world();
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).stats?.est?.phase === 'chunk');
    const seg = w.jobs.get(job.id).stats.est.seg;
    const total = Object.values(seg).reduce((a, n) => a + n, 0);
    assert.ok(Object.keys(seg).length > 1 && total > 0);
    const slices = await until(w, () => w.jobs.get(job.id).stats?.est?.phase !== 'chunk');
    assert.ok(slices <= Math.ceil(total / (SEG_ITEMS / 2)) + 1, `${slices} chunk slices for ${total} texts in ${Object.keys(seg).length} segments`);
  });
});

describe('dead runs', () => {
  const stamp = (w, id, dead) => {
    const j = w.jobs.get(id);
    w.jobs.set(id, { ...j, stats: { ...j.stats, run_at: STAMP, ...(dead ? { dead } : {}) } });
  };

  it('a stamp from a killed run is counted, the job still works, and progress restarts the count', async () => {
    const w = world();
    const job = await w.newJob();
    stamp(w, job.id, 1);
    await tickAll(w.deps, ONE);
    const st = w.jobs.get(job.id).stats;
    assert.equal(st.run_at, undefined);
    assert.equal(st.dead, undefined, 'a slice committed, so the dead count restarted');
    assert.equal(st.est.cursor, SCAN_SHARDS);
  });

  it('MAX_DEAD_ATTEMPTS dead runs in a row fail the job with a translated key, no work done', async () => {
    const w = world();
    const job = await w.newJob();
    stamp(w, job.id, MAX_DEAD_ATTEMPTS - 1);
    w.ts.reset();
    await tickAll(w.deps, ONE);
    const j = w.jobs.get(job.id);
    assert.equal(j.status, 'failed');
    assert.equal(j.error, WORKER_LIMIT_KEY);
    assert.equal(j.stats.sweep, true, 'its work files are deleted by the ticks that follow');
    assert.equal(w.ts.meter.gets, 0, 'no heavy read after giving up');
  });

  it('runs that die without committing progress end in failed after MAX_DEAD_ATTEMPTS ticks', async () => {
    const w = world();
    const job = await w.newJob();
    // The platform kill: the slice never commits and the clean-up after it never runs.
    const realCas = w.deps.db.cas;
    let ticks = 0;
    while (w.jobs.get(job.id).status === 'estimating' && ticks < 10) {
      ticks++;
      w.deps.db.cas = async (j, p) => {
        // After the stamp is written, behave like a dead process: no further write succeeds.
        if (!p.stats?.run_at && !p.status) return null;
        return realCas(j, p);
      };
      await tickAll(w.deps, ONE);
      // Make sure the stamp stays like after a kill.
      const cur = w.jobs.get(job.id);
      if (cur.status === 'estimating') w.jobs.set(job.id, { ...cur, stats: { ...cur.stats, run_at: STAMP } });
      w.deps.db.cas = realCas;
    }
    const j = w.jobs.get(job.id);
    assert.equal(j.status, 'failed');
    assert.equal(j.error, WORKER_LIMIT_KEY);
    assert.equal(ticks, MAX_DEAD_ATTEMPTS + 1, 'first run stamps, the next MAX_DEAD_ATTEMPTS see the dead stamp');
  });

  it('a young stamp (another tick is running) is left alone', async () => {
    const w = world();
    const job = await w.newJob();
    const j = w.jobs.get(job.id);
    w.jobs.set(job.id, { ...j, stats: { run_at: new Date(w.deps.now().getTime()).toISOString() } });
    const before = structuredClone(w.jobs.get(job.id));
    const to = await advance(w.deps, structuredClone(before));
    assert.equal(to, 'estimating');
    assert.deepEqual(w.jobs.get(job.id), before);
    assert.deepEqual(await tick(w.deps), [], 'and it does not hold the slot');
  });

  it('every phase that runs slices carries the marker: a kill while a batch is read is counted too', async () => {
    const w = world({ tables: { en: { ui_a: 'One', ui_b: 'Two', ui_old: 'Old' }, cig: {}, base: { ui_old: 'Old' } } });
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).stats?.phase === 'running');
    // The main batch has ended; the request that reads it is killed three times.
    const results = w.llm.results;
    let reads = 0;
    w.llm.results = async function* () { reads++; throw new Error('stand-in for a killed worker'); };
    const realCas = w.deps.db.cas;
    for (let i = 0; i < MAX_DEAD_ATTEMPTS + 2 && w.jobs.get(job.id).status !== 'failed'; i++) {
      w.deps.db.cas = async (j, p) => (p.stats?.run_at || p.status ? realCas(j, p) : null);
      await tickAll(w.deps, ONE);
      w.deps.db.cas = realCas;
      const cur = w.jobs.get(job.id);
      if (cur.status === 'validating') w.jobs.set(job.id, { ...cur, stats: { ...cur.stats, run_at: STAMP } });
    }
    w.llm.results = results;
    assert.deepEqual([w.jobs.get(job.id).status, w.jobs.get(job.id).error], ['failed', WORKER_LIMIT_KEY]);
    assert.ok(reads >= 1 && reads <= MAX_DEAD_ATTEMPTS);
  });
});

describe('a table published again while a walk is under way', () => {
  it('the estimate starts its walk over and counts the new table, although the shard count is the same', async () => {
    const { en, cig, base } = bigTables(20000);
    const w = world({ tables: { en, cig, base } });
    const job = await w.newJob();
    await until(w, () => (w.jobs.get(job.id).stats.est?.cursor ?? 0) >= SCAN_SHARDS);
    assert.equal(w.jobs.get(job.id).stats.est.phase, 'rows');
    // Same keys, same sizes, so the same shards; one text of a shard the walk has passed reads differently.
    const first = Object.keys(en).filter((k) => k.startsWith('item_')).sort()[0];
    const en2 = { ...en, [first]: en[first].replace('Text number', 'Line number') };
    const before = w.ts.json(`codex-locale/${NEW}/en/index.json`);
    const after = putTable(w.ts, NEW, 'en', en2, 'gen002');
    assert.deepEqual([after.groups, after.misc], [before.groups, before.misc]);

    await until(w, () => w.jobs.get(job.id).status !== 'estimating');
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'queued', done.error);
    const whole = await diffStrings({ en: en2, cig, tm: {}, mode: 'delta', baseEn: base });
    assert.deepEqual(done.stats.counts, whole.counts);
    const items = (await planOf(w, done)).flatMap((c) => c.items);
    assert.deepEqual(items.map((it) => it.h).sort(), whole.todo.map((u) => u.h).sort());
    assert.ok(items.some((it) => it.key === first), 'the text that changed in the new publication is translated');
  });

  it('a publish joins the overlay from one publication of the table', async () => {
    const en = { ui_a: 'Open the main door of the hangar', ui_b: 'Close the main door of the hangar', ui_old: 'Old' };
    const w = world({ tables: { en, cig: {}, base: { ui_old: 'Old' } } });
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).status === 'publishing' && w.jobs.get(job.id).stats.phase === 'join');
    const mark = w.jobs.get(job.id).stats.pub.mark;
    assert.match(mark, /^gen001:\d+\|/);
    // The table is published again without ui_b while the rows walk is under way (its first slice
    // is done): the walk begins again, and the overlay holds no key the table no longer has.
    putTable(w.ts, NEW, 'en', { ui_a: en.ui_a, ui_old: en.ui_old }, 'gen002');
    const cur = w.jobs.get(job.id);
    w.jobs.set(job.id, { ...cur, stats: { ...cur.stats, phase: 'rows', pos: SCAN_SHARDS } });
    await tickAll(w.deps, ONE);
    assert.match(w.jobs.get(job.id).stats.pub.mark, /^gen002:/);
    await until(w, () => ['published', 'failed'].includes(w.jobs.get(job.id).status));
    assert.equal(w.jobs.get(job.id).status, 'published', w.jobs.get(job.id).error);
    assert.deepEqual(Object.keys(w.ts.json(overlayKey('de', NEW)).entries).sort(), ['ui_a']);
  });
});

describe('the plan is cut from the table the rows were walked with', () => {
  it('a table published again between the diff and the chunking loses no text', async () => {
    const { en, cig, base } = bigTables(20000);
    const w = world({ tables: { en, cig, base } });
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).stats.est?.phase === 'chunk');
    const whole = await diffStrings({ en, cig, tm: {}, mode: 'delta', baseEn: base });
    // The new publication has one small group: its segments are numbered differently.
    putTable(w.ts, NEW, 'en', { ui_a: 'Only this one is left' }, 'gen002');
    await until(w, () => w.jobs.get(job.id).status !== 'estimating');
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'queued', done.error);
    const items = (await planOf(w, done)).flatMap((c) => c.items);
    assert.equal(items.length, whole.todo.length);
    assert.deepEqual(items.map((it) => it.h).sort(), whole.todo.map((u) => u.h).sort());
    assert.equal(done.string_count, whole.todo.reduce((a, u) => a + u.keys.length, 0));
  });

  it('a term flagged while the digits are walked waits for the next job: no digit is forced alone', async () => {
    const en = {};
    for (let i = 0; i < 400; i++) en[`ui_k${String(i).padStart(3, '0')}`] = `Open the Hull number ${i} of the ship`;
    const tm = {};
    for (const e of Object.values(en)) tm[await sha256Hex(e)] = { t: `ALT ${e}`, o: 'ai', at: '2026-01-01T00:00:00.000Z' };
    const glossary = [{ id: 'g1', source_term: 'Hull', target_term: 'Rumpf', category: 'term', origin: 'admin', needs_retranslate: false }];
    const w = world({ tables: { en, cig: {}, base: { ...en } }, tm, glossary });
    const job = await w.newJob();
    await until(w, () => w.jobs.get(job.id).stats.est?.phase === 'diff' && w.jobs.get(job.id).stats.est.cursor === 8);
    w.db.glossary[0].needs_retranslate = true;
    await until(w, () => !isHeavy(w.jobs.get(job.id)));
    const done = w.jobs.get(job.id);
    assert.deepEqual([done.stats.counts.forced, done.stats.counts.todo, done.stats.counts.tm], [0, 0, 400], JSON.stringify(done.stats.counts));
    // Nothing was translated, so every text keeps its place in the overlay with the wording it has.
    assert.equal(done.status, 'published', done.error);
    assert.equal(Object.keys(w.ts.json(overlayKey('de', NEW)).entries).length, 400);
    assert.equal(w.db.glossary[0].needs_retranslate, true);
  });
});

describe('the fast lane', () => {
  it('starts a queued job and creates its batch, but asks no batch that is under way', async () => {
    const w = world({ tables: { en: { ui_a: 'One', ui_b: 'Two', ui_old: 'Old' }, cig: {}, base: { ui_old: 'Old' } } });
    const job = await w.newJob();
    const FAST = { fast: true, sliceBudgetMs: 0 };
    await until(w, () => w.jobs.get(job.id).status === 'queued', FAST);
    assert.equal(w.llm.batches.length, 0);
    await until(w, () => w.jobs.get(job.id).stats.phase === 'running', FAST, 3);
    assert.deepEqual([w.jobs.get(job.id).status, w.llm.batches.length], ['submitted', 1]);
    let asked = 0;
    w.llm.isEnded = async () => { asked++; return true; };
    for (let i = 0; i < 3; i++) await tickAll(w.deps, FAST);
    assert.deepEqual([w.jobs.get(job.id).status, asked], ['submitted', 0]);
    await tickAll(w.deps, ONE);
    assert.ok(asked > 0 && w.jobs.get(job.id).status !== 'submitted');
  });
});
