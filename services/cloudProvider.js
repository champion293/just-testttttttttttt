/**
 * services/cloudProvider.js
 *
 * Mateen Cloud talks to storage through a single adapter interface so the
 * routes never know (or care) which provider is behind the scenes.
 *
 * -----------------------------------------------------------------------
 * WHY "local" AND NOT A NAMED THIRD-PARTY PROVIDER
 * -----------------------------------------------------------------------
 * This project was bootstrapped with an API key/secret pair, but the pair
 * alone doesn't identify which provider issued it (many providers use
 * similar-looking opaque alphanumeric keys). Rather than guess and wire up
 * endpoints that might be wrong, this adapter implements a fully working
 * LOCAL disk-backed provider that honors the exact same interface a real
 * provider adapter would. CLOUD_API_KEY / CLOUD_API_SECRET are loaded from
 * .env and sit ready to use, but nothing in this file (or anywhere in the
 * frontend) reads or exposes them.
 *
 * To wire up a real provider later:
 *   1. Confirm the provider from its official docs.
 *   2. Implement the same exported functions below against that provider's
 *      real API (auth, upload, list, download, delete, folders, shares).
 *   3. Set CLOUD_PROVIDER=<name> in .env and branch in `getProvider()`.
 * Nothing in routes/ or public/ needs to change.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');

const DATA_DIR = path.join(__dirname, '..', 'storage');
const FILES_DIR = path.join(DATA_DIR, 'files');
const TRASH_DIR = path.join(DATA_DIR, 'trash');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const STORAGE_QUOTA_BYTES =
  Number(process.env.STORAGE_QUOTA_GB || 15) * 1024 * 1024 * 1024;

function ensureDirs() {
  for (const dir of [DATA_DIR, FILES_DIR, TRASH_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      folders: {
        root: { id: 'root', name: 'My Files', parentId: null, trashed: false, createdAt: Date.now() }
      },
      files: {},
      shares: {}
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
  }
}
ensureDirs();

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomBytes(12).toString('hex');
}

// Prevent path traversal / weird filenames. Keep it simple & safe.
function sanitizeName(name) {
  const trimmed = String(name || 'untitled').trim();
  const stripped = trimmed.replace(/[/\\]/g, '_').replace(/\.\.+/g, '.');
  return stripped.slice(0, 255) || 'untitled';
}

function fileTypeCategory(nameOrMime) {
  const ext = (nameOrMime.split('.').pop() || '').toLowerCase();
  const images = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
  const docs = ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx', 'ppt', 'pptx'];
  const media = ['mp3', 'wav', 'mp4', 'webm', 'mov'];
  const archives = ['zip', 'rar', '7z'];
  if (images.includes(ext)) return 'image';
  if (docs.includes(ext)) return 'document';
  if (media.includes(ext)) return 'media';
  if (archives.includes(ext)) return 'archive';
  return 'other';
}

// ---------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------

function getFolder(folderId) {
  const db = readDb();
  return db.folders[folderId] || null;
}

function listFolderContents(folderId) {
  const db = readDb();
  if (!db.folders[folderId]) throw httpError(404, 'Folder not found');
  const folders = Object.values(db.folders).filter(
    (f) => f.parentId === folderId && !f.trashed
  );
  const files = Object.values(db.files).filter(
    (f) => f.parentId === folderId && !f.trashed
  );
  return { folders, files };
}

function breadcrumb(folderId) {
  const db = readDb();
  const trail = [];
  let cur = db.folders[folderId];
  while (cur) {
    trail.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? db.folders[cur.parentId] : null;
  }
  return trail;
}

function createFolder(name, parentId = 'root') {
  const db = readDb();
  if (!db.folders[parentId]) throw httpError(404, 'Parent folder not found');
  const folder = {
    id: id(),
    name: sanitizeName(name),
    parentId,
    trashed: false,
    createdAt: Date.now()
  };
  db.folders[folder.id] = folder;
  writeDb(db);
  return folder;
}

function renameFolder(folderId, name) {
  const db = readDb();
  const folder = db.folders[folderId];
  if (!folder) throw httpError(404, 'Folder not found');
  if (folderId === 'root') throw httpError(400, 'Cannot rename root folder');
  folder.name = sanitizeName(name);
  writeDb(db);
  return folder;
}

function deleteFolder(folderId) {
  const db = readDb();
  const folder = db.folders[folderId];
  if (!folder) throw httpError(404, 'Folder not found');
  if (folderId === 'root') throw httpError(400, 'Cannot delete root folder');

  const hasChildren =
    Object.values(db.folders).some((f) => f.parentId === folderId && !f.trashed) ||
    Object.values(db.files).some((f) => f.parentId === folderId && !f.trashed);
  if (hasChildren) throw httpError(400, 'Folder is not empty');

  folder.trashed = true;
  folder.trashedAt = Date.now();
  writeDb(db);
  return folder;
}

// ---------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------

function getFileMetadata(fileId) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');
  return file;
}

function listFiles({ folderId, search, sort, type } = {}) {
  const db = readDb();
  let files = Object.values(db.files).filter((f) => !f.trashed);

  if (folderId) files = files.filter((f) => f.parentId === folderId);
  if (search) {
    const q = search.toLowerCase();
    files = files.filter((f) => f.name.toLowerCase().includes(q));
  }
  if (type) files = files.filter((f) => f.category === type);

  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => b.size - a.size,
    modified: (a, b) => b.modifiedAt - a.modifiedAt
  };
  files.sort(sorters[sort] || sorters.modified);
  return files;
}

function recentFiles(limit = 20) {
  const db = readDb();
  return Object.values(db.files)
    .filter((f) => !f.trashed)
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit);
}

function starredFiles() {
  const db = readDb();
  return Object.values(db.files).filter((f) => f.starred && !f.trashed);
}

function trashedItems() {
  const db = readDb();
  return {
    files: Object.values(db.files).filter((f) => f.trashed),
    folders: Object.values(db.folders).filter((f) => f.trashed)
  };
}

async function saveUploadedFile({ tempPath, originalName, mimeType, size, parentId }) {
  const db = readDb();
  if (!db.folders[parentId]) throw httpError(404, 'Destination folder not found');

  const fileId = id();
  const safeName = sanitizeName(originalName);
  const storedPath = path.join(FILES_DIR, fileId);

  await fsp.rename(tempPath, storedPath);

  const record = {
    id: fileId,
    name: safeName,
    parentId,
    size,
    mimeType: mimeType || mime.lookup(safeName) || 'application/octet-stream',
    category: fileTypeCategory(safeName),
    starred: false,
    trashed: false,
    createdAt: Date.now(),
    modifiedAt: Date.now()
  };
  db.files[fileId] = record;
  writeDb(db);
  return record;
}

function fileDiskPath(fileId) {
  return path.join(FILES_DIR, fileId);
}

function renameFile(fileId, name) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');
  file.name = sanitizeName(name);
  file.category = fileTypeCategory(file.name);
  file.modifiedAt = Date.now();
  writeDb(db);
  return file;
}

function toggleStar(fileId, starred) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');
  file.starred = Boolean(starred);
  writeDb(db);
  return file;
}

function moveFile(fileId, parentId) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');
  if (!db.folders[parentId]) throw httpError(404, 'Destination folder not found');
  file.parentId = parentId;
  file.modifiedAt = Date.now();
  writeDb(db);
  return file;
}

function trashFile(fileId) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');
  file.trashed = true;
  file.trashedAt = Date.now();
  writeDb(db);
  return file;
}

function restoreFile(fileId) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');
  file.trashed = false;
  delete file.trashedAt;
  writeDb(db);
  return file;
}

function restoreFolder(folderId) {
  const db = readDb();
  const folder = db.folders[folderId];
  if (!folder) throw httpError(404, 'Folder not found');
  folder.trashed = false;
  delete folder.trashedAt;
  writeDb(db);
  return folder;
}

async function permanentlyDeleteFile(fileId) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');
  const diskPath = fileDiskPath(fileId);
  if (fs.existsSync(diskPath)) await fsp.unlink(diskPath);
  delete db.files[fileId];
  // Also remove any shares pointing at this file
  for (const token of Object.keys(db.shares)) {
    if (db.shares[token].fileId === fileId) delete db.shares[token];
  }
  writeDb(db);
}

function permanentlyDeleteFolder(folderId) {
  const db = readDb();
  if (!db.folders[folderId]) throw httpError(404, 'Folder not found');
  delete db.folders[folderId];
  writeDb(db);
}

// ---------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------

const EXPIRY_MS = {
  never: null,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
};

function createShareLink(fileId, { expiration = 'never', permission = 'view' } = {}) {
  const db = readDb();
  const file = db.files[fileId];
  if (!file) throw httpError(404, 'File not found');

  const token = crypto.randomBytes(16).toString('hex');
  const ms = EXPIRY_MS[expiration] ?? null;
  const share = {
    token,
    fileId,
    permission,
    expiration,
    createdAt: Date.now(),
    expiresAt: ms ? Date.now() + ms : null
  };
  db.shares[token] = share;
  writeDb(db);
  return share;
}

function getShare(token) {
  const db = readDb();
  const share = db.shares[token];
  if (!share) throw httpError(404, 'Share link not found');
  if (share.expiresAt && Date.now() > share.expiresAt) {
    throw httpError(410, 'Share link has expired');
  }
  return share;
}

function listSharesForFile(fileId) {
  const db = readDb();
  return Object.values(db.shares).filter((s) => s.fileId === fileId);
}

function listAllShares() {
  const db = readDb();
  return Object.values(db.shares);
}

function deleteShareByFileId(fileId) {
  const db = readDb();
  let removed = 0;
  for (const token of Object.keys(db.shares)) {
    if (db.shares[token].fileId === fileId) {
      delete db.shares[token];
      removed++;
    }
  }
  writeDb(db);
  return removed;
}

function deleteShareByToken(token) {
  const db = readDb();
  if (!db.shares[token]) throw httpError(404, 'Share link not found');
  delete db.shares[token];
  writeDb(db);
}

// ---------------------------------------------------------------------
// Storage usage
// ---------------------------------------------------------------------

function getStorageUsage() {
  const db = readDb();
  const used = Object.values(db.files)
    .filter((f) => !f.trashed)
    .reduce((sum, f) => sum + f.size, 0);
  return {
    usedBytes: used,
    quotaBytes: STORAGE_QUOTA_BYTES,
    percent: Math.min(100, Math.round((used / STORAGE_QUOTA_BYTES) * 1000) / 10)
  };
}

// ---------------------------------------------------------------------

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  // folders
  getFolder,
  listFolderContents,
  breadcrumb,
  createFolder,
  renameFolder,
  deleteFolder,
  restoreFolder,
  permanentlyDeleteFolder,
  // files
  getFileMetadata,
  listFiles,
  recentFiles,
  starredFiles,
  trashedItems,
  saveUploadedFile,
  fileDiskPath,
  renameFile,
  toggleStar,
  moveFile,
  trashFile,
  restoreFile,
  permanentlyDeleteFile,
  // sharing
  createShareLink,
  getShare,
  listSharesForFile,
  listAllShares,
  deleteShareByFileId,
  deleteShareByToken,
  // usage
  getStorageUsage,
  // utils
  sanitizeName,
  httpError
};
