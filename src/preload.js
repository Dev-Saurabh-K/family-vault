'use strict';

/**
 * Preload script exposing a narrow, strictly typed API to renderer.
 * Context isolation is enabled; Node integration is disabled.
 */

const { contextBridge, ipcRenderer } = require('electron');
let nextAiRequestId = 0;

contextBridge.exposeInMainWorld('familyVault', {
  // Window controls
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // Vault status & lifecycle
  getStatus: () => ipcRenderer.invoke('vault:status'),
  createVault: (args) => ipcRenderer.invoke('vault:create', args),
  unlockVault: (args) => ipcRenderer.invoke('vault:unlock', args),
  lockVault: () => ipcRenderer.invoke('vault:lock'),
  changePassword: (args) => ipcRenderer.invoke('vault:change-password', args),

  // File pickers
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectFile: () => ipcRenderer.invoke('dialog:select-file'),
  saveFileDialog: (args) => ipcRenderer.invoke('dialog:save-file', args),
  selectBackupFile: () => ipcRenderer.invoke('dialog:select-backup-file'),
  saveBackupFileDialog: (args) => ipcRenderer.invoke('dialog:save-backup-file', args),

  // Backup & Restore & Security Logs
  createBackup: (destinationFilePath) => ipcRenderer.invoke('vault:create-backup', { destinationFilePath }),
  restoreBackup: (args) => ipcRenderer.invoke('vault:restore-backup', args),
  getAuditLogs: (limit) => ipcRenderer.invoke('vault:get-audit-logs', { limit }),
  exportAuditLogs: (destinationPath) => ipcRenderer.invoke('vault:export-audit-logs', { destinationPath }),

  // Document management
  preAnalyzeDocument: (filePath) => ipcRenderer.invoke('document:pre-analyze', { filePath }),
  listFamilyMembers: () => ipcRenderer.invoke('vault:list-family-members'),
  importDocument: (args) => ipcRenderer.invoke('document:import', args),
  addDocumentVersion: (args) => ipcRenderer.invoke('document:add-version', args),
  listDocuments: (filters) => ipcRenderer.invoke('document:list', filters),
  getDocument: (documentId) => ipcRenderer.invoke('document:get', { documentId }),
  getVersionPreview: (versionId) => ipcRenderer.invoke('document:get-version-preview', { versionId }),
  exportVersion: (args) => ipcRenderer.invoke('document:export-version', args),
  updateMetadata: (args) => ipcRenderer.invoke('document:update-metadata', args),
  updateDocumentMetadata: (args) => ipcRenderer.invoke('document:update-doc-metadata', args),
  deleteDocument: (documentId) => ipcRenderer.invoke('document:delete', { documentId }),
  getUpcomingExpiries: () => ipcRenderer.invoke('document:upcoming-expiries'),
  searchSemantic: (args) => ipcRenderer.invoke('search:semantic', args),

  // Grounded local AI Q&A
  askQuestion: (query, options = {}) => ipcRenderer.invoke('ai:ask', {
    query,
    searchAllDocuments: options.searchAllDocuments === true
  }),
  askQuestionStream: (query, onChunk, options = {}) => {
    const requestId = `${Date.now()}-${++nextAiRequestId}-${Math.random().toString(36).slice(2)}`;
    const handler = (_event, payload) => {
      if (payload.requestId === requestId && typeof payload.chunk === 'string') {
        onChunk(payload.chunk);
      }
    };
    ipcRenderer.on('ai:answer-chunk', handler);
    return ipcRenderer.invoke('ai:ask-stream', {
      query,
      requestId,
      searchAllDocuments: options.searchAllDocuments === true
    })
      .finally(() => ipcRenderer.removeListener('ai:answer-chunk', handler));
  },
  getAiStatus: () => ipcRenderer.invoke('ai:status'),
  selectModelFile: () => ipcRenderer.invoke('dialog:select-model-file'),
  selectLlamaServer: () => ipcRenderer.invoke('dialog:select-llama-server'),
  startAiServer: (args) => ipcRenderer.invoke('ai:start-server', args),
  stopAiServer: () => ipcRenderer.invoke('ai:stop-server'),
  downloadGemmaModel: (modelVariant = 'E2B') => ipcRenderer.invoke('ai:download-gemma', modelVariant),
  onAiDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ai:download-progress', handler);
    return () => ipcRenderer.removeListener('ai:download-progress', handler);
  },

  // User profiles & contradiction detection
  listUserProfiles: () => ipcRenderer.invoke('profile:list'),
  getUserProfile: (personName) => ipcRenderer.invoke('profile:get', { personName }),
  saveUserProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  addFamilyMember: (profile) => ipcRenderer.invoke('profile:add', profile),
  removeFamilyMember: (personName) => ipcRenderer.invoke('profile:remove', { personName })
});
