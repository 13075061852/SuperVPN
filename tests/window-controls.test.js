import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const { windowState, setAlwaysOnTop } = createRequire(import.meta.url)('../desktop/window-controls.cjs');
let vite, cache, WindowPin;
before(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-pin-test-'));
  vite = await createServer({ configFile: false, cacheDir: cache, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  WindowPin = (await vite.ssrLoadModule('/src/WindowPin.jsx')).default;
});
after(async () => { await vite?.close(); if (cache) await fs.rm(cache, { recursive: true, force: true }); });
test('pin and unpin return confirmed native state without proxy operations or persistence', () => {
  let pinned = false; const calls = [];
  const window = { isDestroyed: () => false, isAlwaysOnTop: () => pinned, setAlwaysOnTop: value => { calls.push(value); pinned = value; } };
  assert.deepEqual(windowState(window), { alwaysOnTop: false });
  assert.deepEqual(setAlwaysOnTop(window, true), { alwaysOnTop: true });
  assert.deepEqual(setAlwaysOnTop(window, false), { alwaysOnTop: false });
  assert.deepEqual(calls, [true, false]);
});
test('invalid requests and closed windows are rejected before calling the native setter', () => {
  const window = { isDestroyed: () => false, isAlwaysOnTop: () => false, setAlwaysOnTop: () => assert.fail('unexpected setter') };
  for (const value of [null, undefined, 1, 'true', {}]) assert.throws(() => setAlwaysOnTop(window, value), /无效/);
  assert.throws(() => setAlwaysOnTop(null, true), /关闭/);
  assert.throws(() => setAlwaysOnTop({ isDestroyed: () => true }, true), /关闭/);
  assert.deepEqual(windowState(null), { alwaysOnTop: false });
});
test('failure to confirm native state is not reported as a successful pin', () => {
  const window = { isDestroyed: () => false, isAlwaysOnTop: () => false, setAlwaysOnTop: () => {} };
  assert.throws(() => setAlwaysOnTop(window, true), /未确认/);
});
test('pin button has accessible labels, truthful pressed state and distinct active styling', () => {
  const pinned = renderToStaticMarkup(React.createElement(WindowPin, { windowState: { alwaysOnTop: true } }));
  assert.ok(pinned.includes('aria-label="取消置顶"')); assert.ok(pinned.includes('aria-pressed="true"')); assert.ok(pinned.includes('is-pinned'));
  const unpinned = renderToStaticMarkup(React.createElement(WindowPin, { windowState: { alwaysOnTop: false } }));
  assert.ok(unpinned.includes('aria-pressed="false"')); assert.equal(unpinned.includes('disabled=""'), false);
});
test('old running backends show a disabled pending-update pin instead of pretending to work', () => {
  const html = renderToStaticMarkup(React.createElement(WindowPin, {}));
  assert.ok(html.includes('disabled=""')); assert.ok(html.includes('正常退出并重新启动后可用')); assert.ok(html.includes('aria-pressed="false"'));
});
