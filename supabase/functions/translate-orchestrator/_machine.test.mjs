// node --test supabase/functions/translate-orchestrator/_machine.test.mjs
// State-machine transitions against in-memory fakes (no network, no real SDK).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advance, approve, cancel, isHeavy, startFull, tick, tickAll } from './_machine.ts';
import { buildShards, indexKey, shardKey } from '../ingest-catalog/_locale-shards.ts';
import { loadTm, overlayKey, roomOverlayKey, saveTm, tmIndexKey } from './_io.ts';
import { sha256Hex } from './_diff.ts';
import { memPasses } from './_pass.ts';

const NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function putTable(files, build, lang, entries) {
  const { index, shards } = buildShards(build, lang, 'gen001', entries);
  files.set(indexKey(build, lang), index);
  for (const [name, s] of shards) files.set(shardKey(build, lang, 'gen001', name), s);
}

function world({ settings = {}, hasBase = true, llmMode = 'good', noKey = false, en, baseEn } = {}) {
  const files = new Map();
  const newEn = en ?? { ui_a_1: 'Open the door', ui_a_2: 'Close the door', ui_old: 'Unchanged text', pu_m_1: 'Kill ~mission(Target) at <EM1>Port</EM1>' };
  putTable(files, NEW, 'en', newEn);
  putTable(files, OLD, 'en', baseEn ?? { ui_old: 'Unchanged text', ui_a_2: 'Close a door' });
  const jobs = new Map();
  const ledger = [];
  const glossary = [];
  let clock = 1_000_000;
  let seq = 0;
  const db = {
    jobs, ledger, glossary,
    async listOpenJobs() { return [...jobs.values()].filter((j) => ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'].includes(j.status)).map((j) => ({ ...j })); },
    async listSweepJobs() { return [...jobs.values()].filter((j) => j.stats?.sweep).map((j) => ({ ...j })); },
    async findJob(build_id, lang, mode) { const j = [...jobs.values()].find((x) => x.build_id === build_id && x.lang === lang && x.mode === mode); return j ? { ...j } : null; },
    async getJob(id) { const j = jobs.get(id); return j ? { ...j } : null; },
    async cas(job, patch) {
      const cur = jobs.get(job.id);
      if (!cur || cur.status !== job.status || cur.updated_at !== job.updated_at) return null;
      const next = { ...cur, ...patch, updated_at: `t${++seq}` };
      jobs.set(job.id, next);
      return { ...next };
    },
    async insertJob(j) {
      const row = { id: `job${jobs.size + 1}`, spent_usd: 0, batch_ids: [], stats: {}, string_count: null, estimate_usd: null, error: null, created_at: 'c', updated_at: `t${++seq}`, approved_by: null, status: 'estimating', ...j };
      jobs.set(row.id, row);
      return { ...row };
    },
    async getSettings() { return { enabled: true, upload_cap_usd: 20, monthly_cap_usd: 190, lore_model: null, rest_model: null, ...settings }; },
    // The folder name inside the game is not the name of the published table (that is the language code).
    async getLanguage(lang) { return { lang, cig_folder: 'german_(germany)', approved: true }; },
    async listGlossary() { return glossary.map((g) => ({ ...g })); },
    async insertGlossary(_l, rows) { glossary.push(...rows.map((r, i) => ({ ...r, id: `g${glossary.length + i}` }))); },
    async resetRetranslate() {},
    async buildEstimateSum() { return 0; },
    async monthCommitted() { return ledger.reduce((a, r) => a + r.usd, 0); },
    async addLedger(jobId, month, usd, ref) { if (ref && ledger.some((r) => r.jobId === jobId && r.ref === ref)) return; ledger.push({ jobId, month, usd, ref }); },
    async hasNewerPublished() { return false; },
  };
  const store = {
    async getJson(k) { return files.has(k) ? structuredClone(files.get(k)) : null; },
    async putJson(k, v) { files.set(k, structuredClone(v)); },
    async deleteKey(k) { files.delete(k); },
    async list(prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)); },
  };
  const batches = [];
  const llm = {
    batches,
    async createBatch(requests) { batches.push({ id: `b${batches.length}`, requests }); return { id: `b${batches.length - 1}` }; },
    async isEnded() { return true; },
    async cancel() {},
    async *results(id) {
      const b = batches.find((x) => x.id === id);
      for (const r of [...b.requests].reverse()) { // arbitrary order on purpose
        const msg = r.params.messages[0].content;
        if (r.custom_id === 'j0') {
          const n = JSON.parse(msg).length;
          yield { custom_id: 'j0', type: 'succeeded', text: JSON.stringify({ r: Array.from({ length: n }, () => ({ score: 9, back: 'x' })) }), stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 }, model: 'claude-opus-5-5' };
          continue;
        }
        const g = JSON.parse(msg.slice(msg.indexOf('{"g"'))).g;
        const flat = g.flatMap((x) => x.s);
        const isPost = r.custom_id.startsWith('p');
        const t = flat.map((s, i) => {
          const text = s[1];
          if (llmMode === 'badfirst' && !isPost && i === 0) return 'DE: dropped tokens';
          return `DE: ${text}`;
        });
        yield { custom_id: r.custom_id, type: 'succeeded', text: JSON.stringify({ t }), stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 }, model: r.params.model };
      }
    },
  };
  // A clock that does not move for the slice budget: a tick takes every slice of the unit it works on.
  const deps = { db, store, llm: noKey ? null : llm, now: () => new Date(clock += 1000), perfNow: () => 0, log() {} };
  return { deps, files, db, llm, jobs, ledger, newEn, NEW, OLD, hasBase };
}

/** One slice per tick, so that a test can stop between two of them. */
const ONE = { sliceBudgetMs: 0 };
async function until(w, done, opts = ONE, max = 400) {
  for (let i = 0; i < max; i++) {
    if (done()) return;
    await tickAll(w.deps, opts);
  }
  throw new Error(`never got there: ${[...w.jobs.values()].map((j) => `${j.status}/${j.stats?.phase}/${j.stats?.est?.phase}`)}`);
}

async function newJob(w, over = {}) {
  return w.db.insertJob({ build_id: NEW, lang: 'de', mode: 'delta', base_build_id: OLD, ...over });
}
async function run(w, until, max = 30) {
  for (let i = 0; i < max; i++) {
    await tick(w.deps);
    const st = [...w.jobs.values()].map((j) => j.status);
    if (st.every((s) => until.includes(s))) return;
  }
  throw new Error(`stuck: ${[...w.jobs.values()].map((j) => j.status)}`);
}
const TERMINAL = ['published', 'failed', 'skipped', 'cancelled', 'awaiting_approval'];

describe('delta lifecycle', () => {
  it('room labels (scc_room_*) are new keys of a delta and land in the rooms.json slice (E14)', async () => {
    const w = world({ en: { ui_a_1: 'Open the door', ui_old: 'Unchanged text', scc_room_habitation_corridor: 'Habitation Corridor' } });
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    const latest = w.files.get(overlayKey('de', 'latest'));
    assert.deepEqual(Object.keys(latest.entries).sort(), ['scc_room_habitation_corridor', 'ui_a_1']);
    const rooms = w.files.get(roomOverlayKey('de'));
    assert.deepEqual(Object.keys(rooms.entries), ['scc_room_habitation_corridor']);
    assert.equal(rooms.count, 1);
    assert.equal(rooms.entries.scc_room_habitation_corridor.h, await sha256Hex('Habitation Corridor'));
    assert.equal(rooms.build_id, latest.build_id);
  });

  it('estimating -> ... -> published; only new/changed keys are translated; ledger + TM + overlay written', async () => {
    const w = world();
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    // ui_old is unchanged back catalogue -> never sent.
    const sent = JSON.stringify(w.llm.batches.flatMap((b) => b.requests.map((r) => r.params.messages[0].content)));
    assert.ok(!sent.includes('Unchanged text'));
    assert.ok(sent.includes('Open the door') && sent.includes('Close the door'));
    const overlay = w.files.get(overlayKey('de', NEW));
    assert.deepEqual(Object.keys(overlay.entries).sort(), ['pu_m_1', 'ui_a_1', 'ui_a_2']);
    assert.equal(overlay.entries.ui_a_1.h, await sha256Hex('Open the door'));
    assert.match(overlay.entries.pu_m_1.t, /~mission\(Target\)/);
    assert.ok(w.files.has(overlayKey('de', 'latest')));
    assert.ok(w.files.has(tmIndexKey('de')));
    assert.ok(w.ledger.length >= 1 && w.ledger.every((r) => r.usd > 0));
    assert.ok(job.spent_usd > 0);
    assert.ok(job.estimate_usd > 0 && Number.isFinite(job.estimate_usd));
    assert.ok(job.stats.judge && job.stats.judge.mean === 9);
    assert.equal(job.stats.qa.ok, 3);
    assert.deepEqual(w.ledger.map((r) => r.ref).sort(), ['judge', 'main:0']);
    // The work files of an ended job are deleted by the ticks that follow.
    assert.equal(job.stats.sweep, true);
    await until(w, () => !w.jobs.get(job.id).stats.sweep);
    assert.deepEqual([...w.files.keys()].filter((k) => k.startsWith('translation-work/')), []);
  });

  it('CIG\'s own translation is read from the table under the language code and wins over the TM', async () => {
    const w = world();
    // Published by the uploader under `de`; the game folder (`cig_folder`) is another name.
    putTable(w.files, NEW, 'de', { ui_a_1: 'Tür öffnen', ui_a_2: 'Close the door' });
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    assert.equal(job.stats.counts.cig, 1);
    // What is asked to be translated is the `{"g": …}` part of a request; CIG's line may be a reference pair above it.
    const asked = w.llm.batches.flatMap((b) => b.requests).filter((r) => r.custom_id.startsWith('c'))
      .map((r) => r.params.messages[0].content).map((m) => m.slice(m.indexOf('{"g"'))).join(' ');
    assert.ok(asked.includes('Close the door') && !asked.includes('Open the door'), 'CIG translated it: it is not a string to translate');
    const overlay = w.files.get(overlayKey('de', NEW));
    // ui_a_2 is "translated" as its own English: not valid, so it is ours.
    assert.deepEqual(Object.keys(overlay.entries).sort(), ['pu_m_1', 'ui_a_2']);
  });

  it('routes lore to opus and the rest to sonnet with the contract request shape', async () => {
    const w = world();
    await newJob(w);
    await run(w, TERMINAL);
    const reqs = w.llm.batches.flatMap((b) => b.requests).filter((r) => r.custom_id !== 'j0');
    const models = new Set(reqs.map((r) => r.params.model));
    assert.deepEqual([...models].sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
    for (const r of reqs) {
      assert.ok(!('temperature' in r.params));
      assert.equal(r.params.system[0].cache_control.ttl, '1h');
    }
  });

  it('a failing item goes through one post-edit batch and still publishes', async () => {
    const w = world({ llmMode: 'badfirst' });
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    assert.ok(w.llm.batches.some((b) => b.requests.some((r) => r.custom_id.startsWith('p'))));
    assert.ok(w.ledger.length >= 2);
  });

  it('no base build -> skipped with an error key', async () => {
    const w = world();
    await newJob(w, { base_build_id: null });
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'skipped');
    assert.equal(job.error, 'translate.no_base_build');
    assert.equal(w.llm.batches.length, 0);
  });

  it('base build whose shards are missing -> skipped', async () => {
    const w = world();
    w.files.delete(indexKey(OLD, 'en'));
    await newJob(w);
    await run(w, TERMINAL);
    assert.equal([...w.jobs.values()][0].error, 'translate.base_build_missing');
  });

  it('missing API key fails the job with a stable key, never calls a model', async () => {
    const w = world({ noKey: true });
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'translate.no_api_key');
  });

  it('disabled settings keep estimating jobs untouched', async () => {
    const w = world({ settings: { enabled: false } });
    await newJob(w);
    await tick(w.deps);
    assert.equal([...w.jobs.values()][0].status, 'estimating');
  });
});

describe('caps and approval', () => {
  it('estimate above upload cap parks the job; approve queues it; it then publishes', async () => {
    const w = world({ settings: { upload_cap_usd: 0.000001 } });
    await newJob(w);
    await run(w, TERMINAL);
    let job = [...w.jobs.values()][0];
    assert.equal(job.status, 'awaiting_approval');
    assert.equal(job.stats.hold, 'upload_cap');
    assert.equal(w.llm.batches.length, 0);
    await approve(w.deps, job.id, 'admin-1');
    await run(w, ['published', 'failed']);
    job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    assert.equal(job.approved_by, 'admin-1');
  });

  it('month ledger over the monthly cap parks the job', async () => {
    const w = world({ settings: { monthly_cap_usd: 5 } });
    w.ledger.push({ jobId: 'x', month: '2026-10-01', usd: 5 });
    await newJob(w);
    await run(w, TERMINAL);
    assert.equal([...w.jobs.values()][0].stats.hold, 'monthly_cap');
  });

  it('approve refuses jobs that are not awaiting approval; cancel works', async () => {
    const w = world();
    const j = await newJob(w);
    await assert.rejects(approve(w.deps, j.id, null), { key: 'translate.not_awaiting_approval' });
    const c = await cancel(w.deps, j.id);
    assert.equal(c.status, 'cancelled');
  });

  it('full mode ALWAYS awaits approval, even far below every cap', async () => {
    const w = world({ settings: { upload_cap_usd: 1e9, monthly_cap_usd: 1e9 } });
    const started = await startFull(w.deps, NEW, 'de');
    // The op only starts the job: nothing of the table is read in that request.
    assert.deepEqual([started.mode, started.status], ['full', 'estimating']);
    await run(w, TERMINAL);
    const job = w.jobs.get(started.id);
    assert.equal(job.status, 'awaiting_approval');
    assert.equal(job.stats.hold, 'full');
    assert.ok(job.estimate_usd > 0 && job.string_count === 4);
    await tick(w.deps);
    assert.equal([...w.jobs.values()][0].status, 'awaiting_approval');
    assert.equal(w.llm.batches.length, 0);
    // Full includes the back catalogue (ui_old) in its gap.
    const part = w.files.get(`translation-work/${job.id}/plan-0.json`);
    assert.ok(JSON.stringify(part.chunks).includes('Unchanged text'));
    // Asked again while it waits: the same job, untouched.
    assert.equal((await startFull(w.deps, NEW, 'de')).status, 'awaiting_approval');
  });

  it('a full run is estimated while the pipeline is switched off, a delta is not', async () => {
    const w = world({ settings: { enabled: false } });
    const full = await startFull(w.deps, NEW, 'de');
    const delta = await newJob(w, { lang: 'it' });
    for (let i = 0; i < 5; i++) await tick(w.deps);
    assert.equal(w.jobs.get(full.id).status, 'awaiting_approval');
    assert.equal(w.jobs.get(delta.id).status, 'estimating');
    assert.equal(w.jobs.get(delta.id).stats.est, undefined);
  });

  it('a full run that has ended is started again; not while its work files are still being deleted', async () => {
    const w = world();
    const first = await startFull(w.deps, NEW, 'de');
    await run(w, TERMINAL);
    await cancel(w.deps, first.id);
    await assert.rejects(startFull(w.deps, NEW, 'de'), { key: 'translate.job_cleanup_pending' });
    await until(w, () => !w.jobs.get(first.id).stats.sweep);
    assert.deepEqual([...w.files.keys()].filter((k) => k.startsWith('translation-work/')), []);
    const again = await startFull(w.deps, NEW, 'de');
    assert.deepEqual([again.id, again.status, again.stats, again.estimate_usd], [first.id, 'estimating', { run: 1 }, null]);
    await run(w, TERMINAL);
    assert.equal(w.jobs.get(first.id).status, 'awaiting_approval');
  });

  it('a second run of a job books its own spend: its batches are not taken for repeats of the first', async () => {
    const w = world();
    const job = await startFull(w.deps, NEW, 'de');
    await run(w, TERMINAL);
    await approve(w.deps, job.id, 'admin');
    await until(w, () => w.jobs.get(job.id).status === 'published' && !w.jobs.get(job.id).stats.sweep);
    const firstRefs = w.ledger.map((r) => r.ref).sort();
    const firstSpend = w.jobs.get(job.id).spent_usd;
    assert.deepEqual(firstRefs, ['judge', 'main:0']);
    assert.ok(firstSpend > 0);

    // A string the first run could not know: the second run has something to pay for.
    putTable(w.files, NEW, 'en', { ...w.newEn, ui_later: 'Added after the first run' });
    await startFull(w.deps, NEW, 'de');
    await run(w, TERMINAL);
    await approve(w.deps, job.id, 'admin');
    await until(w, () => w.jobs.get(job.id).status === 'published' && !w.jobs.get(job.id).stats.sweep);
    const done = w.jobs.get(job.id);
    assert.deepEqual(w.ledger.map((r) => r.ref).sort(), ['judge', 'judge#1', 'main:0', 'main:0#1']);
    // The job row counts the run (its reserve is the estimate minus this), the ledger keeps both runs.
    const second = w.ledger.filter((r) => r.ref.endsWith('#1')).reduce((a, r) => a + r.usd, 0);
    assert.ok(Math.abs(done.spent_usd - second) < 1e-6 && second > 0);
    assert.ok(Math.abs(w.ledger.reduce((a, r) => a + r.usd, 0) - (firstSpend + second)) < 1e-6);
  });
});

describe('publishing', () => {
  it('asks for a learning pass and runs none of it in the publish request', async () => {
    const w = world();
    w.deps.passes = memPasses();
    const calls = [];
    // A learning adapter that only knows what a tick and the estimate may ask; anything else is a learning pass.
    w.deps.learn = new Proxy({ listApprovedLangs: async () => [], getStyle: async () => null }, {
      get(target, name) {
        calls.push(String(name));
        return target[name] ?? (async () => { throw new Error(`unexpected learn.${String(name)}`); });
      },
    });
    const j = await newJob(w);
    await run(w, TERMINAL);
    const job = w.jobs.get(j.id);
    assert.equal(job.status, 'published', job.error);
    assert.deepEqual([...new Set(calls)].sort(), ['getStyle', 'listApprovedLangs']);
    // No step map was handed in, so the pass can only have been opened, never run.
    const passes = [...w.deps.passes.rows.values()];
    assert.deepEqual(passes.map((p) => [p.kind, p.lang, p.reason, p.status, p.phase]), [['learn', 'de', 'publish', 'open', 'start']]);
    assert.equal(job.stats.run_at, undefined);
  });
});

describe('one heavy job per tick', () => {
  it('a job ready to publish goes before an estimate, whatever the list order', async () => {
    const w = world();
    const pub = await newJob(w);
    await until(w, () => w.jobs.get(pub.id).status === 'publishing');
    const est = await newJob(w, { lang: 'it' });
    // Same created_at in production means any order: put the estimate first.
    const row = w.jobs.get(pub.id);
    w.jobs.delete(pub.id);
    w.jobs.set(pub.id, row);
    assert.deepEqual([...w.jobs.keys()], [est.id, pub.id]);

    const out = await tick(w.deps);
    assert.equal(w.jobs.get(pub.id).status, 'published', w.jobs.get(pub.id).error);
    assert.deepEqual(out.map((o) => o.id), [pub.id]);
    assert.equal(w.jobs.get(est.id).stats.est, undefined); // the estimate waited one tick
    const next = await tick(w.deps);
    assert.deepEqual(next.map((o) => o.id), [est.id]); // and runs on the next one
  });
});

describe('idempotency', () => {
  it('a racing second advance with a stale row creates no second batch', async () => {
    const w = world();
    const j = await newJob(w);
    await tick(w.deps); // estimating -> queued
    const [queued] = await w.db.listOpenJobs();
    assert.equal(queued.status, 'queued');
    await Promise.all([advance(w.deps, queued), advance(w.deps, queued)]);
    // Claimed for submission; the batch is created by a slice. Two requests at that slice: one batch.
    const claimed = await w.db.getJob(j.id);
    assert.deepEqual([claimed.status, claimed.stats.phase, isHeavy(claimed)], ['submitted', 'submitting', true]);
    await Promise.all([advance(w.deps, claimed), advance(w.deps, { ...claimed })]);
    const main = w.llm.batches.filter((b) => b.requests.some((r) => !r.custom_id.startsWith('j')));
    assert.equal(main.length, 1);
    await run(w, TERMINAL);
    assert.equal(w.llm.batches.filter((b) => b.requests.some((r) => r.custom_id.startsWith('c'))).length, 1);
  });

  it('a job claimed for submission without an intent goes on at once (nobody is creating its batch)', async () => {
    const w = world();
    const j = await newJob(w);
    await tick(w.deps); // queued
    const queued = await w.db.getJob(j.id);
    // The request that claimed it was killed before it wrote an intent.
    await w.db.cas(queued, { status: 'submitted', stats: { ...queued.stats, phase: 'submitting' } });
    await tick(w.deps);
    assert.equal(w.llm.batches.length, 1);
    assert.equal(w.jobs.get(j.id).stats.resubmits, undefined);
  });

  it('a young intent of another request is left alone, and the job does not hold the slot meanwhile', async () => {
    const w = world();
    const j = await newJob(w);
    await tick(w.deps); // queued
    const queued = await w.db.getJob(j.id);
    const at = new Date(w.deps.now().getTime() + 60_000).toISOString();
    await w.db.cas(queued, { status: 'submitted', stats: { ...queued.stats, phase: 'submitting', submit: { kind: 'main', g: 0, at } } });
    const other = await newJob(w, { lang: 'it' });
    const out = await tick(w.deps);
    assert.equal(w.llm.batches.length, 0);
    assert.deepEqual(out.map((o) => o.id), [other.id]);
  });

  // Brings a job to `validating` with its main batch ended and the judge batch not created yet
  // (the run that should have created it was killed), stale enough for a resume.
  async function staleJudgeSubmission(w, failure = new Error('connection lost')) {
    const j = await newJob(w);
    await until(w, () => w.jobs.get(j.id).stats?.phase === 'running');
    const create = w.llm.createBatch;
    w.llm.createBatch = async () => { throw failure; };
    await tick(w.deps); // results collected, judge sample taken, intent written, create dies
    w.llm.createBatch = create;
    assert.equal(w.jobs.get(j.id).status, 'validating');
    const cur = w.jobs.get(j.id);
    assert.equal(cur.stats.phase, 'judge_submitting');
    cur.updated_at = new Date(0).toISOString();
    const base = Date.now() + 3_600_000;
    w.deps.now = () => new Date(base);
    return j.id;
  }
  const judgeBatches = (w) => w.llm.batches.filter((b) => b.requests.some((r) => r.custom_id === 'j0'));

  it('two runs resuming the same stale judge submission create one judge batch', async () => {
    const w = world();
    const id = await staleJudgeSubmission(w);
    const snap = await w.db.getJob(id);
    await Promise.all([advance(w.deps, snap), advance(w.deps, { ...snap })]);
    assert.equal(judgeBatches(w).length, 1);
    const after = w.jobs.get(id);
    assert.equal(after.stats.phase, 'judge');
    assert.equal(after.batch_ids.filter((b) => b.kind === 'judge').length, 1);
    assert.equal(after.stats.submit, undefined);
  });

  it('two runs resuming the same stale main submission create one main batch', async () => {
    const w = world();
    const j = await newJob(w);
    await tick(w.deps); // queued
    const queued = await w.db.getJob(j.id);
    await w.db.cas(queued, { status: 'submitted', stats: { ...queued.stats, phase: 'submitting' } });
    w.jobs.get(j.id).updated_at = new Date(0).toISOString();
    const base = Date.now() + 3_600_000;
    w.deps.now = () => new Date(base);
    const snap = await w.db.getJob(j.id);
    await Promise.all([advance(w.deps, snap), advance(w.deps, { ...snap })]);
    assert.equal(w.llm.batches.length, 1);
    assert.equal(w.jobs.get(j.id).stats.phase, 'running');
  });

  it('a run killed after its create is resumed once and counted as a possible duplicate', async () => {
    const w = world();
    const j = await newJob(w);
    await tick(w.deps); // queued
    const queued = await w.db.getJob(j.id);
    // The killed run recorded its intent for group 0 and never saved a batch ref.
    await w.db.cas(queued, { status: 'submitted', stats: { ...queued.stats, phase: 'submitting', submit: { kind: 'main', g: 0, at: 'x' } } });
    w.jobs.get(j.id).updated_at = new Date(0).toISOString();
    const base = Date.now() + 3_600_000;
    w.deps.now = () => new Date(base);
    await tick(w.deps);
    const after = w.jobs.get(j.id);
    assert.equal(w.llm.batches.length, 1);
    assert.equal(after.stats.resubmits, 1);
    assert.equal(after.stats.submit, undefined);
  });

  it('a create the provider refuses leaves no intent behind, so the retry is not counted as a duplicate', async () => {
    const w = world();
    const id = await staleJudgeSubmission(w, Object.assign(new Error('rate limited'), { status: 429 }));
    assert.equal(w.jobs.get(id).stats.submit, undefined);
    await tick(w.deps);
    assert.equal(judgeBatches(w).length, 1);
    assert.equal(w.jobs.get(id).stats.resubmits, undefined);
  });

  it('a create whose answer never arrived keeps its intent, so the retry is counted', async () => {
    const w = world();
    const id = await staleJudgeSubmission(w); // no HTTP status: the batch may exist
    assert.deepEqual(Object.keys(w.jobs.get(id).stats.submit).sort(), ['at', 'g', 'kind']);
    await tick(w.deps);
    assert.equal(judgeBatches(w).length, 1);
    assert.equal(w.jobs.get(id).stats.resubmits, 1);
    assert.equal(w.jobs.get(id).stats.submit, undefined);
  });

  it('a slice that is repeated after a kill books its spend once and leaves the same results', async () => {
    const w = world({ llmMode: 'badfirst' });
    const j = await newJob(w);
    // Every slice twice: the second run starts from the row as it was before the first one committed.
    for (let i = 0; i < 600 && !['published', 'failed'].includes(w.jobs.get(j.id).status); i++) {
      const before = structuredClone(w.jobs.get(j.id));
      await tickAll(w.deps, ONE);
      const after = structuredClone(w.jobs.get(j.id));
      if (!isHeavy(before) || before.status === 'estimating') continue;
      // Put the row back, run the slice again, and it must end where the first run ended.
      const files = structuredClone([...w.files]);
      const batches = w.llm.batches.length;
      w.jobs.set(j.id, structuredClone(before));
      await advance(w.deps, structuredClone(before));
      const again = w.jobs.get(j.id);
      if (w.llm.batches.length > batches) {
        // The one thing that cannot be repeated for free: a create (its intent was not there yet).
        w.llm.batches.length = batches;
      }
      assert.deepEqual([again.status, again.stats.phase, again.stats.pos, again.spent_usd], [after.status, after.stats.phase, after.stats.pos, after.spent_usd], `${before.status}/${before.stats.phase}`);
      w.jobs.set(j.id, after);
      for (const [k, v] of files) if (k.startsWith('translation-work/')) w.files.set(k, v);
    }
    const job = w.jobs.get(j.id);
    assert.equal(job.status, 'published', job.error);
    assert.deepEqual(w.ledger.map((r) => r.ref).sort(), ['judge', 'main:0', 'postedit:0']);
    const overlay = w.files.get(overlayKey('de', NEW));
    assert.deepEqual(Object.keys(overlay.entries).sort(), ['pu_m_1', 'ui_a_1', 'ui_a_2']);
  });
});

describe('ending a job that has batches', () => {
  it('a cancel that arrives while a batch is being created stops that batch', async () => {
    const w = world();
    const j = await newJob(w);
    const stopped = [];
    w.llm.cancel = async (id) => { stopped.push(id); };
    const create = w.llm.createBatch;
    // The admin cancels between the provider's answer and the write of the batch id.
    w.llm.createBatch = async (reqs) => {
      const out = await create(reqs);
      await cancel(w.deps, j.id);
      return out;
    };
    await until(w, () => w.jobs.get(j.id).status === 'cancelled');
    const job = w.jobs.get(j.id);
    assert.deepEqual([job.batch_ids, job.stats.submit], [[], undefined]);
    assert.deepEqual(stopped, ['b0'], 'the batch nobody will read is cancelled at the provider');
    for (let i = 0; i < 3; i++) await tick(w.deps);
    assert.equal(w.llm.batches.length, 1);
  });

  it('a cancel that loses its race leaves the batches alone', async () => {
    const w = world();
    const j = await newJob(w);
    await until(w, () => w.jobs.get(j.id).stats?.phase === 'running');
    const stopped = [];
    w.llm.cancel = async (id) => { stopped.push(id); };
    const cas = w.deps.db.cas;
    w.deps.db.cas = async (job, patch) => (patch.status === 'cancelled' ? null : cas(job, patch));
    await assert.rejects(cancel(w.deps, j.id), { key: 'translate.conflict' });
    w.deps.db.cas = cas;
    assert.deepEqual(stopped, []);
    await run(w, TERMINAL);
    assert.equal(w.jobs.get(j.id).status, 'published');
    assert.equal(w.llm.batches.filter((b) => b.requests[0].custom_id.startsWith('p')).length, 0, 'nothing was sent again as a post-edit');
  });

  it('the share of the estimate that was sent and never read goes into the ledger', async () => {
    const w = world();
    const j = await newJob(w);
    await until(w, () => w.jobs.get(j.id).stats?.phase === 'running');
    const estimate = w.jobs.get(j.id).estimate_usd;
    await cancel(w.deps, j.id);
    assert.deepEqual(w.ledger.map((r) => [r.ref, r.usd]), [['unread', estimate]]);

    // Nothing was sent: nothing is booked.
    const w2 = world({ settings: { upload_cap_usd: 0 } });
    const k = await newJob(w2);
    await run(w2, TERMINAL);
    await cancel(w2.deps, k.id);
    assert.deepEqual(w2.ledger, []);

    // Everything was read: the ledger already holds the real spend.
    const w3 = world();
    const l = await newJob(w3);
    await until(w3, () => w3.jobs.get(l.id).status === 'publishing');
    const refs = w3.ledger.map((r) => r.ref).sort();
    await cancel(w3.deps, l.id);
    assert.deepEqual(w3.ledger.map((r) => r.ref).sort(), refs);
  });
});

describe('creating a batch', () => {
  it('a server error may have created the batch: the intent stays and the retry is counted', async () => {
    const w = world();
    const j = await newJob(w);
    await until(w, () => w.jobs.get(j.id).stats?.phase === 'running');
    const create = w.llm.createBatch;
    w.llm.createBatch = async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); };
    await tick(w.deps);
    w.llm.createBatch = create;
    const cur = w.jobs.get(j.id);
    assert.equal(cur.stats.phase, 'judge_submitting');
    assert.deepEqual(Object.keys(cur.stats.submit).sort(), ['at', 'g', 'kind']);
    cur.updated_at = new Date(0).toISOString();
    const base = Date.now() + 3_600_000;
    w.deps.now = () => new Date(base);
    await tick(w.deps);
    assert.equal(w.jobs.get(j.id).stats.resubmits, 1);
  });

  it('a job that keeps losing its creates stops instead of paying for one batch after another', async () => {
    const w = world();
    const j = await newJob(w);
    await tick(w.deps); // queued
    const queued = await w.db.getJob(j.id);
    await w.db.cas(queued, { status: 'submitted', stats: { ...queued.stats, phase: 'submitting', resubmits: 3, submit: { kind: 'main', g: 0, at: 'x' } } });
    w.jobs.get(j.id).updated_at = new Date(0).toISOString();
    const base = Date.now() + 3_600_000;
    w.deps.now = () => new Date(base);
    await tick(w.deps);
    const after = w.jobs.get(j.id);
    assert.deepEqual([after.status, after.error, w.llm.batches.length], ['failed', 'translate.resubmit_limit', 0]);
  });

  it('errors while a batch is awaited only count in a row: a day of waiting survives more than five of them', async () => {
    const w = world();
    const j = await newJob(w);
    await until(w, () => w.jobs.get(j.id).stats?.phase === 'running');
    let mode = 'throw';
    w.llm.isEnded = async () => {
      if (mode === 'throw') throw new Error('network');
      return mode === 'ended';
    };
    for (let round = 0; round < 3; round++) {
      mode = 'throw';
      for (let i = 0; i < 4; i++) await tick(w.deps);
      assert.equal(w.jobs.get(j.id).stats.attempts, 4);
      mode = 'running';
      await tick(w.deps);
      assert.equal(w.jobs.get(j.id).stats.attempts, undefined, 'a wait that was asked without an error starts the count again');
    }
    assert.equal(w.jobs.get(j.id).status, 'submitted');
    mode = 'ended';
    await run(w, TERMINAL);
    assert.equal(w.jobs.get(j.id).status, 'published');
  });

  it('a result no request of the plan stands for is still paid for', async () => {
    const spend = async (ghost) => {
      const w = world();
      const j = await newJob(w);
      const results = w.llm.results.bind(w.llm);
      w.llm.results = async function* (id) {
        if (ghost) yield { custom_id: 'ghost', type: 'succeeded', text: '{}', stop_reason: 'end_turn', usage: { input_tokens: 1_000_000, output_tokens: 0 }, model: 'claude-sonnet-5-5' };
        yield* results(id);
      };
      await run(w, TERMINAL);
      assert.equal(w.jobs.get(j.id).status, 'published');
      return w.jobs.get(j.id).spent_usd;
    };
    const [plain, withGhost] = [await spend(false), await spend(true)];
    assert.ok(withGhost > plain + 0.5, `${withGhost} vs ${plain}`);
  });
});

describe('publishing beside other writers', () => {
  it('latest.json is the overlay of the live build: the job of another build writes only its own file', async () => {
    const forLive = async (live) => {
      const w = world();
      w.deps.sources = { liveBuild: async () => live, list: async () => [] };
      const j = await newJob(w);
      await run(w, TERMINAL);
      assert.equal(w.jobs.get(j.id).status, 'published', w.jobs.get(j.id).error);
      return [w.files.has(overlayKey('de', NEW)), w.files.has(overlayKey('de', 'latest'))];
    };
    assert.deepEqual(await forLive(NEW), [true, true]);
    assert.deepEqual(await forLive(OLD), [true, false]);
  });

  it('what an admin or an import wrote for a text while the job ran is not overwritten', async () => {
    const w = world();
    const j = await newJob(w, { created_at: '2026-06-01T00:00:00.000Z' });
    await until(w, () => w.jobs.get(j.id).status === 'validating');
    const [open, close, kill] = await Promise.all(['Open the door', 'Close the door', 'Kill ~mission(Target) at <EM1>Port</EM1>'].map((e) => sha256Hex(e)));
    await saveTm(w.deps.store, 'de', {
      [open]: { t: 'Tür auf', o: 'admin' },
      [close]: { t: 'Tür zu (Pack)', o: 'community', src: 'pack', at: '2026-06-02T00:00:00.000Z' },
      // Older than the job: it was there when the job decided to translate the text again.
      [kill]: { t: 'Alt', o: 'community', src: 'pack', at: '2026-05-01T00:00:00.000Z' },
    });
    await run(w, TERMINAL);
    assert.equal(w.jobs.get(j.id).status, 'published', w.jobs.get(j.id).error);
    const tm = await loadTm(w.deps.store, 'de');
    assert.deepEqual([tm[open].o, tm[open].t, tm[close].o, tm[close].t, tm[kill].o], ['admin', 'Tür auf', 'community', 'Tür zu (Pack)', 'ai']);
    const overlay = w.files.get(overlayKey('de', NEW));
    assert.deepEqual([overlay.entries.ui_a_1.t, overlay.entries.ui_a_2.t], ['Tür auf', 'Tür zu (Pack)']);
  });

  it('an admin entry is never sent for retranslation because its text uses a flagged term', async () => {
    const w = world({ en: { ui_a_1: 'Open the door', ui_a_2: 'Close the door', ui_old: 'Unchanged text' }, baseEn: { ui_a_1: 'Open the door', ui_a_2: 'Close the door', ui_old: 'Unchanged text' } });
    w.db.glossary.push({ id: 'g1', source_term: 'door', target_term: 'Tür', category: 'term', origin: 'admin', needs_retranslate: true });
    await saveTm(w.deps.store, 'de', {
      [await sha256Hex('Open the door')]: { t: 'Tür öffnen', o: 'admin' },
      [await sha256Hex('Close the door')]: { t: 'Tor zu', o: 'ai', at: '2026-01-01T00:00:00.000Z' },
    });
    const j = await newJob(w);
    await run(w, TERMINAL);
    const job = w.jobs.get(j.id);
    assert.equal(job.status, 'published', job.error);
    assert.equal(job.stats.counts.forced, 1);
    // The strings of the main batch (the admin's line may still ride along as a reference pair).
    const asked = w.llm.batches[0].requests.flatMap((r) => {
      const msg = r.params.messages[0].content;
      return JSON.parse(msg.slice(msg.indexOf('{"g"'))).g.flatMap((x) => x.s.map((s) => s[1]));
    });
    assert.deepEqual(asked, ['Close the door']);
  });
});

describe('jobs that began under an older layout', () => {
  it('an estimate at a position this code does not know begins again and ends with the right plan', async () => {
    const w = world();
    const j = await newJob(w);
    const cur = w.jobs.get(j.id);
    w.jobs.set(j.id, { ...cur, stats: { est: { phase: 'scan', cursor: 8, total: 20 } } });
    await run(w, TERMINAL);
    const job = w.jobs.get(j.id);
    assert.equal(job.status, 'published', job.error);
    assert.deepEqual([job.stats.counts.todo, job.string_count], [3, 3]);
  });

  it('a queued job without a plan of this layout is estimated again, nothing is sent blind', async () => {
    const w = world();
    const j = await newJob(w);
    const cur = w.jobs.get(j.id);
    w.jobs.set(j.id, { ...cur, status: 'queued', estimate_usd: 1, string_count: 3, stats: { counts: { todo: 3 } } });
    await tickAll(w.deps, { fast: true, sliceBudgetMs: 0 });
    assert.equal(w.llm.batches.length, 0);
    assert.equal(w.jobs.get(j.id).status, 'estimating');
    await run(w, TERMINAL);
    assert.equal(w.jobs.get(j.id).status, 'published', w.jobs.get(j.id).error);
    assert.equal(w.llm.batches.filter((b) => b.requests[0].custom_id.startsWith('c')).length, 1);
  });
});
