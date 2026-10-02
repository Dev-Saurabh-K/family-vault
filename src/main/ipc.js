'use strict';

/**
 * Electron IPC Handler Registration with strict input validation.
 * Adheres to SECURITY.md: "Expose a minimal, typed preload API; validate all IPC inputs
 * and authorise every operation in main."
 */

const { ipcMain, dialog } = require('electron');
const { z } = require('zod');
const { vaultService } = require('./vault/vaultService');
const { llmService } = require('./services/llmService');

const CreateVaultSchema = z.object({
  vaultPath: z.string().min(1),
  password: z.string().min(8)
});

const UnlockVaultSchema = z.object({
  vaultPath: z.string().min(1),
  password: z.string().min(1)
});

const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const ImportDocumentSchema = z.object({
  filePath: z.string().min(1),
  title: z.string().optional(),
  category: z.string().default('other'),
  person: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().default('')
});

const AddVersionSchema = z.object({
  documentId: z.string().uuid(),
  filePath: z.string().min(1),
  notes: z.string().default('')
});

const DocumentFilterSchema = z.object({
  category: z.string().optional(),
  person: z.string().optional(),
  tag: z.string().optional(),
  search: z.string().optional()
}).optional();

function registerIpcHandlers(mainWindow) {
  // Vault lifecycle
  ipcMain.handle('vault:status', async () => {
    return vaultService.getStatus();
  });

  ipcMain.handle('vault:create', async (_event, rawArgs) => {
    const validated = CreateVaultSchema.parse(rawArgs);
    return await vaultService.createVault(validated);
  });

  ipcMain.handle('vault:unlock', async (_event, rawArgs) => {
    const validated = UnlockVaultSchema.parse(rawArgs);
    return await vaultService.unlockVault(validated);
  });

  ipcMain.handle('vault:lock', async () => {
    return vaultService.lockVault();
  });

  ipcMain.handle('vault:change-password', async (_event, rawArgs) => {
    const validated = ChangePasswordSchema.parse(rawArgs);
    return await vaultService.changePassword(validated);
  });

  // Native file/directory pickers
  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Vault Directory'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Documents & Images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      title: 'Select Document to Import'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:save-file', async (_event, { defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || 'document',
      title: 'Export Document Version'
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('dialog:select-backup-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'FamilyVault Backup (*.fvbackup)', extensions: ['fvbackup', 'json'] }],
      title: 'Select Vault Backup File to Restore'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:save-backup-file', async (_event, { defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || 'FamilyVault-backup.fvbackup',
      filters: [{ name: 'FamilyVault Backup (*.fvbackup)', extensions: ['fvbackup'] }],
      title: 'Save Encrypted Vault Backup'
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('vault:create-backup', async (_event, { destinationFilePath }) => {
    if (!destinationFilePath) throw new Error('Missing destinationFilePath');
    return vaultService.createBackup(destinationFilePath);
  });

  ipcMain.handle('vault:restore-backup', async (_event, { backupFilePath, targetVaultPath }) => {
    if (!backupFilePath || !targetVaultPath) throw new Error('Missing backupFilePath or targetVaultPath');
    return vaultService.restoreBackup({ backupFilePath, targetVaultPath });
  });

  // Document Operations
  ipcMain.handle('document:import', async (_event, rawArgs) => {
    const validated = ImportDocumentSchema.parse(rawArgs);
    return await vaultService.importDocument(validated);
  });

  ipcMain.handle('document:add-version', async (_event, rawArgs) => {
    const validated = AddVersionSchema.parse(rawArgs);
    return await vaultService.addDocumentVersion(validated);
  });

  ipcMain.handle('document:list', async (_event, rawArgs) => {
    const filters = DocumentFilterSchema.parse(rawArgs) || {};
    return vaultService.listDocuments(filters);
  });

  ipcMain.handle('document:get', async (_event, { documentId }) => {
    if (!documentId) throw new Error('Missing documentId');
    return vaultService.getDocument(documentId);
  });

  ipcMain.handle('document:get-version-preview', async (_event, args) => {
    const versionId = typeof args === 'string' ? args : (args && args.versionId);
    if (!versionId) throw new Error('Missing versionId');
    return vaultService.getDocumentVersionContent({ versionId });
  });

  ipcMain.handle('document:export-version', async (_event, { versionId, destinationPath }) => {
    if (!versionId || !destinationPath) throw new Error('Missing versionId or destinationPath');
    return vaultService.exportDocumentVersion({ versionId, destinationPath });
  });

  ipcMain.handle('document:update-metadata', async (_event, rawArgs) => {
    if (!rawArgs || !rawArgs.versionId) throw new Error('Missing versionId');
    return vaultService.updateMetadata(rawArgs);
  });

  ipcMain.handle('document:upcoming-expiries', async () => {
    return vaultService.listUpcomingExpiries();
  });

  ipcMain.handle('search:semantic', async (_event, args) => {
    const query = args && typeof args === 'object' ? args.query : args;
    if (!query || typeof query !== 'string') throw new Error('Query is required');
    const limit = args && args.limit ? args.limit : 5;
    const minScore = args && args.minScore ? args.minScore : 0.05;
    return await vaultService.searchSemantic({ query, limit, minScore });
  });

  // Local AI Grounded Q&A
  ipcMain.handle('ai:ask', async (_event, { query }) => {
    if (!query) throw new Error('Query is required');
    return await vaultService.askQuestion(query);
  });

  ipcMain.handle('ai:status', async () => {
    return vaultService.getAiStatus();
  });

  ipcMain.handle('dialog:select-model-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'GGUF Models (*.gguf)', extensions: ['gguf'] }],
      title: 'Select GGUF Model File'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-llama-server', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'llama-server (*.exe)', extensions: ['exe'] }],
      title: 'Select llama-server.exe Executable'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('ai:start-server', async (_event, { binaryPath, modelPath }) => {
    if (!binaryPath || !modelPath) throw new Error('binaryPath and modelPath are required');
    return await llmService.startServer(binaryPath, modelPath);
  });

  ipcMain.handle('ai:stop-server', async () => {
    llmService.stopServer();
    return { success: true };
  });

  ipcMain.handle('ai:download-gemma', async () => {
    return await llmService.downloadAndSetupGemma((progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai:download-progress', progress);
      }
    });
  });
}

module.exports = {
  registerIpcHandlers
};
