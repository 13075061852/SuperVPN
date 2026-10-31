import React, { useState } from 'react';
import { Shield } from 'lucide-react';
export default function SecurityOptions({ subscription, connected, pending, error, onApply, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);
  const enabling = !subscription.allowInsecure;
  return <form className="security-options" onSubmit={e => { e.preventDefault(); onApply(enabling, confirmed); }}><div className="security-scope"><Shield size={18}/><span>{subscription.name}</span></div><p>{enabling ? '这条订阅的部分节点要求允许自签名证书。兼容模式仅对本订阅明确标记 insecure=1 的节点生效。' : '恢复严格校验后，此订阅中的自签名或不受信任证书将再次被拒绝。'}</p>{enabling && <><div className="security-risk">流量仍加密，但不再验证代理服务器身份，可能遭受中间人攻击。其他订阅和测试网站的 HTTPS 证书验证不受影响。</div><label className="security-consent"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>我了解风险，仅对此订阅按原参数连接</span></label></>}{connected && <div className="form-error">请先在仪表盘断开当前代理，再修改此策略。</div>}{error && <div role="alert" className="form-error">{error}</div>}<div className="dialog-actions"><button type="button" className="button quiet" disabled={pending} onClick={onCancel}>取消</button><button className="button primary" disabled={pending || connected || (enabling && !confirmed)}>{pending ? '应用中…' : enabling ? '应用并重新测速' : '恢复校验并测速'}</button></div></form>;
}
