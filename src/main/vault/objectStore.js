'use strict';

/**
 * Encrypted Object Storage.
 * Adheres to ARCHITECTURE.md: "encrypted immutable document objects... identity is independent of filename."
 * Adheres to SECURITY.md: "Original document objects are encrypted independently with authenticated encryption and integrity verification."
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');
const { encryptObjectBuffer, decryptObjectBuffer } = require('../crypto/cipher');

const OBJECTS_DIR_NAME = 'objects';

/**
 * Ensures the objects directory exists within the vault.
 */
function ensureObjectsDir(vaultPath) {
  const objectsDir = path.join(vaultPath, OBJECTS_DIR_NAME);
  if (!fs.existsSync(objectsDir)) {
    fs.mkdirSync(objectsDir, { recursive: true });
  }
  return objectsDir;
}

/**
 * Stores a document's plaintext bytes as an encrypted authenticated object.
 * @param {string} vaultPath 
 * @param {Buffer} objectKey 
 * @param {Buffer} plaintextBuffer 
 * @returns {{ objectId: string, sha256: string, byteLength: number }}
 */
function storeObject(vaultPath, objectKey, plaintextBuffer) {
  if (!Buffer.isBuffer(plaintextBuffer)) {
    throw new Error('Plaintext must be provided as a Buffer');
  }

  const objectsDir = ensureObjectsDir(vaultPath);
  const objectId = uuidv4();
  const sha256 = crypto.createHash('sha256').update(plaintextBuffer).digest('hex');
  const byteLength = plaintextBuffer.length;

  const encryptedEnvelope = encryptObjectBuffer(plaintextBuffer, objectKey);

  const objectFilePath = path.join(objectsDir, `${objectId}.enc`);
  const tempFilePath = path.join(objectsDir, `${objectId}.enc.tmp-${Date.now()}`);

  fs.writeFileSync(tempFilePath, encryptedEnvelope);
  fs.renameSync(tempFilePath, objectFilePath);

  return { objectId, sha256, byteLength };
}

/**
 * Reads and decrypts an object by its ID, verifying authentication.
 * @param {string} vaultPath 
 * @param {Buffer} objectKey 
 * @param {string} objectId 
 * @returns {Buffer} Decrypted plaintext buffer
 */
function readObject(vaultPath, objectKey, objectId) {
  if (!objectId || typeof objectId !== 'string') {
    throw new Error('Invalid objectId');
  }

  // Path traversal guard
  const safeFilename = path.basename(objectId);
  const objectFilePath = path.join(vaultPath, OBJECTS_DIR_NAME, `${safeFilename}.enc`);

  if (!fs.existsSync(objectFilePath)) {
    throw new Error(`Encrypted object not found: ${objectId}`);
  }

  const encryptedEnvelope = fs.readFileSync(objectFilePath);
  return decryptObjectBuffer(encryptedEnvelope, objectKey);
}

/**
 * Checks if an object exists in storage.
 */
function hasObject(vaultPath, objectId) {
  const safeFilename = path.basename(objectId);
  const objectFilePath = path.join(vaultPath, OBJECTS_DIR_NAME, `${safeFilename}.enc`);
  return fs.existsSync(objectFilePath);
}

module.exports = {
  OBJECTS_DIR_NAME,
  ensureObjectsDir,
  storeObject,
  readObject,
  hasObject
};
