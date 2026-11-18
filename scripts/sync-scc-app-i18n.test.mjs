import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncInto, validateExport } from './sync-scc-app-i18n.mjs';

const pack = (locale) => JSON.stringify({ schema: 'scc-app-i18n/1', locale, packVersion: '1', strings: { a: 'b' } });
const index = (...codes) => JSON.stringify({ schema: 'scc-app-i18n-index/1', locales: Object.fromEntries(codes.map((c) => [c, { keys: 1 }])) });

test('accepts packs whose locale matches the file name plus a matching index', () => {
  const v = validateExport({ 'de.json': pack('de'), 'pt-BR.json': pack('pt-BR'), 'index.json': index('de', 'pt-BR') });
  assert.equal(v.ok, true);
  assert.deepEqual(v.packs, ['de', 'pt-BR']);
});

test('refuses a wrong schema, a mismatched locale, a foreign file and a stale index', () => {
  assert.equal(validateExport({ 'de.json': JSON.stringify({ schema: 'x', locale: 'de', strings: {} }), 'index.json': index('de') }).ok, false);
  assert.equal(validateExport({ 'de.json': pack('en'), 'index.json': index('de') }).ok, false);
  assert.equal(validateExport({ 'de.json': pack('de'), 'notes.txt': 'hi', 'index.json': index('de') }).ok, false);
  assert.equal(validateExport({ 'de.json': pack('de'), 'index.json': index('de', 'fr') }).ok, false);
  assert.equal(validateExport({ 'de.json': '{', 'index.json': index('de') }).ok, false);
});

test('sync replaces the folder and drops packs that are no longer exported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scc-sync-test-'));
  writeFileSync(join(dir, 'fr.json'), pack('fr'));
  syncInto(dir, { 'de.json': pack('de'), 'index.json': index('de') });
  assert.deepEqual(readdirSync(dir).sort(), ['de.json', 'index.json']);
});

test('an invalid export writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scc-sync-test-'));
  writeFileSync(join(dir, 'fr.json'), pack('fr'));
  assert.throws(() => syncInto(dir, { 'de.json': pack('xx'), 'index.json': index('de') }));
  assert.deepEqual(readdirSync(dir), ['fr.json']);
});
