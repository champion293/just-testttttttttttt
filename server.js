require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const filesRouter = require('./routes/files');
const foldersRouter = require('./routes/folders');
const sharingRouter = require('./routes/sharing');
const provider = require('./services/cloudProvider');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false // relaxed for the vanilla-JS single page app
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Basic request log (no secrets, no bodies)
app.use((req, res, next) => {
  console.log(`[INFO] ${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Rate-limit sensitive endpoints
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const shareLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use('/api/files/upload', uploadLimiter);
app.use('/api/share', shareLimiter);

// --- API ---
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', time: Date.now() } });
});

app.get('/api/storage', (req, res) => {
  res.json({ success: true, data: provider.getStorageUsage() });
});

app.use('/api/files', filesRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/share', sharingRouter);

// --- Static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// Public share page (client fetches /api/share/:token)
app.get('/s/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// SPA fallback for the dashboard
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Error handling (no stack traces to the client) ---
app.use((err, req, res, next) => {
  const status = err.status || (err.message && err.message.includes('File too large') ? 413 : 500);
  if (status >= 500) {
    console.error('[ERROR]', err.message);
  } else {
    console.warn('[WARN]', err.message);
  }
  res.status(status).json({
    success: false,
    error: isProd && status >= 500 ? 'Something went wrong' : err.message
  });
});

app.listen(PORT, () => {
  console.log(`[INFO] Mateen Cloud server started on port ${PORT}`);
  console.log(`[INFO] Storage provider: ${process.env.CLOUD_PROVIDER || 'local'}`);
});
