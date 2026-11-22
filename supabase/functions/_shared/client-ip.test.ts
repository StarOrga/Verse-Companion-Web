import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from './client-ip.ts';

const req = (h: Record<string, string>) => new Request('https://x.test/', { headers: h });

test('prefers cf-connecting-ip', () => {
  assert.equal(clientIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 2.2.2.2' })), '1.1.1.1');
});
test('falls back to the last x-forwarded-for hop, not the forgeable first', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 2.2.2.2' })), '2.2.2.2');
});
test('unknown without headers', () => {
  assert.equal(clientIp(req({})), 'unknown');
});
