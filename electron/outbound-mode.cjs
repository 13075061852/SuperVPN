const modes = { rule: 'Rule', global: 'Global', direct: 'Direct' };
async function applyCoreMode(mode, { port, secret, request = fetch }) {
  if (!Object.hasOwn(modes, mode)) throw new Error('无效的出站模式');
  const url = `http://127.0.0.1:${port}/configs`;
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  const response = await request(url, { method: 'PATCH', headers, body: JSON.stringify({ mode: modes[mode] }), signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error('出站模式切换失败');
  // sing-box may return 204 while silently ignoring an unavailable mode.
  const verified = await request(url, { headers, signal: AbortSignal.timeout(2000) });
  if (!verified.ok || (await verified.json()).mode?.toLowerCase() !== mode) throw new Error('内核未确认新的出站模式');
}
async function changeLiveMode({ previous, next, apply, persist }) {
  try { await apply(next); await persist(next); }
  catch (error) {
    try { await apply(previous); }
    catch { throw new Error('模式切换失败且无法确认回退，请断开后重新连接'); }
    throw error;
  }
}
module.exports = { applyCoreMode, changeLiveMode };
