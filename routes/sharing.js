const express = require('express');
const fs = require('fs');
const router = express.Router();
const provider = require('../services/cloudProvider');

function ok(res, data) {
  res.json({ success: true, data });
}
function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[ERROR]', err.message);
  res.status(status).json({ success: false, error: err.message || 'Something went wrong' });
}

// POST /api/share/:fileId  { expiration, permission }
router.post('/:fileId', (req, res) => {
  try {
    const { expiration, permission } = req.body;
    const share = provider.createShareLink(req.params.fileId, { expiration, permission });
    ok(res, share);
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/share/mine/:fileId  -> list of shares for a file
router.get('/mine/:fileId', (req, res) => {
  try {
    ok(res, provider.listSharesForFile(req.params.fileId));
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/share/all -> everything the user has shared
router.get('/all', (req, res) => {
  try {
    const shares = provider.listAllShares();
    const withFiles = shares.map((s) => {
      let file = null;
      try {
        file = provider.getFileMetadata(s.fileId);
      } catch (_) {}
      return { ...s, file };
    });
    ok(res, withFiles);
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/share/:token  -> public metadata for the share landing page
router.get('/:token', (req, res) => {
  try {
    const share = provider.getShare(req.params.token);
    const file = provider.getFileMetadata(share.fileId);
    ok(res, {
      token: share.token,
      permission: share.permission,
      expiresAt: share.expiresAt,
      file: { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, category: file.category }
    });
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/share/:token/download -> public download, respects permission
router.get('/:token/download', (req, res) => {
  try {
    const share = provider.getShare(req.params.token);
    if (share.permission === 'view') {
      throw provider.httpError(403, 'This link only allows previewing, not downloading');
    }
    const file = provider.getFileMetadata(share.fileId);
    const diskPath = provider.fileDiskPath(file.id);
    if (!fs.existsSync(diskPath)) throw provider.httpError(404, 'File content missing');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    fs.createReadStream(diskPath).pipe(res);
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/share/:token
router.delete('/:token', (req, res) => {
  try {
    provider.deleteShareByToken(req.params.token);
    ok(res, { deleted: true });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
