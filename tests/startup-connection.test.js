import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAutoConnect, writeAutoConnect, startupConnection } from '../src/startup-connection.js';
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
function data() { return { environment: { desktop: true, coreReady: true, admin: false }, session: { connected: false }, nodes: [{ id: 'previous-node' }], selectedNodeId: 'previous-node', mode: 'system', busy: false }; }
test('startup auto-connect defaults on and an explicit off preference persists', () => {
  const store = storage(); assert.equal(readAutoConnect(store), true);
  writeAutoConnect(store, false); assert.equal(readAutoConnect(store), false);
  writeAutoConnect(store, true); assert.equal(readAutoConnect(store), true);
  assert.throws(() => writeAutoConnect(store, 'true'));
});
test('auto-connect is attempted once per window, not again on HMR, refresh, or manual disconnection', async () => {
  const store = storage(), state = data(); let calls = 0;
  const args = { data: state, enabled: true, storage: store, connect: async () => { calls++; } };
  await Promise.all([startupConnection(args), startupConnection(args)]);
  await startupConnection(args);
  assert.equal(calls, 1); assert.equal(state.selectedNodeId, 'previous-node');
  await startupConnection({ ...args, storage: storage() }); assert.equal(calls, 2);
});
test('an existing connection is not interrupted or reconnected', async () => {
  const state = data(); state.session.connected = true; let calls = 0;
  assert.equal((await startupConnection({ data: state, enabled: true, storage: storage(), connect: async () => { calls++; } })).skipped, 'connected');
  assert.equal(calls, 0);
});
test('disabled, empty, preview and busy startups never launch a core', async () => {
  const preview = data(); preview.environment.desktop = false;
  const empty = data(); empty.nodes = [];
  const busy = data(); busy.busy = true;
  for (const [state, enabled, reason] of [[data(), false, 'disabled'], [preview, true, 'preview'], [empty, true, 'no-nodes'], [busy, true, 'busy']]) {
    const result = await startupConnection({ data: state, enabled, storage: storage(), connect: () => assert.fail('Unexpected connection') }); assert.equal(result.skipped, reason);
  }
});
test('missing selected node, missing core and unelevated TUN report a reason before attempting', async () => {
  const selection = data(); selection.selectedNodeId = 'removed';
  const core = data(); core.environment.coreReady = false;
  const tun = data(); tun.mode = 'tun';
  for (const [state, pattern] of [[selection, /选择节点/], [core, /内核/], [tun, /管理员/]]) await assert.rejects(startupConnection({ data: state, enabled: true, storage: storage(), connect: () => assert.fail('Unexpected connection') }), pattern);
});
test('connection failure is returned to the UI and never enters a retry loop', async () => {
  const args = { data: data(), enabled: true, storage: storage(), connect: async () => { throw new Error('节点连接失败'); } };
  await assert.rejects(startupConnection(args), /节点连接失败/);
  assert.equal((await startupConnection(args)).skipped, 'handled');
});
test('unavailable persistent or session storage fails closed', async () => {
  const broken = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  assert.equal(readAutoConnect(broken), false); assert.throws(() => writeAutoConnect(broken, false), /无法保存/);
  assert.equal((await startupConnection({ data: data(), enabled: true, storage: broken, connect: () => assert.fail('Unexpected connection') })).skipped, 'storage-unavailable');
});
