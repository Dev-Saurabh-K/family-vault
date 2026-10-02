'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

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
