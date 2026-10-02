'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { VaultService } = require('../src/main/vault/vaultService');
const { createVaultBackup, restoreVaultBackup } = require('../src/main/vault/backupService');

test('Backup & Restore: Portable encrypted vault backup and restoration with tamper verification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-test-backup-'));
  const vaultPath = path.join(tmpDir, 'Original.vault');
  const backupFilePath = path.join(tmpDir, 'OriginalBackup.fvbackup');
  const restoredVaultPath = path.join(tmpDir, 'Restored.vault');

  const testKdfParams = { timeCost: 1, memoryCost: 4096, parallelism: 1 };
  const service = new VaultService();

  // 1. Create original vault
  await service.createVault({
    vaultPath,
    password: 'BackupMasterSecret123!',
    kdfParams: testKdfParams
  });

  // 2. Import document
  const samplePdf = path.join(tmpDir, 'will_document.pdf');
  fs.writeFileSync(samplePdf, Buffer.from('%PDF-1.4 Confidential Last Will and Testament of John Doe 2026'));

  const doc = await service.importDocument({
    filePath: samplePdf,
    title: 'Last Will & Testament',
    category: 'property',
    person: 'John Doe',
    tags: ['legal', 'will']
  });

  // 3. Create encrypted portable backup
  const backupRes = service.createBackup(backupFilePath);
  assert.ok(fs.existsSync(backupFilePath));
  assert.strictEqual(backupRes.objectCount, 1);

  // Verify backup is encrypted and plaintext does NOT leak in the archive
  const rawBackup = fs.readFileSync(backupFilePath);
  assert.strictEqual(rawBackup.includes(Buffer.from('Confidential Last Will')), false, 'Plaintext leaked in backup!');

  // 4. Test tamper detection
  const tamperedBackupPath = path.join(tmpDir, 'Tampered.fvbackup');
  const parsedBackup = JSON.parse(rawBackup.toString('utf-8'));
  parsedBackup.payload.objects[0].data = 'dGFtcGVyZWQ='; // modify object data
  fs.writeFileSync(tamperedBackupPath, JSON.stringify(parsedBackup));

  assert.throws(() => {
    restoreVaultBackup(tamperedBackupPath, path.join(tmpDir, 'TamperedRestore.vault'));
  }, /Integrity verification failed/);

  // 5. Restore valid backup into fresh target directory
  const restoreRes = service.restoreBackup({
    backupFilePath,
    targetVaultPath: restoredVaultPath
  });
  assert.strictEqual(restoreRes.objectCount, 1);
  assert.ok(fs.existsSync(path.join(restoredVaultPath, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(restoredVaultPath, 'vault.db')));
  assert.ok(fs.existsSync(path.join(restoredVaultPath, 'objects')));

  // 6. Unlock restored vault using master password
  const restoreService = new VaultService();
  const unlockRes = await restoreService.unlockVault({
    vaultPath: restoredVaultPath,
    password: 'BackupMasterSecret123!'
  });
  assert.strictEqual(restoreService.isUnlocked(), true);

  // 7. Verify restored document and decrypted content
  const restoredDocs = restoreService.listDocuments();
  assert.strictEqual(restoredDocs.length, 1);
  assert.strictEqual(restoredDocs[0].title, 'Last Will & Testament');

  const preview = restoreService.getDocumentVersionContent({
    versionId: restoredDocs[0].currentVersion.id
  });
  assert.strictEqual(
    Buffer.from(preview.base64Data, 'base64').toString('utf-8'),
    '%PDF-1.4 Confidential Last Will and Testament of John Doe 2026'
  );

  service.lockVault();
  restoreService.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
