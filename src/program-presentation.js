export function programView({ programs = [], rules = [], query = '', filter = 'all' } = {}) {
  const byProcess = new Map();
  for (const rule of rules) {
    const key = rule.process.toLowerCase();
    if (!byProcess.has(key)) byProcess.set(key, []);
    byProcess.get(key).push(rule);
  }
  const apps = new Map(programs.map(app => [app.process.toLowerCase(), app]));
  for (const rule of rules) {
    const key = rule.process.toLowerCase();
    if (!apps.has(key)) apps.set(key, { id: rule.id, process: rule.process, name: rule.process, paths: [], running: false });
  }
  const all = [...apps.values()].map(app => {
    const matches = byProcess.get(app.process.toLowerCase()) || [];
    return { ...app, paths: app.paths || [], rules: matches, rule: matches.find(rule => rule.enabled), configured: matches.length > 0 };
  }).sort((a, b) => Number(!!b.running) - Number(!!a.running) || a.name.localeCompare(b.name, 'zh-CN') || a.process.localeCompare(b.process));
  const counts = { all: all.length, running: all.filter(app => app.running).length, configured: all.filter(app => app.configured).length };
  const needle = query.trim().toLowerCase();
  const rows = all.filter(app => (filter !== 'running' || app.running) && (filter !== 'configured' || app.configured) && (!needle || `${app.name} ${app.process}`.toLowerCase().includes(needle)));
  return { rows, counts };
}
