import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, parseLink } from '../shared/proxy.js';
import { nodeCounts, visibleNodeItems, removeSubscription } from '../shared/node-manager.js';
import { sourceGroups, sourceScope, nodeSourceGroup, prepareManualLinks, selectedSource } from '../src/source-groups.js';
const link = 'vless://11111111-2222-4333-8444-555555555555@node.example:443?security=tls&sni=site.example&type=ws&path=%2Froute#Same-name';
function state() {
  const s = defaultState();
  s.subscriptions = [{ id: 'subscription-1', name: 'Same-name', url: 'https://private.example/sub?token=do-not-expose' }];
  s.nodes = [{ ...parseLink(link), subscriptionId: 'subscription-1' }, parseLink(link), parseLink(link)];
  s.selectedNodeId = s.nodes[1].id;
  return s;
}
test('one subscription and two identical manual nodes are three independent visible sources', () => {
  const s = state(), groups = sourceGroups(s);
  assert.equal(groups.length, 3); assert.equal(new Set(groups.map(g => g.id)).size, 3);
  assert.deepEqual(groups.map(g => g.kind), ['subscription', 'node', 'node']);
  assert.notEqual(groups[1].identifier, groups[2].identifier);
  assert.deepEqual(s.nodes[1].outbound, s.nodes[2].outbound, 'same effective endpoint must not collapse source identity');
  assert.equal(sourceGroups(structuredClone(s))[1].id, groups[1].id, 'identity survives serialization/restart');
});
test('subscriptions with the same domain and title still remain independent sources', () => {
  const s = state();
  s.subscriptions.push({ id: 'subscription-2', name: s.subscriptions[0].name, url: 'https://private.example/sub?token=different-account' });
  s.nodes.push({ ...parseLink(link), subscriptionId: 'subscription-2' });
  const subscriptions = sourceGroups(s).filter(g => g.kind === 'subscription');
  assert.equal(subscriptions.length, 2); assert.notEqual(subscriptions[0].id, subscriptions[1].id);
  assert.notEqual(subscriptions[0].identifier, subscriptions[1].identifier);
});
test('individual source filters do not include another same-name/same-endpoint node', () => {
  const s = state(), scope = sourceScope(s, nodeSourceGroup(s.nodes[2].id));
  assert.deepEqual(nodeCounts(scope.state, scope.group), { available: 1, unsupported: 0, information: 0, total: 1 });
  assert.deepEqual(visibleNodeItems(scope.state, { group: scope.group }).map(n => n.id), [s.nodes[2].id]);
  assert.equal(s.selectedNodeId, s.nodes[1].id, 'viewing another source must not switch the connected node');
  assert.equal(s.nodes[2].subscriptionId, undefined, 'manual links must never acquire subscription certificate permissions');
});
test('selected source persists independently of connected node and scoped testing excludes every other source', () => {
  const s = state(); s.subscriptions.push({ id: 'subscription-2', name: 'Same-name' });
  const second = { ...parseLink(link), subscriptionId: 'subscription-2' }; s.nodes.push(second);
  const original = structuredClone(s);
  assert.equal(selectedSource(s, 'subscription-2'), 'subscription-2');
  assert.equal(selectedSource(s, null), nodeSourceGroup(s.nodes[1].id));
  const scope = sourceScope(s, selectedSource(s, 'subscription-2'));
  const testIds = visibleNodeItems(scope.state, { group: scope.group }).filter(n => !n.unsupported && !n.informational).map(n => n.id);
  assert.deepEqual(testIds, [second.id]); assert.deepEqual(s, original);
  assert.notEqual(selectedSource(s, 'deleted-source'), 'all');
  assert.equal(selectedSource({ ...s, nodes: [], selectedNodeId: null }, 'all'), 'subscription-1');
});
test('source summaries do not expose URLs, UUIDs or outbound credentials', () => {
  const text = JSON.stringify(sourceGroups(state()));
  assert.equal(text.includes('do-not-expose'), false); assert.equal(text.includes('11111111-2222-4333-8444-555555555555'), false);
  assert.equal(text.includes('outbound'), false); assert.equal(text.includes('private.example'), false);
});
test('removing a subscription never removes independent manual source entries', () => {
  const s = state(), next = removeSubscription(s, 'subscription-1');
  assert.equal(sourceGroups(next).length, 2); assert.equal(next.selectedNodeId, s.selectedNodeId);
  const stale = sourceScope(next, nodeSourceGroup('missing'));
  assert.equal(visibleNodeItems(stale.state, { group: stale.group }).length, 0);
});
test('optional node names alter only the display fragment, not transport or authentication', () => {
  const renamed = prepareManualLinks(link, ' 工作 #A ');
  assert.equal(parseLink(renamed).name, '工作 #A'); assert.deepEqual(parseLink(renamed).outbound, parseLink(link).outbound);
  assert.equal(prepareManualLinks(link, ''), link);
  const batch = prepareManualLinks(`${link}\n${link}`, 'Provider').split('\n');
  assert.deepEqual(batch.map(x => parseLink(x).name), ['Provider · 1', 'Provider · 2']);
  assert.deepEqual(parseLink(batch[0]).outbound, parseLink(batch[1]).outbound);
});
