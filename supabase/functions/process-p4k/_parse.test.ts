import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHeader } from './_parse.ts';

const row = { size_bytes: 123, detected_channel: 'LIVE' };

test('real ZIP local header PK\x03\x04 is recognised and entries counted', () => {
  const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0x50, 0x4b, 0x03, 0x04]);
  const r = parseHeader(buf, row);
  assert.equal(r.magicOk, true);
  assert.equal(r.headerVersion, 20);
  assert.equal(r.estimatedEntries, 2);
});
test('garbage is flagged', () => {
  const r = parseHeader(new Uint8Array([1, 2, 3, 4, 5]), row);
  assert.equal(r.magicOk, false);
  assert.match(r.notes[0], /Unknown magic/);
});
test('works on a subarray view (non-zero byteOffset)', () => {
  const big = new Uint8Array([9, 9, 0x50, 0x4b, 0x03, 0x04, 45, 0]);
  assert.equal(parseHeader(big.subarray(2), row).headerVersion, 45);
});
