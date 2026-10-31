// Return only fixed messages: raw core errors can contain hosts, UUIDs or URLs.
exports.classifyNetworkError = (diagnostic = '', fallback = '连接失败') => {
  const text = String(diagnostic);
  const result = (code, label, reason) => ({ status: 'failed', code, label, reason });
  if (/TLS_TARGET/i.test(text)) return result('target_tls', '测试站证书异常', '代理通道已建立，但 HTTPS 测试站证书未通过验证');
  if (/certificate has expired|certificate expired|CERT_HAS_EXPIRED|not yet valid/i.test(text)) return result('tls_expired', '证书过期', '代理证书已过期或尚未生效，请检查服务器证书和系统时间');
  if (/not valid for|certificate is valid for|doesn.t contain any IP SANs|cannot validate certificate.*IP SAN|ERR_TLS_CERT_ALTNAME_INVALID|certificate.*name.*mismatch/i.test(text)) return result('tls_name', '证书名称不符', '代理证书与节点 SNI / 服务器名称不匹配');
  if (/unknown authority|self.signed|unable to verify|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN/i.test(text)) return result('tls_untrusted', '证书不受信任', '代理使用自签名或不受信任证书。严格校验已拒绝连接；只有确认风险后才能按订阅要求启用兼容模式');
  if (/x509|failed to verify certificate|certificate verify failed/i.test(text)) return result('tls_verify', '证书校验失败', '代理证书未通过验证，请检查证书、SNI 和系统时间');
  if (/authentication failed|authentication failure|unauthorized|invalid password|bad credentials|status.?407/i.test(text)) return result('auth', '认证失败', '代理服务器拒绝认证，请更新订阅或核对凭据');
  if (/no such host|ENOTFOUND|EAI_AGAIN|dns.*(failed|timeout)|lookup.*(failed|timeout)/i.test(text)) return result('dns', 'DNS 解析失败', '无法解析代理服务器或测试目标域名');
  if (/refused|ECONNREFUSED/i.test(text)) return result('refused', '连接被拒绝', '服务器拒绝连接，请检查节点端口和服务状态');
  if (/ECONNRESET|reset by peer|connection reset|unexpected EOF|closed by peer/i.test(text)) return result('reset', '连接被重置', '代理服务器或测试目标中断了连接，可换线路或稍后重试');
  if (/network is unreachable|no route to host|ENETUNREACH|EHOSTUNREACH/i.test(text)) return result('unreachable', '网络不可达', '当前网络无法到达节点服务器');
  if (/deadline exceeded|timed out|timeout|ETIMEDOUT/i.test(text)) return result('timeout', '连接超时', '节点未在测试时限内完成连接');
  if (/unknown field|decode config|parse config|initialize outbound|start.*failed/i.test(text)) return result('core_config', '内核配置错误', '测速内核无法启动此节点，请检查协议参数与内核版本');
  if (/HTTP_STATUS_/i.test(text)) return result('http_status', '测试站响应异常', '已收到测试站响应，但状态码不是 200 / 204');
  return result('connection', fallback, '代理通道未完成请求，请尝试更新订阅、换线路或检查服务端状态');
};
