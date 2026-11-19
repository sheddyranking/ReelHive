// Media storage adapter: keeps video files on the local disk.
//
// Every storage adapter exposes the same three functions (save, remove,
// publicUrl). To move to Azure Blob Storage later, write a blobStorage.js
// with the same functions and switch to it in server.js. Nothing else changes.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function createLocalStorage(uploadDir) {
  async function init() {
    await fs.mkdir(uploadDir, { recursive: true });
  }

  // Move an uploaded temp file into storage under a random, safe name.
  async function save(tempPath, originalName) {
    const ext = path.extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp4';
    const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const dest = path.join(uploadDir, key);
    try {
      await fs.rename(tempPath, dest);
    } catch {
      // rename fails across drives; fall back to copy + delete
      await fs.copyFile(tempPath, dest);
      await fs.unlink(tempPath).catch(() => {});
    }
    return key;
  }

  async function remove(key) {
    // basename() stops a crafted key from reaching outside the upload folder
    await fs.unlink(path.join(uploadDir, path.basename(key))).catch(() => {});
  }

  function publicUrl(key) {
    return `/media/${encodeURIComponent(key)}`;
  }

  return { init, save, remove, publicUrl, dir: uploadDir };
}

module.exports = { createLocalStorage };
