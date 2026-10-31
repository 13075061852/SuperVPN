import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeSections } from '../src/node-sections.js';
function fixture() { return {
  subscriptions: [{ id: 'sub-first', name: '订阅甲' }, { id: 'sub-second', name: '订阅乙' }],
  nodes: [{ id: 'slow', subscriptionId: 'sub-first' }, { id: 'manual' }, { id: 'fast', subscriptionId: 'sub-second' }, { id: 'faster', subscriptionId: 'sub-first' }],
  nodeChecks: { slow: { status: 'ok', delayMs: 90 }, fast: { status: 'ok', delayMs: 10 }, faster: { status: 'ok', delayMs: 40 }, manual: { status: 'ok', delayMs: 20 } }
}; }
test('subscription sections never interleave nodes by latency and manual imports remain separate', () => {
  const data = fixture(), original = structuredClone(data), sections = nodeSections(data, data.nodes);
  assert.deepEqual(sections.map(section => section.label), ['订阅甲', '订阅乙', '独立节点']);
  assert.deepEqual(sections.map(section => section.nodes.map(node => node.id)), [['faster', 'slow'], ['fast'], ['manual']]);
  assert.deepEqual(data, original);
});
test('identical subscription names retain distinct IDs and visibly distinguish their sections', () => {
  const data = fixture(); data.subscriptions[1].name = data.subscriptions[0].name;
  const sections = nodeSections(data, data.nodes);
  assert.notEqual(sections[0].label, sections[1].label); assert.equal(sections.length, 3);
});
test('source filtering and hide-unavailable preserve source identities, total counts and hidden sections', () => {
  const data = fixture(); data.nodeChecks.fast = { status: 'failed' };
  const sections = nodeSections(data, data.nodes, true);
  assert.equal(sections[1].total, 1); assert.equal(sections[1].nodes.length, 0);
  const scoped = nodeSections(data, data.nodes.filter(node => node.subscriptionId === 'sub-first'));
  assert.equal(scoped.length, 1); assert.equal(scoped[0].id, 'sub-first');
});
test('orphaned subscription records do not silently join manual nodes or other subscriptions', () => {
  const data = fixture(); data.nodes.push({ id: 'orphan', subscriptionId: 'missing' });
  const sections = nodeSections(data, data.nodes);
  assert.ok(sections.some(section => section.id === 'missing' && section.nodes[0].id === 'orphan'));
  assert.equal(sections.at(-1).id, 'manual');
});
