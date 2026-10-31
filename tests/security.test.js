import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultState, parseLink, effectiveOutbound, createConfig } from '../shared/proxy.js';
import { setSubscriptionSecurity, replaceSubscription } from '../shared/node-manager.js';
import { parseSubscription } from '../shared/subscription.js';
const { classifyNetworkError } = createRequire(import.meta.url)('../electron/network-errors.cjs');
function fixture() {
  const state = defaultState();
  state.settings.honorImportedInsecure = false;
  const link = 'anytls://password@node.example:443?sni=example.com&insecure=1';
  state.nodes = [
    { ...parseLink(link), subscriptionId: 'a' },
    { ...parseLink(link.replace('&insecure=1', '')), subscriptionId: 'a' },
    { ...parseLink(link), subscriptionId: 'b' },
    parseLink(link)
  ];
  state.subscriptions = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]; state.selectedNodeId = state.nodes[0].id;
  return state;
}
test('insecure flag alone and imported TLS fields cannot silently disable verification', () => {
  const state = fixture();
  for (const node of state.nodes) { node.outbound.tls.insecure = true; assert.equal(effectiveOutbound(state, node).tls.insecure, undefined); }
  assert.equal(createConfig(state).outbounds[0].tls.insecure, undefined);
});
test('explicit confirmation is required and invalid subscription IDs are rejected', () => {
  const state = fixture();
  assert.throws(() => setSubscriptionSecurity(state, { subscriptionId: 'a', allowInsecure: true }), /确认/);
  assert.throws(() => setSubscriptionSecurity(state, { subscriptionId: 'a', allowInsecure: true, confirmed: 'true' }), /确认/);
  assert.throws(() => setSubscriptionSecurity(state, { subscriptionId: 'missing', allowInsecure: true, confirmed: true }), /不存在/);
});
test('compatibility only affects explicitly marked nodes in the consented subscription', () => {
  const original = fixture();
  const state = setSubscriptionSecurity(original, { subscriptionId: 'a', allowInsecure: true, confirmed: true });
  assert.equal(effectiveOutbound(state, state.nodes[0]).tls.insecure, true);
  for (const node of state.nodes.slice(1)) assert.equal(effectiveOutbound(state, node).tls.insecure, undefined);
  assert.equal(createConfig(state).outbounds[0].tls.insecure, true);
  assert.equal(original.subscriptions[0].allowInsecure, undefined);
});
test('disabling compatibility restores strict verification and only clears affected latency results', () => {
  let state = fixture(); state.nodeChecks = Object.fromEntries(state.nodes.map(n => [n.id, { status: 'ok', delayMs: 10 }]));
  state = setSubscriptionSecurity(state, { subscriptionId: 'a', allowInsecure: true, confirmed: true });
  assert.equal(state.nodeChecks[state.nodes[0].id], undefined);
  assert.equal(state.nodeChecks[state.nodes[2].id].status, 'ok');
  state = setSubscriptionSecurity(state, { subscriptionId: 'a', allowInsecure: false });
  assert.equal(effectiveOutbound(state, state.nodes[0]).tls.insecure, undefined);
});
test('refresh with the same subscription policy keeps scope, new subscriptions stay strict', () => {
  let state = setSubscriptionSecurity(fixture(), { subscriptionId: 'a', allowInsecure: true, confirmed: true });
  const parsed = parseSubscription('anytls://password@new.example:443?insecure=1');
  state = replaceSubscription(state, parsed, { ...state.subscriptions[0] });
  assert.equal(effectiveOutbound(state, state.nodes.find(n => n.subscriptionId === 'a')).tls.insecure, true);
  state = replaceSubscription(state, parsed, { id: 'c', name: 'C' });
  assert.equal(effectiveOutbound(state, state.nodes.find(n => n.subscriptionId === 'c')).tls.insecure, undefined);
});
test('authorized import policy follows explicit flags across accounts without inheriting source identities', () => {
  const state = fixture(); state.settings.honorImportedInsecure = true;
  assert.equal(effectiveOutbound(state, state.nodes[0]).tls.insecure, true);
  assert.equal(effectiveOutbound(state, state.nodes[1]).tls.insecure, undefined);
  assert.equal(effectiveOutbound(state, state.nodes[2]).tls.insecure, true);
  assert.equal(effectiveOutbound(state, state.nodes[3]).tls.insecure, true);
  assert.equal(state.subscriptions[0].id, 'a'); assert.equal(state.subscriptions[1].id, 'b');
  state.nodes[1].outbound.tls.insecure = true;
  assert.equal(effectiveOutbound(state, state.nodes[1]).tls.insecure, undefined);
});
test('manual strict override remains effective even when imported flags are followed automatically', () => {
  let state = fixture(); state.settings.honorImportedInsecure = true;
  state = setSubscriptionSecurity(state, { subscriptionId: 'b', allowInsecure: false });
  assert.equal(effectiveOutbound(state, state.nodes[2]).tls.insecure, undefined);
  assert.equal(effectiveOutbound(state, state.nodes[0]).tls.insecure, true);
  const parsed = parseSubscription('anytls://password@next.example:443?insecure=1');
  state = replaceSubscription(state, parsed, state.subscriptions.find(s => s.id === 'b'));
  assert.equal(effectiveOutbound(state, state.nodes.find(n => n.subscriptionId === 'b')).tls.insecure, undefined);
});
test('new imports follow original insecure flags under the user-authorized default policy', () => {
  const state = defaultState(), node = parseLink('anytls://password@host.example:443?insecure=1');
  assert.equal(effectiveOutbound(state, node).tls.insecure, true);
  assert.equal(node.outbound.tls.insecure, undefined);
  assert.equal(effectiveOutbound(state, parseLink('anytls://password@host.example:443')).tls.insecure, undefined);
});
test('network failures have distinct, credential-free messages', () => {
  const cases = [
    ['x509: certificate signed by unknown authority', 'tls_untrusted'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_untrusted'],
    ['x509: certificate has expired', 'tls_expired'],
    ['certificate is valid for a.example, not b.example', 'tls_name'],
    ['lookup failed: no such host', 'dns'],
    ['authentication failed password=secret', 'auth'],
    ['connect: connection refused', 'refused'],
    ['ECONNRESET', 'reset'],
    ['i/o timeout', 'timeout'],
    ['TLS_TARGET DEPTH_ZERO_SELF_SIGNED_CERT', 'target_tls']
  ];
  for (const [raw, code] of cases) {
    const result = classifyNetworkError(raw + ' token=private&password=secret');
    assert.equal(result.code, code); assert.equal(result.status, 'failed');
    assert.equal(JSON.stringify(result).includes('private'), false); assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});
