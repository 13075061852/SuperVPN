const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { performance } = require('node:perf_hooks');
const { randomBytes } = require('node:crypto');
const { classifyNetworkError } = require('./network-errors.cjs');
const TEST_TARGET = new URL('https://www.gstatic.com/generate_204');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function waitReady(proc, port, signal, error) {
  for (let i = 0; i < 40; i++) {
    if (signal.aborted) return false;
    if (error() || proc.exitCode !== null) throw new Error('start failed');
    const listening = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port }); let done = false;
      const finish = result => { if (done) return; done = true; socket.destroy(); resolve(result); };
      socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(100, () => finish(false));
    });
    if (listening) return true;
    await sleep(75);
  }
  throw new Error('start failed: timeout');
}
// Match unified-delay semantics: a real warm-up HEAD followed by a timed HEAD.
// Never subtract an estimate. Preserve the measured cold start separately.
// Optional target/CA are internal test seams; the desktop always uses TEST_TARGET
// and the default trusted roots. Destination TLS verification is never disabled.
function probe(port, credentials, pending, signal, timeoutMs, { target = TEST_TARGET, ca } = {}) {
  return new Promise(resolve => {
    let done = false, request, first, firstSocket;
    const sockets = new Set(), connects = new Set();
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1, maxCachedSessions: 0 });
    const finish = value => {
      if (done) return; done = true;
      clearTimeout(timer); pending.delete(abort);
      request?.destroy(); agent.destroy();
      for (const connection of connects) connection.destroy();
      for (const socket of sockets) socket.destroy();
      resolve(value);
    };
    const fail = error => finish(first ? { ...first, warmUnavailable: true } : { error });
    const errorCode = e => /CERT|SELF_SIGNED|VERIFY/.test(e.code || '') ? `TLS_TARGET ${e.code}` : e.code || 'CONNECT_ERROR';
    const abort = error => finish(signal.aborted ? { aborted: true } : { error: error || 'start failed: core exited' });
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket; };
    pending.add(abort);
    if (signal.aborted) return abort();
    agent.createConnection = (_, callback) => {
      let called = false;
      const ready = (error, socket) => { if (!called) { called = true; callback(error, socket); } };
      const connection = http.request({ hostname: '127.0.0.1', port, method: 'CONNECT', path: `${target.hostname}:${target.port || 443}`, headers: { Host: `${target.hostname}:${target.port || 443}`, 'Proxy-Authorization': `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` }, agent: false });
      connects.add(connection);
      connection.on('error', e => { ready(e); fail(errorCode(e)); });
      connection.once('response', res => { res.resume(); fail(`CONNECT_STATUS_${res.statusCode}`); ready(new Error('CONNECT_ERROR')); });
      connection.once('connect', (res, socket, head) => {
        track(socket);
        socket.on('error', e => { ready(e); fail(errorCode(e)); });
        if (done) { socket.destroy(); return; }
        if (res.statusCode !== 200) { fail(`CONNECT_STATUS_${res.statusCode}`); ready(new Error('CONNECT_ERROR')); return; }
        if (head.length) socket.unshift(head);
        const secure = track(tls.connect({ socket, servername: target.hostname, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'], ...(ca ? { ca } : {}) }));
        secure.once('secureConnect', () => ready(null, secure));
        secure.on('error', e => { fail(errorCode(e)); ready(e); });
      });
      connection.end();
    };
    const run = () => {
      if (done) return;
      const started = performance.now();
      request = https.request(target, { method: 'HEAD', agent, headers: { 'User-Agent': 'SuperVPN/0.4' } });
      request.on('error', e => fail(errorCode(e)));
      request.once('response', res => {
        const socket = res.socket;
        res.on('error', e => fail(errorCode(e)));
        res.once('aborted', () => fail('RESPONSE_CLOSED'));
        res.once('end', () => {
          if (done) return;
          if (![200, 204].includes(res.statusCode)) return fail(`HTTP_STATUS_${res.statusCode}`);
          const elapsed = Math.max(1, Math.round(performance.now() - started));
          if (!first) {
            first = { status: 'ok', delayMs: elapsed, coldDelayMs: elapsed, measurement: 'cold' };
            firstSocket = socket; run();
          } else finish({ status: 'ok', delayMs: elapsed, coldDelayMs: first.coldDelayMs, measurement: 'warm', connectionReused: socket === firstSocket });
        });
        res.resume();
      });
      request.end();
    };
    run();
  });
}
function getTestConcurrency(count, requested = 32) {
  const limit = Number.isFinite(Number(requested)) ? Math.floor(Number(requested)) : 32;
  return Math.min(count, Math.max(1, Math.min(64, limit)));
}
function createLatencyConfig(nodes, config, port, password, prefix) {
  const bootstrap = config.dns?.servers?.find(server => server.tag === 'bootstrap');
  if (!bootstrap) throw new Error('start failed: missing bootstrap DNS');
  return {
    log: { level: 'error', timestamp: false },
    dns: { servers: [structuredClone(bootstrap)], final: 'bootstrap', strategy: 'prefer_ipv4' },
    inbounds: [{ type: 'mixed', tag: 'latency-in', listen: '127.0.0.1', listen_port: port,
      users: nodes.map((_, index) => ({ username: `${prefix}-${index}`, password })) }],
    outbounds: nodes.map((node, index) => ({ ...structuredClone(node.outbound), tag: `latency-out-${index}` })),
    route: { auto_detect_interface: true, default_domain_resolver: 'bootstrap', rules: [
      ...nodes.map((_, index) => ({ inbound: ['latency-in'], auth_user: [`${prefix}-${index}`], action: 'route', outbound: `latency-out-${index}` })),
      { action: 'reject' }
    ] }
  };
}
function createDiagnosticCollector() {
  const diagnostics = new Map(); let startup = '', remainder = '';
  const line = text => {
    for (const match of text.matchAll(/\[latency-out-(\d+)\]/g)) {
      const index = Number(match[1]); diagnostics.set(index, ((diagnostics.get(index) || '') + '\n' + text).slice(-16384));
    }
  };
  return {
    record(data) {
      const text = data.toString().replace(/\x1b\[[0-9;]*m/g, '');
      startup = (startup + text).slice(-65536); remainder += text;
      const lines = remainder.split(/\r?\n/); remainder = lines.pop().slice(-16384); lines.forEach(line);
    },
    forNode(index) { return (diagnostics.get(index) || '') + (remainder.includes(`[latency-out-${index}]`) ? '\n' + remainder : ''); },
    startup() { return startup; }
  };
}
exports.probe = probe;
exports.getTestConcurrency = getTestConcurrency;
exports.createLatencyConfig = createLatencyConfig;
exports.createDiagnosticCollector = createDiagnosticCollector;
exports.testLatency = async ({ nodes, config, core, runtimeFile, signal, onStart, onResult, timeoutMs = 6000, concurrency = 32, onCoreStart }) => {
  if (!nodes.length || signal.aborted) return;
  const pending = new Set(), diagnostics = createDiagnosticCollector(), completed = new Set();
  const password = randomBytes(32).toString('hex'), prefix = randomBytes(8).toString('hex');
  let proc, spawnError, cursor = 0;
  const stop = () => { for (const cancel of [...pending]) cancel(); proc?.kill(); };
  signal.addEventListener('abort', stop, { once: true });
  const report = (index, result) => {
    if (signal.aborted || completed.has(index)) return;
    completed.add(index); onResult(nodes[index].id, { ...result, checkedAt: Date.now() });
  };
  try {
    const port = await freePort();
    const isolated = createLatencyConfig(nodes, config, port, password, prefix);
    if (signal.aborted) return;
    await fs.writeFile(runtimeFile, JSON.stringify(isolated), { mode: 0o600 });
    if (signal.aborted) return;
    proc = spawn(core, ['run', '-c', runtimeFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', diagnostics.record); proc.stderr.on('data', diagnostics.record);
    proc.once('error', e => { spawnError = e; });
    proc.once('exit', () => { for (const cancel of [...pending]) cancel('start failed: core exited'); });
    if (proc.pid) onCoreStart?.(proc.pid);
    if (!(await waitReady(proc, port, signal, () => spawnError))) return;
    await Promise.all(Array.from({ length: getTestConcurrency(nodes.length, concurrency) }, async () => {
      while (!signal.aborted && cursor < nodes.length) {
        const index = cursor++, node = nodes[index];
        onStart(node.id);
        if (proc.exitCode !== null) { report(index, classifyNetworkError('start failed: core exited')); continue; }
        const measured = await probe(port, { username: `${prefix}-${index}`, password }, pending, signal, timeoutMs);
        if (measured.aborted || signal.aborted) break;
        if (measured.status === 'ok') report(index, measured);
        else {
          await sleep(30);
          // Only this outbound's diagnostics: another node's certificate error
          // must never overwrite a timeout or authentication failure here.
          report(index, classifyNetworkError(`${diagnostics.forNode(index)}\n${measured.error}`));
        }
      }
    }));
  } catch (e) {
    if (!signal.aborted) {
      await sleep(20);
      const failure = classifyNetworkError(`${diagnostics.startup()}\nstart failed: ${e.message}`, '测速启动失败');
      for (let index = 0; index < nodes.length; index++) if (!completed.has(index)) { onStart(nodes[index].id); report(index, failure); }
    }
  } finally {
    signal.removeEventListener('abort', stop);
    for (const cancel of [...pending]) cancel();
    if (proc && proc.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000); proc.once('exit', () => { clearTimeout(timer); resolve(); }); proc.kill();
    });
    await fs.rm(runtimeFile, { force: true });
  }
};
