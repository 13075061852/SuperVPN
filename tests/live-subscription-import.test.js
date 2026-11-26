import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
import * as nodeManager from '../shared/node-manager.js';
import * as subscriptionApi from '../shared/subscription.js';
const main = await fs.readFile('electron/main.cjs', 'utf8');
const importFunction = main.slice(main.indexOf('async function importSubscription('), main.indexOf('async function handle('));
function fixture({ manual = false, selected = 'active', save = async () => {}, fetch } = {}) {
  const active = { ...parseLink(manual ? 'https://new.example:8444' : 'http://current.example:8080'), id: 'active', ...(manual ? {} : { subscriptionId: 'current' }) };
  const other = { ...parseLink('http://other.example:8080'), id: 'other', subscriptionId: 'other-source' };
  const state = { ...defaultState(), nodes: [active, other], selectedNodeId: selected, subscriptions: [{ id: 'current', name: 'Current', url: 'https://current.example/sub' }, { id: 'other-source', name: 'Other', url: 'https://other.example/sub' }], nodeChecks: { active: { status: 'ok', delayMs: 31 }, other: { status: 'ok', delayMs: 40 } } };
  const session = { connected: true, nodeId: 'active', subscriptionId: manual ? null : 'current', startedAt: 1000, upload: 500, download: 1000 };
  let fetches = 0, saves = 0, ids = 0;
  const context = { state, session, nodeManager, subscriptionApi, api: { parseLink }, errorText: error => error.message, URL, Date,
    randomBytes: () => ({ toString: () => ++ids === 1 ? 'new-source' : `new-source-${ids}` }), importReport: null,
    fetchSubscription: async url => { fetches++; return fetch ? fetch(context, url) : { body: 'http://new.example:9090#Imported', usage: null }; },
    save: async () => { saves++; await save(); }, log: () => {}, start: () => assert.fail('Import must not restart core'), stop: () => assert.fail('Import must not stop core'), applyProxy: () => assert.fail('Import must not change system proxy') };
  vm.runInNewContext(importFunction, context);
  return { context, run: context.importSubscription, runBatch: context.importLinks, state, session, stats: () => ({ fetches, saves }) };
}
test('new subscription imports while connected without changing selected node, active session, core config or latency', async () => {
  const f = fixture(), before = JSON.stringify(createConfig(f.state));
  await f.run('https://new.example/sub', undefined, 'New');
  assert.equal(f.context.state.selectedNodeId, 'active'); assert.equal(f.context.session, f.session); assert.equal(f.context.state.nodes[0], f.state.nodes[0]);
  assert.equal(f.context.state.nodeChecks.active.delayMs, 31); assert.equal(f.context.state.nodes.length, 3);
  assert.equal(JSON.stringify(createConfig(f.context.state)), before); assert.equal(f.context.importReport.subscriptionId, 'new-source');
  assert.deepEqual(f.stats(), { fetches: 1, saves: 1 });
});
test('updating or replacing another subscription while connected leaves the active source untouched', async () => {
  const f = fixture(), before = JSON.stringify(createConfig(f.state));
  await f.run('https://replacement.example/sub', 'other-source', 'Other renamed');
  assert.equal(f.context.state.selectedNodeId, 'active'); assert.equal(f.context.state.nodes.some(n => n.id === 'other'), false);
  assert.equal(f.context.state.nodes.find(n => n.id === 'active'), f.state.nodes[0]);
  assert.equal(f.context.state.subscriptions.find(s => s.id === 'current'), f.state.subscriptions[0]);
  assert.equal(f.context.state.subscriptions.find(s => s.id === 'other-source').name, 'Other renamed');
  assert.equal(JSON.stringify(createConfig(f.context.state)), before);
});
test('active-source refresh and URL replacement save next-connection nodes without touching the live session', async () => {
  const f = fixture(), originalSession = JSON.stringify(f.session), originalConfig = JSON.stringify(createConfig(f.state));
  await f.run('https://current.example/sub', 'current');
  await f.run('https://replacement.example/sub', 'current');
  assert.equal(f.context.session, f.session); assert.equal(JSON.stringify(f.session), originalSession);
  assert.equal(JSON.stringify(createConfig(f.state)), originalConfig);
  assert.equal(f.context.state.nodes.some(n => n.id === 'active'), false);
  assert.equal(f.context.state.nodes.find(n => n.id === f.context.state.selectedNodeId).host, 'new.example');
  assert.equal(f.context.state.subscriptions.find(s => s.id === 'current').url, 'https://replacement.example/sub');
  assert.deepEqual(f.stats(), { fetches: 2, saves: 2 });
  assert.equal(nodeManager.subscriptionInUse(f.state, { connected: true }, 'current'), true, 'legacy sessions fall back to selected node, not source tab');
  assert.equal(nodeManager.subscriptionInUse(f.state, { connected: false }, 'current'), false);
});
test('legacy HTTPS manual node is not replaced by same-host subscription import while it is connected', async () => {
  const f = fixture({ manual: true });
  await f.run('https://new.example/sub');
  assert.equal(f.context.state.selectedNodeId, 'active'); assert.equal(f.context.state.nodes[0], f.state.nodes[0]);
  assert.equal(f.context.state.nodes[0].subscriptionId, undefined); assert.equal(f.session.connected, true);
});
test('save and download failures roll back without stopping the connection or publishing success', async () => {
  for (const options of [{ save: async () => { throw new Error('disk failure'); } }, { fetch: async () => { throw new Error('network failure'); } }]) {
    const f = fixture(options); await assert.rejects(f.run('https://new.example/sub'), /failure/);
    assert.equal(f.context.state, f.state); assert.equal(f.context.importReport, null); assert.equal(f.context.session, f.session); assert.equal(f.session.connected, true);
  }
});
test('a source removed during download is not resurrected and disconnected updates remain allowed', async () => {
  const f = fixture({ fetch: context => { context.state = nodeManager.removeSubscription(context.state, 'other-source'); return { body: 'http://new.example:9090', usage: null }; } });
  await assert.rejects(f.run('https://other.example/sub', 'other-source'), /订阅不存在/); assert.equal(f.stats().saves, 0);
  assert.equal(f.context.state.subscriptions.some(s => s.id === 'other-source'), false);
  const disconnected = fixture(); disconnected.session.connected = false;
  await disconnected.run('https://current.example/sub', 'current'); assert.equal(disconnected.stats().saves, 1);
  const legacy = fixture({ manual: true }); legacy.session.connected = false;
  await legacy.run('https://new.example/sub'); assert.notEqual(legacy.context.state.selectedNodeId, 'active');
});
test('automatic mixed import classifies HTTPS proxy and subscriptions, saves once and preserves the active connection', async () => {
  const f = fixture(), previousConfig = JSON.stringify(createConfig(f.state));
  await f.runBatch({ content: 'https://proxy.example:8443\nhttps://new.example/feed?key=example\nhttps://other.example/sub\nhttps://new.example/feed?key=example', name: '工作线路' });
  const result = f.context.state;
  assert.equal(result.nodes.find(node => node.host === 'proxy.example').name, '工作线路 · 1');
  assert.equal(result.subscriptions.find(sub => sub.id === 'new-source').name, '工作线路 · 2');
  assert.equal(result.subscriptions.find(sub => sub.id === 'other-source').name, '工作线路 · 3');
  assert.equal(f.context.importReport.imported, 3);
  assert.equal(Array.from(f.context.importReport.subscriptionIds).join(','), 'new-source,other-source');
  assert.equal(f.context.session, f.session);
  assert.equal(JSON.stringify(createConfig(result)), previousConfig);
  assert.deepEqual(f.stats(), { fetches: 2, saves: 1 });
});
test('automatic import leaves the batch uncommitted after validation, download or save fails', async () => {
  const invalid = fixture();
  await assert.rejects(invalid.runBatch('https://new.example/sub\n\ninvalid'), /第 3 行/);
  assert.deepEqual(invalid.stats(), { fetches: 0, saves: 0 });

  const broken = fixture({ fetch: (_, url) => {
    if (url.includes('broken.example')) throw new Error('订阅获取失败');
    return { body: 'http://new.example:9090', usage: null };
  } });
  await assert.rejects(broken.runBatch('https://new.example/sub\nhttp://proxy.example:8080\nhttps://broken.example/sub'), /第 3 行：订阅获取失败/);
  assert.deepEqual(broken.stats(), { fetches: 2, saves: 0 });

  const disk = fixture({ save: async () => { throw new Error('disk failure'); } });
  await assert.rejects(disk.runBatch('https://new.example/sub\nhttp://proxy.example:8080'), /disk failure/);
  for (const f of [invalid, broken, disk]) {
    assert.equal(f.context.state, f.state);
    assert.equal(f.context.importReport, null);
  }
});
let vite, cache, Profiles, SourceDetails;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-live-import-ui-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  Profiles = (await vite.ssrLoadModule('/src/Profiles.jsx')).default;
  SourceDetails = (await vite.ssrLoadModule('/src/SourceDetails.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('connected UI enables active and other subscription removals on a capable backend', () => {
  const f = fixture();
  const data = { ...f.state, session: f.session, environment: { connectedEditing: true } };
  for (const item of data.subscriptions) {
    const panel = renderToStaticMarkup(React.createElement(SourceDetails, { data, busy: false, target: { kind: 'subscription', item } }));
    const remove = panel.match(/<button\b([^>]*)>(?:(?!<button)[\s\S])*?移除订阅<\/button>/);
    assert.ok(remove); assert.doesNotMatch(remove[1], /disabled/);
  }
  const html = renderToStaticMarkup(React.createElement(Profiles, { data, busy: false, selectedGroup: 'other-source' }));
  assert.match(html, /<button class="button primary">[\s\S]*?导入<\/button>/);
  assert.equal(nodeManager.subscriptionInUse(f.state, { ...f.session, nodeId: 'other', subscriptionId: 'other-source' }, 'current'), false);
});
