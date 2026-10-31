const os = require('node:os');
const net = require('node:net');

function localAddresses(interfaces = os.networkInterfaces()) {
  return [...new Set(Object.entries(interfaces)
    .filter(([name]) => !/loopback|supervpn|sing-box|tun|tap|vethernet|vmware|virtualbox/i.test(name))
    .flatMap(([, entries]) => (entries || []).filter(item => !item.internal && (item.family === 'IPv4' || item.family === 4) && !item.address.startsWith('169.254.')).map(item => item.address)))];
}
function parsePublicInfo(value) {
  if (!value || value.success === false || !net.isIP(value.ip)) throw new Error('无效的网络检测结果');
  return { publicIp: value.ip, country: typeof value.country === 'string' ? value.country.slice(0, 80) : '', countryCode: /^[A-Z]{2}$/.test(value.country_code || '') ? value.country_code : '' };
}
// The endpoint is fixed, HTTPS validation is left enabled, and only an IP/country
// summary is returned to the renderer. No subscription URLs or credentials leave here.
async function inspectNetwork(electronSession, { connected, mode, port }) {
  const result = { localIps: localAddresses(), publicIp: null, country: '', countryCode: '', checkedAt: Date.now() };
  if (connected && mode !== 'system') return { ...result, error: '当前接管模式暂不支持出口检测' };
  const client = electronSession.fromPartition('supervpn-network-check');
  await client.setProxy(connected ? { mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' } : { mode: 'direct' });
  await client.closeAllConnections();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await client.fetch('https://ipwho.is/', { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('检测服务暂不可用');
    const reader = response.body.getReader(); let body = '', size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new Error('检测响应过大'); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return { ...result, ...parsePublicInfo(JSON.parse(body)), path: connected ? 'proxy' : 'direct' };
  } catch { return { ...result, error: '检测失败，点击重试' }; }
  finally { clearTimeout(timer); }
}
module.exports = { localAddresses, parsePublicInfo, inspectNetwork };
