import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let vite;
async function ready() {
  try { const response = await fetch('http://127.0.0.1:5188/__supervpn_dev', { signal: AbortSignal.timeout(500) }); return (await response.json()).project === 'SuperVPN'; } catch { return false; }
}
if (!(await ready())) {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' });
  for (let i = 0; i < 80 && !(await ready()); i++) {
    if (vite.exitCode !== null) throw new Error('开发服务器启动失败，请检查 5188 端口');
    await new Promise(r => setTimeout(r, 200));
  }
  if (!(await ready())) { vite.kill(); throw new Error('开发服务器启动超时'); }
}
console.log('SuperVPN Dev：独立开发配置；界面热更新，后台更新请手动退出后重开，勿中断承载网络的连接。');
const desktop = spawn(require('electron'), ['.'], { stdio: 'inherit' });
desktop.once('error', e => { console.error(e.message); vite?.kill(); process.exitCode = 1; });
// Keep an owned Vite alive across Electron's graceful main-process relaunch.
process.on('SIGINT', () => { desktop.kill(); vite?.kill(); process.exit(); });
