const { randomUUID } = require('node:crypto');
function setProgramRule(state, payload) {
  const process = payload?.process;
  if (typeof process !== 'string' || process.length > 260 || !/^[^\\/:*?"<>|\x00-\x1f]+\.exe$/i.test(process)) throw new Error('程序名称无效');
  if (!['default', 'proxy', 'direct', 'reject'].includes(payload.action)) throw new Error('无效规则');
  const matching = state.rules.filter(rule => rule.process.toLowerCase() === process.toLowerCase());
  const first = matching[0];
  const next = payload.action === 'default' ? null : { id: first?.id || randomUUID(), process: first?.process || process, action: payload.action, enabled: true };
  let inserted = false;
  const rules = state.rules.flatMap(rule => {
    if (rule.process.toLowerCase() !== process.toLowerCase()) return [rule];
    if (inserted || !next) return [];
    inserted = true; return [next];
  });
  if (next && !inserted) rules.push(next);
  return { ...state, rules };
}
module.exports = { setProgramRule };
