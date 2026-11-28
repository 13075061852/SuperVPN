import { test } from 'node:test';
import assert from 'node:assert/strict';
import api from '../electron/terminal-proxy.cjs';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const { toggleTerminalProxy, terminalProxyView, reconcileTerminalProxy } = api;
function fixture(values) {
  let environment = structuredClone(values), backup = null;
  const events = [];
  const io = { read: async () => structuredClone(environment), write: async next => { events.push('write'); environment = structuredClone(next); }, persist: async next => { events.push(next ? 'backup' : 'clear'); backup = structuredClone(next); } };
  return { io, events, current: () => environment, backup: () => backup, toggle: enabled => toggleTerminalProxy({ enabled, port: 17890, backup, ...io }) };
}
const missing = () => ({ HTTP_PROXY: { exists: false }, HTTPS_PROXY: { exists: false } });
test('terminal proxy stores originals durably before writing and restores missing values by deletion', async () => {
  const f = fixture(missing()); await f.toggle(true);
  assert.deepEqual(f.events, ['backup', 'write']);
  for (const value of Object.values(f.current())) assert.deepEqual(value, { exists: true, value: 'http://127.0.0.1:17890', kind: 'String' });
  await f.toggle(false); assert.deepEqual(f.current(), missing()); assert.equal(f.backup(), null);
});
test('restore preserves distinct original values, empty strings and unexpanded registry types', async () => {
  const original = { HTTP_PROXY: { exists: true, value: '', kind: 'String' }, HTTPS_PROXY: { exists: true, value: 'http://%PROXY_HOST%:8888', kind: 'ExpandString' } };
  const f = fixture(original); await f.toggle(true); await f.toggle(false); assert.deepEqual(f.current(), original);
});
test('repeated enable never overwrites the original snapshot and restart can still restore', async () => {
  const f = fixture(missing()); await f.toggle(true); const originalBackup = structuredClone(f.backup());
  await f.toggle(true); assert.deepEqual(f.backup(), originalBackup); assert.equal(f.events.length, 2);
  await toggleTerminalProxy({ enabled: false, port: 17890, backup: structuredClone(originalBackup), ...f.io });
  assert.deepEqual(f.current(), missing());
});
test('backup persistence failure leaves user environment untouched', async () => {
  const f = fixture(missing());
  await assert.rejects(() => toggleTerminalProxy({ enabled: true, port: 17890, ...f.io, persist: async () => { throw new Error('disk full'); } }));
  assert.deepEqual(f.current(), missing()); assert.deepEqual(f.events, []);
});
test('partial write failure restores both original values and does not leak raw errors', async () => {
  const f = fixture(missing()); let writes = 0;
  await assert.rejects(() => toggleTerminalProxy({ enabled: true, port: 17890, ...f.io, write: async values => { if (++writes === 1) { await f.io.write({ ...missing(), HTTP_PROXY: values.HTTP_PROXY }); throw new Error('secret-password'); } await f.io.write(values); } }), error => error.message === '终端代理设置失败，已恢复原值');
  assert.deepEqual(f.current(), missing()); assert.equal(f.backup(), null);
});
test('failed rollback keeps durable original snapshot for a later restore', async () => {
  const f = fixture(missing());
  await assert.rejects(() => toggleTerminalProxy({ enabled: true, port: 17890, ...f.io, write: async () => { throw new Error('blocked'); } }), /保留原值备份/);
  assert.deepEqual(f.backup().values, missing()); await f.toggle(false); assert.equal(f.backup(), null);
});
test('external edits are not silently overwritten and original backup remains available', async () => {
  const f = fixture(missing()); await f.toggle(true);
  await f.io.write({ ...f.current(), HTTP_PROXY: { exists: true, value: 'http://external.example:1234', kind: 'String' } });
  const external = structuredClone(f.current());
  await assert.rejects(() => f.toggle(false), /其他程序修改/); assert.deepEqual(f.current(), external); assert.ok(f.backup());
});
test('real Windows registry adapter preserves raw ExpandString and deletes absent values in an isolated test key', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const key = `Software\\SuperVPN\\Tests\\${randomUUID()}`;
  const require = createRequire(import.meta.url), module = { exports: {} };
  // Run the production PowerShell scripts against ONLY a unique test key.
  // Never write or delete HKCU\\Environment during automated acceptance.
  const isolatedExec = (file, args, options, callback) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
      .replaceAll(".OpenSubKey('Environment')", `.OpenSubKey('${key}')`)
      .replaceAll(".CreateSubKey('Environment')", `.CreateSubKey('${key}')`);
    execFile(file, [...args.slice(0, -1), Buffer.from(script, 'utf16le').toString('base64')], options, callback);
  };
  isolatedExec[promisify.custom] = (...args) => new Promise((resolve, reject) => isolatedExec(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
  const source = await fs.readFile(new URL('../electron/windows.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { module, exports: module.exports, Buffer, require: name => name === 'node:child_process' ? { execFile: isolatedExec } : require(name) });
  const win = module.exports;
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(await win.readUserProxyEnvironment())), missing());
    const original = { HTTP_PROXY: { exists: true, value: '', kind: 'String' }, HTTPS_PROXY: { exists: true, value: 'http://%PROXY_HOST%:8888', kind: 'ExpandString' } };
    await win.writeUserProxyEnvironment(original);
    assert.deepEqual(JSON.parse(JSON.stringify(await win.readUserProxyEnvironment())), original);
    await win.writeUserProxyEnvironment(missing());
    assert.deepEqual(JSON.parse(JSON.stringify(await win.readUserProxyEnvironment())), missing());
  } finally { await promisify(execFile)('reg.exe', ['delete', `HKCU\\${key}`, '/f'], { windowsHide: true }).catch(() => {}); }
});
test('safe view contains no original proxy credentials and validates requested ports and booleans', async () => {
  const backup = { owned: 'http://127.0.0.1:17890', values: { HTTP_PROXY: { value: 'http://user:secret@example.test:8080' } } };
  assert.deepEqual(terminalProxyView(backup, 17890), { enabled: true, address: 'http://127.0.0.1:17890' });
  for (const [enabled, port] of [['true', 17890], [true, 0], [true, 65536]]) await assert.rejects(() => toggleTerminalProxy({ enabled, port }), /无效/);
});
test('disabling clears self-poisoned backups, leftover owned vars without backup, and ExpandString owned copies', async () => {
  const owned = { HTTP_PROXY: { exists: true, value: 'http://127.0.0.1:17890', kind: 'String' }, HTTPS_PROXY: { exists: true, value: 'http://127.0.0.1:17890', kind: 'String' } };
  // 1. Turning on when 17890 is already in HKCU must not back up 17890 as original; turning off must clear to system default.
  const f1 = fixture(owned);
  await f1.toggle(true);
  assert.deepEqual(f1.backup().values, missing());
  await f1.toggle(false);
  assert.deepEqual(f1.current(), missing()); assert.equal(f1.backup(), null);
  // 2. An already-poisoned backup saved by an older version still restores to system default when disabled.
  const f2 = fixture(owned);
  await toggleTerminalProxy({ enabled: false, port: 17890, backup: { owned: 'http://127.0.0.1:17890', values: structuredClone(owned) }, ...f2.io });
  assert.deepEqual(f2.current(), missing()); assert.equal(f2.backup(), null);
  // 3. Disabling even with no backup still removes leftover SuperVPN 17890 entries without touching unrelated vars.
  const f3 = fixture({ HTTP_PROXY: owned.HTTP_PROXY, HTTPS_PROXY: { exists: true, value: 'http://other.example:8080', kind: 'String' } });
  await toggleTerminalProxy({ enabled: false, port: 17890, backup: null, ...f3.io });
  assert.deepEqual(f3.current(), { HTTP_PROXY: { exists: false }, HTTPS_PROXY: { exists: true, value: 'http://other.example:8080', kind: 'String' } });
  // 4. Windows GUI re-saving owned value as ExpandString does not block restoration.
  const f4 = fixture(missing()); await f4.toggle(true);
  await f4.io.write({ HTTP_PROXY: { exists: true, value: 'http://127.0.0.1:17890/', kind: 'ExpandString' }, HTTPS_PROXY: owned.HTTPS_PROXY });
  await f4.toggle(false);
  assert.deepEqual(f4.current(), missing()); assert.equal(f4.backup(), null);
});
test('startup reconciliation aligns saved terminalProxyBackup with real Windows environment state', () => {
  const owned = { HTTP_PROXY: { exists: true, value: 'http://127.0.0.1:17890', kind: 'String' }, HTTPS_PROXY: { exists: true, value: 'http://127.0.0.1:17890', kind: 'String' } };
  const adopted = reconcileTerminalProxy(undefined, owned, 17890);
  assert.equal(adopted.changed, true); assert.deepEqual(adopted.backup, { owned: 'http://127.0.0.1:17890', values: missing() });
  const sanitized = reconcileTerminalProxy({ owned: 'http://127.0.0.1:17890', values: owned }, owned, 17890);
  assert.equal(sanitized.changed, true); assert.deepEqual(sanitized.backup.values, missing());
  const cleared = reconcileTerminalProxy({ owned: 'http://127.0.0.1:17890', values: missing() }, missing(), 17890);
  assert.equal(cleared.changed, true); assert.equal(cleared.backup, null);
  const steady = reconcileTerminalProxy(undefined, missing(), 17890);
  assert.equal(steady.changed, false); assert.equal(steady.backup, null);
});
