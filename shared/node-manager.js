// Pure state transitions: shared by desktop, preview and regression tests.
export const isInformationName = name => /^(剩余流量|距离下次重置剩余|套餐到期|流量重置|到期时间)[：:]/.test(name.trim());
export function normalizeNodeState(state) {
  const info = state.nodes.filter(n => n.subscriptionId && isInformationName(n.name));
  if (!info.length) return state;
  const ids = new Set(info.map(n => n.id));
  const nodes = state.nodes.filter(n => !ids.has(n.id));
  return { ...state, nodes,
    informationNodes: [...(state.informationNodes || []).filter(n => !ids.has(n.id)), ...info.map(({ id, name, protocol, subscriptionId }) => ({ id, name, protocol, subscriptionId }))],
    selectedNodeId: nodes.some(n => n.id === state.selectedNodeId) ? state.selectedNodeId : nodes[0]?.id || null
  };
}
export function subscriptionInUse(state, session, subscriptionId) {
  if (!session?.connected || !subscriptionId) return false;
  if (session.subscriptionId) return session.subscriptionId === subscriptionId;
  const active = state.nodes.find(n => n.id === (session.nodeId || state.selectedNodeId));
  return active?.subscriptionId === subscriptionId;
}
export function assertSubscriptionWritable(state, session, subscriptionId) {
  if (subscriptionInUse(state, session, subscriptionId)) throw new Error('此订阅正在用于当前连接，请先断开再更新；新增或更新其他订阅无需断开');
}
export function replaceSubscription(state, parsed, subscription) {
  const id = subscription.id;
  const previous = state.nodes.find(n => n.id === state.selectedNodeId);
  const old = state.nodes.filter(n => n.subscriptionId === id);
  const nodes = parsed.nodes.map(n => ({ ...n, subscriptionId: id }));
  const sub = { ...subscription, count: nodes.length, total: parsed.total, skipped: parsed.skipped, failures: parsed.failures, secureOverrides: parsed.secureOverrides };
  const selectedNodeId = !previous || old.some(n => n.id === previous.id)
    ? nodes.find(n => n.name === previous?.name && n.host === previous?.host && n.port === previous?.port)?.id || nodes[0]?.id || null
    : previous.id;
  const removed = new Set(old.map(n => n.id));
  return {
    ...state,
    nodes: [...state.nodes.filter(n => n.subscriptionId !== id), ...nodes],
    informationNodes: [...(state.informationNodes || []).filter(n => n.subscriptionId !== id), ...(parsed.information || []).map(n => ({ ...n, subscriptionId: id }))],
    unsupportedNodes: [...(state.unsupportedNodes || []).filter(n => n.subscriptionId !== id), ...(parsed.unsupported || []).map(n => ({ ...n, subscriptionId: id }))],
    subscriptions: [...(state.subscriptions || []).filter(s => s.id !== id), sub],
    nodeChecks: Object.fromEntries(Object.entries(state.nodeChecks || {}).filter(([id]) => !removed.has(id))),
    selectedNodeId
  };
}
export function setSubscriptionSecurity(state, payload) {
  const { subscriptionId, allowInsecure, confirmed } = payload || {};
  if (typeof allowInsecure !== 'boolean') throw new Error('证书策略无效');
  if (!(state.subscriptions || []).some(s => s.id === subscriptionId)) throw new Error('订阅不存在');
  if (allowInsecure && confirmed !== true) throw new Error('必须先明确确认跳过代理证书验证的风险');
  const ids = new Set(state.nodes.filter(n => n.subscriptionId === subscriptionId).map(n => n.id));
  return { ...state,
    subscriptions: state.subscriptions.map(s => s.id === subscriptionId ? { ...s, allowInsecure, certificatePolicy: allowInsecure ? 'import' : 'strict' } : s),
    nodeChecks: Object.fromEntries(Object.entries(state.nodeChecks || {}).filter(([id]) => !ids.has(id)))
  };
}
export function removeSubscription(state, id) {
  const nodes = state.nodes.filter(n => n.subscriptionId !== id);
  return {
    ...state, nodes,
    informationNodes: (state.informationNodes || []).filter(n => n.subscriptionId !== id),
    unsupportedNodes: (state.unsupportedNodes || []).filter(n => n.subscriptionId !== id),
    subscriptions: (state.subscriptions || []).filter(s => s.id !== id),
    nodeChecks: Object.fromEntries(Object.entries(state.nodeChecks || {}).filter(([id]) => nodes.some(n => n.id === id))),
    selectedNodeId: nodes.some(n => n.id === state.selectedNodeId) ? state.selectedNodeId : nodes[0]?.id || null
  };
}
export function legacyCandidateIds(state, subscription) {
  let host;
  try { host = new URL(subscription.url).hostname; } catch { return []; }
  return state.nodes.filter(n => !n.subscriptionId && n.protocol === 'HTTPS' && n.host === host && n.name === `${n.host}:${n.port}`).map(n => n.id);
}
export function nodeCounts(state, group = 'all') {
  const matches = n => group === 'all' || (group === 'manual' ? !n.subscriptionId : n.subscriptionId === group);
  const available = state.nodes.filter(matches).length;
  const unsupported = (state.unsupportedNodes || []).filter(matches).length;
  const information = (state.informationNodes || []).filter(matches).length;
  return { available, unsupported, information, total: available + unsupported + information };
}
export function visibleNodeItems(state, { group = 'all', query = '', sort = 'original' } = {}) {
  const text = query.trim().toLowerCase();
  const all = [...state.nodes, ...(state.informationNodes || []).map(n => ({ ...n, informational: true })), ...(state.unsupportedNodes || []).map(n => ({ ...n, unsupported: true }))];
  const nodes = all.filter(n => (group === 'all' || (group === 'manual' ? !n.subscriptionId : n.subscriptionId === group)) && `${n.name} ${n.host || ''} ${n.protocol}`.toLowerCase().includes(text));
  if (sort === 'name') nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  if (sort === 'latency') nodes.sort((a, b) => {
    const latency = n => state.nodeChecks?.[n.id]?.status === 'ok' ? state.nodeChecks[n.id].delayMs : n.unsupported ? Infinity : Number.MAX_SAFE_INTEGER;
    return latency(a) - latency(b);
  });
  return nodes;
}
