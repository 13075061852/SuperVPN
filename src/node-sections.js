import { sortedNodeCards } from './node-presentation.js';
import { sourceGroups } from './source-groups.js';
// Group by persistent source IDs, never by names, hosts, or latency.
export function nodeSections(data, items, hideUnavailable = false) {
  const subscriptions = sourceGroups(data).filter(source => source.kind === 'subscription');
  const sections = new Map(subscriptions.map(source => [source.id, { id: source.id, name: source.name, identifier: source.identifier, manual: false, nodes: [] }]));
  const manual = { id: 'manual', name: '独立节点', manual: true, nodes: [] };
  for (const node of items) {
    if (!node.subscriptionId) { manual.nodes.push(node); continue; }
    if (!sections.has(node.subscriptionId)) sections.set(node.subscriptionId, { id: node.subscriptionId, name: '未命名订阅', identifier: node.subscriptionId, manual: false, nodes: [] });
    sections.get(node.subscriptionId).nodes.push(node);
  }
  return [...sections.values(), manual].filter(section => section.nodes.length).map(section => {
    const sameName = !section.manual && [...sections.values()].filter(other => other.name === section.name).length > 1;
    return { ...section, label: sameName ? `${section.name} · #${section.identifier}` : section.name, total: section.nodes.length, nodes: sortedNodeCards(section.nodes, data.nodeChecks, hideUnavailable) };
  });
}
