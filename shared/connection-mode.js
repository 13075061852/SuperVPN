// The desktop product now exposes system proxy only. Migrate legacy saved TUN
// mode without changing credentials, routes, terminal backups or preferences.
export function systemProxyState(state) {
  return state.mode === 'system' ? state : { ...state, mode: 'system' };
}
export function validateSystemMode(mode) {
  if (mode !== 'system') throw new Error('当前版本仅支持系统代理');
  return mode;
}
