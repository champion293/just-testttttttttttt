const multer = require('multer');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);

// Files are streamed to a temp dir first, then the cloud provider adapter
// moves them into permanent storage. Nothing is buffered fully in memory.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => {
    cb(null, `mateen-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  }
});

// Block obviously dangerous / executable extensions. Everything else is
// allowed - the app is a general file store, not a media-only service.
const BLOCKED_EXT = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.com', '.scr'
]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXT.has(ext)) {
    return cb(new Error(`File type "${ext}" is not allowed`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 20
  }
});

module.exports = upload;
