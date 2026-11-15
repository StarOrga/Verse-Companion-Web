import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findMaps, stripMaps, rehashNgsw, cliArgs } from './posthog-sourcemaps.mjs';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'phsm-'));
  mkdirSync(path.join(dir, 'sub'));
  writeFileSync(path.join(dir, 'main.js'), 'a');
  writeFileSync(path.join(dir, 'main.js.map'), '{}');
  writeFileSync(path.join(dir, 'sub', 'x.js.map'), '{}');
  writeFileSync(path.join(dir, 'ngsw.json'), JSON.stringify({ hashTable: { '/main.js': sha1('a'), '/gone.js': 'x' } }));
  return dir;
}

test('stripMaps removes every .map and nothing else', () => {
  const dir = fixture();
  assert.equal(findMaps(dir).length, 2);
  assert.equal(stripMaps(dir), 2);
  assert.equal(existsSync(path.join(dir, 'main.js')), true);
  assert.equal(findMaps(dir).length, 0);
});

test('rehashNgsw patches only changed files', () => {
  const dir = fixture();
  assert.deepEqual(rehashNgsw(dir), []);
  writeFileSync(path.join(dir, 'main.js'), 'a//# chunkId=1');
  assert.deepEqual(rehashNgsw(dir), ['/main.js']);
  const t = JSON.parse(readFileSync(path.join(dir, 'ngsw.json'), 'utf8')).hashTable;
  assert.equal(t['/main.js'], sha1('a//# chunkId=1'));
  assert.equal(t['/gone.js'], 'x');
});

test('cliArgs sets release and the EU host', () => {
  const a = cliArgs('1.2.3', '/d');
  assert.deepEqual(a.upload.slice(0, 4), ['--host', 'https://eu.posthog.com', 'sourcemap', 'upload']);
  assert.ok(a.inject.includes('1.2.3'));
});
