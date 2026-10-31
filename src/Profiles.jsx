import React, { useEffect, useRef } from 'react';
import { EllipsisVertical, Plus, RefreshCw, Trash2, Server, Link, Check, Folder, Pencil } from 'lucide-react';
import { sourceGroups } from './source-groups.js';
import { subscriptionFacts } from './source-presentation.js';
import SubscriptionUsage from './SubscriptionUsage';
import { quotaBytes, quotaProgress } from '../shared/subscription-usage.js';
import { attachMenuDismissal } from './menu-dismissal.js';
import { subscriptionInUse } from '../shared/node-manager.js';

export default function Profiles({ data, busy, onImport, onOpen, onAction, onDelete, onDeleteNode, onSecurity, onEdit, selectedGroup }) {
  const root = useRef(null);
  useEffect(() => attachMenuDismissal(root.current, document, window), []);
  const selected = data.nodes.find(n => n.id === data.selectedNodeId);
  const subscriptions = data.subscriptions || [], sources = sourceGroups(data), links = sources.filter(s => s.kind === 'node');
  const connected = data.session.connected;
  const usageAttempted = useRef(new Set());
  useEffect(() => {
    if (!data.environment?.programDiscovery || busy) return;
    const missing = subscriptions.find(sub => !quotaProgress(sub.usage) && !usageAttempted.current.has(sub.id));
    if (!missing) return;
    usageAttempted.current.add(missing.id);
    // A backend upgrade does not rewrite stored usage. Refresh only plan data,
    // once per source view; never replace nodes or interrupt a connection.
    onAction('refreshSubscriptionUsage', missing.id);
  }, [subscriptions, busy, data.environment?.programDiscovery]);
  function menu(source, sub, node) {
    return <details className="profile-menu" name="supervpn-source-menu"><summary className="icon-button" aria-label={`${source.name} · ${source.identifier} 操作`}><EllipsisVertical size={17}/></summary><div className="context-menu">
      <button onClick={e => { e.currentTarget.closest('details').open = false; onOpen(source.id); }}><Server size={14}/>查看线路</button>
      <button disabled={busy || (!sub && data.testProgress?.running)} onClick={e => { e.currentTarget.closest('details').open = false; onEdit(sub ? { kind: 'subscription', item: sub } : { kind: 'node', item: node }); }}><Pencil size={14}/>编辑{sub ? '订阅' : '节点'}</button>
      {sub && <><button disabled={busy} onClick={e => { e.currentTarget.closest('details').open = false; onAction('refreshSubscriptionUsage', sub.id); }}><RefreshCw size={14}/>更新流量</button><button disabled={busy || subscriptionInUse(data, data.session, sub.id)} title={subscriptionInUse(data, data.session, sub.id) ? '当前连接正在使用此订阅，断开后可更新' : '更新此订阅，不影响当前连接'} onClick={e => { e.currentTarget.closest('details').open = false; onAction('refreshSubscription', sub.id); }}><RefreshCw size={14}/>更新订阅</button></>}
      <button disabled={busy || connected} onClick={e => { e.currentTarget.closest('details').open = false; sub ? onDelete(sub) : onDeleteNode(node); }}><Trash2 size={14}/>{sub ? '移除订阅' : '删除节点链接'}</button>
    </div></details>;
  }
  return <div ref={root} className="profiles-page tidy-sources"><header className="page-header"><h1>来源</h1><button className="button primary" disabled={busy} onClick={onImport}><Plus size={16}/>导入</button></header>
    {!subscriptions.length && !links.length ? <div className="empty-state"><Folder size={28}/><p>还没有订阅或独立节点</p><button className="button" disabled={busy} onClick={onImport}><Plus size={15}/>添加订阅</button></div> : <div className="source-sections">
      {subscriptions.length > 0 && <section aria-label="订阅来源"><h2 className="section-caption">订阅<span>{subscriptions.length}</span></h2><div className="profile-grid">
        {subscriptions.map((sub, index) => {
          const source = sources.find(s => s.kind === 'subscription' && s.id === sub.id);
          const facts = subscriptionFacts((data.informationNodes || []).filter(n => n.subscriptionId === sub.id));
          const quota = quotaProgress(sub.usage);
          const remaining = quota ? quotaBytes(quota.remaining) : facts.remaining;
          const expiry = sub.usage?.expire ? new Date(sub.usage.expire * 1000).toLocaleDateString('sv-SE') : facts.expiry;
          const active = selectedGroup ? selectedGroup === sub.id : selected?.subscriptionId === sub.id, sameName = subscriptions.some(other => other.id !== sub.id && other.name === sub.name);
          return <article key={sub.id} className={`profile-card tone-${['lilac', 'mint', 'lemon', 'peach'][index % 4]} ${active ? 'selected-profile' : ''}`}>
            <div className="source-card-heading"><span className="source-card-icon"><Folder size={18}/></span><button className="source-card-name" aria-label={`选择来源 ${sub.name}`} aria-pressed={active} title={`${sub.name} · ID ${source.identifier} · ${new Date(sub.updatedAt).toLocaleString('zh-CN')} 更新`} onClick={() => onOpen(sub.id)}>{sub.name}{sameName && ` · #${source.identifier}`}</button>{active && <Check className="source-active-check" size={15} aria-label="当前选中来源"/>}{menu(source, sub, null)}</div>
            <SubscriptionUsage subscription={sub} remaining={facts.remaining}/>
            {(remaining || expiry) && <dl className="source-facts">{remaining && <div><dt>剩余流量</dt><dd>{remaining}</dd></div>}{expiry && <div><dt>到期</dt><dd>{expiry}</dd></div>}</dl>}
          </article>;
        })}
      </div></section>}
      {links.length > 0 && <section aria-label="独立节点"><h2 className="section-caption">独立节点<span>{links.length}</span></h2><div className="independent-grid">{links.map(source => {
        const node = data.nodes.find(n => n.id === source.nodeId), active = selectedGroup ? selectedGroup === source.id : selected?.id === node.id;
        return <article key={source.id} className={`independent-card ${active ? 'selected-profile' : ''}`}><div className="source-card-heading"><span className="source-card-icon"><Link size={18}/></span><button className="source-card-name" aria-label={`选择来源 ${source.name}`} aria-pressed={active} title={source.name} onClick={() => onOpen(source.id)}>{source.name}</button>{active && <Check className="source-active-check" size={15} aria-label="当前选中来源"/>}{menu(source, null, node)}</div></article>;
      })}</div></section>}
    </div>}
  </div>;
}
