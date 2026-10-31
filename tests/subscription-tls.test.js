import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { key, cert } from './fixtures/localhost-tls.js';
import { X509Certificate } from 'node:crypto';
import fs from 'node:fs/promises';
const { subscriptionCertificateDecision, createSubscriptionRequest } = createRequire(import.meta.url)('../desktop/subscription-tls.cjs');
const validTime = Date.parse('2030-01-01T00:00:00Z');
const request = { hostname: 'localhost', errorCode: -202, certificate: { data: cert } };
test('subscription-only policy accepts a valid self-signed authority without per-source confirmation', () => {
  assert.equal(subscriptionCertificateDecision(request, validTime), 0);
  assert.equal(subscriptionCertificateDecision({ ...request, hostname: 'LOCALHOST.' }, validTime), 0);
});
test('expired, not-yet-valid, wrong-host and other TLS failures are not bypassed', () => {
  for (const errorCode of [0, -200, -201, -203, -206, undefined]) assert.equal(subscriptionCertificateDecision({ ...request, errorCode }, validTime), -3);
  assert.equal(subscriptionCertificateDecision({ ...request, hostname: 'other.example' }, validTime), -3);
  assert.equal(subscriptionCertificateDecision({ ...request, hostname: '127.0.0.1' }, validTime), -3, 'DNS localhost must not be mistaken for a certificate IP SAN');
  const parsed = new X509Certificate(cert);
  assert.equal(subscriptionCertificateDecision(request, Date.parse(parsed.validFrom) - 1), -3);
  assert.equal(subscriptionCertificateDecision(request, Date.parse(parsed.validTo) + 1), -3);
  assert.equal(subscriptionCertificateDecision({ ...request, certificate: { data: key } }, validTime), -3);
  assert.equal(subscriptionCertificateDecision({ ...request, certificate: null }, validTime), -3);
});
test('custom trust is installed only on an ephemeral subscription session, never defaultSession', async () => {
  let verifier, chosen, called, defaultTouched = false;
  const sessionApi = { get defaultSession() { defaultTouched = true; throw new Error('Default session must not be modified'); }, fromPartition(name, options) { chosen = { name, options }; return { setCertificateVerifyProc(fn) { verifier = fn; }, async fetch(url, options) { called = { url, options }; return 'response'; } }; } };
  const fetch = createSubscriptionRequest(sessionApi);
  assert.equal(defaultTouched, false); assert.equal(chosen.name.startsWith('persist:'), false); assert.equal(chosen.options.cache, false);
  let decision; verifier({ ...request, errorCode: 0 }, value => decision = value); assert.equal(decision, -3);
  const signal = new AbortController().signal;
  assert.equal(await fetch(new URL('https://example.invalid/sub'), { redirect: 'manual', signal }), 'response');
  assert.equal(called.options.credentials, 'omit'); assert.equal(called.options.redirect, 'manual'); assert.equal(called.options.signal, signal);
  const source = await fs.readFile('desktop/subscription-fetch.cjs', 'utf8');
  assert.ok(source.includes('createSubscriptionRequest')); assert.equal(source.includes('defaultSession'), false);
  assert.equal(source.includes('NODE_TLS_REJECT_UNAUTHORIZED'), false); assert.equal(source.includes('rejectUnauthorized: false'), false);
});
