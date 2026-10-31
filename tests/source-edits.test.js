import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, parseLink } from '../shared/proxy.js';
import { editNode, renameSubscription } from '../shared/source-edits.js';
function fixture() {
  const node = { ...parseLink('trojan://secret@origin.example:443?security=tls&sni=cert.example#original'), subscriptionId: 's1' };
  return { ...defaultState(), nodes: [node], subscriptions: [{ id: 's1', name: 'old', url: 'https://example.invalid/private', allowInsecure: true }], selectedNodeId: node.id, nodeChecks: { [node.id]: { status: 'ok', delayMs: 45 } } };
}
test('renaming a connected node preserves its identity, source, credentials and measurements', () => {
  const state = fixture(), original = structuredClone(state), node = state.nodes[0];
  const result = editNode(state, { id: node.id, name: 'new' }, { connected: true });
  assert.equal(result.connectionChanged, false); assert.equal(result.state.nodes[0].name, 'new');
  assert.equal(result.state.nodes[0].subscriptionId, 's1'); assert.equal(result.state.selectedNodeId, node.id);
  assert.deepEqual(result.state.nodes[0].outbound, node.outbound); assert.deepEqual(result.state.nodeChecks, state.nodeChecks); assert.deepEqual(state, original);
});
test('endpoint editing clears stale latency but does not replace TLS SNI or authentication', () => {
  const state = fixture(), node = state.nodes[0];
  const result = editNode(state, { id: node.id, name: node.name, host: 'next.example', port: 8443 });
  const updated = result.state.nodes[0]; assert.equal(updated.host, 'next.example'); assert.equal(updated.outbound.server, 'next.example'); assert.equal(updated.outbound.server_port, 8443);
  assert.equal(updated.outbound.tls.server_name, 'cert.example'); assert.equal(updated.outbound.password, 'secret'); assert.equal(result.state.nodeChecks[node.id], undefined);
  assert.throws(() => editNode(state, { id: node.id, name: node.name, port: 8443 }, { connected: true }), /断开/);
  assert.throws(() => editNode(state, { id: node.id, name: 'new' }, { testing: true }), /停止测速/);
});
test('full replacement reparses protocol parameters and cannot adopt payload identity or policy', () => {
  const state = fixture(), node = state.nodes[0];
  const result = editNode(state, { id: node.id, name: 'changed', link: 'socks5://user:password@next.example:1080', subscriptionId: 'other', allowInsecure: true });
  const updated = result.state.nodes[0]; assert.equal(updated.id, node.id); assert.equal(updated.subscriptionId, 's1'); assert.equal(updated.protocol, 'SOCKS5'); assert.equal(updated.outbound.password, 'password'); assert.equal(updated.name, 'changed'); assert.equal(updated.allowInsecure, undefined);
  assert.equal(result.state.subscriptions[0].allowInsecure, true);
});
test('invalid names, links, hosts, ports and missing records are rejected without mutation', () => {
  const state = fixture(), node = state.nodes[0], original = structuredClone(state), base = { id: node.id, name: node.name };
  for (const patch of [{ name: '' }, { name: 'a\nb' }, { name: 'a'.repeat(121) }, { host: 'host/path' }, { host: 'user@host' }, { host: 'host:80' }, { host: '[host' }, { port: 0 }, { port: 65536 }, { port: 1.5 }, { link: 'invalid' }, { id: 'missing' }]) assert.throws(() => editNode(state, { ...base, ...patch }));
  assert.deepEqual(state, original);
});
test('IPv6 endpoint edits are validated and normalized', () => {
  const state = fixture(), node = state.nodes[0];
  assert.equal(editNode(state, { id: node.id, name: node.name, host: '[2001:db8::1]' }).state.nodes[0].host, '2001:db8::1');
});
test('subscription rename does not merge identical sources or lose URLs and security consent', () => {
  const state = fixture(); state.subscriptions.push({ ...state.subscriptions[0], id: 's2' });
  const result = renameSubscription(state, 's1', 'renamed'); assert.equal(result.subscriptions.length, 2);
  assert.equal(result.subscriptions[0].name, 'renamed'); assert.equal(result.subscriptions[1].name, 'old');
  assert.equal(result.subscriptions[0].url, state.subscriptions[0].url); assert.equal(result.subscriptions[0].allowInsecure, true);
  assert.throws(() => renameSubscription(state, 'missing', 'new'));
});
