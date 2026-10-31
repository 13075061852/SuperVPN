const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');
async function validateDownloadedInstaller(info) {
  const file = info?.downloadedFile;
  const hash = info?.files?.find(item => typeof item.url === 'string' && item.url.split(/[?#]/)[0].toLowerCase().endsWith('.exe'))?.sha512 || info?.sha512;
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.exe' || typeof hash !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(hash)) throw new Error('UPDATE_INTEGRITY');
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 2 * 1024 ** 3) throw new Error('UPDATE_INTEGRITY');
  const digest = createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  if (!timingSafeEqual(digest.digest(), Buffer.from(hash, 'base64'))) throw new Error('UPDATE_INTEGRITY');
}
module.exports = { validateDownloadedInstaller };
