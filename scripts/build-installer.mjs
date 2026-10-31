import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cleanLocalRelease } from './release-cleanup.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Please run npm run dist');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'supervpn-installer-'));
const packed = path.join(work, 'packed'), release = path.join(root, 'release');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const name = `SuperVPN-Setup-${pkg.version}.exe`;
function run(file, args) {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Installer build/verification failed');
}
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
try {
  run(process.execPath, [npm, 'run', 'dist:ci', '--', `--config.directories.output=${packed}`]);
  run(process.execPath, [path.join(root, 'scripts/verify-release.mjs'), packed]);
  await fs.mkdir(release, { recursive: true });
  await fs.copyFile(path.join(packed, name), path.join(release, name));
  if (await hash(path.join(packed, name)) !== await hash(path.join(release, name))) throw new Error('Installer copy verification failed');
  // Read-only process check: never stop an application in order to clean files.
  const escaped = path.join(release, 'win-unpacked').replaceAll("'", "''");
  const check = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$root='${escaped}\\';if(@(Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.Path -and $_.Path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)}).Count){exit 2}`], { encoding: 'utf8', windowsHide: true });
  const unpackedInUse = !!check.error || check.status !== 0;
  await cleanLocalRelease(release, name, { unpackedInUse });
  console.log(`Installer ready: ${path.join(release, name)}`);
  if (unpackedInUse) console.log('Existing win-unpacked was preserved because it may be in use; no process was stopped.');
  await fs.rm(work, { recursive: true, force: true });
} catch (error) {
  console.error(`Build failed. Previous installers preserved. Recovery files: ${work}`);
  throw error;
}
