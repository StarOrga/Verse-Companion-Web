import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findVersionProblems } from './check-migration-versions.mjs';

test('two files with the same version prefix are flagged together', () => {
  const r = findVersionProblems([
    '20261115030000_posthog_single_source.sql',
    '20261115030000_verse_comet_announced_only.sql',
    '20261115030100_posthog_guard.sql',
  ]);
  assert.deepEqual(r.duplicates, [
    { version: '20261115030000', files: ['20261115030000_posthog_single_source.sql', '20261115030000_verse_comet_announced_only.sql'] },
  ]);
  assert.deepEqual(r.malformed, []);
});

test('unique versions pass, legacy short prefixes included', () => {
  const r = findVersionProblems(['00001_init_schema.sql', '00002_storage.sql', '20261115050000_x.sql']);
  assert.deepEqual(r, { duplicates: [], malformed: [] });
});

test('a sql file without a numeric prefix is malformed; other files are ignored', () => {
  const r = findVersionProblems(['comet_fix.sql', 'README.md', '.gitkeep']);
  assert.deepEqual(r.malformed, ['comet_fix.sql']);
  assert.deepEqual(r.duplicates, []);
});
