// node --test supabase/functions/translate-orchestrator/_spend.test.mjs
// Caps and approvals are given for an estimate. These tests make the provider bill something else and
// check that the real figures decide wherever a decision is still open: the first batch group of a
// large job is read before the others are sent, the judge and the second attempts are only paid
// while the job's budget and the month's cap allow it, and whatever was paid is booked once.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { priceOf } from './_cost.ts';
import { overlayKey } from './_io.ts';
import { budgetOf, GROUP_PARTS, OVERRUN_MIN_USD, OVERRUN_SHARE, reserveOf } from './_job.ts';
import { readPlanPart, requestsEstimateUsd } from './_job_estimate.ts';
import { approve, cancel, isHeavy, tickAll } from './_machine.ts';
import { askedOf, fakeDb, fakeDeps, fakeLlm, NEW, OLD, putTable, textStore } from './_testkit.mjs';

const ONE = { sliceBudgetMs: 0 };
const sum = (rows) => Math.round(rows.reduce((a, r) => a + r.usd, 0) * 1e6) / 1e6;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 2e-6, `${msg ?? ''} ${a} != ${b}`);

/** `n` texts in two key groups; every text that `bad` picks fails its first attempt. */
function texts(n) {
  const en = {};
  for (let i = 0; i < n; i++) {
    const g = i % 2 ? 'pu' : 'item';
    en[`${g}_fam${String(i % 300).padStart(3, '0')}_${String(i).padStart(5, '0')}`] = `String ${i} with ~mission(Target|Name) inside and enough words to be a sentence of its own`;
  }
  return en;
}

/**
 * A provider whose bill is set by the test: `bill.main` / `bill.post` / `bill.judge` are USD per
 * request, or a function of the request (undefined = the small default of the fake), turned into
 * output tokens of the request's model.
 */
function world({ n = 300, mode = 'delta', bad, judge, settings } = {}) {
  const ts = textStore();
  putTable(ts, NEW, 'en', texts(n));
  if (mode === 'delta') putTable(ts, OLD, 'en', { other_key: 'Other' });
  const bill = {};
  const open = new Set();
  const usage = (r, kind) => {
    const usd = typeof bill[kind] === 'function' ? bill[kind](r) : bill[kind];
    if (usd === undefined) return undefined;
    const model = kind === 'judge' ? 'claude-opus-5-5' : r.params.model;
    return { input_tokens: 0, output_tokens: Math.round((usd * 1e6) / priceOf(model).out) };
  };
  const llm = fakeLlm({ bad, judge, usage, ended: (id) => !open.has(id) });
  const db = fakeDb({ settings });
  const deps = fakeDeps({ ts, db, llm });
  const newJob = () => db.insertJob({ build_id: NEW, lang: 'de', mode, base_build_id: mode === 'delta' ? OLD : null });
  const kinds = () => ({
    main: llm.batches.filter((b) => b.requests[0].custom_id.startsWith('c')),
    post: llm.batches.filter((b) => b.requests[0].custom_id.startsWith('p')),
    judge: llm.batches.filter((b) => b.requests[0].custom_id === 'j0'),
  });
  return { ts, db, deps, llm, jobs: db.jobs, newJob, bill, open, kinds };
}

/**
 * Bills every first attempt `factor` times what that request was estimated at (its own tokens; the
 * shared system prompt is left out, so a job as a whole is billed a little under `factor`).
 */
async function billFirstAttempts(w, jobId, factor) {
  const job = w.jobs.get(jobId);
  const est = new Map();
  for (let p = 0; p < job.stats.plan.parts; p++) {
    for (const c of (await readPlanPart(w.deps, job, p)).chunks) est.set(c.id, requestsEstimateUsd('de', 0, [c]));
  }
  w.bill.main = (r) => est.get(r.custom_id) * factor;
}

async function until(w, done, max = 3000) {
  for (let i = 0; i < max; i++) {
    if (done()) return;
    await tickAll(w.deps, ONE);
  }
  throw new Error(`never got there: ${[...w.jobs.values()].map((j) => `${j.status}/${j.stats?.phase} ${j.error ?? ''}`)}`);
}
const ended = (w, id) => () => ['published', 'failed', 'cancelled', 'skipped'].includes(w.jobs.get(id).status);
const at = (w, id, status, phase) => () => w.jobs.get(id).status === status && (phase === undefined || w.jobs.get(id).stats?.phase === phase);

describe('the budget of a job', () => {
  it('is its estimate and a quarter, at least five cents; an open job reserves what it may still spend', () => {
    assert.deepEqual([OVERRUN_SHARE, OVERRUN_MIN_USD], [0.25, 0.05]);
    assert.equal(budgetOf({ estimate_usd: 40 }), 50);
    assert.equal(budgetOf({ estimate_usd: 0.1 }), 0.15);
    assert.equal(budgetOf({ estimate_usd: 0 }), 0.05);
    assert.equal(budgetOf({ estimate_usd: null }), 0.05);
    assert.equal(reserveOf({ estimate_usd: 40, spent_usd: 0 }), 50);
    assert.equal(reserveOf({ estimate_usd: 40, spent_usd: 44.5 }), 5.5);
    assert.equal(reserveOf({ estimate_usd: 40, spent_usd: 61 }), 0);
  });
});

describe('a job of several batch groups', () => {
  const N = 9000;

  it('sends its first group alone and reads what it cost before it sends the others', async () => {
    const w = world({ n: N, mode: 'full' });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    const groups = Math.ceil(w.jobs.get(job.id).stats.plan.parts / GROUP_PARTS);
    assert.ok(groups >= 3, `groups ${groups}`);
    await approve(w.deps, job.id, 'admin');
    w.open.add('b0');
    await until(w, at(w, job.id, 'submitted', 'probe'));
    assert.equal(w.llm.batches.length, 1);
    assert.equal(isHeavy(w.jobs.get(job.id)), false, 'a wait: the fast lane leaves it to the 10-minute tick');
    // The batch has not ended: nothing else is sent, nothing is read.
    for (let i = 0; i < 5; i++) await tickAll(w.deps, ONE);
    assert.equal(w.llm.batches.length, 1);
    assert.deepEqual([w.jobs.get(job.id).stats.phase, w.db.ledger.length], ['probe', 0]);

    w.open.delete('b0');
    await tickAll(w.deps, ONE);
    const probed = w.jobs.get(job.id);
    assert.deepEqual([probed.status, probed.stats.phase], ['submitted', 'submitting']);
    assert.ok(probed.stats.pos >= 1 && w.llm.batches.length <= 2, 'the others follow only now');
    const { est, usd, ratio } = probed.stats.probe;
    assert.ok(est > 0 && usd > 0 && ratio < 1, JSON.stringify(probed.stats.probe));
    near(ratio, Math.round((usd / est) * 1000) / 1000);
    // Its spend is in the ledger under the ref its read uses later; `spent_usd` waits for that read.
    assert.deepEqual(w.db.ledger.map((r) => [r.ref, r.usd]), [['main:0', usd]]);
    assert.equal(probed.spent_usd, 0);
    assert.equal(probed.estimate_usd, w.jobs.get(job.id).estimate_usd);

    await until(w, ended(w, job.id));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    const { main } = w.kinds();
    assert.equal(main.length, groups);
    const asked = main.flatMap((b) => b.requests.flatMap(askedOf));
    assert.equal(new Set(asked.map((a) => a.key)).size, N);
    assert.equal(asked.length, N, 'no group is sent twice');
    assert.equal(w.db.ledger.filter((r) => r.ref === 'main:0').length, 1);
    near(done.spent_usd, sum(w.db.ledger), 'what the job says it spent is what the ledger holds');
    assert.equal(done.stats.capped, undefined);
  });

  it('a first group far above its estimate stops the job: one group is paid, the estimate is corrected, a person decides', async () => {
    const w = world({ n: N, mode: 'full' });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    const planned = w.jobs.get(job.id);
    const groups = Math.ceil(planned.stats.plan.parts / GROUP_PARTS);
    await approve(w.deps, job.id, 'admin');
    // Every request is billed twice what it was estimated at (a language whose tokens run longer).
    await billFirstAttempts(w, job.id, 2);
    await until(w, at(w, job.id, 'awaiting_approval'));
    const held = w.jobs.get(job.id);
    assert.equal(held.stats.hold, 'overrun');
    assert.equal(held.approved_by, null, 'the approval was for the old figure');
    assert.equal(w.llm.batches.length, 1, 'one group is paid, not all of them');
    const { usd, ratio } = held.stats.probe;
    assert.ok(ratio > 1.7 && ratio <= 2, `ratio ${ratio}`);
    // The corrected estimate is the old one times what the first group cost against its own estimate.
    assert.ok(Math.abs(held.estimate_usd / planned.estimate_usd - ratio) < 0.001, `${held.estimate_usd} / ${planned.estimate_usd} vs ${ratio}`);
    assert.deepEqual(w.db.ledger.map((r) => [r.ref, r.usd]), [['main:0', usd]]);
    // It waits: no tick moves it.
    for (let i = 0; i < 5; i++) await tickAll(w.deps, ONE);
    assert.deepEqual([w.jobs.get(job.id).status, w.llm.batches.length], ['awaiting_approval', 1]);

    // Approved for the corrected figure, it goes on with the second group and is not probed again.
    await approve(w.deps, job.id, 'admin');
    await until(w, ended(w, job.id));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    const { main } = w.kinds();
    assert.equal(main.length, groups);
    assert.equal(main.flatMap((b) => b.requests.flatMap(askedOf)).length, N, 'the first group is not sent again');
    assert.deepEqual(done.stats.probe, held.stats.probe);
    assert.equal(w.db.ledger.filter((r) => r.ref === 'main:0').length, 1);
    near(done.spent_usd, sum(w.db.ledger), 'the first group is counted once');
    assert.ok(done.spent_usd <= budgetOf(done), `spent ${done.spent_usd} of ${budgetOf(done)}`);
  });

  it('cancelled while it waits with a paid first group, the job books that group once and nothing else', async () => {
    const w = world({ n: N, mode: 'full' });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    await approve(w.deps, job.id, 'admin');
    await billFirstAttempts(w, job.id, 3);
    await until(w, at(w, job.id, 'awaiting_approval'));
    const paid = w.jobs.get(job.id).stats.probe.usd;
    await cancel(w.deps, job.id);
    assert.equal(w.jobs.get(job.id).status, 'cancelled');
    assert.deepEqual(w.db.ledger.map((r) => [r.ref, r.usd]), [['main:0', paid]]);
  });

  it('cancelled after the probe, the groups that were sent and not read are booked at their estimate, the probed one at its bill', async () => {
    const w = world({ n: N, mode: 'full' });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    const groups = Math.ceil(w.jobs.get(job.id).stats.plan.parts / GROUP_PARTS);
    await approve(w.deps, job.id, 'admin');
    await until(w, () => w.llm.batches.length === 2);
    const cur = w.jobs.get(job.id);
    await cancel(w.deps, job.id);
    const rows = Object.fromEntries(w.db.ledger.map((r) => [r.ref, r.usd]));
    assert.deepEqual(Object.keys(rows).sort(), ['main:0', 'unread']);
    assert.equal(rows['main:0'], cur.stats.probe.usd);
    near(rows.unread, Math.round((cur.estimate_usd / groups) * 1e6) / 1e6, 'one group of the estimate, not two');
  });

  it('a first batch that billed nothing says nothing about the price: the job goes on', async () => {
    const w = world({ n: N, mode: 'full' });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    await approve(w.deps, job.id, 'admin');
    w.bill.main = 0;
    await until(w, () => w.jobs.get(job.id).stats?.probe);
    const j = w.jobs.get(job.id);
    assert.deepEqual([j.status, j.stats.phase, j.stats.probe.ratio, j.stats.probe.usd], ['submitted', 'submitting', 1, 0]);
    assert.equal(w.db.ledger.length, 0);
  });
});

describe('paid steps beyond the first attempts', () => {
  // One text in five fails its first attempt and would get a second one.
  const bad = (text) => /String \d*[05] /.test(text);

  it('a job that has spent its budget pays for nothing more and publishes what passed', async () => {
    const w = world({ n: 300, bad });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'submitted'));
    const planned = w.jobs.get(job.id);
    assert.equal(planned.stats.probe, undefined);
    // The one batch of first attempts is billed 1.4 times its estimate: the budget (1.25) is gone.
    await billFirstAttempts(w, job.id, 1.4);
    await until(w, ended(w, job.id));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    const k = w.kinds();
    assert.deepEqual([k.main.length, k.judge.length, k.post.length], [1, 0, 0]);
    assert.deepEqual(w.db.ledger.map((r) => r.ref), ['main:0']);
    near(done.spent_usd, sum(w.db.ledger));
    assert.equal(done.stats.capped.reason, 'job_budget');
    assert.deepEqual([done.stats.capped.judge, done.stats.capped.texts], [true, 60]);
    near(done.stats.capped.limit, budgetOf(planned));
    assert.deepEqual([done.stats.qa.ok, done.stats.qa.failed, done.stats.qa.dropped], [240, 60, 60]);
    assert.equal(done.stats.judge, null);
    // The texts without a second attempt stay untranslated; the others are delivered.
    const overlay = JSON.parse(w.ts.files.get(overlayKey('de', NEW)));
    assert.equal(Object.keys(overlay.entries).length, 240);
    assert.ok(Object.values(overlay.entries).every((e) => !/String \d*[05] /.test(e.t)));
  });

  it('inside its budget the same job pays for the judge and the second attempts', async () => {
    const w = world({ n: 300, bad });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'submitted'));
    const planned = w.jobs.get(job.id);
    await billFirstAttempts(w, job.id, 0.9);
    await until(w, ended(w, job.id));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    const k = w.kinds();
    assert.deepEqual([k.main.length, k.judge.length, k.post.length], [1, 1, 1]);
    assert.equal(done.stats.capped, undefined);
    assert.deepEqual([done.stats.qa.ok, done.stats.qa.failed, done.stats.qa.dropped], [300, 0, 0]);
    near(done.stats.peSent > 0 ? 1 : 0, 1);
    assert.ok(done.spent_usd <= budgetOf(planned));
  });

  it('second attempts stop where the budget ends: what was sent is read, the rest stays untranslated', async () => {
    const N = 9000;
    const w = world({ n: N, mode: 'full', bad });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    const planned = w.jobs.get(job.id);
    const groups = Math.ceil(planned.stats.plan.parts / GROUP_PARTS);
    await approve(w.deps, job.id, 'admin');
    // First attempts are billed 1.1 times their estimate: the probe lets the job go on, some 0.15 of it is left.
    await billFirstAttempts(w, job.id, 1.1);
    w.bill.post = 0.0001;
    await until(w, ended(w, job.id));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    const k = w.kinds();
    assert.equal(k.main.length, groups);
    assert.ok(k.post.length >= 1 && k.post.length < groups, `post-edit batches ${k.post.length} of ${groups}`);
    assert.equal(done.stats.pe.length, k.post.length);
    // What was sent was read and booked.
    assert.deepEqual(w.db.ledger.map((r) => r.ref).filter((r) => r.startsWith('postedit')).sort(), done.stats.pe.map((g) => `postedit:${g}`).sort());
    near(done.spent_usd, sum(w.db.ledger));
    const redone = k.post.flatMap((b) => b.requests.flatMap(askedOf)).length;
    const c = done.stats.capped;
    assert.equal(c.reason, 'job_budget');
    assert.ok(c.texts > 0);
    // Every text that failed either got its second attempt or is counted as left out (the judge failed none here).
    assert.equal(redone + c.texts, N / 5);
    assert.deepEqual([done.stats.qa.ok, done.stats.qa.failed, done.stats.qa.dropped], [N - c.texts, c.texts, c.texts]);
    // The sent estimates plus the spend stayed inside the budget at every step.
    assert.ok(done.spent_usd <= budgetOf(planned), `spent ${done.spent_usd} of ${budgetOf(planned)}`);
    assert.equal(Object.keys(JSON.parse(w.ts.files.get(overlayKey('de', NEW))).entries).length, N - c.texts);
  });

  it('a job nobody approved leaves the second attempts out when the month has reached its cap meanwhile', async () => {
    const w = world({ n: 300, bad, settings: { monthly_cap_usd: 50 } });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'validating', 'judge_plan'));
    assert.equal(w.jobs.get(job.id).approved_by, null);
    // Other spend of the month lands while the job runs (learning, another job above its estimate).
    w.db.ledger.push({ jobId: 'other', month: 'm', usd: 49.999, ref: 'x' });
    await until(w, ended(w, job.id));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    const k = w.kinds();
    assert.deepEqual([k.judge.length, k.post.length], [0, 0]);
    assert.deepEqual([done.stats.capped.reason, done.stats.capped.limit, done.stats.capped.judge, done.stats.capped.texts], ['monthly_cap', 50, true, 60]);
    assert.equal(done.stats.qa.dropped, 60);
  });

  it('a job a person approved is not stopped by the month, only by its own budget', async () => {
    // The month is full before the job starts: it waits for approval.
    const w = world({ n: 300, bad, settings: { monthly_cap_usd: 50 } });
    w.db.ledger.push({ jobId: 'other', month: 'm', usd: 49.999, ref: 'x' });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    assert.equal(w.jobs.get(job.id).stats.hold, 'monthly_cap');
    await approve(w.deps, job.id, 'admin');
    await until(w, ended(w, job.id));
    const done = w.jobs.get(job.id);
    assert.equal(done.status, 'published', done.error);
    const k = w.kinds();
    assert.deepEqual([k.judge.length, k.post.length], [1, 1]);
    assert.equal(done.stats.capped, undefined);
    assert.equal(done.stats.qa.dropped, 0);
  });

  it('an open job counts for the month with what it may still spend, not with its estimate alone', async () => {
    const w = world({ n: 300, settings: { monthly_cap_usd: 1 } });
    const first = await w.newJob();
    w.open.add('b0');
    await until(w, at(w, first.id, 'submitted', 'running'));
    const a = w.jobs.get(first.id);
    near(await w.db.monthCommitted('m', 'nobody'), budgetOf(a));
    // A second job that fits beside the estimate of the first, but not beside its budget, waits.
    w.db.jobs.set('job2', { ...structuredClone(a), id: 'job2', status: 'queued', batch_ids: [], stats: { plan: a.stats.plan }, estimate_usd: 1 - a.estimate_usd - 0.01, spent_usd: 0 });
    await tickAll(w.deps, ONE);
    assert.deepEqual([w.jobs.get('job2').status, w.jobs.get('job2').stats.hold], ['awaiting_approval', 'monthly_cap']);
  });

  it('cancelled with second attempts sent and not read, the job books their estimate', async () => {
    const w = world({ n: 300, bad });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'post_editing', 'running'), 3000);
    const cur = w.jobs.get(job.id);
    assert.ok(cur.stats.peSent > 0);
    await cancel(w.deps, job.id);
    const rows = Object.fromEntries(w.db.ledger.map((r) => [r.ref, r.usd]));
    assert.deepEqual(Object.keys(rows).sort(), ['judge', 'main:0', 'unread']);
    near(rows.unread, cur.stats.peSent);
  });
});
