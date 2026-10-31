import React from 'react';
export default function TerminalProxySettings({ data, busy, onAction }) {
  const enabled = !!data.terminalProxy?.enabled;
  const address = data.terminalProxy?.address || `http://127.0.0.1:${data.settings.mixedPort}`;
  const desktop = data.environment.desktop;
  const hint = !desktop ? '仅桌面端可设置' : !enabled && data.mode !== 'system' ? '请先切换到系统代理模式' : '重启终端后生效，使用时需代理运行；关闭开关恢复原值';
  return <section className="settings-section terminal-proxy-settings"><h3>终端代理</h3><div className="setting-row" title={hint}><div><strong>HTTP_PROXY / HTTPS_PROXY</strong><small><code>{address}</code></small></div><button className={`toggle ${enabled ? 'on' : ''}`} role="switch" aria-label="终端代理" aria-checked={enabled} title={enabled ? '恢复原来的环境变量' : '一键设置用户代理环境变量'} disabled={busy || !desktop || (!enabled && data.mode !== 'system')} onClick={() => onAction('terminalProxy', !enabled)}><span/></button></div></section>;
}
