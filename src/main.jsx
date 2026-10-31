import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Power, Gauge, Folder, Network, Server, Settings, Plus, Check, Terminal, Trash2, MonitorCog, Shield } from 'lucide-react';
import { bridge } from './bridge';
import NodeManager from './NodeManager';
import Dashboard from './Dashboard';
import Profiles from './Profiles';
import SecurityOptions from './SecurityOptions';
import TerminalProxySettings from './TerminalProxySettings';
import { UpdateSettings, UpdateNotice } from './Updates';
import SourceEditor from './SourceEditor';
import WindowPin from './WindowPin';
import Routing from './Routing';
import { readAutoConnect, writeAutoConnect, startupConnection } from './startup-connection.js';
import { nodeSourceGroup, prepareManualLinks, selectedSource } from './source-groups.js';
import { subscriptionInUse } from '../shared/node-manager.js';
import { createOptimisticNodeSwitch } from './node-switch.js';
import './styles.css';

const navigation = [{ id: 'overview', label: '仪表盘', icon: Gauge }, { id: 'nodes', label: '线路选择', icon: Server }, { id: 'profiles', label: '节点导入', icon: Folder }, { id: 'rules', label: '分流控制', icon: Network }, { id: 'logs', label: '日志', icon: Terminal }, { id: 'settings', label: '设置', icon: Settings }];
const actionNames = { proxy: '代理', direct: '直连', reject: '拦截' };
function Mark() { return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M24 5 L11 5 L5 14 L18 14 L12 23 L4 23" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><path d="M19 5 L24 5 L24 10 M9 23 L4 23 L4 18" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>; }
function Toggle({ checked, onChange, label, disabled }) { return <button className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange} disabled={disabled}><span/></button>; }
function CloseIcon() { return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.2"/></svg>; }
function Dialog({ children, onClose, title, blocked }) {
  const ref = useRef(null), closeRef = useRef(onClose), [closing, setClosing] = useState(false);
  closeRef.current = onClose;
  const dismiss = () => { if (!blocked) setClosing(true); };
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select:not(:disabled)')];
    const first = ref.current.querySelector('textarea') || ref.current.querySelector('input') || focusable()[0]; first?.focus();
    const key = e => {
      if (e.key === 'Escape' && !blocked) { e.preventDefault(); setClosing(true); }
      if (e.key === 'Tab') { const list = focusable(); const first = list[0], last = list.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    const el = ref.current; el.addEventListener('keydown', key);
    return () => { el.removeEventListener('keydown', key); previous?.focus(); };
  }, [blocked]);
  useEffect(() => { if (!closing) return; const timer = setTimeout(() => closeRef.current(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 130); return () => clearTimeout(timer); }, [closing]);
  return <div className={`dialog-backdrop ${closing ? 'leaving' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) dismiss(); }}><section ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="关闭对话框" disabled={blocked} onClick={dismiss}><CloseIcon/></button></header>{children}</section></div>;
}
function App() {
  const [data, setData] = useState(null), [page, setPage] = useState('overview'), [nodeGroup, setNodeGroup] = useState(() => { try { return window.localStorage.getItem('supervpn.selectedSource'); } catch { return null; } }), [securityTarget, setSecurityTarget] = useState(null), [editorTarget, setEditorTarget] = useState(null), [modal, setModal] = useState(null), [error, setError] = useState(''), [pending, setPending] = useState(false), [now, setNow] = useState(Date.now());
  const [pendingNodeId, setPendingNodeId] = useState(null), nodeSwitch = useRef(null);
  if (!nodeSwitch.current) nodeSwitch.current = createOptimisticNodeSwitch({ request: id => call('selectNode', id), onPending: setPendingNodeId });
  const [links, setLinks] = useState(''), [importName, setImportName] = useState(''), [importMode, setImportMode] = useState('subscription'), [process, setProcess] = useState(''), [action, setAction] = useState('proxy');
  useEffect(() => { if (nodeGroup) { try { window.localStorage.setItem('supervpn.selectedSource', nodeGroup); } catch { /* Selection must work without storage. */ } } }, [nodeGroup]);
  const [autoConnect, setAutoConnect] = useState(() => { try { return readAutoConnect(window.localStorage); } catch { return false; } });
  useEffect(() => { bridge.call('get').then(value => { setData(value); return startupConnection({ data: value, enabled: autoConnect, storage: window.sessionStorage, connect: () => call('connect') }); }).catch(e => setError(e.message)); const off = bridge.onUpdate(setData); const timer = setInterval(() => setNow(Date.now()), 1000); return () => { off(); clearInterval(timer); }; }, []);
  async function call(method, payload) {
    setPending(true); setError('');
    try { const result = await bridge.call(method, payload); if (result?.settings) setData({ ...result, busy: false }); return result; }
    catch (e) {
      if (method === 'selectNode') {
        // Failure may occur after stopping the core. Read actual state rather
        // than pretending that either node is still connected.
        try { const actual = await bridge.call('get'); if (actual?.settings) setData({ ...actual, busy: false }); } catch { /* Keep last authoritative broadcast if unavailable. */ }
      }
      setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return null;
    }
    finally { setPending(false); }
  }
  if (!data) return <div className="loading"><Mark/>{error || '正在启动…'}</div>;
  const { session, settings, environment: env } = data;
  const busy = pending || data.busy, editLocked = busy || session.connected;
  const elapsed = session.startedAt ? Math.max(0, Math.floor((now - session.startedAt) / 1000)) : 0;
  const duration = `${Math.floor(elapsed / 3600).toString().padStart(2, '0')}:${Math.floor(elapsed % 3600 / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const setting = (key, value) => call('settings', { [key]: value });
  function openImport() { setError(''); setLinks(''); setImportName(''); setImportMode('subscription'); setModal('import'); }
  function openRule() { setError(''); setProcess(''); setAction('proxy'); setModal('rule'); }
  function openSecurity(subscription) { setError(''); setSecurityTarget(subscription); }
  function openEditor(target) { setError(''); setEditorTarget(target); }
  function closeEditor() { setEditorTarget(null); setError(''); }
  async function applySecurity(allowInsecure, confirmed) {
    const subscriptionId = securityTarget.id;
    const result = await call('subscriptionSecurity', { subscriptionId, allowInsecure, confirmed });
    if (result) {
      setSecurityTarget(null); setNodeGroup(subscriptionId); setPage('nodes');
      await call('testNodes', result.nodes.filter(n => n.subscriptionId === subscriptionId).map(n => n.id));
    }
  }
  return <div className="desktop">
    <div className="workspace">
      <aside className="rail"><span className="app-name"><span className="brand-mark"><Mark/></span>Super<span className="brand-suffix">VPN</span></span><nav aria-label="主导航">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} title={label} aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => { setPage(id); setError(''); }}><span className="rail-icon"><Icon size={20} strokeWidth={1.7}/></span><span className="rail-label">{label}</span></button>)}</nav></aside>
      <header className="titlebar" aria-label="窗口控制"><div className="window-tools">{env.desktop && <><WindowPin windowState={data.windowState} onUpdate={setData} onError={setError}/><button className="window-button" title="最小化" aria-label="最小化" onClick={() => call('minimize')}><svg width="14" height="14"><path d="M3 7h8" stroke="currentColor"/></svg></button><button className="window-button close" title={settings.closeToTray ? '关闭到托盘' : '关闭窗口'} aria-label="关闭窗口" onClick={() => call('close')}><CloseIcon/></button></>}</div></header>
      <UpdateNotice data={data} busy={busy} onAction={call}/>
      <main className={page === 'overview' ? 'dashboard-page' : page === 'nodes' ? 'nodes-page' : page === 'profiles' ? 'profiles-main' : page === 'logs' ? 'logs-page' : ''}>
        {error && !modal && !securityTarget && !editorTarget && <div className="error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><CloseIcon/></button></div>}
        {page === 'overview' && <Dashboard data={data} busy={busy} onAction={call} onSetting={setting} onNavigate={setPage} onImport={openImport} duration={duration}/>}
        {page === 'nodes' && <NodeManager onEdit={openEditor} data={data} pendingNodeId={pendingNodeId} preferredGroup={selectedSource(data, nodeGroup)} busy={busy} onSecurity={openSecurity} onAction={(method, payload) => method === 'selectNode' ? nodeSwitch.current(payload) : call(method, payload)} onImport={openImport} onDeleteNode={node => setModal({ type: 'delete', node })} onDeleteSubscription={subscription => setModal({ type: 'subscription', subscription })} onCleanLegacy={subscription => setModal({ type: 'legacy', subscription })}/>}
        {page === 'profiles' && <Profiles selectedGroup={selectedSource(data, nodeGroup)} onEdit={openEditor} data={data} busy={busy} onDeleteNode={node => setModal({ type: 'delete', node })} onSecurity={openSecurity} onImport={openImport} onAction={call} onOpen={id => { setNodeGroup(id); setPage('nodes'); }} onDelete={subscription => setModal({ type: 'subscription', subscription })}/>}
        {page === 'rules' && <Routing data={data} busy={busy} onAction={call}/>}
        {page === 'logs' && <><PageHeader title="日志"><button className="button quiet" disabled={busy || !data.logs.length} onClick={() => call('clearLogs')}>清空</button></PageHeader>{!data.logs.length ? <Empty icon={Terminal} text="暂无运行记录"/> : <div className="log-list">{[...data.logs].reverse().map((l, i) => <div className={`log-entry ${l.level}`} key={`${l.time}-${i}`}><time>{new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span className="log-level">{l.level}</span><code>{l.message}</code></div>)}</div>}</>}
        {page === 'settings' && <><PageHeader title="设置"/><div className="settings-section"><h3>启动与后台</h3><Setting title="启动后自动连接"><Toggle label="启动后自动连接" checked={autoConnect} disabled={busy || !env.desktop} onChange={() => { try { writeAutoConnect(window.localStorage, !autoConnect); setAutoConnect(!autoConnect); } catch (e) { setError(e.message); } }}/></Setting><Setting title="开机自启"><Toggle label="开机自启" checked={settings.autoStart} disabled={editLocked} onChange={() => setting('autoStart', !settings.autoStart)}/></Setting><Setting title="静默启动"><Toggle label="静默启动" checked={settings.silentStart} disabled={editLocked} onChange={() => setting('silentStart', !settings.silentStart)}/></Setting><Setting title="关闭后驻留托盘"><Toggle label="关闭后驻留托盘" checked={settings.closeToTray} disabled={editLocked} onChange={() => setting('closeToTray', !settings.closeToTray)}/></Setting></div><div className="settings-section"><h3>网络</h3><Setting title="接管方式"><span>系统代理</span></Setting><Setting title="局域网直连"><Toggle label="局域网直连" checked={settings.bypassLan} disabled={editLocked} onChange={() => setting('bypassLan', !settings.bypassLan)}/></Setting><Setting title="本地端口"><input className="port-input" type="number" min="1024" max="65535" key={settings.mixedPort} aria-label="本地代理端口" defaultValue={settings.mixedPort} disabled={editLocked} onBlur={e => { if (Number(e.target.value) !== settings.mixedPort) setting('mixedPort', Number(e.target.value)); }}/></Setting></div><TerminalProxySettings data={data} busy={busy} onAction={call}/><UpdateSettings data={data} busy={busy} onAction={call}/></>}
      </main>

    </div>
    {editorTarget && <Dialog title={editorTarget.kind === 'subscription' ? '编辑订阅' : '编辑节点'} blocked={busy} onClose={closeEditor}><SourceEditor key={`${editorTarget.kind}:${editorTarget.item.id}`} target={editorTarget} connected={editorTarget.kind === 'subscription' ? subscriptionInUse(data, session, editorTarget.item.id) : session.connected} busy={busy} error={error} onCancel={closeEditor} onSave={async (method, payload) => { const result = await call(method, payload); if (result) closeEditor(); }}/></Dialog>}
    {securityTarget && <Dialog title="订阅连接兼容性" blocked={pending} onClose={() => { setSecurityTarget(null); setError(''); }}><SecurityOptions key={securityTarget.id} subscription={securityTarget} connected={session.connected} pending={pending} error={error} onApply={applySecurity} onCancel={() => { setSecurityTarget(null); setError(''); }}/></Dialog>}
    {modal && <Dialog title={modal === 'import' ? '导入' : modal === 'rule' ? '添加程序' : modal.type === 'subscription' ? '移除订阅' : modal.type === 'legacy' ? '清理旧条目' : '删除节点'} blocked={pending} onClose={() => { setModal(null); setError(''); }}><form onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) e.preventDefault(); }} onSubmit={async e => {
      e.preventDefault();
      if (modal === 'import' && importMode === 'subscription' && !/^https:\/\/\S+$/i.test(links.trim())) { setError('请输入完整订阅地址；单个代理请选择「节点链接」'); return; }
      const method = modal === 'import' ? 'import' : modal === 'rule' ? 'addRule' : modal.type === 'subscription' ? 'deleteSubscription' : modal.type === 'legacy' ? 'removeLegacyNodes' : 'deleteNode';
      const payload = modal === 'import' ? { content: importMode === 'nodes' ? prepareManualLinks(links, importName) : links, name: importName, kind: importMode } : modal === 'rule' ? { process: process.trim(), action } : modal.subscription?.id || modal.node.id;
      const result = await call(method, payload);
      if (result) { if (modal === 'import') { const oldIds = new Set(data.nodes.map(n => n.id)); const added = result.nodes.filter(n => !oldIds.has(n.id)); setNodeGroup(result.importReport?.subscriptionId || (added.length === 1 ? nodeSourceGroup(added[0].id) : 'manual')); setPage('nodes'); } setModal(null); setLinks(''); }
    }}>{modal === 'import' ? <><div className="import-mode segmented"><button type="button" aria-pressed={importMode === 'subscription'} className={importMode === 'subscription' ? 'selected' : ''} onClick={() => setImportMode('subscription')}>订阅链接</button><button type="button" aria-pressed={importMode === 'nodes'} className={importMode === 'nodes' ? 'selected' : ''} onClick={() => setImportMode('nodes')}>节点链接</button></div><label htmlFor="subscription-name">{importMode === 'subscription' ? '订阅名称（可选）' : '节点名称（可选）'}</label><input id="subscription-name" className="subscription-name-input" placeholder="例如：工作线路" maxLength={120} value={importName} onChange={e => setImportName(e.target.value)}/><label htmlFor="import-source">{importMode === 'subscription' ? '订阅地址' : '代理链接'}</label><textarea id="import-source" className={importMode === 'subscription' ? 'subscription-input' : ''} required placeholder={importMode === 'subscription' ? 'https://…/subscribe?token=…' : '粘贴代理链接，每行一条'} spellCheck="false" maxLength={262144} value={links} onChange={e => setLinks(e.target.value)}/><div className="form-note">{importMode === 'subscription' ? '获取订阅后展开全部节点，不会当作单个 HTTPS 代理' : 'HTTP / SOCKS5 / VLESS / AnyTLS / Hysteria2 / Trojan / SS'}</div></> : modal === 'rule' ? <><label htmlFor="program">程序</label><div className="program-input"><input id="program" placeholder="chrome.exe" required value={process} onChange={e => setProcess(e.target.value)}/><button type="button" className="button" disabled={pending} onClick={async () => { const value = await call('pickProcess'); if (typeof value === 'string') setProcess(value); }}>浏览</button></div><label htmlFor="path">网络路径</label><div className="route-options" id="path">{Object.entries(actionNames).map(([id, name]) => <button type="button" aria-pressed={action === id} key={id} className={action === id ? 'selected' : ''} onClick={() => setAction(id)}>{name}{action === id && <Check size={13}/>}</button>)}</div></> : <p className="delete-confirm">{modal.type === 'subscription' ? `移除「${modal.subscription.name}」及其节点？手动节点不受影响。` : modal.type === 'legacy' ? `仅清理 ${modal.subscription.legacyNodeIds.length} 个同地址旧版条目，保留已解析的订阅节点。` : `删除「${modal.node.name}」？`}</p>}{error && <div className="form-error" role="alert">{error}</div>}<div className="dialog-actions"><button type="button" className="button quiet" disabled={pending} onClick={() => { setModal(null); setError(''); }}>取消</button><button className={`button ${typeof modal === 'object' ? 'destructive' : 'primary'}`} disabled={pending}>{pending ? '处理中…' : modal === 'import' ? '导入' : modal === 'rule' ? '添加' : '删除'}</button></div></form></Dialog>}
  </div>;
}
function PageHeader({ title, count, children }) { return <div className="page-header"><h1>{title}{count !== undefined && <span>{count}</span>}</h1><div>{children}</div></div>; }
function Empty({ icon: Icon, text, action, onClick, disabled }) { return <div className="empty-state"><Icon size={30} strokeWidth={1.3}/><p>{text}</p>{action && <button className="button" disabled={disabled} onClick={onClick}><Plus size={14}/>{action}</button>}</div>; }
function Setting({ title, hint, children }) { return <div className="setting-row"><div><span>{title}</span>{hint && <small>{hint}</small>}</div>{children}</div>; }
createRoot(document.getElementById('root')).render(<App/>);
