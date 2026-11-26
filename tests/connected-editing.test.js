import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
import * as nodeManager from '../shared/node-manager.js';
import * as sourceEdits from '../shared/source-edits.js';
import * as subscriptionApi from '../shared/subscription.js';
import * as websiteRules from '../shared/website-rules.js';
const { setProgramRule } = createRequire(import.meta.url)('../desktop/program-rules.cjs');
const { createReconnectTracker } = createRequire(import.meta.url)('../desktop/reconnect-required.cjs');
const main = await fs.readFile('electron/main.cjs', 'utf8');
const handleSource = main.slice(main.indexOf('async function handle('), main.indexOf('function createWindow('));
const importSource = main.slice(main.indexOf('async function importSubscription('), main.indexOf('async function handle('));
function fixture({ failSave = false, manualActive = false } = {}) {
  const active = { ...parseLink('http://active.example:8080'), id: 'active', ...(manualActive ? {} : { subscriptionId: 'source' }) };
  const spare = { ...parseLink('http://spare.example:8080'), id: 'spare' };
  const state = { ...defaultState(), nodes: [active, spare], selectedNodeId: active.id,
    subscriptions: [{ id: 'source', name: 'Original', url: 'https://source.example/sub' }],
    rules: [{ id: 'program', process: 'browser.exe', action: 'direct', enabled: true }],
    websiteRules: [{ id: 'website', domain: 'example.com', action: 'direct', enabled: true }] };
  // Execute the actual startup snapshot expression, with a credential-bearing node.
  const session = vm.runInNewContext(main.match(/session = \{ connected: true,[^\n]+/)[0], { activeNode: active, Date });
  session.upSpeed = 123; session.downSpeed = 456;
  const tracker = createReconnectTracker({ createConfig }); tracker.started(createConfig(state));
  let saves = 0;
  const forbidden = () => assert.fail('Saved edits must not touch the live core, system proxy, or runtime file');
  const context = { state, session, busy: false, testProgress: { running: false }, sourceEdits, nodeManager, subscriptionApi, websiteRules, setProgramRule,
    URL, Date, randomBytes: () => ({ toString: () => 'generated' }), importReport: null,
    fetchSubscription: async () => ({ body: 'http://replacement.example:9090#Replacement', usage: null }),
    save: async () => { saves++; if (failSave) throw new Error('disk failure'); },
    view: () => ({ ...context.state, session: context.session, reconnectRequired: tracker.required(context.state, context.session.connected) }), broadcast() {}, log() {},
    start: forbidden, stop: forbidden, applyProxy: forbidden, recoverProxy: forbidden, controller: forbidden,
    fs: { writeFile: forbidden, rename: forbidden, rm: forbidden }, exec: forbidden, spawn: forbidden };
  vm.runInNewContext(importSource, context);
  const handle = vm.runInNewContext(`(${handleSource})`, context);
  return { context, state, session, handle, tracker, saves: () => saves };
}
const activeNodeEdits = [
  { id: 'active', name: 'Updated', host: 'next.example', port: 8443 },
  { id: 'active', name: 'Replaced', link: 'socks5://replacement.example:1080' }
];
const edits = [
  ['editNode', { id: 'spare', name: 'Updated', host: 'next.example', port: 8443 }],
  ['editNode', { id: 'active', name: 'Renamed' }],
  ['editSubscription', { id: 'source', name: 'Renamed' }],
  ['editSubscription', { id: 'source', name: 'Replaced', url: 'https://replacement.example/sub' }],
  ['refreshSubscription', 'source'],
  ['deleteSubscription', 'source'],
  ['setWebsiteRule', { domain: 'example.com', action: 'proxy' }],
  ['setWebsiteRule', { domain: 'example.com', action: 'direct', enabled: false }],
  ['setWebsiteRule', { domain: 'new.example', action: 'reject' }],
  ['deleteWebsiteRule', 'website'],
  ['setProgramRule', { process: 'browser.exe', action: 'reject' }],
  ['setProgramRule', { process: 'browser.exe', action: 'default' }],
  ['addRule', { process: 'new.exe', action: 'proxy' }],
  ['toggleRule', 'program'],
  ['deleteRule', 'program']
];
test('node, subscription and routing edits save while connected without altering the running session or config', async () => {
  for (const [method, payload] of edits) {
    const f = fixture(), originalSession = JSON.stringify(f.session), originalConfig = JSON.stringify(createConfig(f.state));
    const result = await f.handle(method, payload);
    assert.equal(f.saves(), 1, method); assert.notEqual(f.context.state, f.state, method);
    assert.equal(f.context.session, f.session, method); assert.equal(JSON.stringify(f.session), originalSession, method);
    assert.equal(JSON.stringify(createConfig(f.state)), originalConfig, method);
    assert.equal(result.session.connected, true, method); assert.equal(result.session.node.name, f.state.nodes[0].name, method);
    assert.equal(f.context.busy, false, method);
    assert.equal(result.reconnectRequired, method !== 'editNode' && !(method === 'editSubscription' && !payload.url), method);
    if (method === 'deleteSubscription') { assert.equal(result.subscriptions.length, 0); assert.equal(result.selectedNodeId, 'spare'); }
    if (method === 'refreshSubscription') { assert.equal(result.nodes.find(n => n.id === result.selectedNodeId).host, 'replacement.example'); }
  }
});
test('save failures roll back every connected edit and keep the current connection intact', async () => {
  for (const [method, payload] of [...edits, ...activeNodeEdits.map(payload => ['editNode', payload])]) {
    const f = fixture({ failSave: true }), original = JSON.stringify(f.state), originalSession = JSON.stringify(f.session);
    await assert.rejects(f.handle(method, payload), /disk failure/, method);
    assert.equal(f.context.state, f.state, method); assert.equal(JSON.stringify(f.state), original, method);
    assert.equal(JSON.stringify(f.session), originalSession, method); assert.equal(f.context.busy, false, method);
    assert.equal(f.context.view().reconnectRequired, false, method);
  }
});
test('saving changed parameters on the running node reconnects to that node after persisting them', async () => {
  for (const payload of activeNodeEdits) {
    const f = fixture({ manualActive: true });
    f.state.selectedNodeId = 'spare';
    const calls = [];
    f.context.stop = async () => {
      assert.equal(f.saves(), 1);
      assert.equal(f.context.state.selectedNodeId, 'active');
      calls.push('stop');
      f.tracker.stopped();
      f.context.session = { ...f.session, connected: false };
    };
    f.context.start = async () => {
      calls.push('start');
      assert.equal(f.context.session.connected, false);
      const config = createConfig(f.context.state);
      const outbound = config.outbounds.find(outbound => outbound.tag === 'proxy');
      const address = payload.link ? new URL(payload.link) : null;
      assert.equal(outbound.server, address?.hostname ?? payload.host);
      assert.equal(outbound.server_port, address ? Number(address.port) : payload.port);
      const activeNode = f.context.state.nodes.find(n => n.id === f.context.state.selectedNodeId);
      f.tracker.started(config);
      f.context.session = vm.runInNewContext(main.match(/session = \{ connected: true,[^\n]+/)[0], { activeNode, Date });
    };
    const result = await f.handle('editNode', payload);
    assert.deepEqual(calls, ['stop', 'start']);
    assert.equal(result.session.connected, true);
    assert.equal(result.session.nodeId, 'active');
    assert.equal(result.session.node.name, payload.name);
    assert.equal(result.reconnectRequired, false);
  }
});
test('an automatic reconnect failure keeps the saved parameters and reports the disconnected state', async () => {
  const f = fixture({ manualActive: true });
  f.context.stop = async () => { f.context.session = { ...f.session, connected: false }; };
  f.context.start = async () => { throw new Error('startup failed'); };
  await assert.rejects(f.handle('editNode', activeNodeEdits[0]), /已保存.*重连失败/);
  assert.equal(f.context.session.connected, false);
  assert.equal(f.context.state.nodes[0].host, 'next.example');
  assert.equal(f.saves(), 1);
  assert.equal(f.context.busy, false);
});
test('deleting saved manual nodes while connected keeps the active session and selects a fallback for the next connection', async () => {
  const f = fixture({ manualActive: true });
  f.state.nodeChecks = { active: { delayMs: 30 }, spare: { delayMs: 45 } };
  const snapshot = JSON.stringify(f.session);
  const result = await f.handle('deleteNode', 'active');
  assert.equal(result.session, f.session);
  assert.equal(JSON.stringify(result.session), snapshot);
  assert.equal(result.selectedNodeId, 'spare');
  assert.deepEqual(result.nodes.map(node => node.id), ['spare']);
  assert.deepEqual(Object.keys(result.nodeChecks), ['spare']);
  assert.equal(result.reconnectRequired, true);
  const empty = await f.handle('deleteNode', 'spare');
  assert.equal(empty.selectedNodeId, null);
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.session, f.session);
  assert.equal(JSON.stringify(empty.session), snapshot);
  await f.handle('deleteNode', 'spare');
  assert.equal(f.saves(), 2);
});
test('manual node deletion rolls back on save failure and leaves subscription nodes managed by their source', async () => {
  const failed = fixture({ failSave: true, manualActive: true });
  await assert.rejects(failed.handle('deleteNode', 'active'), /disk failure/);
  assert.equal(failed.context.state, failed.state);
  assert.equal(failed.context.session, failed.session);
  assert.equal(failed.context.view().reconnectRequired, false);
  const f = fixture();
  await assert.rejects(f.handle('deleteNode', 'active'), /所属订阅/);
  assert.equal(f.saves(), 0);
  const result = await f.handle('deleteNode', 'spare');
  assert.equal(result.selectedNodeId, 'active');
  assert.equal(result.reconnectRequired, false);
});
test('connected edits retain validation, busy serialization and missing-record errors', async () => {
  const f = fixture(), original = JSON.stringify(f.state);
  for (const [method, payload] of [['setWebsiteRule', { domain: 'https://user:secret@example.com', action: 'proxy' }], ['setProgramRule', { process: 'C:\\bad.exe', action: 'direct' }], ['editSubscription', { id: 'missing', name: 'New' }], ['deleteSubscription', 'missing']]) {
    await assert.rejects(f.handle(method, payload));
    assert.equal(JSON.stringify(f.state), original); assert.equal(f.saves(), 0);
  }
  f.context.busy = true;
  await assert.rejects(f.handle('deleteSubscription', 'source'), /正在处理/);
  assert.equal(JSON.stringify(f.state), original);
});
test('a refreshed active subscription builds its replacement only for the next connection', async () => {
  const f = fixture(), before = JSON.stringify(createConfig(f.state));
  await f.handle('refreshSubscription', 'source');
  const next = createConfig(f.context.state);
  assert.notEqual(JSON.stringify(next), before);
  assert.equal(next.outbounds.find(outbound => outbound.tag === 'proxy').server, 'replacement.example');
  assert.equal(f.session.node.host, 'active.example'); assert.equal(f.session.nodeId, 'active');
  assert.deepEqual(Object.keys(f.session.node).sort(), ['host', 'id', 'name', 'port', 'protocol', 'subscriptionId']);
  assert.equal('outbound' in f.session.node, false);
});
test('only an explicit node selection reconnects to a saved replacement even if it is already selected for next time', async () => {
  const f = fixture(); await f.handle('refreshSubscription', 'source');
  const next = f.context.state.selectedNodeId, calls = [];
  f.context.stop = async () => { calls.push('stop'); f.context.session = { ...f.context.session, connected: false }; };
  f.context.start = async () => { calls.push('start'); f.context.session = { ...f.context.session, connected: true, nodeId: f.context.state.selectedNodeId }; };
  await f.handle('selectNode', next);
  assert.deepEqual(calls, ['stop', 'start']); assert.equal(f.context.session.nodeId, next);
});
let vite, cache, SourceEditor, Dashboard, SourceDetails, NodeManager;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-connected-edit-ui-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  SourceEditor = (await vite.ssrLoadModule('/src/SourceEditor.jsx')).default;
  Dashboard = (await vite.ssrLoadModule('/src/Dashboard.jsx')).default;
  SourceDetails = (await vite.ssrLoadModule('/src/SourceDetails.jsx')).default;
  NodeManager = (await vite.ssrLoadModule('/src/NodeManager.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('subscription URL replacement unlocks on capable backends but still respects busy and legacy backends', () => {
  const f = fixture(), props = { target: { kind: 'subscription', item: f.state.subscriptions[0] }, connected: true, connectedEditing: true, busy: false };
  const render = patch => renderToStaticMarkup(React.createElement(SourceEditor, { ...props, ...patch }));
  const html = render(); assert.doesNotMatch(html, /id="edit-source-replacement"[^>]*disabled/); assert.doesNotMatch(html, /下次连接使用新节点/);
  assert.match(render({ busy: true }), /id="edit-source-replacement"[^>]*disabled/);
  assert.match(render({ connectedEditing: false }), /id="edit-source-replacement"[^>]*disabled/);
});
test('connected node dialogs enable endpoint and link edits only on a capable backend while idle', () => {
  const f = fixture({ manualActive: true });
  const target = { kind: 'node', item: f.state.nodes[0] };
  for (const [capable, busy, testing] of [[true, false, false], [false, false, false], [true, true, false], [true, false, true]]) {
    const data = { ...f.state, session: f.session, environment: { connectedEditing: true, connectedNodeEditing: capable }, testProgress: { running: testing } };
    const html = renderToStaticMarkup(React.createElement(SourceDetails, { data, busy, target }));
    for (const id of ['edit-node-host', 'edit-node-port', 'edit-source-replacement']) {
      const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
      assert.ok(input);
      assert.equal(input.includes('disabled'), !capable || busy || testing, id);
    }
  }
});
test('dashboard continues to identify the actual running node after active-source refresh or removal', async () => {
  for (const method of ['refreshSubscription', 'deleteSubscription']) {
    const f = fixture(); await f.handle(method, 'source');
    const data = { ...f.context.state, session: f.session, environment: { desktop: false } };
    const html = renderToStaticMarkup(React.createElement(Dashboard, { data, busy: false, duration: '00:01:00' }));
    const current = html.match(/<button class="current-node-button"[^>]*>([\s\S]*?)<\/button>/)[1];
    assert.ok(current.includes(f.session.node.name)); assert.equal(current.includes('Replacement'), false); assert.equal(current.includes('spare.example'), false);
    assert.ok(html.includes('断开连接'));
  }
});
test('busy and legacy subscription dialogs disable unsupported connected actions', () => {
  const f = fixture();
  for (const [connectedEditing, busy] of [[false, false], [true, true]]) {
    const item = f.state.subscriptions[0];
    const html = renderToStaticMarkup(React.createElement(SourceDetails, { target: { kind: 'subscription', item }, data: { ...f.state, session: f.session, environment: { connectedEditing } }, busy }));
    assert.match(html, /<button[^>]* disabled=""[^>]*>(?:(?!<button)[\s\S])*?移除订阅<\/button>/);
    assert.doesNotMatch(html, /订阅操作|查看线路|更新流量|更新订阅/);
  }
});
test('both manual node delete controls are enabled during a connection on a capable backend', () => {
  const f = fixture({ manualActive: true }), item = f.state.nodes[0];
  for (const [capable, busy] of [[true, false], [false, false], [true, true]]) {
    const data = { ...f.state, session: f.session, environment: { connectedNodeDeletion: capable } };
    const panel = renderToStaticMarkup(React.createElement(SourceDetails, { data, busy, target: { kind: 'node', item } }));
    const list = renderToStaticMarkup(React.createElement(NodeManager, { data, busy }));
    for (const control of [panel.match(/<button[^>]*class="button quiet source-remove"[^>]*>/)?.[0], list.match(/<button[^>]*class="manual-node-delete icon-button danger"[^>]*>/)?.[0]]) {
      assert.ok(control);
      assert.equal(control.includes('disabled'), !capable || busy);
    }
  }
});
