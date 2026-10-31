import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { normalizeDomain } from '../shared/website-rules.js';
export default function WebsiteRouting({ data, busy, onAction }) {
  const [domain, setDomain] = useState(''), [action, setAction] = useState('proxy'), [error, setError] = useState('');
  const supported = !data.environment.desktop || data.environment.websiteRouting === true;
  const locked = busy || data.session.connected || !supported;
  const rules = data.websiteRules || [];
  const hint = !supported ? '网站规则接口下次正常启动后可用' : data.session.connected ? '请先断开连接再修改网站规则' : '域名及其子域名；更具体的域名优先，规则模式下生效';
  async function add(event) {
    event.preventDefault(); if (locked) return;
    try {
      const normalized = normalizeDomain(domain); setError('');
      const result = await onAction('setWebsiteRule', { domain: normalized, action });
      if (result) setDomain('');
    } catch (e) { setError(e.message); }
  }
  return <section className="website-routing" aria-label="网站分流规则">
    <form className="website-rule-form" onSubmit={add}>
      <input aria-label="网站域名" placeholder="域名，例如 example.com" value={domain} maxLength={2048} disabled={locked} onChange={e => setDomain(e.target.value)} title="输入域名或粘贴网址，自动包含子域名，不按网页路径区分"/>
      <select aria-label="新网站网络规则" value={action} disabled={locked} onChange={e => setAction(e.target.value)}><option value="proxy">代理</option><option value="direct">直连</option><option value="reject">拦截</option></select>
      <button type="submit" className="button primary" disabled={locked || !domain.trim()} title={hint}><Plus size={14} aria-hidden="true"/>添加</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="website-rule-hint">{!supported ? hint : data.session.connected ? '断开后可编辑，下次连接生效' : (data.settings.outboundMode || 'rule') !== 'rule' ? '切换到规则模式后生效' : '包含子域名 · 网站优先于程序规则'}</p>
    <div className="website-rule-list" tabIndex={0} aria-label="已配置网站">
      {rules.map(rule => <div className="website-rule-row" key={rule.id}>
        <button className={`toggle ${rule.enabled !== false ? 'on' : ''}`} role="switch" aria-label={`启用 ${rule.domain} 网站规则`} aria-checked={rule.enabled !== false} disabled={locked} title={hint} onClick={() => onAction('setWebsiteRule', { domain: rule.domain, action: rule.action, enabled: rule.enabled === false })}><span/></button>
        <strong title={rule.domain}>{rule.domain}</strong>
        <select className="program-rule" data-action={rule.action} aria-label={`${rule.domain} 网站规则`} title={hint} disabled={locked} value={rule.action} onChange={e => onAction('setWebsiteRule', { domain: rule.domain, action: e.target.value })}><option value="proxy">代理</option><option value="direct">直连</option><option value="reject">拦截</option></select>
        <button className="icon-button danger" aria-label={`删除 ${rule.domain} 网站规则`} title={hint} disabled={locked} onClick={() => onAction('deleteWebsiteRule', rule.id)}><Trash2 size={15} aria-hidden="true"/></button>
      </div>)}
      {!rules.length && <div className="empty-state"><p>还没有网站规则</p></div>}
    </div>
  </section>;
}
