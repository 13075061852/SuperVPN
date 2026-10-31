import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, parseLink } from '../shared/proxy.js';
import { parseSubscription } from '../shared/subscription.js';
import { replaceSubscription, removeSubscription, legacyCandidateIds, nodeCounts, visibleNodeItems, normalizeNodeState } from '../shared/node-manager.js';
const subscription = { id: 'sub-1', url: 'https://subscription.example/subscribe?token=private', name: '测试订阅', updatedAt: 1 };
function parsed() { return parseSubscription([
  ...Array.from({ length: 25 }, (_, i) => `anytls://password@node${i}.example:443#香港-${i}`),
  ...Array.from({ length: 7 }, (_, i) => `hy2://password@hy${i}.example:443#日本-${i}`),
  ...Array.from({ length: 3 }, (_, i) => `vless://11111111-2222-4333-8444-555555555555@vl${i}.example:443?security=tls&ech=https%3A%2F%2Fdns.example%2Bech.example#VLESS-${i}`)
].join('\n')); }
test('35 subscription entries are visible: 32 selectable, 3 disabled with reasons', () => {
  const s = replaceSubscription(defaultState(), parsed(), subscription);
  assert.deepEqual(nodeCounts(s), { total: 35, available: 32, unsupported: 3, information: 0 });
  const all = visibleNodeItems(s, { group: 'sub-1' });
  assert.equal(all.length, 35); assert.equal(all.filter(n => n.unsupported).length, 3);
  assert.equal(s.subscriptions[0].total, 35);
  assert.ok(s.selectedNodeId); assert.equal(s.nodes[0].id, s.selectedNodeId);
  assert.equal(s.unsupportedNodes[0].reason, 'ECH 扩展不兼容');
  assert.equal(JSON.stringify(s.unsupportedNodes).includes('password'), false);
});
test('subscription refresh replaces nodes and preserves selected server by identity', () => {
  let s = replaceSubscription(defaultState(), parsed(), subscription);
  s.selectedNodeId = s.nodes[4].id; const previous = s.selectedNodeId;
  s = replaceSubscription(s, parsed(), subscription);
  assert.equal(s.nodes.length, 32); assert.equal(s.unsupportedNodes.length, 3);
  assert.notEqual(s.selectedNodeId, previous); assert.equal(s.nodes[4].id, s.selectedNodeId);
});
test('manual, subscription, search, name sorting and measured delay sorting', () => {
  let s = replaceSubscription(defaultState(), parsed(), subscription);
  const manual = parseLink('socks5://127.0.0.1:1080#Local'); s.nodes.push(manual);
  assert.equal(visibleNodeItems(s, { group: 'manual' }).length, 1);
  assert.equal(visibleNodeItems(s, { group: 'sub-1', query: '日本' }).length, 7);
  assert.equal(visibleNodeItems(s, { query: 'VLESS' }).length, 3);
  s.nodeChecks = { [s.nodes[0].id]: { status: 'ok', delayMs: 200 }, [s.nodes[1].id]: { status: 'ok', delayMs: 40 } };
  assert.equal(visibleNodeItems(s, { sort: 'latency' })[0].id, s.nodes[1].id);
});
test('removing a subscription preserves manual nodes and repairs selection', () => {
  let s = replaceSubscription(defaultState(), parsed(), subscription);
  const manual = parseLink('http://127.0.0.1:8080'); s.nodes.push(manual);
  s = removeSubscription(s, 'sub-1');
  assert.equal(s.nodes.length, 1); assert.equal(s.nodes[0].id, manual.id);
  assert.equal(s.selectedNodeId, manual.id); assert.equal(s.subscriptions.length, 0); assert.equal(s.unsupportedNodes.length, 0);
});
test('plan information is visible but never selected or probed as a server', () => {
  const p = parseSubscription('anytls://secret@info.example:443#剩余流量：432GB\nanytls://secret@real.example:443#日本线路');
  assert.equal(p.nodes.length, 1); assert.equal(p.information.length, 1); assert.equal(p.skipped, 0);
  const s = replaceSubscription(defaultState(), p, subscription);
  assert.deepEqual(nodeCounts(s), { total: 2, available: 1, unsupported: 0, information: 1 });
  assert.equal(s.nodes.find(n => n.id === s.selectedNodeId).name, '日本线路');
  assert.equal(visibleNodeItems(s).filter(n => n.informational).length, 1);
  assert.equal(JSON.stringify(s.informationNodes).includes('secret'), false);
  const legacy = { ...s, nodes: [{ ...parseLink('anytls://pass@info.example:443#套餐到期：2027'), subscriptionId: 'sub-1' }, ...s.nodes] };
  legacy.selectedNodeId = legacy.nodes[0].id;
  const migrated = normalizeNodeState(legacy);
  assert.equal(migrated.nodes.length, 1); assert.equal(migrated.nodes[0].id, migrated.selectedNodeId);
});
test('legacy HTTPS placeholders are identified, never silently deleted', () => {
  const s = defaultState(), wrong = parseLink('https://subscription.example:443');
  s.nodes = [wrong]; s.selectedNodeId = wrong.id;
  const next = replaceSubscription(s, parsed(), subscription);
  assert.deepEqual(legacyCandidateIds(next, subscription), [wrong.id]);
  assert.equal(next.nodes.length, 33); assert.ok(next.nodes.some(n => n.id === wrong.id));
  assert.deepEqual(legacyCandidateIds(next, { url: 'https://other.example/sub' }), []);
});
