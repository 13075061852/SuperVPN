import { parseLink } from './proxy.js';
export function editName(value) {
  if (typeof value !== 'string' || value.length > 120 || /[\r\n\t\x00-\x1f]/.test(value) || !value.trim()) throw new Error('名称须为 1–120 个字符，不能包含换行或控制字符');
  return value.trim();
}
export function editNode(state, payload, { connected = false, testing = false } = {}) {
  if (testing) throw new Error('请先停止测速再编辑节点');
  const original = state.nodes.find(node => node.id === payload?.id);
  if (!original) throw new Error('节点不存在');
  const name = editName(payload.name);
  let next;
  if (payload.link !== undefined && typeof payload.link !== 'string') throw new Error('节点链接无效');
  if (payload.link?.trim()) next = { ...parseLink(payload.link), name };
  else {
    let host = payload.host === undefined ? original.host : payload.host;
    const port = payload.port === undefined ? original.port : payload.port;
    if (typeof host !== 'string' || host.length > 253 || !host.trim() || /[\s/@?#\\]/.test(host)) throw new Error('服务器地址无效');
    if ((host.includes('[') || host.includes(']')) && !/^\[[^\[\]]+\]$/.test(host)) throw new Error('服务器地址无效');
    host = host.replace(/^\[|\]$/g, '');
    try {
      const url = new URL(`http://${host.includes(':') ? `[${host}]` : host}`);
      if (url.port || url.pathname !== '/' || url.username || url.password) throw new Error();
      host = url.hostname.replace(/^\[|\]$/g, '');
    } catch { throw new Error('服务器地址无效'); }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口须为 1–65535');
    next = { ...original, name, host, port, outbound: { ...structuredClone(original.outbound), server: host, server_port: port } };
  }
  // Identity and source policy are controlled by the stored record, never by the editor.
  next.id = original.id;
  if (original.subscriptionId) next.subscriptionId = original.subscriptionId;
  else delete next.subscriptionId;
  const connectionChanged = JSON.stringify(original.outbound) !== JSON.stringify(next.outbound) || original.insecureRequested !== next.insecureRequested;
  if (connected && connectionChanged) throw new Error('请先断开连接再修改连接参数');
  const nodeChecks = { ...state.nodeChecks };
  if (connectionChanged) delete nodeChecks[original.id];
  return { connectionChanged, state: { ...state, nodes: state.nodes.map(node => node.id === original.id ? next : node), nodeChecks } };
}
export function renameSubscription(state, id, name) {
  if (!(state.subscriptions || []).some(sub => sub.id === id)) throw new Error('订阅不存在');
  const value = editName(name);
  return { ...state, subscriptions: state.subscriptions.map(sub => sub.id === id ? { ...sub, name: value } : sub) };
}
