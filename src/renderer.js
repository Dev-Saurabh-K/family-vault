'use strict';

/**
 * Renderer script interacting strictly through window.familyVault.
 * Context isolation prevents access to Node.js, filesystem, or database directly.
 */

// State
let currentCategory = '';
let currentExpiryFilter = '';
let currentSearch = '';
let documents = [];
let selectedDocumentId = null;
let activeDocumentRecord = null;

// DOM Elements - Views
const viewLauncher = document.getElementById('view-launcher');
const viewWorkspace = document.getElementById('view-workspace');

// Launcher
const tabUnlockBtn = document.getElementById('tab-unlock-btn');
const tabCreateBtn = document.getElementById('tab-create-btn');
const tabRestoreBtn = document.getElementById('tab-restore-btn');
const formUnlockContainer = document.getElementById('form-unlock-container');
const formCreateContainer = document.getElementById('form-create-container');
const formRestoreContainer = document.getElementById('form-restore-container');

const unlockPathInput = document.getElementById('unlock-path-input');
const unlockBrowseBtn = document.getElementById('unlock-browse-btn');
const unlockPasswordInput = document.getElementById('unlock-password-input');
const submitUnlockBtn = document.getElementById('submit-unlock-btn');

const createPathInput = document.getElementById('create-path-input');
const createBrowseBtn = document.getElementById('create-browse-btn');
const createPasswordInput = document.getElementById('create-password-input');
const createPasswordConfirmInput = document.getElementById('create-password-confirm-input');
const submitCreateBtn = document.getElementById('submit-create-btn');

const restoreFileInput = document.getElementById('restore-file-input');
const restoreFileBrowseBtn = document.getElementById('restore-file-browse-btn');
const restoreTargetInput = document.getElementById('restore-target-input');
const restoreTargetBrowseBtn = document.getElementById('restore-target-browse-btn');
const submitRestoreBtn = document.getElementById('submit-restore-btn');

// Workspace
const activeVaultName = document.getElementById('active-vault-name');
const btnLockVault = document.getElementById('btn-lock-vault');
const btnChangePasswordModal = document.getElementById('btn-change-password-modal');
const btnOpenAiQa = document.getElementById('btn-open-ai-qa');
const btnCreateBackup = document.getElementById('btn-create-backup');
const searchInput = document.getElementById('search-input');
const btnOpenImport = document.getElementById('btn-open-import');
const docGrid = document.getElementById('doc-grid');
const emptyState = document.getElementById('empty-state');
const sidebarItems = document.querySelectorAll('.sidebar-item');

// AI Modal
const modalAiQa = document.getElementById('modal-ai-qa');
const aiQueryInput = document.getElementById('ai-query-input');
const aiSubmitQueryBtn = document.getElementById('ai-submit-query-btn');
const aiLoading = document.getElementById('ai-loading');
const aiResultBox = document.getElementById('ai-result-box');
const aiAnswerText = document.getElementById('ai-answer-text');
const aiModeBadge = document.getElementById('ai-mode-badge');
const aiCitationsList = document.getElementById('ai-citations-list');

// Drawer
const drawerDetail = document.getElementById('drawer-detail');
const drawerCloseBtn = document.getElementById('drawer-close-btn');
const drawerTitle = document.getElementById('drawer-title');
const drawerCategory = document.getElementById('drawer-category');
const drawerPerson = document.getElementById('drawer-person');
const drawerVersionBadge = document.getElementById('drawer-version-badge');
const drawerExpiryDate = document.getElementById('drawer-expiry-date');
const drawerExpiryBadge = document.getElementById('drawer-expiry-badge');
const drawerSnippetContainer = document.getElementById('drawer-snippet-container');
const drawerExpirySnippet = document.getElementById('drawer-expiry-snippet');
const drawerReviewStatus = document.getElementById('drawer-review-status');
const drawerHash = document.getElementById('drawer-hash');
const drawerPreviewBox = document.getElementById('drawer-preview-box');
const drawerVersionsList = document.getElementById('drawer-versions-list');
const btnExportCurrent = document.getElementById('btn-export-current');
const btnOpenAddVersion = document.getElementById('btn-open-add-version');
const btnOpenReviewMetadata = document.getElementById('btn-open-review-metadata');

// Modals
const modalImport = document.getElementById('modal-import');
const importFilepathInput = document.getElementById('import-filepath-input');
const importBrowseBtn = document.getElementById('import-browse-btn');
const importTitleInput = document.getElementById('import-title-input');
const importCategorySelect = document.getElementById('import-category-select');
const importPersonInput = document.getElementById('import-person-input');
const importTagsInput = document.getElementById('import-tags-input');
const importNotesInput = document.getElementById('import-notes-input');
const submitImportBtn = document.getElementById('submit-import-btn');

const modalNewVersion = document.getElementById('modal-new-version');
const newVersionFilepathInput = document.getElementById('new-version-filepath-input');
const newVersionBrowseBtn = document.getElementById('new-version-browse-btn');
const newVersionNotesInput = document.getElementById('new-version-notes-input');
const submitNewVersionBtn = document.getElementById('submit-new-version-btn');

const modalReviewMetadata = document.getElementById('modal-review-metadata');
const reviewDoctypeSelect = document.getElementById('review-doctype-select');
const reviewIssuerInput = document.getElementById('review-issuer-input');
const reviewIssuedateInput = document.getElementById('review-issuedate-input');
const reviewExpirydateInput = document.getElementById('review-expirydate-input');
const reviewConfirmCheckbox = document.getElementById('review-confirm-checkbox');
const submitReviewMetadataBtn = document.getElementById('submit-review-metadata-btn');

const modalChangePassword = document.getElementById('modal-change-password');
const changePassCurrent = document.getElementById('change-pass-current');
const changePassNew = document.getElementById('change-pass-new');
const changePassConfirm = document.getElementById('change-pass-confirm');
const submitChangePasswordBtn = document.getElementById('submit-change-password-btn');

// Toast
const toast = document.getElementById('toast');

// Notification Helper
function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = type;
  setTimeout(() => {
    toast.className = 'hidden';
  }, 4000);
}

// Format byte size
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format dates
function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Initialize and check status on load
async function initApp() {
  try {
    const status = await window.familyVault.getStatus();
    if (status.isUnlocked) {
      showWorkspace(status.vaultPath);
    } else {
      showLauncher();
    }
  } catch (err) {
    showLauncher();
  }
}

function showLauncher() {
  viewLauncher.classList.remove('hidden');
  viewWorkspace.classList.add('hidden');
  drawerDetail.classList.add('hidden');
}

function showWorkspace(vaultPath) {
  viewLauncher.classList.add('hidden');
  viewWorkspace.classList.remove('hidden');
  activeVaultName.textContent = vaultPath.split(/[\\/]/).pop() || 'FamilyVault';
  loadDocuments();
}

// Tab Switching
function activateTab(tab) {
  tabUnlockBtn.classList.toggle('active', tab === 'unlock');
  tabCreateBtn.classList.toggle('active', tab === 'create');
  tabRestoreBtn.classList.toggle('active', tab === 'restore');
  formUnlockContainer.classList.toggle('hidden', tab !== 'unlock');
  formCreateContainer.classList.toggle('hidden', tab !== 'create');
  formRestoreContainer.classList.toggle('hidden', tab !== 'restore');
}

tabUnlockBtn.addEventListener('click', () => activateTab('unlock'));
tabCreateBtn.addEventListener('click', () => activateTab('create'));
tabRestoreBtn.addEventListener('click', () => activateTab('restore'));

// File / Folder Browsers
restoreFileBrowseBtn.addEventListener('click', async () => {
  const file = await window.familyVault.selectBackupFile();
  if (file) restoreFileInput.value = file;
});

restoreTargetBrowseBtn.addEventListener('click', async () => {
  const dir = await window.familyVault.selectDirectory();
  if (dir) restoreTargetInput.value = dir;
});

submitRestoreBtn.addEventListener('click', async () => {
  const backupFilePath = restoreFileInput.value.trim();
  const targetVaultPath = restoreTargetInput.value.trim();

  if (!backupFilePath) {
    showToast('Please select a backup file (.fvbackup)', 'error');
    return;
  }
  if (!targetVaultPath) {
    showToast('Please select a restore destination directory', 'error');
    return;
  }

  submitRestoreBtn.disabled = true;
  submitRestoreBtn.textContent = 'Verifying & Restoring...';

  try {
    await window.familyVault.restoreBackup({ backupFilePath, targetVaultPath });
    showToast('Vault restored successfully. Please enter your password to unlock.', 'success');
    unlockPathInput.value = targetVaultPath;
    activateTab('unlock');
  } catch (err) {
    showToast('Restore error: ' + err.message, 'error');
  } finally {
    submitRestoreBtn.disabled = false;
    submitRestoreBtn.textContent = 'Restore Encrypted Vault';
  }
});

// File / Folder Browsers
unlockBrowseBtn.addEventListener('click', async () => {
  const dir = await window.familyVault.selectDirectory();
  if (dir) unlockPathInput.value = dir;
});

createBrowseBtn.addEventListener('click', async () => {
  const dir = await window.familyVault.selectDirectory();
  if (dir) createPathInput.value = dir;
});

// Unlock Vault
submitUnlockBtn.addEventListener('click', async () => {
  const vaultPath = unlockPathInput.value.trim();
  const password = unlockPasswordInput.value;

  if (!vaultPath) {
    showToast('Please select a vault folder', 'error');
    return;
  }
  if (!password) {
    showToast('Please enter your master password', 'error');
    return;
  }

  submitUnlockBtn.disabled = true;
  submitUnlockBtn.textContent = 'Unlocking & Decrypting...';

  try {
    await window.familyVault.unlockVault({ vaultPath, password });
    unlockPasswordInput.value = '';
    showToast('Vault unlocked successfully', 'success');
    showWorkspace(vaultPath);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitUnlockBtn.disabled = false;
    submitUnlockBtn.textContent = 'Unlock Vault';
  }
});

// Create Vault
submitCreateBtn.addEventListener('click', async () => {
  const vaultPath = createPathInput.value.trim();
  const password = createPasswordInput.value;
  const confirmPassword = createPasswordConfirmInput.value;

  if (!vaultPath) {
    showToast('Please select a location for the new vault', 'error');
    return;
  }
  if (password.length < 8) {
    showToast('Password must be at least 8 characters long', 'error');
    return;
  }
  if (password !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }

  submitCreateBtn.disabled = true;
  submitCreateBtn.textContent = 'Initializing & Encrypting...';

  try {
    await window.familyVault.createVault({ vaultPath, password });
    createPasswordInput.value = '';
    createPasswordConfirmInput.value = '';
    showToast('Vault created and secured successfully', 'success');
    showWorkspace(vaultPath);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitCreateBtn.disabled = false;
    submitCreateBtn.textContent = 'Create & Secure Vault';
  }
});

// Lock Vault
btnLockVault.addEventListener('click', async () => {
  try {
    await window.familyVault.lockVault();
    showToast('Vault locked and keys cleared from memory', 'success');
    showLauncher();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Load & Filter Documents
async function loadDocuments() {
  try {
    const filters = {};
    if (currentCategory) filters.category = currentCategory;
    if (currentSearch) filters.search = currentSearch;
    if (currentExpiryFilter) filters.expiryFilter = currentExpiryFilter;

    documents = await window.familyVault.listDocuments(filters);
    renderDocuments();
    updateCounts();
  } catch (err) {
    showToast('Failed to load documents: ' + err.message, 'error');
  }
}

async function updateCounts() {
  try {
    const allDocs = await window.familyVault.listDocuments({});
    document.getElementById('count-all').textContent = allDocs.length;

    const categories = ['identity', 'insurance', 'medical', 'tax', 'property', 'other'];
    categories.forEach(cat => {
      const el = document.getElementById(`count-${cat}`);
      if (el) {
        el.textContent = allDocs.filter(d => d.category === cat).length;
      }
    });

    const upcomingCount = allDocs.filter(d => d.currentVersion?.metadata?.expiryStatus === 'expiring_soon').length;
    const expiredCount = allDocs.filter(d => d.currentVersion?.metadata?.expiryStatus === 'expired').length;

    const expiriesBadge = document.getElementById('count-expiries');
    if (expiriesBadge) expiriesBadge.textContent = upcomingCount;

    const expiredBadge = document.getElementById('count-expired');
    if (expiredBadge) expiredBadge.textContent = expiredCount;
  } catch (e) {}
}

function renderDocuments() {
  docGrid.innerHTML = '';
  if (documents.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  documents.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.addEventListener('click', () => openDocumentDrawer(doc.id));

    const vNum = doc.currentVersion ? `v${doc.currentVersion.versionNumber}` : 'v0';
    const fSize = doc.currentVersion ? formatBytes(doc.currentVersion.fileSize) : '-';

    const expiryStatus = doc.currentVersion?.metadata?.expiryStatus;
    const expiryDate = doc.currentVersion?.metadata?.expiryDate;
    let expiryBadgeHtml = '';

    if (expiryStatus === 'expired') {
      expiryBadgeHtml = `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">Expired</span>`;
    } else if (expiryStatus === 'expiring_soon') {
      expiryBadgeHtml = `<span class="badge badge-orange">Expiring Soon</span>`;
    } else if (expiryStatus === 'active') {
      expiryBadgeHtml = `<span class="badge badge-green" style="font-size: 10px;">Exp: ${expiryDate}</span>`;
    }

    card.innerHTML = `
      <div class="doc-card-header">
        <div class="doc-card-title">${escapeHtml(doc.title)}</div>
        <div style="display: flex; gap: 4px;">
          ${expiryBadgeHtml}
          <span class="badge badge-green">${vNum}</span>
        </div>
      </div>
      <div class="doc-card-meta">
        <div class="meta-row">
          <span>Category</span>
          <span class="badge badge-blue">${escapeHtml(doc.category)}</span>
        </div>
        ${doc.person ? `
          <div class="meta-row">
            <span>Person</span>
            <strong>${escapeHtml(doc.person)}</strong>
          </div>
        ` : ''}
        ${doc.tags && doc.tags.length ? `
          <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
            ${doc.tags.map(t => `<span class="badge badge-gray">${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="doc-card-footer">
        <span>${fSize}</span>
        <span>${formatDate(doc.updatedAt)}</span>
      </div>
    `;

    docGrid.appendChild(card);
  });
}

// Sidebar Category & Expiry Filter
sidebarItems.forEach(item => {
  item.addEventListener('click', () => {
    sidebarItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const cat = item.getAttribute('data-category');
    const exp = item.getAttribute('data-expiry');

    if (exp) {
      currentCategory = '';
      currentExpiryFilter = exp === 'upcoming' ? 'expiring_soon' : 'expired';
    } else {
      currentCategory = cat || '';
      currentExpiryFilter = '';
    }

    loadDocuments();
  });
});

// Search input
let searchDebounce = null;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentSearch = e.target.value.trim();
    loadDocuments();
  }, 250);
});

// Open Document Detail Drawer
async function openDocumentDrawer(documentId) {
  selectedDocumentId = documentId;
  drawerDetail.classList.remove('hidden');

  try {
    const doc = await window.familyVault.getDocument(documentId);
    if (!doc) return;
    activeDocumentRecord = doc;

    drawerTitle.textContent = doc.title;
    drawerCategory.textContent = doc.category;
    drawerPerson.textContent = doc.person || 'Not assigned';

    const currentV = doc.currentVersion;
    const versionId = (currentV && currentV.id) || doc.currentVersionId;

    if (currentV && versionId) {
      drawerVersionBadge.textContent = `v${currentV.versionNumber}`;
      drawerHash.textContent = currentV.sha256 ? `${currentV.sha256.substring(0, 16)}...` : '-';
      loadVersionPreview(versionId, currentV.mimeType, currentV.fileName, currentV.fileSize);

      // Render Metadata & Expiry details
      const meta = currentV.metadata || {};
      if (meta.expiryDate) {
        drawerExpiryDate.textContent = meta.expiryDate;
        if (meta.expiryStatus === 'expired') {
          drawerExpiryBadge.className = 'badge';
          drawerExpiryBadge.style.background = 'rgba(239, 68, 68, 0.2)';
          drawerExpiryBadge.style.color = '#f87171';
          drawerExpiryBadge.textContent = `Expired (${Math.abs(meta.daysRemaining)}d ago)`;
        } else if (meta.expiryStatus === 'expiring_soon') {
          drawerExpiryBadge.className = 'badge badge-orange';
          drawerExpiryBadge.style.background = '';
          drawerExpiryBadge.style.color = '';
          drawerExpiryBadge.textContent = `Expiring soon (in ${meta.daysRemaining}d)`;
        } else {
          drawerExpiryBadge.className = 'badge badge-green';
          drawerExpiryBadge.style.background = '';
          drawerExpiryBadge.style.color = '';
          drawerExpiryBadge.textContent = `Active (${meta.daysRemaining}d left)`;
        }
      } else {
        drawerExpiryDate.textContent = 'None';
        drawerExpiryBadge.className = 'badge badge-gray';
        drawerExpiryBadge.textContent = 'No expiry';
      }

      // Snippet / Provenance
      if (meta.expirySnippet) {
        drawerSnippetContainer.classList.remove('hidden');
        drawerExpirySnippet.textContent = `"${meta.expirySnippet}"`;
      } else {
        drawerSnippetContainer.classList.add('hidden');
      }

      // Review Status
      if (meta.reviewStatus === 'confirmed') {
        drawerReviewStatus.className = 'badge badge-green';
        drawerReviewStatus.textContent = 'Confirmed ✓';
      } else {
        drawerReviewStatus.className = 'badge badge-orange';
        drawerReviewStatus.textContent = 'Proposed (Needs Review)';
      }
    }

    renderVersionHistory(doc.versions);
  } catch (err) {
    showToast('Failed to load document details: ' + err.message, 'error');
  }
}

async function loadVersionPreview(versionId, mimeType, fileName, fileSize) {
  drawerPreviewBox.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">Decrypting in-memory preview...</div>';

  try {
    const preview = await window.familyVault.getVersionPreview(versionId);

    if (mimeType.startsWith('image/')) {
      drawerPreviewBox.innerHTML = `<img src="data:${mimeType};base64,${preview.base64Data}" alt="${escapeHtml(fileName)}" />`;
    } else {
      drawerPreviewBox.innerHTML = `
        <div class="pdf-preview-box">
          <div style="font-size: 40px;">📄</div>
          <div style="font-weight: 600; font-size: 14px;">${escapeHtml(fileName)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${formatBytes(fileSize)}</div>
          <div style="font-size: 11px; color: var(--success); margin-top: 4px;">✓ Authenticated &amp; Verified (AES-256-GCM)</div>
        </div>
      `;
    }
  } catch (err) {
    drawerPreviewBox.innerHTML = `<div style="color: #f87171; font-size: 12px; padding: 16px;">Failed to decrypt preview: ${err.message}</div>`;
  }
}

function renderVersionHistory(versions) {
  drawerVersionsList.innerHTML = '';
  if (!versions || versions.length === 0) return;

  versions.forEach(v => {
    const item = document.createElement('div');
    const isCurrent = (v.version_number === versions[0].version_number);
    item.className = `version-item ${isCurrent ? 'current-version' : ''}`;

    item.innerHTML = `
      <div class="version-header">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="badge ${isCurrent ? 'badge-green' : 'badge-gray'}">v${v.version_number}</span>
          <strong style="font-size: 13px;">${escapeHtml(v.file_name)}</strong>
        </div>
        <span style="font-size: 11px; color: var(--text-muted);">${formatDate(v.created_at)}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary);">
        ${escapeHtml(v.notes || 'No revision notes')} (${formatBytes(v.file_size)})
      </div>
      <div class="version-actions">
        <button class="btn btn-secondary btn-sm-preview" style="padding: 4px 8px; font-size: 11px;">Preview</button>
        <button class="btn btn-secondary btn-sm-export" style="padding: 4px 8px; font-size: 11px;">Export</button>
      </div>
    `;

    item.querySelector('.btn-sm-preview').addEventListener('click', () => {
      loadVersionPreview(v.id, v.mime_type, v.file_name, v.file_size);
    });

    item.querySelector('.btn-sm-export').addEventListener('click', async () => {
      await exportVersion(v.id, v.file_name);
    });

    drawerVersionsList.appendChild(item);
  });
}

// Drawer close
drawerCloseBtn.addEventListener('click', () => {
  drawerDetail.classList.add('hidden');
  selectedDocumentId = null;
  activeDocumentRecord = null;
});

// Export document version
async function exportVersion(versionId, defaultName) {
  try {
    const destinationPath = await window.familyVault.saveFileDialog({ defaultName });
    if (!destinationPath) return;

    await window.familyVault.exportVersion({ versionId, destinationPath });
    showToast(`Decrypted copy saved to ${destinationPath}`, 'success');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}

btnExportCurrent.addEventListener('click', async () => {
  if (!selectedDocumentId || !activeDocumentRecord) return;
  const doc = activeDocumentRecord;
  if (doc && doc.currentVersion) {
    await exportVersion(doc.currentVersion.id, doc.currentVersion.fileName);
  }
});

// Import Document Modal
btnOpenImport.addEventListener('click', () => {
  importFilepathInput.value = '';
  importTitleInput.value = '';
  importPersonInput.value = '';
  importTagsInput.value = '';
  importNotesInput.value = '';
  modalImport.classList.remove('hidden');
});

importBrowseBtn.addEventListener('click', async () => {
  const filePath = await window.familyVault.selectFile();
  if (filePath) {
    importFilepathInput.value = filePath;
    if (!importTitleInput.value.trim()) {
      const fileName = filePath.split(/[\\/]/).pop() || '';
      importTitleInput.value = fileName.replace(/\.[^/.]+$/, '');
    }
  }
});

submitImportBtn.addEventListener('click', async () => {
  const filePath = importFilepathInput.value.trim();
  const title = importTitleInput.value.trim();
  const category = importCategorySelect.value;
  const person = importPersonInput.value.trim() || null;
  const tags = importTagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
  const notes = importNotesInput.value.trim();

  if (!filePath) {
    showToast('Please select a file to import', 'error');
    return;
  }

  submitImportBtn.disabled = true;
  submitImportBtn.textContent = 'Encrypting & Analyzing...';

  try {
    await window.familyVault.importDocument({
      filePath,
      title,
      category,
      person,
      tags,
      notes
    });

    modalImport.classList.add('hidden');
    showToast('Document encrypted and analyzed in vault', 'success');
    loadDocuments();
  } catch (err) {
    showToast('Import error: ' + err.message, 'error');
  } finally {
    submitImportBtn.disabled = false;
    submitImportBtn.textContent = 'Encrypt & Save';
  }
});

// Upload New Version Modal
btnOpenAddVersion.addEventListener('click', () => {
  newVersionFilepathInput.value = '';
  newVersionNotesInput.value = '';
  modalNewVersion.classList.remove('hidden');
});

newVersionBrowseBtn.addEventListener('click', async () => {
  const filePath = await window.familyVault.selectFile();
  if (filePath) {
    newVersionFilepathInput.value = filePath;
  }
});

submitNewVersionBtn.addEventListener('click', async () => {
  const filePath = newVersionFilepathInput.value.trim();
  const notes = newVersionNotesInput.value.trim();

  if (!filePath) {
    showToast('Please select an updated document file', 'error');
    return;
  }
  if (!selectedDocumentId) return;

  submitNewVersionBtn.disabled = true;
  submitNewVersionBtn.textContent = 'Encrypting Version...';

  try {
    await window.familyVault.addDocumentVersion({
      documentId: selectedDocumentId,
      filePath,
      notes
    });

    modalNewVersion.classList.add('hidden');
    showToast('New version added; previous versions preserved', 'success');
    loadDocuments();
    openDocumentDrawer(selectedDocumentId);
  } catch (err) {
    showToast('Add version error: ' + err.message, 'error');
  } finally {
    submitNewVersionBtn.disabled = false;
    submitNewVersionBtn.textContent = 'Save New Version';
  }
});

// Review & Confirm Metadata Modal
btnOpenReviewMetadata.addEventListener('click', () => {
  if (!activeDocumentRecord || !activeDocumentRecord.currentVersion) return;
  const meta = activeDocumentRecord.currentVersion.metadata || {};

  reviewDoctypeSelect.value = meta.docType || 'other';
  reviewIssuerInput.value = meta.issuer || '';
  reviewIssuedateInput.value = meta.issueDate || '';
  reviewExpirydateInput.value = meta.expiryDate || '';
  reviewConfirmCheckbox.checked = true;

  modalReviewMetadata.classList.remove('hidden');
});

submitReviewMetadataBtn.addEventListener('click', async () => {
  if (!activeDocumentRecord || !activeDocumentRecord.currentVersion) return;
  const versionId = activeDocumentRecord.currentVersion.id;

  const docType = reviewDoctypeSelect.value;
  const issuer = reviewIssuerInput.value.trim() || null;
  const issueDate = reviewIssuedateInput.value || null;
  const expiryDate = reviewExpirydateInput.value || null;
  const reviewStatus = reviewConfirmCheckbox.checked ? 'confirmed' : 'modified';

  submitReviewMetadataBtn.disabled = true;
  submitReviewMetadataBtn.textContent = 'Saving...';

  try {
    await window.familyVault.updateMetadata({
      versionId,
      docType,
      issuer,
      issueDate,
      expiryDate,
      reviewStatus
    });

    modalReviewMetadata.classList.add('hidden');
    showToast('Metadata updated and confirmed', 'success');
    loadDocuments();
    openDocumentDrawer(selectedDocumentId);
  } catch (err) {
    showToast('Metadata update error: ' + err.message, 'error');
  } finally {
    submitReviewMetadataBtn.disabled = false;
    submitReviewMetadataBtn.textContent = 'Save & Confirm';
  }
});

// Change Password Modal
btnChangePasswordModal.addEventListener('click', () => {
  changePassCurrent.value = '';
  changePassNew.value = '';
  changePassConfirm.value = '';
  modalChangePassword.classList.remove('hidden');
});

submitChangePasswordBtn.addEventListener('click', async () => {
  const oldPassword = changePassCurrent.value;
  const newPassword = changePassNew.value;
  const confirmPassword = changePassConfirm.value;

  if (!oldPassword) {
    showToast('Please enter your current password', 'error');
    return;
  }
  if (newPassword.length < 8) {
    showToast('New password must be at least 8 characters long', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match', 'error');
    return;
  }

  submitChangePasswordBtn.disabled = true;
  submitChangePasswordBtn.textContent = 'Rewrapping Master Key...';

  try {
    await window.familyVault.changePassword({ oldPassword, newPassword });
    modalChangePassword.classList.add('hidden');
    showToast('Master password updated successfully', 'success');
  } catch (err) {
    showToast('Password change error: ' + err.message, 'error');
  } finally {
    submitChangePasswordBtn.disabled = false;
    submitChangePasswordBtn.textContent = 'Update Password';
  }
});

// Create Portable Encrypted Backup
btnCreateBackup.addEventListener('click', async () => {
  try {
    const vaultBase = activeVaultName.textContent.replace(/\.vault$/, '');
    const defaultName = `${vaultBase}-backup-${new Date().toISOString().substring(0, 10)}.fvbackup`;
    const destinationFilePath = await window.familyVault.saveBackupFileDialog({ defaultName });
    if (!destinationFilePath) return;

    btnCreateBackup.disabled = true;
    btnCreateBackup.textContent = 'Backing up...';

    const res = await window.familyVault.createBackup(destinationFilePath);
    showToast(`Encrypted backup created successfully (${res.objectCount} documents saved)`, 'success');
  } catch (err) {
    showToast('Backup failed: ' + err.message, 'error');
  } finally {
    btnCreateBackup.disabled = false;
    btnCreateBackup.textContent = 'Backup Vault 💾';
  }
});

// Grounded Local AI Document Assistant
btnOpenAiQa.addEventListener('click', () => {
  aiQueryInput.value = '';
  aiResultBox.classList.add('hidden');
  aiLoading.classList.add('hidden');
  modalAiQa.classList.remove('hidden');
  aiQueryInput.focus();
});

async function runAiQuery() {
  const query = aiQueryInput.value.trim();
  if (!query) return;

  aiLoading.classList.remove('hidden');
  aiResultBox.classList.add('hidden');
  aiSubmitQueryBtn.disabled = true;
  aiSubmitQueryBtn.textContent = 'Searching...';

  try {
    const res = await window.familyVault.askQuestion(query);
    aiLoading.classList.add('hidden');
    aiResultBox.classList.remove('hidden');
    aiAnswerText.textContent = res.answer;
    aiModeBadge.textContent = res.mode === 'llama-server' ? 'Local Qwen3 GGUF' : 'Local Extractive Assistant';

    aiCitationsList.innerHTML = '';
    if (res.sources && res.sources.length > 0) {
      document.getElementById('ai-citations-container').classList.remove('hidden');
      res.sources.forEach(src => {
        const item = document.createElement('div');
        item.style.cssText = 'background: rgba(30, 41, 59, 0.5); padding: 8px 12px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px; cursor: pointer;';
        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <strong style="color: #60a5fa;">📄 ${escapeHtml(src.documentTitle)}</strong>
            <span style="font-size: 10px; color: var(--text-muted);">${escapeHtml(src.fileName)}</span>
          </div>
          <div style="font-style: italic; color: #cbd5e1;">"${escapeHtml(src.snippet)}"</div>
        `;
        item.addEventListener('click', () => {
          modalAiQa.classList.add('hidden');
          openDocumentDrawer(src.documentId);
        });
        aiCitationsList.appendChild(item);
      });
    } else {
      document.getElementById('ai-citations-container').classList.add('hidden');
    }
  } catch (err) {
    aiLoading.classList.add('hidden');
    showToast('Assistant error: ' + err.message, 'error');
  } finally {
    aiSubmitQueryBtn.disabled = false;
    aiSubmitQueryBtn.textContent = 'Ask';
  }
}

aiSubmitQueryBtn.addEventListener('click', runAiQuery);
aiQueryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runAiQuery();
});

// Modal close button handlers
document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    modalImport.classList.add('hidden');
    modalNewVersion.classList.add('hidden');
    modalReviewMetadata.classList.add('hidden');
    modalAiQa.classList.add('hidden');
    modalChangePassword.classList.add('hidden');
  });
});

// Utility to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start app
initApp();
