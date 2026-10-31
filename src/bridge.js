import { defaultState, parseLink } from '../shared/proxy.js';
import { isSubscriptionUrl } from '../shared/subscription.js';
import { editNode } from '../shared/source-edits.js';
import { validateSystemMode } from '../shared/connection-mode.js';
let preview = { ...defaultState(), session: { connected: false, startedAt: null, upload: 0, download: 0, upSpeed: 0, downSpeed: 0, connections: 0 }, logs: [], environment: { desktop: false, admin: false, coreReady: false, version: '0.6.1' }, busy: false };
// Browser preview is intentionally ephemeral: no credentials in localStorage.
export const bridge = globalThis.window?.supervpn || {
  onUpdate: () => () => {},
  async call(method, p) {
    if (['checkForUpdates', 'installUpdate'].includes(method)) throw new Error('自动更新仅在安装版可用');
    if (method === 'terminalProxy') throw new Error('终端环境变量仅在 Windows 桌面客户端中可设置');
    if (method === 'connect') throw new Error('当前是界面预览，不能接管网络。请运行 Windows 桌面客户端进行连接');
    if (method === 'disconnect') return structuredClone(preview);
    if (method === 'import') {
      const content = typeof p === 'string' ? p : p.content;
      if (p?.kind === 'subscription' || isSubscriptionUrl(content)) throw new Error('请在 Windows 桌面客户端中导入订阅，预览不请求订阅服务器');
      const lines = content.split(/\r?\n/).filter(s => s.trim());
      if (!lines.length || lines.length > 100) throw new Error('每次可导入 1–100 条链接');
      const parsed = lines.map(parseLink);
      preview.nodes.push(...parsed); preview.selectedNodeId ||= parsed[0].id;
      preview.importReport = { imported: parsed.length, total: parsed.length, skipped: 0, failures: {}, secureOverrides: parsed.filter(n => n.insecureRequested).length };
    }
    if (method === 'editNode') preview = editNode(preview, p).state;
    if (method === 'editSubscription' || method === 'refreshSubscriptionUsage') throw new Error('订阅编辑与流量更新仅在 Windows 桌面客户端中可用');
    if (method === 'selectNode') preview.selectedNodeId = p;
    if (method === 'deleteNode') { preview.nodes = preview.nodes.filter(n => n.id !== p); if (preview.selectedNodeId === p) preview.selectedNodeId = preview.nodes[0]?.id || null; }
    if (method === 'testNodes') throw new Error('真实延迟测试仅在桌面客户端中可用');
    if (method === 'subscriptionSecurity') throw new Error('证书策略仅在 Windows 桌面客户端中可用');
    if (method === 'mode') preview.mode = validateSystemMode(p);
    if (method === 'settings') {
      if (p.autoStart) throw new Error('开机自启仅在安装后的 Windows 客户端中可用');
      if (p.mixedPort !== undefined && (!Number.isInteger(p.mixedPort) || p.mixedPort < 1024 || p.mixedPort > 65535 || p.mixedPort === 19090)) throw new Error('请输入有效端口，不能使用控制端口 19090');
      preview.settings = { ...preview.settings, ...p };
    }
    if (method === 'addRule') {
      if (!/^[^\\/:*?"<>|\r\n]+\.exe$/i.test(p.process)) throw new Error('请输入有效的 .exe 程序名');
      preview.rules.push({ ...p, id: crypto.randomUUID(), enabled: true });
    }
    if (method === 'toggleRule') preview.rules = preview.rules.map(r => r.id === p ? { ...r, enabled: !r.enabled } : r);
    if (method === 'deleteRule') preview.rules = preview.rules.filter(r => r.id !== p);
    if (method === 'pickProcess') throw new Error('文件选择器仅在桌面客户端中可用，也可以手动输入程序名');
    if (method === 'clearLogs') preview.logs = [];
    return structuredClone({ ...preview, nodes: preview.nodes.map(({ outbound, ...node }) => node) });
  }
};
