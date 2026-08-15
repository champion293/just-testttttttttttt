# Mateen Cloud

A modern, professional cloud file storage & sharing web app.

**Developed by ABDUL MATEEN**

---

## A note on the storage provider

This project was requested with an API key/secret pair, but a key alone
doesn't identify which provider issued it. Rather than guess and wire up
endpoints that might not exist, Mateen Cloud ships with a fully working
**local disk-backed storage adapter** (`services/cloudProvider.js`) that
implements every operation the app needs — upload, download, folders,
rename, delete/trash/restore, starring, and share links with expiration
and permissions. Everything in the UI is real, backed by this adapter;
nothing is faked.

The supplied `CLOUD_API_KEY` / `CLOUD_API_SECRET` are stored in `.env` and
are **not used by the local adapter and never touch the frontend**. Once
you confirm which provider they belong to, implement that provider's
calls inside `services/cloudProvider.js` (same exported function names),
set `CLOUD_PROVIDER=<name>` in `.env`, and the rest of the app — routes,
UI, everything — keeps working unchanged.

## Features implemented

- Upload (single & multiple), drag-and-drop, live per-file progress
- Folders: create, open, rename, delete (must be empty), breadcrumb navigation
- File actions: preview, download, share, rename, star, delete, details
- Grid and list views, sortable (name/size/modified), filterable by type
- Debounced search across the current file set
- File preview for images, PDF, audio, video, and text; graceful fallback
  ("Preview unavailable" + download) for everything else
- Share links with expiration (never / 1d / 7d / 30d) and permission
  (view-only / download), a public `/s/:token` landing page, copy-to-clipboard,
  and revoke
- Recent, Starred, Shared, and Trash (restore / permanently delete) views
- Real storage usage meter (used vs. quota) shown in the sidebar, dashboard,
  and settings
- Settings page with Light / Dark / System theme (persisted in `localStorage`)
- Toast notifications for all major actions; no `alert()` popups
- Skeleton loaders and empty states throughout
- Fully responsive layout down to 360px, with a collapsible mobile sidebar
- Security: Helmet, server-side upload validation (size/type), rate limiting
  on upload & share endpoints, filename sanitization, path-traversal
  prevention, no secrets in frontend code, no stack traces in production
  responses

## Installation

```bash
npm install
```

## Environment

Copy `.env.example` to `.env` and adjust as needed:

```env
CLOUD_PROVIDER=local        # swap to a real provider name once confirmed
CLOUD_API_URL=
CLOUD_API_KEY=
CLOUD_API_SECRET=
PORT=3000
NODE_ENV=development
MAX_UPLOAD_MB=200
STORAGE_QUOTA_GB=15
```

`CLOUD_API_KEY` / `CLOUD_API_SECRET` are only ever read server-side
(`process.env`) and are never sent to the browser or logged.

## Run

```bash
npm start
```

Development (auto-restart on change):

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Project structure

```text
mateen-cloud/
├── server.js              Express app, security middleware, routing
├── routes/
│   ├── files.js            File CRUD, upload, download
│   ├── folders.js          Folder CRUD, breadcrumb/listing
│   └── sharing.js          Share link create/get/download/revoke
├── services/
│   └── cloudProvider.js    Storage adapter (local disk today; swap-in point
│                            for a real provider — see note above)
├── middleware/
│   └── upload.js            Multer config: streaming, size/type limits
├── public/                  Vanilla HTML/CSS/JS frontend (SPA-style)
│   ├── index.html, style.css, app.js
│   ├── share.html           Public share landing page
│   └── assets/favicon.svg
└── storage/                  Local adapter's data (gitignored)
    ├── db.json               Metadata (files, folders, shares)
    ├── files/                 Actual file contents, by ID
    └── trash/                 (reserved for future use)
```

## API configuration

Provider credentials live only in `.env` → `process.env.CLOUD_API_KEY` /
`CLOUD_API_SECRET`, read inside `services/cloudProvider.js`. They are never
imported into anything under `public/` and never included in any JSON
response sent to the browser.

## Security

- Secrets are backend-only (`.env`, gitignored) — the browser never sees them.
- All file/folder names are sanitized; path traversal is blocked before any
  filesystem write or read.
- Uploads are validated for size and blocked extensions on the server, not
  just the client.
- Helmet sets standard hardening headers; sensitive routes are rate-limited.
- Error responses never include stack traces; only clean JSON like
  `{ "success": false, "error": "..." }`.

## Deployment

Mateen Cloud is a standard Node/Express app and runs on any Node-compatible
host (Render, Railway, Fly.io, a VPS, etc.):

1. Set the environment variables from `.env.example` in your host's config.
2. Ensure the `storage/` directory is on **persistent** disk (not ephemeral),
   or point a real cloud provider adapter at object storage instead.
3. `npm install && npm start` (or let the platform run these for you).
4. Put the app behind HTTPS (most hosts terminate TLS for you automatically).

## Troubleshooting

| Problem | Likely cause |
|---|---|
| "Cloud storage temporarily unavailable" | The `storage/` directory isn't writable, or disk is full |
| Upload fails immediately | File exceeds `MAX_UPLOAD_MB`, or has a blocked extension |
| Share link says "expired" | The link's expiration window has passed — create a new one |
| Folder delete fails | Folders must be empty before they can be deleted |
| Changes not visible after deploy | Confirm `storage/` is persistent storage on your host, not ephemeral |

---

© 2026 Mateen Cloud — Developed by ABDUL MATEEN
