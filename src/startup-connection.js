export const AUTO_CONNECT_KEY = 'supervpn.autoConnect';
const HANDLED_KEY = 'supervpn.startupConnectionHandled';
export function readAutoConnect(storage) {
  try { const stored = storage.getItem(AUTO_CONNECT_KEY); return stored === null || stored === 'true'; }
  catch { return false; }
}
export function writeAutoConnect(storage, value) {
  if (typeof value !== 'boolean') throw new Error('启动设置无效');
  try { storage.setItem(AUTO_CONNECT_KEY, String(value)); }
  catch { throw new Error('无法保存自动连接设置，请检查本地存储权限'); }
}
// sessionStorage belongs to this BrowserWindow: HMR and page reloads retain
// this guard, while a fresh application window receives a fresh session.
export async function startupConnection({ data, enabled, storage, connect }) {
  if (!data.environment?.desktop) return { skipped: 'preview' };
  try {
    if (storage.getItem(HANDLED_KEY)) return { skipped: 'handled' };
    storage.setItem(HANDLED_KEY, 'true');
  } catch { return { skipped: 'storage-unavailable' }; }
  if (!enabled) return { skipped: 'disabled' };
  if (data.session?.connected) return { skipped: 'connected' };
  if (data.busy) return { skipped: 'busy' };
  if (!data.nodes?.length) return { skipped: 'no-nodes' };
  if (!data.nodes.some(node => node.id === data.selectedNodeId)) throw new Error('未自动连接：请先选择节点');
  if (!data.environment.coreReady) throw new Error('未自动连接：代理内核未就绪');
  if (data.mode === 'tun' && !data.environment.admin) throw new Error('未自动连接：TUN 模式需要管理员权限');
  // One attempt only. Never reconnect after a user's manual disconnect.
  await connect();
  return { attempted: true };
}
