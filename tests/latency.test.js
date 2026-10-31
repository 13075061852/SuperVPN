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
const { testLatency } = createRequire(import.meta.url)('../electron/latency.cjs');
const core = fileURLToPath(new URL('../resources/core/sing-box.exe', import.meta.url));
test('latency checker uses an isolated real core, reports failure honestly and cleans credentials', { skip: process.platform !== 'win32' || !existsSync(core), timeout: 20000 }, async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-latency-'));
  const server = http.createServer(), sockets = new Set(); let requests = 0;
  server.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)); });
  server.on('connect', (_, socket) => { requests++; socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); });
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const s = defaultState(); s.nodes = [parseLink(`http://127.0.0.1:${server.address().port}`)]; s.selectedNodeId = s.nodes[0].id;
    const results = [], started = [];
    await testLatency({ nodes: s.nodes, config: createConfig(s), core, runtimeFile: path.join(work, 'runtime.json'), signal: new AbortController().signal, onStart: id => started.push(id), onResult: (id, result) => results.push({ id, ...result }) });
    assert.equal(started.length, 1); assert.equal(results.length, 1); assert.equal(results[0].status, 'failed');
    assert.equal(requests, 1, 'the request must actually reach the selected upstream');
    assert.equal(results[0].delayMs, undefined); assert.equal(existsSync(path.join(work, 'runtime.json')), false);
    assert.deepEqual(await fs.readdir(work), []);
  } finally {
    for (const s of sockets) s.destroy(); await new Promise(r => server.close(r));
    await fs.rm(work, { recursive: true, force: true });
  }
});
