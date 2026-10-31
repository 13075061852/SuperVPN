import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
import info from '../electron/network-info.cjs';
let vite, Dashboard, NodeSpeedTest, NodeManager, TerminalProxySettings, CountryFlag, countryFlagUrl, cache;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-dashboard-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  Dashboard = (await vite.ssrLoadModule('/src/Dashboard.jsx')).default;
  NodeSpeedTest = (await vite.ssrLoadModule('/src/NodeSpeedTest.jsx')).default;
  NodeManager = (await vite.ssrLoadModule('/src/NodeManager.jsx')).default;
  TerminalProxySettings = (await vite.ssrLoadModule('/src/TerminalProxySettings.jsx')).default;
  const flags = await vite.ssrLoadModule('/src/CountryFlag.jsx');
  CountryFlag = flags.default; countryFlagUrl = flags.countryFlagUrl;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
const noop = () => {};
test('dashboard includes each requested module without a virtual NIC or fabricated IP', () => {
  const data = { ...defaultState(), session: { connected: false, upload: 1024, download: 2048 }, environment: { desktop: false } };
  const html = renderToStaticMarkup(React.createElement(Dashboard, { data, busy: false, onAction: noop, onSetting: noop, onNavigate: noop, onImport: noop }));
  for (const title of ['仪表盘', '网络速度', '系统代理', '出站模式', '出口 IP', '内网 IP', '流量统计', '规则', '全局', '直连']) assert.ok(html.includes(title), title);
  for (const absent of ['网络检测', 'network-country', '虚拟网卡', '18.182.8.79', '192.168.0.36', 'DEV']) assert.equal(html.includes(absent), false);
  assert.ok(html.includes('1.0 KB')); assert.ok(html.includes('2.0 KB'));
});
test('traffic totals use two labeled data rows without a donut or duplicate legends', () => {
  for (const [upload, download] of [[0, 0], [2726298, 1887437]]) {
    const data = { ...defaultState(), session: { connected: false, upload, download }, environment: { desktop: false } };
    const html = renderToStaticMarkup(React.createElement(Dashboard, { data, busy: false, onAction: noop, onSetting: noop, onNavigate: noop, onImport: noop }));
    const panel = html.slice(html.indexOf('<section class="instrument-card totals-panel"')).split('</section>')[0];
    assert.ok(panel.includes('本次连接累计流量')); assert.equal((panel.match(/class="traffic-total-row"/g) || []).length, 2);
    assert.ok(panel.includes('上传</dt>')); assert.ok(panel.includes('下载</dt>'));
    assert.equal(panel.includes('traffic-donut'), false); assert.equal(panel.includes('totals-legend'), false);
    assert.ok(panel.includes(upload ? '2.6 MB' : '0 B')); assert.ok(panel.includes(download ? '1.8 MB' : '0 B'));
  }
});
test('dashboard module spacing is owned by the parent gap without stacked child margins', async () => {
  const css = await fs.readFile('src/styles.css', 'utf8');
  assert.match(css, /\.instrument-dashboard\s*\{[^}]*gap: var\(--module-gap\)/);
  for (const name of ['dashboard-connect', 'node-speed-test']) {
    const rule = css.match(new RegExp(`\\.${name} \\{([^}]+)\\}`));
    assert.ok(rule); assert.ok(rule[1].includes('margin: 0;')); assert.equal(rule[1].includes('margin-top: 12px'), false);
  }
});
test('dashboard groups compact controls before traffic, parallel addresses and selected-node testing', async () => {
  const data = { ...defaultState(), session: { connected: false }, environment: { desktop: false } };
  const html = renderToStaticMarkup(React.createElement(Dashboard, { data, busy: false, onAction: noop, onSetting: noop, onNavigate: noop, onImport: noop }));
  const groups = ['dashboard-controls', 'instrument-grid', 'address-panels', 'node-speed-test', 'dashboard-connect'];
  for (let i = 1; i < groups.length; i++) assert.ok(html.indexOf(groups[i - 1]) < html.indexOf(groups[i]));
  assert.equal(html.includes('class="instrument-card proxy-panel"'), false); assert.equal(html.includes('outbound-panel'), false);
  assert.equal(html.includes('>选项</button>'), false);
  const css = await fs.readFile('src/styles.css', 'utf8');
  assert.match(css, /\.dashboard-controls\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(128px, 1fr\) minmax\(0, 2fr\)/);
  assert.match(css, /@media \(max-width: 600px\)\s*\{\s*\.dashboard-controls/);
  assert.match(css, /\.outbound-choices\s*\{[^}]*align-items: center;[^}]*margin: 0;/);
});
test('address cards sit side by side and size to content without fixed row heights', async () => {
  const css = await fs.readFile('src/styles.css', 'utf8');
  const rules = [...css.matchAll(/\.address-panels\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(rules.some(rule => rule.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')));
  assert.ok(rules.some(rule => rule.includes('align-items: start')));
  assert.equal(rules.some(rule => /grid-template-rows:|min-height:|height:/.test(rule)), false);
});
test('dashboard keeps only the labeled connect button at the lower right without a status card', async () => {
  for (const connected of [true, false]) {
    const data = { ...defaultState(), session: { connected }, environment: { desktop: false } };
    const html = renderToStaticMarkup(React.createElement(Dashboard, { data, busy: false, onAction: noop, onSetting: noop, onNavigate: noop, onImport: noop }));
    const footer = html.slice(html.indexOf('<footer'));
    assert.ok(footer.includes(connected ? '断开连接' : '连接代理'));
    assert.equal(footer.includes('已连接'), false); assert.equal(footer.includes('未连接'), false);
    assert.equal(footer.includes('尚未选择线路'), false); assert.equal(footer.includes('<strong'), false);
    assert.equal((footer.match(/<button/g) || []).length, 1);
    assert.ok(html.indexOf('<footer') > html.indexOf('totals-panel')); assert.equal(html.includes('dashboard-power'), false);
  }
  const css = await fs.readFile('src/styles.css', 'utf8');
  assert.match(css, /\.instrument-dashboard\s*\{[^}]*min-height: 100%/);
  const footer = css.match(/\.dashboard-connect\s*\{([^}]+)\}/)[1];
  assert.ok(footer.includes('justify-content: flex-end')); assert.ok(footer.includes('margin-top: auto'));
  assert.equal(/border:|background:|position: fixed|position: absolute/.test(footer), false);
});
test('home node tests show only selected-node measurements and disclose usage without a blocking checkbox', () => {
  const data = { ...defaultState(), environment: { desktop: true, speedTesting: true } };
  const node = parseLink('http://example.invalid:8080'); data.nodes = [node]; data.selectedNodeId = node.id;
  const render = () => renderToStaticMarkup(React.createElement(NodeSpeedTest, { data, busy: false, onAction: noop }));
  let html = render(); assert.ok(html.includes('未测')); assert.ok(html.includes('各约 10 秒')); assert.equal(html.includes('20 MiB'), false);
  const start = html.match(/<button[^>]*aria-label="开始当前节点速度测试"[^>]*>/)?.[0];
  assert.ok(start); assert.equal(start.includes('disabled'), false);
  assert.equal(html.includes('type="checkbox"'), false); assert.ok(html.includes('compact-speed-test')); assert.equal(html.includes('测试完成'), false);
  data.speedTest = { nodeId: node.id, phase: 'done', latency: { status: 'ok', delayMs: 61 }, download: { status: 'ok', mbps: 12.3 }, upload: { status: 'failed', reason: '未完成' } };
  html = render(); assert.ok(html.includes('61 ms')); assert.ok(html.includes('12.3 Mbps')); assert.ok(html.includes('失败'));
  data.speedTest.download.status = 'partial'; html = render();
  assert.ok(html.includes('>12.3 Mbps<')); assert.equal(html.includes('约 12.3 Mbps'), false); assert.ok(html.includes('部分连接或传输未完成'));
  data.speedTest.nodeId = 'other'; html = render(); assert.equal(html.includes('12.3 Mbps'), false); assert.equal(html.includes('61 ms'), false);
  data.environment.speedTesting = false; assert.ok(render().includes('下次启动后可用'));
});
test('speed values show current rate while running, then final average without stale live data or extra UI', () => {
  const node = parseLink('http://live.example:8080');
  const data = { ...defaultState(), nodes: [node], selectedNodeId: node.id, environment: { desktop: true, speedTesting: true }, speedTest: { running: true, nodeId: node.id, phase: 'upload', download: { status: 'ok', mbps: 21.52 }, live: { direction: 'upload', mbps: 5.25 } } };
  const render = () => renderToStaticMarkup(React.createElement(NodeSpeedTest, { data, busy: false, onAction: noop }));
  let html = render(); assert.ok(html.includes('21.52 Mbps')); assert.ok(html.includes('5.25 Mbps')); assert.ok(html.includes('当前上传速率')); assert.equal(html.includes('>测试中<'), false);
  data.speedTest.live.mbps = 0; assert.ok(render().includes('0 Mbps'));
  data.speedTest.running = false; data.speedTest.upload = { status: 'ok', mbps: 9.87 };
  html = render(); assert.ok(html.includes('9.87 Mbps')); assert.equal(html.includes('0 Mbps'), false); assert.equal(html.includes('当前上传速率'), false);
  data.speedTest.running = true; data.speedTest.phase = 'warmup-upload'; delete data.speedTest.upload;
  html = render(); assert.ok(html.includes('预热中')); assert.equal(html.includes('0 Mbps'), false);
  data.speedTest.nodeId = 'other'; html = render(); assert.equal(html.includes('21.52 Mbps'), false); assert.equal(html.includes('0 Mbps'), false);
});
test('one click starts the selected node test with explicit confirmation and stopping remains available', () => {
  const node = parseLink('http://selected.example:8080');
  const data = { ...defaultState(), nodes: [node], selectedNodeId: node.id, environment: { desktop: true, speedTesting: true } };
  const calls = [], onAction = (...args) => calls.push(args);
  function findButton(element) {
    if (!element || typeof element !== 'object') return null;
    if (element.type === 'button' && /当前节点速度测试/.test(element.props['aria-label'] || '')) return element;
    for (const child of React.Children.toArray(element.props?.children)) { const found = findButton(child); if (found) return found; }
    return null;
  }
  let button = findButton(NodeSpeedTest({ data, busy: false, onAction }));
  assert.equal(calls.length, 0); assert.equal(!!button.props.disabled, false);
  button.props.onClick(); assert.deepEqual(calls[0], ['speedTest', { nodeId: node.id, confirmed: true }]);
  data.speedTest = { running: true, nodeId: node.id, phase: 'download' };
  button = findButton(NodeSpeedTest({ data, busy: false, onAction })); assert.equal(!!button.props.disabled, false);
  button.props.onClick(); assert.deepEqual(calls[1], ['cancelSpeedTest']);
});
test('terminal proxy UI shows current port, supports connected toggling, and never pretends browser preview can edit Windows', () => {
  const data = { ...defaultState(), settings: { ...defaultState().settings, mixedPort: 18888 }, session: { connected: true }, environment: { desktop: true } };
  const render = () => renderToStaticMarkup(React.createElement(TerminalProxySettings, { data, busy: false, onAction: noop }));
  let html = render(); assert.ok(html.includes('http://127.0.0.1:18888')); assert.ok(html.includes('HTTP_PROXY / HTTPS_PROXY'));
  assert.equal(html.includes('disabled'), false); assert.ok(html.includes('重启终端后生效'));
  data.terminalProxy = { enabled: true, address: 'http://127.0.0.1:18888' }; html = render(); assert.ok(html.includes('aria-checked="true"')); assert.ok(html.includes('恢复原来的环境变量'));
  data.environment.desktop = false; html = render(); assert.ok(html.includes('disabled')); assert.ok(html.includes('仅桌面端可设置'));
});
test('outbound choices stay enabled while connected, and only lock during a pending action', () => {
  const data = { ...defaultState(), session: { connected: true }, environment: { desktop: false } };
  const render = busy => renderToStaticMarkup(React.createElement(Dashboard, { data, busy, onAction: noop, onSetting: noop, onNavigate: noop, onImport: noop, duration: '00:00:01' }));
  const choices = render(false).match(/<button[^>]*role="radio"[^>]*>/g);
  assert.equal(choices.length, 3); assert.ok(choices.every(button => !button.includes('disabled')));
  assert.ok((render(true).match(/<button[^>]*role="radio"[^>]*>/g)).every(button => button.includes('disabled')));
});
test('node cards remove filters and options while preserving measured statuses and independent identities', () => {
  const data = { ...defaultState(), session: { connected: false } };
  data.nodes = [parseLink('http://one.example:8080#同名'), parseLink('http://two.example:8080#同名')];
  data.selectedNodeId = data.nodes[0].id;
  data.nodeChecks = { [data.nodes[0].id]: { status: 'ok', delayMs: 89, measurement: 'warm', checkedAt: Date.now() }, [data.nodes[1].id]: { status: 'failed', label: '连接被重置' } };
  const html = renderToStaticMarkup(React.createElement(NodeManager, { data, preferredGroup: 'manual', busy: false, onAction: noop, onImport: noop, onDeleteNode: noop }));
  assert.ok(html.includes('node-card-grid')); assert.ok(html.includes('89')); assert.ok(html.includes('不能用'));
  for (const text of ['搜索线路', '节点分组', '节点排序', '更多选项', '连接被重置']) assert.equal(html.includes(text), false);
  assert.equal((html.match(/role="listitem"/g) || []).length, 2);
  for (const node of data.nodes) assert.ok(html.includes(node.id.slice(0, 8)));
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
});
test('node cards apply delay order and persisted hide preference while keeping batch retest available', () => {
  const data = { ...defaultState(), session: { connected: false } };
  data.nodes = [parseLink('http://one.example:8080#慢线路'), parseLink('http://two.example:8080#快线路'), parseLink('http://three.example:8080#失败线路')];
  data.nodeChecks = { [data.nodes[0].id]: { status: 'ok', delayMs: 284, checkedAt: Date.now() }, [data.nodes[1].id]: { status: 'ok', delayMs: 50, checkedAt: Date.now() }, [data.nodes[2].id]: { status: 'failed' } };
  const render = () => renderToStaticMarkup(React.createElement(NodeManager, { data, preferredGroup: 'manual', busy: false, onAction: noop, onImport: noop, onDeleteNode: noop }));
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { localStorage: { getItem: () => 'false' } };
    let html = render(); assert.ok(html.indexOf('选择 快线路') < html.indexOf('选择 慢线路')); assert.ok(html.indexOf('选择 慢线路') < html.indexOf('选择 失败线路'));
    globalThis.window.localStorage.getItem = () => 'true';
    html = render(); assert.equal(html.includes('失败线路'), false); assert.ok(html.includes('显示全部'));
    data.nodeChecks[data.nodes[0].id] = { status: 'failed' }; data.nodeChecks[data.nodes[1].id] = { status: 'failed' };
    html = render(); assert.ok(html.includes('不可用节点已隐藏'));
    assert.equal(html.match(/<button[^>]*title="测试当前来源的线路"[^>]*>/)[0].includes('disabled'), false);
    assert.equal(data.nodes.length, 3);
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});
test('node card view displays only the chosen source and never leaks other subscriptions or manual nodes', () => {
  const data = { ...defaultState(), session: { connected: false }, subscriptions: [{ id: 'a', name: '订阅甲' }, { id: 'b', name: '订阅乙' }] };
  data.nodes = [{ ...parseLink('http://one.example:8080#甲节点'), subscriptionId: 'a' }, parseLink('http://manual.example:8080#独立节点一'), { ...parseLink('http://two.example:8080#乙节点'), subscriptionId: 'b' }];
  const html = renderToStaticMarkup(React.createElement(NodeManager, { data, busy: false }));
  assert.ok(html.includes('甲节点')); assert.equal(html.includes('乙节点'), false); assert.equal(html.includes('独立节点一'), false);
  assert.ok(html.includes('aria-label="订阅甲"'));
  assert.equal(html.includes('node-source-heading'), false);
  assert.equal(html.includes('title="导入订阅或节点"'), false);
  const second = renderToStaticMarkup(React.createElement(NodeManager, { data, preferredGroup: 'b', busy: false }));
  assert.ok(second.includes('乙节点')); assert.equal(second.includes('甲节点'), false); assert.equal(second.includes('独立节点一'), false);
});
test('node card view retains source-specific filtering without a visible filter toolbar', () => {
  const data = { ...defaultState(), session: { connected: false } };
  data.subscriptions = [{ id: 'one', name: '第一订阅' }, { id: 'two', name: '第二订阅' }];
  data.nodes = [{ ...parseLink('http://one.example:8080#独立线路A'), subscriptionId: 'one' }, { ...parseLink('http://two.example:8080#独立线路B'), subscriptionId: 'two' }];
  const html = renderToStaticMarkup(React.createElement(NodeManager, { data, preferredGroup: 'one', busy: false, onAction: noop, onImport: noop }));
  assert.ok(html.includes('独立线路A')); assert.equal(html.includes('独立线路B'), false);
});
test('country flags use bundled SVGs for detected regions with an honest unknown fallback', () => {
  for (const code of ['CN', 'US', 'JP', 'HK', 'TW', 'SG', 'DE', 'GB']) {
    assert.ok(countryFlagUrl(code));
    const html = renderToStaticMarkup(React.createElement(CountryFlag, { code, country: 'Test' }));
    assert.ok(html.includes('class="country-flag"')); assert.ok(html.includes('<img'));
    assert.equal(html.includes('https://'), false);
  }
  assert.equal(countryFlagUrl('cn'), countryFlagUrl('CN'));
  for (const code of [undefined, 'ZZ', '../cn', '']) {
    assert.equal(countryFlagUrl(code), null);
    const html = renderToStaticMarkup(React.createElement(CountryFlag, { code }));
    assert.ok(html.includes('<svg')); assert.equal(html.includes('<img'), false);
  }
});
test('outbound modes change actual core routing without deleting user rules', () => {
  const s = defaultState(); s.nodes = [parseLink('http://upstream.example:8080')]; s.selectedNodeId = s.nodes[0].id;
  s.rules = [{ process: 'example.exe', action: 'reject', enabled: true }];
  assert.ok(createConfig(s).route.rules.some(r => r.process_name?.includes('example.exe')));
  s.settings.outboundMode = 'global'; s.settings.defaultAction = 'direct';
  const global = createConfig(s); assert.equal(global.experimental.clash_api.default_mode, 'Global');
  assert.ok(global.route.rules.some(r => r.clash_mode === 'Global' && r.outbound === 'proxy'));
  assert.ok(global.route.rules.some(r => r.clash_mode === 'Rule' && r.process_name?.includes('example.exe')));
  s.settings.outboundMode = 'direct'; const direct = createConfig(s);
  assert.equal(direct.experimental.clash_api.default_mode, 'Direct');
  assert.ok(direct.route.rules.some(r => r.clash_mode === 'Direct' && r.outbound === 'direct'));
  assert.ok(direct.dns.rules.some(r => r.clash_mode === 'Direct' && r.server === 'bootstrap'));
  assert.equal(s.rules.length, 1);
  s.settings.outboundMode = 'rule'; assert.equal(createConfig(s).route.final, 'direct');
  assert.deepEqual(createConfig(s).route.rules[2].inbound, ['tun-in']);
});
test('LAN addresses exclude loopback, link-local and virtual adapters', () => {
  assert.deepEqual(info.localAddresses({ Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }, { family: 'IPv6', internal: false, address: 'fe80::1' }], loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], SuperVPN: [{ family: 'IPv4', internal: false, address: '172.19.0.1' }], WiFi: [{ family: 'IPv4', internal: false, address: '169.254.2.3' }] }), ['192.168.1.8']);
  assert.throws(() => info.parsePublicInfo({ ip: 'not-an-ip' }));
  assert.throws(() => info.parsePublicInfo({ ip: '1.1.1.1', success: false }));
});
test('public detection uses fixed verified HTTPS and explicit proxy only when connected', async () => {
  const configs = [], urls = [];
  const client = { setProxy: async config => configs.push(config), closeAllConnections: async () => {}, fetch: async (url, options) => { urls.push([url, options]); return new Response(JSON.stringify({ ip: '203.0.113.1', country: 'Test', country_code: 'US', success: true })); } };
  const electron = { fromPartition: () => client };
  const proxy = await info.inspectNetwork(electron, { connected: true, mode: 'system', port: 17890 });
  assert.equal(proxy.publicIp, '203.0.113.1'); assert.equal(proxy.path, 'proxy');
  assert.equal(configs[0].proxyRules, 'http=127.0.0.1:17890;https=127.0.0.1:17890');
  assert.equal(urls[0][0], 'https://ipwho.is/'); assert.equal(urls[0][1].redirect, 'error');
  const direct = await info.inspectNetwork(electron, { connected: false, mode: 'system', port: 17890 });
  assert.equal(direct.path, 'direct'); assert.equal(configs[1].mode, 'direct');
  const tun = await info.inspectNetwork(electron, { connected: true, mode: 'tun', port: 17890 });
  assert.equal(tun.publicIp, null); assert.ok(tun.error); assert.equal(configs.length, 2);
});
test('failed public detection still returns local addresses and never invents an IP', async () => {
  const client = { setProxy: async () => {}, closeAllConnections: async () => {}, fetch: async () => { throw new Error('offline'); } };
  const result = await info.inspectNetwork({ fromPartition: () => client }, { connected: false, mode: 'system' });
  assert.equal(result.publicIp, null); assert.ok(result.error); assert.ok(Array.isArray(result.localIps));
});
