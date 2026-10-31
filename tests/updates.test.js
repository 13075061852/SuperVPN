import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
const { createUpdateService } = require('../desktop/updates.cjs');
const { validateDownloadedInstaller } = require('../desktop/update-integrity.cjs');
function fixture(options = {}) {
  const updater = new EventEmitter(), calls = [];
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('update-not-available'); };
  updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
  const service = createUpdateService({ updater, enabled: true, currentVersion: '0.6.0', ...options });
  return { updater, calls, service };
}
test('downloads automatically but never installs before an explicit confirmed click, with interactive NSIS only', async () => {
  const order = [];
  const { updater, calls, service } = fixture({ validateInstaller: async () => order.push('verify'), prepareInstall: async () => order.push('restore') });
  assert.equal(updater.autoDownload, true); assert.equal(updater.autoInstallOnAppQuit, false); assert.equal(updater.allowDowngrade, false);
  updater.emit('update-available', { version: '0.6.1' }); assert.equal(service.view().phase, 'downloading');
  updater.emit('download-progress', { percent: 40, transferred: 400, total: 1000 }); assert.equal(service.view().percent, 40);
  updater.emit('update-downloaded', { version: '0.6.1', downloadedFile: 'private-local-path' });
  assert.equal(service.view().phase, 'ready'); assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(service.view()).includes('private-local-path'), false);
  await service.check(); assert.equal(calls.length, 0);
  await assert.rejects(service.install(false), /确认/); assert.equal(calls.length, 0);
  await service.install(true); assert.deepEqual(order, ['verify', 'restore']); assert.deepEqual(calls, [['install', false, true]]);
  service.dispose();
});
test('duplicate install clicks share preparation and never exit before network restoration completes', async () => {
  let release, prepared = 0; const gate = new Promise(resolve => release = resolve);
  const { updater, calls, service } = fixture({ prepareInstall: async () => { prepared++; await gate; } });
  updater.emit('update-downloaded', { version: '0.6.1' });
  const first = service.install(true), second = service.install(true); assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(prepared, 1); assert.deepEqual(calls, []);
  release(); await first; assert.deepEqual(calls, [['install', false, true]]); service.dispose();
});
test('integrity failure preserves the current connection; restoration failure blocks installation', async () => {
  let restored = false;
  let f = fixture({ validateInstaller: async () => { throw new Error('secret-path'); }, prepareInstall: async () => { restored = true; } });
  f.updater.emit('update-downloaded', { version: '0.6.1' }); await assert.rejects(f.service.install(true), /校验失败/);
  assert.equal(restored, false); assert.deepEqual(f.calls, []); assert.equal(f.service.view().phase, 'error'); assert.equal(f.service.view().error.includes('secret'), false); f.service.dispose();
  f = fixture({ prepareInstall: async () => { throw new Error('registry failure'); } });
  f.updater.emit('update-downloaded', { version: '0.6.1' }); await assert.rejects(f.service.install(true), /无法安全退出/);
  assert.deepEqual(f.calls, []); assert.equal(f.service.view().phase, 'ready'); f.service.dispose();
});
test('checks coalesce, errors are redacted, and development clients do not check or install', async () => {
  const f = fixture(); await Promise.all([f.service.check(), f.service.check()]); assert.deepEqual(f.calls, ['check']);
  f.updater.emit('error', Object.assign(new Error('https://secret.invalid/?token=private'), { code: 'ERR_UPDATER_CHECKSUM_MISMATCH' }));
  assert.ok(f.service.view().error.includes('校验')); assert.equal(JSON.stringify(f.service.view()).includes('private'), false); f.service.dispose();
  const service = createUpdateService({ updater: null, enabled: false, currentVersion: '0.6.0' }); service.start(); await service.check();
  assert.equal(service.view().supported, false); await assert.rejects(service.install(true), /尚未下载/); service.dispose();
});
test('startup and periodic checks stop cleanly when disposed', async () => {
  const f = fixture({ initialDelayMs: 5, intervalMs: 10 }); f.service.start(); f.service.start();
  await new Promise(resolve => setTimeout(resolve, 55)); assert.ok(f.calls.length >= 2);
  f.service.dispose(); const count = f.calls.length; await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(f.calls.length, count);
});
test('waiting installer is revalidated against SHA-512 before any exit action', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-update-hash-'));
  try {
    const downloadedFile = path.join(dir, 'update.exe'), content = Buffer.from('MZ-test-only-not-executable');
    const info = { downloadedFile, files: [{ url: 'SuperVPN-Setup-0.6.1.exe', sha512: createHash('sha512').update(content).digest('base64') }] };
    await fs.writeFile(downloadedFile, content); await validateDownloadedInstaller(info);
    await fs.appendFile(downloadedFile, 'tampered'); await assert.rejects(validateDownloadedInstaller(info), /UPDATE_INTEGRITY/);
    await assert.rejects(validateDownloadedInstaller({ downloadedFile, sha512: 'invalid' }), /UPDATE_INTEGRITY/);
    await fs.unlink(downloadedFile); await assert.rejects(validateDownloadedInstaller(info));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
let vite, cache, UpdateSettings, UpdateNotice;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-update-ui-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  ({ UpdateSettings, UpdateNotice } = await vite.ssrLoadModule('/src/Updates.jsx'));
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('update UI shows real download progress and waits for a labeled installation confirmation', () => {
  const calls = [], data = { environment: { version: '0.6.0' }, updateInfo: { supported: true, phase: 'downloading', version: '0.6.1', percent: 37 } };
  const render = Component => renderToStaticMarkup(React.createElement(Component, { data, busy: false, onAction: (...args) => calls.push(args) }));
  assert.ok(render(UpdateSettings).includes('value="37"')); assert.equal(render(UpdateNotice), ''); assert.deepEqual(calls, []);
  data.updateInfo.phase = 'ready'; assert.ok(render(UpdateNotice).includes('安装更新')); assert.ok(render(UpdateNotice).includes('稍后')); assert.ok(render(UpdateNotice).includes('退出软件'));
  function button(element) { if (element?.type === 'button') return element; for (const child of React.Children.toArray(element?.props?.children)) { const found = button(child); if (found) return found; } }
  button(UpdateSettings({ data, busy: false, onAction: (...args) => calls.push(args) })).props.onClick(); assert.deepEqual(calls, [['installUpdate', { confirmed: true }]]);
  data.updateInfo.supported = false; assert.equal(render(UpdateNotice), ''); assert.ok(render(UpdateSettings).includes('disabled'));
});
