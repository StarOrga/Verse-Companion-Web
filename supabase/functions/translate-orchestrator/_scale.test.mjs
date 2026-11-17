// node --test supabase/functions/translate-orchestrator/_scale.test.mjs
// The size of production: ~92 000 keys in ~150 shards, CIG's own table for a quarter of them, a
// community pack for nearly all of them. A request of the edge function is retired after ~1 s of CPU
// and has 256 MB, so what matters is what ONE slice moves - not how long the whole walk takes. Every
// walk (community import, overlay, learning, a delta job, the whole gap of a language as one job)
// runs here slice by slice against a store that keeps JSON text like the bucket does, and every
// slice must stay inside a budget of bytes read and written.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { tickAll } from './_machine.ts';
import { loadTm, overlayKey, tmIndexKey } from './_io.ts';
import { memPasses } from './_pass.ts';
import { PASS_STEPS } from './_pass_db.ts';
import { startImport } from './_sources.ts';
import { fakeDb, fakeDeps, fakeLearn, fakeLlm, fakeSources, NEW, OLD, putTable, textStore } from './_testkit.mjs';

const MB = 1024 * 1024;
/** What one slice may read and write (JSON text). Parsing runs at ~100 MB/s on the platform's CPUs. */
const READ_MAX = 6 * MB;
const WRITE_MAX = 6 * MB;
/**
 * The two slices that hold a whole community pack (~12 MB of text): the download and its split by
 * key group. They do nothing else, and a pack does not grow with the translation memory.
 */
const PACK_SLICES = new Set(['seed/fetch', 'seed/split']);
const PACK_MAX = 40 * MB;
/**
 * The slice that joins the sixteen pieces of an overlay into its file and writes it under the build
 * and as `latest`: ~14 MB of text that is concatenated, never parsed into objects or serialized.
 */
const TEXT_SLICES = new Set(['overlay/assemble', 'publishing/assemble']);
const TEXT_MAX = 48 * MB;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const FILL = 'lorem ipsum dolor sit amet consetetur sadipscing elitr sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat sed diam';

/** Keys and texts shaped like the live table: two huge key groups, a few middle ones, many small ones. */
function productionTables() {
  const en = {};
  const cig = {};
  let i = 0;
  const add = (key) => {
    i++;
    // One text in twenty repeats under other keys (`Close`, `Yes`, unit names).
    const n = i % 20 === 0 ? i % 2000 : i;
    en[key] = `Text ${n}: ${FILL.slice(0, 50 + (n % 90))}${n % 10 === 3 ? ' ~mission(Target|Name)' : ''}`;
    if (i % 4 === 0) cig[key] = `CIG ${en[key]}`;
  };
  const fam = (group, count, per = 6) => { for (let j = 0; j < count; j++) add(`${group}_topic${Math.floor(j / per)}_part${j % per}`); };
  fam('pu', 20000);
  fam('item', 19000);
  fam('human', 2800);
  fam('ui', 2800);
  fam('dlg', 2100);
  fam('mg', 2100);
  for (let g = 0; g < 55; g++) fam(`grp${g}`, 620);
  for (let j = 0; j < 9000; j++) add(`x${j}_name`); // heads too small for a group of their own
  return { en, cig };
}

/** A pack that translates nearly everything, CIG's keys included, with lower-cased keys. */
function packOf(en) {
  const lines = ['﻿Frontend_PU_Version=Pack 1'];
  let i = 0;
  for (const [k, v] of Object.entries(en)) if (++i % 20 !== 7) lines.push(`${k.toLowerCase()}=DE ${v}`);
  return lines.join('\r\n');
}

let cached;
function fixture() {
  if (cached) return cached;
  const { en, cig } = productionTables();
  const base = textStore();
  const enIndex = putTable(base, NEW, 'en', en);
  putTable(base, NEW, 'de', cig);
  return (cached = { en, cig, files: base.files, enIndex, pack: packOf(en) });
}

function world({ glossary = [] } = {}) {
  const f = fixture();
  const ts = textStore();
  for (const [k, v] of f.files) ts.files.set(k, v);
  const db = fakeDb({ glossary });
  const llm = fakeLlm({ bad: (text) => /Text \d*77:/.test(text) });
  const deps = fakeDeps({ ts, db, llm });
  deps.learn = fakeLearn();
  deps.sources = fakeSources({ sources: [{ id: 'pack1' }], pack: f.pack });
  deps.passes = memPasses(deps.now);
  deps.passSteps = PASS_STEPS;
  deps.alerts = async () => {};
  return { ...f, ts, db, llm, deps, jobs: db.jobs, passes: deps.passes };
}

/** What the next tick will work on: `<kind>/<phase>` of the heavy job or, without one, of the oldest pass. */
async function tagOf(w) {
  const job = [...w.jobs.values()].find((j) => ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'].includes(j.status));
  if (job) return job.status === 'estimating' ? `estimate/${job.stats?.est?.phase ?? 'start'}` : `${job.status}/${job.stats?.phase ?? '-'}`;
  const sweep = [...w.jobs.values()].find((j) => j.stats?.sweep);
  if (sweep) return 'job/sweep';
  const pass = (await w.passes.listOpen())[0];
  return pass ? `${pass.kind}/${pass.phase}` : 'idle';
}

/** Runs one slice per tick until `done`, and keeps the largest slice of every phase. */
async function run(w, done, opts, max = 4000) {
  const worst = new Map();
  let slices = 0;
  for (; slices < max; slices++) {
    if (await done()) break;
    const tag = await tagOf(w);
    w.ts.reset();
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    await tickAll(w.deps, opts);
    const ms = performance.now() - t0;
    const c = process.cpuUsage(c0);
    const cpu = (c.user + c.system) / 1000;
    const m = w.ts.meter;
    const cur = worst.get(tag) ?? { n: 0, read: 0, written: 0, biggest: 0, ms: 0, cpu: 0, gets: 0, puts: 0 };
    worst.set(tag, {
      n: cur.n + 1, read: Math.max(cur.read, m.read), written: Math.max(cur.written, m.written),
      biggest: Math.max(cur.biggest, m.biggest), ms: Math.max(cur.ms, ms), cpu: Math.max(cur.cpu, cpu), gets: Math.max(cur.gets, m.gets), puts: Math.max(cur.puts, m.puts),
    });
  }
  assert.ok(slices < max, `did not end: ${await tagOf(w)} ${JSON.stringify([...w.jobs.values()].map((j) => [j.status, j.stats?.phase, j.error]))} ${JSON.stringify([...w.passes.rows.values()].map((p) => [p.kind, p.status, p.phase, p.pos, p.error]))}`);
  return { slices, worst };
}

const mb = (n) => (n / MB).toFixed(2);

function report(t, name, { slices, worst }) {
  const lines = [...worst].map(([tag, x]) => `${tag.padEnd(26)} ${String(x.n).padStart(4)} slices  read ${mb(x.read).padStart(6)} MB  written ${mb(x.written).padStart(6)} MB  largest object ${mb(x.biggest).padStart(6)} MB  ${String(x.gets).padStart(4)} gets ${String(x.puts).padStart(4)} puts  ${x.ms.toFixed(0).padStart(5)} ms  cpu ${x.cpu.toFixed(0).padStart(5)} ms`);
  t.diagnostic(`${name}: ${slices} slices\n${lines.join('\n')}`);
}

function assertBudget({ worst }) {
  for (const [tag, x] of worst) {
    const [r, wr] = PACK_SLICES.has(tag) ? [PACK_MAX, PACK_MAX] : TEXT_SLICES.has(tag) ? [TEXT_MAX, TEXT_MAX] : [READ_MAX, WRITE_MAX];
    assert.ok(x.read <= r, `${tag} read ${mb(x.read)} MB in one slice (budget ${mb(r)})`);
    assert.ok(x.written <= wr, `${tag} wrote ${mb(x.written)} MB in one slice (budget ${mb(wr)})`);
  }
}

const PASS_TICK = { fast: true, sliceBudgetMs: 0 };
const JOB_TICK = { sliceBudgetMs: 0 };

describe('production size', () => {
  it('the fixture has the shape of the live table', () => {
    const { enIndex, en, cig } = fixture();
    const shards = Object.values(enIndex.groups).reduce((a, n) => a + n, 0) + enIndex.misc;
    assert.ok(enIndex.count > 90000 && shards > 120, `${enIndex.count} keys in ${shards} shards`);
    assert.ok(enIndex.groups.pu >= 20 && enIndex.groups.item >= 20 && enIndex.misc >= 8);
    assert.ok(Object.keys(cig).length > 20000 && Object.keys(en).length === enIndex.count);
  });

  // One world for the import and what follows it: the delta job then runs against the full TM.
  const w = world();

  it('a community import, the overlay and the learning pass that follow it', async (t) => {
    await startImport(w.deps, 'pack1');
    const res = await run(w, async () => !(await w.passes.listOpen()).length, PASS_TICK);
    report(t, 'import -> overlay -> learning', res);
    const kinds = [...w.passes.rows.values()].map((p) => [p.kind, p.status, p.error ?? null]);
    assert.deepEqual(kinds.sort(), [['learn', 'done', null], ['overlay', 'done', null], ['seed', 'done', null]]);
    assertBudget(res);

    // The TM holds one entry per English text the pack translates and CIG does not.
    const { en, cig } = w;
    const want = new Set();
    let n = 0;
    for (const [k, e] of Object.entries(en)) if (++n % 20 !== 7 && !cig[k]) want.add(sha(e));
    // A text that CIG translates under one key and leaves open under another is in the TM as well.
    const index = w.ts.json(tmIndexKey('de'));
    assert.equal(index.count, want.size);
    assert.ok(index.count > 60000, `${index.count} entries`);
    const overlay = w.ts.json(overlayKey('de', 'latest'));
    assert.ok(overlay.count >= index.count && overlay.count < Object.keys(en).length - Object.keys(cig).length + 1, `${overlay.count} overlay entries`);
    assert.ok(Object.keys(overlay.entries).every((k) => !cig[k]), "a key CIG translates is not in the overlay");
    // Only the state of the learning batches stays (it is not a work file of a pass).
    assert.deepEqual([...w.ts.files.keys()].filter((k) => k.startsWith('translation-work/')), ['translation-work/learn-de/state.json']);
  });

  it('a delta job on top of the full TM: ~1 100 texts new to the build, the overlay of the new build', async (t) => {
    // The build before, seen from texts neither CIG nor the pack translate: one in eight read
    // differently, one in eight did not exist yet. The rest of them is back catalogue.
    const base = { ...w.en };
    let n = 0;
    let fresh = 0;
    for (const k of Object.keys(base)) {
      n++;
      if (n % 160 === 7) base[k] = `${base[k]} (old)`;
      else if (n % 160 === 87) delete base[k];
      else continue;
      fresh++;
    }
    putTable(w.ts, OLD, 'en', base);
    const job = await w.db.insertJob({ build_id: NEW, lang: 'de', mode: 'delta', base_build_id: OLD });
    const res = await run(w, async () => ['published', 'failed', 'skipped', 'awaiting_approval'].includes(w.jobs.get(job.id).status) && !w.jobs.get(job.id).stats.sweep, JOB_TICK);
    report(t, 'delta job', res);
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    assertBudget(res);
    assert.ok(fresh > 1000);
    assert.deepEqual([done.stats.counts.todo, done.stats.counts.unchanged], [fresh, Math.ceil((n - 7) / 20) - fresh], JSON.stringify(done.stats.counts));
    const overlay = w.ts.json(overlayKey('de', NEW));
    assert.ok(overlay.count > 60000);
    const tm = await loadTm(w.deps.store, 'de');
    assert.equal(Object.values(tm).filter((e) => e.o === 'ai').length, done.stats.counts.todo);
  });

  it('the whole gap of a language as one job: estimate, batches, quality gates, publish', async (t) => {
    const w2 = world();
    const job = await w2.db.insertJob({ build_id: NEW, lang: 'de', mode: 'full', base_build_id: null });
    const est = await run(w2, async () => w2.jobs.get(job.id).status !== 'estimating', JOB_TICK);
    report(t, 'full job: estimate', est);
    const planned = w2.jobs.get(job.id);
    assert.equal(planned.status, 'awaiting_approval', planned.error);
    assertBudget(est);
    assert.ok(planned.stats.counts.todo > 60000 && planned.stats.plan.parts > 20, JSON.stringify([planned.stats.counts, planned.stats.plan]));

    await w2.db.cas(w2.jobs.get(job.id), { status: 'queued', approved_by: 'admin' });
    const res = await run(w2, async () => ['published', 'failed'].includes(w2.jobs.get(job.id).status) && !w2.jobs.get(job.id).stats.sweep, JOB_TICK, 8000);
    report(t, 'full job: run', res);
    const done = w2.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    assertBudget(res);
    assert.equal(done.stats.qa.ok + done.stats.qa.dropped, planned.stats.counts.todo);
    assert.equal(w2.ts.json(tmIndexKey('de')).count, done.stats.qa.ok);
    assert.ok(w2.ts.json(overlayKey('de', NEW)).count >= done.stats.qa.ok);
    assert.deepEqual([...w2.ts.files.keys()].filter((k) => k.startsWith(`translation-work/${job.id}/`)), []);
  });
});
