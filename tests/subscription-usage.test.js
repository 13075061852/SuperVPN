import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseSubscriptionUsage, quotaProgress, quotaBytes } from '../shared/subscription-usage.js';
const { fetchSubscription } = createRequire(import.meta.url)('../desktop/subscription-fetch.cjs');
test('standard subscription-userinfo is interpreted as provider bytes, not local traffic', () => {
  const usage = parseSubscriptionUsage('upload=1024; download=2048; total=4096; expire=1800000000');
  assert.deepEqual(usage, { upload: 1024, download: 2048, total: 4096, expire: 1800000000 });
  assert.deepEqual(quotaProgress(usage), { used: 3072, total: 4096, remaining: 1024, percent: 75 });
  assert.equal(quotaBytes(1024 ** 3 * 1.5), '1.5 GB');
});
test('missing, malformed, overflowing, and duplicate quota values do not invent a percentage', () => {
  for (const text of [null, '', 'remaining=430.53GB', 'download=12; total=100', 'upload=-1;download=2;total=3', 'upload=1.5;download=2;total=3', 'upload=1;download=2;total=NaN', 'upload=9007199254740992;download=2;total=3', 'upload=1;Upload=2;download=2;total=3']) assert.equal(parseSubscriptionUsage(text), null);
  assert.equal(quotaProgress(null), null); assert.equal(quotaProgress({ upload: 1, download: 2, total: 0 }), null);
  assert.equal(quotaProgress({ upload: 1, download: -2, total: 100 }), null);
});
test('zero usage and over-quota totals retain actual usage and clamp only the visual bar', () => {
  assert.equal(quotaProgress({ upload: 0, download: 0, total: 100 }).percent, 0);
  assert.deepEqual(quotaProgress({ upload: 100, download: 20, total: 100 }), { used: 120, total: 100, remaining: 0, percent: 100 });
});
test('subscription fetching retains the real header along with the original body', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response('test-node-body', { headers: { 'subscription-userinfo': 'upload=1; download=2; total=10' } });
  try { assert.deepEqual(await fetchSubscription('https://example.invalid/sub?token=private'), { body: 'test-node-body', usage: { upload: 1, download: 2, total: 10 } }); }
  finally { globalThis.fetch = previous; }
});
test('provider-specific metadata request supplies real quota without replacing the text node body with YAML', async () => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(options.headers['User-Agent']);
    return calls.length === 1 ? new Response('original-node-links') : new Response('proxies: [yaml-not-imported]', { headers: { 'subscription-userinfo': 'upload=1;download=2;total=536870912000' } });
  };
  try {
    const result = await fetchSubscription('https://example.invalid/sub');
    assert.equal(result.body, 'original-node-links'); assert.equal(result.usage.total, 536870912000);
    assert.equal(calls.length, 2); assert.match(calls[1], /ClashMeta/);
  } finally { globalThis.fetch = previous; }
});
test('optional metadata failure never loses valid original nodes', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { if (++calls === 1) return new Response('original-nodes'); throw new Error('private token-bearing URL'); };
  try { assert.deepEqual(await fetchSubscription('https://example.invalid/sub'), { body: 'original-nodes', usage: null }); }
  finally { globalThis.fetch = previous; }
});
test('network errors are classified without exposing credential-bearing URLs', async () => {
  for (const [code, pattern] of [['ERR_CERT_AUTHORITY_INVALID', /证书/], ['ENOTFOUND', /域名解析/], ['ECONNREFUSED', /代理连接/], ['ETIMEDOUT', /超时/]]) {
    await assert.rejects(fetchSubscription('https://example.invalid/sub?token=private', { requestFetch: async () => { const error = new Error('private URL'); error.code = code; throw error; } }), e => pattern.test(e.message) && !e.message.includes('private'));
  }
});
test('missing headers stay unknown and unsafe redirects and token-bearing errors remain protected', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('body');
    assert.equal((await fetchSubscription('https://example.invalid/sub')).usage, null);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://unsafe.invalid' } });
    await assert.rejects(fetchSubscription('https://example.invalid/sub'), /拒绝不安全/);
    globalThis.fetch = async () => { throw new Error('request failed https://example.invalid/sub?token=private'); };
    await assert.rejects(fetchSubscription('https://example.invalid/sub?token=private'), error => !error.message.includes('private') && /获取失败/.test(error.message));
  } finally { globalThis.fetch = previous; }
});
