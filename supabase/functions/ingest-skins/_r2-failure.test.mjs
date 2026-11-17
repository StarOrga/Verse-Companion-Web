// node --test supabase/functions/ingest-skins/_r2-failure.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DbError, r2Failure } from './_r2-failure.ts';

const CORS = { 'Access-Control-Allow-Origin': '*' };

describe('r2Failure', () => {
  it('answers an R2 failure with 503, transient and Retry-After', async () => {
    const res = r2Failure('commit_failed', new Error('R2 list ship-skins/x failed: HTTP 502'), CORS);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '2');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await res.json(), {
      error: 'commit_failed',
      transient: true,
      message: 'R2 list ship-skins/x failed: HTTP 502',
    });
  });

  it('treats a network error (fetch TypeError) as transient too', async () => {
    const res = r2Failure('prune_failed', new TypeError('fetch failed'), CORS);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).transient, true);
  });

  it('keeps a database error a 500 without the transient flag', async () => {
    const res = r2Failure('prune_failed', new DbError('permission denied'), CORS);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('retry-after'), null);
    assert.deepEqual(await res.json(), { error: 'prune_failed', message: 'permission denied' });
  });

  it('carries the path when given', async () => {
    const res = r2Failure('sign_failed', new Error('boom'), CORS, 'SHIP/a.glb');
    assert.equal((await res.json()).path, 'SHIP/a.glb');
  });
});
