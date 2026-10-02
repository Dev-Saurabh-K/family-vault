'use strict';

/**
 * Vault Manifest schema validation and persistence.
 * Adheres to ARCHITECTURE.md: "manifest.json (format/schema/crypto versions, vault ID, wrapped key metadata)"
 * Adheres to SECURITY.md: "Vault manifests may contain non-secret format and KDF metadata plus wrapped-key material.
 * They must be versioned and authenticated; treat any tampering or failed authentication as an unlock/storage error"
 */

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');

const MANIFEST_FILE_NAME = 'manifest.json';
const CURRENT_FORMAT_VERSION = '1.0.0';

const ManifestSchema = z.object({
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  vaultId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  kdf: z.object({
    algorithm: z.literal('argon2id'),
    params: z.object({
      memoryCost: z.number().int().min(1024),
      timeCost: z.number().int().min(1),
      parallelism: z.number().int().min(1),
      salt: z.string().base64()
    })
  }),
  keyWrap: z.object({
    algorithm: z.literal('aes-256-gcm'),
    iv: z.string().base64(),
    authTag: z.string().base64(),
    wrappedVmk: z.string().base64()
  })
});

/**
 * Creates a new valid manifest object.
 */
function createManifest({ vaultId, kdfParams, salt, wrapData }) {
  const now = new Date().toISOString();
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    vaultId,
    createdAt: now,
    updatedAt: now,
    kdf: {
      algorithm: 'argon2id',
      params: {
        memoryCost: kdfParams.memoryCost,
        timeCost: kdfParams.timeCost,
        parallelism: kdfParams.parallelism,
        salt: salt.toString('base64')
      }
    },
    keyWrap: {
      algorithm: 'aes-256-gcm',
      iv: wrapData.iv.toString('base64'),
      authTag: wrapData.authTag.toString('base64'),
      wrappedVmk: wrapData.wrappedKey.toString('base64')
    }
  };

  return ManifestSchema.parse(manifest);
}

/**
 * Parses and validates an arbitrary manifest object or string.
 */
function parseAndValidateManifest(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Corrupted manifest: Invalid JSON syntax (${err.message})`);
    }
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid or tampered manifest format: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  return result.data;
}

/**
 * Reads and validates the manifest from a vault directory.
 */
function readManifest(vaultPath) {
  const manifestPath = path.join(vaultPath, MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Vault manifest missing at ${manifestPath}`);
  }
  const rawContent = fs.readFileSync(manifestPath, 'utf-8');
  return parseAndValidateManifest(rawContent);
}

/**
 * Atomically writes the manifest to the vault directory.
 */
function writeManifest(vaultPath, manifest) {
  const validated = parseAndValidateManifest(manifest);
  const manifestPath = path.join(vaultPath, MANIFEST_FILE_NAME);
  const tempPath = path.join(vaultPath, `${MANIFEST_FILE_NAME}.tmp-${Date.now()}`);

  fs.writeFileSync(tempPath, JSON.stringify(validated, null, 2), 'utf-8');
  fs.renameSync(tempPath, manifestPath);
}

module.exports = {
  MANIFEST_FILE_NAME,
  CURRENT_FORMAT_VERSION,
  ManifestSchema,
  createManifest,
  parseAndValidateManifest,
  readManifest,
  writeManifest
};
