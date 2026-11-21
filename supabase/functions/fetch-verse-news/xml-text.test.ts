import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanXml } from './xml-text.ts';

test('decodes the basic entities', () => {
  assert.equal(cleanXml(' a &amp; b &quot;c&quot; &#39;d&#39; &lt;e&gt; '), `a & b "c" 'd' <e>`);
});
test('does not double-decode &amp;lt;', () => {
  assert.equal(cleanXml('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
});
test('unwraps CDATA', () => {
  assert.equal(cleanXml('<![CDATA[Fish & Chips]]>'), 'Fish & Chips');
});
