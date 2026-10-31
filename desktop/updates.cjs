// Public release metadata and SHA-512 validation are handled by electron-updater.
// Never accept a feed URL, token, installer path, or release HTML from IPC.
function createUpdateService({ updater, enabled, currentVersion, onUpdate = () => {}, prepareInstall = async () => {}, validateInstaller = async () => {}, beginInstall, initialDelayMs = 15000, intervalMs = 4 * 60 * 60 * 1000 }) {
  let state = { supported: !!enabled, currentVersion, phase: enabled ? 'idle' : 'development', version: null, percent: 0, transferred: 0, total: 0, error: null };
  let checking, installing, downloadedInfo, initialTimer, intervalTimer, disposed = false, lastProgress = 0;
  const listeners = [];
  const view = () => ({ ...state });
  const patch = value => { if (!disposed) { state = { ...state, ...value }; onUpdate(view()); } };
  const version = info => typeof info?.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(info.version) && info.version.length <= 80 ? info.version : null;
  const safeError = error => /CHECKSUM|SHA512|DIGEST|SIGNATURE/i.test(error?.code || '') ? '更新校验失败，未启动安装，请重新检查更新' : '更新检查或下载失败，请检查网络及发布源';
  const listen = (event, fn) => { updater.on(event, fn); listeners.push([event, fn]); };
  if (enabled) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
    listen('checking-for-update', () => patch({ phase: 'checking', error: null }));
    listen('update-available', info => patch({ phase: 'downloading', version: version(info), percent: 0, transferred: 0, total: 0, error: null }));
    listen('update-not-available', () => patch({ phase: 'current', error: null }));
    listen('download-progress', info => {
      if (state.phase === 'ready' || state.phase === 'installing') return;
      const now = Date.now(); if (now - lastProgress < 200 && info.percent < 100) return; lastProgress = now;
      patch({ phase: 'downloading', percent: Number.isFinite(info.percent) ? Math.max(0, Math.min(100, info.percent)) : 0,
        transferred: Number.isSafeInteger(info.transferred) && info.transferred >= 0 ? info.transferred : 0,
        total: Number.isSafeInteger(info.total) && info.total >= 0 ? info.total : 0 });
    });
    listen('update-downloaded', info => { downloadedInfo = info; patch({ phase: 'ready', version: version(info), percent: 100, error: null }); });
    listen('error', error => patch({ phase: 'error', error: safeError(error) }));
  }
  function check() {
    if (!enabled || disposed) return Promise.resolve(view());
    if (checking) return checking;
    if (['downloading', 'ready', 'installing'].includes(state.phase)) return Promise.resolve(view());
    patch({ phase: 'checking', error: null });
    checking = Promise.resolve().then(() => updater.checkForUpdates()).catch(error => { patch({ phase: 'error', error: safeError(error) }); }).finally(() => { checking = null; });
    return checking;
  }
  function install(confirmed) {
    if (confirmed !== true) return Promise.reject(new Error('请点击安装更新，确认退出软件并启动安装向导'));
    if (installing) return installing;
    if (!enabled || disposed || state.phase !== 'ready') return Promise.reject(new Error('更新尚未下载完成'));
    patch({ phase: 'installing', error: null });
    let stage = 'verify';
    installing = Promise.resolve().then(() => validateInstaller(downloadedInfo)).then(() => { stage = 'prepare'; return prepareInstall(); }).then(() => {
      // Interactive NSIS, never /S. A normal application quit never installs.
      if (beginInstall) beginInstall(); else updater.quitAndInstall(false, true);
    }).catch(() => {
      const error = stage === 'verify' ? '更新文件不存在或校验失败，请重新检查下载' : '无法安全退出或启动安装，未自动安装；请重试';
      patch({ phase: stage === 'verify' ? 'error' : 'ready', error });
      throw new Error(error);
    }).finally(() => { installing = null; });
    return installing;
  }
  function start() {
    if (!enabled || disposed || initialTimer || intervalTimer) return;
    initialTimer = setTimeout(() => { initialTimer = null; void check(); }, initialDelayMs); initialTimer.unref?.();
    intervalTimer = setInterval(() => { void check(); }, intervalMs); intervalTimer.unref?.();
  }
  function dispose() {
    disposed = true; clearTimeout(initialTimer); clearInterval(intervalTimer);
    for (const [event, listener] of listeners) updater.removeListener(event, listener);
  }
  return { view, check, install, start, dispose };
}
module.exports = { createUpdateService };
