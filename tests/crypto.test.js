'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { deriveKek, DEFAULT_ARGON2_PARAMS } = require('../src/main/crypto/kdf');
const { wrapKey, unwrapKey, encryptObjectBuffer, decryptObjectBuffer } = require('../src/main/crypto/cipher');
const { generateVmk, deriveSubkeys, zeroizeBuffer } = require('../src/main/crypto/keys');

test('Crypto: Argon2id KDF derives 32-byte key and respects parameters', async () => {
  const salt = crypto.randomBytes(16);
  // Using lower cost params for fast unit testing
  const kek = await deriveKek('my-secret-vault-password', salt, {
    timeCost: 1,
    memoryCost: 4096, // 4 MB for test speed
    parallelism: 1
  });

  assert.strictEqual(Buffer.isBuffer(kek), true);
  assert.strictEqual(kek.length, 32);

  // Different password produces different key
  const kek2 = await deriveKek('different-password', salt, {
    timeCost: 1,
    memoryCost: 4096,
    parallelism: 1
  });
  assert.notDeepStrictEqual(kek, kek2);
});

test('Crypto: VMK wrapping and unwrapping with AES-256-GCM', () => {
  const vmk = generateVmk();
  const kek = crypto.randomBytes(32);

  const wrapData = wrapKey(vmk, kek);
  assert.strictEqual(wrapData.iv.length, 12);
  assert.strictEqual(wrapData.authTag.length, 16);
  assert.strictEqual(wrapData.wrappedKey.length, 32);

  // Successful unwrap
  const unwrapped = unwrapKey(wrapData, kek);
  assert.deepStrictEqual(unwrapped, vmk);

  // Fails with wrong KEK
  const wrongKek = crypto.randomBytes(32);
  assert.throws(() => {
    unwrapKey(wrapData, wrongKek);
  }, /Authentication failed/);

  // Fails with tampered ciphertext
  const tamperedData = {
    ...wrapData,
    wrappedKey: Buffer.from(wrapData.wrappedKey)
  };
  tamperedData.wrappedKey[0] ^= 0x01; // flip 1 bit
  assert.throws(() => {
    unwrapKey(tamperedData, kek);
  }, /Authentication failed/);
});

test('Crypto: Object Buffer authenticated encryption and decryption', () => {
  const objectKey = crypto.randomBytes(32);
  const samplePdfData = Buffer.from('%PDF-1.4 sample passport and confidential document bytes...', 'utf-8');

  const encryptedEnvelope = encryptObjectBuffer(samplePdfData, objectKey);
  // Header (8) + IV (12) + Tag (16) + Plaintext length
  assert.strictEqual(encryptedEnvelope.length, 8 + 12 + 16 + samplePdfData.length);
  assert.strictEqual(encryptedEnvelope.subarray(0, 8).toString('ascii'), 'FVOBJ001');

  // Successful decryption
  const decrypted = decryptObjectBuffer(encryptedEnvelope, objectKey);
  assert.deepStrictEqual(decrypted, samplePdfData);

  // Fails with wrong key
  const wrongKey = crypto.randomBytes(32);
  assert.throws(() => {
    decryptObjectBuffer(encryptedEnvelope, wrongKey);
  }, /Object authentication failed/);

  // Fails with tampered payload
  const tamperedEnvelope = Buffer.from(encryptedEnvelope);
  tamperedEnvelope[tamperedEnvelope.length - 1] ^= 0xff; // corrupt byte
  assert.throws(() => {
    decryptObjectBuffer(tamperedEnvelope, objectKey);
  }, /Object authentication failed/);
});

test('Crypto: HKDF subkey derivation and zeroization', () => {
  const vmk = generateVmk();
  const vaultId = 'test-vault-uuid-1234';

  const { dbKey, objectKey } = deriveSubkeys(vmk, vaultId);
  assert.strictEqual(dbKey.length, 32);
  assert.strictEqual(objectKey.length, 32);
  assert.notDeepStrictEqual(dbKey, objectKey);

  // Zeroization
  const testBuffer = Buffer.from('sensitive-key-material');
  zeroizeBuffer(testBuffer);
  assert.strictEqual(testBuffer.every(byte => byte === 0), true);
});
