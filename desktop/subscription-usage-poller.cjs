// Background metadata only. Fetches do not hold the application's IPC busy lock.
function createSubscriptionUsagePoller({ list, fetchUsage, applyUsage, isBusy = () => false, intervalMs = 60 * 1000 }) {
  let timer, running, disposed = false;
  function tick() {
    if (disposed || isBusy()) return Promise.resolve();
    if (running) return running;
    running = Promise.resolve().then(async () => {
      for (const subscription of [...list()]) {
        if (disposed || isBusy()) break;
        try {
          const result = await fetchUsage(subscription);
          if (!disposed) await applyUsage(subscription, result);
        } catch { /* Keep the last real provider data; retry next cycle. */ }
      }
    }).finally(() => { running = null; });
    return running;
  }
  function start() {
    if (disposed || timer) return;
    timer = setInterval(() => { void tick().catch(() => {}); }, intervalMs);
    timer.unref?.();
  }
  function dispose() { disposed = true; clearInterval(timer); }
  return { start, tick, dispose };
}
module.exports = { createSubscriptionUsagePoller };
