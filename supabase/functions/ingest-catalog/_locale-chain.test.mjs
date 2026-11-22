// node --test supabase/functions/ingest-catalog/_locale-chain.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOCALE_CHAIN_MAX_LANGS, orderLangs, parseLocaleChain } from './_locale-chain.ts';

const B = '27a182e3-14da-49ca-ba05-356c41e119b7';

describe('locale publish chain', () => {
  it('puts English first and keeps every language once', () => {
    assert.deepEqual(orderLangs(['de', 'it', 'en', 'de', 'pt-BR']), ['en', 'de', 'it', 'pt-BR']);
    assert.deepEqual(orderLangs(['de', 'it']), ['de', 'it']);
    assert.deepEqual(orderLangs([]), []);
  });

  it('reads the first step (no langs) and a later one', () => {
    assert.deepEqual(parseLocaleChain(B, undefined, undefined), { build_id: B, langs: null, done: [] });
    assert.deepEqual(parseLocaleChain(B, ['it', 'ja'], [{ lang: 'en', verified: true }, { lang: 'de', verified: false }]), {
      build_id: B, langs: ['it', 'ja'], done: [{ lang: 'en', verified: true }, { lang: 'de', verified: false }],
    });
  });

  it('refuses malformed bodies', () => {
    assert.equal(parseLocaleChain(B, 'de', null), null);
    assert.equal(parseLocaleChain(B, ['../x'], null), null);
    assert.equal(parseLocaleChain(B, null, [{ lang: 'de' }]), null);
    assert.equal(parseLocaleChain(B, null, [{ lang: 'de', verified: 'yes' }]), null);
    assert.equal(parseLocaleChain(B, Array(LOCALE_CHAIN_MAX_LANGS + 1).fill('de'), null), null);
  });
});
