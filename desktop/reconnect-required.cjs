const { createHash } = require('node:crypto');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fingerprint(config) {
  // Only a digest remains in memory; never expose configuration or credentials.
  // Exclude per-start controller secrets, logs and an outbound mode applied live.
  const { log, experimental, ...network } = config;
  const { secret, default_mode, ...controller } = experimental?.clash_api || {};
  return createHash('sha256').update(JSON.stringify(canonical({ ...network, experimental: { ...experimental, clash_api: controller } }))).digest('hex');
}
function createReconnectTracker({ createConfig }) {
  let running = null;
  return {
    started(config) { running = fingerprint(config); },
    stopped() { running = null; },
    required(state, connected) {
      if (!connected || running === null) return false;
      try { return fingerprint(createConfig(state)) !== running; }
      // Removing the active subscription can leave no node for the next start.
      catch { return true; }
    }
  };
}
module.exports = { createReconnectTracker };
