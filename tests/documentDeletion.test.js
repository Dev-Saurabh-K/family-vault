'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { VaultService } = require('../src/main/vault/vaultService');

test('Document Deletion: Soft-deletes documents, cleans FTS/embeddings, and preserves immutable disk objects', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-delete-test-'));
  const vaultPath = path.join(tmpDir, 'MyVault.vault');
  const service = new VaultService();

  // Create vault
  await service.createVault({
    vaultPath,
    password: 'MasterPassword123!',
    kdfParams: { memory: 4096, iterations: 1, parallelism: 1 }
  });

  // Create sample files
  const fileA = path.join(tmpDir, 'insurance.pdf');
  const fileB = path.join(tmpDir, 'passport.pdf');
  fs.writeFileSync(fileA, Buffer.from('%PDF-1.4 Policy Number: POL-998877. Health insurance coverage active until 2029-12-31.', 'utf-8'));
  fs.writeFileSync(fileB, Buffer.from('%PDF-1.4 Passport Number: P12345678. Official travel passport.', 'utf-8'));

  // Import Doc A
  const docA = await service.importDocument({
    filePath: fileA,
    title: 'Health Insurance Policy',
    category: 'insurance',
    person: 'Alice Doe',
    tags: ['health', 'policy']
  });

  // Import Doc B
  const docB = await service.importDocument({
    filePath: fileB,
    title: 'Passport Travel Document',
    category: 'identity',
    person: 'Bob Doe',
    tags: ['travel', 'passport']
  });

  // Both should be in active list
  assert.strictEqual(service.listDocuments().length, 2);

  // Delete Doc A
  const deleteResult = service.deleteDocument(docA.id);
  assert.strictEqual(deleteResult.success, true);
  assert.strictEqual(deleteResult.documentId, docA.id);
  assert.strictEqual(deleteResult.title, 'Health Insurance Policy');

  // Verify Doc A is no longer returned in list
  const activeDocs = service.listDocuments();
  assert.strictEqual(activeDocs.length, 1);
  assert.strictEqual(activeDocs[0].id, docB.id);

  // Verify Doc A cannot be found via FTS search
  const ftsSearch = service.listDocuments({ search: 'Insurance' });
  assert.strictEqual(ftsSearch.length, 0);

  // Doc B can still be found via FTS
  const ftsDocB = service.listDocuments({ search: 'Passport' });
  assert.strictEqual(ftsDocB.length, 1);
  assert.strictEqual(ftsDocB[0].id, docB.id);

  // Semantic search should exclude Doc A
  const semanticResults = await service.searchSemantic({ query: 'health insurance coverage' });
  assert.ok(!semanticResults.some(r => r.documentId === docA.id));

  // Immutable encrypted objects on disk are preserved
  const objectsDir = path.join(vaultPath, 'objects');
  const diskObjects = fs.readdirSync(objectsDir);
  assert.ok(diskObjects.length >= 2, 'Encrypted files on disk must not be deleted');

  // Verify DOCUMENT_DELETED audit event
  const logs = service.listAuditLogs(10);
  const deleteLog = logs.find(l => l.eventType === 'DOCUMENT_DELETED');
  assert.ok(deleteLog);
  assert.strictEqual(deleteLog.details.documentId, docA.id);
  assert.strictEqual(deleteLog.details.title, 'Health Insurance Policy');
  assert.strictEqual(deleteLog.details.category, 'insurance');
  assert.strictEqual(deleteLog.details.person, 'Alice Doe');

  // Attempting to delete non-existent document throws error
  assert.throws(() => {
    service.deleteDocument('non-existent-id-999');
  }, /Document not found/);

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
