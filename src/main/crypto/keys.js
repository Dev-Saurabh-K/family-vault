'use strict';

/**
 * Key lifecycle and subkey derivation using HKDF-SHA256.
 * Adheres to SECURITY.md: "The password is never the vault encryption key. The VMK is generated
 * randomly when a vault is created... derived/separated keys for SQLCipher database and encrypted objects."
 */

const crypto = require('node:crypto');

const VMK_BYTE_LENGTH = 32;

/**
 * Generates a cryptographically secure random 256-bit Vault Master Key.
 * @returns {Buffer} 32-byte Buffer
 */
function generateVmk() {
  return crypto.randomBytes(VMK_BYTE_LENGTH);
}

/**
 * Derives separated purpose-specific subkeys from the VMK using HKDF-SHA256.
 * @param {Buffer} vmk 32-byte Vault Master Key
 * @param {string} vaultId Stable Vault ID as HKDF salt
 * @returns {{ dbKey: Buffer, objectKey: Buffer }}
 */
function deriveSubkeys(vmk, vaultId) {
  if (!Buffer.isBuffer(vmk) || vmk.length !== VMK_BYTE_LENGTH) {
    throw new Error('VMK must be a 32-byte Buffer');
  }
  if (!vaultId || typeof vaultId !== 'string') {
    throw new Error('vaultId must be a non-empty string');
  }

  const salt = Buffer.from(vaultId, 'utf-8');

  const dbKey = Buffer.from(
    crypto.hkdfSync('sha256', vmk, salt, 'family-vault:db', 32)
  );

  const objectKey = Buffer.from(
    crypto.hkdfSync('sha256', vmk, salt, 'family-vault:objects', 32)
  );

  return { dbKey, objectKey };
}

/**
 * Securely overwrites a sensitive key buffer with zeros in memory.
 * @param {Buffer} buffer 
 */
function zeroizeBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

module.exports = {
  VMK_BYTE_LENGTH,
  generateVmk,
  deriveSubkeys,
  zeroizeBuffer
};
