function windowLayout(workArea) {
  const width = Math.min(860, workArea.width);
  const height = Math.min(700, workArea.height);
  return {
    width, height,
    minWidth: Math.min(800, workArea.width),
    minHeight: Math.min(640, workArea.height),
    maxWidth: Math.min(1000, workArea.width),
    maxHeight: Math.min(900, workArea.height),
    maximizable: false,
    fullscreenable: false,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2)
  };
}
module.exports = { windowLayout };
