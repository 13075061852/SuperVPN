import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortedNodeCards, nodeIsUnavailable } from '../src/node-presentation.js';
const nodes = [
  { id: 'failed', name: '同名' }, { id: 'slow', name: '同名' },
  { id: 'new', name: '未测速' }, { id: 'fast', name: '最快' },
  { id: 'unsupported', unsupported: true }, { id: 'testing' }, { id: 'equal' }
];
const checks = { failed: { status: 'failed' }, slow: { status: 'ok', delayMs: 284 }, fast: { status: 'ok', delayMs: 50 }, testing: { status: 'testing' }, equal: { status: 'ok', delayMs: 50 } };
test('measured delays ascend, untested/testing follow and all unavailable nodes come last', () => {
  assert.deepEqual(sortedNodeCards(nodes, checks).map(n => n.id), ['fast', 'equal', 'slow', 'new', 'testing', 'failed', 'unsupported']);
  assert.deepEqual(nodes.map(n => n.id), ['failed', 'slow', 'new', 'fast', 'unsupported', 'testing', 'equal']);
});
test('new measurements automatically reorder nodes and a recovered node returns to the usable group', () => {
  const updated = { ...checks, failed: { status: 'ok', delayMs: 30 }, slow: { status: 'ok', delayMs: 10 } };
  assert.deepEqual(sortedNodeCards(nodes, updated).slice(0, 2).map(n => n.id), ['slow', 'failed']);
});
test('hide unavailable removes only proven failures and incompatible nodes, without deduplicating or mutating source data', () => {
  assert.deepEqual(sortedNodeCards(nodes, checks, true).map(n => n.id), ['fast', 'equal', 'slow', 'new', 'testing']);
  assert.equal(nodes.length, 7); assert.equal(nodeIsUnavailable(nodes[2], checks), false);
  assert.equal(nodeIsUnavailable(nodes[0], checks), true);
});
test('missing or invalid latency is never shown as a fabricated fastest result', () => {
  const data = [{ id: 'missing' }, { id: 'nan' }, { id: 'valid' }, { id: 'infinite' }];
  assert.deepEqual(sortedNodeCards(data, { missing: { status: 'ok' }, nan: { status: 'ok', delayMs: NaN }, valid: { status: 'ok', delayMs: 12 }, infinite: { status: 'ok', delayMs: Infinity } }).map(n => n.id), ['valid', 'missing', 'nan', 'infinite']);
  assert.deepEqual(sortedNodeCards([], undefined, true), []);
});
