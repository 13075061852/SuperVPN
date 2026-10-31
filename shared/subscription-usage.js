export function parseSubscriptionUsage(header) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  const values = {};
  for (const piece of header.split(';')) {
    const match = piece.trim().match(/^(upload|download|total|expire)\s*=\s*(\d+)$/i);
    if (!match) continue;
    const number = Number(match[2]);
    if (!Number.isSafeInteger(number) || number < 0) return null;
    const key = match[1].toLowerCase();
    if (Object.hasOwn(values, key)) return null;
    values[key] = number;
  }
  if (!['upload', 'download', 'total'].every(key => Object.hasOwn(values, key))) return null;
  if (!Number.isSafeInteger(values.upload + values.download)) return null;
  return { upload: values.upload, download: values.download, total: values.total, ...(values.expire > 0 && values.expire < 8640000000000 ? { expire: values.expire } : {}) };
}
export function quotaProgress(usage) {
  if (!usage || !['upload', 'download', 'total'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0) || usage.total === 0) return null;
  const used = usage.upload + usage.download;
  if (!Number.isSafeInteger(used)) return null;
  return { used, total: usage.total, remaining: Math.max(0, usage.total - used), percent: Math.min(100, used / usage.total * 100) };
}
export function quotaBytes(value) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let n = value / 1024, index = 0;
  while (n >= 1024 && index < units.length - 1) { n /= 1024; index++; }
  return `${Number(n.toFixed(2))} ${units[index]}`;
}
