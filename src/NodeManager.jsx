import React, { useEffect, useState } from 'react';
import { Plus, Gauge, Check, Trash2, Server, Eye, EyeOff, Pencil } from 'lucide-react';
import { visibleNodeItems } from '../shared/node-manager.js';
import { selectedSource, sourceScope } from './source-groups.js';
import { nodeSections } from './node-sections.js';
import { displayedNodeId } from './node-switch.js';

function Delay({ check }) {
  if (!check) return <span className="node-delay untested" title="尚未测试真实 HTTPS 延迟">未测速</span>;
  if (check.status === 'testing') return <span className="node-delay testing">测试中…</span>;
  if (check.status !== 'ok') return <span className="node-delay failed" title={check.reason}>不能用</span>;
  const description = check.measurement === 'warm' ? `HTTPS 统一延迟 · 完整连接 ${check.coldDelayMs} ms · ${check.connectionReused ? '复用目标连接' : '目标重新建连'}` : check.measurement === 'cold' ? '预热后探测未完成，显示首次完整连接耗时' : '旧版完整连接耗时，请重新测速';
  return <span className={`node-delay ${check.delayMs < 500 ? 'fast' : check.delayMs < 1500 ? 'medium' : 'slow'}`} title={`${description} · ${new Date(check.checkedAt).toLocaleTimeString('zh-CN')}`}>{Math.round(check.delayMs)} <small>ms</small></span>;
}
export default function NodeManager({ data, pendingNodeId = null, preferredGroup, busy, onAction, onImport, onDeleteNode, onEdit }) {
  const selection = displayedNodeId(data, pendingNodeId);
  const group = selectedSource(data, preferredGroup);
  const [hideUnavailable, setHideUnavailable] = useState(() => { try { return globalThis.window?.localStorage.getItem('supervpn.hideUnavailable') === 'true'; } catch { return false; } });
  useEffect(() => { try { globalThis.window?.localStorage.setItem('supervpn.hideUnavailable', String(hideUnavailable)); } catch { /* A restricted storage policy must not break the view. */ } }, [hideUnavailable]);
  const progress = data.testProgress || {}, connected = data.session.connected;
  const scope = sourceScope(data, group);
  const allItems = visibleNodeItems(scope.state, { group: scope.group, sort: 'original' }).filter(n => !n.informational);
  const sections = nodeSections(data, allItems, hideUnavailable);
  const hasVisible = sections.some(section => section.nodes.length > 0);
  const testIds = allItems.filter(n => !n.unsupported).map(n => n.id);
  return <div className="nodes-workspace">
    <header className="nodes-heading"><h1>线路</h1><div className="heading-actions"><button className="button quiet availability-toggle" aria-pressed={hideUnavailable} title={hideUnavailable ? '显示所有节点' : '隐藏测速失败及协议不兼容的节点，保留未测速节点'} onClick={() => setHideUnavailable(value => !value)}>{hideUnavailable ? <Eye size={15}/> : <EyeOff size={15}/>}<span>{hideUnavailable ? '显示全部' : '隐藏不可用'}</span></button><button className="button primary" disabled={busy || (!progress.running && !testIds.length)} onClick={() => onAction(progress.running ? 'cancelTests' : 'testNodes', testIds)} title={progress.running ? `停止测速 · ${progress.completed}/${progress.total}` : '测试当前来源的线路'}><Gauge size={15}/>{progress.running ? '停止测速' : '批量测速'}</button></div></header>
    {!hasVisible ? <div className="node-empty"><Server size={29} strokeWidth={1.3}/><p>{hideUnavailable && allItems.length ? '不可用节点已隐藏' : data.nodes.length || data.subscriptions?.length ? '此来源没有节点' : '导入订阅，展开全部节点'}</p>{hideUnavailable && allItems.length > 0 && <button className="button" onClick={() => setHideUnavailable(false)}>显示全部</button>}{!data.nodes.length && !allItems.length && <button className="button" onClick={onImport}><Plus size={14}/>导入订阅</button>}</div> : <div className="node-source-sections">{sections.map(section => <section key={section.id} className="node-source-section" aria-label={section.label}>{!section.nodes.length ? <p className="source-nodes-hidden">此来源的不可用节点已隐藏</p> : <div className="node-grid node-card-grid" role="list" aria-label={`${section.label} 节点列表`}>{section.nodes.map(n => {
      const chosen = selection === n.id;
      return <div role="listitem" key={n.id} className={`node-tile ${chosen ? 'is-selected' : ''} ${n.unsupported ? 'is-unsupported' : ''} ${!n.subscriptionId ? 'is-manual' : ''}`}>
        <button className="node-tile-select" aria-label={n.unsupported ? `${n.name}：${n.reason}` : `选择 ${n.name}`} aria-pressed={!n.unsupported && chosen} aria-busy={pendingNodeId === n.id || undefined} disabled={busy || !!pendingNodeId || n.unsupported} onClick={() => onAction('selectNode', n.id)} title={n.unsupported ? n.reason : `${n.name} · ${n.protocol}${pendingNodeId === n.id ? ' · 正在切换' : connected ? ' · 切换时短暂重连' : ''}`}>
          <span className="node-tile-title"><strong>{n.name}</strong>{!n.subscriptionId && <small className="node-source-id">#{n.id.slice(0, 8)}</small>}</span>
          {n.unsupported ? <span className="node-delay incompatible" title={n.reason}>不能用</span> : <Delay check={data.nodeChecks?.[n.id]}/>}
          <span className={`node-choice ${chosen ? 'chosen' : ''}`} aria-hidden="true">{chosen && <Check size={12}/>}</span>
        </button>
        {!n.unsupported && <button className="node-edit icon-button" aria-label={`编辑 ${n.name}`} title="编辑节点信息" disabled={busy || progress.running} onClick={() => onEdit({ kind: 'node', item: n })}><Pencil size={13}/></button>}
        {!n.subscriptionId && <button className="manual-node-delete icon-button danger" aria-label={`删除 ${n.name}`} disabled={busy || connected} onClick={() => onDeleteNode(n)}><Trash2 size={12}/></button>}
      </div>;
    })}</div>}</section>)}</div>}
    {progress.running && <div className="node-selection-footer" role="status"><small>{progress.completed} / {progress.total} 已测</small></div>}
  </div>;
}
