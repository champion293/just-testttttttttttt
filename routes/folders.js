const express = require('express');
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

// POST /api/folders  { name, parentId }
router.post('/', (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name || !name.trim()) throw provider.httpError(400, 'Folder name is required');
    ok(res, provider.createFolder(name, parentId || 'root'));
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/folders/:id  -> { folder, breadcrumb, folders, files }
router.get('/:id', (req, res) => {
  try {
    const folder = provider.getFolder(req.params.id);
    if (!folder) throw provider.httpError(404, 'Folder not found');
    const { folders, files } = provider.listFolderContents(req.params.id);
    ok(res, {
      folder,
      breadcrumb: provider.breadcrumb(req.params.id),
      folders,
      files
    });
  } catch (err) {
    fail(res, err);
  }
});

// PATCH /api/folders/:id  { name?, restore? }
router.patch('/:id', (req, res) => {
  try {
    const { name, restore } = req.body;
    let folder;
    if (typeof name === 'string') folder = provider.renameFolder(req.params.id, name);
    if (restore === true) folder = provider.restoreFolder(req.params.id);
    ok(res, folder || provider.getFolder(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/folders/:id?permanent=true
router.delete('/:id', (req, res) => {
  try {
    if (req.query.permanent === 'true') {
      provider.permanentlyDeleteFolder(req.params.id);
      return ok(res, { deleted: true, permanent: true });
    }
    ok(res, provider.deleteFolder(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
