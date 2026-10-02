'use strict';

/**
 * Portable Encrypted Vault Backup and Restore Service.
 * Adheres to ARCHITECTURE.md: "Backups are portable encrypted vault backups; they preserve enough
 * manifest, object, version, and database data to restore safely."
 * Adheres to SECURITY.md: "Vault portability without weakening password-based protection."
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseAndValidateManifest } = require('./manifest');

const BACKUP_FORMAT_VERSION = '1.0.0';

/**
 * Creates an encrypted, standalone portable backup file from an existing vault.
 * All contents remain encrypted at rest.
 * @param {string} vaultPath 
 * @param {string} destinationFilePath 
 * @returns {{ backupFilePath: string, objectCount: number, totalBytes: number }}
 */
function createVaultBackup(vaultPath, destinationFilePath) {
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault directory does not exist: ${vaultPath}`);
  }

  // 1. Read and validate manifest
  const manifestPath = path.join(vaultPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Invalid vault: manifest.json is missing');
  }
  const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = parseAndValidateManifest(manifestRaw);

  // 2. Read encrypted database
  const dbPath = path.join(vaultPath, 'vault.db');
  let dbBase64 = null;
  if (fs.existsSync(dbPath)) {
    dbBase64 = fs.readFileSync(dbPath).toString('base64');
  }

  // 3. Read encrypted objects
  const objectsDir = path.join(vaultPath, 'objects');
  const objects = [];
  if (fs.existsSync(objectsDir)) {
    const files = fs.readdirSync(objectsDir);
    for (const file of files) {
      if (file.endsWith('.enc')) {
        const filePath = path.join(objectsDir, file);
        const data = fs.readFileSync(filePath).toString('base64');
        objects.push({ fileName: file, data });
      }
    }
  }

  const backupPayload = {
    backupFormat: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    vaultId: manifest.vaultId,
    manifest,
    database: dbBase64,
    objects
  };

  const jsonString = JSON.stringify(backupPayload);
  const integritySha256 = crypto.createHash('sha256').update(jsonString).digest('hex');

  const finalPackage = JSON.stringify({
    integritySha256,
    payload: backupPayload
  }, null, 2);

  const tempBackup = `${destinationFilePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tempBackup, finalPackage, 'utf-8');
  fs.renameSync(tempBackup, destinationFilePath);

  const stat = fs.statSync(destinationFilePath);

  return {
    backupFilePath: destinationFilePath,
    objectCount: objects.length,
    totalBytes: stat.size
  };
}

/**
 * Restores a vault from a portable encrypted backup file into a target directory.
 * @param {string} backupFilePath 
 * @param {string} targetVaultPath 
 * @returns {{ vaultPath: string, vaultId: string, objectCount: number }}
 */
function restoreVaultBackup(backupFilePath, targetVaultPath) {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file does not exist: ${backupFilePath}`);
  }

  const rawContent = fs.readFileSync(backupFilePath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (e) {
    throw new Error('Corrupted backup file: Invalid JSON format');
  }

  if (!parsed.integritySha256 || !parsed.payload) {
    throw new Error('Invalid backup file: Missing integrity header or payload');
  }

  // Verify integrity
  const expectedHash = crypto.createHash('sha256').update(JSON.stringify(parsed.payload)).digest('hex');
  if (expectedHash !== parsed.integritySha256) {
    throw new Error('Integrity verification failed: Backup package has been tampered with or corrupted');
  }

  const { manifest, database, objects, backupFormat } = parsed.payload;

  if (backupFormat !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version: ${backupFormat}`);
  }

  // Validate manifest structure
  parseAndValidateManifest(manifest);

  // Prepare target directory
  if (fs.existsSync(targetVaultPath)) {
    const contents = fs.readdirSync(targetVaultPath);
    if (contents.length > 0) {
      throw new Error('Target restore directory must be empty');
    }
  } else {
    fs.mkdirSync(targetVaultPath, { recursive: true });
  }

  // 1. Write manifest.json
  fs.writeFileSync(path.join(targetVaultPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 2. Write database
  if (database) {
    fs.writeFileSync(path.join(targetVaultPath, 'vault.db'), Buffer.from(database, 'base64'));
  }

  // 3. Write objects
  const objectsDir = path.join(targetVaultPath, 'objects');
  fs.mkdirSync(objectsDir, { recursive: true });

  const derivedDir = path.join(targetVaultPath, 'derived');
  fs.mkdirSync(derivedDir, { recursive: true });

  for (const obj of objects) {
    const safeFileName = path.basename(obj.fileName);
    fs.writeFileSync(path.join(objectsDir, safeFileName), Buffer.from(obj.data, 'base64'));
  }

  return {
    vaultPath: targetVaultPath,
    vaultId: manifest.vaultId,
    objectCount: objects.length
  };
}

module.exports = {
  BACKUP_FORMAT_VERSION,
  createVaultBackup,
  restoreVaultBackup
};
