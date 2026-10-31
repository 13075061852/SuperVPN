import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const directory = process.env.SUPERVPN_TEST_ICON_DIR || 'electron';

async function frames(file) {
  const buffer = await fs.readFile(path.join(directory, file));
  assert.equal(buffer.readUInt16LE(0), 0); assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4), result = [];
  let end = 6 + count * 16;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16, size = buffer[entry] || 256;
    assert.equal(buffer[entry + 1] || 256, size); assert.equal(buffer.readUInt16LE(entry + 6), 32);
    const length = buffer.readUInt32LE(entry + 8), offset = buffer.readUInt32LE(entry + 12);
    assert.equal(offset, end); end = offset + length; assert.ok(end <= buffer.length);
    const data = buffer.subarray(offset, end), stride = Math.ceil(size / 32) * 4;
    assert.equal(data.readUInt32LE(0), 40); assert.equal(data.readInt32LE(4), size); assert.equal(data.readInt32LE(8), size * 2);
    assert.equal(data.readUInt16LE(12), 1); assert.equal(data.readUInt16LE(14), 32); assert.equal(data.readUInt32LE(16), 0);
    assert.equal(length, 40 + size * size * 4 + stride * size);
    const pixel = (x, y) => {
      const p = 40 + ((size - y - 1) * size + x) * 4;
      const mask = 40 + size * size * 4 + (size - y - 1) * stride + Math.floor(x / 8);
      return { b: data[p], g: data[p + 1], r: data[p + 2], alpha: data[p + 3], transparentMask: !!(data[mask] & (0x80 >> (x % 8))) };
    };
    result.push({ size, pixel });
  }
  assert.equal(end, buffer.length);
  return result;
}

for (const [file, sizes] of [['app.ico', [16, 20, 24, 32, 40, 48, 64, 128, 256]], ['tray.ico', [16, 20, 24, 32, 40, 48, 64]]]) {
  test(`${file} has native DPI frames with alpha and a matching Windows AND mask, not visible black corners`, async () => {
    const images = await frames(file); assert.deepEqual(images.map(frame => frame.size), sizes);
    for (const { size, pixel } of images) {
      for (const [x, y] of [[0, 0], [0, size - 1], [size - 1, 0], [size - 1, size - 1]]) {
        assert.equal(pixel(x, y).alpha, 0); assert.equal(pixel(x, y).transparentMask, true);
      }
      let visible = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const p = pixel(x, y);
        assert.equal(p.transparentMask, p.alpha === 0);
        if (p.alpha === 0) assert.deepEqual([p.r, p.g, p.b], [0, 0, 0], 'transparent XOR pixels must not invert the Windows background');
        if (p.alpha > 0) {
          visible++;
          assert.ok(p.r > 50 || p.g > 50 || p.b > 50, 'straight-color ICO pixels must not contain black edges or be double-premultiplied');
        }
      }
      assert.ok(visible > 0 && visible < size * size);
      if (file === 'tray.ico') assert.ok(visible < size * size * .6, 'tray should contain only the transparent brand mark, without a white tile');
    }
  });
}
test('Windows tray loads its native ICO without a PNG resize pass', async () => {
  const source = await fs.readFile('electron/main.cjs', 'utf8');
  assert.ok(source.includes("new Tray(path.join(__dirname, 'tray.ico'))"));
  assert.equal(source.includes("nativeImage.createFromPath(path.join(__dirname, 'tray.png'))"), false);
});
