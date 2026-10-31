import fs from 'node:fs/promises';
import path from 'node:path';

// Local delivery only. Never prune GitHub Releases or update-feed assets.
export async function cleanLocalRelease(directory, keepName, { unpackedInUse = false } = {}) {
  if (!/^SuperVPN-Setup-\d+\.\d+\.\d+\.exe$/.test(keepName)) throw new Error('Invalid installer filename');
  if (!(await fs.stat(path.join(directory, keepName))).isFile()) throw new Error('Latest installer is missing; nothing was deleted');
  const removed = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === keepName) continue;
    const installer = /^SuperVPN[ -]Setup[ -]\d+\.\d+\.\d+\.exe(?:\.blockmap)?$/i.test(entry.name);
    const generated = ['latest.yml', 'builder-debug.yml', 'builder-effective-config.yaml'].includes(entry.name) || /^sing-box-\d+\.\d+\.\d+-source\.tar\.gz$/.test(entry.name);
    const unpacked = entry.isDirectory() && entry.name === 'win-unpacked';
    if (unpacked && unpackedInUse) continue;
    if (installer || generated || unpacked) {
      // A symlink is only unlinked; never recursively follow a substituted path.
      try {
        if (entry.isSymbolicLink()) await fs.unlink(path.join(directory, entry.name));
        else await fs.rm(path.join(directory, entry.name), { recursive: unpacked, force: true });
        removed.push(entry.name);
      } catch (error) {
        if (!unpacked || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        console.warn('win-unpacked is locked; remaining build files were preserved. No process was stopped.');
      }
    }
  }
  return removed;
}
