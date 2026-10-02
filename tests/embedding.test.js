'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { embeddingService, EmbeddingService, VECTOR_DIMENSION } = require('../src/main/services/embeddingService');
const { VaultService } = require('../src/main/vault/vaultService');

test('EmbeddingService: Generates normalized vectors and chunks text', async () => {
  const service = new EmbeddingService();

  // Test chunking
  const text = 'Paragraph 1: Important passport information.\n\nParagraph 2: Health insurance details and coverage limits.\n\nParagraph 3: Tax return 2024.';
  const chunks = service.chunkText(text);
  assert.strictEqual(chunks.length, 3);
  assert.ok(chunks[0].includes('passport'));
  assert.ok(chunks[1].includes('insurance'));
  assert.ok(chunks[2].includes('Tax return'));

  // Test vector generation
  const vec1 = await service.generateEmbedding('health insurance dental coverage');
  assert.strictEqual(vec1 instanceof Float32Array, true);
  assert.strictEqual(vec1.length, VECTOR_DIMENSION);

  // Check L2 norm is ~1.0
  let norm = 0;
  for (let i = 0; i < vec1.length; i++) {
    norm += vec1[i] * vec1[i];
  }
  assert.ok(Math.abs(Math.sqrt(norm) - 1.0) < 1e-4);

  // Cosine similarity of identical text should be ~1.0
  const vec1Repeat = await service.generateEmbedding('health insurance dental coverage');
  const simSelf = service.cosineSimilarity(vec1, vec1Repeat);
  assert.ok(simSelf > 0.999);

  // Cosine similarity of related text should be higher than unrelated
  const vecRelated = await service.generateEmbedding('dental insurance policy benefits');
  const vecUnrelated = await service.generateEmbedding('car oil change mechanic receipt');
  const simRelated = service.cosineSimilarity(vec1, vecRelated);
  const simUnrelated = service.cosineSimilarity(vec1, vecUnrelated);
  assert.ok(simRelated > simUnrelated);

  // Serialization to BLOB and back
  const blob = service.vectorToBlob(vec1);
  assert.strictEqual(Buffer.isBuffer(blob), true);
  assert.strictEqual(blob.length, VECTOR_DIMENSION * 4); // 4 bytes per float32

  const restored = service.blobToVector(blob);
  assert.strictEqual(restored.length, VECTOR_DIMENSION);
  for (let i = 0; i < VECTOR_DIMENSION; i++) {
    assert.strictEqual(restored[i], vec1[i]);
  }
});

test('VaultService: Semantic similarity search across encrypted documents', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-semantic-test-'));
  const vaultPath = path.join(tempDir, 'TestVault.vault');
  const vaultService = new VaultService();

  try {
    await vaultService.createVault({
      vaultPath,
      password: 'SemanticTestPassword#1234',
      vaultName: 'Semantic Search Test Vault'
    });

    // Create 2 test text/pdf files
    const file1 = path.join(tempDir, 'dental_policy.pdf');
    fs.writeFileSync(file1, 'Delta Dental PPO Comprehensive dental plan. Annual maximum benefit $2000. Cleanings covered 100%.');

    const file2 = path.join(tempDir, 'vehicle_lease.pdf');
    fs.writeFileSync(file2, 'Toyota Motor Credit Lease Agreement. Monthly payment $350 due on the 5th of each month. Mileage allowance 12000 miles per year.');

    await vaultService.importDocument({
      filePath: file1,
      title: 'Delta Dental Policy',
      category: 'insurance'
    });

    await vaultService.importDocument({
      filePath: file2,
      title: 'Toyota Vehicle Lease',
      category: 'financial'
    });

    // Query semantically for dental benefits
    const dentalResults = await vaultService.searchSemantic({
      query: 'dental coverage and cleanings',
      limit: 5
    });

    assert.ok(dentalResults.length > 0);
    assert.strictEqual(dentalResults[0].documentTitle, 'Delta Dental Policy');
    assert.strictEqual(dentalResults[0].category, 'insurance');
    assert.ok(dentalResults[0].similarity > 0.1);

    // Query semantically for car payments
    const leaseResults = await vaultService.searchSemantic({
      query: 'monthly car lease payment',
      limit: 5
    });

    assert.ok(leaseResults.length > 0);
    assert.strictEqual(leaseResults[0].documentTitle, 'Toyota Vehicle Lease');
    assert.strictEqual(leaseResults[0].category, 'financial');
    assert.ok(leaseResults[0].similarity > 0.1);

    vaultService.lockVault();
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
});
