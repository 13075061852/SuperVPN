import { parseLink } from './proxy.js';
import { isInformationName } from './node-manager.js';
export function isSubscriptionUrl(text) {
  try { const u = new URL(text.trim()); return ['https:', 'http:'].includes(u.protocol) && ((u.pathname && u.pathname !== '/') || !!u.search); } catch { return false; }
}
export function parseSubscription(text) {
  if (typeof text !== 'string' || text.length > 2097152) throw new Error('订阅内容过大');
  let body = text.replace(/^\uFEFF/, '').trim();
  if (!body.includes('://') && /^[A-Za-z0-9+/_=\-\s]+$/.test(body)) {
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(body.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))); }
    catch { throw new Error('订阅 Base64 编码无效'); }
  }
  if (/^\s*(proxies:|\{|\[|<!doctype|<html)/i.test(body)) throw new Error('暂支持 Base64 / 明文节点订阅，不支持 Clash YAML、JSON 或网页');
  const lines = body.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  if (!lines.length || lines.length > 2000) throw new Error('订阅为空或超过 2000 个节点');
  const nodes = [], failures = {}, unsupported = [], information = [];
  for (const line of lines) {
    try {
      const node = parseLink(line);
      if (isInformationName(node.name)) { const { id, name, protocol } = node; information.push({ id, name, protocol }); }
      else nodes.push(node);
    }
    catch (e) {
      const protocol = line.match(/^([a-z0-9]+):\/\//i)?.[1]?.toUpperCase() || '未知格式';
      const reason = e.message.includes('ECH') ? 'ECH 扩展不兼容' : e.message.startsWith('支持') ? '暂未支持' : '参数不兼容';
      const key = `${protocol}：${reason}`; failures[key] = (failures[key] || 0) + 1;
      let name = `${protocol} 节点`;
      try { name = decodeURIComponent(line.split('#').slice(1).join('#')) || name; } catch { /* Never retain the raw credential-bearing link. */ }
      unsupported.push({ id: globalThis.crypto.randomUUID(), name: name.slice(0, 200), protocol, reason });
    }
  }
  if (!nodes.length) throw new Error('订阅中没有可用格式：' + Object.keys(failures).join('；'));
  return { nodes, unsupported, information, total: lines.length, skipped: unsupported.length, failures, secureOverrides: nodes.filter(n => n.insecureRequested).length };
}
