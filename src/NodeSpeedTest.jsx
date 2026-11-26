import React from 'react';
import { ArrowDown, ArrowUp, Gauge } from 'lucide-react';
const phases = { 'warmup-download': '下载预热', 'warmup-upload': '上传预热', starting: '准备中', latency: '测延迟', download: '测下载', upload: '测上传', done: '测试完成', partial: '部分测试未完成', error: '测试失败', cancelled: '已停止' };
const dialScale = [0, 1, 10, 100, 1000, 10000];
const dialArc = 'M 45.8 106 A 58 58 0 1 1 146.2 106';
const speedNames = { download: '下载', upload: '上传' };
const formatRate = mbps => Number(mbps.toFixed(2));

function SpeedDial({ rate, label, direction }) {
  const upper = dialScale.findIndex(mark => mark > rate);
  const progress = rate == null ? 0 : upper < 0 ? 1 :
    (upper - 1 + (rate - dialScale[upper - 1]) / (dialScale[upper] - dialScale[upper - 1])) / (dialScale.length - 1);
  const angle = -120 + 240 * progress;
  return <div className={`speed-dial${direction === 'upload' ? ' upload' : ''}`}>
    <svg viewBox="0 0 192 118" aria-hidden="true" focusable="false">
      <path className="speed-dial-track" d={dialArc}/>
      <path className="speed-dial-progress" d={dialArc} pathLength="100" strokeDasharray="100" style={{ strokeDashoffset: 100 * (1 - progress) }}/>
      {dialScale.map((mark, index) => {
        const tickAngle = -120 + 240 * index / (dialScale.length - 1);
        const radians = tickAngle * Math.PI / 180;
        return <g key={mark}>
          <line className="speed-dial-tick" x1="96" y1="25" x2="96" y2="31" transform={`rotate(${tickAngle} 96 77)`}/>
          <text className="speed-dial-mark" x={96 + 72 * Math.sin(radians)} y={77 - 72 * Math.cos(radians)} dy=".35em">{mark >= 1000 ? `${mark / 1000}k` : mark}</text>
        </g>;
      })}
      <g className="speed-dial-needle" style={{ transform: `rotate(${angle}deg)` }}>
        <path d="M 92 77 L 96 30 L 100 77 Z"/>
      </g>
      <circle className="speed-dial-hub" cx="96" cy="77" r="4"/>
    </svg>
    <div className="speed-dial-readout">
      <div className="speed-dial-rate">{rate == null ? '—' : formatRate(rate)} <span>Mbps</span></div>
      <span className="speed-dial-label" role="status">{label}</span>
    </div>
  </div>;
}

function failureLabel(result) {
  if (result?.code === 'timeout') return '超时';
  if (result?.code === 'http_status') return '服务异常';
  if (result?.code === 'reset') return '中断';
  return '失败';
}
export default function NodeSpeedTest({ data, busy, onAction }) {
  const node = data.nodes.find(n => n.id === data.selectedNodeId);
  const test = data.speedTest || {}, running = !!test.running;
  const current = !!node && test.nodeId === node.id;
  const delay = current && test.latency?.status === 'ok' ? test.latency : data.nodeChecks?.[node?.id];
  const validDelay = delay?.status === 'ok' && Number.isFinite(delay.delayMs) && delay.delayMs > 0;
  const liveFor = direction => running && current && test.phase === direction && test.live?.direction === direction && Number.isFinite(test.live.mbps) && test.live.mbps >= 0 ? test.live : null;
  const averageFor = direction => {
    const result = current ? test[direction] : null;
    return ['ok', 'partial'].includes(result?.status) && Number.isFinite(result.mbps) && result.mbps > 0 ? result.mbps : null;
  };
  const speed = direction => {
    const live = liveFor(direction);
    if (live) return `${formatRate(live.mbps)} Mbps`;
    const result = current ? test[direction] : null;
    const average = averageFor(direction);
    return average != null ? `${formatRate(average)} Mbps` : result?.status === 'failed' ? failureLabel(result) : running && current && test.phase === direction ? '测试中' : running && current && test.phase === `warmup-${direction}` ? '预热中' : '未测';
  };
  const hint = direction => {
    if (liveFor(direction)) return direction === 'upload' ? '当前上传速率（最近约 1 秒的已发送数据）；结束后显示经服务端确认的全程平均值' : '当前下载速率（最近约 1 秒）；结束后显示全程平均值';
    const result = current ? test[direction] : null;
    if (result?.status === 'partial') return `部分连接或传输未完成，仅显示已完成传输的实测均速。${result.warning || ''}`;
    return result?.reason || '所选节点的实测平均速度，不是实时流量或带宽上限';
  };
  const unavailable = !data.environment.desktop ? '仅桌面端可测速' : !data.environment.speedTesting ? '速度测试下次启动后可用' : !node ? '请先选择节点' : '';
  const title = unavailable || (running ? `${phases[test.phase] || '测试中'} · ${test.nodeName || node?.name}` : '测延迟，再预热并进行 4 路持续下载、上传，各约 10 秒；会消耗订阅流量' );
  const direction = running ? (Object.hasOwn(speedNames, test.phase) ? test.phase : null) : averageFor('download') != null ? 'download' : 'upload';
  const live = direction ? liveFor(direction) : null;
  const dialRate = direction ? live?.mbps ?? averageFor(direction) : null;
  const dialLabel = dialRate != null ? `${speedNames[direction]}${live ? '实时速率' : '均速'}` : current ? phases[test.phase] || '待测速' : unavailable || '待测速';
  return <section className="instrument-card node-speed-test" aria-label="当前节点测试">
    <div className="instrument-heading">
      <h2><Gauge size={17} aria-hidden="true"/>节点测速</h2>
      <button className="button node-test-start" aria-label={running ? '停止当前节点速度测试' : '开始当前节点速度测试'} disabled={busy || (!running && (!!unavailable || data.testProgress?.running))} title={title} onClick={() => running ? onAction('cancelSpeedTest') : onAction('speedTest', { nodeId: node.id, confirmed: true })}>{running ? '停止' : '开始测速'}</button>
    </div>
    <SpeedDial rate={dialRate} label={dialLabel} direction={dialRate == null ? null : direction}/>
    <div className="node-test-values"><div><span><Gauge size={14} aria-hidden="true"/>延迟</span><strong title={delay?.reason}>{delay?.status === 'testing' || (running && current && test.phase === 'latency') ? '测试中' : validDelay ? `${Math.round(delay.delayMs)} ms` : delay?.status === 'failed' ? failureLabel(delay) : '未测'}</strong></div><div><span><ArrowDown size={14} aria-hidden="true"/>下载</span><strong title={hint('download')}>{speed('download')}</strong></div><div><span><ArrowUp size={14} aria-hidden="true"/>上传</span><strong title={hint('upload')}>{speed('upload')}</strong></div></div>
    {current && test.error && <span className="node-test-error" role="status">{test.error}</span>}
  </section>;
}
