export function parseRemaining(text) {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i);
  if (!match) return null;
  const power = { b: 0, kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3, tb: 4, tib: 4 }[match[2].toLowerCase()];
  const value = Math.round(Number(match[1]) * 1024 ** power);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function manualProgress(totalGB, remaining) {
  if (!Number.isFinite(totalGB) || totalGB <= 0 || totalGB > 1000000) return null;
  const total = Math.round(totalGB * 1024 ** 3), rest = parseRemaining(remaining);
  if (rest === null || rest > total) return null;
  return { total, used: total - rest, remaining: rest, percent: (total - rest) / total * 100, manual: true };
}
export function quotaKey(id) { return `supervpn.quotaGB.${id}`; }
export function readQuota(id) {
  try { const raw = globalThis.window?.localStorage.getItem(quotaKey(id)); return raw ? Number(raw) : null; } catch { return null; }
}
export function saveQuota(id, text) {
  const value = text.trim() ? Number(text) : null;
  if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1000000)) throw new Error('总额度须为 0–1000000 GB 之间的有效数值');
  try { if (value === null) window.localStorage.removeItem(quotaKey(id)); else window.localStorage.setItem(quotaKey(id), String(value)); }
  catch { throw new Error('无法保存总额度'); }
}
