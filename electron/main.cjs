const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, safeStorage, screen, session: electronSession } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const win = require('./windows.cjs');
const { fetchSubscription } = require('../desktop/subscription-fetch.cjs');
const { testLatency, getTestConcurrency } = require('./latency.cjs');
const { inspectNetwork } = require('./network-info.cjs');
const { applyCoreMode, changeLiveMode } = require('./outbound-mode.cjs');
const { toggleTerminalProxy, terminalProxyView } = require('./terminal-proxy.cjs');
const { windowLayout } = require('./window-layout.cjs');
const { windowState, setAlwaysOnTop } = require('../desktop/window-controls.cjs');
const { scanPrograms } = require('../desktop/programs.cjs');
const { setProgramRule } = require('../desktop/program-rules.cjs');
const { runSpeedTest } = require('../desktop/speed-test.cjs');
const { createUpdateService } = require('../desktop/updates.cjs');
const { validateDownloadedInstaller } = require('../desktop/update-integrity.cjs');
let networkQueue = Promise.resolve(), updateService;
// A source build must not silently hand its window to an older installed EXE.
if (!app.isPackaged) {
  app.setName('SuperVPN Dev');
  const profile = path.join(app.getPath('appData'), 'SuperVPN Development');
  require('node:fs').mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}
const exec = promisify(execFile);
let window, tray, state, api, child, runtimeFile, quitting = false, busy = false, admin = false;
let session = { connected: false, startedAt: null, upload: 0, download: 0, upSpeed: 0, downSpeed: 0, connections: 0 }, logs = [];
let secret = '', previousTotals = null, subscriptionApi, nodeManager, sourceEdits, connectionMode, websiteRules, importReport = null;
let speedTest = { running: false }, speedAbort, speedPromise;
let testProgress = { running: false, total: 0, completed: 0, concurrency: 0 }, testAbort, testPromise, testUpdateTimer;
const controllerPort = 19090;
const dataPath = (name) => path.join(app.getPath('userData'), name);
const corePath = () => path.join(app.isPackaged ? process.resourcesPath : app.getAppPath() + '/resources', 'core', 'sing-box.exe');
const errorText = e => e.message || String(e);
function log(message, level = 'info') { logs = [...logs.slice(-199), { time: new Date().toISOString(), level, message }]; broadcast(); }
function view() { const { terminalProxyBackup, ...publicState } = state; return { ...publicState, windowState: windowState(window), terminalProxy: terminalProxyView(terminalProxyBackup, state.settings.mixedPort), subscriptions: (state.subscriptions || []).map(({ url, ...sub }) => ({ ...sub, allowInsecure: sub.certificatePolicy !== 'strict' && (sub.allowInsecure === true || state.settings.honorImportedInsecure !== false), legacyNodeIds: nodeManager.legacyCandidateIds(state, { url }) })), importReport, testProgress, speedTest, updateInfo: updateService?.view() || { supported: false, phase: 'development', currentVersion: app.getVersion() }, nodes: state.nodes.map(({ outbound, ...n }) => ({ ...n, tlsInsecureAllowed: api.tlsCompatibilityAllowed(state, n) })), session, logs, environment: { desktop: true, programDiscovery: true, speedTesting: true, websiteRouting: true, admin, coreReady: !!global.coreReady, version: app.getVersion(), packaged: app.isPackaged, development: !app.isPackaged }, busy }; }
function broadcast() { if (window && !window.isDestroyed()) window.webContents.send('update', view()); }
function broadcastTests() {
  if (testUpdateTimer) return;
  testUpdateTimer = setTimeout(() => { testUpdateTimer = null; broadcast(); }, 16);
}
async function save() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密不可用，无法安全保存节点');
  const file = dataPath('state.bin');
  await fs.writeFile(file + '.tmp', safeStorage.encryptString(JSON.stringify(state)));
  await fs.rename(file + '.tmp', file);
}
async function recoverProxy() {
  let backup;
  try { backup = JSON.parse(await fs.readFile(dataPath('proxy-recovery.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  const current = await win.readProxy();
  if (current.ProxyServer === backup.owned && current.ProxyEnable === 1) await win.setProxy(backup.values);
  await fs.unlink(dataPath('proxy-recovery.json'));
}
async function applyProxy() {
  const values = await win.readProxy();
  const owned = `127.0.0.1:${state.settings.mixedPort}`;
  await fs.writeFile(dataPath('proxy-recovery.json'), JSON.stringify({ values, owned }));
  await win.setProxy({ ProxyEnable: 1, ProxyServer: owned, ProxyOverride: state.settings.bypassLan ? '<local>;localhost;127.*;10.*;192.168.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2?.*;172.30.*;172.31.*' : 'localhost;127.*', AutoConfigURL: null });
}
async function removeRuntime() { if (runtimeFile) { await fs.rm(runtimeFile, { force: true }); runtimeFile = null; } }
async function stop() {
  session = { ...session, connected: false, startedAt: null, upSpeed: 0, downSpeed: 0, connections: 0 };
  const old = child; child = null;
  if (old) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { old.kill(); resolve(); }, 4000);
      old.once('exit', () => { clearTimeout(timer); resolve(); });
      old.kill();
    });
  }
  await recoverProxy();
  await removeRuntime();
  previousTotals = null;
  broadcast();
}
async function portAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`端口 ${port} 已被占用，请修改端口或关闭占用程序`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function controller(endpoint) {
  const res = await fetch(`http://127.0.0.1:${controllerPort}${endpoint}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1000) });
  if (!res.ok) throw new Error('内核控制接口尚未就绪');
  return res.json();
}
async function start() {
  if (session.connected) return;
  if (!global.coreReady) throw new Error('未找到 sing-box 内核。请先运行 npm run core:download，再重新启动客户端');
  if (state.mode !== 'system') { state = connectionMode.systemProxyState(state); await save(); }
  await portAvailable(controllerPort);
  if (state.mode === 'system') await portAvailable(state.settings.mixedPort);
  secret = randomBytes(32).toString('hex');
  const config = api.createConfig(state, { controllerSecret: secret, controllerPort });
  runtimeFile = dataPath(`runtime-${process.pid}.json`);
  await fs.writeFile(runtimeFile, JSON.stringify(config), { mode: 0o600 });
  try {
    await exec(corePath(), ['check', '-c', runtimeFile], { windowsHide: true, timeout: 15000 });
    const proc = spawn(corePath(), ['run', '-c', runtimeFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let failure;
    proc.on('error', e => { failure = e; });
    let remainder = '';
    const onData = data => {
      remainder += data.toString().replace(/\x1b\[[0-9;]*m/g, '');
      const lines = remainder.split(/\r?\n/); remainder = lines.pop();
      for (const line of lines.filter(Boolean)) log(line.slice(0, 1200), /error|fatal/i.test(line) ? 'error' : 'info');
    };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.once('exit', (code) => {
      if (child !== proc) return;
      child = null; session.connected = false;
      log(`内核已退出（${code}），正在恢复系统代理`, code ? 'error' : 'info');
      recoverProxy().then(removeRuntime).catch(e => log(`恢复失败：${errorText(e)}`, 'error')).finally(broadcast);
    });
    let ready = false;
    for (let i = 0; i < 35; i++) {
      if (failure) throw failure;
      if (proc.exitCode !== null) throw new Error('内核启动失败，请查看日志');
      try { await controller('/version'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 200)); }
    }
    if (!ready) throw new Error('内核启动超时，请查看日志');
    if (child !== proc) throw new Error('内核已停止');
    if (state.mode === 'system') await applyProxy();
    const activeNode = state.nodes.find(n => n.id === state.selectedNodeId);
    session = { connected: true, nodeId: activeNode.id, subscriptionId: activeNode.subscriptionId || null, startedAt: Date.now(), upload: 0, download: 0, upSpeed: 0, downSpeed: 0, connections: 0 };
    log('本地代理服务已启动。远端可用性取决于节点，请用实际网络请求验证');
  } catch (e) { await stop(); throw e; }
}
async function importSubscription(url, existingId, displayName) {
  nodeManager.assertSubscriptionWritable(state, session, existingId);
  const fetched = await fetchSubscription(url);
  const parsed = subscriptionApi.parseSubscription(fetched.body);
  // Recheck after the asynchronous download against the actual current session.
  nodeManager.assertSubscriptionWritable(state, session, existingId);
  const id = existingId || randomBytes(8).toString('hex');
  const previousSource = (state.subscriptions || []).find(s => s.id === id && s.url === url);
  const sub = { id, url, certificatePolicy: previousSource?.certificatePolicy, name: displayName || (state.subscriptions || []).find(s => s.id === id)?.name || new URL(url).hostname, updatedAt: Date.now(), count: parsed.nodes.length, skipped: parsed.skipped, usage: fetched.usage, usageUpdatedAt: Date.now(), allowInsecure: (state.subscriptions || []).some(s => s.id === id && s.url === url && s.allowInsecure === true) };
  const legacy = nodeManager.legacyCandidateIds(state, sub);
  const previous = state;
  const next = nodeManager.replaceSubscription(state, parsed, sub);
  // An old HTTPS-proxy placeholder may itself be the active manual node.
  if (!session.connected && legacy.includes(next.selectedNodeId)) next.selectedNodeId = next.nodes.find(n => n.subscriptionId === id)?.id || null;
  if (session.connected && next.selectedNodeId !== previous.selectedNodeId) throw new Error('此次导入会替换当前连接节点，请先断开连接');
  state = next;
  try { await save(); } catch (e) { state = previous; throw e; }
  importReport = { subscriptionId: id, imported: parsed.nodes.length, total: parsed.total, skipped: parsed.skipped, information: parsed.information?.length || 0, failures: parsed.failures, secureOverrides: parsed.secureOverrides };
  log(`订阅共 ${parsed.total} 个节点：${parsed.nodes.length} 个可选，${parsed.skipped} 个不兼容；证书策略：${sub.certificatePolicy !== 'strict' && (sub.allowInsecure || state.settings.honorImportedInsecure !== false) ? '按节点显式参数连接' : '严格校验'}`);
}
async function handle(method, payload) {
  if (method === 'checkForUpdates') {
    if (!updateService?.view().supported) throw new Error('自动更新仅在安装版可用');
    void updateService.check();
    return view();
  }
  if (method === 'get') return view();
  if (method === 'programs') return scanPrograms(payload?.refresh === true);
  if (method === 'cancelSpeedTest') {
    speedAbort?.abort();
    if (speedPromise) await speedPromise;
    return view();
  }
  if (method === 'alwaysOnTop') {
    try { setAlwaysOnTop(window, payload); } finally { broadcast(); }
    return view();
  }
  if (method === 'networkInfo') {
    networkQueue = networkQueue.catch(() => {}).then(() => inspectNetwork(electronSession, { connected: session.connected, mode: state.mode, port: state.settings.mixedPort }));
    return networkQueue;
  }
  if (busy) throw new Error('正在处理上一项操作，请稍候');
  busy = true; broadcast();
  try {
    if (method === 'installUpdate') {
      if (payload?.confirmed === true && updateService?.view().phase === 'ready') window?.hide();
      try { await updateService.install(payload?.confirmed === true); }
      catch (error) { window?.show(); throw error; }
    } else if (method === 'terminalProxy') {
      if (payload === true && state.mode !== 'system') throw new Error('终端代理需要系统代理模式的本地端口，请先切换接管模式');
      await toggleTerminalProxy({ enabled: payload, port: state.settings.mixedPort, backup: state.terminalProxyBackup,
        read: win.readUserProxyEnvironment, write: win.writeUserProxyEnvironment,
        persist: async backup => {
          const previous = state.terminalProxyBackup;
          if (backup) state.terminalProxyBackup = backup; else delete state.terminalProxyBackup;
          try { await save(); } catch (error) { if (previous) state.terminalProxyBackup = previous; else delete state.terminalProxyBackup; throw error; }
        }
      });
    }
    else if (method === 'connect') await start();
    else if (method === 'disconnect') { await stop(); log('已断开连接，系统代理已恢复'); }
    else if (method === 'import') {
      const content = typeof payload === 'string' ? payload : payload?.content;
      const displayName = typeof payload?.name === 'string' ? payload.name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 120) : '';
      if (typeof content !== 'string' || content.length > 262144) throw new Error('导入内容无效或过长');
      const lines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length || lines.length > 100) throw new Error('每次可导入 1–100 条链接');
      if (lines.length === 1 && (payload?.kind === 'subscription' || subscriptionApi.isSubscriptionUrl(lines[0]))) {
        const existing = (state.subscriptions || []).find(s => s.url === lines[0]);
        await importSubscription(lines[0], existing?.id, displayName);
      } else {
        const parsed = lines.map((line, i) => { try { return api.parseLink(line); } catch (e) { throw new Error(`第 ${i + 1} 行：${errorText(e)}`); } });
        state.nodes.push(...parsed);
        state.selectedNodeId ||= parsed[0].id;
        importReport = { imported: parsed.length, skipped: 0, failures: {}, secureOverrides: parsed.filter(n => n.insecureRequested).length };
        await save(); log(`已导入 ${parsed.length} 个节点`);
      }
    } else if (method === 'editNode') {
      if (testProgress.running) throw new Error('请先停止测速再编辑节点');
      const edited = sourceEdits.editNode(state, payload);
      if (session.connected && edited.connectionChanged) throw new Error('请先断开连接再修改连接参数');
      const previous = state;
      state = edited.state;
      try { await save(); } catch (e) { state = previous; throw e; }
    } else if (method === 'editSubscription') {
      const sub = (state.subscriptions || []).find(s => s.id === payload?.id);
      if (!sub) throw new Error('订阅不存在');
      const name = sourceEdits.editName(payload.name);
      if (payload.url !== undefined && (typeof payload.url !== 'string' || payload.url.length > 16384)) throw new Error('订阅地址无效或过长');
      const url = payload.url?.trim();
      if (url && url !== sub.url) {
        if (testProgress.running) throw new Error('请先停止测速再替换订阅地址');
        await importSubscription(url, sub.id, name);
      } else {
        const previous = state;
        state = sourceEdits.renameSubscription(state, sub.id, name);
        try { await save(); } catch (e) { state = previous; throw e; }
      }
    } else if (method === 'refreshSubscriptionUsage') {
      const sub = (state.subscriptions || []).find(s => s.id === payload);
      if (!sub) throw new Error('订阅不存在');
      const fetched = await fetchSubscription(sub.url);
      const parsed = subscriptionApi.parseSubscription(fetched.body);
      const previous = state;
      state = { ...state, subscriptions: state.subscriptions.map(s => s.id === sub.id ? { ...s, usage: fetched.usage, usageUpdatedAt: Date.now() } : s),
        informationNodes: [...(state.informationNodes || []).filter(n => n.subscriptionId !== sub.id), ...parsed.information.map(n => ({ ...n, subscriptionId: sub.id }))] };
      try { await save(); } catch (e) { state = previous; throw e; }
    } else if (method === 'refreshSubscription') {
      const sub = (state.subscriptions || []).find(s => s.id === payload);
      if (!sub) throw new Error('订阅不存在');
      await importSubscription(sub.url, sub.id);
    } else if (method === 'deleteSubscription') {
      if (session.connected) throw new Error('请先断开连接再移除订阅');
      if (!(state.subscriptions || []).some(s => s.id === payload)) throw new Error('订阅不存在');
      const previous = state;
      state = nodeManager.removeSubscription(state, payload);
      try { await save(); } catch (e) { state = previous; throw e; }
    } else if (method === 'removeLegacyNodes') {
      if (session.connected) throw new Error('请先断开连接再清理旧条目');
      const sub = (state.subscriptions || []).find(s => s.id === payload);
      if (!sub) throw new Error('订阅不存在');
      const ids = nodeManager.legacyCandidateIds(state, sub);
      state.nodes = state.nodes.filter(n => !ids.includes(n.id));
      if (ids.includes(state.selectedNodeId)) state.selectedNodeId = state.nodes.find(n => n.subscriptionId === sub.id)?.id || state.nodes[0]?.id || null;
      await save();
    } else if (method === 'subscriptionSecurity') {
      if (session.connected) throw new Error('请先断开当前代理，再修改证书策略');
      if (testProgress.running) { testAbort?.abort(); await testPromise; }
      const previous = state;
      state = nodeManager.setSubscriptionSecurity(state, payload);
      try { await save(); } catch (e) { state = previous; throw e; }
      log(payload.allowInsecure ? '用户已确认：仅按本订阅显式要求跳过代理证书验证；测试网站证书仍严格校验' : '此订阅已恢复严格代理证书校验', payload.allowInsecure ? 'warn' : 'info');
    } else if (method === 'speedTest') {
      if (speedTest.running || testProgress.running) throw new Error('已有测试正在运行，请先停止');
      if (payload?.confirmed !== true) throw new Error('请先确认带宽测试会消耗订阅流量');
      if (!global.coreReady) throw new Error('代理内核未就绪');
      const node = state.nodes.find(n => n.id === state.selectedNodeId && n.id === payload?.nodeId);
      if (!node) throw new Error('当前节点已改变，请重新开始测试');
      const snapshot = { ...node, outbound: api.effectiveOutbound(state, node) };
      const config = api.createConfig({ ...state, mode: 'system' });
      speedAbort = new AbortController();
      speedTest = { running: true, nodeId: node.id, nodeName: node.name, startedAt: Date.now(), phase: 'starting' };
      speedPromise = runSpeedTest({ node: snapshot, config, core: corePath(), runtimeFile: dataPath(`runtime-${process.pid}-speed.json`), signal: speedAbort.signal,
        onUpdate: patch => { speedTest = { ...speedTest, ...patch }; broadcast(); }
      }).catch(() => { speedTest = { ...speedTest, phase: 'error', error: '测速未能完成，请检查节点或稍后重试' }; }).finally(() => {
        speedTest = { ...speedTest, running: false, live: null, finishedAt: Date.now(), ...(speedAbort.signal.aborted ? { phase: 'cancelled' } : {}) }; broadcast();
      });
    } else if (method === 'testNodes') {
      if (speedTest.running) throw new Error('请先停止当前节点速度测试');
      if (testProgress.running) throw new Error('正在测试节点');
      if (!global.coreReady) throw new Error('请先安装 sing-box 内核');
      const ids = Array.isArray(payload) ? payload : [];
      if (ids.length > 2000) throw new Error('一次最多测试 2000 个节点');
      const nodes = state.nodes.filter(n => ids.includes(n.id)).map(n => ({ ...n, outbound: api.effectiveOutbound(state, n) }));
      if (!nodes.length) throw new Error('没有可测试的节点');
      const config = api.createConfig({ ...state, mode: 'system', selectedNodeId: nodes[0].id });
      testAbort = new AbortController();
      testProgress = { running: true, total: nodes.length, completed: 0, concurrency: getTestConcurrency(nodes.length) };
      state.nodeChecks ||= {};
      testPromise = testLatency({ nodes, config, core: corePath(), runtimeFile: dataPath(`runtime-${process.pid}-check.json`), signal: testAbort.signal,
        onStart: id => { if (state.nodes.some(n => n.id === id)) state.nodeChecks[id] = { status: 'testing' }; broadcastTests(); },
        onResult: (id, result) => { if (state.nodes.some(n => n.id === id)) state.nodeChecks[id] = result; testProgress.completed++; broadcastTests(); }
      }).catch(() => log('节点测试未能完成，请检查内核与网络', 'error')).finally(() => {
        state.nodeChecks = Object.fromEntries(Object.entries(state.nodeChecks || {}).filter(([, v]) => v.status !== 'testing'));
        clearTimeout(testUpdateTimer); testUpdateTimer = null;
        testProgress.running = false; broadcast();
      });
    } else if (method === 'cancelTests') {
      testAbort?.abort();
    } else if (method === 'dismissReport') {
      importReport = null;
    } else if (method === 'deleteNode') {
      if (session.connected) throw new Error('请先断开连接再删除节点');
      state.nodes = state.nodes.filter(n => n.id !== payload);
      if (state.selectedNodeId === payload) state.selectedNodeId = state.nodes[0]?.id || null;
      await save();
    } else if (method === 'selectNode') {
      if (!state.nodes.some(n => n.id === payload)) throw new Error('节点不存在');
      if (state.selectedNodeId !== payload) {
        const reconnect = session.connected;
        if (reconnect) await stop();
        state.selectedNodeId = payload; await save();
        if (reconnect) await start();
      }
    } else if (method === 'mode') {
      if (session.connected) throw new Error('请先断开连接再切换模式');
      state.mode = connectionMode.validateSystemMode(payload); await save();
    } else if (method === 'settings') {
      if (session.connected) {
        if (Object.keys(payload || {}).length !== 1 || !['rule', 'global', 'direct'].includes(payload?.outboundMode)) throw new Error('其他设置仍需断开连接后修改');
        const previous = state.settings.outboundMode || 'rule';
        await changeLiveMode({ previous, next: payload.outboundMode,
          apply: mode => applyCoreMode(mode, { port: controllerPort, secret }),
          persist: async mode => {
            const previousSettings = state.settings;
            state.settings = { ...state.settings, outboundMode: mode };
            try { await save(); } catch (error) { state.settings = previousSettings; throw error; }
          }
        });
        return { ...view(), busy: false };
      }
      const next = { ...state.settings };
      for (const key of ['bypassLan', 'autoStart', 'silentStart', 'closeToTray']) if (typeof payload?.[key] === 'boolean') next[key] = payload[key];
      if (payload?.mixedPort !== undefined) {
        if (state.terminalProxyBackup && payload.mixedPort !== state.settings.mixedPort) throw new Error('请先恢复终端代理，再修改本地端口');
        if (!Number.isInteger(payload.mixedPort) || payload.mixedPort < 1024 || payload.mixedPort > 65535 || payload.mixedPort === controllerPort) throw new Error('端口须为 1024–65535，且不能为 19090');
        next.mixedPort = payload.mixedPort;
      }
      if (['proxy', 'direct'].includes(payload?.defaultAction)) next.defaultAction = payload.defaultAction;
      if (['rule', 'global', 'direct'].includes(payload?.outboundMode)) next.outboundMode = payload.outboundMode;
      if (next.autoStart && !app.isPackaged) throw new Error('开机自启需在安装后的客户端中设置');
      app.setLoginItemSettings({ openAtLogin: next.autoStart, args: ['--autostart'] });
      state.settings = next; await save();
    } else if (method === 'setWebsiteRule' || method === 'deleteWebsiteRule') {
      if (session.connected) throw new Error('请先断开连接再修改网站规则，下次连接生效');
      const previous = state;
      state = method === 'setWebsiteRule' ? websiteRules.setWebsiteRule(state, payload) : websiteRules.removeWebsiteRule(state, payload);
      try { await save(); } catch (error) { state = previous; throw error; }
    } else if (method === 'setProgramRule') {
      if (session.connected) throw new Error('请先断开连接再修改分流规则');
      const previous = state;
      state = setProgramRule(state, payload);
      try { await save(); } catch (e) { state = previous; throw e; }
    } else if (method === 'addRule') {
      if (session.connected) throw new Error('请先断开连接再修改分流规则');
      if (!/^[^\\/:*?"<>|\r\n]+\.exe$/i.test(payload?.process || '')) throw new Error('请输入有效的程序名，例如 chrome.exe');
      if (!['proxy', 'direct', 'reject'].includes(payload.action)) throw new Error('无效动作');
      state.rules.push({ id: randomBytes(8).toString('hex'), process: payload.process, action: payload.action, enabled: true }); await save();
    } else if (method === 'toggleRule' || method === 'deleteRule') {
      if (session.connected) throw new Error('请先断开连接再修改分流规则');
      if (method === 'toggleRule') state.rules = state.rules.map(r => r.id === payload ? { ...r, enabled: !r.enabled } : r);
      else state.rules = state.rules.filter(r => r.id !== payload);
      await save();
    } else if (method === 'pickProcess') {
      const result = await dialog.showOpenDialog(window, { title: '选择要分流的程序', filters: [{ name: 'Windows 程序', extensions: ['exe'] }], properties: ['openFile'] });
      return result.canceled ? null : path.basename(result.filePaths[0]);
    } else if (method === 'clearLogs') logs = [];
    else if (method === 'minimize') window.minimize();
    else if (method === 'close') window.close();
    else throw new Error('不支持的操作');
    return { ...view(), busy: false };
  } finally { busy = false; broadcast(); }
}
function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  window = new BrowserWindow({ ...windowLayout(display.workArea), title: 'SuperVPN', icon: path.join(__dirname, 'app.ico'), backgroundColor: '#f7f6fc', frame: false, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  if (app.isPackaged) window.loadFile(path.join(__dirname, '../dist/index.html'));
  else window.loadURL('http://127.0.0.1:5188');
  window.once('ready-to-show', () => { if (!(process.argv.includes('--autostart') && state.settings.silentStart)) window.show(); });
  window.on('close', e => { if (!quitting && state.settings.closeToTray) { e.preventDefault(); window.hide(); } else if (!quitting) { e.preventDefault(); app.quit(); } });
  tray = new Tray(path.join(__dirname, 'tray.ico'));
  tray.setToolTip('SuperVPN');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 SuperVPN', click: () => { window.show(); window.focus(); } }, { label: '断开连接', click: () => handle('disconnect').catch(e => log(errorText(e), 'error')) }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
  tray.on('double-click', () => window.show());
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.show(); window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    if (process.platform !== 'win32') throw new Error('当前版本仅支持 Windows');
    api = await import(pathToFileURL(path.join(__dirname, '../shared/proxy.js')).href);
    subscriptionApi = await import(pathToFileURL(path.join(__dirname, '../shared/subscription.js')).href);
    nodeManager = await import(pathToFileURL(path.join(__dirname, '../shared/node-manager.js')).href);
    sourceEdits = await import(pathToFileURL(path.join(__dirname, '../shared/source-edits.js')).href);
    websiteRules = await import(pathToFileURL(path.join(__dirname, '../shared/website-rules.js')).href);
    state = api.defaultState();
    try { state = { ...state, ...JSON.parse(safeStorage.decryptString(await fs.readFile(dataPath('state.bin')))) }; }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('本地配置无法解密或读取。为避免丢失节点，客户端未覆盖原文件'); }
    state = nodeManager.normalizeNodeState(state);
    connectionMode = await import(pathToFileURL(path.join(__dirname, '../shared/connection-mode.js')).href);
    if (state.mode !== 'system') { state = connectionMode.systemProxyState(state); await save(); }
    if (state.settings.honorImportedInsecure === undefined) {
      state.settings = { ...state.settings, honorImportedInsecure: true };
      const changed = new Set(state.nodes.filter(n => n.insecureRequested && !state.subscriptions.some(s => s.id === n.subscriptionId && (s.allowInsecure || s.certificatePolicy === 'strict'))).map(n => n.id));
      state.nodeChecks = Object.fromEntries(Object.entries(state.nodeChecks || {}).filter(([id]) => !changed.has(id)));
      await save();
    }
    // Legacy successful delays included cold handshakes; do not present them
    // as the new unified metric after upgrading. Keep current/failure results.
    state.nodeChecks = Object.fromEntries(Object.entries(state.nodeChecks || {}).filter(([, check]) => check.status !== 'ok' || ['warm', 'cold'].includes(check.measurement)));
    await recoverProxy();
    // Runtime configuration contains credentials; delete only our stale runtime files.
    for (const file of await fs.readdir(app.getPath('userData'))) if (/^runtime-\d+(?:-check(?:-[0-3])?|-speed)?\.json$/.test(file)) await fs.rm(dataPath(file), { force: true });
    admin = await win.isAdmin();
    global.coreReady = await fs.access(corePath()).then(() => true, () => false);
    ipcMain.handle('client', async (event, method, payload) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('非法请求来源');
      return handle(method, payload);
    });
    const nativeUpdater = app.isPackaged ? require('electron-updater').autoUpdater : null;
    updateService = createUpdateService({ updater: nativeUpdater, enabled: app.isPackaged, currentVersion: app.getVersion(),
      onUpdate: info => { if (tray && !tray.isDestroyed()) tray.setToolTip(info.phase === 'ready' ? 'SuperVPN · 更新已下载' : 'SuperVPN'); broadcast(); },
      validateInstaller: validateDownloadedInstaller,
      prepareInstall: async () => {
        testAbort?.abort(); speedAbort?.abort();
        await Promise.all([testPromise, speedPromise]);
        await stop(); await save();
      },
      beginInstall: () => {
        quitting = true;
        window?.hide();
        nativeUpdater.quitAndInstall(false, true);
      }
    });
    createWindow();
    updateService.start();
    // Backend changes take effect only after a manual exit and launch.
    // Never restart a client that may be carrying the development network.
    log(global.coreReady ? '客户端就绪，等待连接' : '尚未安装内核，请运行 npm run core:download', global.coreReady ? 'info' : 'warn');
    let polling = false;
    setInterval(async () => {
      if (!session.connected || polling) return;
      polling = true;
      try {
        const stats = await controller('/connections');
        if (!session.connected) return;
        const now = Date.now(), elapsed = previousTotals ? (now - previousTotals.time) / 1000 : 1;
        session = { ...session, upload: stats.uploadTotal || 0, download: stats.downloadTotal || 0, connections: stats.connections?.length || 0, upSpeed: previousTotals ? Math.max(0, (stats.uploadTotal - previousTotals.up) / elapsed) : 0, downSpeed: previousTotals ? Math.max(0, (stats.downloadTotal - previousTotals.down) / elapsed) : 0 };
        previousTotals = { time: now, up: stats.uploadTotal || 0, down: stats.downloadTotal || 0 }; broadcast();
      } catch { /* Keep last actual totals; never fabricate traffic. */ }
      finally { polling = false; }
    }, 1500).unref();
  }).catch(e => { dialog.showErrorBox('SuperVPN 启动失败', errorText(e)); app.exit(1); });
  app.on('before-quit', e => {
    if (quitting) return;
    e.preventDefault(); quitting = true;
    testAbort?.abort(); speedAbort?.abort();
    Promise.all([stop(), testPromise, speedPromise]).then(() => { updateService?.dispose(); tray?.destroy(); app.exit(0); }).catch(err => { dialog.showErrorBox('系统代理恢复失败', '请在 Windows 设置中关闭手动代理。恢复记录已保留，下次启动会重试。\n' + errorText(err)); app.exit(1); });
  });
}
