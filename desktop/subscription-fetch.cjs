// Chromium networking honors Windows proxy settings. The subscription-only
// session permits user-authorized unknown authorities without weakening any
// website, speed-test or update HTTPS session. Keep tests/CLI injectable.
const { createSubscriptionRequest } = require('./subscription-tls.cjs');
let subscriptionRequest;
function desktopFetch(input, options) {
  if (process.versions.electron) {
    subscriptionRequest ||= createSubscriptionRequest(require('electron').session);
    return subscriptionRequest(input, options);
  }
  return globalThis.fetch(input, options);
}
exports.fetchSubscription = async (input, { requestFetch = desktopFetch } = {}) => {
  let initial;
  try { initial = new URL(input); } catch { throw new Error('订阅地址无效'); }
  const safe = url => url.protocol === 'https:' && !url.username && !url.password;
  if (!safe(initial)) throw new Error('订阅必须使用 HTTPS，且不能包含 URL 用户名密码');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 25000);
  async function request(userAgent) {
    let url = new URL(initial);
    for (let i = 0; i < 5; i++) {
      const response = await requestFetch(url, { signal: abort.signal, redirect: 'manual', headers: { 'User-Agent': userAgent, Accept: 'text/plain, */*' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('订阅重定向无效');
      url = new URL(location, url);
      if (!safe(url)) throw new Error('拒绝不安全的订阅重定向');
    }
    throw new Error('订阅重定向过多');
  }
  try {
    const response = await request(`SuperVPN/${require('../package.json').version}`);
    if (!response.ok) throw new Error(`订阅服务器返回 HTTP ${response.status}`);
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2097152) { await reader.cancel(); throw new Error('订阅内容超过 2 MB'); } chunks.push(value); }
    const { parseSubscriptionUsage } = await import('../shared/subscription-usage.js');
    let usage = parseSubscriptionUsage(response.headers.get('subscription-userinfo'));
    if (!usage) {
      // Some providers emit usage headers only to Clash-compatible clients.
      // Preserve the original text-node response: never import this YAML body.
      try {
        const metadata = await request('ClashMetaForAndroid/2.11.5');
        try { if (metadata.ok) usage = parseSubscriptionUsage(metadata.headers.get('subscription-userinfo')); }
        finally { await metadata.body?.cancel(); }
      } catch { /* Optional metadata must not discard a valid node subscription. */ }
    }
    return { body: Buffer.concat(chunks).toString('utf8'), usage };
  } catch (e) {
    if (/^订阅|^拒绝/.test(e.message)) throw e;
    const code = String(e.cause?.code || e.code || e.message || '');
    if (abort.signal.aborted || /TIMED?OUT|TIMEOUT|AbortError/i.test(code)) throw new Error('订阅获取超时，请稍后重试');
    if (/CERT|SSL|TLS/i.test(code)) throw new Error('订阅 HTTPS 证书无效，请检查有效期及域名或 IP 是否匹配');
    if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(code)) throw new Error('订阅域名解析失败，请检查 DNS');
    if (/PROXY|TUNNEL|ECONNREFUSED/i.test(code)) throw new Error('订阅网络或代理连接失败，请检查当前代理');
    throw new Error('订阅获取失败，请检查网络或订阅有效期');
  } finally { clearTimeout(timeout); }
};
