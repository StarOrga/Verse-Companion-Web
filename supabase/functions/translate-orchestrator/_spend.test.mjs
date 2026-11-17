// node --test supabase/functions/translate-orchestrator/_spend.test.mjs
// Caps and approvals are given for an estimate. These tests make the provider bill something else and
// check that the real figures decide wherever a decision is still open: the first batch group of a
// large job is read before the others are sent, the judge and the second attempts are only paid
// while the job's budget and the month's cap allow it, and whatever was paid is booked once.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billedModel, knownModel, priceOf } from './_cost.ts';
import { overlayKey } from './_io.ts';
import { budgetOf, GROUP_PARTS, OVERRUN_MIN_USD, OVERRUN_SHARE, PROBE_SHARE, reserveOf } from './_job.ts';
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
function world({ n = 300, mode = 'delta', bad, judge, settings, model, lost } = {}) {
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
  const llm = fakeLlm({ bad, judge, usage, ended: (id) => !open.has(id), model, lost });
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

describe('the price of an answer', () => {
  it('is the price of the model that ran it, also under a dated snapshot id', () => {
    assert.equal(knownModel('claude-sonnet-5-5'), 'claude-sonnet-5-5');
    assert.equal(knownModel('claude-sonnet-5-5-20261001'), 'claude-sonnet-5-5');
    assert.equal(knownModel('claude-haiku-5-5-20261001'), 'claude-haiku-5-5');
    assert.equal(knownModel('claude-sonnet-5-50'), null, 'a longer name is another model, not a snapshot');
    assert.equal(knownModel('claude-next-9'), null);
    assert.equal(knownModel(undefined), null);
    assert.deepEqual(priceOf('claude-sonnet-5-5-20261001'), priceOf('claude-sonnet-5-5'));
    assert.notDeepEqual(priceOf('claude-sonnet-5-5'), priceOf('claude-opus-5-5'));
    // An id the table has never heard of is priced as the most expensive model when nothing else is known ...
    assert.deepEqual(priceOf('claude-next-9'), priceOf('claude-opus-5-5'));
    // ... but a result is priced as what was asked for, not as that fallback.
    assert.equal(billedModel('claude-sonnet-5-5-20261001', 'claude-sonnet-5-5'), 'claude-sonnet-5-5-20261001');
    assert.equal(billedModel('claude-next-9', 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
    assert.equal(billedModel(undefined, 'claude-sonnet-5-5'), 'claude-sonnet-5-5');
    assert.equal(billedModel('claude-next-9', undefined), 'claude-next-9');
    assert.equal(billedModel(undefined, undefined), undefined);
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

    // It has ended: reading its bill is a slice of work of its own (stamped, behind the lock, on the fast lane).
    w.open.delete('b0');
    await tickAll(w.deps, { ...ONE, fast: true });
    assert.equal(w.jobs.get(job.id).stats.phase, 'probe', 'the fast lane asks no batch');
    // The first read dies: it is a counted step like any other slice, and the job stays where it is.
    const read = w.llm.results;
    let dies = true;
    w.llm.results = function (id, opts) {
      if (!dies) return read.call(this, id, opts);
      dies = false;
      throw new Error('read died');
    };
    await tickAll(w.deps, ONE);
    const waiting = w.jobs.get(job.id);
    assert.deepEqual([waiting.status, waiting.stats.phase, waiting.stats.attempts, waiting.stats.run_at], ['submitted', 'probe_read', 1, undefined]);
    assert.equal(isHeavy(waiting), true);
    assert.deepEqual([w.llm.batches.length, w.llm.reads.length, w.db.ledger.length, waiting.spent_usd], [1, 0, 0, 0]);
    const before = waiting.estimate_usd;

    // From here the fast lane goes on by itself.
    await tickAll(w.deps, { ...ONE, fast: true });
    const probed = w.jobs.get(job.id);
    assert.deepEqual([probed.status, probed.stats.phase], ['submitted', 'submitting']);
    assert.ok(probed.stats.pos >= 1 && w.llm.batches.length <= 2, 'the others follow only now');
    const { est, usd, ratio } = probed.stats.probe;
    assert.ok(est > 0 && usd > 0 && ratio < 1, JSON.stringify(probed.stats.probe));
    near(ratio, Math.round((usd / est) * 1000) / 1000);
    // Its bill is in the ledger under the ref its read uses later, and in what the job has spent.
    assert.deepEqual(w.db.ledger.map((r) => [r.ref, r.usd]), [['main:0', usd]]);
    near(probed.spent_usd, usd);
    assert.equal(probed.estimate_usd, before);
    // So the month counts the first group once: as spent, and no longer as reserved.
    near(await w.db.monthCommitted('m', 'nobody'), budgetOf(probed));
    // The look at the bill is not a call of its own in the call log.
    assert.deepEqual(w.llm.reads, [{ id: 'b0', record: false }]);

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
    // The read that uses the results of the first group is the one the call log sees.
    assert.deepEqual(w.llm.reads.filter((r) => r.id === 'b0').map((r) => r.record), [false, true]);
  });

  it('a first group a fifth above its estimate stops the job too: the margin is for the judge and the second attempts', async () => {
    assert.equal(PROBE_SHARE, 0.1);
    const w = world({ n: N, mode: 'full' });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    const planned = w.jobs.get(job.id);
    await approve(w.deps, job.id, 'admin');
    await billFirstAttempts(w, job.id, 1.22);
    await until(w, at(w, job.id, 'awaiting_approval'));
    const held = w.jobs.get(job.id);
    const { ratio } = held.stats.probe;
    assert.ok(ratio > 1 + PROBE_SHARE && ratio < 1 + OVERRUN_SHARE, `ratio ${ratio}: above the probe's share, inside the old budget`);
    assert.deepEqual([held.stats.hold, held.approved_by, w.llm.batches.length], ['overrun', null, 1]);
    // Approved, the job has its margin again, on the corrected figure.
    assert.ok(held.estimate_usd > planned.estimate_usd && budgetOf(held) > held.estimate_usd * 1.2);
  });

  it('requests that were not billed do not hide what the others cost', async () => {
    // Half of the first batch expires; the half that ran is billed twice its estimate.
    const w = world({ n: N, mode: 'full', lost: (r) => /[13579]$/.test(r.custom_id) });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'awaiting_approval'));
    await approve(w.deps, job.id, 'admin');
    await billFirstAttempts(w, job.id, 2);
    await until(w, () => w.jobs.get(job.id).stats?.probe);
    const held = w.jobs.get(job.id);
    assert.deepEqual([held.status, held.stats.hold], ['awaiting_approval', 'overrun']);
    assert.ok(held.stats.probe.ratio > 1.7 && held.stats.probe.ratio <= 2, `ratio ${held.stats.probe.ratio}`);
    assert.equal(w.llm.batches.length, 1);
    const lost = w.llm.batches[0].requests.filter((r) => /[13579]$/.test(r.custom_id)).length;
    assert.ok(lost > 0 && lost < w.llm.batches[0].requests.length, `lost ${lost}`);
  });

  it('an answer under a snapshot id, or under an id nobody knows, is billed as the model that was asked', async () => {
    const ratioWith = async (model) => {
      const w = world({ n: N, mode: 'full', model });
      const job = await w.newJob();
      await until(w, at(w, job.id, 'awaiting_approval'));
      await approve(w.deps, job.id, 'admin');
      await billFirstAttempts(w, job.id, 1);
      await until(w, () => w.jobs.get(job.id).stats?.probe);
      const j = w.jobs.get(job.id);
      return { status: j.status, hold: j.stats.hold, ...j.stats.probe };
    };
    const plain = await ratioWith(undefined);
    assert.equal(plain.status, 'submitted');
    assert.ok(plain.ratio > 0.8 && plain.ratio <= 1, `ratio ${plain.ratio}`);
    assert.deepEqual(await ratioWith((r) => `${r.params.model}-20261001`), plain);
    assert.deepEqual(await ratioWith(() => 'claude-next-9'), plain);
  });

  it('held above its estimate and approved by nobody in particular, the job counts its paid group once for the month', async () => {
    const settings = { monthly_cap_usd: 1e9 };
    const w = world({ n: N, settings });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'submitted'));
    assert.equal(w.jobs.get(job.id).approved_by, null);
    await billFirstAttempts(w, job.id, 2);
    await until(w, at(w, job.id, 'awaiting_approval'));
    const held = w.jobs.get(job.id);
    assert.equal(held.stats.hold, 'overrun');
    near(held.spent_usd, held.stats.probe.usd);
    // The month has room for exactly the corrected estimate. The paid group is in the ledger and in
    // that estimate: counted twice, the job would be held again for the month.
    settings.monthly_cap_usd = held.estimate_usd + 0.001;
    await approve(w.deps, job.id, null);
    await until(w, () => w.jobs.get(job.id).status !== 'queued');
    assert.deepEqual([w.jobs.get(job.id).status, w.jobs.get(job.id).stats.hold], ['submitted', undefined]);
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

  it('cancelled with the judge batch sent and not read, the job books its estimate', async () => {
    const w = world({ n: 300, bad });
    const job = await w.newJob();
    await until(w, at(w, job.id, 'validating', 'judge'));
    const cur = w.jobs.get(job.id);
    assert.ok(cur.stats.judgeSent > 0);
    assert.equal(w.kinds().judge.length, 1);
    await cancel(w.deps, job.id);
    const rows = Object.fromEntries(w.db.ledger.map((r) => [r.ref, r.usd]));
    assert.deepEqual(Object.keys(rows).sort(), ['main:0', 'unread']);
    near(rows.unread, cur.stats.judgeSent);
  });

  describe('a batch that may exist twice (its create was answered by nobody)', () => {
    const STALE = { kind: 'postedit', g: 0, at: '2026-11-17T00:00:00Z' };
    const before = async () => {
      const w = world({ n: 300, bad });
      const job = await w.newJob();
      await until(w, at(w, job.id, 'post_editing', 'submitting'));
      assert.equal(w.kinds().post.length, 0);
      return { w, id: job.id };
    };

    it('counts twice against the budget and in what is booked when the job ends unread', async () => {
      const plain = await before();
      await until(plain.w, at(plain.w, plain.id, 'post_editing', 'running'));
      const next = plain.w.jobs.get(plain.id).stats.peSent;
      assert.ok(next > 0);

      const { w, id } = await before();
      w.jobs.get(id).stats.submit = { ...STALE };
      await until(w, at(w, id, 'post_editing', 'running'));
      const cur = w.jobs.get(id);
      assert.deepEqual([w.kinds().post.length, cur.stats.resubmits, cur.stats.submit], [1, 1, undefined]);
      near(cur.stats.peSent, next * 2);
      await cancel(w.deps, id);
      near(w.db.ledger.find((r) => r.ref === 'unread').usd, next * 2);
    });

    it('is not created again when the budget holds one of them but not two', async () => {
      const plain = await before();
      await until(plain.w, at(plain.w, plain.id, 'post_editing', 'running'));
      const next = plain.w.jobs.get(plain.id).stats.peSent;

      // Room for one and a half batches of second attempts.
      const tight = (w, id) => { w.jobs.get(id).spent_usd = budgetOf(w.jobs.get(id)) - next * 1.5; };
      const a = await before();
      tight(a.w, a.id);
      await until(a.w, ended(a.w, a.id));
      assert.equal(a.w.kinds().post.length, 1, 'without the doubt there is room for the batch');
      assert.equal(a.w.jobs.get(a.id).stats.capped, undefined);

      const b = await before();
      tight(b.w, b.id);
      b.w.jobs.get(b.id).stats.submit = { ...STALE };
      await until(b.w, () => b.w.jobs.get(b.id).status !== 'post_editing');
      const cur = b.w.jobs.get(b.id);
      assert.equal(b.w.kinds().post.length, 0);
      assert.deepEqual([cur.status, cur.stats.capped.reason, cur.stats.capped.texts, cur.stats.submit], ['publishing', 'job_budget', 60, undefined]);
      near(cur.stats.peSent, next, 'the one that may exist is still counted');
      await until(b.w, ended(b.w, b.id));
      assert.equal(b.w.jobs.get(b.id).status, 'published', b.w.jobs.get(b.id).error);
    });
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
