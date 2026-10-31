import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { systemProxyState, validateSystemMode } from '../shared/connection-mode.js';
import { defaultState, createConfig, parseLink } from '../shared/proxy.js';

test('legacy saved TUN and invalid capture modes migrate without losing any user data', () => {
  for (const mode of ['tun', undefined, 'invalid']) {
    const node = parseLink('http://example.invalid:8080');
    const original = { ...defaultState(), mode, nodes: [node], selectedNodeId: node.id, terminalProxyBackup: { saved: 'test-only' }, subscriptions: [{ id: 'account-1', name: 'Account' }], rules: [{ id: 'r', process: 'app.exe', enabled: true, action: 'proxy' }] };
    const snapshot = structuredClone(original), migrated = systemProxyState(original);
    assert.deepEqual(original, snapshot); assert.equal(migrated.mode, 'system');
    assert.deepEqual({ ...migrated, mode }, snapshot);
    assert.equal(migrated.nodes, original.nodes); assert.equal(migrated.terminalProxyBackup, original.terminalProxyBackup);
    const config = createConfig(migrated);
    assert.equal(config.inbounds[0].type, 'mixed'); assert.equal(config.inbounds[0].listen, '127.0.0.1');
    assert.equal(config.inbounds.some(inbound => inbound.type === 'tun'), false);
    assert.equal(systemProxyState(migrated), migrated);
  }
});
test('desktop mode requests reject TUN instead of reintroducing a hidden administrator-only mode', () => {
  assert.equal(validateSystemMode('system'), 'system');
  for (const value of ['tun', null, '', 'invalid']) assert.throws(() => validateSystemMode(value), /仅支持系统代理/);
});
test('persisted migration happens before creating the window or any startup automatic connection', async () => {
  const source = await fs.readFile('electron/main.cjs', 'utf8');
  const startup = source.slice(source.indexOf('app.whenReady().then'));
  assert.ok(startup.indexOf('connectionMode.systemProxyState(state); await save()') < startup.indexOf('createWindow();'));
  assert.ok(source.includes('connectionMode.validateSystemMode(payload)'));
  assert.equal(source.includes('TUN 全局接管需要管理员权限'), false);
  const start = source.slice(source.indexOf('async function start()'), source.indexOf('async function start()') + 600);
  assert.ok(start.includes('connectionMode.systemProxyState(state)'));
});
