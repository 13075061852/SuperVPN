// Presentation-only source identities. Never group links by name, host or outbound.
// In particular, manual links must not become subscriptions (or inherit their TLS policy).
export const nodeSourceGroup = id => `node:${id}`;
export function sourceGroups(data) {
  const subscriptions = (data.subscriptions || []).map(s => ({ id: s.id, name: s.name, kind: 'subscription', identifier: s.id.slice(0, 8) }));
  const links = (data.nodes || []).filter(n => !n.subscriptionId).map(n => ({ id: nodeSourceGroup(n.id), nodeId: n.id, name: n.name, protocol: n.protocol, kind: 'node', identifier: n.id.slice(0, 8) }));
  const groups = [...subscriptions, ...links], prefixes = new Map();
  for (const source of groups) prefixes.set(source.identifier, (prefixes.get(source.identifier) || 0) + 1);
  // Rare short-ID collisions must not make two sources look identical either.
  return groups.map(source => prefixes.get(source.identifier) > 1 ? { ...source, identifier: source.id } : source);
}
export function selectedSource(data, requested) {
  const sources = sourceGroups(data);
  if (requested === 'manual' && data.nodes.some(n => !n.subscriptionId)) return 'manual';
  if (sources.some(source => source.id === requested)) return requested;
  const selected = data.nodes.find(node => node.id === data.selectedNodeId);
  if (selected) {
    const id = selected.subscriptionId || nodeSourceGroup(selected.id);
    if (sources.some(source => source.id === id)) return id;
  }
  return sources[0]?.id || 'manual';
}
export function sourceScope(data, group) {
  if (!group.startsWith('node:')) return { state: data, group };
  return { state: { ...data, nodes: data.nodes.filter(n => !n.subscriptionId && nodeSourceGroup(n.id) === group), informationNodes: [], unsupportedNodes: [] }, group: 'manual' };
}
export function prepareManualLinks(content, name) {
  const label = name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 120);
  if (!label) return content;
  const lines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.map((line, i) => `${line.split('#')[0]}#${encodeURIComponent(lines.length === 1 ? label : `${label} · ${i + 1}`)}`).join('\n');
}
