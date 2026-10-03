'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractProfileFacts } = require('../src/main/services/extractionService');
const { VaultService } = require('../src/main/vault/vaultService');

test('ExtractionService: extractProfileFacts extracts structured biographical, parental, and academic data', () => {
  const markSheet10th = `
    CENTRAL BOARD OF SECONDARY EDUCATION
    SECONDARY SCHOOL EXAMINATION (CLASS X) 2018
    Candidate Name: Aarav Sharma
    Father's Name: Ramesh Kumar Sharma
    Mother's Name: Sunita Sharma
    Date of Birth: 14/05/2002
    Gender: Male
    Result: PASS
    Percentage: 92.4%
    Permanent Address: House 42, Green Park, New Delhi 110016
  `;

  const facts10 = extractProfileFacts(markSheet10th, 'Aarav Sharma');
  const factMap10 = Object.fromEntries(facts10.map(f => [f.fieldName, f.fieldValue]));

  assert.strictEqual(factMap10.fathers_name, 'Ramesh Kumar Sharma');
  assert.strictEqual(factMap10.mothers_name, 'Sunita Sharma');
  assert.strictEqual(factMap10.dob, '2002-05-14');
  assert.strictEqual(factMap10.gender, 'Male');
  assert.ok(factMap10.marks_10th.includes('92.4%'));
  assert.ok(factMap10.address.includes('Green Park'));

  const degreeDoc = `
    INDIAN INSTITUTE OF TECHNOLOGY
    This is to certify that Aarav Sharma has been admitted to the degree of
    Bachelor of Technology in Computer Science and Engineering
    CGPA: 8.95
    Higher Secondary School 12th Class: 94.6% Science CBSE 2020
  `;

  const factsDegree = extractProfileFacts(degreeDoc, 'Aarav Sharma');
  const factMapDegree = Object.fromEntries(factsDegree.map(f => [f.fieldName, f.fieldValue]));

  assert.ok(factMapDegree.education.includes('Bachelor of Technology'));
  assert.ok(factMapDegree.marks_12th.includes('94.6%'));
  assert.ok(factMapDegree.marks_12th.includes('Science'));
});

test('VaultService: User profile aggregation and cross-document contradiction detection', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-profile-test-'));
  const vaultPath = path.join(tmpDir, 'ProfileVault.fvault');

  const service = new VaultService();
  await service.createVault({
    vaultPath,
    password: 'MasterPassword123!',
    kdfParams: { memoryCost: 4096, timeCost: 1, parallelism: 1 }
  });

  // 1. Import Document 1: 10th Marksheet
  const file1 = path.join(tmpDir, '10th_marksheet.pdf');
  fs.writeFileSync(file1, `
    CENTRAL BOARD OF SECONDARY EDUCATION
    SECONDARY SCHOOL EXAMINATION 2018
    Candidate: Aarav Sharma
    Father's Name: Ramesh Sharma
    Mother's Name: Sunita Sharma
    Date of Birth: 14/05/2002
    Gender: Male
    Percentage: 91.5%
  `);

  await service.importDocument({
    filePath: file1,
    title: '10th Class Marksheet',
    category: 'education',
    person: 'Aarav Sharma'
  });

  // 2. Import Document 2: Passport (Consistent data)
  const file2 = path.join(tmpDir, 'passport.pdf');
  fs.writeFileSync(file2, `
    REPUBLIC OF INDIA PASSPORT
    Given Name: Aarav
    Surname: Sharma
    Father's Name: Ramesh Sharma
    Date of Birth: 14/05/2002
    Permanent Address: Flat 12, Park Street, New Delhi 110001
  `);

  await service.importDocument({
    filePath: file2,
    title: 'Indian Passport',
    category: 'identity',
    person: 'Aarav Sharma'
  });

  // Check profile without contradictions
  const profileConsistent = service.getUserProfile('Aarav Sharma');
  assert.strictEqual(profileConsistent.personName, 'Aarav Sharma');
  assert.strictEqual(profileConsistent.profile.fathersName, 'Ramesh Sharma');
  assert.strictEqual(profileConsistent.profile.dob, '2002-05-14');
  assert.strictEqual(profileConsistent.hasContradictions, false);
  assert.strictEqual(profileConsistent.contradictionCount, 0);
  assert.strictEqual(profileConsistent.documentsCount, 2);

  // 3. Import Document 3: Driving License with Contradictions (Differing Father's Name & differing DOB)
  const file3 = path.join(tmpDir, 'driving_license.pdf');
  fs.writeFileSync(file3, `
    MOTOR VEHICLES DEPARTMENT
    DRIVING LICENCE
    Name: Aarav Sharma
    Father's Name: Rajesh Sharma
    Date of Birth: 20/08/2003
    Address: Plot 99, Indiranagar, Bangalore 560038
  `);

  await service.importDocument({
    filePath: file3,
    title: 'Driving Licence',
    category: 'identity',
    person: 'Aarav Sharma'
  });

  // Query updated profile - should detect contradictions!
  const profileWithDiscrepancies = service.getUserProfile('Aarav Sharma');
  assert.strictEqual(profileWithDiscrepancies.hasContradictions, true);
  assert.ok(profileWithDiscrepancies.contradictionCount >= 2);

  // Contradiction on Father's Name: "Ramesh Sharma" vs "Rajesh Sharma"
  const fatherConflict = profileWithDiscrepancies.contradictions.fathers_name;
  assert.ok(fatherConflict);
  assert.strictEqual(fatherConflict.isContradicting, true);
  assert.strictEqual(fatherConflict.conflictingValues.length, 2);
  const fatherValues = fatherConflict.conflictingValues.map(v => v.value);
  assert.ok(fatherValues.includes('Ramesh Sharma'));
  assert.ok(fatherValues.includes('Rajesh Sharma'));

  // Contradiction on DOB: "2002-05-14" vs "2003-08-20"
  const dobConflict = profileWithDiscrepancies.contradictions.dob;
  assert.ok(dobConflict);
  assert.strictEqual(dobConflict.isContradicting, true);
  assert.strictEqual(dobConflict.conflictingValues.length, 2);
  const dobValues = dobConflict.conflictingValues.map(v => v.value);
  assert.ok(dobValues.includes('2002-05-14'));
  assert.ok(dobValues.includes('2003-08-20'));

  // Contradiction on Address
  const addrConflict = profileWithDiscrepancies.contradictions.address;
  assert.ok(addrConflict);
  assert.strictEqual(addrConflict.isContradicting, true);

  // 4. Test listUserProfiles summaries
  const userList = service.listUserProfiles();
  assert.strictEqual(userList.length, 1);
  assert.strictEqual(userList[0].name, 'Aarav Sharma');
  assert.strictEqual(userList[0].hasContradictions, true);
  assert.ok(userList[0].contradictionCount >= 2);
  assert.strictEqual(userList[0].documentsCount, 3);

  // 5. Test manual save/override of canonical profile
  service.saveUserProfile({
    name: 'Aarav Sharma',
    dob: '2002-05-14',
    fathersName: 'Ramesh Sharma',
    mothersName: 'Sunita Sharma',
    address: 'Flat 12, Park Street, New Delhi 110001',
    notes: 'Verified against original passport and 10th certificate.'
  });

  const resolved = service.getUserProfile('Aarav Sharma');
  assert.strictEqual(resolved.profile.fathersName, 'Ramesh Sharma');
  assert.strictEqual(resolved.profile.notes, 'Verified against original passport and 10th certificate.');

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
