import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { normalizeDomain, setWebsiteRule, removeWebsiteRule, websiteRuleList } from '../shared/website-rules.js';
import { defaultState, parseLink, createConfig, processPathRegex } from '../shared/proxy.js';

test('website inputs normalize URLs, IDN and suffixes but reject secrets, IPs and invalid patterns', () => {
  assert.equal(normalizeDomain('  *.Example.COM. '), 'example.com');
  assert.equal(normalizeDomain('https://Example.com/path?q=1'), 'example.com');
  assert.equal(normalizeDomain('例子.中国'), 'xn--fsqu00a.xn--fiqs8s');
  for (const value of ['', 'a b.com', 'http://u:p@example.com', '127.0.0.1', '[::1]', 'example.com:123', '*.foo.*', 'example.com/path', 'ftp://example.com', '-bad.com']) assert.throws(() => normalizeDomain(value), value);
});
test('website edits preserve ids, other rules and preferences and can disable, re-enable or remove a domain', () => {
  const original = { ...defaultState(), rules: [{ id: 'app', process: 'browser.exe', action: 'proxy', enabled: true }] };
  let state = setWebsiteRule(original, { domain: 'example.com', action: 'direct' }, () => 'website-1');
  assert.equal(original.websiteRules.length, 0); assert.equal(state.rules, original.rules); assert.equal(state.settings, original.settings);
  state = setWebsiteRule(state, { domain: 'EXAMPLE.COM', action: 'reject', enabled: false });
  assert.equal(state.websiteRules.length, 1); assert.equal(state.websiteRules[0].id, 'website-1'); assert.equal(state.websiteRules[0].enabled, false);
  state = setWebsiteRule(state, { domain: 'example.com', action: 'proxy' }); assert.equal(state.websiteRules[0].enabled, false);
  state = setWebsiteRule(state, { domain: 'example.com', action: 'proxy', enabled: true });
  assert.equal(removeWebsiteRule(state, 'website-1').websiteRules.length, 0);
  assert.throws(() => removeWebsiteRule(state, 'missing')); assert.throws(() => setWebsiteRule(state, { domain: 'example.com', action: 'invalid' }));
  assert.throws(() => websiteRuleList({ websiteRules: Array(1001).fill({}) }), /1000/);
});
test('specific website routes override broader websites and program rules only in rule mode; direct DNS follows direct routes', () => {
  const node = parseLink('http://example.invalid:8080');
  let state = { ...defaultState(), nodes: [node], selectedNodeId: node.id, rules: [{ process: 'browser.exe', action: 'proxy', enabled: true }] };
  state = setWebsiteRule(state, { domain: 'example.com', action: 'proxy' });
  state = setWebsiteRule(state, { domain: 'private.example.com', action: 'direct' });
  state = setWebsiteRule(state, { domain: 'blocked.test', action: 'reject' });
  state = setWebsiteRule(state, { domain: 'disabled.test', action: 'direct', enabled: false });
  for (const mode of ['rule', 'global', 'direct']) {
    const config = createConfig({ ...state, settings: { ...state.settings, outboundMode: mode } });
    const routes = config.route.rules, specific = routes.findIndex(rule => rule.domain_suffix?.includes('private.example.com')), broad = routes.findIndex(rule => rule.domain_suffix?.includes('example.com')), program = routes.findIndex(rule => rule.process_path_regex?.includes(processPathRegex('browser.exe')));
    assert.ok(specific < broad && broad < program); assert.equal(routes[specific].clash_mode, 'Rule'); assert.equal(routes[specific].outbound, 'direct');
    assert.ok(routes.some(rule => rule.domain_suffix?.includes('blocked.test') && rule.action === 'reject'));
    assert.equal(routes.some(rule => rule.domain_suffix?.includes('disabled.test')), false);
    assert.ok(config.dns.rules.some(rule => rule.clash_mode === 'Rule' && rule.domain_suffix?.includes('private.example.com') && rule.server === 'bootstrap'));
    assert.equal(config.experimental.clash_api.default_mode, { rule: 'Rule', global: 'Global', direct: 'Direct' }[mode]);
  }
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const freePort = async () => { const server = net.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; };
test('real sing-box routes two websites differently in the same client and blocks a third without touching system proxy', { skip: process.platform !== 'win32' || !existsSync('resources/core/sing-box.exe'), timeout: 15000 }, async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-website-core-')), sockets = new Set();
  const destination = http.createServer((_req, res) => res.end('direct-website'));
  const upstream = http.createServer();
  for (const server of [destination, upstream]) server.on('connection', socket => { sockets.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => sockets.delete(socket)); });
  const targets = []; let proc, logs = '';
  upstream.on('connect', (req, socket, head) => { targets.push(req.url); socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); const respond = () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nproxy-website'); if (head.length) respond(); else socket.once('data', respond); });
  try {
    const destinationPort = await listen(destination), upstreamPort = await listen(upstream), port = await freePort(), controllerPort = await freePort();
    const node = parseLink(`http://127.0.0.1:${upstreamPort}`);
    let state = { ...defaultState(), nodes: [node], selectedNodeId: node.id, settings: { ...defaultState().settings, mixedPort: port, bypassLan: false } };
    for (const [domain, action] of [['localhost', 'direct'], ['proxied.test', 'proxy'], ['blocked.test', 'reject']]) state = setWebsiteRule(state, { domain, action });
    const config = createConfig(state, { controllerPort, controllerSecret: 'test-only' });
    config.dns.servers = [{ type: 'hosts', tag: 'bootstrap', predefined: { localhost: '127.0.0.1' } }, { type: 'hosts', tag: 'remote', predefined: { localhost: '127.0.0.1' } }];
    const file = path.join(work, 'website.json'); await fs.writeFile(file, JSON.stringify(config));
    const core = path.resolve('resources/core/sing-box.exe'); execFileSync(core, ['check', '-c', file], { windowsHide: true });
    proc = spawn(core, ['run', '-c', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', chunk => logs += chunk); proc.stderr.on('data', chunk => logs += chunk);
    let ready = false;
    for (let i = 0; i < 40; i++) {
      ready = await new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); const finish = value => { socket.destroy(); resolve(value); }; socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); });
      if (ready) break; await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready);
    const request = domain => new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: `http://${domain}:${destinationPort}/check`, headers: { Host: `${domain}:${destinationPort}` }, agent: false }, res => { if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; } let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve(text)); res.on('error', reject); });
      req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    });
    assert.equal(await request('localhost').catch(error => { throw new Error(`${error.message}\n${logs}`); }), 'direct-website', logs); assert.equal(targets.length, 0);
    assert.equal(await request('proxied.test'), 'proxy-website'); assert.ok(targets[0].startsWith('proxied.test:'));
    await assert.rejects(request('blocked.test')); assert.equal(targets.length, 1);
    // Outer TLS ECH SNI must not override an already-known CONNECT domain (localhost stays direct).
    const tlsHello = sni => {
      const sniBuf = Buffer.from(sni, 'ascii');
      const ext = Buffer.concat([Buffer.from([0x00, 0x00]), Buffer.alloc(2), Buffer.alloc(2), Buffer.from([0x00]), Buffer.alloc(2), sniBuf]);
      ext.writeUInt16BE(sniBuf.length + 5, 2); ext.writeUInt16BE(sniBuf.length + 3, 4); ext.writeUInt16BE(sniBuf.length, 7);
      const body = Buffer.concat([Buffer.from([0x03, 0x03]), Buffer.alloc(32, 1), Buffer.from([0x00, 0x00, 0x02, 0x13, 0x01, 0x01, 0x00]), Buffer.alloc(2), ext]);
      body.writeUInt16BE(ext.length, body.length - ext.length - 2);
      const hs = Buffer.concat([Buffer.from([0x01, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255]), body]);
      return Buffer.concat([Buffer.from([0x16, 0x03, 0x01, (hs.length >> 8) & 255, hs.length & 255]), hs]);
    };
    const connectTls = (host, sni) => new Promise((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => sock.write(`CONNECT ${host}:${destinationPort} HTTP/1.1\r\nHost: ${host}:${destinationPort}\r\n\r\n`));
      let buf = '', opened = false;
      sock.on('data', chunk => {
        buf += chunk.toString();
        if (!opened && buf.includes('\r\n\r\n')) {
          opened = true; sock.write(tlsHello(sni));
          setTimeout(() => { sock.destroy(); resolve(); }, 200);
        }
      });
      sock.on('error', () => resolve());
      sock.setTimeout(2000, () => { sock.destroy(); reject(new Error('timeout')); });
    });
    await connectTls('localhost', 'cloudflare-ech.com');
    assert.equal(targets.length, 1, 'direct CONNECT domain must not be overridden by ECH SNI');
    // Raw IP CONNECT still sniffs TLS SNI and routes to proxy.
    await connectTls('127.0.0.1', 'proxied.test');
    assert.equal(targets.length, 2, 'raw IP CONNECT must still sniff TLS SNI');
  } finally {
    if (proc && proc.exitCode === null) await new Promise(resolve => { proc.once('exit', resolve); proc.kill(); });
    for (const socket of sockets) socket.destroy();
    for (const server of [upstream, destination]) if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(work, { recursive: true, force: true });
  }
});
let vite, cache, WebsiteRouting, Routing;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-website-ui-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  WebsiteRouting = (await vite.ssrLoadModule('/src/WebsiteRouting.jsx')).default; Routing = (await vite.ssrLoadModule('/src/Routing.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('website UI enables connected deferred editing and protects older backends', () => {
  const data = { ...defaultState(), session: { connected: false }, environment: { desktop: true, websiteRouting: true }, websiteRules: [{ id: 'web-1', domain: 'example.com', action: 'direct', enabled: true }] };
  const render = Component => renderToStaticMarkup(React.createElement(Component, { data, busy: false, onAction: () => {} }));
  let html = render(Routing); assert.ok(html.includes('分流类型')); assert.ok(html.includes('网站')); assert.ok(html.includes('程序')); assert.equal(html.includes('website-rule-hint'), false);
  assert.match(html, /aria-label="新网站网络规则"[\s\S]*?<option value="direct" selected="">直连<\/option>/);
  assert.ok(html.includes('example.com 网站规则')); assert.ok(html.includes('删除 example.com')); assert.doesNotMatch(html, /<select[^>]*disabled/);
  data.session.connected = true; data.environment.websiteOpening = true; data.environment.connectedEditing = true; html = render(WebsiteRouting); assert.equal(html.includes('website-rule-hint'), false); assert.doesNotMatch(html, /<select[^>]*disabled/);
  assert.doesNotMatch(html, /aria-label="删除 example.com 网站规则"[^>]*disabled/);
  data.environment.connectedEditing = false; const legacy = render(WebsiteRouting); assert.ok(legacy.includes('下次正常启动')); assert.match(legacy, /<select[^>]*disabled/);
  data.environment.connectedEditing = true;
  assert.match(html, /<button type="button" class="icon-button" aria-label="在默认浏览器打开 example.com" title="在默认浏览器打开 https:\/\/example.com\/">/);
  data.environment.websiteOpening = false; html = render(WebsiteRouting);
  assert.match(html, /aria-label="在默认浏览器打开 example.com"[^>]*disabled/);
  data.session.connected = false; data.environment.websiteRouting = false; html = render(WebsiteRouting); assert.ok(html.includes('下次正常启动')); assert.match(html, /<input[^>]*disabled/);
  // Routing keeps reconnectRequired notice and subdomain conflict note without static hint clutter.
  data.environment.websiteRouting = true; data.session.connected = true; data.reconnectRequired = true; data.settings.outboundMode = 'global';
  data.websiteRules = [{ id: 'sub', domain: 'tongyi.aliyun.com', action: 'direct', enabled: true }, { id: 'root', domain: 'aliyun.com', action: 'proxy', enabled: true }];
  const routingHtml = render(Routing);
  assert.ok(routingHtml.includes('设置已更改，需要重连后生效'));
  assert.equal(routingHtml.includes('website-rule-hint'), false);
  assert.ok(routingHtml.includes('子域名 tongyi.aliyun.com 优先（直连）'));
});
test('real sing-box matches Windows program rules case-insensitively without touching system proxy', { skip: process.platform !== 'win32' || !existsSync('resources/core/sing-box.exe'), timeout: 15000 }, async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-prog-case-')), sockets = new Set();
  const destination = http.createServer((_req, res) => res.end('direct-prog'));
  const upstream = http.createServer();
  for (const server of [destination, upstream]) server.on('connection', socket => { sockets.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => sockets.delete(socket)); });
  let proxyHits = 0, proc, logs = '';
  upstream.on('connect', (_req, socket, head) => { proxyHits++; socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); const respond = () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nproxy-prog'); if (head.length) respond(); else socket.once('data', respond); });
  try {
    const destinationPort = await listen(destination), upstreamPort = await listen(upstream), port = await freePort(), controllerPort = await freePort();
    const node = parseLink(`http://127.0.0.1:${upstreamPort}`);
    const state = { ...defaultState(), nodes: [node], selectedNodeId: node.id, rules: [{ id: 'p1', process: 'NoDe.ExE', action: 'direct', enabled: true }], settings: { ...defaultState().settings, mixedPort: port, bypassLan: false } };
    const config = createConfig(state, { controllerPort, controllerSecret: 'test-only' });
    config.dns.servers = [{ type: 'hosts', tag: 'bootstrap', predefined: { 'app.test': '127.0.0.1' } }, { type: 'hosts', tag: 'remote', predefined: { 'app.test': '127.0.0.1' } }];
    const file = path.join(work, 'prog.json'); await fs.writeFile(file, JSON.stringify(config));
    const core = path.resolve('resources/core/sing-box.exe'); execFileSync(core, ['check', '-c', file], { windowsHide: true });
    proc = spawn(core, ['run', '-c', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', chunk => logs += chunk); proc.stderr.on('data', chunk => logs += chunk);
    let ready = false;
    for (let i = 0; i < 40; i++) {
      ready = await new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); const finish = value => { socket.destroy(); resolve(value); }; socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); });
      if (ready) break; await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);
    const body = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: `http://app.test:${destinationPort}/`, headers: { Host: `app.test:${destinationPort}` }, agent: false }, res => { let text = ''; res.on('data', c => text += c); res.on('end', () => resolve(text)); res.on('error', reject); });
      req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    });
    assert.equal(body, 'direct-prog', logs);
    assert.equal(proxyHits, 0);
  } finally {
    if (proc && proc.exitCode === null) await new Promise(resolve => { proc.once('exit', resolve); proc.kill(); });
    for (const socket of sockets) socket.destroy();
    for (const server of [upstream, destination]) if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(work, { recursive: true, force: true });
  }
});
