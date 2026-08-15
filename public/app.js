(() => {
  'use strict';

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  const state = {
    view: 'dashboard',
    currentFolder: 'root',
    breadcrumb: [{ id: 'root', name: 'My Files' }],
    files: [],
    folders: [],
    selectedFile: null,
    searchQuery: '',
    viewMode: localStorage.getItem('mc_viewMode') || 'grid',
    sortMode: 'modified',
    typeFilter: '',
    theme: localStorage.getItem('mc_theme') || 'system',
    storageUsage: null,
    uploadQueue: []
  };

  let searchDebounce = null;

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const contentEl = $('#content');

  function fmtBytes(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function iconFor(category) {
    return { image: '🖼️', document: '📄', media: '🎬', archive: '🗜️', other: '📦' }[category] || '📦';
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      ...opts,
      body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined
    });
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error('Unable to connect to cloud storage');
    }
    if (!json.success) throw new Error(json.error || 'Something went wrong');
    return json.data;
  }

  // ---------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------
  function toast(message, type = 'success') {
    const stack = $('#toastStack');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = `${type === 'success' ? '✓' : '⚠'} ${message}`;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------
  function applyTheme() {
    let effective = state.theme;
    if (effective === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effective);
  }
  applyTheme();

  // ---------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------
  function open(id) { $(`#${id}`).classList.add('open'); }
  function close(id) { $(`#${id}`).classList.remove('open'); }
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => close(btn.dataset.close)));
  $$('.overlay').forEach((ov) => ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); }));

  // ---------------------------------------------------------------
  // Sidebar / nav
  // ---------------------------------------------------------------
  $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.add('open'));
  $('#sidebarClose').addEventListener('click', () => $('#sidebar').classList.remove('open'));

  $('#navList').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.view = btn.dataset.view;
    if (state.view === 'files') { state.currentFolder = 'root'; }
    $('#sidebar').classList.remove('open');
    render();
  });

  // ---------------------------------------------------------------
  // Storage card
  // ---------------------------------------------------------------
  async function refreshStorage() {
    try {
      state.storageUsage = await api('/storage');
      const pct = state.storageUsage.percent;
      $('#miniStorageLabel').textContent = `${fmtBytes(state.storageUsage.usedBytes)} of ${fmtBytes(state.storageUsage.quotaBytes)} used`;
      $('#miniStorageBar').style.width = `${pct}%`;
    } catch (e) {
      $('#miniStorageLabel').textContent = 'Storage unavailable';
    }
  }

  // ---------------------------------------------------------------
  // Data loading per view
  // ---------------------------------------------------------------
  async function loadFolder(folderId) {
    const data = await api(`/folders/${folderId}`);
    state.currentFolder = folderId;
    state.breadcrumb = data.breadcrumb;
    state.folders = data.folders;
    state.files = data.files;
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  async function render() {
    try {
      if (state.view === 'dashboard') return renderDashboard();
      if (state.view === 'files') return renderFiles();
      if (state.view === 'recent') return renderSimpleFileList('recent', 'Recent Files');
      if (state.view === 'starred') return renderSimpleFileList('starred', 'Starred');
      if (state.view === 'shared') return renderShared();
      if (state.view === 'trash') return renderTrash();
      if (state.view === 'settings') return renderSettings();
    } catch (err) {
      contentEl.innerHTML = `<div class="empty-state"><div class="icon-big">⚠️</div><h3>Cloud storage temporarily unavailable</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  function skeletonGrid() {
    return `<div class="file-grid">${Array.from({ length: 8 }).map(() => '<div class="skeleton skeleton-card"></div>').join('')}</div>`;
  }

  async function renderDashboard() {
    contentEl.innerHTML = `
      <div class="hero">
        <div><h1>Welcome to Mateen Cloud</h1><p>Securely store, manage and share your files.</p></div>
        <div class="hero-actions">
          <button class="btn btn-primary" id="heroUpload">Upload Files</button>
          <button class="btn" id="heroFolder">New Folder</button>
        </div>
      </div>
      <div class="summary-grid">
        <div class="card">
          <div class="card-title">Storage</div>
          <div class="storage-amount" id="dashStorage">Loading…</div>
          <div class="bar"><div class="bar-fill" id="dashStorageBar" style="width:0%"></div></div>
        </div>
        <div class="card">
          <div class="card-title">Total Files</div>
          <div class="storage-amount" id="dashFileCount">—</div>
        </div>
        <div class="card">
          <div class="card-title">Shared Links</div>
          <div class="storage-amount" id="dashShareCount">—</div>
        </div>
      </div>
      <div class="section-header"><h2 class="section-title">Recent Files</h2></div>
      <div id="dashRecent">${skeletonGrid()}</div>
    `;
    $('#heroUpload').addEventListener('click', () => open('uploadOverlay'));
    $('#heroFolder').addEventListener('click', () => open('folderOverlay'));

    const [usage, recent, shares] = await Promise.all([
      api('/storage'),
      api('/files?view=recent'),
      api('/share/all').catch(() => [])
    ]);
    state.storageUsage = usage;
    $('#dashStorage').innerHTML = `${fmtBytes(usage.usedBytes)} <span>of ${fmtBytes(usage.quotaBytes)}</span>`;
    $('#dashStorageBar').style.width = `${usage.percent}%`;
    $('#dashFileCount').textContent = recent.length ? `${recent.length}+` : '0';
    $('#dashShareCount').textContent = shares.length;

    $('#dashRecent').innerHTML = recent.length
      ? fileGridHtml(recent.slice(0, 8))
      : emptyState('No files yet', 'Upload your first file to get started.', true);
    bindFileCardEvents($('#dashRecent'));
  }

  async function renderFiles() {
    contentEl.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">My Files</h2>
        <div class="toolbar">
          <select class="select" id="sortSelect">
            <option value="modified">Sort: Modified</option>
            <option value="name">Sort: Name</option>
            <option value="size">Sort: Size</option>
          </select>
          <select class="select" id="typeSelect">
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="document">Documents</option>
            <option value="media">Media</option>
            <option value="archive">Archives</option>
          </select>
          <div class="view-toggle">
            <button data-mode="grid" class="${state.viewMode === 'grid' ? 'active' : ''}">▦</button>
            <button data-mode="list" class="${state.viewMode === 'list' ? 'active' : ''}">☰</button>
          </div>
        </div>
      </div>
      <div id="fileArea">${skeletonGrid()}</div>
    `;
    $('#sortSelect').value = state.sortMode;
    $('#typeSelect').value = state.typeFilter;
    $('#sortSelect').addEventListener('change', (e) => { state.sortMode = e.target.value; renderFiles(); });
    $('#typeSelect').addEventListener('change', (e) => { state.typeFilter = e.target.value; renderFiles(); });
    $('.view-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      state.viewMode = btn.dataset.mode;
      localStorage.setItem('mc_viewMode', state.viewMode);
      renderFiles();
    });

    let folders = [], files = [];
    if (state.searchQuery) {
      files = await api(`/files?search=${encodeURIComponent(state.searchQuery)}&sort=${state.sortMode}&type=${state.typeFilter}`);
    } else {
      await loadFolder(state.currentFolder);
      folders = state.folders;
      files = state.files;
      if (state.typeFilter) files = files.filter((f) => f.category === state.typeFilter);
      const sorters = {
        name: (a, b) => a.name.localeCompare(b.name),
        size: (a, b) => b.size - a.size,
        modified: (a, b) => b.modifiedAt - a.modifiedAt
      };
      files = [...files].sort(sorters[state.sortMode]);
    }

    const sectionHeader = contentEl.querySelector('.section-header');
    if (sectionHeader && !state.searchQuery) {
      sectionHeader.insertAdjacentHTML('beforebegin', breadcrumbHtml());
      bindBreadcrumbEvents(contentEl);
    }

    const area = $('#fileArea');
    if (folders.length === 0 && files.length === 0) {
      area.innerHTML = state.searchQuery
        ? emptyState('No files found', 'Try a different search.', false)
        : emptyState('No files yet', 'Upload your first file to get started.', true);
      bindEmptyStateEvents(area);
      return;
    }

    if (state.viewMode === 'grid') {
      area.innerHTML = folderGridHtml(folders) + fileGridHtml(files);
    } else {
      area.innerHTML = fileTableHtml(folders, files);
    }
    bindFileCardEvents(area);
    bindFolderCardEvents(area);
  }

  async function renderSimpleFileList(view, title) {
    contentEl.innerHTML = `
      <div class="section-header"><h2 class="section-title">${title}</h2></div>
      <div id="fileArea">${skeletonGrid()}</div>
    `;
    const files = await api(`/files?view=${view}`);
    const area = $('#fileArea');
    area.innerHTML = files.length
      ? fileGridHtml(files)
      : emptyState(view === 'starred' ? 'No starred files' : 'No recent files', view === 'starred' ? 'Star files to find them here quickly.' : 'Files you work with will show up here.', false);
    bindFileCardEvents(area);
  }

  async function renderShared() {
    contentEl.innerHTML = `<div class="section-header"><h2 class="section-title">Shared Files</h2></div><div id="sharedArea"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>`;
    const shares = await api('/share/all');
    const area = $('#sharedArea');
    if (!shares.length) {
      area.innerHTML = emptyState('No shared files', 'Share a file to see its link here.', false);
      return;
    }
    area.innerHTML = `<div class="overflow-x"><table class="file-table"><thead><tr>
        <th>File</th><th>Permission</th><th>Expiration</th><th>Created</th><th></th>
      </tr></thead><tbody>
      ${shares.map((s) => `
        <tr>
          <td class="file-row-name"><span class="row-icon">${s.file ? iconFor(s.file.category) : '📄'}</span>${escapeHtml(s.file ? s.file.name : 'Unknown file')}</td>
          <td>${s.permission}</td>
          <td>${s.expiration}</td>
          <td>${fmtDate(s.createdAt)}</td>
          <td class="row-actions">
            <button class="btn btn-sm" data-copy="${s.token}">Copy Link</button>
            <button class="btn btn-sm btn-danger" data-revoke="${s.token}">Disable</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>`;
    area.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', () => {
      const url = `${location.origin}/s/${btn.dataset.copy}`;
      navigator.clipboard.writeText(url).then(() => toast('Link copied'));
    }));
    area.querySelectorAll('[data-revoke]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/share/${btn.dataset.revoke}`, { method: 'DELETE' }); toast('Share link disabled'); renderShared(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }

  async function renderTrash() {
    contentEl.innerHTML = `<div class="section-header"><h2 class="section-title">Trash</h2></div><div id="trashArea">${skeletonGrid()}</div>`;
    const { files, folders } = await api('/files?view=trash');
    const area = $('#trashArea');
    if (!files.length && !folders.length) {
      area.innerHTML = emptyState('Trash is empty', 'Deleted files and folders will appear here.', false);
      return;
    }
    area.innerHTML = `<div class="overflow-x"><table class="file-table"><thead><tr>
        <th>Name</th><th>Type</th><th>Deleted</th><th></th>
      </tr></thead><tbody>
      ${folders.map((f) => `
        <tr><td class="file-row-name"><span class="row-icon">📁</span>${escapeHtml(f.name)}</td><td>Folder</td><td>${fmtDate(f.trashedAt)}</td>
        <td class="row-actions"><button class="btn btn-sm" data-restore-folder="${f.id}">Restore</button></td></tr>`).join('')}
      ${files.map((f) => `
        <tr><td class="file-row-name"><span class="row-icon">${iconFor(f.category)}</span>${escapeHtml(f.name)}</td><td>${f.category}</td><td>${fmtDate(f.trashedAt)}</td>
        <td class="row-actions">
          <button class="btn btn-sm" data-restore="${f.id}">Restore</button>
          <button class="btn btn-sm btn-danger" data-permadelete="${f.id}">Delete Forever</button>
        </td></tr>`).join('')}
      </tbody></table></div>`;
    area.querySelectorAll('[data-restore]').forEach((btn) => btn.addEventListener('click', async () => {
      await api(`/files/${btn.dataset.restore}`, { method: 'PATCH', body: { restore: true } });
      toast('File restored'); renderTrash();
    }));
    area.querySelectorAll('[data-restore-folder]').forEach((btn) => btn.addEventListener('click', async () => {
      await api(`/folders/${btn.dataset.restoreFolder}`, { method: 'PATCH', body: { restore: true } });
      toast('Folder restored'); renderTrash();
    }));
    area.querySelectorAll('[data-permadelete]').forEach((btn) => btn.addEventListener('click', () => {
      confirmAction('Delete file permanently?', 'This cannot be undone.', async () => {
        await api(`/files/${btn.dataset.permadelete}?permanent=true`, { method: 'DELETE' });
        toast('File permanently deleted'); renderTrash(); refreshStorage();
      });
    }));
  }

  function renderSettings() {
    contentEl.innerHTML = `
      <div class="section-header"><h2 class="section-title">Settings</h2></div>
      <div class="settings-section card">
        <h3>Account</h3>
        <div class="field"><label>Username</label><input type="text" value="user" disabled /></div>
        <div class="field"><label>Email</label><input type="email" value="user@mateen.cloud" disabled /></div>
      </div>
      <div class="settings-section card">
        <h3>Storage</h3>
        <div class="storage-amount" id="settingsStorage">Loading…</div>
        <div class="bar"><div class="bar-fill" id="settingsStorageBar" style="width:0%"></div></div>
      </div>
      <div class="settings-section card">
        <h3>Appearance</h3>
        <div class="theme-options">
          <div class="theme-card" data-theme-opt="light">☀️<br/>Light</div>
          <div class="theme-card" data-theme-opt="dark">🌙<br/>Dark</div>
          <div class="theme-card" data-theme-opt="system">🖥️<br/>System</div>
        </div>
      </div>
      <div class="settings-section card">
        <h3>Security</h3>
        <button class="btn btn-danger">Log out</button>
      </div>
      <div class="settings-section" style="text-align:center;color:var(--muted);font-size:12.5px;">
        Mateen Cloud — Developed by <span class="rgb-credit">ABDUL MATEEN</span>
      </div>
    `;
    $$('.theme-card').forEach((el) => {
      el.classList.toggle('active', state.theme === el.dataset.themeOpt);
      el.addEventListener('click', () => {
        state.theme = el.dataset.themeOpt;
        localStorage.setItem('mc_theme', state.theme);
        applyTheme();
        renderSettings();
      });
    });
    api('/storage').then((usage) => {
      $('#settingsStorage').innerHTML = `${fmtBytes(usage.usedBytes)} <span>of ${fmtBytes(usage.quotaBytes)}</span>`;
      $('#settingsStorageBar').style.width = `${usage.percent}%`;
    });
  }

  // ---------------------------------------------------------------
  // HTML builders
  // ---------------------------------------------------------------
  function breadcrumbHtml() {
    if (state.searchQuery) return '';
    const trail = state.breadcrumb.length ? state.breadcrumb : [{ id: 'root', name: 'My Files' }];
    return `<div class="breadcrumbs">${trail.map((b, i) => {
      const isLast = i === trail.length - 1;
      return `${i > 0 ? '<span class="sep">/</span>' : ''}${isLast
        ? `<span class="current">${escapeHtml(b.name)}</span>`
        : `<button data-crumb="${b.id}">${escapeHtml(b.name)}</button>`}`;
    }).join('')}</div>`;
  }

  function emptyState(title, sub, showUpload) {
    return `<div class="empty-state">
      <div class="icon-big">📂</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(sub)}</p>
      ${showUpload ? '<button class="btn btn-primary" id="emptyUploadBtn">Upload Files</button>' : ''}
    </div>`;
  }
  function bindEmptyStateEvents(container) {
    container.querySelector('#emptyUploadBtn')?.addEventListener('click', () => open('uploadOverlay'));
  }

  function folderGridHtml(folders) {
    return folders.map((f) => `
      <div class="file-card folder-card" data-folder-id="${f.id}">
        <button class="more-btn" data-ctx-folder="${f.id}">⋮</button>
        <div class="thumb">📁</div>
        <div class="fname" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="fmeta">Folder</div>
      </div>`).join('');
  }

  function fileGridHtml(files) {
    return files.map((f) => `
      <div class="file-card ${f.starred ? 'starred' : ''}" data-file-id="${f.id}">
        <button class="more-btn" data-ctx-file="${f.id}">⋮</button>
        <div class="thumb">${f.category === 'image' ? `<img loading="lazy" src="/api/files/${f.id}/download?preview=1" alt="">` : iconFor(f.category)}</div>
        <div class="fname" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="fmeta">${fmtBytes(f.size)} · ${fmtDate(f.modifiedAt)}</div>
      </div>`).join('');
  }

  function fileTableHtml(folders, files) {
    return `<div class="overflow-x"><table class="file-table"><thead><tr>
      <th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th></th>
    </tr></thead><tbody>
      ${folders.map((f) => `
        <tr data-folder-id="${f.id}">
          <td class="file-row-name"><span class="row-icon">📁</span>${escapeHtml(f.name)}</td>
          <td>Folder</td><td>—</td><td>${fmtDate(f.createdAt)}</td>
          <td class="row-actions"><button class="btn btn-sm" data-ctx-folder="${f.id}">⋮</button></td>
        </tr>`).join('')}
      ${files.map((f) => `
        <tr data-file-id="${f.id}">
          <td class="file-row-name"><span class="row-icon">${iconFor(f.category)}</span>${escapeHtml(f.name)}${f.starred ? ' ⭐' : ''}</td>
          <td>${f.category}</td><td>${fmtBytes(f.size)}</td><td>${fmtDate(f.modifiedAt)}</td>
          <td class="row-actions"><button class="btn btn-sm" data-ctx-file="${f.id}">⋮</button></td>
        </tr>`).join('')}
    </tbody></table></div>`;
  }

  // ---------------------------------------------------------------
  // Event binding for cards
  // ---------------------------------------------------------------
  function bindFolderCardEvents(container) {
    container.querySelectorAll('[data-folder-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-ctx-folder]')) return;
        state.currentFolder = el.dataset.folderId;
        renderFiles();
      });
    });
    container.querySelectorAll('[data-ctx-folder]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); showFolderCtxMenu(e, btn.dataset.ctxFolder); });
    });
  }

  function bindFileCardEvents(container) {
    container.querySelectorAll('[data-file-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-ctx-file]')) return;
        openPreview(el.dataset.fileId);
      });
    });
    container.querySelectorAll('[data-ctx-file]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); showFileCtxMenu(e, btn.dataset.ctxFile); });
    });
  }

  function bindBreadcrumbEvents(container) {
    container.querySelectorAll('[data-crumb]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.currentFolder = btn.dataset.crumb;
        state.searchQuery = '';
        $('#searchInput').value = '';
        renderFiles();
      });
    });
  }

  // ---------------------------------------------------------------
  // Context menus
  // ---------------------------------------------------------------
  function positionMenu(menu, e) {
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
    menu.classList.add('open');
  }
  document.addEventListener('click', () => $('#ctxMenu').classList.remove('open'));

  function showFileCtxMenu(e, fileId) {
    const file = findFile(fileId);
    const menu = $('#ctxMenu');
    menu.innerHTML = `
      <button data-act="preview">👁️ Preview</button>
      <button data-act="download">⬇️ Download</button>
      <button data-act="share">🔗 Share</button>
      <hr/>
      <button data-act="rename">✏️ Rename</button>
      <button data-act="star">⭐ ${file && file.starred ? 'Unstar' : 'Star'}</button>
      <button data-act="details">ℹ️ Details</button>
      <hr/>
      <button data-act="delete" class="danger">🗑️ Delete</button>
    `;
    positionMenu(menu, e);
    menu.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => fileAction(btn.dataset.act, fileId);
    });
  }

  function showFolderCtxMenu(e, folderId) {
    const menu = $('#ctxMenu');
    menu.innerHTML = `
      <button data-act="open">📂 Open</button>
      <button data-act="rename">✏️ Rename</button>
      <hr/>
      <button data-act="delete" class="danger">🗑️ Delete</button>
    `;
    positionMenu(menu, e);
    menu.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => folderAction(btn.dataset.act, folderId);
    });
  }

  function findFile(id) {
    return state.files.find((f) => f.id === id);
  }

  async function fileAction(action, fileId) {
    try {
      if (action === 'preview') return openPreview(fileId);
      if (action === 'download') return void (window.location.href = `/api/files/${fileId}/download`);
      if (action === 'share') return openShare(fileId);
      if (action === 'details') return openDetails(fileId);
      if (action === 'rename') {
        const file = await api(`/files/${fileId}`);
        $('#renameTitle').textContent = 'Rename file';
        $('#renameInput').value = file.name;
        open('renameOverlay');
        $('#renameConfirm').onclick = async () => {
          try {
            await api(`/files/${fileId}`, { method: 'PATCH', body: { name: $('#renameInput').value } });
            close('renameOverlay'); toast('File renamed'); render();
          } catch (e) { toast(e.message, 'error'); }
        };
      }
      if (action === 'star') {
        const file = await api(`/files/${fileId}`);
        await api(`/files/${fileId}`, { method: 'PATCH', body: { starred: !file.starred } });
        toast(file.starred ? 'Removed from starred' : 'Added to starred');
        render();
      }
      if (action === 'delete') {
        confirmAction('Move to trash?', 'You can restore this file later from Trash.', async () => {
          await api(`/files/${fileId}`, { method: 'DELETE' });
          toast('File deleted'); render(); refreshStorage();
        });
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function folderAction(action, folderId) {
    try {
      if (action === 'open') { state.currentFolder = folderId; return renderFiles(); }
      if (action === 'rename') {
        const folder = state.folders.find((f) => f.id === folderId) || {};
        $('#renameTitle').textContent = 'Rename folder';
        $('#renameInput').value = folder.name || '';
        open('renameOverlay');
        $('#renameConfirm').onclick = async () => {
          try {
            await api(`/folders/${folderId}`, { method: 'PATCH', body: { name: $('#renameInput').value } });
            close('renameOverlay'); toast('Folder renamed'); render();
          } catch (e) { toast(e.message, 'error'); }
        };
      }
      if (action === 'delete') {
        confirmAction('Delete folder?', 'The folder must be empty. This moves it to Trash.', async () => {
          await api(`/folders/${folderId}`, { method: 'DELETE' });
          toast('Folder deleted'); render();
        });
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function confirmAction(title, body, onConfirm) {
    $('#confirmTitle').textContent = title;
    $('#confirmBody').textContent = body;
    open('confirmOverlay');
    $('#confirmActionBtn').onclick = async () => {
      close('confirmOverlay');
      try { await onConfirm(); } catch (e) { toast(e.message, 'error'); }
    };
  }

  // ---------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------
  async function openPreview(fileId) {
    try {
      const file = await api(`/files/${fileId}`);
      $('#previewTitle').textContent = file.name;
      const body = $('#previewBody');
      const src = `/api/files/${fileId}/download?preview=1`;
      if (file.category === 'image') {
        body.innerHTML = `<img src="${src}" alt="${escapeHtml(file.name)}" />`;
      } else if (file.mimeType === 'application/pdf') {
        body.innerHTML = `<iframe src="${src}"></iframe>`;
      } else if (file.mimeType.startsWith('audio/')) {
        body.innerHTML = `<audio controls src="${src}"></audio>`;
      } else if (file.mimeType.startsWith('video/')) {
        body.innerHTML = `<video controls src="${src}"></video>`;
      } else if (file.mimeType.startsWith('text/') || file.name.endsWith('.txt')) {
        const text = await fetch(src).then((r) => r.text());
        body.innerHTML = `<pre>${escapeHtml(text.slice(0, 5000))}</pre>`;
      } else {
        body.innerHTML = `<div class="preview-fallback"><div style="font-size:34px;">${iconFor(file.category)}</div><p>Preview unavailable</p></div>`;
      }
      $('#previewDownloadBtn').onclick = () => (window.location.href = `/api/files/${fileId}/download`);
      open('previewOverlay');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---------------------------------------------------------------
  // Details
  // ---------------------------------------------------------------
  async function openDetails(fileId) {
    const file = await api(`/files/${fileId}`);
    const shares = await api(`/share/mine/${fileId}`).catch(() => []);
    $('#detailsBody').innerHTML = `
      <div class="detail-row"><span class="k">Name</span><span>${escapeHtml(file.name)}</span></div>
      <div class="detail-row"><span class="k">Type</span><span>${file.category} (${escapeHtml(file.mimeType)})</span></div>
      <div class="detail-row"><span class="k">Size</span><span>${fmtBytes(file.size)}</span></div>
      <div class="detail-row"><span class="k">Created</span><span>${fmtDate(file.createdAt)}</span></div>
      <div class="detail-row"><span class="k">Modified</span><span>${fmtDate(file.modifiedAt)}</span></div>
      <div class="detail-row"><span class="k">Owner</span><span>You</span></div>
      <div class="detail-row"><span class="k">Sharing</span><span>${shares.length ? `${shares.length} active link(s)` : 'Not shared'}</span></div>
    `;
    open('detailsOverlay');
  }

  // ---------------------------------------------------------------
  // Share
  // ---------------------------------------------------------------
  async function openShare(fileId) {
    const file = await api(`/files/${fileId}`);
    $('#shareTitle').textContent = `Share "${file.name}"`;
    const body = $('#shareBody');
    body.innerHTML = `
      <div class="field"><label>Link settings</label>
        <div style="margin-bottom:10px;color:var(--muted);font-size:13px;">Anyone with the link can access this file.</div>
      </div>
      <div class="field"><label>Expiration</label>
        <div class="chip-group" id="expChips">
          ${['never', '1d', '7d', '30d'].map((v) => `<div class="chip ${v === 'never' ? 'active' : ''}" data-exp="${v}">${{ never: 'Never', '1d': '1 day', '7d': '7 days', '30d': '30 days' }[v]}</div>`).join('')}
        </div>
      </div>
      <div class="field"><label>Permission</label>
        <div class="chip-group" id="permChips">
          <div class="chip active" data-perm="view">View</div>
          <div class="chip" data-perm="download">Download</div>
        </div>
      </div>
      <button class="btn btn-primary" id="createShareBtn" style="width:100%;margin-bottom:16px;">Create Share Link</button>
      <div id="existingShares"></div>
    `;
    let exp = 'never', perm = 'view';
    body.querySelectorAll('[data-exp]').forEach((chip) => chip.addEventListener('click', () => {
      body.querySelectorAll('[data-exp]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active'); exp = chip.dataset.exp;
    }));
    body.querySelectorAll('[data-perm]').forEach((chip) => chip.addEventListener('click', () => {
      body.querySelectorAll('[data-perm]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active'); perm = chip.dataset.perm;
    }));

    async function refreshExisting() {
      const shares = await api(`/share/mine/${fileId}`);
      $('#existingShares').innerHTML = shares.length ? `<label style="display:block;font-size:12.5px;color:var(--muted);margin-bottom:8px;font-weight:600;">Active links</label>` +
        shares.map((s) => `
          <div class="share-link-box">
            <input readonly value="${location.origin}/s/${s.token}" />
            <button class="btn btn-sm" data-copy="${s.token}">Copy</button>
            <button class="btn btn-sm btn-danger" data-revoke="${s.token}">Revoke</button>
          </div>`).join('') : '';
      $('#existingShares').querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
        navigator.clipboard.writeText(`${location.origin}/s/${b.dataset.copy}`).then(() => toast('Link copied'));
      }));
      $('#existingShares').querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
        await api(`/share/${b.dataset.revoke}`, { method: 'DELETE' });
        toast('Share link revoked'); refreshExisting();
      }));
    }
    await refreshExisting();

    $('#createShareBtn').onclick = async () => {
      try {
        await api(`/share/${fileId}`, { method: 'POST', body: { expiration: exp, permission: perm } });
        toast('Share link created'); refreshExisting();
      } catch (e) { toast(e.message, 'error'); }
    };
    open('shareOverlay');
  }

  // ---------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------
  $('#uploadBtn').addEventListener('click', () => open('uploadOverlay'));
  $('#newFolderBtn').addEventListener('click', () => { $('#folderNameInput').value = ''; open('folderOverlay'); });
  $('#createFolderConfirm').addEventListener('click', async () => {
    const name = $('#folderNameInput').value.trim();
    if (!name) return toast('Folder name is required', 'error');
    try {
      await api('/folders', { method: 'POST', body: { name, parentId: state.currentFolder } });
      close('folderOverlay'); toast('Folder created'); render();
    } catch (e) { toast(e.message, 'error'); }
  });

  const dropzone = $('#dropzone');
  const fileInput = $('#fileInputHidden');
  $('#browseBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  dropzone.addEventListener('click', () => fileInput.click());

  function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const list = $('#uploadList');
    files.forEach((file) => uploadOne(file, list));
  }

  function uploadOne(file, list) {
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.innerHTML = `
      <div class="info">
        <div class="fname">${escapeHtml(file.name)}</div>
        <div class="bar"><div class="bar-fill" style="width:0%"></div></div>
        <div class="pct">0% · ${fmtBytes(file.size)}</div>
      </div>`;
    list.prepend(row);
    const barFill = row.querySelector('.bar-fill');
    const pct = row.querySelector('.pct');

    const form = new FormData();
    form.append('files', file);
    form.append('parentId', state.currentFolder);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      barFill.style.width = `${p}%`;
      pct.textContent = `${p}% · ${fmtBytes(e.loaded)} / ${fmtBytes(e.total)}`;
    };
    xhr.onload = () => {
      let ok = false;
      try { ok = JSON.parse(xhr.responseText).success; } catch (_) {}
      if (ok && xhr.status < 400) {
        pct.textContent = `Done · ${fmtBytes(file.size)}`;
        toast(`${file.name} uploaded successfully`);
        refreshStorage();
        if (state.view === 'files' || state.view === 'dashboard') render();
      } else {
        let msg = 'Upload failed';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
        pct.textContent = msg;
        pct.style.color = 'var(--danger)';
        toast(msg, 'error');
      }
    };
    xhr.onerror = () => { pct.textContent = 'Upload failed'; toast('Unable to connect to cloud storage', 'error'); };
    xhr.send(form);
  }

  // ---------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    searchDebounce = setTimeout(() => {
      state.searchQuery = q;
      state.view = 'files';
      $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === 'files'));
      renderFiles();
    }, 300);
  });

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  refreshStorage();
  render();
})();
