import React, { useState } from 'react';
const installHint = '点击后将退出软件、恢复系统代理并打开安装向导；已有节点和设置会保留';
export function UpdateSettings({ data, busy, onAction }) {
  const info = data.updateInfo || { supported: false, currentVersion: data.environment.version, phase: 'development' };
  const ready = info.phase === 'ready', installing = info.phase === 'installing';
  const status = !info.supported ? '安装版支持自动更新' : info.phase === 'checking' ? '正在检查更新' : info.phase === 'downloading' ? '正在下载更新' : ready ? `新版本 ${info.version || ''} 已下载` : installing ? '正在准备安装' : info.phase === 'error' ? '更新未完成' : info.phase === 'current' ? '已是最新版本' : '自动检查更新已开启';
  return <section className="settings-section update-settings"><h3>软件更新</h3><div className="setting-row"><div><strong>{status}</strong><small>{info.error || `当前版本 ${info.currentVersion || data.environment.version || ''}`}</small></div><button className={`button ${ready ? 'primary' : 'quiet'}`} disabled={busy || !info.supported || ['checking', 'downloading', 'installing'].includes(info.phase)} title={ready ? installHint : '启动后及每 4 小时自动检查；新版本自动下载，安装前等待确认'} onClick={() => onAction(ready ? 'installUpdate' : 'checkForUpdates', ready ? { confirmed: true } : undefined)}>{ready ? '安装更新' : installing ? '准备安装' : info.phase === 'downloading' ? '下载中' : '检查更新'}</button></div>{info.phase === 'downloading' && <div className="update-progress"><progress aria-label="更新下载进度" max="100" value={info.percent || 0}/><span>{Math.floor(info.percent || 0)}%</span></div>}</section>;
}
export function UpdateNotice({ data, busy, onAction }) {
  const [dismissed, setDismissed] = useState(null);
  const info = data.updateInfo;
  if (!info?.supported || !['ready', 'installing'].includes(info.phase) || (info.phase === 'ready' && dismissed === info.version)) return null;
  const installing = info.phase === 'installing';
  return <aside className="update-banner" role="status"><div><strong>{installing ? '正在准备安装更新' : `新版本 ${info.version || ''} 已下载`}</strong><span>{installing ? '正在安全退出软件' : info.error || '安装后保留已有节点和设置'}</span></div><div className="update-banner-actions">{!installing && <button className="button quiet" disabled={busy} onClick={() => setDismissed(info.version)}>稍后</button>}<button className="button primary" disabled={busy || installing} title={installHint} onClick={() => onAction('installUpdate', { confirmed: true })}>{installing ? '准备安装' : '安装更新'}</button></div></aside>;
}
