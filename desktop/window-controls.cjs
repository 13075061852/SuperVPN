function windowState(window) {
  return { alwaysOnTop: !!(window && !window.isDestroyed() && window.isAlwaysOnTop()) };
}
function setAlwaysOnTop(window, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('置顶设置无效');
  if (!window || window.isDestroyed()) throw new Error('窗口已关闭');
  window.setAlwaysOnTop(enabled);
  const state = windowState(window);
  if (state.alwaysOnTop !== enabled) throw new Error('窗口未确认置顶状态，请重试');
  return state;
}
module.exports = { windowState, setAlwaysOnTop };
