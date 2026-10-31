const names = ['HTTP_PROXY', 'HTTPS_PROXY'];
function equivalent(a, b) { return a?.exists === b?.exists && (!a?.exists || (a.value === b.value && a.kind === b.kind)); }
function ownedValues(address) { return Object.fromEntries(names.map(name => [name, { exists: true, value: address, kind: 'String' }])); }
function matches(a, b) { return names.every(name => equivalent(a[name], b[name])); }
async function toggleTerminalProxy({ enabled, port, backup, read, write, persist }) {
  if (typeof enabled !== 'boolean' || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效的终端代理设置');
  if (enabled && backup) return backup; // Never replace the original snapshot on repeated clicks.
  if (!enabled && !backup) return null;
  const current = await read().catch(() => { throw new Error('无法读取用户环境变量，未修改'); });
  if (enabled) {
    const snapshot = { owned: `http://127.0.0.1:${port}`, values: current };
    await persist(snapshot); // Durable encrypted recovery state must exist before touching Windows.
    try {
      const next = ownedValues(snapshot.owned);
      await write(next);
      if (!matches(await read(), next)) throw new Error('verify');
      return snapshot;
    } catch {
      try {
        await write(current);
        if (!matches(await read(), current)) throw new Error('verify');
        await persist(null);
      } catch { throw new Error('终端代理设置失败，已保留原值备份，请点击恢复原值'); }
      throw new Error('终端代理设置失败，已恢复原值');
    }
  }
  const owned = ownedValues(backup.owned);
  if (!names.every(name => equivalent(current[name], owned[name]) || equivalent(current[name], backup.values[name]))) throw new Error('代理环境变量已被其他程序修改，未覆盖；原值备份仍保留');
  try {
    await write(backup.values);
    if (!matches(await read(), backup.values)) throw new Error('verify');
    await persist(null);
  } catch { throw new Error('恢复未完成，原值备份仍保留，请重试'); }
  return null;
}
function terminalProxyView(backup, port) { return { enabled: !!backup, address: backup?.owned || `http://127.0.0.1:${port}` }; }
module.exports = { toggleTerminalProxy, terminalProxyView };
