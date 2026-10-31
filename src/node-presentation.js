export function nodeIsUnavailable(node, checks = {}) {
  return !!node.unsupported || checks[node.id]?.status === 'failed';
}
export function sortedNodeCards(nodes, checks = {}, hideUnavailable = false) {
  const rank = node => {
    if (nodeIsUnavailable(node, checks)) return [2, 0];
    const check = checks[node.id];
    if (check?.status === 'ok' && Number.isFinite(check.delayMs) && check.delayMs >= 0) return [0, check.delayMs];
    return [1, 0]; // Untested/testing nodes are not presumed unusable.
  };
  return nodes.filter(node => !hideUnavailable || !nodeIsUnavailable(node, checks))
    .map((node, index) => ({ node, index, rank: rank(node) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index)
    .map(item => item.node);
}
