import { parseDocument } from 'yaml';
const scalar = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Clash 节点参数无效');
  return String(value);
};
function nodeLink(proxy) {
  const type = scalar(proxy.type).toLowerCase();
  if (!['vless', 'trojan'].includes(type)) throw new Error('支持的 Clash 节点暂限 VLESS 和 Trojan');
  for (const field of ['plugin', 'http-opts', 'h2-opts', 'ech-opts', 'smux', 'dialer-proxy', 'packet-encoding']) if (proxy[field] !== undefined) throw new Error('Clash 节点包含未兼容扩展');
  let host = scalar(proxy.server), port = Number(proxy.port);
  if (!host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Clash 节点地址无效');
  host = host.replace(/^\[|\]$/g, ''); if (host.includes(':')) host = `[${host}]`;
  const params = new URLSearchParams();
  const reality = proxy['reality-opts'];
  const tls = type === 'trojan' || proxy.tls === true || !!reality;
  params.set('security', reality ? 'reality' : tls ? 'tls' : 'none');
  if (proxy.servername || proxy.sni) params.set('sni', scalar(proxy.servername || proxy.sni));
  if (proxy.flow) params.set('flow', scalar(proxy.flow));
  if (proxy['client-fingerprint']) params.set('fp', scalar(proxy['client-fingerprint']));
  if (proxy['skip-cert-verify'] === true) params.set('allowInsecure', '1');
  if (proxy.alpn !== undefined) {
    if (!Array.isArray(proxy.alpn) || !proxy.alpn.every(item => typeof item === 'string')) throw new Error('Clash ALPN 参数无效');
    params.set('alpn', proxy.alpn.join(','));
  }
  if (reality) {
    params.set('pbk', scalar(reality['public-key']));
    params.set('sid', scalar(reality['short-id']));
  }
  const network = scalar(proxy.network, 'tcp'); params.set('type', network);
  if (network === 'ws' || network === 'httpupgrade') {
    const options = proxy[network === 'ws' ? 'ws-opts' : 'http-upgrade-opts'] || {};
    if (options['max-early-data'] || options['early-data-header-name']) throw new Error('Clash 早期数据扩展未兼容');
    params.set('path', scalar(options.path, '/'));
    const headers = options.headers || {};
    if (Object.keys(headers).some(name => name.toLowerCase() !== 'host')) throw new Error('Clash 自定义请求头未兼容');
    if (headers.Host || headers.host) params.set('host', scalar(headers.Host || headers.host));
  } else if (network === 'grpc') params.set('serviceName', scalar(proxy['grpc-opts']?.['grpc-service-name']));
  else if (network !== 'tcp') throw new Error('Clash 传输方式未兼容');
  const credential = scalar(type === 'vless' ? proxy.uuid : proxy.password);
  return `${type}://${encodeURIComponent(credential)}@${host}:${port}?${params}#${encodeURIComponent(scalar(proxy.name))}`;
}
export function clashSubscriptionEntries(body) {
  let proxies;
  try {
    const document = parseDocument(body, { version: '1.2', uniqueKeys: true });
    if (document.errors.length) throw new Error();
    proxies = document.toJS({ maxAliasCount: 20 })?.proxies;
  } catch { throw new Error('订阅 YAML 无效或包含不安全的别名扩展'); }
  if (!Array.isArray(proxies) || proxies.length < 1 || proxies.length > 2000) throw new Error('订阅为空或超过 2000 个节点');
  return proxies.map(proxy => {
    const name = typeof proxy?.name === 'string' ? proxy.name.slice(0, 200) : 'Clash 节点';
    const protocol = typeof proxy?.type === 'string' && /^[a-z0-9-]{1,24}$/i.test(proxy.type) ? proxy.type.toUpperCase() : 'CLASH';
    try {
      if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) throw new Error('Clash 节点参数无效');
      return { line: nodeLink(proxy), name, protocol };
    } catch (error) { return { line: '', name, protocol, error: error.message }; }
  });
}
