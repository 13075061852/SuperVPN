import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaultState, parseLink, createConfig } from '../shared/proxy.js';
const core = fileURLToPath(new URL('../resources/core/sing-box.exe', import.meta.url));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const freePort = async () => { const s = net.createServer(); const port = await listen(s); await new Promise(r => s.close(r)); return port; };
test('real sing-box validates configurations and forwards through a local HTTP upstream without changing Windows proxy', { skip: process.platform !== 'win32' || !existsSync(core), timeout: 20000 }, async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-integration-'));
  let process, logs = '', reached = false;
  const sockets = new Set();
  const upstream = http.createServer();
  upstream.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  upstream.on('connect', (req, socket, head) => {
    reached = true;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const respond = () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nsupervpn-test');
    if (head.length) respond(); else socket.once('data', respond);
  });
  try {
    const upstreamPort = await listen(upstream);
    const s = defaultState(), node = parseLink(`http://127.0.0.1:${upstreamPort}`);
    s.nodes = [node]; s.selectedNodeId = node.id; s.settings.mixedPort = await freePort();
    // Private ranges must go through the local test upstream for this isolated test.
    s.settings.bypassLan = false;
    const controllerPort = await freePort();
    for (const mode of ['system', 'tun']) {
      s.mode = mode;
      const file = path.join(work, `${mode}.json`);
      await fs.writeFile(file, JSON.stringify(createConfig(s, { controllerPort, controllerSecret: 'test-secret' })));
      execFileSync(core, ['check', '-c', file], { windowsHide: true });
      for (const outbound of ['global', 'direct']) {
        s.settings.outboundMode = outbound;
        const variant = path.join(work, `${mode}-${outbound}.json`);
        await fs.writeFile(variant, JSON.stringify(createConfig(s, { controllerPort, controllerSecret: 'test-secret' })));
        execFileSync(core, ['check', '-c', variant], { windowsHide: true });
      }
      s.settings.outboundMode = 'rule';
    }
    process = spawn(core, ['run', '-c', path.join(work, 'system.json')], { windowsHide: true });
    process.stdout.on('data', d => { logs += d; }); process.stderr.on('data', d => { logs += d; });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { const response = await fetch(`http://127.0.0.1:${controllerPort}/version`, { headers: { Authorization: 'Bearer test-secret' }, signal: AbortSignal.timeout(250) }); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, logs);
    const denied = await fetch(`http://127.0.0.1:${controllerPort}/version`);
    assert.equal(denied.status, 401);
    const result = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: s.settings.mixedPort, path: 'http://198.18.0.1/check', headers: { Host: '198.18.0.1' }, timeout: 4000 }, response => { let body = ''; response.on('data', d => body += d); response.on('end', () => resolve(body)); });
      request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Test proxy request timed out')));
    });
    assert.equal(result, 'supervpn-test', logs);
    assert.ok(reached, 'HTTP upstream was actually reached');
  } finally {
    if (process && process.exitCode === null) await new Promise(resolve => { process.once('exit', resolve); process.kill(); });
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => upstream.close(resolve));
    await fs.rm(work, { recursive: true, force: true });
  }
});
