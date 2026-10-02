'use strict';

/**
 * AES-256-GCM authenticated cipher operations for:
 * 1. Vault Master Key (VMK) wrapping and unwrapping
 * 2. Immutable document object encryption and decryption
 */

const crypto = require('node:crypto');
const stream = require('node:stream');
const { pipeline } = require('node:stream/promises');

const OBJECT_HEADER_MAGIC = Buffer.from('FVOBJ001', 'ascii'); // 8 bytes
const GCM_IV_LENGTH = 12; // 96 bits standard for AES-GCM
const GCM_TAG_LENGTH = 16; // 128 bits standard auth tag

/**
 * Wraps a key (e.g. 256-bit VMK) using AES-256-GCM and a KEK.
 * @param {Buffer} keyToWrap 
 * @param {Buffer} kek 
 * @returns {{ iv: Buffer, authTag: Buffer, wrappedKey: Buffer }}
 */
function wrapKey(keyToWrap, kek) {
  if (!Buffer.isBuffer(keyToWrap) || keyToWrap.length !== 32) {
    throw new Error('Key to wrap must be a 32-byte Buffer');
  }
  if (!Buffer.isBuffer(kek) || kek.length !== 32) {
    throw new Error('KEK must be a 32-byte Buffer');
  }

  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  
  const wrappedKey = Buffer.concat([
    cipher.update(keyToWrap),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return { iv, authTag, wrappedKey };
}

/**
 * Unwraps an encrypted key using AES-256-GCM and verifies the authentication tag.
 * @param {{ iv: Buffer, authTag: Buffer, wrappedKey: Buffer }} wrapData 
 * @param {Buffer} kek 
 * @returns {Buffer} Unwrapped 32-byte key
 */
function unwrapKey({ iv, authTag, wrappedKey }, kek) {
  if (!Buffer.isBuffer(kek) || kek.length !== 32) {
    throw new Error('KEK must be a 32-byte Buffer');
  }
  if (!Buffer.isBuffer(iv) || iv.length !== GCM_IV_LENGTH) {
    throw new Error(`IV must be a ${GCM_IV_LENGTH}-byte Buffer`);
  }
  if (!Buffer.isBuffer(authTag) || authTag.length !== GCM_TAG_LENGTH) {
    throw new Error(`Auth tag must be a ${GCM_TAG_LENGTH}-byte Buffer`);
  }
  if (!Buffer.isBuffer(wrappedKey)) {
    throw new Error('wrappedKey must be a Buffer');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(authTag);

  try {
    const unwrapped = Buffer.concat([
      decipher.update(wrappedKey),
      decipher.final()
    ]);
    return unwrapped;
  } catch (err) {
    throw new Error('Authentication failed: Invalid password or corrupted key data');
  }
}

/**
 * Encrypts an object buffer using AES-256-GCM with envelope:
 * [Magic: 8B][IV: 12B][AuthTag: 16B][Ciphertext: ...B]
 * @param {Buffer} plaintextBuffer 
 * @param {Buffer} objectKey 32-byte key
 * @returns {Buffer} Encrypted object envelope
 */
function encryptObjectBuffer(plaintextBuffer, objectKey) {
  if (!Buffer.isBuffer(plaintextBuffer)) {
    throw new Error('Plaintext must be a Buffer');
  }
  if (!Buffer.isBuffer(objectKey) || objectKey.length !== 32) {
    throw new Error('Object key must be a 32-byte Buffer');
  }

  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', objectKey, iv);
  
  // Set AAD to magic header to authenticate format
  cipher.setAAD(OBJECT_HEADER_MAGIC);

  const ciphertext = Buffer.concat([
    cipher.update(plaintextBuffer),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([
    OBJECT_HEADER_MAGIC,
    iv,
    authTag,
    ciphertext
  ]);
}

/**
 * Decrypts an encrypted object buffer envelope and verifies authenticated integrity.
 * @param {Buffer} encryptedEnvelope 
 * @param {Buffer} objectKey 32-byte key
 * @returns {Buffer} Decrypted plaintext buffer
 */
function decryptObjectBuffer(encryptedEnvelope, objectKey) {
  if (!Buffer.isBuffer(encryptedEnvelope)) {
    throw new Error('Encrypted envelope must be a Buffer');
  }
  if (!Buffer.isBuffer(objectKey) || objectKey.length !== 32) {
    throw new Error('Object key must be a 32-byte Buffer');
  }

  const minLength = OBJECT_HEADER_MAGIC.length + GCM_IV_LENGTH + GCM_TAG_LENGTH;
  if (encryptedEnvelope.length < minLength) {
    throw new Error('Corrupted object: Envelope is smaller than required header');
  }

  const magic = encryptedEnvelope.subarray(0, OBJECT_HEADER_MAGIC.length);
  if (!magic.equals(OBJECT_HEADER_MAGIC)) {
    throw new Error('Invalid object format: Magic header does not match');
  }

  let offset = OBJECT_HEADER_MAGIC.length;
  const iv = encryptedEnvelope.subarray(offset, offset + GCM_IV_LENGTH);
  offset += GCM_IV_LENGTH;
  const authTag = encryptedEnvelope.subarray(offset, offset + GCM_TAG_LENGTH);
  offset += GCM_TAG_LENGTH;
  const ciphertext = encryptedEnvelope.subarray(offset);

  const decipher = crypto.createDecipheriv('aes-256-gcm', objectKey, iv);
  decipher.setAAD(OBJECT_HEADER_MAGIC);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return plaintext;
  } catch (err) {
    throw new Error('Object authentication failed: Data is corrupted or key is incorrect');
  }
}

/**
 * Streams encryption from a readable stream to a writable stream.
 * Prepend envelope: [Magic: 8B][IV: 12B][AuthTag: 16B (placeholder / written at end or segmented)]
 * Note: AES-GCM authentication tag is generated when encryption finishes.
 * For robust file streaming in Node with GCM, we can stream in chunks or write header with tag.
 */

module.exports = {
  OBJECT_HEADER_MAGIC,
  GCM_IV_LENGTH,
  GCM_TAG_LENGTH,
  wrapKey,
  unwrapKey,
  encryptObjectBuffer,
  decryptObjectBuffer
};
