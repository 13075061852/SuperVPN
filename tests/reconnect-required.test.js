import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
import { setWebsiteRule } from '../shared/website-rules.js';
import { replaceSubscription, removeSubscription } from '../shared/node-manager.js';
const { createReconnectTracker } = createRequire(import.meta.url)('../desktop/reconnect-required.cjs');
function fixture() {
  const node = { ...parseLink('https://user:private@active.example:443'), id: 'active', subscriptionId: 'source' };
  const state = { ...defaultState(), nodes: [node], selectedNodeId: node.id,
    subscriptions: [{ id: 'source', name: 'Original', url: 'https://subscription.example/private' }] };
  const tracker = createReconnectTracker({ createConfig });
  tracker.started(createConfig(state, { controllerSecret: 'private-controller-secret' }));
  return { state, tracker };
}
test('only changes to the effective saved network config need reconnecting, and reverting clears the notice', () => {
  const { state, tracker } = fixture(); assert.equal(tracker.required(state, true), false);
  const changed = setWebsiteRule(state, { domain: 'example.com', action: 'direct' });
  assert.equal(tracker.required(changed, true), true);
  assert.equal(tracker.required(state, true), false);
  assert.equal(tracker.required({ ...changed, websiteRules: changed.websiteRules.map(rule => ({ ...rule, enabled: false })) }, true), false);
  for (const settings of [{ mixedPort: 17891 }, { bypassLan: false }, { defaultAction: 'direct' }]) {
    assert.equal(tracker.required({ ...state, settings: { ...state.settings, ...settings } }, true), true);
  }
  assert.equal(tracker.required({ ...state, rules: [{ id: 'rule', process: 'browser.exe', action: 'direct', enabled: true }] }, true), true);
});
test('renames, quotas, latency, unrelated sources and live mode changes do not request reconnecting', () => {
  const { state, tracker } = fixture();
  const variants = [
    { ...state, nodes: state.nodes.map(node => ({ ...node, name: 'Renamed' })) },
    { ...state, subscriptions: state.subscriptions.map(sub => ({ ...sub, name: 'Renamed', usage: { total: 1000, download: 50 } })) },
    { ...state, nodeChecks: { active: { status: 'ok', delayMs: 123 } } },
    { ...state, settings: { ...state.settings, autoStart: true, closeToTray: false } },
    { ...state, settings: { ...state.settings, outboundMode: 'global' } },
    { ...state, settings: { ...state.settings, outboundMode: 'direct' } },
    { ...state, nodes: [...state.nodes, parseLink('http://unrelated.example:8080')] }
  ];
  for (const next of variants) assert.equal(tracker.required(next, true), false);
});
test('same-endpoint subscription refresh is not a reconnect requirement, but changed parameters or removal are', () => {
  const { state, tracker } = fixture();
  const same = { ...state.nodes[0], id: 'new-id', name: 'New label' };
  const refresh = node => replaceSubscription(state, { nodes: [node], total: 1, skipped: 0 }, state.subscriptions[0]);
  assert.equal(tracker.required(refresh(same), true), false);
  const changed = { ...same, outbound: { ...same.outbound, password: 'changed-private' } };
  assert.equal(tracker.required(refresh(changed), true), true);
  assert.equal(tracker.required(removeSubscription(state, 'source'), true), true);
  assert.equal(typeof tracker.required(state, true), 'boolean');
});
test('successful restart resets the baseline; disconnected or stopped sessions never show a warning', () => {
  const { state, tracker } = fixture(), changed = setWebsiteRule(state, { domain: 'example.com', action: 'reject' });
  assert.equal(tracker.required(changed, true), true);
  assert.equal(tracker.required(changed, false), false);
  tracker.stopped(); assert.equal(tracker.required(changed, true), false);
  tracker.started(createConfig(changed, { controllerSecret: 'new-private-secret' }));
  assert.equal(tracker.required(changed, true), false);
  assert.equal(tracker.required(state, true), true);
});
test('comparison ignores JSON object key order but preserves meaningful rule ordering', () => {
  const { state, tracker } = fixture();
  const node = state.nodes[0];
  const reordered = { ...node, outbound: Object.fromEntries(Object.entries(node.outbound).reverse()) };
  assert.equal(tracker.required({ ...state, nodes: [reordered] }, true), false);
  const rules = [{ id: 'first', process: 'browser.exe', action: 'direct', enabled: true }, { id: 'second', process: 'browser.exe', action: 'reject', enabled: true }];
  tracker.started(createConfig({ ...state, rules }));
  assert.equal(tracker.required({ ...state, rules: [...rules].reverse() }, true), true);
});
let vite, cache, Dashboard;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-reconnect-ui-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  Dashboard = (await vite.ssrLoadModule('/src/Dashboard.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('dashboard shows a reconnect notice only for an actually connected session with pending network changes', () => {
  const { state } = fixture(), data = { ...state, environment: { desktop: false }, session: { connected: true, nodeId: 'active' }, reconnectRequired: true };
  const render = () => renderToStaticMarkup(React.createElement(Dashboard, { data, busy: false, duration: '00:01:00' }));
  assert.match(render(), /class="reconnect-notice" role="status">设置已更改，需要重连后生效/);
  assert.ok(render().includes('断开连接'));
  data.reconnectRequired = false; assert.equal(render().includes('reconnect-notice'), false);
  data.reconnectRequired = true; data.session.connected = false; assert.equal(render().includes('reconnect-notice'), false);
});
test('desktop exposes only the boolean and snapshots the exact successfully started config', async () => {
  const main = await fs.readFile('electron/main.cjs', 'utf8');
  assert.ok(main.includes('reconnectRequired: reconnectTracker.required(state, session.connected)'));
  assert.match(main, /async function stop\(\) \{\s*reconnectTracker.stopped\(\)/);
  assert.match(main, /if \(state.mode === 'system'\) await applyProxy\(\);[\s\S]*?reconnectTracker.started\(config\);\s*session = \{ connected: true/);
});
