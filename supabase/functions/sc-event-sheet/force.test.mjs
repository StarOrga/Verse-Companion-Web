// `force` is honoured only for a privileged caller. Runs under `node --test` (npm run test:functions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveForce } from './_force.ts';

test('force is honoured for a privileged caller', () => {
  assert.equal(effectiveForce(true, true), true);
});

test('force is dropped for an unprivileged caller', () => {
  assert.equal(effectiveForce(true, false), false);
});

test('only a literal true counts as force', () => {
  for (const v of [undefined, null, false, 'true', 1, {}]) assert.equal(effectiveForce(v, true), false);
});
