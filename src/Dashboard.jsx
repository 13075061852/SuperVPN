import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Gauge, Monitor, Network, Power, RefreshCw, Shuffle } from 'lucide-react';
import { bridge } from './bridge';
import CountryFlag from './CountryFlag';
import NodeSpeedTest from './NodeSpeedTest';

export const bytes = (n = 0) => n < 1024 ? `${Math.round(n)} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
export default function Dashboard({ data, busy, onAction, onSetting, onNavigate, onImport, duration }) {
  const { session, settings, environment } = data;
  const current = useRef(session), [samples, setSamples] = useState(Array.from({ length: 40 }, () => ({ up: 0, down: 0 })));
  const [network, setNetwork] = useState(null), [checking, setChecking] = useState(false), [refresh, setRefresh] = useState(0);
  const gradient = useId().replace(/:/g, '');
  useEffect(() => { current.current = session; }, [session]);
  useEffect(() => {
    const timer = setInterval(() => { const s = current.current; setSamples(previous => [...previous.slice(-39), { up: s.connected ? s.upSpeed || 0 : 0, down: s.connected ? s.downSpeed || 0 : 0 }]); }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    setNetwork(null);
    if (!environment.desktop) { setChecking(false); return; }
    setChecking(true);
    bridge.call('networkInfo').then(value => { if (live) setNetwork(value); })
      .catch(() => { if (live) setNetwork({ error: '检测失败，点击重试', localIps: [] }); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [environment.desktop, session.connected, session.startedAt, data.mode, settings.outboundMode, settings.defaultAction, refresh]);
  const maximum = Math.max(1024, ...samples.map(p => Math.max(p.up, p.down)));
  const line = key => samples.map((p, i) => `${i ? 'L' : 'M'}${(i / 39 * 500).toFixed(1)},${(112 - p[key] / maximum * 92).toFixed(1)}`).join(' ');
  const node = data.nodes.find(n => n.id === data.selectedNodeId);
  const proxyOn = session.connected && data.mode === 'system';
  async function toggleSystemProxy() {
    if (proxyOn) return onAction('disconnect');
    if (!node) return onImport();
    if (data.mode !== 'system') { const result = await onAction('mode', 'system'); if (!result) return; }
    return onAction('connect');
  }
  return <div className="dashboard instrument-dashboard">
    <header className="page-header dashboard-heading"><h1>仪表盘</h1><div className="dashboard-current">
      <button className="current-node-button" title={node?.name || '导入线路'} onClick={() => node ? onNavigate('nodes') : onImport()}>{node?.name || '选择线路'}<ChevronRight size={14}/></button>
      {session.connected && <span className="session-time">{duration}</span>}
    </div></header>
    <section className="instrument-card dashboard-controls" aria-label="连接与出站控制">
      <div className="dashboard-proxy-control"><h2><Shuffle size={17} aria-hidden="true"/>系统代理</h2><button className={`toggle ${proxyOn ? 'on' : ''}`} role="switch" aria-checked={proxyOn} aria-label="系统代理" disabled={busy || (session.connected && data.mode !== 'system')} title={session.connected && data.mode !== 'system' ? '请先断开当前连接' : proxyOn ? '关闭系统代理并断开' : '连接并启用系统代理'} onClick={toggleSystemProxy}><span/></button></div>
      <div className="dashboard-outbound-control"><h2><Network size={17} aria-hidden="true"/>出站模式</h2><div className="outbound-choices" role="radiogroup" aria-label="出站模式">{[{ id: 'rule', name: '规则' }, { id: 'global', name: '全局' }, { id: 'direct', name: '直连' }].map(mode => <button key={mode.id} role="radio" aria-checked={(settings.outboundMode || 'rule') === mode.id} disabled={busy} title={session.connected ? '即时切换，对新连接生效' : mode.name} onClick={() => onSetting('outboundMode', mode.id)}><span className={`mode-radio ${(settings.outboundMode || 'rule') === mode.id ? 'checked' : ''}`}/>{mode.name}</button>)}</div></div>
    </section>
    <div className="instrument-grid">
      <section className="instrument-card speed-panel" aria-label="实时网络速度">
        <div className="instrument-heading"><h2><Gauge size={17}/>网络速度</h2><div className="live-speeds"><span title="上传速度"><ArrowUp size={12}/>{bytes(session.upSpeed)}/s</span><span title="下载速度"><ArrowDown size={12}/>{bytes(session.downSpeed)}/s</span></div></div>
        <svg className="speed-chart" viewBox="0 0 500 125" preserveAspectRatio="none" role="img" aria-label="最近 40 秒实际上传和下载速度"><defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".22"/><stop offset="100%" stopColor="currentColor" stopOpacity=".02"/></linearGradient></defs><path d={`${line('down')} L500,125 L0,125 Z`} fill={`url(#${gradient})`}/><path d={line('up')} className="upload-line" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/><path d={line('down')} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>
      </section>
      <section className="instrument-card totals-panel"><div className="instrument-heading"><h2><Gauge size={17} aria-hidden="true"/>流量统计</h2></div><dl className="traffic-totals" aria-label="本次连接累计流量"><div className="traffic-total-row"><dt><ArrowUp size={14} aria-hidden="true"/>上传</dt><dd>{bytes(session.upload)}</dd></div><div className="traffic-total-row"><dt><ArrowDown size={14} aria-hidden="true"/>下载</dt><dd>{bytes(session.download)}</dd></div></dl></section>
    </div>
    <div className="address-panels">
        <section className="instrument-card public-ip-panel"><div className="instrument-heading"><h2 title={network?.country ? `${network.country}${network.countryCode ? ` · ${network.countryCode}` : ''}（${network.path === 'proxy' ? '代理出口' : '直连出口'}）` : '出口 IP'}><CountryFlag code={network?.countryCode} country={network?.country}/><span className="public-exit-country">{network?.country ? `${network.country}${network.countryCode ? ` · ${network.countryCode}` : ''}` : '出口 IP'}</span></h2><button className="icon-button" aria-label="刷新网络信息" title="通过 ipwho.is 检测出口 IP 和地区" disabled={checking || !environment.desktop} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} className={checking ? 'spin' : ''}/></button></div><div className="network-address" aria-live="polite">{checking ? '检测中…' : network?.publicIp || (environment.desktop ? network?.error || '尚未检测' : '桌面端可检测')}</div></section>
        <section className="instrument-card local-ip-panel"><div className="instrument-heading"><h2><Monitor size={17}/>内网 IP</h2></div><div className="network-address" title={network?.localIps?.join('\n')}>{network?.localIps?.join(' · ') || (checking ? '检测中…' : environment.desktop ? '未发现内网地址' : '桌面端可查看')}</div></section>
    </div>
    <NodeSpeedTest data={data} busy={busy} onAction={onAction}/>
    <footer className="dashboard-connect"><button className={`button ${session.connected ? 'disconnect-button' : 'primary'}`} disabled={busy} onClick={() => session.connected ? onAction('disconnect') : node ? onAction('connect') : onImport()}><Power size={17}/>{busy ? '处理中…' : session.connected ? '断开连接' : '连接代理'}</button></footer>
  </div>;
}
