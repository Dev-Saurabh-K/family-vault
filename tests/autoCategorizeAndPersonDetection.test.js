'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { 
  detectPerson, 
  generateAutoTags, 
  suggestDocumentTitle, 
  analyzeDocumentText 
} = require('../src/main/services/extractionService');
const { VaultService } = require('../src/main/vault/vaultService');

test('Auto-Detection: detectPerson matches known persons and extracts labeled names', () => {
  // 1. Matches existing family member from vault
  const knownPersons = ['Alice Smith', 'Bob Johnson', 'Charlie Brown'];
  const textWithKnown = 'This policy belongs to Alice Smith for medical coverage.';
  const detectedKnown = detectPerson(textWithKnown, knownPersons);
  assert.strictEqual(detectedKnown, 'Alice Smith');

  // 2. Extracts passport style: Given Names & Surname
  const passportText = `
    REPUBLIC OF WONDERLAND
    PASSPORT
    Given Names: Sarah Jane
    Surname: Connor
    Date of Issue: 2021-04-10
  `;
  const detectedPassportName = detectPerson(passportText, []);
  assert.strictEqual(detectedPassportName, 'Sarah Jane Connor');

  // 3. Extracts labeled names: Patient Name
  const medicalText = 'METROPOLITAN HOSPITAL\nPatient Name: David Miller\nBlood Test Report';
  const detectedPatient = detectPerson(medicalText, []);
  assert.strictEqual(detectedPatient, 'David Miller');

  // 4. Extracts labeled names: Insured
  const insuranceText = 'STATE FARM INSURANCE\nInsured: Emily Watson\nPolicy Number: POL-7788';
  const detectedInsured = detectPerson(insuranceText, []);
  assert.strictEqual(detectedInsured, 'Emily Watson');

  // 5. Excludes stop words and authorities
  const authorityText = 'Department of State\nPassport Office\nRepublic of Ireland';
  const detectedAuthority = detectPerson(authorityText, []);
  assert.strictEqual(detectedAuthority, null);
});

test('Auto-Tags: generateAutoTags produces relevant semantic tags and year', () => {
  const passportTags = generateAutoTags(
    'Republic Passport Travel Document',
    'identity',
    'passport',
    'Jane Doe',
    '2021-04-10',
    '2031-04-09'
  );
  assert.ok(passportTags.includes('identity'));
  assert.ok(passportTags.includes('passport'));
  assert.ok(passportTags.includes('travel'));
  assert.ok(passportTags.includes('2031'));

  const medicalTags = generateAutoTags(
    'Hospital Clinic Blood Test Report Prescription',
    'medical',
    'medical_record',
    'Bob',
    '2025-06-01',
    null
  );
  assert.ok(medicalTags.includes('medical'));
  assert.ok(medicalTags.includes('lab-report'));
  assert.ok(medicalTags.includes('prescription'));
  assert.ok(medicalTags.includes('hospital'));
  assert.ok(medicalTags.includes('2025'));
});

test('Title Suggestion: suggestDocumentTitle creates clean, readable titles', () => {
  const title1 = suggestDocumentTitle('scan_001.pdf', 'identity', 'passport', 'Jane Doe', 'US Dept of State', '2020-01-01', '2030-01-01');
  assert.strictEqual(title1, 'Passport - Jane Doe');

  const title2 = suggestDocumentTitle('doc123.pdf', 'insurance', 'insurance_policy', 'Alice', 'State Farm', '2024-01-01', '2025-01-01');
  assert.strictEqual(title2, 'Insurance Policy - Alice');

  const title3 = suggestDocumentTitle('my_tax_report.pdf', 'tax', 'tax_document', null, 'IRS', '2025-04-15', null);
  assert.strictEqual(title3, 'Tax Document - IRS');
});

test('VaultService: preAnalyzeDocument and listFamilyMembers end-to-end integration', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-auto-analyze-test-'));
  const vaultPath = path.join(tmpDir, 'AutoAnalyzeVault.vault');
  const service = new VaultService();

  await service.createVault({
    vaultPath,
    password: 'MasterPassword123!',
    kdfParams: { memory: 4096, iterations: 1, parallelism: 1 }
  });

  // Seed with an existing document for "Alice Johnson"
  const seedFile = path.join(tmpDir, 'seed.pdf');
  fs.writeFileSync(seedFile, Buffer.from('%PDF-1.4 Identity document for Alice Johnson.', 'utf8'));
  await service.importDocument({
    filePath: seedFile,
    title: 'ID - Alice Johnson',
    category: 'identity',
    person: 'Alice Johnson'
  });

  // Verify listFamilyMembers returns Alice Johnson
  const members = service.listFamilyMembers();
  assert.deepStrictEqual(members, ['Alice Johnson']);

  // Create a new simulated file that contains Alice Johnson and medical details
  const newMedicalFile = path.join(tmpDir, 'blood_test_results.pdf');
  const medicalContent = `
    %PDF-1.4
    CITY MEDICAL CLINIC
    Patient Name: Alice Johnson
    Doctor: Dr. Evans
    Blood Test & Lipid Profile
    Date of Issue: 2026-03-15
    Valid Until: 2027-03-15
    Prescription and diagnosis attached.
  `;
  fs.writeFileSync(newMedicalFile, Buffer.from(medicalContent, 'utf8'));

  // Test preAnalyzeDocument
  const preAnalysis = await service.preAnalyzeDocument(newMedicalFile);
  assert.strictEqual(preAnalysis.category, 'medical');
  assert.strictEqual(preAnalysis.docType, 'medical_record');
  assert.strictEqual(preAnalysis.person, 'Alice Johnson');
  assert.strictEqual(preAnalysis.suggestedTitle, 'Medical Record - Alice Johnson');
  assert.ok(preAnalysis.tags.includes('medical'));
  assert.ok(preAnalysis.tags.includes('2027'));
  assert.ok(preAnalysis.notesSummary.includes('Expiry Date: 2027-03-15'));
  assert.ok(typeof preAnalysis.textContent === 'string');

  // Import using the pre-analyzed metadata and preExtractedText
  const importedDoc = await service.importDocument({
    filePath: newMedicalFile,
    title: preAnalysis.suggestedTitle,
    category: preAnalysis.category,
    person: preAnalysis.person,
    tags: preAnalysis.tags,
    notes: preAnalysis.notesSummary,
    preExtractedText: preAnalysis.textContent,
    preExtractedOcrWords: preAnalysis.ocrWords
  });

  assert.strictEqual(importedDoc.title, 'Medical Record - Alice Johnson');
  assert.strictEqual(importedDoc.category, 'medical');
  assert.strictEqual(importedDoc.person, 'Alice Johnson');
  assert.ok(importedDoc.tags.includes('medical'));
  assert.strictEqual(importedDoc.currentVersion.metadata.expiryDate, '2027-03-15');

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
