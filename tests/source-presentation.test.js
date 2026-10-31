import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { defaultState, parseLink } from '../shared/proxy.js';
import { subscriptionFacts } from '../src/source-presentation.js';
let vite, Profiles, SourceEditor, cache;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-render-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  Profiles = (await vite.ssrLoadModule('/src/Profiles.jsx')).default;
  SourceEditor = (await vite.ssrLoadModule('/src/SourceEditor.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
const noop = () => {};
function fixture() {
  const state = defaultState();
  state.subscriptions = [{ id: 's-1', name: '主力订阅', url: 'https://private.example/sub?token=never-render', updatedAt: 1 }, { id: 's-2', name: '备用订阅', updatedAt: 2 }];
  state.nodes = [
    { ...parseLink('http://subscription.example:8080#订阅节点'), subscriptionId: 's-1' },
    ...Array.from({ length: 2 }, () => parseLink('vless://11111111-2222-4333-8444-555555555555@node.example:443#同名节点'))
  ];
  state.selectedNodeId = state.nodes[1].id;
  state.session = { connected: false };
  state.informationNodes = [{ name: '剩余流量：430.53 GB', subscriptionId: 's-1' }, { name: '距离下次重置剩余：7 天', subscriptionId: 's-1' }];
  return state;
}
function render(data) { return renderToStaticMarkup(React.createElement(Profiles, { data, busy: false, onImport: noop, onOpen: noop, onAction: noop, onDelete: noop, onDeleteNode: noop, onSecurity: noop })); }
test('subscription facts preserve real provider values and do not fabricate total quota or percentages', () => {
  assert.deepEqual(subscriptionFacts([{ name: '剩余流量：430.53 GB' }, { name: '距离下次重置剩余:7 天' }, { name: '套餐到期：2027-07-05' }]), { remaining: '430.53 GB', reset: '7 天', expiry: '2027-07-05' });
  assert.deepEqual(subscriptionFacts(), { remaining: null, reset: null, expiry: null });
});
test('unknown plan text is not interpreted as quota and missing fields remain absent', () => {
  assert.deepEqual(subscriptionFacts([{ name: '提示：剩余流量未知' }, { name: '套餐到期：2027-07-05' }]), { remaining: null, reset: null, expiry: '2027-07-05' });
});
test('source management renders real subscription cards and separate independent sources without duplicate controls', () => {
  const html = render(fixture());
  assert.equal((html.match(/class="profile-card tone-/g) || []).length, 2);
  assert.ok(html.includes('tone-lilac')); assert.ok(html.includes('tone-mint'));
  assert.equal((html.match(/class="independent-card/g) || []).length, 2);
  assert.ok(html.includes('独立节点')); assert.ok(html.includes('<h1>来源</h1>'));
  assert.equal(html.includes('订阅与节点，各自独立'), false);
  assert.equal(html.includes('独立保存 · 不与其他来源合并'), false);
  assert.ok(html.includes('430.53 GB')); assert.equal(html.includes('200 GB'), false);
  for (const removed of ['source-connection', 'add-source-card', 'route-emblem', '流量接管模式']) assert.equal(html.includes(removed), false);
});
test('source cards do not render credential URLs or protocol authentication UUIDs', () => {
  const data = fixture(), html = render(data);
  assert.equal(html.includes('never-render'), false); assert.equal(html.includes('private.example'), false);
  assert.equal(html.includes('11111111-2222-4333-8444-555555555555'), false);
  for (const node of data.nodes.filter(n => !n.subscriptionId)) assert.ok(html.includes(node.id.slice(0, 8)));
  assert.equal(html.includes('连接状态'), false); assert.equal(html.includes('代理运行中'), false);
});
test('real quota renders a proportional progress bar and unknown totals never render a fake percentage', () => {
  const data = fixture(); data.subscriptions[0].usage = { upload: 50, download: 200, total: 1000 };
  const html = render(data); assert.ok(html.includes('aria-valuenow="25"')); assert.ok(html.includes('width:25%'));
  assert.ok(html.includes('已用 250 B')); assert.ok(html.includes('750 B')); assert.ok(html.includes('更新流量')); assert.ok(html.includes('编辑订阅')); assert.ok(html.includes('编辑节点'));
  const unknown = render(fixture()); assert.ok(unknown.includes('总额度未知')); assert.equal(unknown.includes('role="progressbar"'), false);
});
test('node editor exposes endpoint fields and a masked replacement input without revealing existing secrets', () => {
  const node = { ...parseLink('trojan://private-secret@node.example:443#测试节点'), subscriptionId: 's-1' };
  const html = renderToStaticMarkup(React.createElement(SourceEditor, { target: { kind: 'node', item: node }, connected: true, busy: false, onSave: noop, onCancel: noop }));
  assert.ok(html.includes('服务器')); assert.ok(html.includes('端口')); assert.ok(html.includes('type="password"')); assert.ok(html.includes('连接中仅可修改名称'));
  assert.equal(html.includes('private-secret'), false); assert.ok(html.includes('value="node.example"')); assert.ok(html.includes('disabled=""'));
});
test('subscription editor keeps the original token-bearing URL outside the form', () => {
  const html = renderToStaticMarkup(React.createElement(SourceEditor, { target: { kind: 'subscription', item: fixture().subscriptions[0] }, connected: false, busy: false, onSave: noop, onCancel: noop }));
  assert.ok(html.includes('替换订阅地址')); assert.ok(html.includes('留空保留当前地址')); assert.equal(html.includes('never-render'), false); assert.equal(html.includes('private.example'), false);
});
test('source cards expose native selection buttons with full-card hit areas and independently layered controls', async () => {
  const html = render(fixture());
  assert.ok(html.includes('aria-label="选择来源 主力订阅"')); assert.ok(html.includes('aria-label="选择来源 同名节点"'));
  assert.ok(html.includes('aria-pressed="true"')); assert.equal(html.includes('复制 同名节点 节点 ID'), false);
  assert.equal(html.includes('source-node-identity'), false); assert.equal(html.includes('<code'), false);
  const css = await fs.readFile('src/styles.css', 'utf8');
  assert.match(css, /\.source-card-name::after\s*\{[^}]*position: absolute;[^}]*inset: 0;[^}]*z-index: 1;/);
  assert.match(css, /\.tidy-sources \.profile-menu[^}]*z-index: 2;/);
  assert.match(css, /\.source-card-name:active:not\(:disabled\)\s*\{ transform: none;/);
});
test('empty sources show a useful import action without fake subscriptions or connected state', () => {
  const data = { ...defaultState(), session: { connected: false } }, html = render(data);
  assert.ok(html.includes('添加订阅')); assert.ok(html.includes('还没有订阅或独立节点'));
  assert.equal((html.match(/class="profile-card tone-/g) || []).length, 0);
  assert.equal(html.includes('source-connection'), false);
  assert.equal(html.includes('尚未连接'), false);
});
