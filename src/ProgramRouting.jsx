import React, { useEffect, useState } from 'react';
import { MonitorCog, Search } from 'lucide-react';
import { bridge } from './bridge';
import { programView } from './program-presentation.js';
export default function ProgramRouting({ data, busy, onAction, embedded = false }) {
  const [result, setResult] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const supported = data.environment.programDiscovery === true;
  const locked = busy || data.session.connected;
  async function scan(refresh = false) {
    if (!supported || loading) return;
    setLoading(true); setError('');
    try { const value = await bridge.call('programs', { refresh }); if (!Array.isArray(value?.programs)) throw new Error('程序识别结果无效'); setResult(value); }
    catch (e) { setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setLoading(false); }
  }
  useEffect(() => { scan(); }, [supported]);
  const { rows, counts } = programView({ programs: result?.programs || [], rules: data.rules, query, filter });
  const editHint = data.session.connected ? '请先断开连接再修改分流规则' : '同名 exe 共用规则，修改后下次连接生效';
  return <div className="program-routing">
    {!embedded && <header className="page-header"><h1>分流控制</h1></header>}
    {!supported && <p className="routing-notice">{data.environment.desktop ? '程序自动识别将在正常退出并重新启动后可用。' : '系统程序识别仅在 Windows 桌面端可用。'}</p>}
    <div className="program-tools">
      <label className="program-search"><Search size={16} aria-hidden="true"/><input aria-label="搜索系统程序" placeholder="搜索程序或 .exe" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <div className="program-filter-bar"><div className="program-filters" role="group" aria-label="程序筛选">{[{ id: 'all', label: '全部' }, { id: 'running', label: '运行中' }, { id: 'configured', label: '已配置' }].map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{counts[item.id]}</span></button>)}</div>{query && <span className="program-result-count">{rows.length} 项匹配</span>}</div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result?.partial && <p className="routing-notice">已达到识别上限，仅显示已识别的程序。</p>}
    <div className="program-table">
      <div className="program-table-heading" aria-hidden="true"><span>程序</span><span>网络路径</span></div>
      <div className="program-list" aria-label="程序列表" aria-busy={loading} tabIndex={0}>
        {loading && <p className="program-scan-state" role="status">正在识别本机程序…</p>}
        {rows.map(app => <div className="program-row" key={app.process.toLowerCase()}>
          <div className="program-name"><div className="program-name-line"><strong title={app.paths.join('\n') || app.process}>{app.name}</strong>{app.running && <span className="program-running">运行中</span>}</div><small title={`${app.process}${app.paths.length > 1 ? ` · ${app.paths.length} 个位置` : ''}${app.rules.length > 1 ? ' · 多条旧规则，同名 exe 共用配置' : ''}`}>{app.process}</small></div>
          <select className="program-rule" data-action={app.rule?.action || 'default'} aria-label={`${app.name} 网络规则`} title={editHint} disabled={locked} value={app.rule?.action || 'default'} onChange={e => onAction('setProgramRule', { process: app.process, action: e.target.value })}><option value="default">跟随默认</option><option value="proxy">代理</option><option value="direct">直连</option><option value="reject">拦截</option></select>
        </div>)}
        {!rows.length && !loading && <div className="empty-state"><MonitorCog size={26} aria-hidden="true"/><p>{query ? '没有匹配的程序' : filter === 'configured' ? '还没有单独配置的程序' : filter === 'running' ? '没有识别到运行中的程序' : result ? '未发现可识别的程序' : '暂无程序'}</p></div>}
      </div>
    </div>
  </div>;
}
