import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { key, cert } from './fixtures/localhost-tls.js';
const { runSpeedTest, transfer, sustainedTransfer, createSpeedSampler, rateMbps, DOWNLOAD_BYTES, UPLOAD_BYTES } = createRequire(import.meta.url)('../desktop/speed-test.cjs');
const credentials = { username: 'single-node', password: 'test-only' };
async function fixture(handler, run) {
  const sockets = new Set(), auth = [];
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket; };
  const destination = https.createServer({ key, cert }, handler); destination.on('connection', track); destination.on('tlsClientError', () => {});
  const proxy = http.createServer(); proxy.on('connection', track);
  proxy.on('connect', (req, client, head) => {
    auth.push(req.headers['proxy-authorization']);
    const upstream = track(net.connect(destination.address().port, '127.0.0.1'));
    upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
    client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
  });
  try {
    await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve)); await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    await run({ port: proxy.address().port, target: `https://localhost:${destination.address().port}`, ca: cert, credentials, signal: new AbortController().signal, auth });
  } finally { for (const socket of sockets) socket.destroy(); await Promise.all([new Promise(resolve => destination.close(resolve)), new Promise(resolve => proxy.close(resolve))]); }
}
test('single isolated real core completes latency, download and upload without system proxy changes', { timeout: 20000, skip: !existsSync('resources/core/sing-box.exe') }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-speed-core-')), runtimeFile = path.join(directory, 'probe.json');
  try {
    await fixture((req, res) => {
      if (req.method === 'HEAD') { res.writeHead(204); res.end(); }
      else if (req.method === 'GET') { const count = Number(new URL(req.url, 'https://localhost').searchParams.get('bytes')); res.writeHead(200, { 'Content-Length': count }); res.end(Buffer.alloc(count)); }
      else { req.resume(); req.on('end', () => res.end('ok')); }
    }, async args => {
      const updates = [];
      await runSpeedTest({ node: { id: 'single-test-node', outbound: { type: 'http', server: '127.0.0.1', server_port: args.port } }, config: { dns: { servers: [{ tag: 'bootstrap', type: 'udp', server: '223.5.5.5' }] } }, core: path.resolve('resources/core/sing-box.exe'), runtimeFile, signal: args.signal, onUpdate: patch => updates.push(patch), latencyOptions: { target: new URL('/generate_204', args.target), ca: cert }, transferOptions: { target: args.target, ca: cert, durationMs: 100, connections: 2, maxPhaseBytes: 512 * 1024, warmupBytes: 16384 } });
      assert.equal(updates.at(-1).phase, 'done', JSON.stringify(updates));
      assert.equal(updates.find(patch => patch.latency)?.latency.status, 'ok');
      assert.ok(updates.find(patch => patch.download)?.download.bytes > 0);
      assert.ok(updates.find(patch => patch.upload)?.upload.bytes > 0);
      assert.ok(updates.some(patch => patch.phase === 'warmup-download')); assert.ok(updates.some(patch => patch.phase === 'warmup-upload'));
      assert.equal(existsSync(runtimeFile), false);
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('live speed uses the recent rolling window, decays to zero when stalled, and can recover', () => {
  let time = 0;
  const sampler = createSpeedSampler({ now: () => time });
  assert.equal(sampler.sample(), null);
  sampler.add(1000000); time = 250; assert.equal(sampler.sample().mbps, 32);
  sampler.add(1000000); time = 500; sampler.sample();
  sampler.add(2000000); time = 750; sampler.sample();
  time = 1000; assert.equal(sampler.sample().mbps, 32);
  time = 1250; assert.equal(sampler.sample().mbps, 24);
  time = 1500; assert.equal(sampler.sample().mbps, 16);
  time = 1750; assert.equal(sampler.sample().mbps, 0);
  time = 2000; sampler.sample();
  sampler.add(250000); time = 2250; assert.equal(sampler.sample().mbps, 2);
  assert.throws(() => sampler.add(-1));
});
test('real streaming emits current throughput before a request completes and stops its timer after completion', { timeout: 8000 }, async () => {
  await fixture((req, res) => {
    let remaining = Number(new URL(req.url, 'https://localhost').searchParams.get('bytes'));
    res.writeHead(200, { 'Content-Length': remaining });
    const timer = setInterval(() => { const count = Math.min(16384, remaining); res.write(Buffer.alloc(count)); remaining -= count; if (!remaining) { clearInterval(timer); res.end(); } }, 30);
    res.once('close', () => clearInterval(timer));
  }, async args => {
    const updates = [];
    const result = await sustainedTransfer({ ...args, direction: 'download', durationMs: 650, connections: 2, warmupBytes: 16384, maxPhaseBytes: 512 * 1024, onProgress: live => updates.push(live) });
    assert.equal(result.status, 'ok'); assert.ok(updates.length >= 2);
    assert.ok(updates.some(live => live.mbps > 0 && live.bytes < result.bytes), 'live values must exist before the whole transfer is acknowledged');
    assert.equal(result.mbps, rateMbps(result.bytes, result.durationMs));
    const count = updates.length; await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(updates.length, count);
    const controller = new AbortController(), cancelled = [];
    await assert.rejects(sustainedTransfer({ ...args, signal: controller.signal, direction: 'download', durationMs: 1000, connections: 1, warmupBytes: 16384, onProgress: live => { cancelled.push(live); controller.abort(); } }), /TEST_CANCELLED/);
    const stopped = cancelled.length; await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(cancelled.length, stopped);
  });
});
test('upload emits transmitted current rates before delayed server acknowledgments and only finalizes after them', { timeout: 6000 }, async () => {
  let acknowledgments = 0;
  await fixture((req, res) => { req.resume(); req.on('end', () => setTimeout(() => { acknowledgments++; res.end('ok'); }, 300)); }, async args => {
    const updates = [];
    const result = await sustainedTransfer({ ...args, direction: 'upload', durationMs: 650, connections: 2, warmupBytes: 16384, maxPhaseBytes: 1024 * 1024, onProgress: live => updates.push(live) });
    assert.equal(result.status, 'ok'); assert.ok(updates.some(live => live.mbps > 0)); assert.ok(acknowledgments > 2);
    assert.equal(result.mbps, rateMbps(result.bytes, result.durationMs));
  });
});
test('parallel throughput reuses its verified warm-up tunnels rather than reconnecting for every request', { timeout: 5000 }, async () => {
  let requests = 0;
  await fixture((req, res) => { requests++; const count = Number(new URL(req.url, 'https://localhost').searchParams.get('bytes')); res.writeHead(200, { 'Content-Length': count }); res.end(Buffer.alloc(count)); }, async args => {
    const result = await sustainedTransfer({ ...args, direction: 'download', durationMs: 100, connections: 2, warmupBytes: 16384, maxPhaseBytes: 1024 * 1024 });
    assert.equal(result.status, 'ok'); assert.ok(result.bytes > 0); assert.equal(result.connections, 2);
    assert.equal(args.auth.length, 2, 'only the two initial authenticated TLS tunnels should be used');
    assert.ok(requests > args.auth.length, 'measurement must reuse the warmed connections');
    assert.equal(result.mbps, rateMbps(result.bytes, result.durationMs));
  });
});
test('sustained measurement excludes warm-up and uses actual bytes divided by one wall-clock duration', async () => {
  let time = 0; const sizes = [], phases = [];
  const result = await sustainedTransfer({ direction: 'download', connections: 1, signal: new AbortController().signal, durationMs: 1000, now: () => time, onPhase: phase => phases.push(phase), measure: async ({ size }) => { sizes.push(size); time += 250; return { status: 'ok', bytes: size, durationMs: 250 }; } });
  assert.deepEqual(phases, ['warmup-download', 'download']);
  assert.equal(result.bytes, sizes.slice(1).reduce((sum, size) => sum + size, 0));
  assert.equal(result.durationMs, 1000); assert.equal(result.mbps, rateMbps(result.bytes, 1000)); assert.equal(result.status, 'ok');
});
test('failure after successful transfer is partial rather than a fake complete result', async () => {
  let calls = 0, time = 0;
  const result = await sustainedTransfer({ direction: 'download', connections: 1, signal: new AbortController().signal, now: () => time, measure: async ({ size }) => { time += 100; if (++calls === 3) throw new Error('timeout'); return { status: 'ok', bytes: size, durationMs: 100 }; } });
  assert.equal(result.status, 'partial'); assert.equal(result.samples, 1); assert.ok(result.bytes > 0); assert.equal(result.mbps, rateMbps(result.bytes, result.durationMs));
  await assert.rejects(sustainedTransfer({ direction: 'download', signal: new AbortController().signal, measure: async () => { throw new Error('timeout'); } }), /timeout/);
});
test('cancelled measurement never turns an incomplete test into success', async () => {
  const controller = new AbortController();
  await assert.rejects(sustainedTransfer({ direction: 'upload', signal: controller.signal, measure: async ({ size }) => { controller.abort(); return { status: 'ok', bytes: size, durationMs: 20 }; } }), /TEST_CANCELLED/);
});
test('rate uses actual byte counts and elapsed time without extrapolating a bandwidth maximum', () => {
  assert.equal(rateMbps(1000000, 1000), 8); assert.ok(DOWNLOAD_BYTES > 0); assert.ok(UPLOAD_BYTES > 0);
  for (const [bytes, time] of [[0, 1000], [10, 0], [-1, 1], [NaN, 1]]) assert.throws(() => rateMbps(bytes, time));
});
test('real verified download measures all requested bytes through an authenticated proxy tunnel', { timeout: 5000 }, async () => {
  const size = 128 * 1024;
  await fixture((req, res) => { assert.equal(req.method, 'GET'); assert.equal(req.url, `/__down?bytes=${size}`); assert.equal(req.headers['accept-encoding'], 'identity'); res.writeHead(200, { 'Content-Length': size }); res.write(Buffer.alloc(size / 2)); setTimeout(() => res.end(Buffer.alloc(size / 2)), 60); }, async args => {
    const result = await transfer({ ...args, direction: 'download', size });
    assert.equal(result.status, 'ok'); assert.equal(result.bytes, size); assert.ok(result.durationMs >= 50); assert.equal(result.mbps, rateMbps(size, result.durationMs));
    assert.deepEqual(args.auth, [`Basic ${Buffer.from('single-node:test-only').toString('base64')}`]);
  });
});
test('upload sends exact random data and waits for the server acknowledgment', { timeout: 5000 }, async () => {
  const size = 128 * 1024; let count = 0;
  await fixture((req, res) => { assert.equal(req.method, 'POST'); assert.equal(req.url, '/__up'); assert.equal(Number(req.headers['content-length']), size); req.on('data', chunk => { count += chunk.length; }); req.on('end', () => setTimeout(() => res.end('ok'), 60)); }, async args => {
    const result = await transfer({ ...args, direction: 'upload', size }); assert.equal(count, size); assert.equal(result.bytes, size); assert.ok(result.durationMs >= 50); assert.ok(result.mbps > 0);
  });
});
test('redirects and truncated downloads never generate fake speed results', { timeout: 5000 }, async () => {
  await fixture((_req, res) => { res.writeHead(302, { Location: 'https://other.invalid' }); res.end(); }, async args => { await assert.rejects(transfer({ ...args, direction: 'download', size: 100 }), /HTTP_STATUS_302/); });
  await fixture((_req, res) => res.end('short'), async args => { await assert.rejects(transfer({ ...args, direction: 'download', size: 100 }), /Incomplete/); });
});
test('untrusted target certificate is rejected even when the proxy accepted CONNECT', { timeout: 5000 }, async () => {
  await fixture((_req, res) => res.end('ok'), async args => { await assert.rejects(transfer({ ...args, ca: undefined, direction: 'download', size: 2 }), /TLS_TARGET|self-signed/); });
});
test('cancellation promptly closes transfers and does not report partial bytes as a completed test', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  await fixture((_req, res) => { res.writeHead(200); res.write('part'); controller.abort(); }, async args => { await assert.rejects(transfer({ ...args, signal: controller.signal, direction: 'download', size: 1000 }), /TEST_CANCELLED/); });
});
