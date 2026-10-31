export function normalizeDomain(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入有效域名');
  let text = value.trim();
  if (text.startsWith('*.')) text = text.slice(2);
  if (!text || /[\s\\@]/.test(text)) throw new Error('请输入域名，不含空格或认证信息');
  const hasScheme = /^https?:\/\//i.test(text);
  if (!hasScheme && /[/:?#]/.test(text)) throw new Error('请输入域名或完整 HTTP(S) 网址');
  let url;
  try { url = new URL(hasScheme ? text : `https://${text}`); } catch { throw new Error('请输入有效域名'); }
  const domain = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.username || url.password || url.port || domain.length > 253 || /^[\d.]+$/.test(domain) || domain.includes(':') || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('请输入有效域名，不支持 IP 地址、端口或通配路径');
  return domain;
}
export function websiteRuleList(state) {
  const source = state.websiteRules || [];
  if (!Array.isArray(source) || source.length > 1000) throw new Error('网站规则最多 1000 条');
  const domains = new Set();
  return source.map(rule => {
    const domain = normalizeDomain(rule.domain);
    if (domains.has(domain) || !['proxy', 'direct', 'reject'].includes(rule.action)) throw new Error('网站规则重复或动作无效');
    domains.add(domain);
    return { ...rule, domain };
  }).sort((a, b) => b.domain.split('.').length - a.domain.split('.').length || a.domain.localeCompare(b.domain));
}
export function setWebsiteRule(state, payload, newId = () => globalThis.crypto.randomUUID()) {
  const domain = normalizeDomain(payload?.domain), action = payload?.action;
  if (!['proxy', 'direct', 'reject'].includes(action)) throw new Error('无效的网站分流动作');
  const current = websiteRuleList(state), existing = current.find(rule => rule.domain === domain);
  if (!existing && current.length >= 1000) throw new Error('网站规则最多 1000 条');
  const rule = { id: existing?.id || newId(), domain, action, enabled: payload.enabled === undefined ? existing?.enabled !== false : payload.enabled === true };
  return { ...state, websiteRules: existing ? current.map(item => item.domain === domain ? rule : item) : [...current, rule] };
}
export function removeWebsiteRule(state, id) {
  if (typeof id !== 'string' || !(state.websiteRules || []).some(rule => rule.id === id)) throw new Error('网站规则不存在');
  return { ...state, websiteRules: state.websiteRules.filter(rule => rule.id !== id) };
}
