import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignal } from './_webhook.ts';

test('recommended flat body', () => {
  const s = parseSignal({ issue_id: 'abc-1', title: 'TypeError: x', kind: 'error_tracking_issue_reopened', url: 'https://eu.posthog.com/project/1/error_tracking/abc-1' });
  assert.deepEqual(s, { issueId: 'abc-1', title: 'TypeError: x', kind: 'reopened', url: 'https://eu.posthog.com/project/1/error_tracking/abc-1' });
});

test('default nested event shape', () => {
  const s = parseSignal({ event: { properties: { $exception_issue_id: 'i9', $exception_types: 'RangeError', $exception_values: 'bad' } } });
  assert.equal(s!.issueId, 'i9');
  assert.equal(s!.title, 'RangeError: bad');
  assert.equal(s!.kind, 'created');
});

test('rejects junk, unrendered placeholders and foreign urls', () => {
  assert.equal(parseSignal(null), null);
  assert.equal(parseSignal({}), null);
  assert.equal(parseSignal({ issue_id: '{event.properties.$exception_issue_id}' }), null);
  assert.equal(parseSignal({ issue_id: '1', url: 'https://evil.example/x' })!.url, null);
});
