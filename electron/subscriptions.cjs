exports.fetchSubscription = async (input) => {
  let url;
  try { url = new URL(input); } catch { throw new Error('订阅地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('订阅必须使用 HTTPS，且不能包含 URL 用户名密码');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 25000);
  try {
    let response;
    for (let i = 0; i < 5; i++) {
      response = await fetch(url, { signal: abort.signal, redirect: 'manual', headers: { 'User-Agent': `SuperVPN/${require('../package.json').version}`, Accept: 'text/plain, */*' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('订阅重定向无效');
      url = new URL(location, url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('拒绝不安全的订阅重定向');
      response = null;
    }
    if (!response) throw new Error('订阅重定向过多');
    if (!response.ok) throw new Error(`订阅服务器返回 HTTP ${response.status}`);
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2097152) { await reader.cancel(); throw new Error('订阅内容超过 2 MB'); } chunks.push(value); }
    const { parseSubscriptionUsage } = await import('../shared/subscription-usage.js');
    return { body: Buffer.concat(chunks).toString('utf8'), usage: parseSubscriptionUsage(response.headers.get('subscription-userinfo')) };
  } catch (e) {
    // Network errors may include the token-bearing URL. Never forward raw errors.
    if (/^订阅|^拒绝/.test(e.message)) throw e;
    throw new Error('订阅获取失败，请检查网络、证书或订阅有效期');
  } finally { clearTimeout(timeout); }
};
