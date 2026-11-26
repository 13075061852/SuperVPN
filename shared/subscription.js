import { parseLink } from './proxy.js';
import { clashSubscriptionEntries } from './clash-subscription.js';
import { isInformationName } from './node-manager.js';
export function isSubscriptionUrl(text) {
  try { const u = new URL(text.trim()); return ['https:', 'http:'].includes(u.protocol) && ((u.pathname && u.pathname !== '/') || !!u.search); } catch { return false; }
}

export function prepareImportLinks(payload, subscriptions = []) {
  const content = typeof payload === 'string' ? payload : payload?.content;
  if (typeof content !== 'string' || content.length > 262144) throw new Error('导入内容无效或过长');
  const lines = content.split(/\r?\n/).map((text, index) => ({ line: text.trim(), lineNumber: index + 1 })).filter(({ line }) => line);
  if (!lines.length || lines.length > 100) throw new Error('每次可导入 1–100 条链接');

  const name = typeof payload?.name === 'string' ? payload.name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 120) : '';
  const savedUrls = new Set(subscriptions.map(sub => sub.url));
  const seenUrls = new Set();
  const entries = [];
  for (const [index, { line, lineNumber }] of lines.entries()) {
    const suffix = lines.length === 1 ? '' : ` · ${index + 1}`;
    const label = name && `${name.slice(0, 120 - suffix.length)}${suffix}`;
    if (isSubscriptionUrl(line) || savedUrls.has(line) || (lines.length === 1 && payload?.kind === 'subscription')) {
      let url;
      try { url = new URL(line); } catch { throw new Error(`第 ${lineNumber} 行：订阅地址无效`); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`第 ${lineNumber} 行：订阅必须使用 HTTPS，且不能包含 URL 用户名密码`);
      if (!seenUrls.has(line)) entries.push({ kind: 'subscription', url: line, name: label, lineNumber });
      seenUrls.add(line);
    } else {
      entries.push({ kind: 'node', link: label ? `${line.split('#')[0]}#${encodeURIComponent(label)}` : line, lineNumber });
    }
  }
  return entries;
}

export function parseSubscription(text) {
  if (typeof text !== 'string' || text.length > 2097152) throw new Error('订阅内容过大');
  let body = text.replace(/^\uFEFF/, '').trim();
  if (!body.includes('://') && /^[A-Za-z0-9+/_=\-\s]+$/.test(body)) {
    try { body = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(body.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))); }
    catch { throw new Error('订阅 Base64 编码无效'); }
  }
  const isClash = /^\s*proxies\s*:/m.test(body);
  if (!isClash && /^\s*(\{|\[|<!doctype|<html)/i.test(body)) throw new Error('暂不支持 JSON 或网页订阅');
  const lines = isClash ? clashSubscriptionEntries(body) : body.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(line => ({ line }));
  if (!lines.length || lines.length > 2000) throw new Error('订阅为空或超过 2000 个节点');
  const nodes = [], failures = {}, unsupported = [], information = [];
  for (const entry of lines) {
    const line = entry.line;
    try {
      if (entry.error) throw new Error(entry.error);
      const node = parseLink(line);
      if (isInformationName(node.name)) { const { id, name, protocol } = node; information.push({ id, name, protocol }); }
      else nodes.push(node);
    }
    catch (e) {
      const protocol = entry.protocol || line.match(/^([a-z0-9]+):\/\//i)?.[1]?.toUpperCase() || '未知格式';
      const reason = e.message.includes('ECH') ? 'ECH 扩展不兼容' : e.message.startsWith('支持') ? '暂未支持' : '参数不兼容';
      const key = `${protocol}：${reason}`; failures[key] = (failures[key] || 0) + 1;
      let name = entry.name || `${protocol} 节点`;
      try { name = decodeURIComponent(line.split('#').slice(1).join('#')) || name; } catch { /* Never retain the raw credential-bearing link. */ }
      unsupported.push({ id: globalThis.crypto.randomUUID(), name: name.slice(0, 200), protocol, reason });
    }
  }
  if (!nodes.length) throw new Error('订阅中没有可用格式：' + Object.keys(failures).join('；'));
  return { nodes, unsupported, information, total: lines.length, skipped: unsupported.length, failures, secureOverrides: nodes.filter(n => n.insecureRequested).length };
}
