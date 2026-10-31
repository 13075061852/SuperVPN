import React, { useState } from 'react';
import { manualProgress, readQuota, saveQuota } from './quota-settings.js';
import { quotaBytes, quotaProgress } from '../shared/subscription-usage.js';
export default function SubscriptionUsage({ subscription, remaining }) {
  const [manual, setManual] = useState(() => readQuota(subscription.id));
  const [editing, setEditing] = useState(false), [value, setValue] = useState(''), [error, setError] = useState('');
  const automatic = quotaProgress(subscription.usage);
  const progress = automatic || manualProgress(manual, remaining);
  const updated = subscription.usageUpdatedAt ? ` · ${new Date(subscription.usageUpdatedAt).toLocaleString('zh-CN')} 更新` : ' · 请在菜单中更新流量';
  return <div className={`subscription-usage ${progress ? '' : 'quota-unknown'}`} title={`${progress?.manual ? '总额度由用户填写；已用量按服务商剩余流量计算（按 1024 进制，可能有舍入误差）' : '订阅服务器提供的套餐用量，不是本机流量统计'}${updated}`}>
    <div className="quota-caption"><span>{progress ? `${progress.manual ? '约已用' : '已用'} ${quotaBytes(progress.used)}` : '流量进度'}</span>{automatic ? <span>共 {quotaBytes(progress.total)}</span> : <button className="quota-edit" title="手动填写套餐总额度，不会从订阅名称猜测" onClick={() => { setValue(manual ? String(manual) : ''); setError(''); setEditing(!editing); }}>{manual ? `手动 ${manual} GB` : '总额度未知 · 设置'}</button>}</div>
    {editing && <form className="quota-form" onSubmit={e => { e.preventDefault(); try { saveQuota(subscription.id, value); setManual(value.trim() ? Number(value) : null); setEditing(false); setError(''); } catch (e) { setError(e.message); } }}><input type="number" min="0.001" max="1000000" step="any" aria-label="套餐总额度 GB" placeholder="总额度 GB，留空恢复自动" value={value} onChange={e => setValue(e.target.value)}/><button className="button" type="submit">保存</button><button className="button quiet" type="button" onClick={() => setEditing(false)}>取消</button>{error && <span className="form-error" role="alert">{error}</span>}</form>}
    {progress ? <div className="quota-track" role="progressbar" aria-label={`${subscription.name} 已用流量`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(progress.percent.toFixed(2))} aria-valuetext={`已用 ${quotaBytes(progress.used)}，总额度 ${quotaBytes(progress.total)}`}><span style={{ width: `${progress.percent}%` }}/></div> : <div className="quota-track" aria-hidden="true"/>}
  </div>;
}
