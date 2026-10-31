// Pending selection is presentation-only. Dashboard/network state and saved
// selection continue to come from the backend, including stop/start broadcasts.
export function displayedNodeId(data, pendingNodeId) {
  return pendingNodeId && data.nodes.some(node => node.id === pendingNodeId && !node.unsupported)
    ? pendingNodeId : data.selectedNodeId;
}
export function createOptimisticNodeSwitch({ request, onPending }) {
  let switching = false;
  return async nodeId => {
    if (switching) return null;
    switching = true;
    onPending(nodeId);
    try { return await request(nodeId); }
    finally { switching = false; onPending(null); }
  };
}
