'use strict';

const documents = [
  {
    id: 'auto-policy',
    title: 'Honda Auto Insurance Policy',
    category: 'insurance',
    person: 'Morgan Reed',
    currentVersion: {
      fileName: 'honda-policy.txt',
      metadata: {
        textContent: 'Policy Number: HV-482901. Collision deductible: $750.'
      }
    }
  },
  {
    id: 'train-departure',
    title: 'Aarav Sharma Train Departure Ticket',
    category: 'other',
    person: 'Aarav Sharma',
    currentVersion: {
      fileName: 'departure-ticket.txt',
      metadata: {
        textContent: 'Train journey reference: TR-8142. Departure time: 06:40 AM.'
      }
    }
  },
  {
    id: 'train-arrival',
    title: 'Aarav Sharma Train Arrival Details',
    category: 'other',
    person: 'Aarav Sharma',
    currentVersion: {
      fileName: 'arrival-details.txt',
      metadata: {
        textContent: 'Train journey reference: TR-8142. Arrival station: Jaipur Junction.'
      }
    }
  },
  {
    id: 'ava-lee-passport',
    title: 'Ava Lee Passport',
    category: 'identity',
    person: 'Ava Lee',
    currentVersion: {
      fileName: 'ava-lee-passport.txt',
      metadata: {
        textContent: 'Passport holder: Ava Lee. Passport number: LEE-70031.'
      }
    }
  },
  {
    id: 'ava-li-passport',
    title: 'Ava Li Passport',
    category: 'identity',
    person: 'Ava Li',
    currentVersion: {
      fileName: 'ava-li-passport.txt',
      metadata: {
        textContent: 'Passport holder: Ava Li. Passport number: LI-99208.'
      }
    }
  },
  {
    id: 'electricity-bill',
    title: 'Morgan Reed Electricity Bill',
    category: 'other',
    person: 'Morgan Reed',
    currentVersion: {
      fileName: 'electricity-bill.txt',
      metadata: {
        textContent: 'Electricity account: EL-2044. Amount due: $83.20 by 2026-11-15.'
      }
    }
  },
  {
    id: 'invoice-scan',
    title: 'Phone Camera Invoice Scan',
    category: 'other',
    currentVersion: {
      fileName: 'invoice-scan.txt',
      metadata: {
        textContent: 'INVO1CE 2026-104. Items total: $1,700.00. Tax: $170.00. TOTAL PAYABLE: $1,870.00.'
      }
    }
  },
  {
    id: 'travel-insurance',
    title: 'Morgan Reed Travel Insurance',
    category: 'insurance',
    person: 'Morgan Reed',
    currentVersion: {
      fileName: 'travel-insurance.txt',
      metadata: {
        textContent: 'Travel coverage certificate TI-88. Benefits include passport replacement assistance. Policy expires 2026-12-31.'
      }
    }
  }
];

const profiles = [
  { profile: { name: 'Aarav Sharma' }, contradictions: {} },
  { profile: { name: 'Ava Lee' }, contradictions: {} },
  { profile: { name: 'Ava Li' }, contradictions: {} },
  {
    profile: { name: 'Morgan Reed', dob: '1990-01-02' },
    contradictions: { dob: { isContradicting: true } }
  }
];

const cases = [
  {
    id: 'direct-fact',
    description: 'Answers a direct document-number lookup from the matching policy',
    query: 'What is the policy number for the Honda auto insurance?',
    expectedFacts: ['HV-482901'],
    acceptableSourceDocumentIds: ['auto-policy'],
    documentIds: ['auto-policy'],
    profileNames: [],
    shouldAbstain: false
  },
  {
    id: 'multi-document',
    description: 'Combines complementary details from two documents for one trip',
    query: "What are Aarav Sharma's train departure time and arrival station?",
    expectedFacts: ['06:40 AM', 'Jaipur Junction'],
    acceptableSourceDocumentIds: ['train-departure', 'train-arrival'],
    requiredSourceDocumentIds: ['train-departure', 'train-arrival'],
    documentIds: ['train-departure', 'train-arrival'],
    profileNames: ['Aarav Sharma'],
    shouldAbstain: false,
    personScope: 'Aarav Sharma'
  },
  {
    id: 'similar-names',
    description: 'Uses the exact named family member and excludes a similarly named person',
    query: "What is Ava Lee's passport number?",
    expectedFacts: ['LEE-70031'],
    forbiddenAnswerTerms: ['LI-99208'],
    acceptableSourceDocumentIds: ['ava-lee-passport'],
    documentIds: ['ava-lee-passport', 'ava-li-passport'],
    profileNames: ['Ava Lee', 'Ava Li'],
    shouldAbstain: false,
    personScope: 'Ava Lee'
  },
  {
    id: 'absent-answer',
    description: 'Abstains when the vault contains no answer to the question',
    query: 'What is the Wi-Fi password for the garage router?',
    expectedFacts: [],
    acceptableSourceDocumentIds: [],
    documentIds: ['auto-policy', 'electricity-bill', 'travel-insurance'],
    profileNames: [],
    shouldAbstain: true
  },
  {
    id: 'conflicting-profile',
    description: 'Does not choose a single value when profile facts conflict',
    query: "What is Morgan Reed's date of birth?",
    expectedFacts: ['conflicting values are recorded'],
    acceptableSourceDocumentIds: [],
    documentIds: [],
    profileNames: ['Morgan Reed'],
    shouldAbstain: false,
    requiredSourceTypes: ['profile'],
    personScope: 'Morgan Reed'
  },
  {
    id: 'ocr-heavy-scan',
    description: 'Answers a total lookup from representative OCR text with a character error',
    query: 'What is the total payable on the invoice?',
    expectedFacts: ['$1,870.00'],
    acceptableSourceDocumentIds: ['invoice-scan'],
    documentIds: ['invoice-scan'],
    profileNames: [],
    shouldAbstain: false
  },
  {
    id: 'misleading-related-document',
    description: 'Does not mistake travel-insurance text for a passport expiry date',
    query: "When does Morgan Reed's passport expire?",
    expectedFacts: [],
    acceptableSourceDocumentIds: [],
    documentIds: ['electricity-bill', 'travel-insurance'],
    profileNames: ['Morgan Reed'],
    shouldAbstain: true,
    personScope: 'Morgan Reed'
  }
];

function createEvaluationDocuments(documentIds = documents.map(document => document.id)) {
  return documents.filter(document => documentIds.includes(document.id)).map(document => ({
    ...document,
    currentVersion: {
      ...document.currentVersion,
      metadata: { ...document.currentVersion.metadata }
    }
  }));
}

function createEvaluationProfiles(profileNames = profiles.map(entry => entry.profile.name)) {
  return profiles.filter(entry => profileNames.includes(entry.profile.name)).map(entry => ({
    profile: { ...entry.profile },
    contradictions: structuredClone(entry.contradictions)
  }));
}

module.exports = {
  cases,
  createEvaluationDocuments,
  createEvaluationProfiles
};
