import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cleanLocalRelease } from '../scripts/release-cleanup.mjs';
test('local delivery retains only latest installer and preserves unrelated user files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-cleanup-test-'));
  const keep = 'SuperVPN-Setup-0.6.1.exe';
  try {
    const old = ['SuperVPN Setup 0.1.0.exe', 'SuperVPN Setup 0.1.0.exe.blockmap', 'SuperVPN-Setup-0.6.0.exe', 'SuperVPN-Setup-0.6.0.exe.blockmap', 'latest.yml', 'builder-debug.yml', 'sing-box-1.12.14-source.tar.gz'];
    for (const name of [...old, keep, 'user-notes.txt']) await fs.writeFile(path.join(dir, name), 'test');
    await fs.mkdir(path.join(dir, 'win-unpacked')); await fs.writeFile(path.join(dir, 'win-unpacked', 'test.exe'), 'test');
    await cleanLocalRelease(dir, keep);
    assert.deepEqual((await fs.readdir(dir)).sort(), [keep, 'user-notes.txt'].sort());
    assert.equal(await fs.readFile(path.join(dir, keep), 'utf8'), 'test');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('cleanup refuses to delete previous files without a verified latest filename and retains an active unpacked app', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-cleanup-test-'));
  try {
    const keep = 'SuperVPN-Setup-0.6.1.exe';
    await fs.writeFile(path.join(dir, 'SuperVPN-Setup-0.6.0.exe'), 'old');
    await assert.rejects(cleanLocalRelease(dir, keep));
    await assert.rejects(cleanLocalRelease(dir, '../file.exe'));
    assert.equal((await fs.readdir(dir)).length, 1);
    await fs.writeFile(path.join(dir, keep), 'new'); await fs.mkdir(path.join(dir, 'win-unpacked'));
    await cleanLocalRelease(dir, keep, { unpackedInUse: true });
    assert.deepEqual((await fs.readdir(dir)).sort(), [keep, 'win-unpacked'].sort());
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
