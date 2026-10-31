import { test } from 'node:test';
import assert from 'node:assert/strict';
import layout from '../electron/window-layout.cjs';
test('normal desktop uses a shorter default and minimum height while preserving the single-row width', () => {
  const result = layout.windowLayout({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(result.minHeight, 640); assert.equal(result.height, 700); assert.equal(result.minWidth, 800);
  assert.ok(result.height >= result.minHeight);
  assert.equal(result.maxWidth, 1000); assert.equal(result.maxHeight, 900);
  assert.equal(result.maximizable, false); assert.equal(result.fullscreenable, false);
});
test('large and compact displays always have coherent size limits within their work area', () => {
  for (const [width, height] of [[3840, 2080], [1920, 1040], [1280, 680], [700, 760], [500, 550]]) {
    const result = layout.windowLayout({ x: -width, y: 32, width, height });
    assert.ok(result.minWidth <= result.width && result.width <= result.maxWidth);
    assert.ok(result.minHeight <= result.height && result.height <= result.maxHeight);
    assert.ok(result.maxWidth <= width && result.maxWidth <= 1000);
    assert.ok(result.maxHeight <= height && result.maxHeight <= 900);
    assert.ok(result.x >= -width && result.x + result.width <= 0);
    assert.ok(result.y >= 32 && result.y + result.height <= 32 + height);
  }
});
test('small work areas remain reachable and do not put controls behind the taskbar', () => {
  const result = layout.windowLayout({ x: 0, y: 0, width: 1366, height: 720 });
  assert.equal(result.height, 700); assert.equal(result.minHeight, 640);
  assert.equal(result.maxWidth, 1000); assert.equal(result.maxHeight, 720);
  assert.ok(result.y >= 0); assert.ok(result.y + result.height <= 720);
});
test('secondary display coordinates and small display bounds are respected', () => {
  const work = { x: -1280, y: 40, width: 640, height: 620 }, result = layout.windowLayout(work);
  assert.equal(result.width, 640); assert.equal(result.minWidth, 640); assert.equal(result.minHeight, 620);
  assert.equal(result.x, -1280); assert.equal(result.y, 40);
  assert.equal(result.maxWidth, 640); assert.equal(result.maxHeight, 620);
});
