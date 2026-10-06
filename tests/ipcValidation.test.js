'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

const { readObject } = require('../src/main/vault/objectStore');
const { parseAndValidateManifest } = require('../src/main/vault/manifest');

test('Security & Validation: Path traversal attempts in objectStore are neutralized', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-security-test-'));
  const dummyKey = Buffer.alloc(32, 1);

  // Attempt to read with path traversal characters '../secret'
  assert.throws(() => {
    readObject(tmpDir, dummyKey, '../../etc/passwd');
  }, /Encrypted object not found/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Security & Validation: Manifest schema strictly rejects missing or tampered fields', () => {
  // Missing kdf
  assert.throws(() => {
    parseAndValidateManifest({
      formatVersion: '1.0.0',
      vaultId: '11111111-1111-4111-8111-111111111111',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      keyWrap: {
        algorithm: 'aes-256-gcm',
        iv: Buffer.alloc(12).toString('base64'),
        authTag: Buffer.alloc(16).toString('base64'),
        wrappedVmk: Buffer.alloc(32).toString('base64')
      }
    });
  }, /Invalid or tampered manifest format/);

  // Invalid UUID
  assert.throws(() => {
    parseAndValidateManifest({
      formatVersion: '1.0.0',
      vaultId: 'invalid-non-uuid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      kdf: {
        algorithm: 'argon2id',
        params: { memoryCost: 65536, timeCost: 3, parallelism: 1, salt: 'c2FsdA==' }
      },
      keyWrap: {
        algorithm: 'aes-256-gcm',
        iv: Buffer.alloc(12).toString('base64'),
        authTag: Buffer.alloc(16).toString('base64'),
        wrappedVmk: Buffer.alloc(32).toString('base64')
      }
    });
  }, /Invalid or tampered manifest format/);
});

test('AI model download IPC passes the selected variant before its progress callback', async () => {
  const ipcPath = require.resolve('../src/main/ipc');
  const handlers = new Map();
  const calls = [];
  const llmService = {
    downloadAndSetupGemma: async (variant, onProgress) => {
      calls.push(variant);
      onProgress({ percent: 50 });
      return { success: true, modelVariant: variant };
    }
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: () => {}
  };
  const originalLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (parent?.filename === ipcPath && request === 'electron') return { ipcMain, dialog: {} };
    if (parent?.filename === ipcPath && request === './vault/vaultService') return { vaultService: {} };
    if (parent?.filename === ipcPath && request === './services/llmService') return { llmService };
    return originalLoad.call(this, request, parent, isMain);
  };

  let registerIpcHandlers;
  try {
    delete require.cache[ipcPath];
    ({ registerIpcHandlers } = require('../src/main/ipc'));
  } finally {
    Module._load = originalLoad;
    delete require.cache[ipcPath];
  }

  const sentProgress = [];
  registerIpcHandlers({
    isDestroyed: () => false,
    webContents: { send: (_channel, progress) => sentProgress.push(progress) }
  });
  const downloadHandler = handlers.get('ai:download-gemma');
  const result = await downloadHandler({}, { modelVariant: 'E4B' });

  assert.deepStrictEqual(calls, ['E4B']);
  assert.deepStrictEqual(result, { success: true, modelVariant: 'E4B' });
  assert.deepStrictEqual(sentProgress, [{ percent: 50 }]);
  await assert.rejects(downloadHandler({}, { modelVariant: 'E3B' }));
});
