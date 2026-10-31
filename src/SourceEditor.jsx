import React, { useState } from 'react';
export default function SourceEditor({ target, connected, busy, error, onSave, onCancel }) {
  const subscription = target.kind === 'subscription', item = target.item;
  const [name, setName] = useState(item.name), [host, setHost] = useState(item.host || ''), [port, setPort] = useState(String(item.port || ''));
  const [replacement, setReplacement] = useState('');
  const connectionLocked = busy || connected;
  return <form className="source-editor" autoComplete="off" onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) e.preventDefault(); }} onSubmit={async e => {
    e.preventDefault();
    await onSave(subscription ? 'editSubscription' : 'editNode', subscription ? { id: item.id, name, url: replacement } : { id: item.id, name, host, port: Number(port), link: replacement });
  }}>
    <label htmlFor="edit-source-name">{subscription ? '订阅名称' : '节点名称'}</label><input id="edit-source-name" value={name} maxLength={120} required disabled={busy} onChange={e => setName(e.target.value)}/>
    {!subscription && <div className="editor-endpoint"><div><label htmlFor="edit-node-host">服务器</label><input id="edit-node-host" value={host} required disabled={connectionLocked || !!replacement.trim()} spellCheck="false" maxLength={253} onChange={e => setHost(e.target.value)}/></div><div><label htmlFor="edit-node-port">端口</label><input id="edit-node-port" type="number" min="1" max="65535" step="1" value={port} required disabled={connectionLocked || !!replacement.trim()} onChange={e => setPort(e.target.value)}/></div></div>}
    <label htmlFor="edit-source-replacement">{subscription ? '替换订阅地址' : `替换连接参数 · ${item.protocol}`}</label><input id="edit-source-replacement" type="password" autoComplete="new-password" value={replacement} maxLength={16384} spellCheck="false" disabled={connectionLocked} placeholder={subscription ? '留空保留当前地址' : '粘贴完整新节点链接，留空保留原参数'} onChange={e => setReplacement(e.target.value)}/>
    <div className="form-note">{connected ? '连接中仅可修改名称；修改连接参数请先断开。' : subscription ? '替换地址会重新获取节点，并按新链接的证书参数连接。' : item.subscriptionId ? '订阅节点的本地修改可能在更新订阅后被覆盖。' : '认证与传输参数保持不变；粘贴新链接可一并替换。'}</div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="dialog-actions"><button type="button" className="button quiet" disabled={busy} onClick={onCancel}>取消</button><button className="button primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div>
  </form>;
}
