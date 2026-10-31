const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { probe, createLatencyConfig, createDiagnosticCollector } = require('../electron/latency.cjs');
const { classifyNetworkError } = require('../electron/network-errors.cjs');
const DOWNLOAD_BYTES = 16 * 1024 * 1024, UPLOAD_BYTES = 4 * 1024 * 1024;
const TARGET = 'https://speed.cloudflare.com';
function rateMbps(bytes, durationMs) {
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Invalid measurement');
  return bytes * 8 / (durationMs * 1000);
}
// Rolling throughput uses deltas over a recent window, not a running average.
function createSpeedSampler({ now = () => performance.now(), windowMs = 1000 } = {}) {
  let bytes = 0;
  const points = [{ time: now(), bytes: 0 }];
  return {
    add(count) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid progress');
      bytes += count;
    },
    sample() {
      const time = now();
      if (time <= points.at(-1).time) return null;
      points.push({ time, bytes });
      while (points.length > 2 && points[1].time <= time - windowMs) points.shift();
      const elapsed = time - points[0].time, delta = bytes - points[0].bytes;
      return { bytes, mbps: delta === 0 ? 0 : rateMbps(delta, elapsed), windowMs: elapsed };
    }
  };
}
// Internal target/CA overrides are test seams only; never accepted over IPC.
function transfer({ port, credentials, direction, signal, size, target = TARGET, ca, timeoutMs = 25000, onProgress = () => {}, connection }) {
  return new Promise((resolve, reject) => {
    const url = new URL(direction === 'download' ? `/__down?bytes=${size}` : '/__up', target);
    let request, connect, secure, finished = false, received = 0, responseBytes = 0, uploaded = 0;
    const agent = connection?.agent || new https.Agent({ keepAlive: false });
    const started = performance.now();
    const cleanup = failed => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (failed || !connection) { request?.destroy(); connect?.destroy(); secure?.destroy(); agent.destroy(); }
    };
    const end = (error, value) => { if (finished) return; finished = true; cleanup(!!error); error ? reject(error) : resolve(value); };
    const abort = () => end(new Error('TEST_CANCELLED'));
    const timer = setTimeout(() => end(new Error('timeout')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    if (!['download', 'upload'].includes(direction) || !Number.isInteger(size) || size <= 0 || size > DOWNLOAD_BYTES || url.protocol !== 'https:') return end(new Error('Invalid measurement'));
    agent.createConnection = (_, callback) => {
      let called = false;
      const ready = (error, socket) => { if (!called) { called = true; callback(error, socket); } };
      connect = http.request({ hostname: '127.0.0.1', port, method: 'CONNECT', path: `${url.hostname}:${url.port || 443}`, headers: { Host: `${url.hostname}:${url.port || 443}`, 'Proxy-Authorization': `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` }, agent: false });
      connect.once('error', error => { ready(error); end(error); });
      connect.once('response', response => { response.resume(); ready(new Error('Proxy CONNECT rejected')); end(new Error('Proxy CONNECT rejected')); });
      connect.once('connect', (response, socket, head) => {
        secure = socket;
        if (finished) { socket.destroy(); return; }
        if (response.statusCode !== 200) { ready(new Error('Proxy CONNECT rejected')); return end(new Error('Proxy CONNECT rejected')); }
        if (head.length) socket.unshift(head);
        secure = tls.connect({ socket, servername: url.hostname, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'], ...(ca ? { ca } : {}) });
        secure.once('secureConnect', () => ready(null, secure));
        secure.on('error', error => { ready(error); end(new Error(/CERT|VERIFY|SELF_SIGNED/.test(error.code || '') ? 'TLS_TARGET' : 'connection reset')); });
      });
      connect.end();
    };
    request = https.request(url, { method: direction === 'upload' ? 'POST' : 'GET', agent, headers: { 'User-Agent': 'SuperVPN-SpeedTest', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache', ...(direction === 'upload' ? { 'Content-Length': size, 'Content-Type': 'application/octet-stream' } : {}) } });
    request.on('error', error => end(error));
    request.once('response', response => {
      if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) { response.destroy(); return end(new Error(`HTTP_STATUS_${response.statusCode}`)); }
      response.on('error', error => end(error));
      response.once('aborted', () => end(new Error('connection reset')));
      response.on('data', chunk => {
        responseBytes += chunk.length;
        if (responseBytes > (direction === 'download' ? size : 65536)) { response.destroy(); return end(new Error('Invalid response size')); }
        if (direction === 'download') { received += chunk.length; onProgress(received); }
      });
      response.once('end', () => {
        const count = direction === 'download' ? received : uploaded;
        if (count !== size || (direction === 'upload' && !request.writableFinished)) return end(new Error('Incomplete transfer'));
        const durationMs = performance.now() - started;
        end(null, { status: 'ok', bytes: count, durationMs, mbps: rateMbps(count, durationMs) });
      });
    });
    if (direction === 'upload') {
      // Report write callbacks (flushed to the transport), never generated or
      // merely queued payload. Final upload results still require server ACK.
      (async () => {
        try {
          while (uploaded < size && !finished) {
            const chunk = randomBytes(Math.min(65536, size - uploaded));
            await new Promise((resolve, reject) => request.write(chunk, error => error ? reject(error) : resolve()));
            if (finished) return;
            uploaded += chunk.length; onProgress(uploaded);
          }
          if (!finished) request.end();
        } catch (error) { end(error); }
      })();
    } else request.end();
  });
}
async function sustainedTransfer({ direction, signal, onProgress = () => {}, onPhase = () => {}, durationMs = 10000, connections = 4, warmupBytes = 128 * 1024, maxPhaseBytes = 2 * 1024 ** 3, measure = transfer, now = () => performance.now(), ...options }) {
  if (!['download', 'upload'].includes(direction) || !Number.isInteger(connections) || connections < 1 || connections > 8 || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isSafeInteger(maxPhaseBytes) || maxPhaseBytes <= 0 || !Number.isInteger(warmupBytes) || warmupBytes <= 0 || warmupBytes > 1024 * 1024) throw new Error('Invalid measurement');
  const maximumChunk = direction === 'download' ? DOWNLOAD_BYTES : UPLOAD_BYTES;
  const lanes = Array.from({ length: connections }, () => ({ connection: { agent: new https.Agent({ keepAlive: true, maxSockets: 1, maxCachedSessions: 0 }) }, chunk: 1024 * 1024 }));
  const errors = [];
  let bytes = 0, samples = 0, requested = 0, liveTimer;
  try {
    onPhase(`warmup-${direction}`);
    const ready = (await Promise.all(lanes.map(async lane => {
      try {
        const warm = await measure({ ...options, connection: lane.connection, direction, signal, size: warmupBytes, timeoutMs: 8000 });
        if (warm.status !== 'ok' || warm.bytes !== warmupBytes || !Number.isFinite(warm.durationMs) || warm.durationMs <= 0) throw new Error('Incomplete transfer');
        lane.chunk = Math.min(maximumChunk, Math.max(128 * 1024, Math.floor(warm.bytes / warm.durationMs * 1000)));
        return lane;
      } catch (error) { errors.push(error); return null; }
    }))).filter(Boolean);
    if (signal.aborted) throw new Error('TEST_CANCELLED');
    if (!ready.length) throw errors[0] || new Error('connection reset');
    onPhase(direction);
    // All active lanes share ONE wall-clock window. Do not sum lane times or
    // include warm-up payload/handshake time in the measured throughput.
    const started = now(), sampler = createSpeedSampler({ now });
    liveTimer = setInterval(() => {
      if (!signal.aborted) {
        const live = sampler.sample();
        if (live) onProgress(live);
      }
    }, 250);
    await Promise.all(ready.map(async lane => {
      while (!signal.aborted && now() - started < durationMs && requested < maxPhaseBytes) {
        const size = Math.min(lane.chunk, maxPhaseBytes - requested);
        requested += size;
        let reported = 0;
        const progress = count => {
          if (signal.aborted || !Number.isSafeInteger(count) || count <= reported || count > size) return;
          sampler.add(count - reported); reported = count;
        };
        try {
          const result = await measure({ ...options, connection: lane.connection, direction, signal, size, timeoutMs: Math.min(10000, Math.max(500, durationMs - (now() - started) + 2000)), onProgress: progress });
          if (result.status !== 'ok' || result.bytes !== size || !Number.isFinite(result.durationMs) || result.durationMs <= 0) throw new Error('Incomplete transfer');
          progress(result.bytes);
          bytes += result.bytes; samples++;
          lane.chunk = Math.min(maximumChunk, Math.max(128 * 1024, Math.floor(result.bytes / result.durationMs * 1000)));
        } catch (error) { errors.push(error); break; }
      }
    }));
    if (signal.aborted) throw new Error('TEST_CANCELLED');
    if (!samples) throw errors[0] || new Error('timeout');
    const elapsed = now() - started;
    return { status: errors.length ? 'partial' : 'ok', bytes, durationMs: elapsed, samples, connections: ready.length, mbps: rateMbps(bytes, elapsed), ...(errors.length ? { warning: classifyNetworkError(errors[0].code || errors[0].message).reason } : {}) };
  } finally { clearInterval(liveTimer); for (const lane of lanes) lane.connection.agent.destroy(); }
}
async function freePort() {
  const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function runSpeedTest({ node, config, core, runtimeFile, signal, onUpdate, latencyOptions, transferOptions }) {
  const diagnostics = createDiagnosticCollector(), pending = new Set();
  const credentials = { username: `${randomBytes(8).toString('hex')}-0`, password: randomBytes(32).toString('hex') };
  const prefix = credentials.username.slice(0, -2);
  let proc, spawnError;
  const internal = new AbortController();
  const abort = () => { internal.abort(); for (const cancel of [...pending]) cancel(); }; signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) internal.abort();
  const update = patch => { if (!signal.aborted) onUpdate(patch); };
  try {
    const port = await freePort();
    if (internal.signal.aborted) return;
    await fs.writeFile(runtimeFile, JSON.stringify(createLatencyConfig([node], config, port, credentials.password, prefix)), { mode: 0o600 });
    if (internal.signal.aborted) return;
    proc = spawn(core, ['run', '-c', runtimeFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.once('error', error => { spawnError = error; internal.abort(); });
    proc.stdout.on('data', diagnostics.record); proc.stderr.on('data', diagnostics.record);
    proc.once('exit', () => { internal.abort(); for (const cancel of [...pending]) cancel('start failed: core exited'); });
    let ready = false;
    for (let i = 0; i < 50 && !internal.signal.aborted; i++) {
      ready = await new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port }); const finish = value => { socket.destroy(); resolve(value); }; socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(100, () => finish(false)); });
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    if (!ready || spawnError || internal.signal.aborted) throw new Error('start failed');
    update({ phase: 'latency' });
    const latency = await probe(port, credentials, pending, internal.signal, 8000, latencyOptions);
    if (signal.aborted) return;
    if (latency.status !== 'ok') throw new Error(`${diagnostics.forNode(0)}\n${latency.error || 'connection reset'}`);
    update({ latency, phase: 'download', transferred: 0 });
    let partial = false;
    for (const direction of ['download', 'upload']) {
      if (internal.signal.aborted) throw new Error('connection reset');
      update({ phase: direction, transferred: 0 });
      try {
        const result = await sustainedTransfer({ ...transferOptions, port, credentials, direction, signal: internal.signal, onPhase: phase => update({ phase, live: null }), onProgress: live => update({ transferred: live.bytes, live: { direction, ...live } }) });
        partial ||= result.status !== 'ok';
        update({ [direction]: result, live: null });
      } catch (error) {
        if (signal.aborted) return;
        partial = true;
        update({ [direction]: classifyNetworkError(`${diagnostics.forNode(0)}\n${error.code || error.message}`), live: null });
      }
    }
    update({ phase: partial ? 'partial' : 'done' });
  } catch (error) {
    if (!signal.aborted) update({ phase: 'error', error: classifyNetworkError(`${diagnostics.forNode(0)}\n${error.code || error.message}`).reason });
  } finally {
    signal.removeEventListener('abort', abort); internal.abort(); for (const cancel of [...pending]) cancel();
    if (proc && proc.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); proc.once('exit', () => { clearTimeout(timer); resolve(); }); proc.kill(); });
    await fs.rm(runtimeFile, { force: true });
  }
}
module.exports = { runSpeedTest, transfer, sustainedTransfer, createSpeedSampler, rateMbps, DOWNLOAD_BYTES, UPLOAD_BYTES };
