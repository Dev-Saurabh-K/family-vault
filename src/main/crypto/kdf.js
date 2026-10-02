'use strict';

/**
 * Key Derivation Function (KDF) using Argon2id.
 * Satisfies SECURITY.md requirements for deriving KEK from user password.
 */

const DEFAULT_ARGON2_PARAMS = {
  memoryCost: 65536, // 64 MiB (in KiB)
  timeCost: 3,       // 3 iterations
  parallelism: 1,    // 1 lane/thread
  hashLength: 32     // 256 bits for AES-256 KEK
};

/**
 * Derives a Key-Encryption Key (KEK) using Argon2id.
 * @param {string|Buffer} password 
 * @param {Uint8Array|Buffer} salt (16 bytes recommended)
 * @param {object} [customParams]
 * @returns {Promise<Buffer>} 32-byte Buffer containing derived KEK
 */
async function deriveKek(password, salt, customParams = {}) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  if (!salt || !(salt instanceof Uint8Array || Buffer.isBuffer(salt)) || salt.length < 16) {
    throw new Error('Salt must be a Uint8Array or Buffer of at least 16 bytes');
  }

  const params = {
    ...DEFAULT_ARGON2_PARAMS,
    ...customParams
  };

  // Dynamic import of ESM @noble/hashes/argon2.js
  const { argon2id } = await import('@noble/hashes/argon2.js');

  const saltBytes = salt instanceof Uint8Array ? salt : new Uint8Array(salt);
  const derived = argon2id(password, saltBytes, {
    t: params.timeCost,
    m: params.memoryCost,
    p: params.parallelism,
    dkLen: params.hashLength
  });

  return Buffer.from(derived.buffer, derived.byteOffset, derived.byteLength);
}

module.exports = {
  DEFAULT_ARGON2_PARAMS,
  deriveKek
};
