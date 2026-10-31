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
  let fetches = 0, saves = 0;
  const context = { state, session, nodeManager, subscriptionApi, URL, Date, randomBytes: () => ({ toString: () => 'new-source' }), importReport: null,
    fetchSubscription: async () => { fetches++; return fetch ? fetch(context) : { body: 'http://new.example:9090#Imported', usage: null }; },
    save: async () => { saves++; await save(); }, log: () => {}, start: () => assert.fail('Import must not restart core'), stop: () => assert.fail('Import must not stop core'), applyProxy: () => assert.fail('Import must not change system proxy') };
  const run = vm.runInNewContext(`(${importFunction})`, context);
  return { context, run, state, session, stats: () => ({ fetches, saves }) };
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
test('same-source reimport, refresh and URL replacement are blocked before fetching only for the active source', async () => {
  const f = fixture();
  await assert.rejects(f.run('https://current.example/sub', 'current'), /此订阅正在用于当前连接/);
  await assert.rejects(f.run('https://replacement.example/sub', 'current'), /此订阅正在用于当前连接/);
  assert.equal(f.context.state, f.state); assert.deepEqual(f.stats(), { fetches: 0, saves: 0 });
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
test('active source is rechecked after an asynchronous download and disconnected updates remain allowed', async () => {
  const f = fixture({ fetch: context => { context.session = { ...context.session, subscriptionId: 'other-source', nodeId: 'other' }; return { body: 'http://new.example:9090', usage: null }; } });
  await assert.rejects(f.run('https://other.example/sub', 'other-source'), /此订阅正在用于当前连接/); assert.equal(f.context.state, f.state); assert.equal(f.stats().saves, 0);
  const disconnected = fixture(); disconnected.session.connected = false;
  await disconnected.run('https://current.example/sub', 'current'); assert.equal(disconnected.stats().saves, 1);
  const legacy = fixture({ manual: true }); legacy.session.connected = false;
  await legacy.run('https://new.example/sub'); assert.notEqual(legacy.context.state.selectedNodeId, 'active');
});
let vite, cache, Profiles;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-live-import-ui-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  Profiles = (await vite.ssrLoadModule('/src/Profiles.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('connected UI enables import and updates to other sources but disables active subscription update', () => {
  const f = fixture();
  const html = renderToStaticMarkup(React.createElement(Profiles, { data: { ...f.state, session: f.session }, busy: false, selectedGroup: 'other-source' }));
  const updates = [...html.matchAll(/<button\b([^>]*)>(?:(?!<button)[\s\S])*?更新订阅<\/button>/g)].map(match => match[1]);
  // Match attributes on the exact update buttons, not preceding sibling buttons.
  const locked = html.match(/<button disabled="" title="当前连接正在使用此订阅，断开后可更新"/);
  const unlocked = html.match(/<button title="更新此订阅，不影响当前连接"/);
  assert.ok(locked); assert.ok(unlocked); assert.equal(updates.length, 2);
  assert.match(html, /<button class="button primary">[\s\S]*?导入<\/button>/);
  assert.equal(nodeManager.subscriptionInUse(f.state, { ...f.session, nodeId: 'other', subscriptionId: 'other-source' }, 'current'), false);
});
