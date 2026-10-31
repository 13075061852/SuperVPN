import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createRequire } from 'node:module';
import { key, cert } from './fixtures/localhost-tls.js';
const { probe } = createRequire(import.meta.url)('../electron/latency.cjs');
const credentials = { username: 'test-node', password: 'test-only' };

async function fixture(options, run) {
  const sockets = new Set(), timers = new Set(), stats = { connects: 0, heads: 0, tls: 0, auth: [] };
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket; };
  const later = (ms, callback) => { const t = setTimeout(() => { timers.delete(t); callback(); }, ms); timers.add(t); };
  const destination = https.createServer({ key, cert }, (req, res) => {
    stats.heads++; assert.equal(req.method, 'HEAD');
    if (stats.heads === 2) options.onSecond?.();
    later(stats.heads === 2 ? options.secondDelay ?? 25 : 25, () => {
      if (res.destroyed) return;
      res.writeHead(stats.heads === 2 ? options.secondStatus ?? 204 : options.firstStatus ?? 204);
      res.end();
    });
  });
  destination.on('connection', track); destination.on('secureConnection', () => stats.tls++);
  destination.on('tlsClientError', () => {});
  const proxy = http.createServer(); proxy.on('connection', track);
  proxy.on('connect', (req, client, head) => {
    stats.connects++; stats.auth.push(req.headers['proxy-authorization']);
    later(options.connectDelay ?? 0, () => {
      if (client.destroyed) return;
      const upstream = track(net.connect(destination.address().port, '127.0.0.1'));
      upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
      client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
    });
  });
  try {
    await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    await run({ port: proxy.address().port, target: new URL(`https://localhost:${destination.address().port}/generate_204`), stats });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(resolve => destination.close(resolve)), new Promise(resolve => proxy.close(resolve))]);
  }
}
test('unified latency measures a second real HEAD on the same verified TLS tunnel, retaining cold start', { timeout: 10000 }, async () => {
  await fixture({ connectDelay: 220 }, async ({ port, target, stats }) => {
    const pending = new Set();
    const result = await probe(port, credentials, pending, new AbortController().signal, 4000, { target, ca: cert });
    assert.equal(result.status, 'ok'); assert.equal(result.measurement, 'warm');
    assert.equal(result.connectionReused, true);
    assert.equal(stats.heads, 2); assert.equal(stats.connects, 1); assert.equal(stats.tls, 1);
    assert.deepEqual(stats.auth, [`Basic ${Buffer.from('test-node:test-only').toString('base64')}`]);
    assert.ok(result.delayMs >= 20, 'must measure a real response, not return a synthetic small value');
    assert.ok(result.coldDelayMs >= 220); assert.ok(result.coldDelayMs - result.delayMs >= 150);
    assert.equal(pending.size, 0);
  });
});
test('a failed second response falls back to an explicitly labelled, actually measured cold result', { timeout: 10000 }, async () => {
  await fixture({ secondStatus: 500 }, async ({ port, target, stats }) => {
    const result = await probe(port, credentials, new Set(), new AbortController().signal, 4000, { target, ca: cert });
    assert.equal(result.status, 'ok'); assert.equal(result.measurement, 'cold');
    assert.equal(result.warmUnavailable, true); assert.equal(result.delayMs, result.coldDelayMs); assert.equal(stats.heads, 2);
  });
});
test('a warm request timeout keeps the real cold result without extending the total probe budget', { timeout: 10000 }, async () => {
  await fixture({ secondDelay: 2000 }, async ({ port, target, stats }) => {
    const started = Date.now();
    const result = await probe(port, credentials, new Set(), new AbortController().signal, 300, { target, ca: cert });
    assert.equal(result.status, 'ok'); assert.equal(result.measurement, 'cold'); assert.equal(result.warmUnavailable, true);
    assert.equal(result.delayMs, result.coldDelayMs); assert.equal(stats.heads, 2);
    assert.ok(Date.now() - started < 1500, 'the six-second production budget must not restart for the warm phase');
  });
});
test('the first response must be successful before any delay is reported', { timeout: 10000 }, async () => {
  await fixture({ firstStatus: 500 }, async ({ port, target, stats }) => {
    const result = await probe(port, credentials, new Set(), new AbortController().signal, 4000, { target, ca: cert });
    assert.equal(result.error, 'HTTP_STATUS_500'); assert.equal(result.delayMs, undefined); assert.equal(stats.heads, 1);
  });
});
test('unified probing never accepts an untrusted destination certificate', { timeout: 10000 }, async () => {
  await fixture({}, async ({ port, target, stats }) => {
    const result = await probe(port, credentials, new Set(), new AbortController().signal, 4000, { target });
    assert.match(result.error, /^TLS_TARGET /); assert.equal(result.delayMs, undefined); assert.equal(stats.heads, 0);
  });
});
test('trusting the test CA still does not bypass destination hostname validation', { timeout: 10000 }, async () => {
  await fixture({}, async ({ port, target, stats }) => {
    target.hostname = 'wrong-host.invalid';
    const result = await probe(port, credentials, new Set(), new AbortController().signal, 4000, { target, ca: cert });
    assert.match(result.error, /TLS_TARGET.*ALTNAME/); assert.equal(result.delayMs, undefined); assert.equal(stats.heads, 0);
  });
});
test('cancellation during the warm request discards partial results and cleans pending work', { timeout: 10000 }, async () => {
  const controller = new AbortController(), pending = new Set();
  // The batch coordinator owns one abort listener for all concurrent probes.
  controller.signal.addEventListener('abort', () => { for (const cancel of [...pending]) cancel(); }, { once: true });
  await fixture({ secondDelay: 1500, onSecond: () => controller.abort() }, async ({ port, target, stats }) => {
    const result = await probe(port, credentials, pending, controller.signal, 4000, { target, ca: cert });
    assert.equal(result.aborted, true); assert.equal(result.delayMs, undefined); assert.equal(pending.size, 0); assert.equal(stats.heads, 2);
  });
});
