const names = ['HTTP_PROXY', 'HTTPS_PROXY'];
const missingValues = () => Object.fromEntries(names.map(name => [name, { exists: false }]));
const normalizeUrl = value => typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : '';
function equivalent(a, b) { return a?.exists === b?.exists && (!a?.exists || (a.value === b.value && a.kind === b.kind)); }
function isOwnedEntry(entry, address) { return entry?.exists === true && normalizeUrl(entry.value) === normalizeUrl(address); }
function ownedValues(address) { return Object.fromEntries(names.map(name => [name, { exists: true, value: address, kind: 'String' }])); }
function matches(a, b) { return names.every(name => equivalent(a[name], b[name])); }
function sanitizeRestoreValues(values, ownedAddress) {
  return Object.fromEntries(names.map(name => {
    const entry = values?.[name];
    if (!entry?.exists || isOwnedEntry(entry, ownedAddress)) return [name, { exists: false }];
    return [name, { exists: true, value: entry.value, kind: entry.kind }];
  }));
}
function reconcileTerminalProxy(backup, current, port) {
  const portAddress = `http://127.0.0.1:${port}`;
  if (backup) {
    const address = backup.owned || portAddress;
    const sanitized = sanitizeRestoreValues(backup.values, address);
    if (matches(current, sanitized) && !names.some(name => isOwnedEntry(current[name], address))) {
      return { backup: null, changed: true };
    }
    const nextBackup = { owned: address, values: sanitized };
    const changed = backup.owned !== nextBackup.owned || !matches(backup.values || {}, sanitized);
    return { backup: nextBackup, changed };
  }
  const hasOwned = names.some(name => isOwnedEntry(current?.[name], portAddress));
  const onlyOwnedOrAbsent = names.every(name => !current?.[name]?.exists || isOwnedEntry(current[name], portAddress));
  if (hasOwned && onlyOwnedOrAbsent) {
    return { backup: { owned: portAddress, values: missingValues() }, changed: true };
  }
  return { backup: null, changed: false };
}
async function toggleTerminalProxy({ enabled, port, backup, read, write, persist }) {
  if (typeof enabled !== 'boolean' || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效的终端代理设置');
  const portAddress = `http://127.0.0.1:${port}`;
  if (enabled && backup) return backup; // Never replace the original snapshot on repeated clicks.
  const current = await read().catch(() => { throw new Error('无法读取用户环境变量，未修改'); });
  if (enabled) {
    const restoreValues = sanitizeRestoreValues(current, portAddress);
    const snapshot = { owned: portAddress, values: restoreValues };
    await persist(snapshot); // Durable encrypted recovery state must exist before touching Windows.
    try {
      const next = ownedValues(snapshot.owned);
      await write(next);
      if (!matches(await read(), next)) throw new Error('verify');
      return snapshot;
    } catch {
      try {
        await write(restoreValues);
        if (!matches(await read(), restoreValues)) throw new Error('verify');
        await persist(null);
      } catch { throw new Error('终端代理设置失败，已保留原值备份，请点击恢复原值'); }
      throw new Error('终端代理设置失败，已恢复原值');
    }
  }
  if (!backup) {
    // Even if backup was lost or cleared by an earlier version, clear leftover SuperVPN proxy vars.
    const hasOwned = names.some(name => isOwnedEntry(current[name], portAddress));
    if (!hasOwned) return null;
    const next = Object.fromEntries(names.map(name => [name, isOwnedEntry(current[name], portAddress) ? { exists: false } : current[name]]));
    try {
      await write(next);
      if (!matches(await read(), next)) throw new Error('verify');
    } catch { throw new Error('恢复未完成，请重试'); }
    return null;
  }
  const ownedAddress = backup.owned || portAddress;
  const restoreValues = sanitizeRestoreValues(backup.values, ownedAddress);
  if (!names.every(name => isOwnedEntry(current[name], ownedAddress) || equivalent(current[name], restoreValues[name]))) {
    throw new Error('代理环境变量已被其他程序修改，未覆盖；原值备份仍保留');
  }
  try {
    await write(restoreValues);
    if (!matches(await read(), restoreValues)) throw new Error('verify');
    await persist(null);
  } catch { throw new Error('恢复未完成，原值备份仍保留，请重试'); }
  return null;
}
function terminalProxyView(backup, port) { return { enabled: !!backup, address: backup?.owned || `http://127.0.0.1:${port}` }; }
module.exports = { toggleTerminalProxy, terminalProxyView, reconcileTerminalProxy };
