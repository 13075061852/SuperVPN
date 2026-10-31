import React, { useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { bridge } from './bridge';
export default function WindowPin({ windowState, onUpdate, onError }) {
  const [pending, setPending] = useState(false);
  const supported = typeof windowState?.alwaysOnTop === 'boolean';
  const pinned = supported && windowState.alwaysOnTop;
  const label = pinned ? '取消置顶' : '窗口置顶';
  return <button className={`window-button window-pin ${pinned ? 'is-pinned' : ''}`} aria-label={label} aria-pressed={pinned} title={supported ? label : '置顶功能将在正常退出并重新启动后可用'} disabled={pending || !supported} onClick={async () => {
    if (pending || !supported) return;
    setPending(true); onError('');
    try {
      const result = await bridge.call('alwaysOnTop', !pinned);
      if (typeof result?.windowState?.alwaysOnTop !== 'boolean') throw new Error('窗口未返回置顶状态');
      onUpdate(result);
    } catch (error) { onError(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setPending(false); }
  }}>{pinned ? <PinOff size={14} strokeWidth={1.6} aria-hidden="true"/> : <Pin size={14} strokeWidth={1.6} aria-hidden="true"/>}</button>;
}
