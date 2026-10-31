import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
const { testLatency, getTestConcurrency, createLatencyConfig, createDiagnosticCollector } = createRequire(import.meta.url)('../electron/latency.cjs');
const core = fileURLToPath(new URL('../resources/core/sing-box.exe', import.meta.url));
const realCore = process.platform === 'win32' && existsSync(core);
function localNodes(port, count) {
  const state = defaultState();
  state.nodes = Array.from({ length: count }, (_, i) => parseLink(`http://route-${i}:test-password@127.0.0.1:${port}#Local-${i}`));
  state.selectedNodeId = state.nodes[0].id; return state;
}
test('default batch covers all 29 nodes while large subscriptions remain bounded', () => {
  assert.equal(getTestConcurrency(29), 29);
  assert.equal(getTestConcurrency(2000), 32);
  assert.equal(getTestConcurrency(2000, 9999), 64);
  assert.equal(getTestConcurrency(29, 8), 8);
  assert.equal(getTestConcurrency(29, -1), 1);
});
test('one authenticated listener maps every probe to its own outbound, never a direct fallback', () => {
  const state = localNodes(1080, 3);
  const config = createLatencyConfig(state.nodes, createConfig(state), 31000, 'run-password', 'run-user');
  assert.equal(config.inbounds.length, 1);
  assert.equal(config.inbounds[0].listen, '127.0.0.1');
  assert.equal(config.inbounds[0].users.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(config.route.rules[i].auth_user, [`run-user-${i}`]);
    assert.equal(config.route.rules[i].outbound, config.outbounds[i].tag);
    assert.equal(config.outbounds[i].username, `route-${i}`);
  }
  assert.equal(config.route.rules.at(-1).action, 'reject');
  assert.equal(config.experimental, undefined);
  assert.equal(JSON.stringify(config).includes('process_name'), false);
  config.outbounds[0].username = 'modified';
  assert.equal(state.nodes[0].outbound.username, 'route-0');
});
test('parallel diagnostics stay associated with the exact outbound, including split log chunks', () => {
  const logs = createDiagnosticCollector();
  logs.record('ERROR outbound/anytls[latency-out-0]: x509: certificate signed by unknown authority\n');
  logs.record('ERROR outbound/http[latency-out-1]: i/o time');
  logs.record('out\nERROR outbound/http[latency-out-10]: authentication failed\n');
  assert.match(logs.forNode(0), /unknown authority/);
  assert.match(logs.forNode(1), /i\/o timeout/);
  assert.doesNotMatch(logs.forNode(1), /certificate|authentication/);
  assert.doesNotMatch(logs.forNode(10), /certificate|timeout/);
  assert.equal(logs.forNode(2), '');
});
test('29 real simultaneous upstream requests use one core and 29 distinct routes', { skip: !realCore, timeout: 20000 }, async t => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-parallel-'));
  const server = http.createServer(), sockets = new Set(), routes = new Set(), corePids = [];
  let active = 0, peak = 0, started = 0, startedAtFirstResult = 0;
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  server.on('connect', (request, socket) => {
    const auth = request.headers['proxy-authorization'] || '';
    routes.add(Buffer.from(auth.replace(/^Basic /i, ''), 'base64').toString().split(':')[0]);
    active++; peak = Math.max(peak, active);
    let finished = false;
    const done = () => { if (!finished) { finished = true; active--; } };
    socket.once('close', done);
    setTimeout(() => { done(); if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); }, 400);
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const state = localNodes(server.address().port, 29), results = [];
    await testLatency({ nodes: state.nodes, config: createConfig(state), core, runtimeFile: path.join(work, 'runtime.json'), signal: new AbortController().signal,
      onCoreStart: pid => corePids.push(pid), onStart: () => started++, onResult: (id, result) => { if (!results.length) startedAtFirstResult = started; results.push({ id, ...result }); }
    });
    assert.equal(corePids.length, 1);
    assert.equal(started, 29); assert.equal(startedAtFirstResult, 29);
    assert.equal(results.length, 29); assert.equal(new Set(results.map(r => r.id)).size, 29);
    assert.equal(routes.size, 29, 'authentication routing must not accidentally test the same node repeatedly');
    assert.equal(peak, 29, 'all 29 upstream requests must overlap, not just display a testing label');
    assert.ok(results.every(r => r.status === 'failed' && r.delayMs === undefined));
    assert.deepEqual(await fs.readdir(work), []);
    t.diagnostic(`actual core processes=${corePids.length}; peak concurrent upstream requests=${peak}; unique tested routes=${routes.size}`);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(work, { recursive: true, force: true }); }
});
test('cancelling a parallel batch promptly stops every pending request and removes its config', { skip: !realCore, timeout: 15000 }, async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-cancel-'));
  const controller = new AbortController(), server = http.createServer(), sockets = new Set();
  let timer, started = 0, results = 0, coreStarts = 0;
  // Reset errors are expected when the cancelled core closes black-hole sockets.
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  server.on('connect', () => { timer ||= setTimeout(() => controller.abort(), 150); });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const state = localNodes(server.address().port, 29);
    await testLatency({ nodes: state.nodes, config: createConfig(state), core, runtimeFile: path.join(work, 'runtime.json'), signal: controller.signal,
      onCoreStart: () => coreStarts++, onStart: () => started++, onResult: () => results++
    });
    assert.equal(controller.signal.aborted, true);
    assert.equal(coreStarts, 1); assert.equal(started, 29); assert.equal(results, 0);
    assert.deepEqual(await fs.readdir(work), []);
  } finally { clearTimeout(timer); controller.abort(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(work, { recursive: true, force: true }); }
});
