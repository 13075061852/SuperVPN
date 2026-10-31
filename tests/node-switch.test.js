import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { defaultState, parseLink } from '../shared/proxy.js';
import { createOptimisticNodeSwitch, displayedNodeId } from '../src/node-switch.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const fixture = () => ({ ...defaultState(), nodes: [{ ...parseLink('http://a.example:8080#First'), id: 'first', subscriptionId: 'source' }, { ...parseLink('http://b.example:8080#Second'), id: 'second', subscriptionId: 'source' }], subscriptions: [{ id: 'source', name: 'Example', updatedAt: 1 }], selectedNodeId: 'first', session: { connected: true } });
test('selection changes synchronously before IPC resolves and never falsifies saved or connected state', async () => {
  const data = fixture(), original = structuredClone(data), gate = deferred(), sequence = []; let pending;
  const select = createOptimisticNodeSwitch({ onPending: id => { pending = id; sequence.push(id); }, request: id => { sequence.push('request'); assert.equal(id, 'second'); return gate.promise; } });
  const work = select('second');
  assert.deepEqual(sequence, ['second', 'request']); assert.equal(displayedNodeId(data, pending), 'second'); assert.deepEqual(data, original);
  // Old selection and interim stop/poll broadcasts must not bounce the marker back.
  assert.equal(displayedNodeId({ ...data, session: { connected: false }, busy: true }, pending), 'second');
  gate.resolve('done'); assert.equal(await work, 'done'); assert.equal(pending, null);
  assert.equal(displayedNodeId({ ...data, selectedNodeId: 'second' }, pending), 'second');
});
test('rapid repeated clicks cannot enqueue extra reconnects; a later click works after completion', async () => {
  const gate = deferred(); let count = 0;
  const select = createOptimisticNodeSwitch({ onPending: () => {}, request: () => { count++; return gate.promise; } });
  const work = select('second'); assert.equal(await select('first'), null); assert.equal(await select('second'), null); assert.equal(count, 1);
  gate.resolve(true); await work; await select('first'); assert.equal(count, 2);
});
test('failed or rejected switches release optimistic selection and restore authoritative state', async () => {
  for (const mode of ['reject', 'handled']) {
    const data = fixture(), gate = deferred(); let pending;
    const select = createOptimisticNodeSwitch({ onPending: id => pending = id, request: () => gate.promise });
    const work = select('second');
    if (mode === 'reject') { gate.reject(new Error('switch failed')); await assert.rejects(work, /switch failed/); }
    else { gate.resolve(null); assert.equal(await work, null); }
    assert.equal(pending, null); assert.equal(displayedNodeId(data, pending), 'first'); assert.equal(data.session.connected, true);
  }
});
test('removed or unsupported pending nodes are never rendered as selected', () => {
  const data = fixture(); assert.equal(displayedNodeId(data, 'missing'), 'first');
  data.nodes[1].unsupported = true; assert.equal(displayedNodeId(data, 'second'), 'first');
});
let vite, cache, NodeManager;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-node-switch-ui-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  NodeManager = (await vite.ssrLoadModule('/src/NodeManager.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('node cards immediately highlight pending target without reporting the connection as complete', async () => {
  const html = renderToStaticMarkup(React.createElement(NodeManager, { data: fixture(), pendingNodeId: 'second', busy: true, onAction: () => {} }));
  assert.match(html, /aria-label="选择 Second" aria-pressed="true" aria-busy="true"/);
  assert.match(html, /aria-label="选择 First" aria-pressed="false"/);
  assert.ok(html.includes('正在切换')); assert.equal((html.match(/node-tile is-selected/g) || []).length, 1);
  const app = await fs.readFile('src/main.jsx', 'utf8');
  assert.ok(app.includes('pendingNodeId={pendingNodeId}'));
  assert.ok(app.includes("method === 'selectNode' ? nodeSwitch.current(payload)"));
  assert.ok(app.includes("const actual = await bridge.call('get')"));
  assert.equal(app.includes('selectedNodeId: pendingNodeId'), false, 'dashboard must not receive optimistic network state');
});
