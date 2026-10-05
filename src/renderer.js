'use strict';

/**
 * Renderer script interacting strictly through window.familyVault.
 * Context isolation prevents access to Node.js, filesystem, or database directly.
 */

// State
let currentCategory = '';
let currentExpiryFilter = '';
let currentSearch = '';
let currentTag = '';
let bannerDismissedThisSession = false;
let documents = [];
let selectedDocumentId = null;
let activeDocumentRecord = null;
let documentIdPendingDelete = null;
let preAnalyzedDocData = null;
let importAnalysisRequestId = 0;
let isImportAnalysisInProgress = false;

// DOM Elements - Views
const viewLauncher = document.getElementById('view-launcher');
const viewWorkspace = document.getElementById('view-workspace');
const btnLauncherClose = document.getElementById('btn-launcher-close');

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
const btnWindowMinimize = document.getElementById('btn-window-minimize');
const btnWindowMaximize = document.getElementById('btn-window-maximize');
const btnWindowClose = document.getElementById('btn-window-close');
const btnLockVault = document.getElementById('btn-lock-vault');
const btnChangePasswordModal = document.getElementById('btn-change-password-modal');
const btnOpenAiQa = document.getElementById('btn-open-ai-qa');
const btnCreateBackup = document.getElementById('btn-create-backup');
const searchInput = document.getElementById('search-input');
const searchModeKeywordBtn = document.getElementById('search-mode-keyword');
const searchModeSemanticBtn = document.getElementById('search-mode-semantic');
let searchMode = 'keyword'; // 'keyword' | 'semantic'
const btnOpenImport = document.getElementById('btn-open-import');
const docGrid = document.getElementById('doc-grid');
const emptyState = document.getElementById('empty-state');
const sidebarItems = document.querySelectorAll('.sidebar-item');

// Expiry Alert Banner & Tag Filter Bar
const expiryAlertBanner = document.getElementById('expiry-alert-banner');
const expiryAlertTitle = document.getElementById('expiry-alert-title');
const expiryAlertSubtitle = document.getElementById('expiry-alert-subtitle');
const btnBannerViewExpiries = document.getElementById('btn-banner-view-expiries');
const btnBannerDismiss = document.getElementById('btn-banner-dismiss');
const activeTagFilterBar = document.getElementById('active-tag-filter-bar');
const activeTagBadge = document.getElementById('active-tag-badge');
const activeTagText = document.getElementById('active-tag-text');
const btnClearTagFilter = document.getElementById('btn-clear-tag-filter');

// AI Modal
const modalAiQa = document.getElementById('modal-ai-qa');
const aiChatThread = document.getElementById('ai-chat-thread');
const aiThreadWelcome = document.getElementById('ai-thread-welcome');
const btnClearAiHistory = document.getElementById('btn-clear-ai-history');
const aiQueryInput = document.getElementById('ai-query-input');
const aiSubmitQueryBtn = document.getElementById('ai-submit-query-btn');
const btnReturnToChat = document.getElementById('btn-return-to-chat');
const btnOpenModelSetup = document.getElementById('btn-open-model-setup');
const aiQuickSetupBox = document.getElementById('ai-quick-setup-box');
const btnDownloadSetupGemma = document.getElementById('btn-download-setup-gemma');
const aiDownloadProgressContainer = document.getElementById('ai-download-progress-container');
const aiDownloadStatusText = document.getElementById('ai-download-status-text');
const aiDownloadPercentText = document.getElementById('ai-download-percent-text');
const aiDownloadProgressBar = document.getElementById('ai-download-progress-bar');

// Topbar AI Download Button & Modal Elements
const btnTopbarDownloadModel = document.getElementById('btn-topbar-download-model');
const btnTopbarDownloadIcon = document.getElementById('btn-topbar-download-icon');
const btnTopbarDownloadText = document.getElementById('btn-topbar-download-text');
const modalDownloadModel = document.getElementById('modal-download-model');
const modelModalStatusBadge = document.getElementById('model-modal-status-badge');
const modelModalBytesText = document.getElementById('model-modal-bytes-text');
const modelModalStatusText = document.getElementById('model-modal-status-text');
const modelModalProgressBar = document.getElementById('model-modal-progress-bar');
const modelModalStageText = document.getElementById('model-modal-stage-text');
const modelModalPercentText = document.getElementById('model-modal-percent-text');
const btnModalStartDownload = document.getElementById('btn-modal-start-download');

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

// Inline Document Metadata Editing
const drawerDocTitleDisplay = document.getElementById('drawer-doc-title-display');
const drawerDocTitleInput = document.getElementById('drawer-doc-title-input');
const btnEditTitle = document.getElementById('btn-edit-title');

const drawerCategorySelect = document.getElementById('drawer-category-select');
const btnEditCategory = document.getElementById('btn-edit-category');

const drawerPersonInput = document.getElementById('drawer-person-input');
const btnEditPerson = document.getElementById('btn-edit-person');

const drawerTagsDisplay = document.getElementById('drawer-tags-display');
const drawerTagsInput = document.getElementById('drawer-tags-input');
const btnEditTags = document.getElementById('btn-edit-tags');

const drawerNotesDisplay = document.getElementById('drawer-notes-display');
const drawerNotesInput = document.getElementById('drawer-notes-input');
const btnEditNotes = document.getElementById('btn-edit-notes');

const drawerEditActions = document.getElementById('drawer-edit-actions');
const btnSaveDocMetadata = document.getElementById('btn-save-doc-metadata');
const btnCancelDocMetadata = document.getElementById('btn-cancel-doc-metadata');

// Document Deletion
const btnDeleteDocument = document.getElementById('btn-delete-document');
const btnDeleteDocumentHeader = document.getElementById('btn-delete-document-header');
const modalConfirmDelete = document.getElementById('modal-confirm-delete');
const deleteDocNameConfirm = document.getElementById('delete-doc-name-confirm');
const btnConfirmDeleteAction = document.getElementById('btn-confirm-delete-action');

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
const importAnalysisLoader = document.getElementById('import-analysis-loader');
const importAnalysisStatusText = document.getElementById('import-analysis-status-text');
const importAnalysisBadge = document.getElementById('import-analysis-badge');
const importAnalysisProgressBar = document.getElementById('import-analysis-progress-bar');
const importAnalysisBanner = document.getElementById('import-analysis-banner');
const importAnalysisBannerDetails = document.getElementById('import-analysis-banner-details');
const familyMembersDatalist = document.getElementById('family-members-datalist');

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

// Inline Form Error & Warning Helpers
function showInlineError(bannerElOrId, message) {
  const el = typeof bannerElOrId === 'string' ? document.getElementById(bannerElOrId) : bannerElOrId;
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearInlineError(bannerElOrId) {
  const el = typeof bannerElOrId === 'string' ? document.getElementById(bannerElOrId) : bannerElOrId;
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function showInlineWarning(bannerElOrId, message) {
  const el = typeof bannerElOrId === 'string' ? document.getElementById(bannerElOrId) : bannerElOrId;
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearInlineWarning(bannerElOrId) {
  const el = typeof bannerElOrId === 'string' ? document.getElementById(bannerElOrId) : bannerElOrId;
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
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
  checkAiModelStatus();
  checkFirstRunOnboarding(vaultPath);
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
  clearInlineError('restore-error-banner');
  const backupFilePath = restoreFileInput.value.trim();
  const targetVaultPath = restoreTargetInput.value.trim();

  if (!backupFilePath) {
    showInlineError('restore-error-banner', 'Please select a backup file (.fvbackup).');
    showToast('Please select a backup file (.fvbackup)', 'error');
    return;
  }
  if (!targetVaultPath) {
    showInlineError('restore-error-banner', 'Please select a restore destination directory.');
    showToast('Please select a restore destination directory', 'error');
    return;
  }

  submitRestoreBtn.disabled = true;
  submitRestoreBtn.textContent = 'Verifying & Restoring...';

  try {
    await window.familyVault.restoreBackup({ backupFilePath, targetVaultPath });
    clearInlineError('restore-error-banner');
    showToast('Vault restored successfully. Please enter your password to unlock.', 'success');
    unlockPathInput.value = targetVaultPath;
    activateTab('unlock');
  } catch (err) {
    showInlineError('restore-error-banner', 'Restore error: ' + err.message);
    showToast('Restore error: ' + err.message, 'error');
  } finally {
    submitRestoreBtn.disabled = false;
    submitRestoreBtn.textContent = 'Restore Encrypted Vault';
  }
});

restoreFileInput.addEventListener('input', () => clearInlineError('restore-error-banner'));
restoreTargetInput.addEventListener('input', () => clearInlineError('restore-error-banner'));

// File / Folder Browsers
unlockBrowseBtn.addEventListener('click', async () => {
  const dir = await window.familyVault.selectDirectory();
  if (dir) {
    unlockPathInput.value = dir;
    clearInlineError('unlock-error-banner');
  }
});

createBrowseBtn.addEventListener('click', async () => {
  const dir = await window.familyVault.selectDirectory();
  if (dir) {
    createPathInput.value = dir;
    clearInlineError('create-error-banner');
  }
});

// Unlock Vault
submitUnlockBtn.addEventListener('click', async () => {
  clearInlineError('unlock-error-banner');
  const vaultPath = unlockPathInput.value.trim();
  const password = unlockPasswordInput.value;

  if (!vaultPath) {
    showInlineError('unlock-error-banner', 'Please select a vault folder.');
    showToast('Please select a vault folder', 'error');
    return;
  }
  if (!password) {
    showInlineError('unlock-error-banner', 'Please enter your master password.');
    showToast('Please enter your master password', 'error');
    return;
  }

  submitUnlockBtn.disabled = true;
  submitUnlockBtn.textContent = 'Unlocking & Decrypting...';

  try {
    await window.familyVault.unlockVault({ vaultPath, password });
    unlockPasswordInput.value = '';
    clearInlineError('unlock-error-banner');
    showToast('Vault unlocked successfully', 'success');
    showWorkspace(vaultPath);
  } catch (err) {
    showInlineError('unlock-error-banner', err.message || 'Failed to unlock vault. Incorrect password or corrupt vault metadata.');
    showToast(err.message, 'error');
  } finally {
    submitUnlockBtn.disabled = false;
    submitUnlockBtn.textContent = 'Unlock Vault';
  }
});

unlockPasswordInput.addEventListener('input', () => clearInlineError('unlock-error-banner'));
unlockPathInput.addEventListener('input', () => clearInlineError('unlock-error-banner'));

// Create Vault
submitCreateBtn.addEventListener('click', async () => {
  clearInlineError('create-error-banner');
  const vaultPath = createPathInput.value.trim();
  const password = createPasswordInput.value;
  const confirmPassword = createPasswordConfirmInput.value;

  if (!vaultPath) {
    showInlineError('create-error-banner', 'Please select a location for the new vault.');
    showToast('Please select a location for the new vault', 'error');
    return;
  }
  if (password.length < 8) {
    showInlineError('create-error-banner', 'Password must be at least 8 characters long.');
    showToast('Password must be at least 8 characters long', 'error');
    return;
  }
  if (password !== confirmPassword) {
    showInlineError('create-error-banner', 'Passwords do not match. Please verify both fields.');
    showToast('Passwords do not match', 'error');
    return;
  }

  submitCreateBtn.disabled = true;
  submitCreateBtn.textContent = 'Initializing & Encrypting...';

  try {
    await window.familyVault.createVault({ vaultPath, password });
    createPasswordInput.value = '';
    createPasswordConfirmInput.value = '';
    clearInlineError('create-error-banner');
    showToast('Vault created and secured successfully', 'success');
    showWorkspace(vaultPath);
  } catch (err) {
    showInlineError('create-error-banner', err.message || 'Failed to initialize vault.');
    showToast(err.message, 'error');
  } finally {
    submitCreateBtn.disabled = false;
    submitCreateBtn.textContent = 'Create & Secure Vault';
  }
});

createPasswordInput.addEventListener('input', () => clearInlineError('create-error-banner'));
createPasswordConfirmInput.addEventListener('input', () => clearInlineError('create-error-banner'));
createPathInput.addEventListener('input', () => clearInlineError('create-error-banner'));

// Window controls
btnWindowMinimize.addEventListener('click', () => {
  window.familyVault.windowControls.minimize();
});

btnWindowMaximize.addEventListener('click', () => {
  window.familyVault.windowControls.maximize();
});

btnWindowClose.addEventListener('click', () => {
  window.familyVault.windowControls.close();
});

btnLauncherClose.addEventListener('click', () => {
  window.familyVault.windowControls.close();
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

// Tag Filter Bar Helper
function updateTagBar() {
  if (activeTagFilterBar && activeTagText) {
    if (currentTag) {
      activeTagText.textContent = currentTag;
      activeTagFilterBar.classList.remove('hidden');
    } else {
      activeTagFilterBar.classList.add('hidden');
    }
  }
}

// Load & Filter Documents
async function loadDocuments() {
  try {
    if (searchMode === 'semantic' && currentSearch && !currentExpiryFilter) {
      try {
        const semanticMatches = await window.familyVault.searchSemantic({ query: currentSearch, limit: 15 });
        if (semanticMatches && semanticMatches.length > 0) {
          const docMap = new Map();
          for (const m of semanticMatches) {
            if (!docMap.has(m.documentId)) {
              const doc = await window.familyVault.getDocument(m.documentId);
              if (doc) {
                doc._semanticScore = Math.round(m.similarity * 100);
                doc._semanticSnippet = m.chunkText;
                docMap.set(m.documentId, doc);
              }
            }
          }
          let results = Array.from(docMap.values());
          if (currentTag) {
            results = results.filter(d => Array.isArray(d.tags) && d.tags.includes(currentTag));
          }
          documents = results;
        } else {
          documents = [];
        }
        renderDocuments();
        updateCounts();
        updateTagBar();
        return;
      } catch (semErr) {
        console.warn('Semantic search unavailable or failed; falling back to keyword search:', semErr);
        showToast('Semantic search failed; switched to keyword search fallback.', 'warning');
      }
    }

    const filters = {};
    if (currentCategory) filters.category = currentCategory;
    if (currentSearch) filters.search = currentSearch;
    if (currentExpiryFilter) filters.expiryFilter = currentExpiryFilter;

    let docs = await window.familyVault.listDocuments(filters);
    const filterPersonSelect = document.getElementById('filter-person-select');
    if (filterPersonSelect && filterPersonSelect.value) {
      docs = docs.filter(d => d.person === filterPersonSelect.value);
    }
    if (currentTag) {
      docs = docs.filter(d => Array.isArray(d.tags) && d.tags.includes(currentTag));
    }
    documents = docs;
    renderDocuments();
    updateCounts();
    updateTagBar();
  } catch (err) {
    showToast('Failed to load documents: ' + err.message, 'error');
  }
}

async function updateCounts() {
  try {
    const allDocs = await window.familyVault.listDocuments({});
    document.getElementById('count-all').textContent = allDocs.length;

    // Update Family Member dropdown dynamically
    const filterPersonSelect = document.getElementById('filter-person-select');
    if (filterPersonSelect) {
      const currentSelected = filterPersonSelect.value;
      let persons = [];
      try {
        persons = await window.familyVault.listFamilyMembers();
      } catch (e) {
        persons = [...new Set(allDocs.map(d => d.person).filter(Boolean))].sort();
      }
      filterPersonSelect.innerHTML = '<option value="">👤 All Family Members</option>';
      (persons || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = `👤 ${p}`;
        if (p === currentSelected) opt.selected = true;
        filterPersonSelect.appendChild(opt);
      });
    }

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

    // Update Expiry Alert Banner
    if (expiryAlertBanner) {
      if (!bannerDismissedThisSession && (upcomingCount > 0 || expiredCount > 0)) {
        expiryAlertBanner.classList.remove('hidden');
        if (expiredCount > 0 && upcomingCount > 0) {
          if (expiryAlertTitle) expiryAlertTitle.textContent = `${expiredCount} expired and ${upcomingCount} upcoming expiries`;
          if (expiryAlertSubtitle) expiryAlertSubtitle.textContent = 'Some critical family documents have expired or are nearing their renewal deadline.';
        } else if (expiredCount > 0) {
          if (expiryAlertTitle) expiryAlertTitle.textContent = `${expiredCount} document(s) have expired`;
          if (expiryAlertSubtitle) expiryAlertSubtitle.textContent = 'Please review expired documents to update renewal records or upload current versions.';
        } else {
          if (expiryAlertTitle) expiryAlertTitle.textContent = `${upcomingCount} document(s) expire within 30 days`;
          if (expiryAlertSubtitle) expiryAlertSubtitle.textContent = 'Check your documents soon to prevent lapses in policies or certifications.';
        }
      } else {
        expiryAlertBanner.classList.add('hidden');
      }
    }

    // Update Users & Profiles Count Badge & Sidebar Members List
    try {
      const usersList = await window.familyVault.listUserProfiles();
      const countUsersBadge = document.getElementById('count-users');
      if (countUsersBadge) {
        countUsersBadge.textContent = usersList.length;
      }
      renderSidebarFamilyMembers(usersList);
    } catch (e) {}
  } catch (e) {}
}

const AVATAR_COLORS = [
  'linear-gradient(135deg, #3b82f6, #1d4ed8)', // Blue
  'linear-gradient(135deg, #10b981, #047857)', // Green
  'linear-gradient(135deg, #8b5cf6, #6d28d9)', // Purple
  'linear-gradient(135deg, #ec4899, #be185d)', // Pink
  'linear-gradient(135deg, #f59e0b, #b45309)', // Amber
  'linear-gradient(135deg, #06b6d4, #0e7490)', // Cyan
  'linear-gradient(135deg, #6366f1, #4338ca)', // Indigo
  'linear-gradient(135deg, #14b8a6, #0f766e)'  // Teal
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderSidebarFamilyMembers(profiles) {
  const sidebarFamilyMembersList = document.getElementById('sidebar-family-members-list');
  if (!sidebarFamilyMembersList) return;

  sidebarFamilyMembersList.innerHTML = '';

  if (!profiles || profiles.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'sidebar-empty-members';
    emptyLi.innerHTML = `
      <span>No family members yet</span>
      <button type="button" class="btn btn-sidebar-add" id="btn-sidebar-add-first-member" style="font-size: 11px; padding: 4px 10px; cursor: pointer; justify-content: center;">
        + Add Member
      </button>
    `;
    const addFirstBtn = emptyLi.querySelector('#btn-sidebar-add-first-member');
    if (addFirstBtn) {
      addFirstBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuickAddMemberModal();
      });
    }
    sidebarFamilyMembersList.appendChild(emptyLi);
    return;
  }

  const filterPersonSelect = document.getElementById('filter-person-select');
  const currentSelectedPerson = filterPersonSelect ? (filterPersonSelect.value || '').trim().toLowerCase() : '';

  profiles.forEach(profile => {
    const li = document.createElement('li');
    li.className = 'sidebar-member-item';
    li.setAttribute('data-person', profile.name);
    if (currentSelectedPerson && currentSelectedPerson === profile.name.trim().toLowerCase()) {
      li.classList.add('active');
    }

    const conflictBadge = profile.hasContradictions
      ? `<span class="badge" title="${profile.contradictionCount} Discrepancies" style="background: rgba(239, 68, 68, 0.2); color: #f87171; font-size: 9px; padding: 1px 4px; border: 1px solid rgba(239, 68, 68, 0.35);">⚠️</span>`
      : '';

    const avatarColor = getAvatarColor(profile.name);
    const initials = getInitials(profile.name);

    li.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
        <div class="member-avatar" style="background: ${avatarColor};">${escapeHtml(initials)}</div>
        <span class="member-name" title="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</span>
      </div>
      <div class="member-badges">
        ${conflictBadge}
        <span class="badge badge-gray" style="font-size: 10px; padding: 1px 5px;">${profile.documentsCount || 0}</span>
        <button type="button" class="btn-member-profile" title="View Full Profile">ℹ️</button>
      </div>
    `;

    // Clicking the item filters documents by this person
    li.addEventListener('click', () => {
      const isAlreadyActive = li.classList.contains('active');
      const allCategoryItems = document.querySelectorAll('.sidebar-item');
      allCategoryItems.forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.sidebar-member-item').forEach(i => i.classList.remove('active'));

      if (isAlreadyActive) {
        // Toggle off: back to All Documents
        if (filterPersonSelect) filterPersonSelect.value = '';
        const allDocsItem = document.querySelector('.sidebar-item[data-category=""]');
        if (allDocsItem) allDocsItem.classList.add('active');
      } else {
        // Select this person
        li.classList.add('active');
        if (filterPersonSelect) filterPersonSelect.value = profile.name;
      }
      loadDocuments();
    });

    // Clicking the profile info button opens full profile modal
    const profileBtn = li.querySelector('.btn-member-profile');
    if (profileBtn) {
      profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modalUsersProfiles = document.getElementById('modal-users-profiles');
        if (modalUsersProfiles) {
          modalUsersProfiles.classList.remove('hidden');
          refreshUserProfilesUI(profile.name);
        }
      });
    }

    sidebarFamilyMembersList.appendChild(li);
  });
}

function renderDocuments() {
  docGrid.innerHTML = '';
  if (documents.length === 0) {
    emptyState.classList.remove('hidden');
    const emptyTitle = document.getElementById('empty-state-title');
    const emptyDesc = document.getElementById('empty-state-desc');
    const emptyIcon = document.getElementById('empty-state-icon');
    const resetBtn = document.getElementById('btn-empty-reset');

    const filterPersonSelect = document.getElementById('filter-person-select');
    const selectedPerson = filterPersonSelect ? filterPersonSelect.value : '';

    if (currentSearch) {
      if (emptyIcon) emptyIcon.textContent = '🔍';
      if (emptyTitle) emptyTitle.textContent = 'No matching documents found';
      if (emptyDesc) emptyDesc.textContent = `No documents found matching "${escapeHtml(currentSearch)}". Check your query or reset filters.`;
      if (resetBtn) resetBtn.classList.remove('hidden');
    } else if (selectedPerson) {
      if (emptyIcon) emptyIcon.textContent = '👤';
      if (emptyTitle) emptyTitle.textContent = `No documents for ${selectedPerson}`;
      if (emptyDesc) emptyDesc.textContent = `No documents in the vault are associated with ${escapeHtml(selectedPerson)} yet.`;
      if (resetBtn) resetBtn.classList.remove('hidden');
    } else if (currentCategory) {
      const catCapitalized = currentCategory.charAt(0).toUpperCase() + currentCategory.slice(1);
      if (emptyIcon) emptyIcon.textContent = '📁';
      if (emptyTitle) emptyTitle.textContent = `No documents in ${catCapitalized}`;
      if (emptyDesc) emptyDesc.textContent = `There are no documents filed under this category yet.`;
      if (resetBtn) resetBtn.classList.remove('hidden');
    } else if (currentExpiryFilter) {
      if (emptyIcon) emptyIcon.textContent = '⏳';
      if (emptyTitle) emptyTitle.textContent = currentExpiryFilter === 'expired' ? 'No expired documents' : 'No upcoming expiries';
      if (emptyDesc) emptyDesc.textContent = currentExpiryFilter === 'expired' ? 'None of your vault documents are expired.' : 'No documents in your vault expire within the next 30 days.';
      if (resetBtn) resetBtn.classList.remove('hidden');
    } else if (currentTag) {
      if (emptyIcon) emptyIcon.textContent = '🏷️';
      if (emptyTitle) emptyTitle.textContent = `No documents tagged "${currentTag}"`;
      if (emptyDesc) emptyDesc.textContent = 'Try clearing the tag filter or adding this tag to documents.';
      if (resetBtn) resetBtn.classList.remove('hidden');
    } else {
      if (emptyIcon) emptyIcon.textContent = '📂';
      if (emptyTitle) emptyTitle.textContent = 'Your Vault is Empty';
      if (emptyDesc) emptyDesc.textContent = 'Get started by importing your first family document or adding a family member.';
      if (resetBtn) resetBtn.classList.add('hidden');
    }
    return;
  }
  emptyState.classList.add('hidden');

  const categoryLabels = {
    identity: 'Identity & Passports',
    insurance: 'Insurance',
    medical: 'Medical Records',
    tax: 'Tax & Finance',
    property: 'Property & Legal',
    other: 'Other'
  };
  const categoryOrder = ['identity', 'insurance', 'medical', 'tax', 'property', 'other'];
  const documentGroups = new Map();
  documents.forEach(doc => {
    const category = String(doc.category || 'other').trim().toLowerCase() || 'other';
    if (!documentGroups.has(category)) documentGroups.set(category, []);
    documentGroups.get(category).push(doc);
  });

  const sortedCategories = [...documentGroups.keys()].sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a);
    const bIndex = categoryOrder.indexOf(b);
    if (aIndex >= 0 || bIndex >= 0) {
      return (aIndex < 0 ? categoryOrder.length : aIndex) - (bIndex < 0 ? categoryOrder.length : bIndex);
    }
    return a.localeCompare(b);
  });

  sortedCategories.forEach(category => {
    const categoryDocs = documentGroups.get(category);
    const categorySection = document.createElement('section');
    categorySection.className = 'doc-category-section';

    const categoryHeading = document.createElement('div');
    categoryHeading.className = 'doc-category-heading';
    const categoryLabel = categoryLabels[category] || category.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    categoryHeading.innerHTML = `<h2>${escapeHtml(categoryLabel)}</h2><span>${categoryDocs.length} ${categoryDocs.length === 1 ? 'document' : 'documents'}</span>`;

    const categoryGrid = document.createElement('div');
    categoryGrid.className = 'doc-category-grid';
    categorySection.append(categoryHeading, categoryGrid);
    docGrid.appendChild(categorySection);

    categoryDocs.forEach(doc => {
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

    const semanticBadgeHtml = doc._semanticScore != null 
      ? `<span class="badge" style="background: rgba(16, 163, 127, 0.12); color: #8dd8c3; border: 1px solid rgba(16, 163, 127, 0.25);">${doc._semanticScore}% match</span>`
      : '';
    const semanticSnippetHtml = doc._semanticSnippet
      ? `<div class="doc-card-snippet">"${escapeHtml(doc._semanticSnippet.length > 110 ? doc._semanticSnippet.substring(0, 110) + '...' : doc._semanticSnippet)}"</div>`
      : '';

    card.innerHTML = `
      <div class="doc-card-header">
        <div class="doc-card-title" title="${escapeHtml(doc.title)}">${escapeHtml(doc.title)}</div>
        <div class="doc-card-actions">
          ${semanticBadgeHtml}
          ${expiryBadgeHtml}
          <span class="badge badge-green">${vNum}</span>
          <button type="button" class="btn-card-delete" data-doc-id="${escapeHtml(doc.id)}" data-doc-title="${escapeHtml(doc.title)}" aria-label="Delete document"></button>
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
            <strong class="doc-card-person" title="${escapeHtml(doc.person)}">${escapeHtml(doc.person)}</strong>
          </div>
        ` : ''}
        ${doc.tags && doc.tags.length ? `
          <div class="doc-card-tags">
            ${doc.tags.map(t => `<span class="badge badge-gray doc-tag-badge" data-tag="${escapeHtml(t)}" style="cursor: pointer; transition: background 0.15s;" title="Filter by tag: ${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
        ${semanticSnippetHtml}
      </div>
      <div class="doc-card-footer">
        <span>${fSize}</span>
        <span>${formatDate(doc.updatedAt)}</span>
      </div>
    `;

    // Hook clickable card delete button
    card.querySelectorAll('.btn-card-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const docId = btn.getAttribute('data-doc-id');
        const docTitle = btn.getAttribute('data-doc-title');
        promptDeleteDocument(docId, docTitle);
      });
    });

    // Hook clickable tag badges
    card.querySelectorAll('.doc-tag-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        currentTag = badge.getAttribute('data-tag');
        loadDocuments();
      });
    });

    categoryGrid.appendChild(card);
    });
  });
}

// Clear active tag filter
if (btnClearTagFilter) {
  btnClearTagFilter.addEventListener('click', () => {
    currentTag = '';
    loadDocuments();
  });
}

// Empty state action buttons
const btnEmptyImport = document.getElementById('btn-empty-import');
const btnEmptyReset = document.getElementById('btn-empty-reset');

if (btnEmptyImport) {
  btnEmptyImport.addEventListener('click', () => {
    if (btnOpenImport) btnOpenImport.click();
  });
}

if (btnEmptyReset) {
  btnEmptyReset.addEventListener('click', () => {
    currentSearch = '';
    if (searchInput) searchInput.value = '';
    currentCategory = '';
    currentTag = '';
    currentExpiryFilter = '';
    const filterPersonSelect = document.getElementById('filter-person-select');
    if (filterPersonSelect) filterPersonSelect.value = '';
    updateTagBar();
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.sidebar-member-item').forEach(i => i.classList.remove('active'));
    const allDocsItem = document.querySelector('.sidebar-item[data-category=""]');
    if (allDocsItem) allDocsItem.classList.add('active');
    loadDocuments();
  });
}

// Dismiss Expiry Alert Banner for current session
if (btnBannerDismiss) {
  btnBannerDismiss.addEventListener('click', () => {
    bannerDismissedThisSession = true;
    if (expiryAlertBanner) expiryAlertBanner.classList.add('hidden');
  });
}

// Banner action: View expiries
if (btnBannerViewExpiries) {
  btnBannerViewExpiries.addEventListener('click', () => {
    const expItem = document.querySelector('.sidebar-item[data-expiry="upcoming"]');
    if (expItem) {
      sidebarItems.forEach(i => i.classList.remove('active'));
      expItem.classList.add('active');
      currentCategory = '';
      currentExpiryFilter = 'expiring_soon';
      loadDocuments();
    }
  });
}

// Sidebar Category & Expiry Filter
sidebarItems.forEach(item => {
  item.addEventListener('click', () => {
    sidebarItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const cat = item.getAttribute('data-category');
    const exp = item.getAttribute('data-expiry');

    if (cat === '') {
      const filterPersonSelect = document.getElementById('filter-person-select');
      if (filterPersonSelect) filterPersonSelect.value = '';
      document.querySelectorAll('.sidebar-member-item').forEach(m => m.classList.remove('active'));
    }

    if (exp) {
      currentCategory = '';
      currentExpiryFilter = exp === 'upcoming' ? 'expiring_soon' : 'expired';
      const filterPersonSelect = document.getElementById('filter-person-select');
      if (filterPersonSelect) filterPersonSelect.value = '';
      document.querySelectorAll('.sidebar-member-item').forEach(member => member.classList.remove('active'));
    } else {
      currentCategory = cat || '';
      currentExpiryFilter = '';
    }

    loadDocuments();
  });
});

// Search mode selection
if (searchModeKeywordBtn && searchModeSemanticBtn) {
  searchModeKeywordBtn.addEventListener('click', () => {
    searchMode = 'keyword';
    searchModeKeywordBtn.style.background = '#3b82f6';
    searchModeKeywordBtn.style.color = '#fff';
    searchModeSemanticBtn.style.background = 'transparent';
    searchModeSemanticBtn.style.color = '#94a3b8';
    searchInput.placeholder = 'Search documents by title, tags, or notes...';
    loadDocuments();
  });

  searchModeSemanticBtn.addEventListener('click', () => {
    searchMode = 'semantic';
    searchModeSemanticBtn.style.background = '#3b82f6';
    searchModeSemanticBtn.style.color = '#fff';
    searchModeKeywordBtn.style.background = 'transparent';
    searchModeKeywordBtn.style.color = '#94a3b8';
    searchInput.placeholder = 'Search by meaning (e.g., "dental checkup coverage")...';
    loadDocuments();
  });
}

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
  resetDrawerEditMode();

  try {
    const doc = await window.familyVault.getDocument(documentId);
    if (!doc) return;
    activeDocumentRecord = doc;

    drawerTitle.textContent = doc.title;
    if (drawerDocTitleDisplay) drawerDocTitleDisplay.textContent = doc.title;
    drawerCategory.textContent = doc.category;
    drawerPerson.textContent = doc.person || 'Not assigned';
    if (drawerTagsDisplay) {
      drawerTagsDisplay.textContent = (doc.tags && doc.tags.length > 0) ? doc.tags.join(', ') : 'None';
    }
    if (drawerNotesDisplay) {
      drawerNotesDisplay.textContent = doc.notes || 'None';
    }

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

      // Render Extracted OCR & Plaintext Content
      const extractedTextBody = document.getElementById('drawer-extracted-text-body');
      const ocrBadge = document.getElementById('drawer-ocr-coords-badge');
      const btnToggleOcr = document.getElementById('btn-toggle-ocr-coords');
      const text = meta.textContent || '';
      const ocrWords = Array.isArray(meta.ocrWords) ? meta.ocrWords : [];

      if (extractedTextBody) {
        extractedTextBody.textContent = text.trim() ? text.trim() : 'No text extracted from this document.';
      }

      if (ocrBadge) {
        if (ocrWords.length > 0) {
          ocrBadge.textContent = `${ocrWords.length} words`;
          ocrBadge.classList.remove('hidden');
        } else {
          ocrBadge.classList.add('hidden');
        }
      }

      if (btnToggleOcr) {
        if (ocrWords.length > 0) {
          btnToggleOcr.classList.remove('hidden');
          btnToggleOcr.textContent = 'View coordinates';
          btnToggleOcr.setAttribute('data-showing-coords', 'false');
          btnToggleOcr.onclick = () => {
            const isShowingCoords = btnToggleOcr.getAttribute('data-showing-coords') === 'true';
            if (isShowingCoords) {
              extractedTextBody.textContent = text.trim() ? text.trim() : 'No text extracted from this document.';
              btnToggleOcr.textContent = 'View coordinates';
              btnToggleOcr.setAttribute('data-showing-coords', 'false');
            } else {
              extractedTextBody.textContent = JSON.stringify(ocrWords, null, 2);
              btnToggleOcr.textContent = 'View text';
              btnToggleOcr.setAttribute('data-showing-coords', 'true');
            }
          };
        } else {
          btnToggleOcr.classList.add('hidden');
        }
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
          <div style="font-weight: 600; font-size: 14px;">${escapeHtml(fileName)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${formatBytes(fileSize)}</div>
          <div style="font-size: 11px; color: var(--success); margin-top: 4px;">Authenticated and verified (AES-256-GCM)</div>
        </div>
      `;
    }
  } catch (err) {
    drawerPreviewBox.innerHTML = `
      <div class="preview-error-fallback">
        <div class="fallback-icon">⚠️</div>
        <h4>Failed to Decrypt Preview</h4>
        <p>${escapeHtml(err.message || 'Decryption key error or corrupt preview block.')}</p>
        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">The encrypted raw file remains safely intact in your vault.</div>
        <button type="button" class="btn btn-secondary" id="btn-preview-fallback-export" style="font-size: 11px; padding: 4px 10px;">Export Raw File</button>
      </div>
    `;
    const fallbackExportBtn = drawerPreviewBox.querySelector('#btn-preview-fallback-export');
    if (fallbackExportBtn) {
      fallbackExportBtn.addEventListener('click', () => {
        exportVersion(versionId, fileName);
      });
    }
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
  resetDrawerEditMode();
  selectedDocumentId = null;
  activeDocumentRecord = null;
});

// Inline Metadata Editing Helpers & Event Listeners
function resetDrawerEditMode() {
  if (drawerDocTitleDisplay) drawerDocTitleDisplay.classList.remove('hidden');
  if (drawerDocTitleInput) drawerDocTitleInput.classList.add('hidden');

  if (drawerCategory) drawerCategory.classList.remove('hidden');
  if (drawerCategorySelect) drawerCategorySelect.classList.add('hidden');

  if (drawerPerson) drawerPerson.classList.remove('hidden');
  if (drawerPersonInput) drawerPersonInput.classList.add('hidden');

  if (drawerTagsDisplay) drawerTagsDisplay.classList.remove('hidden');
  if (drawerTagsInput) drawerTagsInput.classList.add('hidden');

  if (drawerNotesDisplay) drawerNotesDisplay.classList.remove('hidden');
  if (drawerNotesInput) drawerNotesInput.classList.add('hidden');

  if (drawerEditActions) drawerEditActions.classList.add('hidden');
}

function updateDrawerEditActionsVisibility() {
  const isEditing = (
    (drawerDocTitleInput && !drawerDocTitleInput.classList.contains('hidden')) ||
    (drawerCategorySelect && !drawerCategorySelect.classList.contains('hidden')) ||
    (drawerPersonInput && !drawerPersonInput.classList.contains('hidden')) ||
    (drawerTagsInput && !drawerTagsInput.classList.contains('hidden')) ||
    (drawerNotesInput && !drawerNotesInput.classList.contains('hidden'))
  );

  if (drawerEditActions) {
    if (isEditing) {
      drawerEditActions.classList.remove('hidden');
    } else {
      drawerEditActions.classList.add('hidden');
    }
  }
}

if (btnEditTitle) {
  btnEditTitle.addEventListener('click', () => {
    if (!activeDocumentRecord) return;
    const isEditing = !drawerDocTitleInput.classList.contains('hidden');
    if (isEditing) {
      drawerDocTitleInput.classList.add('hidden');
      drawerDocTitleDisplay.classList.remove('hidden');
    } else {
      drawerDocTitleInput.value = activeDocumentRecord.title || '';
      drawerDocTitleInput.classList.remove('hidden');
      drawerDocTitleDisplay.classList.add('hidden');
      drawerDocTitleInput.focus();
    }
    updateDrawerEditActionsVisibility();
  });
}

if (btnEditCategory) {
  btnEditCategory.addEventListener('click', () => {
    if (!activeDocumentRecord) return;
    const isEditing = !drawerCategorySelect.classList.contains('hidden');
    if (isEditing) {
      drawerCategorySelect.classList.add('hidden');
      drawerCategory.classList.remove('hidden');
    } else {
      drawerCategorySelect.value = activeDocumentRecord.category || 'other';
      drawerCategorySelect.classList.remove('hidden');
      drawerCategory.classList.add('hidden');
      drawerCategorySelect.focus();
    }
    updateDrawerEditActionsVisibility();
  });
}

if (btnEditPerson) {
  btnEditPerson.addEventListener('click', () => {
    if (!activeDocumentRecord) return;
    const isEditing = !drawerPersonInput.classList.contains('hidden');
    if (isEditing) {
      drawerPersonInput.classList.add('hidden');
      drawerPerson.classList.remove('hidden');
    } else {
      drawerPersonInput.value = activeDocumentRecord.person || '';
      drawerPersonInput.classList.remove('hidden');
      drawerPerson.classList.add('hidden');
      drawerPersonInput.focus();
    }
    updateDrawerEditActionsVisibility();
  });
}

if (btnEditTags) {
  btnEditTags.addEventListener('click', () => {
    if (!activeDocumentRecord) return;
    const isEditing = !drawerTagsInput.classList.contains('hidden');
    if (isEditing) {
      drawerTagsInput.classList.add('hidden');
      drawerTagsDisplay.classList.remove('hidden');
    } else {
      drawerTagsInput.value = (activeDocumentRecord.tags && Array.isArray(activeDocumentRecord.tags))
        ? activeDocumentRecord.tags.join(', ')
        : '';
      drawerTagsInput.classList.remove('hidden');
      drawerTagsDisplay.classList.add('hidden');
      drawerTagsInput.focus();
    }
    updateDrawerEditActionsVisibility();
  });
}

if (btnEditNotes) {
  btnEditNotes.addEventListener('click', () => {
    if (!activeDocumentRecord) return;
    const isEditing = !drawerNotesInput.classList.contains('hidden');
    if (isEditing) {
      drawerNotesInput.classList.add('hidden');
      drawerNotesDisplay.classList.remove('hidden');
    } else {
      drawerNotesInput.value = activeDocumentRecord.notes || '';
      drawerNotesInput.classList.remove('hidden');
      drawerNotesDisplay.classList.add('hidden');
      drawerNotesInput.focus();
    }
    updateDrawerEditActionsVisibility();
  });
}

if (btnCancelDocMetadata) {
  btnCancelDocMetadata.addEventListener('click', () => {
    resetDrawerEditMode();
  });
}

if (btnSaveDocMetadata) {
  btnSaveDocMetadata.addEventListener('click', async () => {
    if (!selectedDocumentId || !activeDocumentRecord) return;

    const newTitle = (drawerDocTitleInput && !drawerDocTitleInput.classList.contains('hidden'))
      ? drawerDocTitleInput.value.trim()
      : activeDocumentRecord.title;

    if (!newTitle) {
      showToast('Title cannot be empty', 'error');
      return;
    }

    const newCategory = (drawerCategorySelect && !drawerCategorySelect.classList.contains('hidden'))
      ? drawerCategorySelect.value
      : activeDocumentRecord.category;

    const newPerson = (drawerPersonInput && !drawerPersonInput.classList.contains('hidden'))
      ? (drawerPersonInput.value.trim() || null)
      : activeDocumentRecord.person;

    const newTags = (drawerTagsInput && !drawerTagsInput.classList.contains('hidden'))
      ? drawerTagsInput.value.split(',').map(t => t.trim()).filter(Boolean)
      : activeDocumentRecord.tags;

    const newNotes = (drawerNotesInput && !drawerNotesInput.classList.contains('hidden'))
      ? drawerNotesInput.value.trim()
      : activeDocumentRecord.notes;

    btnSaveDocMetadata.disabled = true;
    btnSaveDocMetadata.textContent = 'Saving...';

    try {
      await window.familyVault.updateDocumentMetadata({
        documentId: selectedDocumentId,
        title: newTitle,
        category: newCategory,
        person: newPerson,
        tags: newTags,
        notes: newNotes
      });

      showToast('Document metadata updated', 'success');
      resetDrawerEditMode();
      await loadDocuments();
      await openDocumentDrawer(selectedDocumentId);
    } catch (err) {
      showToast('Update failed: ' + err.message, 'error');
    } finally {
      btnSaveDocMetadata.disabled = false;
      btnSaveDocMetadata.textContent = 'Save Changes';
    }
  });
}


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

// Document Deletion Handlers
function promptDeleteDocument(docId, docTitle) {
  if (!docId) return;
  documentIdPendingDelete = docId;
  if (deleteDocNameConfirm) {
    deleteDocNameConfirm.textContent = docTitle || 'this document';
  }
  if (modalConfirmDelete) {
    modalConfirmDelete.classList.remove('hidden');
  }
}

if (btnDeleteDocument) {
  btnDeleteDocument.addEventListener('click', () => {
    const docId = selectedDocumentId;
    if (!docId) return;
    const title = activeDocumentRecord ? activeDocumentRecord.title : (drawerTitle ? drawerTitle.textContent : 'this document');
    promptDeleteDocument(docId, title);
  });
}

if (btnDeleteDocumentHeader) {
  btnDeleteDocumentHeader.addEventListener('click', () => {
    const docId = selectedDocumentId;
    if (!docId) return;
    const title = activeDocumentRecord ? activeDocumentRecord.title : (drawerTitle ? drawerTitle.textContent : 'this document');
    promptDeleteDocument(docId, title);
  });
}

if (btnConfirmDeleteAction) {
  btnConfirmDeleteAction.addEventListener('click', async () => {
    const docId = documentIdPendingDelete || selectedDocumentId;
    if (!docId) {
      if (modalConfirmDelete) modalConfirmDelete.classList.add('hidden');
      return;
    }

    btnConfirmDeleteAction.disabled = true;
    btnConfirmDeleteAction.textContent = 'Deleting...';

    try {
      const result = await window.familyVault.deleteDocument(docId);
      if (!result || result.success !== true) {
        throw new Error('The vault did not confirm deletion.');
      }
      if (modalConfirmDelete) modalConfirmDelete.classList.add('hidden');
      if (selectedDocumentId === docId) {
        drawerDetail.classList.add('hidden');
        resetDrawerEditMode();
        selectedDocumentId = null;
        activeDocumentRecord = null;
      }
      documentIdPendingDelete = null;
      showToast('Document deleted from vault', 'success');
      await loadDocuments();
    } catch (err) {
      showToast('Failed to delete document: ' + err.message, 'error');
    } finally {
      btnConfirmDeleteAction.disabled = false;
      btnConfirmDeleteAction.textContent = 'Yes, Delete Document';
    }
  });
}

// Refresh datalist of known family members
async function refreshFamilyMembersDatalist() {
  if (!familyMembersDatalist) return;
  try {
    const members = await window.familyVault.listFamilyMembers();
    familyMembersDatalist.innerHTML = '';
    if (Array.isArray(members)) {
      members.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        familyMembersDatalist.appendChild(option);
      });
    }
  } catch (e) {}
}

// Import Document Modal
function setImportAnalysisInProgress(inProgress) {
  isImportAnalysisInProgress = inProgress;
  submitImportBtn.disabled = inProgress || !importFilepathInput.value.trim();
  importBrowseBtn.disabled = inProgress;
  submitImportBtn.textContent = inProgress ? 'Analyzing Document...' : 'Encrypt & Save';
}

btnOpenImport.addEventListener('click', async () => {
  importAnalysisRequestId += 1;
  clearInlineError('import-error-banner');
  clearInlineWarning('import-fallback-warning');
  importFilepathInput.value = '';
  importTitleInput.value = '';
  importPersonInput.value = '';
  importTagsInput.value = '';
  importNotesInput.value = '';
  importCategorySelect.value = 'identity';
  preAnalyzedDocData = null;

  const importUnmatchedBox = document.getElementById('import-unmatched-user-box');
  if (importUnmatchedBox) importUnmatchedBox.classList.add('hidden');

  if (importAnalysisLoader) importAnalysisLoader.classList.add('hidden');
  if (importAnalysisBanner) importAnalysisBanner.classList.add('hidden');
  setImportAnalysisInProgress(false);

  await refreshFamilyMembersDatalist();
  modalImport.classList.remove('hidden');
});

importBrowseBtn.addEventListener('click', async () => {
  const requestId = ++importAnalysisRequestId;
  clearInlineError('import-error-banner');
  clearInlineWarning('import-fallback-warning');
  const filePath = await window.familyVault.selectFile();
  if (requestId !== importAnalysisRequestId || !filePath) return;

  setImportAnalysisInProgress(true);
  preAnalyzedDocData = null;

  importFilepathInput.value = filePath;
  const fileName = filePath.split(/[\\/]/).pop() || '';
  const defaultTitle = fileName.replace(/\.[^/.]+$/, '');
  importTitleInput.value = defaultTitle;

  const importUnmatchedBox = document.getElementById('import-unmatched-user-box');
  if (importUnmatchedBox) importUnmatchedBox.classList.add('hidden');

  // Show progress loader inside import modal
  if (importAnalysisLoader) {
    importAnalysisLoader.classList.remove('hidden');
    if (importAnalysisProgressBar) {
      importAnalysisProgressBar.style.transition = 'none';
      importAnalysisProgressBar.style.width = '25%';
      void importAnalysisProgressBar.offsetWidth;
      importAnalysisProgressBar.style.transition = 'width 18s linear';
      importAnalysisProgressBar.style.width = '90%';
    }
    if (importAnalysisStatusText) importAnalysisStatusText.textContent = 'Extracting OCR text & analyzing document...';
    if (importAnalysisBadge) importAnalysisBadge.textContent = 'Reading file...';
  }
  if (importAnalysisBanner) importAnalysisBanner.classList.add('hidden');

  // Smooth visual progress increments
  const timer1 = setTimeout(() => {
    if (importAnalysisBadge) importAnalysisBadge.textContent = 'Running OCR...';
  }, 350);

  const timer2 = setTimeout(() => {
    if (importAnalysisBadge) importAnalysisBadge.textContent = 'Classifying & tagging...';
  }, 900);

  try {
    const analysis = await window.familyVault.preAnalyzeDocument(filePath);
    clearTimeout(timer1);
    clearTimeout(timer2);

    if (importAnalysisProgressBar) {
      importAnalysisProgressBar.style.transition = 'width .45s ease-out';
      importAnalysisProgressBar.style.width = '100%';
    }
    if (importAnalysisBadge) importAnalysisBadge.textContent = 'Complete ✓';

    preAnalyzedDocData = analysis;

    // Autofill fields with high-confidence suggestions
    const aiTitle = analysis.title || analysis.suggestedTitle;
    if (aiTitle) {
      importTitleInput.value = aiTitle;
    }

    // STRICT USER MATCHING RULE: Unmatched persons are flagged for user review and category forced to other
    const importUnmatchedName = document.getElementById('import-unmatched-user-name');
    if (analysis.unmatchedPerson) {
      if (importUnmatchedBox && importUnmatchedName) {
        importUnmatchedName.textContent = analysis.unmatchedPerson;
        importUnmatchedBox.classList.remove('hidden');
      }
      importCategorySelect.value = 'other';
      importPersonInput.value = '';
    } else {
      if (importUnmatchedBox) importUnmatchedBox.classList.add('hidden');
      if (analysis.category && analysis.category !== 'other') {
        importCategorySelect.value = analysis.category;
      }
      if (analysis.person) {
        importPersonInput.value = analysis.person;
      }
    }

    if (analysis.tags && analysis.tags.length > 0) {
      importTagsInput.value = analysis.tags.join(', ');
    }
    if (analysis.notesSummary) {
      importNotesInput.value = analysis.notesSummary;
    }

    // Display summary banner
    if (importAnalysisBanner && importAnalysisBannerDetails) {
      const summaryParts = [];
      if (aiTitle) {
        summaryParts.push(`Title: <strong>${escapeHtml(aiTitle)}</strong>`);
      }
      const catLabel = analysis.category.charAt(0).toUpperCase() + analysis.category.slice(1);
      summaryParts.push(`Category: <strong>${escapeHtml(catLabel)}</strong>`);
      if (analysis.person) {
        summaryParts.push(`Family Member: <strong>${escapeHtml(analysis.person)}</strong>`);
      } else if (analysis.unmatchedPerson) {
        summaryParts.push(`Unmatched Name: <strong style="color: #fb923c;">${escapeHtml(analysis.unmatchedPerson)}</strong> (Review needed)`);
      }
      if (analysis.expiryDate) {
        summaryParts.push(`Expiry: <strong>${escapeHtml(analysis.expiryDate)}</strong>`);
      }
      if (analysis.tags && analysis.tags.length > 0) {
        summaryParts.push(`Tags: <em>${escapeHtml(analysis.tags.join(', '))}</em>`);
      }
      const engineBadge = (analysis.method === 'local-ai-gemma4' || analysis.method === 'multimodal-gemma4-vision' || analysis.method === 'local-ai-gemma2')
        ? '<span class="badge badge-blue" style="font-size: 10px; margin-right: 6px;">Gemma-4 AI</span>'
        : '<span class="badge badge-gray" style="font-size: 10px; margin-right: 6px;">OCR Heuristic</span>';
      importAnalysisBannerDetails.innerHTML = engineBadge + summaryParts.join(' &bull; ') + '. You can edit any details below.';
      importAnalysisBanner.classList.remove('hidden');
    }
  } catch (err) {
    clearTimeout(timer1);
    clearTimeout(timer2);
    // If analysis fails (e.g. non-text file or scanner format), don't block import, show warning fallback
    showInlineWarning('import-fallback-warning', 'Automated OCR extraction was skipped or partially failed. You can proceed and enter details manually.');
    if (importAnalysisBanner && importAnalysisBannerDetails) {
      importAnalysisBannerDetails.textContent = 'File selected. You can enter metadata manually.';
      importAnalysisBanner.classList.remove('hidden');
    }
  } finally {
    if (requestId === importAnalysisRequestId) {
      setImportAnalysisInProgress(false);
    }
    // Hide progress loader after a brief confirmation moment
    setTimeout(() => {
      if (requestId === importAnalysisRequestId && importAnalysisLoader) {
        importAnalysisLoader.classList.add('hidden');
      }
    }, 500);
  }
});

importTitleInput.addEventListener('input', () => clearInlineError('import-error-banner'));
importFilepathInput.addEventListener('input', () => {
  clearInlineError('import-error-banner');
  clearInlineWarning('import-fallback-warning');
});

submitImportBtn.addEventListener('click', async () => {
  if (isImportAnalysisInProgress || submitImportBtn.disabled) return;
  clearInlineError('import-error-banner');
  const filePath = importFilepathInput.value.trim();
  const title = importTitleInput.value.trim();
  const category = importCategorySelect.value;
  const person = importPersonInput.value.trim() || null;
  const tags = importTagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
  const notes = importNotesInput.value.trim();

  if (!filePath) {
    showInlineError('import-error-banner', 'Please select a file to import.');
    showToast('Please select a file to import', 'error');
    return;
  }

  submitImportBtn.disabled = true;
  submitImportBtn.textContent = 'Encrypting & Saving...';

  try {
    await window.familyVault.importDocument({
      filePath,
      title,
      category,
      person,
      tags,
      notes,
      preExtractedText: preAnalyzedDocData ? preAnalyzedDocData.textContent : null,
      preExtractedOcrWords: preAnalyzedDocData ? preAnalyzedDocData.ocrWords : null
    });

    modalImport.classList.add('hidden');
    preAnalyzedDocData = null;
    clearInlineError('import-error-banner');
    clearInlineWarning('import-fallback-warning');
    showToast('Document encrypted and saved in vault', 'success');
    await loadDocuments();
  } catch (err) {
    showInlineError('import-error-banner', 'Import error: ' + err.message);
    showToast('Import error: ' + err.message, 'error');
  } finally {
    setImportAnalysisInProgress(false);
  }
});

// Upload New Version Modal
btnOpenAddVersion.addEventListener('click', () => {
  clearInlineError('new-version-error-banner');
  newVersionFilepathInput.value = '';
  newVersionNotesInput.value = '';
  modalNewVersion.classList.remove('hidden');
});

newVersionBrowseBtn.addEventListener('click', async () => {
  clearInlineError('new-version-error-banner');
  const filePath = await window.familyVault.selectFile();
  if (filePath) {
    newVersionFilepathInput.value = filePath;
  }
});

newVersionFilepathInput.addEventListener('input', () => clearInlineError('new-version-error-banner'));
newVersionNotesInput.addEventListener('input', () => clearInlineError('new-version-error-banner'));

submitNewVersionBtn.addEventListener('click', async () => {
  clearInlineError('new-version-error-banner');
  const filePath = newVersionFilepathInput.value.trim();
  const notes = newVersionNotesInput.value.trim();

  if (!filePath) {
    showInlineError('new-version-error-banner', 'Please select an updated document file.');
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
    clearInlineError('new-version-error-banner');
    showToast('New version added; previous versions preserved', 'success');
    loadDocuments();
    openDocumentDrawer(selectedDocumentId);
  } catch (err) {
    showInlineError('new-version-error-banner', 'Add version error: ' + err.message);
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
  clearInlineError('change-pass-error-banner');
  changePassCurrent.value = '';
  changePassNew.value = '';
  changePassConfirm.value = '';
  modalChangePassword.classList.remove('hidden');
});

changePassCurrent.addEventListener('input', () => clearInlineError('change-pass-error-banner'));
changePassNew.addEventListener('input', () => clearInlineError('change-pass-error-banner'));
changePassConfirm.addEventListener('input', () => clearInlineError('change-pass-error-banner'));

submitChangePasswordBtn.addEventListener('click', async () => {
  clearInlineError('change-pass-error-banner');
  const oldPassword = changePassCurrent.value;
  const newPassword = changePassNew.value;
  const confirmPassword = changePassConfirm.value;

  if (!oldPassword) {
    showInlineError('change-pass-error-banner', 'Please enter your current password.');
    showToast('Please enter your current password', 'error');
    return;
  }
  if (newPassword.length < 8) {
    showInlineError('change-pass-error-banner', 'New password must be at least 8 characters long.');
    showToast('New password must be at least 8 characters long', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showInlineError('change-pass-error-banner', 'New passwords do not match. Please verify.');
    showToast('New passwords do not match', 'error');
    return;
  }

  submitChangePasswordBtn.disabled = true;
  submitChangePasswordBtn.textContent = 'Rewrapping Master Key...';

  try {
    await window.familyVault.changePassword({ oldPassword, newPassword });
    clearInlineError('change-pass-error-banner');
    modalChangePassword.classList.add('hidden');
    showToast('Master password updated successfully', 'success');
  } catch (err) {
    showInlineError('change-pass-error-banner', 'Password change error: ' + err.message);
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
    btnCreateBackup.textContent = 'Backup';
  }
});

// Grounded Local AI Document Assistant
function autoResizeAiInput() {
  if (!aiQueryInput) return;
  aiQueryInput.style.height = 'auto';
  const newHeight = Math.min(120, Math.max(38, aiQueryInput.scrollHeight));
  aiQueryInput.style.height = newHeight + 'px';
}

if (aiQueryInput) {
  aiQueryInput.addEventListener('input', autoResizeAiInput);
  aiQueryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runAiQuery();
    }
  });
}

if (btnReturnToChat) {
  btnReturnToChat.addEventListener('click', () => {
    modalAiQa.classList.remove('hidden');
    btnReturnToChat.classList.add('hidden');
    if (aiQueryInput) aiQueryInput.focus();
  });
}

if (btnOpenModelSetup) {
  btnOpenModelSetup.addEventListener('click', () => {
    if (modalDownloadModel) modalDownloadModel.classList.remove('hidden');
  });
}

btnOpenAiQa.addEventListener('click', async () => {
  modalAiQa.classList.remove('hidden');
  if (btnReturnToChat) btnReturnToChat.classList.add('hidden');
  if (aiQueryInput) {
    aiQueryInput.focus();
    autoResizeAiInput();
  }

  try {
    const status = await window.familyVault.getAiStatus();
    const engineText = document.getElementById('ai-active-engine-text');
    if (engineText) {
      engineText.textContent = status.isServerRunning
        ? `Local ${status.modelName || 'Gemma 4'} (127.0.0.1)`
        : 'Local Extractive & Semantic Retrieval';
    }

    if (aiLlamaBinInput && status.binaryPath && !aiLlamaBinInput.value) {
      aiLlamaBinInput.value = status.binaryPath;
    }
    if (aiModelFileInput && status.modelPath && !aiModelFileInput.value) {
      aiModelFileInput.value = status.modelPath;
    }

    if (btnStartAiServer && btnStopAiServer) {
      if (status.isServerRunning) {
        btnStartAiServer.classList.add('hidden');
        btnStopAiServer.classList.remove('hidden');
      } else {
        btnStartAiServer.classList.remove('hidden');
        btnStopAiServer.classList.add('hidden');
      }
    }

    if (aiModelVariantSelect && status.selectedModelVariant && !aiModelVariantUserSelected) {
      aiModelVariantSelect.value = status.selectedModelVariant;
    }
    if (aiQuickSetupBox) {
      if (status.isServerRunning) {
        aiQuickSetupBox.classList.add('hidden');
      } else {
        aiQuickSetupBox.classList.remove('hidden');
        updateGemmaSetupCard(status);
      }
    }
  } catch (e) {}
});

let aiHistory = [];

function renderSafeMarkdown(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let escaped = escapeHtml(rawText);

  // Inline code
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italics
  escaped = escaped.replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, '$1<em>$2</em>$3');

  // Bullet and numbered lists
  const lines = escaped.split('\n');
  let inList = false;
  const processed = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        processed.push('<ul>');
        inList = true;
      }
      processed.push(`<li>${bulletMatch[1]}</li>`);
    } else {
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }
      if (trimmed) {
        processed.push(`<p>${trimmed}</p>`);
      }
    }
  }
  if (inList) processed.push('</ul>');

  return processed.join('');
}

async function runAiQuery(queryOverride = null, searchAllDocuments = false) {
  const query = typeof queryOverride === 'string' ? queryOverride : aiQueryInput.value.trim();
  if (!query) return;

  aiSubmitQueryBtn.disabled = true;
  aiSubmitQueryBtn.textContent = 'Searching...';
  if (aiQueryInput) aiQueryInput.disabled = true;

  if (aiThreadWelcome) {
    aiThreadWelcome.classList.add('hidden');
  }

  // Append user message bubble with design system class
  if (queryOverride === null) {
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'ai-user-bubble';
    userMsgEl.textContent = query;
    if (aiChatThread) {
      aiChatThread.appendChild(userMsgEl);
    }
  }

  // Append loading indicator skeleton bubble
  const loadingBubble = document.createElement('div');
  loadingBubble.className = 'ai-response-loading';
  loadingBubble.setAttribute('role', 'status');
  loadingBubble.setAttribute('aria-live', 'polite');
  loadingBubble.innerHTML = `
    <span class="ai-response-loading-skeleton ai-response-loading-skeleton-title" aria-hidden="true"></span>
    <span class="ai-response-loading-skeleton ai-response-loading-skeleton-line" aria-hidden="true"></span>
    <span class="ai-response-loading-skeleton ai-response-loading-skeleton-line ai-response-loading-skeleton-short" aria-hidden="true"></span>
  `;
  if (aiChatThread) {
    aiChatThread.appendChild(loadingBubble);
    aiChatThread.scrollTop = aiChatThread.scrollHeight;
  }

  let streamedBubble = null;
  let streamedAnswer = '';
  let streamedBodyEl = null;

  const onAnswerChunk = (chunk) => {
    if (typeof chunk !== 'string' || !chunk) return;
    streamedAnswer += chunk;

    if (!streamedBubble) {
      if (loadingBubble && loadingBubble.parentNode) loadingBubble.remove();
      streamedBubble = document.createElement('div');
      streamedBubble.className = 'ai-response-bubble';

      const header = document.createElement('div');
      header.className = 'ai-response-header';
      header.innerHTML = `
        <span class="ai-response-engine">Local Inference...</span>
      `;
      streamedBubble.appendChild(header);

      streamedBodyEl = document.createElement('div');
      streamedBodyEl.className = 'ai-response-body';
      streamedBubble.appendChild(streamedBodyEl);

      if (aiChatThread) aiChatThread.appendChild(streamedBubble);
    }

    if (streamedBodyEl) {
      streamedBodyEl.innerHTML = renderSafeMarkdown(streamedAnswer);
    }
    if (aiChatThread) aiChatThread.scrollTop = aiChatThread.scrollHeight;
  };

  try {
    const res = await window.familyVault.askQuestionStream(query, onAnswerChunk, { searchAllDocuments });
    if (loadingBubble && loadingBubble.parentNode) {
      loadingBubble.remove();
    }

    const botMsgEl = streamedBubble || document.createElement('div');
    botMsgEl.className = 'ai-response-bubble';
    botMsgEl.removeAttribute('role');
    botMsgEl.removeAttribute('aria-live');

    const engineBadgeText = `${res.mode === 'llama-server' ? `Local ${res.modelName || 'Gemma 4'} GGUF` : 'Local Extractive Assistant'}${searchAllDocuments ? ' · All Documents' : ''}`;
    const formattedAnswer = renderSafeMarkdown(res.answer);

    let citationsHtml = '';
    if (res.sources && res.sources.length > 0) {
      citationsHtml = `
        <section class="ai-response-sources">
          <h4 class="ai-response-sources-heading">Sources <span>${res.sources.length}</span></h4>
          <div class="ai-response-sources-list">
            ${res.sources.map(src => {
              const isDocumentSource = Boolean(src.documentId);
              return `
              <div class="ai-citation-pill${isDocumentSource ? '' : ' reference-only'}"${isDocumentSource ? ` data-doc-id="${escapeHtml(src.documentId)}" tabindex="0" role="button"` : ''}>
                <div class="ai-citation-heading">
                  <strong>${escapeHtml(src.documentTitle)}</strong>
                  <span>${escapeHtml(src.fileName || '')}</span>
                </div>
                <div class="ai-citation-snippet">"${escapeHtml(src.snippet)}"</div>
              </div>
            `;
            }).join('')}
          </div>
        </section>
      `;
    }

    // Contextual Fallbacks & Interactive Chips
    let actionChipsHtml = '';
    if (res.personScope?.status === 'not_found' && res.personScope.personName) {
      actionChipsHtml = `
        <div class="ai-action-chips-container">
          <button class="ai-action-chip btn-add-missing-person" data-person-name="${escapeHtml(res.personScope.personName)}" type="button">
            <span>👤</span> Add "${escapeHtml(res.personScope.personName)}" to Profiles
          </button>
        </div>
      `;
    } else if (res.personScope?.status === 'ambiguous' && Array.isArray(res.personScope.candidates)) {
      actionChipsHtml = `
        <div class="ai-action-chips-container">
          <span style="font-size: 11px; color: var(--text-muted); align-self: center;">Select member:</span>
          ${res.personScope.candidates.map(cand => `
            <button class="ai-action-chip btn-disambiguate-person" data-candidate-name="${escapeHtml(cand)}" type="button">
              <span>👤</span> ${escapeHtml(cand)}
            </button>
          `).join('')}
        </div>
      `;
    }

    const isNoResults = res.hasResults === false || (!searchAllDocuments && /could not find information regarding this/i.test(res.answer));
    const searchAllPromptHtml = isNoResults
      ? `<div class="ai-search-all-prompt">
           <span>No answer was found in the current search. Search OCR and extracted text across every document in the vault?</span>
           <button class="btn btn-secondary btn-search-all-documents" type="button">Search all documents anyway</button>
         </div>`
      : '';
    const searchAllWarningHtml = searchAllDocuments && res.sources?.length
      ? `<aside class="ai-search-all-warning" role="note" aria-label="Caution: all-documents search">
           <strong>Search-all result — verify before relying on it.</strong>
           <span>This may include another family member’s documents. OCR and AI can misread or interpret details incorrectly; check the cited original documents.</span>
         </aside>`
      : '';

    botMsgEl.innerHTML = `
      <div class="ai-response-header">
        <span class="ai-response-engine">${engineBadgeText}</span>
        <button class="btn btn-secondary btn-copy-turn-answer" type="button">Copy</button>
      </div>
      <div class="ai-response-body">${formattedAnswer}</div>
      ${actionChipsHtml}
      ${citationsHtml}
      ${searchAllPromptHtml}
      ${searchAllWarningHtml}
    `;

    // Hook copy button
    const copyBtn = botMsgEl.querySelector('.btn-copy-turn-answer');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(res.answer).then(() => {
          showToast('Answer copied to clipboard!', 'success');
        }).catch(() => {
          showToast('Failed to copy', 'error');
        });
      });
    }

    // Hook search all documents anyway button
    const searchAllButton = botMsgEl.querySelector('.btn-search-all-documents');
    if (searchAllButton) {
      searchAllButton.addEventListener('click', () => {
        searchAllButton.disabled = true;
        searchAllButton.textContent = 'Searching all documents...';
        runAiQuery(query, true);
      });
    }

    // Hook missing person button
    const addPersonBtn = botMsgEl.querySelector('.btn-add-missing-person');
    if (addPersonBtn) {
      addPersonBtn.addEventListener('click', () => {
        const pName = addPersonBtn.getAttribute('data-person-name');
        if (modalQuickAddMember) {
          modalAiQa.classList.add('hidden');
          if (btnReturnToChat) btnReturnToChat.classList.remove('hidden');
          const quickNameInput = document.getElementById('quick-member-name-input');
          if (quickNameInput) quickNameInput.value = pName || '';
          modalQuickAddMember.classList.remove('hidden');
          if (quickNameInput) quickNameInput.focus();
        }
      });
    }

    // Hook ambiguous person candidate chips
    botMsgEl.querySelectorAll('.btn-disambiguate-person').forEach(chip => {
      chip.addEventListener('click', () => {
        const cand = chip.getAttribute('data-candidate-name');
        if (cand) {
          const replacedQuery = query.replace(new RegExp(escapeRegex(query.trim()), 'i'), cand) || `Tell me about ${cand}`;
          runAiQuery(replacedQuery);
        }
      });
    });

    // Hook citations to open drawer with seamless Return to Chat flow
    botMsgEl.querySelectorAll('.ai-citation-pill').forEach(pill => {
      const openCitation = () => {
        const docId = pill.getAttribute('data-doc-id');
        if (docId) {
          modalAiQa.classList.add('hidden');
          if (btnReturnToChat) btnReturnToChat.classList.remove('hidden');
          openDocumentDrawer(docId);
        }
      };
      pill.addEventListener('click', openCitation);
      pill.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openCitation();
        }
      });
    });

    if (aiChatThread) {
      if (!botMsgEl.parentNode) aiChatThread.appendChild(botMsgEl);
      aiChatThread.scrollTop = aiChatThread.scrollHeight;
    }

    aiHistory.push({ query, response: res });

    // Safely clear input on success
    if (queryOverride === null && aiQueryInput) {
      aiQueryInput.value = '';
      autoResizeAiInput();
    }
  } catch (err) {
    if (loadingBubble && loadingBubble.parentNode) {
      loadingBubble.remove();
    }
    if (streamedBubble && streamedBubble.parentNode) {
      streamedBubble.remove();
    }
    const errorBubble = document.createElement('div');
    errorBubble.className = 'ai-error-bubble';
    errorBubble.innerHTML = `
      <div><strong>Assistant Error:</strong> ${escapeHtml(err.message)}</div>
      <button class="btn btn-secondary btn-retry-query" type="button">Retry question</button>
    `;
    const retryBtn = errorBubble.querySelector('.btn-retry-query');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        errorBubble.remove();
        runAiQuery(query, searchAllDocuments);
      });
    }

    if (aiChatThread) {
      aiChatThread.appendChild(errorBubble);
      aiChatThread.scrollTop = aiChatThread.scrollHeight;
    }
    showToast('Assistant error: ' + err.message, 'error');

    // Restore query into input on error so user doesn't lose it
    if (aiQueryInput) {
      aiQueryInput.value = query;
      autoResizeAiInput();
    }
  } finally {
    aiSubmitQueryBtn.disabled = false;
    aiSubmitQueryBtn.textContent = 'Ask';
    if (aiQueryInput) {
      aiQueryInput.disabled = false;
      aiQueryInput.focus();
    }
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

aiSubmitQueryBtn.addEventListener('click', () => runAiQuery());

// Clear AI Chat History
if (btnClearAiHistory) {
  btnClearAiHistory.addEventListener('click', () => {
    aiHistory = [];
    if (btnReturnToChat) btnReturnToChat.classList.add('hidden');
    if (aiChatThread) {
      aiChatThread.innerHTML = `
        <div id="ai-thread-welcome" class="ai-thread-welcome-box">
          <div style="font-size: 28px; margin-bottom: 8px;">💬</div>
          <strong style="color: var(--text-secondary); display: block; margin-bottom: 4px;">Private &amp; Offline Assistant</strong>
          Ask anything about your stored documents, insurance deadlines, passport numbers, tax forms, or train schedules.
        </div>
      `;
    }
  });
}

// AI Neural Model Settings
const btnToggleAiSettings = document.getElementById('btn-toggle-ai-settings');
const aiSettingsPanel = document.getElementById('ai-settings-panel');
const aiLlamaBinInput = document.getElementById('ai-llama-bin-input');
const aiLlamaBinBrowseBtn = document.getElementById('ai-llama-bin-browse-btn');
const aiModelFileInput = document.getElementById('ai-model-file-input');
const aiModelFileBrowseBtn = document.getElementById('ai-model-file-browse-btn');
const btnStartAiServer = document.getElementById('btn-start-ai-server');
const btnStopAiServer = document.getElementById('btn-stop-ai-server');
const aiModelVariantSelect = document.getElementById('ai-model-variant-select');
let aiModelVariantUserSelected = false;

function updateGemmaSetupCard(status, modelVariant = aiModelVariantSelect?.value || 'E2B') {
  const model = status.modelVariants?.[modelVariant];
  const setupTitle = document.getElementById('ai-setup-title');
  const setupDesc = document.getElementById('ai-setup-desc');
  if (!model) return;

  if (setupTitle) setupTitle.textContent = `${model.label} · Local CPU`;
  if (btnDownloadSetupGemma) {
    btnDownloadSetupGemma.textContent = model.isModelDownloaded
      ? `Use ${model.label}`
      : `Download and use ${model.label}`;
  }
  if (setupDesc) {
    if (model.isModelDownloaded) {
      setupDesc.textContent = 'This model is already stored locally. Start it using the installed llama-server. Older builds may not support Gemma 4; choose a compatible llama-server above if startup fails.';
    } else if (modelVariant === 'E4B') {
      setupDesc.textContent = 'About 6 GB total for model and vision projector. Requires more RAM than E2B (16 GB system RAM recommended). Download starts only after you click; files are fetched from Hugging Face, then inference runs locally.';
    } else {
      setupDesc.textContent = 'About 4 GB total for model and vision projector. Download starts only after you click; files are fetched from Hugging Face, then inference runs locally.';
    }
  }
}

if (btnToggleAiSettings) {
  btnToggleAiSettings.addEventListener('click', () => {
    aiSettingsPanel.classList.toggle('hidden');
  });
}

if (aiLlamaBinBrowseBtn) {
  aiLlamaBinBrowseBtn.addEventListener('click', async () => {
    const file = await window.familyVault.selectLlamaServer();
    if (file) aiLlamaBinInput.value = file;
  });
}

if (aiModelFileBrowseBtn) {
  aiModelFileBrowseBtn.addEventListener('click', async () => {
    const file = await window.familyVault.selectModelFile();
    if (file) aiModelFileInput.value = file;
  });
}

if (aiModelVariantSelect) {
  aiModelVariantSelect.addEventListener('change', async () => {
    aiModelVariantUserSelected = true;
    try {
      const status = await window.familyVault.getAiStatus();
      updateGemmaSetupCard(status);
    } catch (error) {
      showToast(`Could not check selected model status: ${error.message}`, 'error');
    }
  });
}

if (btnStartAiServer) {
  btnStartAiServer.addEventListener('click', async () => {
    const binaryPath = aiLlamaBinInput.value.trim();
    const modelPath = aiModelFileInput.value.trim();
    if (!binaryPath) {
      showToast('Please select your llama-server.exe executable', 'error');
      return;
    }
    if (!modelPath) {
      showToast('Please select your GGUF model file (*.gguf)', 'error');
      return;
    }

    btnStartAiServer.disabled = true;
    btnStartAiServer.textContent = 'Starting Engine...';

    try {
      const ready = await window.familyVault.startAiServer({ binaryPath, modelPath });
      if (ready) {
        const modelLabel = /e4b/i.test(modelPath) ? 'Gemma 4 E4B' : 'Gemma 4 E2B';
        showToast(`Local ${modelLabel} neural engine started successfully (127.0.0.1:18432)`, 'success');
        document.getElementById('ai-active-engine-text').textContent = `Local ${modelLabel} (CPU 127.0.0.1)`;
        btnStartAiServer.classList.add('hidden');
        btnStopAiServer.classList.remove('hidden');
        if (aiQuickSetupBox) aiQuickSetupBox.classList.add('hidden');
        aiSettingsPanel.classList.add('hidden');
      } else {
        showToast('Server started but health check timed out', 'error');
      }
    } catch (err) {
      showToast('Failed to start llama-server: ' + err.message, 'error');
    } finally {
      btnStartAiServer.disabled = false;
      btnStartAiServer.textContent = 'Start Neural Engine';
    }
  });
}

if (btnStopAiServer) {
  btnStopAiServer.addEventListener('click', async () => {
    try {
      await window.familyVault.stopAiServer();
      showToast('Neural engine stopped; using local extractive assistant', 'info');
      document.getElementById('ai-active-engine-text').textContent = 'Local Extractive & Semantic Retrieval';
      btnStartAiServer.classList.remove('hidden');
      btnStopAiServer.classList.add('hidden');
      if (aiQuickSetupBox) {
        aiQuickSetupBox.classList.remove('hidden');
        const status = await window.familyVault.getAiStatus();
        updateGemmaSetupCard(status);
      }
    } catch (err) {
      showToast('Failed to stop engine: ' + err.message, 'error');
    }
  });
}

// Model Status Checker & Dynamic Topbar/Modal Updates
async function checkAiModelStatus() {
  try {
    const status = await window.familyVault.getAiStatus();
    if (!btnTopbarDownloadModel) return;

    if (status.isModelDownloaded && status.isBinaryAvailable) {
      if (btnTopbarDownloadIcon) btnTopbarDownloadIcon.textContent = '';
      if (btnTopbarDownloadText) {
        btnTopbarDownloadText.textContent = status.modelName || 'Gemma 4';
        btnTopbarDownloadText.classList.add('ai-model-blinking-text');
      }
      btnTopbarDownloadModel.classList.add('btn-acrylic-model-ready');
      btnTopbarDownloadModel.style.background = '';
      btnTopbarDownloadModel.style.borderColor = '';
      btnTopbarDownloadModel.style.color = '';

      if (modelModalStatusBadge) {
        modelModalStatusBadge.className = 'badge badge-green';
        modelModalStatusBadge.textContent = status.isServerRunning ? 'Active & Running' : 'Installed on Disk';
      }
      if (modelModalStatusText) {
        modelModalStatusText.textContent = status.isServerRunning
          ? `Local ${status.modelName} engine is running and responding on 127.0.0.1:${status.port}.`
          : `${status.modelName} weights are stored locally. Engine is ready to start.`;
      }
      if (modelModalBytesText) modelModalBytesText.textContent = 'Installed locally';
      if (modelModalProgressBar) modelModalProgressBar.style.width = '100%';
      if (modelModalPercentText) modelModalPercentText.textContent = '100%';
      if (modelModalStageText) modelModalStageText.textContent = 'Complete';
      if (btnModalStartDownload) {
        if (status.isServerRunning) {
          btnModalStartDownload.textContent = 'Local AI engine active';
          btnModalStartDownload.disabled = true;
          btnModalStartDownload.style.background = '#059669';
        } else {
          btnModalStartDownload.textContent = 'Start local AI engine';
          btnModalStartDownload.disabled = false;
          btnModalStartDownload.style.background = '#4f46e5';
        }
      }
      if (btnDownloadSetupGemma) {
        updateGemmaSetupCard(status);
      }
    } else {
      if (btnTopbarDownloadIcon) btnTopbarDownloadIcon.textContent = '';
      if (btnTopbarDownloadText) {
        btnTopbarDownloadText.textContent = 'Download AI Model';
        btnTopbarDownloadText.classList.remove('ai-model-blinking-text');
      }
      btnTopbarDownloadModel.classList.remove('btn-acrylic-model-ready');
      btnTopbarDownloadModel.style.background = '';
      btnTopbarDownloadModel.style.borderColor = '';
      btnTopbarDownloadModel.style.color = '';

      if (modelModalStatusBadge) {
        modelModalStatusBadge.className = 'badge badge-blue';
        modelModalStatusBadge.textContent = 'Not Downloaded';
      }
      if (modelModalStatusText) {
        modelModalStatusText.textContent = 'Choose Gemma 4 E2B or E4B in Model Settings to download a model, or use a local GGUF file.';
      }
      if (modelModalBytesText) modelModalBytesText.textContent = 'Model not installed';
      if (modelModalProgressBar) modelModalProgressBar.style.width = '0%';
      if (modelModalPercentText) modelModalPercentText.textContent = '0%';
      if (modelModalStageText) modelModalStageText.textContent = 'Idle';
      if (btnModalStartDownload) {
        btnModalStartDownload.textContent = 'Choose a model in Model Settings';
        btnModalStartDownload.disabled = false;
        btnModalStartDownload.style.background = '#4f46e5';
      }
      if (btnDownloadSetupGemma) {
        updateGemmaSetupCard(status);
      }
    }
  } catch (e) {}
}

let isDownloadingModel = false;

async function startGemmaDownload(modelVariant = aiModelVariantSelect?.value || 'E2B') {
  if (isDownloadingModel) {
    if (modalDownloadModel) modalDownloadModel.classList.remove('hidden');
    return;
  }
  isDownloadingModel = true;

  if (btnModalStartDownload) {
    btnModalStartDownload.disabled = true;
    btnModalStartDownload.textContent = 'Downloading...';
  }
  if (btnDownloadSetupGemma) {
    btnDownloadSetupGemma.disabled = true;
    btnDownloadSetupGemma.textContent = `Downloading Gemma 4 ${modelVariant}...`;
  }
  if (btnTopbarDownloadText) {
    btnTopbarDownloadText.textContent = 'Downloading...';
    btnTopbarDownloadText.classList.remove('ai-model-blinking-text');
  }
  if (btnTopbarDownloadModel) {
    btnTopbarDownloadModel.classList.remove('btn-acrylic-model-ready');
    btnTopbarDownloadModel.style.background = '';
    btnTopbarDownloadModel.style.borderColor = '';
    btnTopbarDownloadModel.style.color = '';
  }
  if (btnTopbarDownloadIcon) btnTopbarDownloadIcon.textContent = '';
  if (modelModalStatusBadge) {
    modelModalStatusBadge.className = 'badge badge-orange';
    modelModalStatusBadge.textContent = 'Downloading...';
  }
  if (modelModalStatusText) modelModalStatusText.textContent = 'Connecting to download source...';
  if (aiDownloadProgressContainer) aiDownloadProgressContainer.classList.remove('hidden');

  const unsubscribe = window.familyVault.onAiDownloadProgress((data) => {
    const statusMsg = data.message || (data.stage === 'llama-server'
      ? 'Downloading llama-server runtime...'
      : `Downloading Gemma 4 ${modelVariant} weights...`);

    if (modelModalStatusText) modelModalStatusText.textContent = statusMsg;
    if (aiDownloadStatusText) aiDownloadStatusText.textContent = statusMsg;
    if (modelModalStageText) modelModalStageText.textContent = data.stage || 'downloading';

    if (data.downloadedMb && data.totalMb) {
      if (modelModalBytesText) modelModalBytesText.textContent = `${data.downloadedMb} MB / ${data.totalMb} MB`;
    }

    if (typeof data.percent === 'number') {
      const pStr = `${data.percent}%`;
      if (btnTopbarDownloadText) btnTopbarDownloadText.textContent = `Downloading (${pStr})`;
      if (modelModalPercentText) modelModalPercentText.textContent = pStr;
      if (aiDownloadPercentText) aiDownloadPercentText.textContent = pStr;
      if (modelModalProgressBar) modelModalProgressBar.style.width = pStr;
      if (aiDownloadProgressBar) aiDownloadProgressBar.style.width = pStr;
    }
  });

  try {
    const res = await window.familyVault.downloadGemmaModel(modelVariant);
    if (res && res.success) {
      const modelLabel = modelVariant === 'E4B' ? 'Gemma 4 E4B' : 'Gemma 4 E2B';
      showToast(`${modelLabel} installed; local engine ${res.isServerRunning ? 'started' : 'is ready to start'} (127.0.0.1:18432)`, res.isServerRunning ? 'success' : 'warning');
      await checkAiModelStatus();
      const engineText = document.getElementById('ai-active-engine-text');
      if (engineText && res.isServerRunning) engineText.textContent = `Local ${modelLabel} (CPU 127.0.0.1)`;
      if (btnStartAiServer) btnStartAiServer.classList.add('hidden');
      if (btnStopAiServer) btnStopAiServer.classList.remove('hidden');
      if (aiQuickSetupBox) aiQuickSetupBox.classList.add('hidden');
    } else {
      showToast('Download finished, but engine did not start. You can start it from Model Settings.', 'warning');
      await checkAiModelStatus();
    }
  } catch (err) {
    showToast('Model setup failed: ' + err.message, 'error');
    if (modelModalStatusText) modelModalStatusText.textContent = 'Error: ' + err.message;
    if (aiDownloadStatusText) aiDownloadStatusText.textContent = 'Error: ' + err.message;
    await checkAiModelStatus();
  } finally {
    isDownloadingModel = false;
    if (btnModalStartDownload) btnModalStartDownload.disabled = false;
    if (btnDownloadSetupGemma) btnDownloadSetupGemma.disabled = false;
    if (typeof unsubscribe === 'function') unsubscribe();
  }
}

// Hook Topbar Download Button
if (btnTopbarDownloadModel) {
  btnTopbarDownloadModel.addEventListener('click', () => {
    if (modalDownloadModel) modalDownloadModel.classList.remove('hidden');
    checkAiModelStatus();
  });
}

// Hook Modal Start Download Button
if (btnModalStartDownload) {
  btnModalStartDownload.addEventListener('click', async () => {
    const status = await window.familyVault.getAiStatus();
    if (status.isModelDownloaded && status.isBinaryAvailable && !status.isServerRunning) {
      btnModalStartDownload.disabled = true;
      btnModalStartDownload.textContent = 'Starting Engine...';
      try {
        const ready = await window.familyVault.startAiServer({
          binaryPath: status.binaryPath,
          modelPath: status.modelPath
        });
        if (ready) {
          showToast('Local Neural LLM engine started! (127.0.0.1:18432)', 'success');
          await checkAiModelStatus();
        } else {
          showToast('Failed to start engine', 'error');
        }
      } catch (e) {
        showToast('Error starting engine: ' + e.message, 'error');
      } finally {
        checkAiModelStatus();
      }
      return;
    }

    if (!status.isModelDownloaded) {
      const modelSettingsToggle = document.getElementById('btn-toggle-ai-settings');
      if (modelSettingsToggle) modelSettingsToggle.click();
      showToast('Choose Gemma 4 E2B or E4B from Model Settings to download it.', 'info');
    }
  });
}

// Hook AI Quick Setup Card Download Button
if (btnDownloadSetupGemma) {
  btnDownloadSetupGemma.addEventListener('click', () => startGemmaDownload());
}

// Family Member Filter listener
const filterPersonSelect = document.getElementById('filter-person-select');
if (filterPersonSelect) {
  filterPersonSelect.addEventListener('change', () => {
    const val = (filterPersonSelect.value || '').trim().toLowerCase();
    document.querySelectorAll('.sidebar-member-item').forEach(item => {
      const p = (item.getAttribute('data-person') || '').trim().toLowerCase();
      if (val && p === val) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    loadDocuments();
  });
}

// Copy extracted OCR / native text from detail drawer
const btnCopyExtractedText = document.getElementById('btn-copy-extracted-text');
if (btnCopyExtractedText) {
  btnCopyExtractedText.addEventListener('click', (e) => {
    e.stopPropagation();
    const textEl = document.getElementById('drawer-extracted-text-body');
    const text = textEl ? textEl.textContent.trim() : '';
    if (text && text !== 'No text extracted from this document.') {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Extracted document text copied to clipboard!', 'success');
      }).catch(() => {
        showToast('Failed to copy text', 'error');
      });
    } else {
      showToast('No text available to copy', 'warning');
    }
  });
}

// Copy AI Grounded Answer to clipboard
const btnCopyAiAnswer = document.getElementById('btn-copy-ai-answer');
if (btnCopyAiAnswer) {
  btnCopyAiAnswer.addEventListener('click', () => {
    const text = aiAnswerText.textContent.trim();
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('AI answer copied to clipboard!', 'success');
      }).catch(() => {
        showToast('Failed to copy answer', 'error');
      });
    }
  });
}

// Encrypted Audit Logs Modal
const modalAuditLogs = document.getElementById('modal-audit-logs');
const btnOpenAuditLogs = document.getElementById('btn-open-audit-logs');
const auditLogsTableBody = document.getElementById('audit-logs-table-body');

if (btnOpenAuditLogs) {
  btnOpenAuditLogs.addEventListener('click', async () => {
    if (modalAuditLogs) modalAuditLogs.classList.remove('hidden');
    if (auditLogsTableBody) {
      auditLogsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">Loading encrypted audit records...</td></tr>';
    }

    try {
      const logs = await window.familyVault.getAuditLogs(100);
      if (!logs || logs.length === 0) {
        if (auditLogsTableBody) {
          auditLogsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">No audit events recorded yet.</td></tr>';
        }
        return;
      }

      if (auditLogsTableBody) {
        auditLogsTableBody.innerHTML = '';
        logs.forEach(log => {
          const tr = document.createElement('tr');
          tr.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.05);';

          let badgeClass = 'badge-blue';
          if (log.eventType.includes('DELETE') || log.eventType.includes('LOCK')) badgeClass = 'badge-gray';
          if (log.eventType.includes('PASSWORD')) badgeClass = 'badge-orange';
          if (log.eventType.includes('BACKUP') || log.eventType.includes('CREATE') || log.eventType.includes('REVIEW')) badgeClass = 'badge-green';

          const dateStr = new Date(log.timestamp).toLocaleString();
          const detailsStr = Object.keys(log.details || {}).length > 0
            ? Object.entries(log.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' | ')
            : '-';

          tr.innerHTML = `
            <td style="padding: 8px 12px; color: #94a3b8; font-family: monospace; font-size: 11px;">${escapeHtml(dateStr)}</td>
            <td style="padding: 8px 12px;"><span class="badge ${badgeClass}">${escapeHtml(log.eventType)}</span></td>
            <td style="padding: 8px 12px; color: #cbd5e1; word-break: break-all; font-size: 11px;">${escapeHtml(detailsStr)}</td>
          `;
          auditLogsTableBody.appendChild(tr);
        });
      }
    } catch (err) {
      if (auditLogsTableBody) {
        auditLogsTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: #f87171;">Failed to load audit logs: ${escapeHtml(err.message)}</td></tr>`;
      }
    }
  });
}

// Export Audit Logs to JSON file
const btnExportAuditLogs = document.getElementById('btn-export-audit-logs');
if (btnExportAuditLogs) {
  btnExportAuditLogs.addEventListener('click', async () => {
    try {
      const destPath = await window.familyVault.saveFileDialog({
        title: 'Export Encrypted Vault Audit Log',
        defaultName: 'familyvault-audit-log.json'
      });
      if (destPath) {
        await window.familyVault.exportAuditLogs(destPath);
        showToast('Audit logs successfully exported to ' + destPath.split(/[\\/]/).pop(), 'success');
      }
    } catch (err) {
      showToast('Failed to export audit logs: ' + err.message, 'error');
    }
  });
}

// --- Users & Family Profiles Controller ---
const navUserProfilesBtn = document.getElementById('nav-user-profiles-btn');
const modalUsersProfiles = document.getElementById('modal-users-profiles');
const modalEditUserProfile = document.getElementById('modal-edit-user-profile');
const usersSearchInput = document.getElementById('users-search-input');
const usersProfileList = document.getElementById('users-profile-list');
const usersProfileEmpty = document.getElementById('users-profile-empty');
const usersProfileContent = document.getElementById('users-profile-content');
const userDetailName = document.getElementById('user-detail-name');
const userDetailAgeBadge = document.getElementById('user-detail-age-badge');
const userDetailGenderBadge = document.getElementById('user-detail-gender-badge');
const userDetailDocsBadge = document.getElementById('user-detail-docs-badge');
const userContradictionBox = document.getElementById('user-contradiction-box');
const userContradictionItems = document.getElementById('user-contradiction-items');

const userFieldDob = document.getElementById('user-field-dob');
const userFieldFather = document.getElementById('user-field-father');
const userFieldMother = document.getElementById('user-field-mother');
const userFieldAddress = document.getElementById('user-field-address');
const userField10th = document.getElementById('user-field-10th');
const userField12th = document.getElementById('user-field-12th');
const userFieldEducation = document.getElementById('user-field-education');
const userSourceDocsList = document.getElementById('user-source-docs-list');

const btnEditUserProfile = document.getElementById('btn-edit-user-profile');
const editUserName = document.getElementById('edit-user-name');
const editUserDob = document.getElementById('edit-user-dob');
const editUserGender = document.getElementById('edit-user-gender');
const editUserFather = document.getElementById('edit-user-father');
const editUserMother = document.getElementById('edit-user-mother');
const editUserAddress = document.getElementById('edit-user-address');
const editUser10th = document.getElementById('edit-user-10th');
const editUser12th = document.getElementById('edit-user-12th');
const editUserEducation = document.getElementById('edit-user-education');
const editUserNotes = document.getElementById('edit-user-notes');
const btnSaveUserProfileSubmit = document.getElementById('btn-save-user-profile-submit');

const btnOpenAddFamilyMember = document.getElementById('btn-open-add-family-member');
const modalAddFamilyMember = document.getElementById('modal-add-family-member');
const addUserName = document.getElementById('add-user-name');
const addUserDob = document.getElementById('add-user-dob');
const addUserGender = document.getElementById('add-user-gender');
const addUserFather = document.getElementById('add-user-father');
const addUserMother = document.getElementById('add-user-mother');
const addUserAddress = document.getElementById('add-user-address');
const addUser10th = document.getElementById('add-user-10th');
const addUser12th = document.getElementById('add-user-12th');
const addUserEducation = document.getElementById('add-user-education');
const addUserNotes = document.getElementById('add-user-notes');
const btnSubmitAddFamilyMember = document.getElementById('btn-submit-add-family-member');

const btnRemoveUserProfile = document.getElementById('btn-remove-user-profile');
const modalConfirmRemoveUser = document.getElementById('modal-confirm-remove-user');
const removeUserNameConfirm = document.getElementById('remove-user-name-confirm');
const btnConfirmRemoveUserAction = document.getElementById('btn-confirm-remove-user-action');

let currentLoadedProfiles = [];
let selectedProfileName = null;

async function refreshUserProfilesUI(targetPersonName = null) {
  try {
    currentLoadedProfiles = await window.familyVault.listUserProfiles();
    const countBadge = document.getElementById('count-users');
    if (countBadge) countBadge.textContent = currentLoadedProfiles.length;

    renderUsersList(currentLoadedProfiles, targetPersonName);
  } catch (err) {
    showToast('Failed to load user profiles: ' + err.message, 'error');
  }
}

function renderUsersList(profiles, preferredSelectedName = null) {
  if (!usersProfileList) return;
  usersProfileList.innerHTML = '';

  const query = (usersSearchInput?.value || '').toLowerCase().trim();
  const filtered = query
    ? profiles.filter(p => p.name.toLowerCase().includes(query))
    : profiles;

  if (filtered.length === 0) {
    usersProfileList.innerHTML = '<div style="padding: 16px 8px; text-align: center; color: var(--text-muted); font-size: 11px;">No family members found.</div>';
    usersProfileEmpty.classList.remove('hidden');
    usersProfileContent.classList.add('hidden');
    selectedProfileName = null;
    return;
  }

  filtered.forEach(u => {
    const item = document.createElement('div');
    item.className = 'user-item-btn';
    item.style.cssText = 'padding: 8px 10px; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: background 0.15s; border: 1px solid transparent;';
    
    const isTarget = u.name === (preferredSelectedName || selectedProfileName);
    if (isTarget) {
      item.style.background = 'rgba(59, 130, 246, 0.15)';
      item.style.borderColor = 'rgba(59, 130, 246, 0.4)';
    }

    const conflictBadge = u.hasContradictions
      ? `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 9px; padding: 1px 5px;">⚠️ ${u.contradictionCount} Discrepanc${u.contradictionCount > 1 ? 'ies' : 'y'}</span>`
      : '';

    item.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <strong style="font-size: 12px; color: #fff;">${escapeHtml(u.name)}</strong>
        ${conflictBadge}
      </div>
      <div style="display: flex; gap: 6px; font-size: 10px; color: var(--text-muted); margin-top: 2px;">
        <span>${u.age !== null ? `Age: ${u.age}` : 'Age: -'}</span>
        <span>&bull;</span>
        <span>${u.documentsCount} doc${u.documentsCount !== 1 ? 's' : ''}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      document.querySelectorAll('#users-profile-list > div').forEach(el => {
        el.style.background = 'transparent';
        el.style.borderColor = 'transparent';
      });
      item.style.background = 'rgba(59, 130, 246, 0.15)';
      item.style.borderColor = 'rgba(59, 130, 246, 0.4)';
      loadUserProfileDetails(u.name);
    });

    usersProfileList.appendChild(item);
  });

  const selectTarget = preferredSelectedName || selectedProfileName || filtered[0].name;
  loadUserProfileDetails(selectTarget);
}

async function loadUserProfileDetails(personName) {
  if (!personName) return;
  selectedProfileName = personName;

  try {
    const data = await window.familyVault.getUserProfile(personName);
    if (!data) return;

    usersProfileEmpty.classList.add('hidden');
    usersProfileContent.classList.remove('hidden');

    // Header
    userDetailName.textContent = data.personName;
    userDetailAgeBadge.textContent = data.profile.age !== null ? `Age: ${data.profile.age}` : 'Age: Unknown';
    userDetailGenderBadge.textContent = data.profile.gender || 'Gender: Not set';
    userDetailDocsBadge.textContent = `${data.documentsCount} Document${data.documentsCount !== 1 ? 's' : ''}`;

    // Contradictions Banner
    if (data.hasContradictions && Object.keys(data.contradictions).length > 0) {
      userContradictionBox.classList.remove('hidden');
      userContradictionItems.innerHTML = '';

      for (const [key, item] of Object.entries(data.contradictions)) {
        const row = document.createElement('div');
        row.style.cssText = 'background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px; padding: 8px 10px; margin-bottom: 6px;';

        const titleHtml = `<div style="font-weight: 600; color: #fca5a5; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
          <span>${escapeHtml(item.fieldLabel)}</span>
          <span class="badge" style="background: rgba(239, 68, 68, 0.25); color: #f87171; font-size: 9px;">Contradiction</span>
        </div>`;

        const valuesHtml = item.conflictingValues.map(cv => `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 3px; padding-left: 6px; border-left: 2px solid #ef4444;">
            <span style="font-weight: 500; color: #fff;">"${escapeHtml(cv.value)}"</span>
            <span style="color: var(--text-muted); font-size: 10px;">in <em>${escapeHtml(cv.documentTitle || cv.fileName || 'Document')}</em></span>
          </div>
        `).join('');

        row.innerHTML = titleHtml + valuesHtml;
        userContradictionItems.appendChild(row);
      }
    } else {
      userContradictionBox.classList.add('hidden');
    }

    // Populate Fields with inline contradiction indicator if conflicting
    renderFieldWithConflict(userFieldDob, data.profile.dob, data.contradictions.dob);
    renderFieldWithConflict(userFieldFather, data.profile.fathersName, data.contradictions.fathers_name);
    renderFieldWithConflict(userFieldMother, data.profile.mothersName, data.contradictions.mothers_name);
    renderFieldWithConflict(userFieldAddress, data.profile.address, data.contradictions.address);
    renderFieldWithConflict(userField10th, data.profile.marks10th, data.contradictions.marks_10th);
    renderFieldWithConflict(userField12th, data.profile.marks12th, data.contradictions.marks_12th);
    renderFieldWithConflict(userFieldEducation, data.profile.education, data.contradictions.education);

    // Populate Contributing Documents
    userSourceDocsList.innerHTML = '';
    if (data.sourceDocuments && data.sourceDocuments.length > 0) {
      data.sourceDocuments.forEach(doc => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: rgba(15, 23, 42, 0.4); padding: 5px 8px; border-radius: 4px; border: 1px solid var(--border); font-size: 11px;';
        item.innerHTML = `
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px;">
            <strong style="color: var(--text-primary);">${escapeHtml(doc.title)}</strong>
            <span style="color: var(--text-muted); margin-left: 6px; font-size: 10px;">(${escapeHtml(doc.category)})</span>
          </div>
          <button class="btn btn-secondary" style="font-size: 10px; padding: 2px 7px;">View</button>
        `;
        item.querySelector('button').addEventListener('click', () => {
          modalUsersProfiles.classList.add('hidden');
          openDocumentDrawer(doc.id);
        });
        userSourceDocsList.appendChild(item);
      });
    } else {
      userSourceDocsList.innerHTML = '<div style="color: var(--text-muted); font-size: 11px;">No contributing documents found.</div>';
    }
  } catch (err) {
    showToast('Failed to load profile details: ' + err.message, 'error');
  }
}

function renderFieldWithConflict(element, value, contradictionObj) {
  if (!element) return;
  const valStr = value && String(value).trim() ? String(value).trim() : '-';
  if (contradictionObj && contradictionObj.isContradicting) {
    element.innerHTML = `${escapeHtml(valStr)} <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 9px; margin-left: 6px;">⚠️ Contradicting</span>`;
  } else {
    element.textContent = valStr;
  }
}

if (navUserProfilesBtn) {
  navUserProfilesBtn.addEventListener('click', async () => {
    modalUsersProfiles.classList.remove('hidden');
    await refreshUserProfilesUI();
  });
}

if (usersSearchInput) {
  usersSearchInput.addEventListener('input', () => {
    renderUsersList(currentLoadedProfiles, selectedProfileName);
  });
}

if (btnEditUserProfile) {
  btnEditUserProfile.addEventListener('click', async () => {
    if (!selectedProfileName) return;
    try {
      const data = await window.familyVault.getUserProfile(selectedProfileName);
      if (!data) return;

      editUserName.value = data.personName;
      editUserDob.value = data.profile.dob || '';
      editUserGender.value = data.profile.gender || '';
      editUserFather.value = data.profile.fathersName || '';
      editUserMother.value = data.profile.mothersName || '';
      editUserAddress.value = data.profile.address || '';
      editUser10th.value = data.profile.marks10th || '';
      editUser12th.value = data.profile.marks12th || '';
      editUserEducation.value = data.profile.education || '';
      editUserNotes.value = data.profile.notes || '';

      modalEditUserProfile.classList.remove('hidden');
    } catch (e) {
      showToast('Error opening edit form: ' + e.message, 'error');
    }
  });
}

if (btnSaveUserProfileSubmit) {
  btnSaveUserProfileSubmit.addEventListener('click', async () => {
    const name = editUserName.value.trim();
    if (!name) return;

    btnSaveUserProfileSubmit.disabled = true;
    btnSaveUserProfileSubmit.textContent = 'Saving...';

    try {
      await window.familyVault.saveUserProfile({
        name,
        dob: editUserDob.value.trim() || null,
        gender: editUserGender.value || null,
        fathersName: editUserFather.value.trim() || null,
        mothersName: editUserMother.value.trim() || null,
        address: editUserAddress.value.trim() || null,
        marks10th: editUser10th.value.trim() || null,
        marks12th: editUser12th.value.trim() || null,
        education: editUserEducation.value.trim() || null,
        notes: editUserNotes.value.trim() || null
      });

      modalEditUserProfile.classList.add('hidden');
      showToast('Profile saved successfully', 'success');
      await refreshUserProfilesUI(name);
      await refreshFamilyMembersDatalist();
      await updateCounts();
    } catch (err) {
      showToast('Failed to save profile: ' + err.message, 'error');
    } finally {
      btnSaveUserProfileSubmit.disabled = false;
      btnSaveUserProfileSubmit.textContent = 'Save Profile';
    }
  });
}

if (btnOpenAddFamilyMember) {
  btnOpenAddFamilyMember.addEventListener('click', () => {
    clearInlineError('add-member-error-banner');
    addUserName.value = '';
    addUserDob.value = '';
    addUserGender.value = '';
    addUserFather.value = '';
    addUserMother.value = '';
    addUserAddress.value = '';
    addUser10th.value = '';
    addUser12th.value = '';
    addUserEducation.value = '';
    addUserNotes.value = '';
    modalAddFamilyMember.classList.remove('hidden');
    addUserName.focus();
  });
}

if (addUserName) {
  addUserName.addEventListener('input', () => clearInlineError('add-member-error-banner'));
}

if (btnSubmitAddFamilyMember) {
  btnSubmitAddFamilyMember.addEventListener('click', async () => {
    clearInlineError('add-member-error-banner');
    const name = addUserName.value.trim();
    if (!name) {
      showInlineError('add-member-error-banner', 'Please enter a valid family member name.');
      showToast('Please enter a valid family member name', 'error');
      addUserName.focus();
      return;
    }

    // Check for duplicate family member
    try {
      const existingMembers = await window.familyVault.listFamilyMembers();
      if (existingMembers && existingMembers.some(m => m.trim().toLowerCase() === name.toLowerCase())) {
        showInlineError('add-member-error-banner', `A family member named "${name}" already exists in the vault.`);
        showToast(`A family member named "${name}" already exists`, 'warning');
        return;
      }
    } catch (e) {}

    btnSubmitAddFamilyMember.disabled = true;
    btnSubmitAddFamilyMember.textContent = 'Adding...';

    try {
      await window.familyVault.addFamilyMember({
        name,
        dob: addUserDob.value.trim() || null,
        gender: addUserGender.value || null,
        fathersName: addUserFather.value.trim() || null,
        mothersName: addUserMother.value.trim() || null,
        address: addUserAddress.value.trim() || null,
        marks10th: addUser10th.value.trim() || null,
        marks12th: addUser12th.value.trim() || null,
        education: addUserEducation.value.trim() || null,
        notes: addUserNotes.value.trim() || null
      });

      modalAddFamilyMember.classList.add('hidden');
      clearInlineError('add-member-error-banner');
      showToast(`Family member "${name}" added successfully`, 'success');
      await refreshUserProfilesUI(name);
      await refreshFamilyMembersDatalist();
      await updateCounts();
    } catch (err) {
      showInlineError('add-member-error-banner', 'Failed to add family member: ' + err.message);
      showToast('Failed to add family member: ' + err.message, 'error');
    } finally {
      btnSubmitAddFamilyMember.disabled = false;
      btnSubmitAddFamilyMember.textContent = 'Add Member';
    }
  });
}

if (btnRemoveUserProfile) {
  btnRemoveUserProfile.addEventListener('click', () => {
    if (!selectedProfileName) {
      showToast('No family member selected to remove', 'error');
      return;
    }
    removeUserNameConfirm.textContent = selectedProfileName;
    modalConfirmRemoveUser.classList.remove('hidden');
  });
}

if (btnConfirmRemoveUserAction) {
  btnConfirmRemoveUserAction.addEventListener('click', async () => {
    if (!selectedProfileName) return;
    const personToRemove = selectedProfileName;

    btnConfirmRemoveUserAction.disabled = true;
    btnConfirmRemoveUserAction.textContent = 'Removing...';

    try {
      await window.familyVault.removeFamilyMember(personToRemove);
      modalConfirmRemoveUser.classList.add('hidden');
      showToast(`Removed family member "${personToRemove}"`, 'success');
      selectedProfileName = null;
      await refreshUserProfilesUI();
      await refreshFamilyMembersDatalist();
      await updateCounts();
      await loadDocuments();
    } catch (err) {
      showToast('Failed to remove family member: ' + err.message, 'error');
    } finally {
      btnConfirmRemoveUserAction.disabled = false;
      btnConfirmRemoveUserAction.textContent = 'Yes, Remove Member';
    }
  });
}

// --- Quick Add Family Member (Full Name Only) Controller ---
const btnSidebarAddMember = document.getElementById('btn-sidebar-add-member');
const modalQuickAddMember = document.getElementById('modal-quick-add-member');
const formQuickAddMember = document.getElementById('form-quick-add-member');
const quickAddMemberName = document.getElementById('quick-add-member-name');
const btnSubmitQuickAddMember = document.getElementById('btn-submit-quick-add-member');
const btnQuickAddAdvanced = document.getElementById('btn-quick-add-advanced');

const modalFirstRunWelcome = document.getElementById('modal-first-run-welcome');
const firstRunMemberName = document.getElementById('first-run-member-name');
const btnFirstRunAddMember = document.getElementById('btn-first-run-add-member');
const btnFirstRunImportDoc = document.getElementById('btn-first-run-import-doc');
const btnFirstRunSkip = document.getElementById('btn-first-run-skip');

function openQuickAddMemberModal(defaultName = '') {
  clearInlineError('quick-add-error-banner');
  if (modalQuickAddMember && quickAddMemberName) {
    quickAddMemberName.value = defaultName || '';
    modalQuickAddMember.classList.remove('hidden');
    quickAddMemberName.focus();
  }
}

async function submitQuickAddMember(nameToSave, callerModal = 'quick-add') {
  const bannerId = callerModal === 'first-run' ? 'first-run-error-banner' : 'quick-add-error-banner';
  clearInlineError(bannerId);
  const name = (nameToSave || '').trim();
  if (!name) {
    showInlineError(bannerId, 'Please enter the family member full name.');
    showToast('Please enter the family member full name', 'error');
    return false;
  }

  // Duplicate member check
  try {
    const existing = await window.familyVault.listFamilyMembers();
    if (existing && existing.some(m => m.trim().toLowerCase() === name.toLowerCase())) {
      showInlineError(bannerId, `A family member named "${name}" already exists.`);
      showToast(`A family member named "${name}" already exists`, 'warning');
      return false;
    }
  } catch (e) {}

  try {
    await window.familyVault.addFamilyMember({ name });
    clearInlineError(bannerId);
    showToast(`Added family member "${name}"`, 'success');
    await updateCounts();
    await refreshFamilyMembersDatalist();
    await refreshUserProfilesUI(name);
    await loadDocuments();

    // If Import modal is active and has an unmatched user matching this name, autofill person & hide warning
    if (importPersonInput) {
      const importUnmatchedName = document.getElementById('import-unmatched-user-name');
      const importUnmatchedBox = document.getElementById('import-unmatched-user-box');
      if (importUnmatchedName && importUnmatchedName.textContent.trim().toLowerCase() === name.toLowerCase()) {
        importPersonInput.value = name;
        if (importUnmatchedBox) importUnmatchedBox.classList.add('hidden');
        if (preAnalyzedDocData) {
          preAnalyzedDocData.unmatchedPerson = null;
          preAnalyzedDocData.person = name;
        }
      }
    }

    return true;
  } catch (err) {
    showInlineError(bannerId, 'Failed to add family member: ' + err.message);
    showToast('Failed to add family member: ' + err.message, 'error');
    return false;
  }
}

const btnImportAddUnmatchedUser = document.getElementById('btn-import-add-unmatched-user');
if (btnImportAddUnmatchedUser) {
  btnImportAddUnmatchedUser.addEventListener('click', () => {
    const unmatchedName = document.getElementById('import-unmatched-user-name')?.textContent || '';
    if (unmatchedName && unmatchedName !== '-') {
      openQuickAddMemberModal(unmatchedName);
    } else {
      openQuickAddMemberModal();
    }
  });
}

if (quickAddMemberName) {
  quickAddMemberName.addEventListener('input', () => clearInlineError('quick-add-error-banner'));
}

if (firstRunMemberName) {
  firstRunMemberName.addEventListener('input', () => clearInlineError('first-run-error-banner'));
}

if (btnSidebarAddMember) {
  btnSidebarAddMember.addEventListener('click', (e) => {
    e.stopPropagation();
    openQuickAddMemberModal();
  });
}

if (btnSubmitQuickAddMember) {
  btnSubmitQuickAddMember.addEventListener('click', async () => {
    clearInlineError('quick-add-error-banner');
    const name = quickAddMemberName ? quickAddMemberName.value.trim() : '';
    if (!name) {
      showInlineError('quick-add-error-banner', 'Please enter the family member full name.');
      showToast('Please enter the family member full name', 'error');
      if (quickAddMemberName) quickAddMemberName.focus();
      return;
    }
    btnSubmitQuickAddMember.disabled = true;
    btnSubmitQuickAddMember.textContent = 'Adding...';
    const success = await submitQuickAddMember(name, 'quick-add');
    btnSubmitQuickAddMember.disabled = false;
    btnSubmitQuickAddMember.textContent = 'Add Member';
    if (success && modalQuickAddMember) {
      modalQuickAddMember.classList.add('hidden');
    }
  });
}

if (formQuickAddMember) {
  formQuickAddMember.addEventListener('submit', (e) => {
    e.preventDefault();
    if (btnSubmitQuickAddMember) btnSubmitQuickAddMember.click();
  });
}

if (btnQuickAddAdvanced) {
  btnQuickAddAdvanced.addEventListener('click', () => {
    if (modalQuickAddMember) modalQuickAddMember.classList.add('hidden');
    const modalFull = document.getElementById('modal-add-family-member');
    const addNameInput = document.getElementById('add-user-name');
    if (modalFull) {
      modalFull.classList.remove('hidden');
      clearInlineError('add-member-error-banner');
      if (addNameInput && quickAddMemberName) {
        addNameInput.value = quickAddMemberName.value;
        addNameInput.focus();
      }
    }
  });
}

async function checkFirstRunOnboarding(vaultPath) {
  try {
    const members = await window.familyVault.listFamilyMembers();
    const allDocs = await window.familyVault.listDocuments({});
    const storageKey = `fv_welcome_seen_${vaultPath}`;
    const alreadySeen = localStorage.getItem(storageKey);

    if (!alreadySeen && members.length === 0 && allDocs.length === 0) {
      localStorage.setItem(storageKey, 'true');
      if (modalFirstRunWelcome) {
        clearInlineError('first-run-error-banner');
        modalFirstRunWelcome.classList.remove('hidden');
        if (firstRunMemberName) {
          firstRunMemberName.value = '';
          firstRunMemberName.focus();
        }
      }
    }
  } catch (e) {}
}

if (btnFirstRunAddMember && firstRunMemberName) {
  const handleFirstRunAdd = async () => {
    clearInlineError('first-run-error-banner');
    const name = firstRunMemberName.value.trim();
    if (!name) {
      showInlineError('first-run-error-banner', 'Please enter a full name.');
      showToast('Please enter a full name', 'error');
      firstRunMemberName.focus();
      return;
    }
    btnFirstRunAddMember.disabled = true;
    btnFirstRunAddMember.textContent = 'Adding...';
    const success = await submitQuickAddMember(name, 'first-run');
    btnFirstRunAddMember.disabled = false;
    btnFirstRunAddMember.textContent = 'Add Member';
    if (success && modalFirstRunWelcome) {
      modalFirstRunWelcome.classList.add('hidden');
    }
  };

  btnFirstRunAddMember.addEventListener('click', handleFirstRunAdd);
  firstRunMemberName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFirstRunAdd();
    }
  });
}

if (btnFirstRunImportDoc) {
  btnFirstRunImportDoc.addEventListener('click', () => {
    if (modalFirstRunWelcome) modalFirstRunWelcome.classList.add('hidden');
    const btnOpenImport = document.getElementById('btn-open-import');
    if (btnOpenImport) btnOpenImport.click();
  });
}

if (btnFirstRunSkip) {
  btnFirstRunSkip.addEventListener('click', () => {
    if (modalFirstRunWelcome) modalFirstRunWelcome.classList.add('hidden');
  });
}

// Global UI Error Boundaries
window.addEventListener('error', (event) => {
  console.error('Unhandled UI Error:', event.error || event.message);
  showToast('An unexpected interface error occurred.', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
  showToast('Operation failed: ' + (event.reason?.message || 'Unknown error'), 'error');
});

function closeAllModals() {
  modalImport.classList.add('hidden');
  modalNewVersion.classList.add('hidden');
  modalReviewMetadata.classList.add('hidden');
  modalAiQa.classList.add('hidden');
  modalChangePassword.classList.add('hidden');
  if (modalAuditLogs) modalAuditLogs.classList.add('hidden');
  if (modalDownloadModel) modalDownloadModel.classList.add('hidden');
  if (modalConfirmDelete) modalConfirmDelete.classList.add('hidden');
  if (modalUsersProfiles) modalUsersProfiles.classList.add('hidden');
  if (modalEditUserProfile) modalEditUserProfile.classList.add('hidden');
  if (modalAddFamilyMember) modalAddFamilyMember.classList.add('hidden');
  if (modalConfirmRemoveUser) modalConfirmRemoveUser.classList.add('hidden');
  if (modalQuickAddMember) modalQuickAddMember.classList.add('hidden');
  if (modalFirstRunWelcome) modalFirstRunWelcome.classList.add('hidden');
  documentIdPendingDelete = null;
}

// Modal close button handlers
document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', closeAllModals);
});

// Dismiss modals on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllModals();
  }
});

// Dismiss modals on backdrop overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeAllModals();
    }
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
