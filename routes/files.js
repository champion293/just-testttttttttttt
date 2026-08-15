const express = require('express');
const fs = require('fs');
const router = express.Router();
const provider = require('../services/cloudProvider');
const upload = require('../middleware/upload');

function ok(res, data) {
  res.json({ success: true, data });
}
function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[ERROR]', err.message);
  res.status(status).json({ success: false, error: err.message || 'Something went wrong' });
}

// GET /api/files?folderId=&search=&sort=&type=&view=recent|starred|trash
router.get('/', (req, res) => {
  try {
    const { folderId, search, sort, type, view } = req.query;

    if (view === 'recent') return ok(res, provider.recentFiles(30));
    if (view === 'starred') return ok(res, provider.starredFiles());
    if (view === 'trash') return ok(res, provider.trashedItems());

    const files = provider.listFiles({ folderId, search, sort, type });
    ok(res, files);
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/files/upload  (multipart, field name "files", parentId in body)
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const parentId = req.body.parentId || 'root';
    if (!req.files || req.files.length === 0) {
      throw provider.httpError(400, 'No files were provided');
    }
    const saved = [];
    for (const f of req.files) {
      const record = await provider.saveUploadedFile({
        tempPath: f.path,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        parentId
      });
      saved.push(record);
    }
    ok(res, saved);
  } catch (err) {
    // Clean up any temp files left behind on failure
    (req.files || []).forEach((f) => {
      fs.existsSync(f.path) && fs.unlink(f.path, () => {});
    });
    fail(res, err);
  }
});

// GET /api/files/:id
router.get('/:id', (req, res) => {
  try {
    ok(res, provider.getFileMetadata(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/files/:id/download  and  ?preview=1 for inline viewing
router.get('/:id/download', (req, res) => {
  try {
    const file = provider.getFileMetadata(req.params.id);
    const diskPath = provider.fileDiskPath(file.id);
    if (!fs.existsSync(diskPath)) throw provider.httpError(404, 'File content missing');

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    const disposition = req.query.preview ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(file.name)}"`
    );
    fs.createReadStream(diskPath).pipe(res);
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/files/:id  { name?, starred?, parentId?, restore? }
router.patch('/:id', (req, res) => {
  try {
    const { name, starred, parentId, restore } = req.body;
    let file = provider.getFileMetadata(req.params.id);
    if (typeof name === 'string') file = provider.renameFile(req.params.id, name);
    if (typeof starred === 'boolean') file = provider.toggleStar(req.params.id, starred);
    if (typeof parentId === 'string') file = provider.moveFile(req.params.id, parentId);
    if (restore === true) file = provider.restoreFile(req.params.id);
    ok(res, file);
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/files/:id?permanent=true
router.delete('/:id', async (req, res) => {
  try {
    if (req.query.permanent === 'true') {
      await provider.permanentlyDeleteFile(req.params.id);
      return ok(res, { deleted: true, permanent: true });
    }
    provider.deleteShareByFileId(req.params.id);
    const file = provider.trashFile(req.params.id);
    ok(res, file);
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
