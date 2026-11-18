// Tests for upgrade.ts (#369): the serve-time widening of the engine's
// document-pin block list, so a page from an older donor takes notes on mock
// parts too.
//   node --test supabase/functions/concept-page/upgrade.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upgradeEngine } from './upgrade.ts';

test('widens the pre-#354 block list to take [data-pin] parts', () => {
  const html = "<script>(function wireDocumentPins() {\n  const BLOCK = 'p, li, tr';\n})();</script>";
  assert.equal(upgradeEngine(html), "<script>(function wireDocumentPins() {\n  const BLOCK = 'p, li, tr, [data-pin]';\n})();</script>");
});

test('leaves a page that already has [data-pin] (or no engine) untouched', () => {
  const current = "const BLOCK = 'p, li, tr, [data-pin]';";
  assert.equal(upgradeEngine(current), current);
  assert.equal(upgradeEngine('<html><body>no engine</body></html>'), '<html><body>no engine</body></html>');
  // The analysis list and any other look-alike stay as they are.
  const ana = "const ANA_BLOCK = 'p, li, tr, h2, h3, h4, label';";
  assert.equal(upgradeEngine(ana), ana);
});
