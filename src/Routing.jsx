import React, { useState } from 'react';
import ProgramRouting from './ProgramRouting';
import WebsiteRouting from './WebsiteRouting';
export default function Routing({ data, busy, onAction }) {
  const [tab, setTab] = useState('websites');
  return <div className="routing-page"><header className="page-header"><h1>分流控制</h1></header>
    {data.session?.connected && data.reconnectRequired && <div className="reconnect-notice" role="status">设置已更改，需要重连后生效</div>}
    <div className="routing-tabs program-filters" role="group" aria-label="分流类型"><button aria-pressed={tab === 'websites'} onClick={() => setTab('websites')}>网站<span>{(data.websiteRules || []).length}</span></button><button aria-pressed={tab === 'programs'} onClick={() => setTab('programs')}>程序</button></div>
    {tab === 'websites' ? <WebsiteRouting data={data} busy={busy} onAction={onAction}/> : <ProgramRouting data={data} busy={busy} onAction={onAction} embedded/>}
  </div>;
}
