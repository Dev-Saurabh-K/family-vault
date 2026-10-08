'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  analyzeDocumentText,
  generateAutoTags,
  findDateCandidates,
  suggestDocumentTitle
} = require('../src/main/services/extractionService');
const { LlmService } = require('../src/main/services/llmService');
const { VaultService } = require('../src/main/vault/vaultService');

test('Generation Suite: Identity Documents (Passport, Driving License, National ID)', async () => {
  const service = new LlmService();
  service._isReady = true;

  // 1. Passport Generation
  const passportText = `
    UNITED STATES OF AMERICA
    PASSPORT
    Type: P  Code: USA  Passport No: 123456789
    Surname: CONNOR
    Given Names: SARAH JANE
    Nationality: UNITED STATES OF AMERICA
    Date of Birth: 15-JUN-1985
    Sex: F
    Place of Birth: CALIFORNIA, U.S.A.
    Date of Issue: 10-MAY-2021
    Authority: United States Department of State
    Date of Expiry: 09-MAY-2031
  `;

  service._queryLlamaServer = async () => JSON.stringify({
    category: 'identity',
    docType: 'passport',
    detectedName: 'Sarah Jane Connor',
    issuer: 'Department of State',
    expiryDate: '2031-05-09',
    suggestedTitle: 'US Passport - Sarah Jane Connor'
  });

  const passportRes = await service.extractDocumentMetadata({
    text: passportText,
    fileName: 'sarah_passport.pdf',
    knownPersons: ['Sarah Jane Connor']
  });

  assert.strictEqual(passportRes.category, 'identity');
  assert.strictEqual(passportRes.docType, 'passport');
  assert.strictEqual(passportRes.person, 'Sarah Jane Connor');
  assert.strictEqual(passportRes.expiryDate, '2031-05-09');
  assert.strictEqual(passportRes.issueDate, '2021-05-10');
  assert.ok(passportRes.tags.includes('identity'), 'Tags must include category identity');
  assert.ok(passportRes.tags.includes('passport'), 'Tags must include docType passport');
  assert.ok(passportRes.tags.includes('travel'), 'Tags must include travel');
  assert.ok(passportRes.tags.includes('2031'), 'Tags must include expiry year 2031');
  assert.ok(passportRes.suggestedTitle.includes('Passport'));
  assert.ok(passportRes.notesSummary.includes('Expiry Date: 2031-05-09'));

  // 2. Driving License with EXP abbreviation and California DMV
  const dlText = `
    CALIFORNIA DRIVER LICENSE
    DL NUMBER: D9988776
    EXP: 08/25/2030
    LN: DOE
    FN: JANE
    CLASS: C
    DOB: 03/15/1990
    ISS: 08/25/2025
    DEPARTMENT OF MOTOR VEHICLES
  `;

  service._queryLlamaServer = async () => JSON.stringify({
    category: 'identity',
    docType: 'driving_license',
    detectedName: 'Jane Doe',
    issuer: 'Department of Motor Vehicles',
    expiryDate: '2030-08-25',
    suggestedTitle: 'California Driver License - Jane Doe'
  });

  const dlRes = await service.extractDocumentMetadata({
    text: dlText,
    fileName: 'ca_license.jpg',
    knownPersons: ['Jane Doe']
  });

  assert.strictEqual(dlRes.category, 'identity');
  assert.strictEqual(dlRes.docType, 'driving_license');
  assert.strictEqual(dlRes.person, 'Jane Doe');
  assert.strictEqual(dlRes.expiryDate, '2030-08-25');
  assert.ok(dlRes.tags.includes('identity'));
  assert.ok(dlRes.tags.includes('driving-license'));
  assert.ok(dlRes.tags.includes('driver'));
  assert.ok(dlRes.tags.includes('2030'));
  assert.ok(dlRes.issuer && /Department of Motor Vehicles/i.test(dlRes.issuer));
  assert.ok(dlRes.notesSummary.includes('Expiry Date: 2030-08-25'));
  assert.ok(dlRes.notesSummary.includes('Issuer: Department of Motor Vehicles'));

  // 3. National ID with DOE and DOI abbreviations
  const idText = `
    REPUBLIC IDENTITY CARD
    ID No: 9988-1122-3344
    Name: Alex Smith
    DOI: 2022-01-15
    DOE: 2032-01-14
    Issuing Authority: National Registry
  `;

  const idDeterministic = analyzeDocumentText(idText, 'national_id.png', { knownPersons: ['Alex Smith'] });
  assert.strictEqual(idDeterministic.category, 'identity');
  assert.strictEqual(idDeterministic.docType, 'identity_card');
  assert.strictEqual(idDeterministic.person, 'Alex Smith');
  assert.strictEqual(idDeterministic.issueDate, '2022-01-15');
  assert.strictEqual(idDeterministic.expiryDate, '2032-01-14');
  assert.ok(idDeterministic.tags.includes('identity'));
  assert.ok(idDeterministic.tags.includes('identity-card'));
  assert.ok(idDeterministic.tags.includes('2032'));
});

test('Generation Suite: Insurance Policies (Auto, Health, Life, Home)', async () => {
  const service = new LlmService();
  service._isReady = true;

  // 1. Auto Insurance Policy
  const autoText = `
    STATE FARM INSURANCE
    AUTOMOBILE INSURANCE POLICY DECLARATIONS
    Policy Number: 987-6543-A12
    Policyholder: Emily Watson
    Policy Period: Effective 2026-01-01 to 2027-01-01
    Vehicle: 2024 Honda CR-V (VIN: 1HGCR2F88)
    Coverage: Comprehensive & Collision
  `;

  service._queryLlamaServer = async () => JSON.stringify({
    category: 'insurance',
    docType: 'insurance_policy',
    detectedName: 'Emily Watson',
    issuer: 'State Farm',
    expiryDate: '2027-01-01',
    suggestedTitle: 'State Farm Auto Insurance - Emily Watson'
  });

  const autoRes = await service.extractDocumentMetadata({
    text: autoText,
    fileName: 'auto_policy.pdf',
    knownPersons: ['Emily Watson']
  });

  assert.strictEqual(autoRes.category, 'insurance');
  assert.strictEqual(autoRes.docType, 'insurance_policy');
  assert.strictEqual(autoRes.person, 'Emily Watson');
  assert.strictEqual(autoRes.expiryDate, '2027-01-01');
  assert.ok(autoRes.tags.includes('insurance'));
  assert.ok(autoRes.tags.includes('insurance-policy'));
  assert.ok(autoRes.tags.includes('policy'));
  assert.ok(autoRes.tags.includes('vehicle'));
  assert.ok(autoRes.tags.includes('2027'));
  assert.ok(autoRes.issuer.includes('State Farm'));
  assert.ok(autoRes.notesSummary.includes('Expiry Date: 2027-01-01'));
  assert.ok(autoRes.notesSummary.includes('Issuer: State Farm'));

  // 2. Health Insurance Policy
  const healthText = `
    BLUE CROSS BLUE SHIELD
    HEALTH INSURANCE CARD
    Member Name: David Miller
    Member ID: BCBS-998811
    Group: 10442
    Effective Date: 2025-06-01
    Expires: 2028-05-31
    Coverage: Comprehensive Medical & Hospital
  `;

  service._queryLlamaServer = async () => JSON.stringify({
    category: 'insurance',
    docType: 'insurance_policy',
    detectedName: 'David Miller',
    issuer: 'Blue Cross Blue Shield',
    expiryDate: '2028-05-31',
    suggestedTitle: 'Blue Cross Health Insurance - David Miller'
  });

  const healthRes = await service.extractDocumentMetadata({
    text: healthText,
    fileName: 'health_card.jpg',
    knownPersons: ['David Miller']
  });

  assert.strictEqual(healthRes.category, 'insurance');
  assert.strictEqual(healthRes.docType, 'insurance_policy');
  assert.strictEqual(healthRes.person, 'David Miller');
  assert.strictEqual(healthRes.expiryDate, '2028-05-31');
  assert.ok(healthRes.tags.includes('insurance'));
  assert.ok(healthRes.tags.includes('policy'));
  assert.ok(healthRes.tags.includes('health'));
  assert.ok(healthRes.tags.includes('2028'));

  // 3. Life Insurance Policy
  const lifeTags = generateAutoTags('MetLife Term Life Insurance Policy 2025-01-01', 'insurance', 'insurance_policy', null, '2025-01-01', '2045-01-01');
  assert.ok(lifeTags.includes('insurance'));
  assert.ok(lifeTags.includes('policy'));
  assert.ok(lifeTags.includes('life'));

  // 4. Homeowners Insurance Policy
  const homeTags = generateAutoTags('Allstate Home Property Owners Policy 2026', 'insurance', 'insurance_policy', null, '2026-01-01', '2027-01-01');
  assert.ok(homeTags.includes('insurance'));
  assert.ok(homeTags.includes('policy'));
  assert.ok(homeTags.includes('home'));
});

test('Generation Suite: Medical Records (Prescription, Lab Report, Vaccine)', async () => {
  const service = new LlmService();
  service._isReady = true;

  // 1. Prescription
  const rxText = `
    ST. JUDE MEDICAL CLINIC
    PRESCRIPTION ORDER (Rx)
    Patient Name: Alice Smith
    Date of Issue: 2026-03-15
    Doctor: Dr. Gregory House, M.D.
    Medication: Amoxicillin 500mg
    Refills: 2
  `;

  service._queryLlamaServer = async () => JSON.stringify({
    category: 'medical',
    docType: 'medical_record',
    detectedName: 'Alice Smith',
    suggestedTitle: 'Medical Prescription - Alice Smith'
  });

  const rxRes = await service.extractDocumentMetadata({
    text: rxText,
    fileName: 'rx_slip.pdf',
    knownPersons: ['Alice Smith']
  });

  assert.strictEqual(rxRes.category, 'medical');
  assert.strictEqual(rxRes.docType, 'medical_record');
  assert.strictEqual(rxRes.person, 'Alice Smith');
  assert.ok(rxRes.tags.includes('medical'));
  assert.ok(rxRes.tags.includes('medical-record'));
  assert.ok(rxRes.tags.includes('prescription'));
  assert.ok(rxRes.tags.includes('hospital'));
  assert.ok(rxRes.tags.includes('2026'));

  // 2. Lab Report
  const labTags = generateAutoTags('Metropolitan Hospital Lab Report Blood Test Lipid Panel 2026', 'medical', 'medical_record', null, '2026-02-10', null);
  assert.ok(labTags.includes('medical'));
  assert.ok(labTags.includes('lab-report'));
  assert.ok(labTags.includes('hospital'));
  assert.ok(labTags.includes('2026'));

  // 3. Vaccine Record
  const vaccineTags = generateAutoTags('Immunization and Vaccine Record Certificate 2025', 'medical', 'medical_record', null, '2025-08-20', null);
  assert.ok(vaccineTags.includes('medical'));
  assert.ok(vaccineTags.includes('vaccine'));
  assert.ok(vaccineTags.includes('2025'));
});

test('Generation Suite: Tax Documents (Form 1040, W-2, Returns)', async () => {
  const service = new LlmService();
  service._isReady = true;

  // 1. Form 1040
  const taxText = `
    INTERNAL REVENUE SERVICE
    FORM 1040 (2025)
    U.S. INDIVIDUAL INCOME TAX RETURN
    Taxpayer: Bob Johnson
    SSN: XXX-XX-4321
    Date of Issue: 2026-04-15
    Total Income: $85,000
    Refund Amount: $2,450
  `;

  service._queryLlamaServer = async () => JSON.stringify({
    category: 'tax',
    docType: 'tax_document',
    detectedName: 'Bob Johnson',
    issuer: 'Internal Revenue Service',
    suggestedTitle: 'Form 1040 Tax Return (2025) - Bob Johnson'
  });

  const taxRes = await service.extractDocumentMetadata({
    text: taxText,
    fileName: 'form_1040_2025.pdf',
    knownPersons: ['Bob Johnson']
  });

  assert.strictEqual(taxRes.category, 'tax');
  assert.strictEqual(taxRes.docType, 'tax_document');
  assert.strictEqual(taxRes.person, 'Bob Johnson');
  assert.ok(taxRes.tags.includes('tax'));
  assert.ok(taxRes.tags.includes('tax-document'));
  assert.ok(taxRes.tags.includes('finance'));
  assert.ok(taxRes.tags.includes('form-1040'));
  assert.ok(taxRes.tags.includes('return'));
  assert.ok(taxRes.tags.includes('2026'));
  assert.ok(taxRes.issuer.includes('Internal Revenue Service'));

  // 2. W-2 Wage Statement
  const w2Tags = generateAutoTags('W-2 Wage and Tax Statement 2025 Employer Internal Revenue', 'tax', 'tax_document', null, '2025-12-31', null);
  assert.ok(w2Tags.includes('tax'));
  assert.ok(w2Tags.includes('w2'));
  assert.ok(w2Tags.includes('finance'));
});

test('Generation Suite: Property Documents (Lease, Mortgage, Deed)', async () => {
  const service = new LlmService();
  service._isReady = true;

  // 1. Residential Lease Agreement
  const leaseText = `
    RESIDENTIAL LEASE AGREEMENT
    Landlord: Apex Property Management
    Tenant: Charlie Brown
    Premises: 124 Elm Street, Apt 3B
    Lease Term: Effective 2025-09-01 to 2026-08-31
    Monthly Rent: $1,800.00
  `;

  service._queryLlamaServer = async () => JSON.stringify({
    category: 'property',
    docType: 'property_document',
    detectedName: 'Charlie Brown',
    expiryDate: '2026-08-31',
    suggestedTitle: 'Residential Lease Agreement - Charlie Brown'
  });

  const leaseRes = await service.extractDocumentMetadata({
    text: leaseText,
    fileName: 'lease_contract.pdf',
    knownPersons: ['Charlie Brown']
  });

  assert.strictEqual(leaseRes.category, 'property');
  assert.strictEqual(leaseRes.docType, 'property_document');
  assert.strictEqual(leaseRes.person, 'Charlie Brown');
  assert.strictEqual(leaseRes.expiryDate, '2026-08-31');
  assert.ok(leaseRes.tags.includes('property'));
  assert.ok(leaseRes.tags.includes('property-document'));
  assert.ok(leaseRes.tags.includes('legal'));
  assert.ok(leaseRes.tags.includes('lease'));
  assert.ok(leaseRes.tags.includes('2026'));

  // 2. Mortgage and Deed tags
  const mortgageTags = generateAutoTags('Bank Mortgage Loan Agreement Property 2025', 'property', 'property_document', null, null, null);
  assert.ok(mortgageTags.includes('mortgage'));
  assert.ok(mortgageTags.includes('legal'));

  const deedTags = generateAutoTags('Title Deed Land Registry Property Document 2024', 'property', 'property_document', null, null, null);
  assert.ok(deedTags.includes('deed'));
  assert.ok(deedTags.includes('legal'));
});

test('Generation Suite: Category "other" Documents (Utility Bills, Bank Statements, Education, Employment)', () => {
  // 1. Utility Bill
  const utilAnalysis = analyzeDocumentText(`
    CITY WATER & POWER
    MONTHLY RESIDENTIAL UTILITY BILL
    Account Number: 994820-11
    Billing Date: 2026-03-01
    Due Date: 2026-03-25
    Total Amount Due: $135.40
  `, 'utility_bill_march.pdf');

  assert.strictEqual(utilAnalysis.category, 'other');
  assert.ok(utilAnalysis.tags.includes('utility'));
  assert.ok(utilAnalysis.tags.includes('2026'));
  assert.ok(utilAnalysis.suggestedTitle.length > 0);

  // 2. Bank Statement
  const bankAnalysis = analyzeDocumentText(`
    FIRST CITIZENS BANK
    MONTHLY CHECKING ACCOUNT STATEMENT
    Statement Period: February 1, 2026 - February 28, 2026
    Closing Balance: $4,520.10
  `, 'bank_statement_feb.pdf');

  assert.strictEqual(bankAnalysis.category, 'other');
  assert.ok(bankAnalysis.tags.includes('statement'));
  assert.ok(bankAnalysis.tags.includes('2026'));

  // 3. Education Degree
  const eduAnalysis = analyzeDocumentText(`
    STANFORD UNIVERSITY
    DEGREE OF MASTER OF SCIENCE
    This diploma certifies that Jane Doe has completed all requirements.
    Awarded: June 15, 2024
  `, 'stanford_degree.pdf');

  assert.strictEqual(eduAnalysis.category, 'other');
  assert.ok(eduAnalysis.tags.includes('education'));
  assert.ok(eduAnalysis.tags.includes('2024'));

  // 4. Employment Payslip / Contract
  const empAnalysis = analyzeDocumentText(`
    ACME CORPORATION
    MONTHLY SALARY PAYSLIP
    Employee Name: John Smith
    Pay Period: January 2026
    Net Salary: $5,200.00
  `, 'january_payslip.pdf');

  assert.strictEqual(empAnalysis.category, 'other');
  assert.ok(empAnalysis.tags.includes('employment'));
  assert.ok(empAnalysis.tags.includes('2026'));
});

test('Generation Suite: End-to-End VaultService preAnalyzeDocument with all required generations', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-gen-test-'));
  const vaultPath = path.join(tmpDir, 'GenerationTest.vault');
  const service = new VaultService();

  await service.createVault({
    vaultPath,
    password: 'MasterPassword123!',
    kdfParams: { memory: 4096, iterations: 1, parallelism: 1 }
  });

  // Seed family member Alice
  service.addFamilyMember({ name: 'Alice Smith', dob: '1990-01-01', gender: 'Female' });

  // Create sample document
  const sampleCard = path.join(tmpDir, 'state_farm_card.pdf');
  fs.writeFileSync(sampleCard, Buffer.from(`
    %PDF-1.4
    STATE FARM INSURANCE
    AUTO POLICY DECLARATIONS
    Insured: Alice Smith
    Policy: 445566-B
    Effective Date: 2026-01-15
    EXP: 2027-01-14
    Vehicle: Honda Civic
  `, 'utf8'));

  const preAnalysis = await service.preAnalyzeDocument(sampleCard);

  // Verify all required generated fields are present and valid
  assert.ok(preAnalysis.suggestedTitle, 'suggestedTitle must be generated');
  assert.ok(preAnalysis.category, 'category must be generated');
  assert.ok(preAnalysis.docType, 'docType must be generated');
  assert.strictEqual(preAnalysis.category, 'insurance');
  assert.strictEqual(preAnalysis.docType, 'insurance_policy');
  assert.strictEqual(preAnalysis.person, 'Alice Smith');
  assert.strictEqual(preAnalysis.expiryDate, '2027-01-14');
  assert.strictEqual(preAnalysis.issueDate, '2026-01-15');
  assert.ok(preAnalysis.issuer && /state farm/i.test(preAnalysis.issuer));
  assert.ok(Array.isArray(preAnalysis.tags) && preAnalysis.tags.length > 0, 'Tags must not be empty');
  assert.ok(preAnalysis.tags.includes('insurance'));
  assert.ok(preAnalysis.tags.includes('insurance-policy'));
  assert.ok(preAnalysis.tags.includes('policy'));
  assert.ok(preAnalysis.tags.includes('vehicle'));
  assert.ok(preAnalysis.notesSummary.includes('Expiry Date: 2027-01-14'));
  assert.ok(/state farm/i.test(preAnalysis.notesSummary));

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Generation Suite: End-to-End VaultService direct importDocument populates tags, title, notesSummary into DB', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-import-gen-'));
  const vaultPath = path.join(tmpDir, 'DirectImportGen.vault');
  const service = new VaultService();

  await service.createVault({
    vaultPath,
    password: 'MasterPassword123!',
    kdfParams: { memory: 4096, iterations: 1, parallelism: 1 }
  });

  service.addFamilyMember({ name: 'Bob Johnson', dob: '1985-04-12', gender: 'Male' });

  // Direct import of a tax return without pre-analysis or manual tags
  const taxFile = path.join(tmpDir, 'w2_bob.pdf');
  fs.writeFileSync(taxFile, Buffer.from(`
    %PDF-1.4
    INTERNAL REVENUE SERVICE
    W-2 WAGE AND TAX STATEMENT 2025
    Employee: Bob Johnson
    SSN: XXX-XX-9876
    Date of Issue: 2026-01-31
    Wages, tips, other comp: $95,000.00
  `, 'utf8'));

  const imported = await service.importDocument({
    filePath: taxFile
  });

  // Verify DB record has all generated fields populated
  assert.strictEqual(imported.category, 'tax');
  assert.strictEqual(imported.person, 'Bob Johnson');
  assert.ok(imported.title.includes('Tax Document') || imported.title.includes('Bob Johnson') || imported.title.includes('W-2'));
  assert.ok(Array.isArray(imported.tags) && imported.tags.length > 0, 'Tags must not be empty on imported document');
  assert.ok(imported.tags.includes('tax'));
  assert.ok(imported.tags.includes('tax-document'));
  assert.ok(imported.tags.includes('finance'));
  assert.ok(imported.notes.includes('Internal Revenue Service') || imported.notes.includes('Issue Date: 2026-01-31'));

  // Verify listDocuments filter by tag finds it
  const filteredByTag = service.listDocuments({ tag: 'tax' });
  assert.strictEqual(filteredByTag.length, 1);
  assert.strictEqual(filteredByTag[0].id, imported.id);

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Generation Suite: Noisy OCR Scans & International Documents with abbreviations', () => {
  // 1. Noisy Passport Scan with MRZ lines and abbreviations
  const noisyPassport = `
    PASSPORT / PASSEPORT
    UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND
    Type/Type: P  Code: GBR  Passport No./No du passeport: 554433221
    Surname: WILLIAMS
    Given Names: LIAM
    Nationality: BRITISH CITIZEN
    Date of birth: 12 OCT / OCT 1988
    Sex: M
    Date of issue: 22 MAR / MAR 2021
    Authority: HM PASSPORT OFFICE
    Date of expiry: 21 MAR / MAR 2031
    P<GBRWILLIAMS<<LIAM<<<<<<<<<<<<<<<<<<<<<<<<<<
    5544332214GBR8810125M3103212<<<<<<<<<<<<<<02
  `;

  const passportAnalysis = analyzeDocumentText(noisyPassport, 'scan_001.jpg', {
    knownPersons: ['Liam Williams']
  });

  assert.strictEqual(passportAnalysis.category, 'identity');
  assert.strictEqual(passportAnalysis.docType, 'passport');
  assert.strictEqual(passportAnalysis.person, 'Liam Williams');
  assert.strictEqual(passportAnalysis.expiryDate, '2031-03-21');
  assert.strictEqual(passportAnalysis.issueDate, '2021-03-22');
  assert.ok(passportAnalysis.tags.includes('identity'));
  assert.ok(passportAnalysis.tags.includes('passport'));
  assert.ok(passportAnalysis.tags.includes('travel'));
  assert.ok(passportAnalysis.tags.includes('2031'));
  assert.ok(passportAnalysis.notesSummary.includes('Expiry Date: 2031-03-21'));

  // 2. Indian Aadhaar Card
  const aadhaarText = `
    GOVERNMENT OF INDIA
    UNIQUE IDENTIFICATION AUTHORITY OF INDIA
    Aadhaar Card
    To: Rajesh Kumar
    DOB: 15/08/1982
    Male
    Aadhaar No: 9988 7766 5544
    Issue Date: 2020-11-10
  `;

  const aadhaarAnalysis = analyzeDocumentText(aadhaarText, 'aadhaar.pdf', {
    knownPersons: ['Rajesh Kumar']
  });

  assert.strictEqual(aadhaarAnalysis.category, 'identity');
  assert.strictEqual(aadhaarAnalysis.docType, 'identity_card');
  assert.strictEqual(aadhaarAnalysis.person, 'Rajesh Kumar');
  assert.strictEqual(aadhaarAnalysis.issueDate, '2020-11-10');
  assert.ok(aadhaarAnalysis.tags.includes('identity'));
  assert.ok(aadhaarAnalysis.tags.includes('identity-card'));
  assert.ok(aadhaarAnalysis.tags.includes('national-id'));

  // 3. UK DVLA Driver License
  const ukDvlaText = `
    DRIVING LICENCE
    DVLA SWANSEA
    1. CONNOR
    2. SARAH
    3. 15.06.85
    4a. 25-08-2022
    4b. 24-08-2032
    5. CONN856158SM9IJ
  `;

  const dvlaAnalysis = analyzeDocumentText(ukDvlaText, 'uk_license.jpg', {
    knownPersons: ['Sarah Connor']
  });

  assert.strictEqual(dvlaAnalysis.category, 'identity');
  assert.strictEqual(dvlaAnalysis.docType, 'driving_license');
  assert.ok(dvlaAnalysis.issuer && /DVLA/i.test(dvlaAnalysis.issuer));
  assert.ok(dvlaAnalysis.tags.includes('identity'));
  assert.ok(dvlaAnalysis.tags.includes('driving-license'));
});

test('Generation Suite: Date Parsing Edge Cases and Multi-date Prioritization', () => {
  // 1. Multiple dates: DOB, Issue Date, Expiry Date correctly disambiguated
  const multiDateText = `
    STATE IDENTIFICATION CARD
    Name: John Doe
    DOB: 1980-01-01
    Date of Issue: 2021-06-15
    Valid Until: 2031-06-14
    Card Number: ID-009988
  `;

  const analysis = analyzeDocumentText(multiDateText, 'id_card.png');
  assert.strictEqual(analysis.expiryDate, '2031-06-14');
  assert.strictEqual(analysis.issueDate, '2021-06-15');
  assert.ok(analysis.tags.includes('2031'));

  // 2. Date with "EXP" label vs unlabeled date
  const expVsUnlabeled = `
    Card Issued: 2020-05-10
    Random timestamp: 2024-01-01
    EXP: 2028-05-09
  `;
  const expCandidates = findDateCandidates(expVsUnlabeled);
  assert.strictEqual(expCandidates.length, 3);
  const analysisExp = analyzeDocumentText(expVsUnlabeled, 'doc.png');
  assert.strictEqual(analysisExp.expiryDate, '2028-05-09');
  assert.strictEqual(analysisExp.issueDate, '2020-05-10');

  // 3. Date with European format DD/MM/YYYY vs US format MM/DD/YYYY
  const euroText = `Valid Thru: 28/02/2030`;
  const euroAnalysis = analyzeDocumentText(euroText, 'policy.pdf');
  assert.strictEqual(euroAnalysis.expiryDate, '2030-02-28');

  const usText = `EXP: 07/22/2029`;
  const usAnalysis = analyzeDocumentText(usText, 'license.pdf');
  assert.strictEqual(usAnalysis.expiryDate, '2029-07-22');
});

