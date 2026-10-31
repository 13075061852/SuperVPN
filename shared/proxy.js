const decode = (s) => { try { return decodeURIComponent(s); } catch { throw new Error('链接包含无效的编码'); } };
const unbase64 = (s) => { try { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))); } catch { throw new Error('无效的 Base64 认证信息'); } };

export function parseLink(input) {
  let raw = input.trim();
  if (raw.length > 16384) throw new Error('节点链接过长');
  const scheme = raw.split(':')[0].toLowerCase();
  if (!['http', 'https', 'socks', 'socks5', 'vless', 'trojan', 'ss', 'anytls', 'hysteria2', 'hy2'].includes(scheme)) throw new Error('支持 HTTP、SOCKS5、VLESS、Trojan、SS、AnyTLS 和 Hysteria2 链接');
  let method, password;
  if (scheme === 'ss') {
    const rest = raw.slice(5).split('#')[0];
    if (!rest.includes('@')) raw = `ss://${unbase64(rest)}${raw.includes('#') ? '#' + raw.split('#')[1] : ''}`;
  }
  let u;
  try { u = new URL(raw); } catch { throw new Error('链接格式无效，请粘贴完整的代理链接'); }
  if (['http', 'https'].includes(scheme) && ((u.pathname && u.pathname !== '/') || u.search)) throw new Error('这是订阅地址，请通过订阅导入');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port || (scheme === 'http' ? 80 : scheme === 'https' ? 443 : 0));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('服务器地址或端口无效');
  const q = u.searchParams;
  let type = ({ https: 'http', socks5: 'socks', hy2: 'hysteria2' })[scheme] || scheme;
  const out = { type, tag: 'proxy', server: host, server_port: port };
  if (['http', 'socks'].includes(type)) {
    if (u.username) out.username = decode(u.username);
    if (u.password) out.password = decode(u.password);
    if (type === 'socks') out.version = '5';
    if (scheme === 'https') out.tls = { enabled: true, server_name: host };
  }
  if (type === 'ss') {
    out.type = 'shadowsocks';
    const credentials = u.password ? `${decode(u.username)}:${decode(u.password)}` : unbase64(decode(u.username));
    const i = credentials.indexOf(':');
    if (i < 1 || !credentials.slice(i + 1)) throw new Error('Shadowsocks 认证信息不完整');
    method = credentials.slice(0, i); password = credentials.slice(i + 1);
    Object.assign(out, { method, password });
    if (q.has('plugin')) throw new Error('暂不支持带插件的 Shadowsocks 链接');
  }
  if (type === 'vless') {
    const uuid = decode(u.username);
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid)) throw new Error('VLESS UUID 无效');
    out.uuid = uuid;
    if (q.get('flow')) out.flow = q.get('flow');
    if (q.has('encryption') && q.get('encryption') !== 'none') throw new Error('暂不支持此 VLESS 加密方式');
  }
  if (type === 'trojan') { if (!u.username) throw new Error('Trojan 密码不能为空'); out.password = decode(u.username); }
  if (['vless', 'trojan'].includes(type)) {
    const security = q.get('security') || (type === 'trojan' ? 'tls' : 'none');
    if (!['none', 'tls', 'reality'].includes(security)) throw new Error('不支持的 TLS 安全模式');
    if (security !== 'none') {
      out.tls = { enabled: true, server_name: q.get('sni') || q.get('peer') || host };
      if (q.get('alpn')) out.tls.alpn = q.get('alpn').split(',');
      if (q.get('fp') || security === 'reality') out.tls.utls = { enabled: true, fingerprint: q.get('fp') || 'chrome' };
      if (security === 'reality') {
        if (!q.get('pbk')) throw new Error('Reality 链接缺少公钥 pbk');
        out.tls.reality = { enabled: true, public_key: q.get('pbk'), short_id: q.get('sid') || '' };
      }
    }
    const transport = q.get('type') || 'tcp';
    if (transport === 'ws') out.transport = { type: 'ws', path: q.get('path') || '/', ...(q.get('host') ? { headers: { Host: q.get('host') } } : {}) };
    else if (transport === 'grpc') out.transport = { type: 'grpc', service_name: q.get('serviceName') || '' };
    else if (transport === 'httpupgrade') out.transport = { type: 'httpupgrade', path: q.get('path') || '/', host: q.get('host') || host };
    else if (transport !== 'tcp') throw new Error(`暂不支持 ${transport} 传输方式`);
  }
  if (['anytls', 'hysteria2'].includes(type)) {
    if (!u.username) throw new Error('节点缺少密码');
    out.password = decode(u.username) + (u.password ? ':' + decode(u.password) : '');
    out.tls = { enabled: true, server_name: q.get('sni') || q.get('peer') || host };
    if (q.get('alpn')) out.tls.alpn = q.get('alpn').split(',');
    if (type === 'anytls' && q.get('fp')) out.tls.utls = { enabled: true, fingerprint: q.get('fp') };
    if (type === 'hysteria2' && q.get('obfs')) {
      if (q.get('obfs') !== 'salamander' || !q.get('obfs-password')) throw new Error('Hysteria2 混淆参数不完整');
      out.obfs = { type: 'salamander', password: q.get('obfs-password') };
    }
  }
  // Do not silently discard ECH extensions that this pinned core cannot represent.
  if (q.get('ech') && q.get('ech') !== '0') {
    const ech = q.get('ech');
    if (!out.tls) throw new Error('ECH 需要 TLS');
    if (ech.includes('://') || ech.includes('+')) throw new Error('当前内核不支持此 ECH DNS 扩展');
    if (ech === '1') out.tls.ech = { enabled: true };
    else if (/^[A-Za-z0-9+/=_-]+$/.test(ech)) out.tls.ech = { enabled: true, config: ['-----BEGIN ECH CONFIGS-----', ech, '-----END ECH CONFIGS-----'] };
    else throw new Error('无法识别此 ECH 配置');
  }
  const insecureRequested = ['1', 'true'].includes(q.get('allowInsecure')) || ['1', 'true'].includes(q.get('insecure'));
  // Store the requested policy as metadata; certificate verification remains ON.
  return { id: globalThis.crypto.randomUUID(), name: decode(u.hash.slice(1)) || `${host}:${port}`, protocol: scheme === 'socks' ? 'SOCKS5' : scheme.toUpperCase(), host, port, insecureRequested, outbound: out };
}

export function tlsCompatibilityAllowed(state, node) {
  if (node.insecureRequested !== true) return false;
  const subscription = (state.subscriptions || []).find(s => s.id === node.subscriptionId);
  if (subscription?.certificatePolicy === 'strict') return false;
  // The user explicitly requested following imported insecure flags without a
  // second per-account confirmation. Unmarked nodes always stay verified.
  if (state.settings?.honorImportedInsecure !== false) return true;
  return !!subscription?.allowInsecure;
}

export function effectiveOutbound(state, node) {
  const outbound = structuredClone(node.outbound);
  if (outbound.tls) {
    // Only the parsed URL flag and saved policy can permit insecure TLS;
    // arbitrary imported outbound.tls.insecure fields are not trusted.
    delete outbound.tls.insecure;
    if (tlsCompatibilityAllowed(state, node)) outbound.tls.insecure = true;
  }
  return outbound;
}

export function createConfig(state, { controllerSecret = '', controllerPort = 19090 } = {}) {
  const node = state.nodes.find(n => n.id === state.selectedNodeId);
  if (!node) throw new Error('请先导入并选择一个节点');
  if (!['system', 'tun'].includes(state.mode)) throw new Error('无效的接管模式');
  const port = state.settings.mixedPort;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === controllerPort) throw new Error('代理端口须为 1024–65535 且不可与控制端口相同');
  const rules = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' },
    { inbound: ['tun-in'], process_name: ['sing-box.exe', 'SuperVPN.exe', 'electron.exe'], action: 'route', outbound: 'direct' }
  ];
  const outboundMode = state.settings.outboundMode || 'rule';
  if (!['rule', 'global', 'direct'].includes(outboundMode)) throw new Error('无效的出站模式');
  for (const rule of state.rules.filter(r => r.enabled)) {
    if (!/^[^\\/:*?"<>|\r\n]+\.exe$/i.test(rule.process)) throw new Error('程序名称必须是有效的 .exe 文件名');
    if (!['proxy', 'direct', 'reject'].includes(rule.action)) throw new Error('无效的分流动作');
    rules.push(rule.action === 'reject' ? { clash_mode: 'Rule', process_name: [rule.process], action: 'reject' } : { clash_mode: 'Rule', process_name: [rule.process], action: 'route', outbound: rule.action });
  }
  if (state.settings.bypassLan) rules.push({ ip_is_private: true, action: 'route', outbound: 'direct' });
  rules.push({ clash_mode: 'Direct', action: 'route', outbound: 'direct' }, { clash_mode: 'Global', action: 'route', outbound: 'proxy' });
  const inbound = state.mode === 'tun'
    ? { type: 'tun', tag: 'tun-in', interface_name: 'SuperVPN', address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'], mtu: 1500, auto_route: true, strict_route: true, stack: 'mixed' }
    : { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: port };
  return {
    log: { level: 'info', timestamp: true },
    dns: { servers: [{ type: 'udp', tag: 'bootstrap', server: '223.5.5.5' }, { type: 'https', tag: 'remote', server: '1.1.1.1', path: '/dns-query', detour: 'proxy' }], rules: [{ clash_mode: 'Direct', server: 'bootstrap' }], final: 'remote', strategy: 'prefer_ipv4' },
    inbounds: [inbound],
    outbounds: [{ ...effectiveOutbound(state, node), tag: 'proxy' }, { type: 'direct', tag: 'direct' }],
    route: { rules, auto_detect_interface: true, default_domain_resolver: 'bootstrap', final: state.settings.defaultAction === 'direct' ? 'direct' : 'proxy' },
    experimental: { clash_api: { external_controller: `127.0.0.1:${controllerPort}`, secret: controllerSecret, default_mode: { rule: 'Rule', global: 'Global', direct: 'Direct' }[outboundMode] } }
  };
}

export const defaultState = () => ({
  nodes: [], subscriptions: [], unsupportedNodes: [], informationNodes: [], nodeChecks: {}, selectedNodeId: null, mode: 'system', rules: [],
  settings: { mixedPort: 17890, bypassLan: true, defaultAction: 'proxy', outboundMode: 'rule', honorImportedInsecure: true, autoStart: false, silentStart: false, closeToTray: true }
});
