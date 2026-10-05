'use strict';

const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const { registerIpcHandlers } = require('./main/ipc');
const { vaultService } = require('./main/vault/vaultService');
const { llmService } = require('./main/services/llmService');
const { paddleOcrService } = require('./main/services/paddleOcrService');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'FamilyVault',
    icon: path.join(__dirname, 'assets', 'family-vault-logo.png'),
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
  });

  // Strict Content Security Policy ensuring complete offline operation
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none';"
        ]
      }
    });
  });

  registerIpcHandlers(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(() => {
  createWindow();

  // Attempt auto-detection of local llama-server and model if present
  llmService.autoDetectAndStart().catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  // Lock vault and zeroize all sensitive keys in memory before closing
  try {
    vaultService.lockVault();
    llmService.stopServer();
    paddleOcrService.destroy().catch(() => {});
  } catch (e) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
