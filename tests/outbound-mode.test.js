import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
import modeApi from '../electron/outbound-mode.cjs';
const { applyCoreMode, changeLiveMode } = modeApi;
const core = fileURLToPath(new URL('../resources/core/sing-box.exe', import.meta.url));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const freePort = async () => { const server = net.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve)); return port; };
test('controller mode changes require readback, not just a successful PATCH', async () => {
  let count = 0;
  await assert.rejects(() => applyCoreMode('global', { port: 1, secret: 'test', request: async (_, options) => { count++; return options.method === 'PATCH' ? new Response(null, { status: 204 }) : Response.json({ mode: 'Rule' }); } }), /未确认/);
  assert.equal(count, 2);
});
test('persist happens after core confirmation and failures roll back the running mode', async () => {
  const calls = [];
  await assert.rejects(() => changeLiveMode({ previous: 'rule', next: 'global', apply: async mode => calls.push(mode), persist: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.deepEqual(calls, ['global', 'rule']);
  await assert.rejects(() => changeLiveMode({ previous: 'rule', next: 'global', apply: async () => { throw new Error('offline'); }, persist: async () => {} }), /无法确认回退/);
});
test('real running core switches new connections between direct and proxy without restart or closing an existing stream', { skip: process.platform !== 'win32' || !existsSync(core), timeout: 20000 }, async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-live-mode-'));
  let proc, proxyRequests = 0, heldResponse, streamEnded = false, streamRequest;
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); };
  const target = http.createServer((req, res) => {
    if (req.url === '/hold') { heldResponse = res; res.writeHead(200); res.write('open'); }
    else res.end('real-target');
  });
  const upstream = http.createServer();
  target.on('connection', track); upstream.on('connection', track);
  upstream.on('connect', (req, socket, head) => {
    proxyRequests++;
    const [host, port] = req.url.split(':');
    const remote = net.connect(Number(port), host, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) remote.write(head); socket.pipe(remote); remote.pipe(socket); });
    track(remote); socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy()); socket.on('close', () => remote.destroy());
  });
  try {
    const targetPort = await listen(target), upstreamPort = await listen(upstream), port = await freePort(), controllerPort = await freePort();
    const state = defaultState(); state.settings.mixedPort = port; state.settings.bypassLan = false; state.settings.defaultAction = 'direct';
    state.nodes = [parseLink(`http://127.0.0.1:${upstreamPort}`)]; state.selectedNodeId = state.nodes[0].id;
    const file = path.join(work, 'core.json'); await fs.writeFile(file, JSON.stringify(createConfig(state, { controllerPort, controllerSecret: 'live-test' })));
    proc = spawn(core, ['run', '-c', file], { windowsHide: true, stdio: 'ignore' });
    const pid = proc.pid, options = { port: controllerPort, secret: 'live-test' };
    let ready = false;
    for (let i = 0; i < 40; i++) { try { await applyCoreMode('rule', options); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    assert.ok(ready, 'core controller ready');
    const request = route => new Promise((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: `http://127.0.0.1:${targetPort}${route}`, agent: false }, res => { let body = ''; res.on('data', data => body += data); res.on('end', () => resolve(body)); res.on('error', reject); });
      req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('request timeout')));
    });
    await new Promise((resolve, reject) => {
      streamRequest = http.get({ hostname: '127.0.0.1', port, path: `http://127.0.0.1:${targetPort}/hold`, agent: false }, res => { res.once('data', resolve); res.on('end', () => { streamEnded = true; }); res.on('error', () => { streamEnded = true; }); });
      streamRequest.on('error', reject);
    });
    assert.equal(await request('/rule'), 'real-target'); assert.equal(proxyRequests, 0);
    await applyCoreMode('global', options); assert.equal(await request('/global'), 'real-target'); assert.equal(proxyRequests, 1);
    await applyCoreMode('direct', options); assert.equal(await request('/direct'), 'real-target'); assert.equal(proxyRequests, 1);
    await applyCoreMode('rule', options); assert.equal(await request('/rule-again'), 'real-target'); assert.equal(proxyRequests, 1);
    assert.equal(proc.pid, pid); assert.equal(proc.exitCode, null); assert.equal(streamEnded, false); assert.equal(heldResponse.destroyed, false);
  } finally {
    streamRequest?.destroy(); heldResponse?.end();
    if (proc && proc.exitCode === null) await new Promise(resolve => { proc.once('exit', resolve); proc.kill(); });
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(resolve => upstream.close(resolve)), new Promise(resolve => target.close(resolve))]);
    await fs.rm(work, { recursive: true, force: true });
  }
});
