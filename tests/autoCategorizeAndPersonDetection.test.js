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

test('VaultService: Local AI-powered strict auto-categorization, family member detection, and grounded expiry date integration', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-ai-vault-'));
  const vaultPath = path.join(tmpDir, 'MyAiVault.fvault');

  // Create a mock LLM service representing active local llama-server with strict Gemma-4-E2B extractor
  const mockLlmService = {
    isReady: () => true,
    extractDocumentMetadata: async ({ text, fileName, knownPersons }) => {
      // Simulate strict AI extraction
      return {
        category: 'insurance',
        docType: 'insurance_policy',
        person: knownPersons.includes('Priya Sharma') ? 'Priya Sharma' : 'Unknown',
        expiryDate: '2029-10-31',
        expirySnippet: 'Coverage valid until 2029-10-31',
        issueDate: '2024-10-31',
        issueSnippet: 'Policy issued on 2024-10-31',
        issuer: 'Prudential Life',
        tags: ['insurance', 'life', 'policy', '2029'],
        suggestedTitle: 'Insurance Policy - Priya Sharma',
        notesSummary: 'Expiry Date: 2029-10-31. Issue Date: 2024-10-31. Issuer: Prudential Life.',
        confidence: 0.96,
        reviewStatus: 'proposed',
        method: 'local-ai-gemma4'
      };
    }
  };

  const service = new VaultService(mockLlmService);
  await service.createVault({
    vaultPath,
    password: 'StrictAiPassword123!',
    kdfParams: { memoryCost: 4096, timeCost: 1, parallelism: 1 }
  });

  // Seed existing document to register family member 'Priya Sharma' in the vault
  const dummyDoc = path.join(tmpDir, 'seed.pdf');
  fs.writeFileSync(dummyDoc, 'Seed document content for Priya Sharma');
  await service.importDocument({
    filePath: dummyDoc,
    title: 'Seed ID',
    category: 'identity',
    person: 'Priya Sharma'
  });

  const known = service.listFamilyMembers();
  assert.ok(known.includes('Priya Sharma'));

  // Test document to be analyzed with local AI
  const policyFile = path.join(tmpDir, 'life_policy.pdf');
  fs.writeFileSync(policyFile, `
    PRUDENTIAL LIFE INSURANCE
    Policyholder: Priya Sharma
    Policy Issue: 2024-10-31
    Coverage valid until 2029-10-31
    Sum Assured: $250,000
  `);

  // 1. Pre-analysis triggers local AI
  const preAnalysis = await service.preAnalyzeDocument(policyFile);
  assert.strictEqual(preAnalysis.method, 'local-ai-gemma4');
  assert.strictEqual(preAnalysis.category, 'insurance');
  assert.strictEqual(preAnalysis.person, 'Priya Sharma');
  assert.strictEqual(preAnalysis.expiryDate, '2029-10-31');
  assert.strictEqual(preAnalysis.suggestedTitle, 'Insurance Policy - Priya Sharma');
  assert.ok(preAnalysis.tags.includes('insurance'));

  // 2. Importing without explicit category auto-assigns the strict AI category and person
  const importedDoc = await service.importDocument({
    filePath: policyFile,
    category: 'other',
    person: null
  });

  assert.strictEqual(importedDoc.category, 'insurance');
  assert.strictEqual(importedDoc.person, 'Priya Sharma');
  assert.strictEqual(importedDoc.currentVersion.metadata.expiryDate, '2029-10-31');
  assert.strictEqual(importedDoc.currentVersion.metadata.rawPayload.method, 'local-ai-gemma4');

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Strict User Categorization: unmatched person in document falls back to category "other" and reviewStatus "needs_review"', () => {
  const docText = `
    PASSPORT
    REPUBLIC OF WONDERLAND
    Given Names: Sarah Jane
    Surname: Connor
    Date of Issue: 2021-04-10
  `;

  // Case 1: Vault has existing family members, but Sarah Jane Connor is NOT one of them
  const vaultKnownPersons = ['Alice Smith', 'Bob Johnson'];
  const analysisUnmatched = analyzeDocumentText(docText, 'passport.pdf', {
    knownPersons: vaultKnownPersons,
    strictToAddedUsers: true
  });

  assert.strictEqual(analysisUnmatched.person, null, 'Unmatched person must NOT be auto-assigned to document');
  assert.strictEqual(analysisUnmatched.unmatchedPerson, 'Sarah Jane Connor', 'Unmatched person must be captured for user review');
  assert.strictEqual(analysisUnmatched.category, 'other', 'Document category must strictly be "other" when user is unmatched');
  assert.strictEqual(analysisUnmatched.docType, 'other', 'DocType must strictly be "other" when user is unmatched');
  assert.strictEqual(analysisUnmatched.reviewStatus, 'needs_review', 'Review status must be needs_review');

  // Case 2: Once the family member has been added to knownPersons, matching succeeds and normal category applies
  const vaultWithSarah = ['Alice Smith', 'Bob Johnson', 'Sarah Jane Connor'];
  const analysisMatched = analyzeDocumentText(docText, 'passport.pdf', {
    knownPersons: vaultWithSarah,
    strictToAddedUsers: true
  });

  assert.strictEqual(analysisMatched.person, 'Sarah Jane Connor', 'Matched added family member must be assigned');
  assert.strictEqual(analysisMatched.unmatchedPerson, null, 'No unmatched person when member is registered');
  assert.strictEqual(analysisMatched.category, 'identity', 'Category must be recognized as identity');
  assert.strictEqual(analysisMatched.docType, 'passport', 'DocType must be recognized as passport');
});

test('VaultService: Import with unmatched person strictly keeps category "other" and creates no rogue profile', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-unmatched-test-'));
  const vaultPath = path.join(tmpDir, 'UnmatchedVault.vault');
  const service = new VaultService();

  await service.createVault({
    vaultPath,
    password: 'MasterPassword123!',
    kdfParams: { memory: 4096, iterations: 1, parallelism: 1 }
  });

  // Seed with an existing registered family member "Alice Smith"
  const seedFile = path.join(tmpDir, 'seed.pdf');
  fs.writeFileSync(seedFile, 'Existing ID for Alice Smith');
  await service.importDocument({
    filePath: seedFile,
    title: 'ID - Alice Smith',
    category: 'identity',
    person: 'Alice Smith'
  });

  // Now analyze and import a document belonging to unregistered person "Dr. Robert Langdon"
  const docFile = path.join(tmpDir, 'hospital_report.pdf');
  fs.writeFileSync(docFile, `
    ST JUDE MEDICAL CENTER
    Patient Name: Robert Langdon
    Diagnosis: Acute Bronchitis
    Date of Issue: 2026-05-10
  `);

  const preAnalysis = await service.preAnalyzeDocument(docFile);
  assert.strictEqual(preAnalysis.person, null, 'Unmatched person must be null');
  assert.strictEqual(preAnalysis.unmatchedPerson, 'Robert Langdon', 'Unmatched person should be Robert Langdon');
  assert.strictEqual(preAnalysis.category, 'other', 'Category must be forced to other');

  // Import document without specifying person
  const imported = await service.importDocument({
    filePath: docFile,
    category: 'other',
    person: null
  });

  assert.strictEqual(imported.category, 'other');
  assert.strictEqual(imported.person, null);

  // Verify that Robert Langdon was NOT added as a user profile automatically
  const profiles = service.listUserProfiles();
  const robertProfile = profiles.find(p => p.name === 'Robert Langdon');
  assert.strictEqual(robertProfile, undefined, 'Unmatched user must NOT generate an automatic user profile');

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});


