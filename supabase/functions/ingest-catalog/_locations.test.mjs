// node --test supabase/functions/ingest-catalog/_locations.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LOCATION_SOURCE, MAX_LOCATION_ROWS, parseLocations } from './_locations.ts';
import { CLEAR_OP_TABLES, CLONE_TABLES } from './_rebuild.ts';

const B = '00000000-0000-0000-0000-000000000001';
const LICENSE = 'Star Citizen game data (c) Cloud Imperium Games';
const body = {
  id: 'Stanton1_Lorville',
  name: 'Lorville',
  type: 'landing-zone',
  system_code: 'STANTON',
  parent_id: 'Stanton1',
  frame: 'body',
  pos_x: 10.5,
  pos_y: -20,
  pos_z: 30,
  aliases: [],
  attributes: { hidden: false, size: 400 },
  source: 'something-else',
  license: LICENSE,
  extra: 'never reaches the table',
};

describe('parseLocations', () => {
  it('maps an extractor body to a pinned codex_locations row', () => {
    const [row] = parseLocations([body], B);
    assert.equal(row.build_id, B);
    assert.equal(row.id, 'Stanton1_Lorville');
    assert.equal(row.frame, 'body');
    assert.deepEqual([row.pos_x, row.pos_y, row.pos_z], [10.5, -20, 30]);
    assert.equal(row.parent_id, 'Stanton1');
    assert.deepEqual(row.attributes, { hidden: false, size: 400 });
    assert.equal(row.license, LICENSE);
    assert.equal(row.extra, undefined);
  });

  it('stamps the source itself, whatever the body claims', () => {
    assert.equal(parseLocations([body], B)[0].source, LOCATION_SOURCE);
    assert.equal(LOCATION_SOURCE, 'data-uploader');
  });

  it('keeps a hostless place without coordinates', () => {
    const [row] = parseLocations([{ ...body, frame: null, pos_x: null, pos_y: null, pos_z: null, parent_id: null }], B);
    assert.deepEqual([row.frame, row.pos_x, row.pos_y, row.pos_z, row.parent_id], [null, null, null, null, null]);
  });

  it('never breaks the position check: a half position becomes no position', () => {
    const [a] = parseLocations([{ ...body, pos_z: null }], B);
    const [b] = parseLocations([{ ...body, frame: 'galaxy' }], B);
    const [c] = parseLocations([{ ...body, pos_x: Infinity }], B);
    for (const r of [a, b, c]) assert.deepEqual([r.frame, r.pos_x, r.pos_y, r.pos_z], [null, null, null, null]);
  });

  it('drops bodies without a usable id, name, type, system or licence', () => {
    const bad = [
      { ...body, id: '' }, { ...body, id: 'has space' }, { ...body, name: '  ' }, { ...body, type: null },
      { ...body, system_code: undefined }, { ...body, license: '' }, null, 'x', [],
    ];
    assert.deepEqual(parseLocations(bad, B), []);
    assert.deepEqual(parseLocations('nope', B), []);
  });

  it('is one row per id, so sending the same build twice never grows the table', () => {
    const once = parseLocations([body, { ...body, id: 'Other' }], B);
    const twice = parseLocations([body, { ...body, id: 'Other' }, body, { ...body, id: 'Other' }], B);
    assert.equal(once.length, 2);
    assert.deepEqual(twice, once);
    assert.equal(parseLocations([body, { ...body, name: 'Lorville 2' }], B)[0].name, 'Lorville 2');
  });

  it('tolerates a missing attributes / aliases field', () => {
    const [row] = parseLocations([{ ...body, attributes: null, aliases: ['Lor', 3, ''] }], B);
    assert.deepEqual(row.attributes, {});
    assert.deepEqual(row.aliases, ['Lor']);
  });
});

describe('replace per build', () => {
  it('clear_locations is recorded as a write of codex_locations, a table finalize clones', () => {
    assert.equal(CLEAR_OP_TABLES.clear_locations, 'codex_locations');
    assert.ok(CLONE_TABLES.includes('codex_locations'));
  });

  const noRead = typeof Deno !== 'undefined';
  it('the ops upsert on (build_id, id), not on the entity natural key', { skip: noRead }, () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf-8');
    assert.match(src, /from\('codex_locations'\)\.upsert\(rows, \{ onConflict: 'build_id,id' \}\)/);
    assert.match(src, /from\('codex_locations'\)\.delete\(\)\.eq\('build_id', buildId\)/);
    assert.ok(MAX_LOCATION_ROWS >= 1000);
  });
});
