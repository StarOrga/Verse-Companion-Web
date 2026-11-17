// node --test supabase/functions/translate-orchestrator/_slicing.test.mjs
// Sliced estimating + dead-run bookkeeping: a tick must finish inside the edge limits, and a job
// whose worker keeps getting killed must end `failed`, not be retried identically forever.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advance, tick } from './_machine.ts';
import { buildShards, indexKey, shardKey } from '../ingest-catalog/_locale-shards.ts';
import { diffStrings, isCigValid, sha256Hex } from './_diff.ts';
import { MAX_DEAD_ATTEMPTS, RUN_STALE_MS, runVerdict, WORKER_LIMIT_KEY } from './_attempts.ts';
import { mergeParts, openReaders, scanSlice } from './_scan.ts';
import { tmIndexKey, tmShardKey } from './_io.ts';

const NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAMP = '2020-01-01T00:00:00.000Z';

function putTable(files, build, lang, entries) {
  const { index, shards } = buildShards(build, lang, 'gen001', entries);
  files.set(indexKey(build, lang), index);
  for (const [name, s] of shards) files.set(shardKey(build, lang, 'gen001', name), s);
  return index;
}
const memStore = (files) => ({
  async getJson(k) { return files.has(k) ? structuredClone(files.get(k)) : null; },
  async putJson(k, v) { files.set(k, structuredClone(v)); },
  async deleteKey(k) { files.delete(k); },
});

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
  return { en, cig, base };
}

describe('scan slices equal the one-pass diff', () => {
  it('merged parts == diffStrings over the whole tables (todo, reused, counts, pairs)', async () => {
    const files = new Map();
    const { en, cig, base } = bigTables(6000);
    putTable(files, NEW, 'en', en);
    putTable(files, OLD, 'en', base);
    putTable(files, NEW, 'de', cig);
    putTable(files, OLD, 'de', cig);
    const hAdmin = await sha256Hex(en.ui_k00001);
    const hAi = await sha256Hex(en.ui_k00003);
    const tm = { [hAdmin]: { t: 'Admin', o: 'admin' }, [hAi]: { t: 'KI', o: 'ai' } };
    const byShard = {};
    for (const [h, e] of Object.entries(tm)) (byShard[h.slice(0, 2)] ??= {})[h] = e;
    files.set(tmIndexKey('de'), { shards: Object.keys(byShard) });
    for (const [hh, s] of Object.entries(byShard)) files.set(tmShardKey('de', hh), s);

    const store = memStore(files);
    const ctx = { store, buildId: NEW, lang: 'de', mode: 'delta', baseBuildId: OLD, cigFolder: 'de', forceTerms: [], adminGlossary: [] };
    const readers = await openReaders(ctx);
    const total = readers.en.names().length;
    assert.ok(total > 4, `want many shards, got ${total}`);
    const parts = [];
    for (let c = 0; c < total; c += 2) parts.push(await scanSlice(ctx, readers, c, 2));
    const merged = mergeParts(parts.reverse()); // the order of the parts must not matter

    const whole = await diffStrings({ en, cig, tm, mode: 'delta', baseEn: base });
    assert.deepEqual(merged.counts, whole.counts);
    assert.deepEqual(merged.reused, whole.reused);
    assert.deepEqual(merged.todo.map((u) => [u.h, u.keys]), whole.todo.map((u) => [u.h, u.keys]));
    const wantPairs = Object.keys(en).filter((k) => isCigValid(en[k], cig[k])).sort();
    assert.deepEqual(merged.pairs.filter((p) => p.o === 'cig').map((p) => p.key), wantPairs);
    assert.ok(merged.pairs.some((p) => p.o === 'ai'));
    assert.equal(merged.labelEn.ui_label_a, 'Open');
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

function machineWorld({ perfStep = 0, tables } = {}) {
  const files = new Map();
  const { en, cig, base } = tables ?? bigTables(20000);
  putTable(files, NEW, 'en', en);
  putTable(files, OLD, 'en', base);
  putTable(files, NEW, 'de', cig);
  const jobs = new Map();
  let seq = 0;
  let clock = Date.parse('2026-11-17T12:00:00Z');
  let perf = 0;
  const OPEN = ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'];
  const db = {
    async listOpenJobs() { return [...jobs.values()].filter((j) => OPEN.includes(j.status)).map((j) => structuredClone(j)); },
    async getJob(id) { const j = jobs.get(id); return j ? structuredClone(j) : null; },
    async cas(job, patch) {
      const cur = jobs.get(job.id);
      if (!cur || cur.status !== job.status || cur.updated_at !== job.updated_at) return null;
      const next = { ...cur, ...patch, updated_at: `t${++seq}` };
      jobs.set(job.id, next);
      return structuredClone(next);
    },
    async insertJob(j) {
      const row = { id: `job${jobs.size + 1}`, spent_usd: 0, batch_ids: [], stats: {}, string_count: null, estimate_usd: null, error: null, created_at: 'c', updated_at: `t${++seq}`, approved_by: null, status: 'estimating', ...j };
      jobs.set(row.id, row);
      return structuredClone(row);
    },
    async getSettings() { return { enabled: true, upload_cap_usd: 20, monthly_cap_usd: 190, lore_model: null, rest_model: null }; },
    async getLanguage(lang) { return { lang, cig_folder: lang, approved: true }; },
    async listGlossary() { return []; },
    async insertGlossary() {},
    async resetRetranslate() {},
    async buildEstimateSum() { return 0; },
    async monthCommitted() { return 0; },
    async addLedger() {},
    async hasNewerPublished() { return false; },
  };
  const deps = { db, store: memStore(files), llm: null, now: () => new Date(clock += 1000), perfNow: () => (perf += perfStep), log() {} };
  return { deps, db, jobs, files };
}

const newJob = (w) => w.db.insertJob({ build_id: NEW, lang: 'de', mode: 'delta', base_build_id: OLD });

describe('sliced estimating in the machine', () => {
  it('one slice per tick when the budget is spent; progress persists and the job ends queued', async () => {
    const w = machineWorld({ perfStep: 5_000 });
    const job = await newJob(w);
    const cursors = [];
    let ticks = 0;
    while (w.jobs.get(job.id).status === 'estimating') {
      await tick(w.deps);
      ticks++;
      const st = w.jobs.get(job.id).stats;
      cursors.push(`${st.est?.phase}:${st.est?.cursor}`);
      assert.equal(st.run_at, undefined, 'the stamp is cleared when a run ends cleanly');
      assert.ok(ticks < 40, `did not converge: ${cursors}`);
    }
    assert.ok(ticks > 3, `expected several ticks, got ${ticks}: ${cursors}`);
    assert.ok(cursors[0].startsWith('scan:16'), cursors[0]);
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'queued');
    assert.ok(done.estimate_usd > 0 && done.string_count > 0);
    assert.equal(done.stats.est, undefined);
    assert.ok(w.files.has(`translation-work/${job.id}/plan.json`));
    const left = [...w.files.keys()].filter((k) => /translation-work/.test(k) && !/plan.json$/.test(k)); assert.deepEqual(left, [], 'work parts are cleaned up');
  });

  it('with a roomy budget one tick runs every slice (small tables, same result)', async () => {
    const small = { en: { ui_a: 'Open', ui_b: 'Shut' }, base: { ui_a: 'Open', ui_b: 'Shut it' }, cig: {} };
    const w = machineWorld({ tables: small });
    const job = await newJob(w);
    await tick(w.deps);
    assert.equal(w.jobs.get(job.id).status, 'queued');
    assert.equal(w.jobs.get(job.id).string_count, 1);
  });

  it('only one heavy job is advanced per tick', async () => {
    const w = machineWorld({ perfStep: 5_000 });
    const a = await newJob(w);
    const b = await newJob(w);
    const out = await tick(w.deps);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, a.id);
    assert.equal(w.jobs.get(b.id).stats.est, undefined);
  });
});

describe('dead runs', () => {
  const stamp = (w, id, dead) => {
    const j = w.jobs.get(id);
    w.jobs.set(id, { ...j, stats: { ...j.stats, run_at: STAMP, ...(dead ? { dead } : {}) } });
  };

  it('a stamp from a killed run is counted, the job still works, and progress restarts the count', async () => {
    const w = machineWorld({ perfStep: 5_000 });
    const job = await newJob(w);
    stamp(w, job.id, 1);
    await tick(w.deps);
    const st = w.jobs.get(job.id).stats;
    assert.equal(st.run_at, undefined);
    assert.equal(st.dead, undefined, 'a slice committed, so the dead count restarted');
    assert.equal(st.est.cursor, 16);
  });

  it('MAX_DEAD_ATTEMPTS dead runs in a row fail the job with a translated key, no work done', async () => {
    const w = machineWorld({ perfStep: 5_000 });
    const job = await newJob(w);
    stamp(w, job.id, MAX_DEAD_ATTEMPTS - 1);
    const reads = [];
    const get = w.deps.store.getJson;
    w.deps.store.getJson = async (k) => { reads.push(k); return get(k); };
    await tick(w.deps);
    const j = w.jobs.get(job.id);
    assert.equal(j.status, 'failed');
    assert.equal(j.error, WORKER_LIMIT_KEY);
    assert.equal(reads.length, 0, 'no heavy read after giving up');
  });

  it('runs that die without committing progress end in failed after MAX_DEAD_ATTEMPTS ticks', async () => {
    const w = machineWorld({ perfStep: 5_000 });
    const job = await newJob(w);
    // The platform kill: the slice never commits and the clean-up after it never runs.
    const realCas = w.deps.db.cas;
    let killNext = false;
    w.deps.store.getJson = async (k) => {
      if (k.includes('/en/') && k.endsWith('.json') && killNext) throw new Error('stand-in for a killed worker');
      return memStore(w.files).getJson(k);
    };
    let ticks = 0;
    while (w.jobs.get(job.id).status === 'estimating' && ticks < 10) {
      ticks++;
      killNext = true;
      w.deps.db.cas = async (j, p) => {
        // After the stamp is written, behave like a dead process: no further write succeeds.
        if (!p.stats?.run_at && !p.status) return null;
        return realCas(j, p);
      };
      await tick(w.deps);
      // advance() ran its clean-up path with a dead db; make sure the stamp stays like after a kill.
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
    const w = machineWorld({ perfStep: 5_000 });
    const job = await newJob(w);
    const j = w.jobs.get(job.id);
    w.jobs.set(job.id, { ...j, stats: { run_at: new Date(w.deps.now().getTime()).toISOString() } });
    const before = structuredClone(w.jobs.get(job.id));
    const to = await advance(w.deps, structuredClone(before));
    assert.equal(to, 'estimating');
    assert.deepEqual(w.jobs.get(job.id), before);
  });
});
