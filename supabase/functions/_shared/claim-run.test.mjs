// claimRun decides on the rpc answer only and fails closed. Runs under `node --test` (npm run test:functions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimRun, intervalOf } from './claim-run.ts';

// Models the SQL: one shared row per name, the first call inside the interval wins (single-statement semantics).
function fakeDb() {
  const last = new Map();
  let now = 1_000_000;
  const db = {
    advance(ms) { now += ms; },
    async rpc(_fn, args) {
      const ms = Number.parseInt(args.p_min_interval, 10) * 1000;
      const prev = last.get(args.p_name);
      if (prev !== undefined && prev > now - ms) return { data: false, error: null };
      last.set(args.p_name, now);
      return { data: true, error: null };
    },
  };
  return db;
}

test('N parallel callers: exactly one wins the claim', async () => {
  const db = fakeDb();
  const got = await Promise.all(Array.from({ length: 20 }, () => claimRun(db, 'sc-events-sync', 300_000)));
  assert.equal(got.filter(Boolean).length, 1);
});

test('the claim expires by time', async () => {
  const db = fakeDb();
  assert.equal(await claimRun(db, 'x', 60_000), true);
  assert.equal(await claimRun(db, 'x', 60_000), false);
  db.advance(61_000);
  assert.equal(await claimRun(db, 'x', 60_000), true);
});

test('names are independent', async () => {
  const db = fakeDb();
  assert.equal(await claimRun(db, 'a', 60_000), true);
  assert.equal(await claimRun(db, 'b', 60_000), true);
});

test('rpc error, throw or a non-boolean answer fails closed', async () => {
  assert.equal(await claimRun({ rpc: async () => ({ data: null, error: { message: 'PGRST202' } }) }, 'x', 1000), false);
  assert.equal(await claimRun({ rpc: async () => { throw new Error('network'); } }, 'x', 1000), false);
  assert.equal(await claimRun({ rpc: async () => ({ data: 'true', error: null }) }, 'x', 1000), false);
});

test('interval literal is whole seconds, at least 1', () => {
  assert.equal(intervalOf(300_000), '300 seconds');
  assert.equal(intervalOf(1), '1 seconds');
  assert.equal(intervalOf(1500), '2 seconds');
});
