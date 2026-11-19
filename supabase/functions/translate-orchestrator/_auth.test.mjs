// Key classification of translate-orchestrator. Runs under `node --test` (npm run test:functions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyToken } from './_auth.ts';
import { safeEqual } from '../_shared/safe-equal.ts';

const SERVICE = 'service-key-value';
const ANON = 'anon-key-value';

test('service key may do every op', () => {
  for (const op of ['tick', 'sync_sources', 'approve', 'start_full']) assert.equal(classifyToken(SERVICE, op, SERVICE, ANON), 'service');
});

test('public keys only reach tick and sync_sources', () => {
  assert.equal(classifyToken(ANON, 'tick', SERVICE, ANON), 'public');
  assert.equal(classifyToken('sb_publishable_abc', 'sync_sources', SERVICE, ANON), 'public');
  assert.equal(classifyToken(ANON, 'approve', SERVICE, ANON), null);
  assert.equal(classifyToken('sb_publishable_abc', 'import_seed', SERVICE, ANON), null);
});

test('empty token, empty server keys and unknown tokens are not callers', () => {
  assert.equal(classifyToken('', 'tick', SERVICE, ANON), null);
  assert.equal(classifyToken('', 'tick', '', ''), null);
  assert.equal(classifyToken('some.user.jwt', 'tick', SERVICE, ANON), null);
});

test('safeEqual compares whole strings', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});

test('a forged service_role JWT is not the service key', () => {
  const forged = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.sig';
  assert.equal(safeEqual(forged, SERVICE), false);
  assert.equal(classifyToken(forged, 'tick', SERVICE, ANON), null);
});
