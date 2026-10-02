'use strict';

/**
 * Preload script exposing a narrow, strictly typed API to renderer.
 * Context isolation is enabled; Node integration is disabled.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('familyVault', {
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
  importDocument: (args) => ipcRenderer.invoke('document:import', args),
  addDocumentVersion: (args) => ipcRenderer.invoke('document:add-version', args),
  listDocuments: (filters) => ipcRenderer.invoke('document:list', filters),
  getDocument: (documentId) => ipcRenderer.invoke('document:get', { documentId }),
  getVersionPreview: (versionId) => ipcRenderer.invoke('document:get-version-preview', { versionId }),
  exportVersion: (args) => ipcRenderer.invoke('document:export-version', args),
  updateMetadata: (args) => ipcRenderer.invoke('document:update-metadata', args),
  getUpcomingExpiries: () => ipcRenderer.invoke('document:upcoming-expiries'),
  searchSemantic: (args) => ipcRenderer.invoke('search:semantic', args),

  // Grounded local AI Q&A
  askQuestion: (query) => ipcRenderer.invoke('ai:ask', { query }),
  getAiStatus: () => ipcRenderer.invoke('ai:status'),
  selectModelFile: () => ipcRenderer.invoke('dialog:select-model-file'),
  selectLlamaServer: () => ipcRenderer.invoke('dialog:select-llama-server'),
  startAiServer: (args) => ipcRenderer.invoke('ai:start-server', args),
  stopAiServer: () => ipcRenderer.invoke('ai:stop-server'),
  downloadGemmaModel: () => ipcRenderer.invoke('ai:download-gemma'),
  onAiDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ai:download-progress', handler);
    return () => ipcRenderer.removeListener('ai:download-progress', handler);
  }
});
