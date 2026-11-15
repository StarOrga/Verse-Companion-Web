import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  CATALOGUE_FILE,
  declaredNames,
  findRawCaptures,
  findTrackNames,
  validateCatalogue,
} from './check-analytics-events.mjs';
import { readFileSync } from 'node:fs';

const base = {
  EVENT_VERBS: ['add', 'sign_in', 'sign_out', 'open'],
  EVENT_AREAS: ['hangar', 'auth'],
  LEGACY_EVENT_NAMES: {},
};
const def = (area) => ({ area, desc: 'Eine Beschreibung des Events.' });

test('flags raw capture calls on analytics receivers and string literals', () => {
  assert.equal(findRawCaptures("this.analytics.capture('x', {})").length, 1);
  assert.equal(findRawCaptures("posthog.capture('x')").length, 1);
  assert.equal(findRawCaptures('this.analytics.captureVerse(\'a\', {})').length, 1);
  assert.equal(findRawCaptures("foo.capture(`x_${y}`)").length, 1);
});

test('lets unrelated capture() methods and comments through', () => {
  assert.equal(findRawCaptures('const f = await this.screenshots.capture();').length, 0);
  assert.equal(findRawCaptures("// analytics.capture('x')").length, 0);
  assert.equal(findRawCaptures("/* analytics.capture('x') */ track('a')").length, 0);
  assert.equal(findRawCaptures("this.analytics.track('auth:user_sign_out')").length, 0);
});

test('reports the line of a finding', () => {
  assert.equal(findRawCaptures("a\nb\nanalytics.capture('x')").at(0)?.line, 3);
});

test('reads track() names', () => {
  assert.deepEqual(findTrackNames("this.analytics.track('auth:user_sign_in', { provider })").map((t) => t.name), ['auth:user_sign_in']);
});

test('accepts a valid catalogue', () => {
  const EVENTS = { 'hangar:ship_add': def('hangar'), 'auth:user_sign_in': def('auth') };
  assert.deepEqual(validateCatalogue({ ...base, EVENTS }, Object.keys(EVENTS)), []);
});

test('rejects bad names, wrong category, missing verb, duplicates, missing desc and dangling legacy targets', () => {
  const EVENTS = {
    'hangar:shipAdd': def('hangar'),
    'hangar:ship_added': def('hangar'),
    'auth:ship_add': def('hangar'),
    'hangar:loadout_open': { area: 'hangar', desc: '' },
  };
  const problems = validateCatalogue(
    { ...base, EVENTS, LEGACY_EVENT_NAMES: { old: 'nope:thing_add' } },
    ['hangar:ship_add', 'hangar:ship_add'],
  );
  const text = problems.join('\n');
  assert.match(text, /duplicate catalogue name "hangar:ship_add"/);
  assert.match(text, /"hangar:shipAdd" is not category:object_action/);
  assert.match(text, /"hangar:ship_added" is not category:object_action/);
  assert.match(text, /"auth:ship_add": category "auth" differs from area "hangar"/);
  assert.match(text, /"hangar:loadout_open": missing description/);
  assert.match(text, /legacy "old" points to unknown/);
});

test('the real catalogue passes and has no duplicate keys', async () => {
  const catalogue = await import(pathToFileURL(CATALOGUE_FILE).href);
  const names = declaredNames(readFileSync(CATALOGUE_FILE, 'utf8'));
  assert.equal(names.length, Object.keys(catalogue.EVENTS).length);
  assert.deepEqual(validateCatalogue(catalogue, names), []);
});
