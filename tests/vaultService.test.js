'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { VaultService } = require('../src/main/vault/vaultService');

test('VaultService: Full lifecycle, immutable versions, encryption and password change', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-test-vault-'));
  const vaultPath = path.join(tmpDir, 'MyFamily.vault');

  // Fast KDF for test suite
  const testKdfParams = {
    timeCost: 1,
    memoryCost: 4096,
    parallelism: 1
  };

  const service = new VaultService();

  // 1. Create Vault
  const createRes = await service.createVault({
    vaultPath,
    password: 'MasterPassword123!',
    kdfParams: testKdfParams
  });

  assert.ok(createRes.vaultId);
  assert.strictEqual(service.isUnlocked(), true);

  // Verify on-disk files are present
  assert.ok(fs.existsSync(path.join(vaultPath, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(vaultPath, 'vault.db')));
  assert.ok(fs.existsSync(path.join(vaultPath, 'objects')));

  // 2. Import Document (Version 1)
  const samplePdfPath1 = path.join(tmpDir, 'passport_v1.pdf');
  const samplePdfContent1 = Buffer.from('%PDF-1.4 sample passport John Doe 2026', 'utf-8');
  fs.writeFileSync(samplePdfPath1, samplePdfContent1);

  const importedDoc = await service.importDocument({
    filePath: samplePdfPath1,
    title: 'Passport - John Doe',
    category: 'identity',
    person: 'John Doe',
    tags: ['passport', 'travel'],
    notes: 'Primary passport'
  });

  assert.strictEqual(importedDoc.title, 'Passport - John Doe');
  assert.strictEqual(importedDoc.currentVersion.versionNumber, 1);
  assert.strictEqual(importedDoc.currentVersion.fileName, 'passport_v1.pdf');

  // Verify object on disk is strictly encrypted and not plaintext
  const objectFile = path.join(vaultPath, 'objects', `${importedDoc.currentVersion.objectId}.enc`);
  assert.ok(fs.existsSync(objectFile));
  const rawDiskObject = fs.readFileSync(objectFile);
  assert.strictEqual(rawDiskObject.subarray(0, 8).toString('ascii'), 'FVOBJ001');
  assert.strictEqual(rawDiskObject.includes(Buffer.from('John Doe 2026')), false, 'Plaintext leaked on disk!');

  // Test in-memory preview
  const previewV1 = service.getDocumentVersionContent({
    versionId: importedDoc.currentVersionId
  });
  assert.strictEqual(previewV1.fileName, 'passport_v1.pdf');
  assert.strictEqual(Buffer.from(previewV1.base64Data, 'base64').toString('utf-8'), samplePdfContent1.toString('utf-8'));

  // 3. Add Immutable Document Version (Version 2)
  const samplePdfPath2 = path.join(tmpDir, 'passport_v2_renewal.pdf');
  const samplePdfContent2 = Buffer.from('%PDF-1.4 renewed passport John Doe valid until 2036', 'utf-8');
  fs.writeFileSync(samplePdfPath2, samplePdfContent2);

  const updatedDoc = await service.addDocumentVersion({
    documentId: importedDoc.id,
    filePath: samplePdfPath2,
    notes: 'Renewed for 10 years'
  });

  assert.strictEqual(updatedDoc.currentVersion.versionNumber, 2);
  assert.strictEqual(updatedDoc.currentVersion.fileName, 'passport_v2_renewal.pdf');

  // 4. Retrieve Document and Verify History Preservation
  const docWithHistory = service.getDocument(importedDoc.id);
  assert.strictEqual(docWithHistory.versions.length, 2);
  // Version 2 is current
  assert.strictEqual(docWithHistory.currentVersionId, docWithHistory.versions[0].id);
  // Both versions are stored and preserved
  const v1Record = docWithHistory.versions.find(v => v.version_number === 1);
  const v2Record = docWithHistory.versions.find(v => v.version_number === 2);
  assert.ok(v1Record);
  assert.ok(v2Record);
  assert.notStrictEqual(v1Record.object_id, v2Record.object_id);

  // Both versions still decrypt cleanly
  const previewHistV1 = service.getDocumentVersionContent({ versionId: v1Record.id });
  const previewHistV2 = service.getDocumentVersionContent({ versionId: v2Record.id });
  assert.strictEqual(Buffer.from(previewHistV1.base64Data, 'base64').toString('utf-8'), samplePdfContent1.toString('utf-8'));
  assert.strictEqual(Buffer.from(previewHistV2.base64Data, 'base64').toString('utf-8'), samplePdfContent2.toString('utf-8'));

  // 5. Export Version
  const exportPath = path.join(tmpDir, 'exported_v1.pdf');
  service.exportDocumentVersion({ versionId: v1Record.id, destinationPath: exportPath });
  assert.ok(fs.existsSync(exportPath));
  assert.deepStrictEqual(fs.readFileSync(exportPath), samplePdfContent1);

  // 6. Test Lock
  service.lockVault();
  assert.strictEqual(service.isUnlocked(), false);
  assert.throws(() => {
    service.listDocuments();
  }, /Vault is locked/);

  // 7. Test Unlock with Wrong Password
  await assert.rejects(async () => {
    await service.unlockVault({
      vaultPath,
      password: 'IncorrectPassword999!'
    });
  }, /Incorrect password or vault data has been tampered with/);
  assert.strictEqual(service.isUnlocked(), false);

  // 8. Test Unlock with Correct Password
  const unlockRes = await service.unlockVault({
    vaultPath,
    password: 'MasterPassword123!'
  });
  assert.strictEqual(unlockRes.vaultId, createRes.vaultId);
  assert.strictEqual(service.isUnlocked(), true);

  const docsAfterUnlock = service.listDocuments();
  assert.strictEqual(docsAfterUnlock.length, 1);
  assert.strictEqual(docsAfterUnlock[0].title, 'Passport - John Doe');

  // 9. Test Password Change
  await service.changePassword({
    oldPassword: 'MasterPassword123!',
    newPassword: 'BrandNewSecret2026#',
    kdfParams: testKdfParams
  });

  // Lock and test unlocking with old password (must fail)
  service.lockVault();
  await assert.rejects(async () => {
    await service.unlockVault({
      vaultPath,
      password: 'MasterPassword123!'
    });
  }, /Incorrect password/);

  // Unlock with new password (must succeed)
  await service.unlockVault({
    vaultPath,
    password: 'BrandNewSecret2026#'
  });
  assert.strictEqual(service.isUnlocked(), true);

  // Verify audit logs are recorded and retrievable
  const auditLogs = service.listAuditLogs(50);
  assert.ok(Array.isArray(auditLogs));
  assert.ok(auditLogs.length >= 4);
  const eventTypes = auditLogs.map(a => a.eventType);
  assert.ok(eventTypes.includes('VAULT_CREATED'));
  assert.ok(eventTypes.includes('DOCUMENT_IMPORTED'));
  assert.ok(eventTypes.includes('PASSWORD_CHANGED'));

  // Clean up
  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
