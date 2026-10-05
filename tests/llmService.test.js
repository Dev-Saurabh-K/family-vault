'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  LlmService,
  parseAndValidateAiMetadata,
  VALID_CATEGORIES,
  VALID_DOC_TYPES
} = require('../src/main/services/llmService');

test('LlmService: Grounded extractive QA returns citations and source references', async () => {
  const service = new LlmService();

  const mockDocs = [
    {
      id: 'doc-1',
      title: 'State Farm Auto Insurance',
      category: 'insurance',
      notes: 'Car insurance for Honda Civic',
      currentVersion: {
        fileName: 'auto_policy.pdf',
        metadata: {
          docType: 'insurance_policy',
          issuer: 'State Farm',
          expiryDate: '2026-11-30',
          textContent: 'Policy Number: SF-994821. Deductible for collision is $500. Roadside assistance coverage included.'
        }
      }
    },
    {
      id: 'doc-2',
      title: 'Dr Smith Prescription',
      category: 'medical',
      notes: 'Allergy medication',
      currentVersion: {
        fileName: 'prescription.pdf',
        metadata: {
          docType: 'medical_record',
          issuer: 'Memorial Hospital',
          expiryDate: '2025-06-01',
          textContent: 'Patient: John Doe. Take Cetirizine 10mg once daily before sleep. Refills remaining: 3.'
        }
      }
    }
  ];

  // 1. Question with matching content
  const res1 = await service.answerQuestion({
    query: 'What is the collision deductible on my car insurance?',
    documents: mockDocs
  });

  assert.ok(res1.answer.includes('$500') || res1.answer.includes('deductible'));
  assert.strictEqual(res1.sources.length > 0, true);
  assert.strictEqual(res1.sources[0].documentTitle, 'State Farm Auto Insurance');
  assert.strictEqual(res1.sources[0].documentId, 'doc-1');

  // 2. Question with medical content
  const res2 = await service.answerQuestion({
    query: 'How often should I take Cetirizine?',
    documents: mockDocs
  });

  assert.ok(res2.answer.includes('Cetirizine') || res2.answer.includes('daily'));
  assert.strictEqual(res2.sources[0].documentTitle, 'Dr Smith Prescription');

  // 3. Question about metadata (person / expiry date)
  const res3 = await service.answerQuestion({
    query: 'When does the State Farm insurance policy expire?',
    documents: mockDocs
  });
  assert.ok(res3.answer.includes('2026-11-30') || res3.answer.includes('State Farm'));
  assert.strictEqual(res3.sources[0].documentTitle, 'State Farm Auto Insurance');

  // 4. Question with semantic match
  const res4 = await service.answerQuestion({
    query: 'What pills should I take before bed?',
    documents: mockDocs,
    semanticMatches: [{
      documentId: 'doc-2',
      documentTitle: 'Dr Smith Prescription',
      fileName: 'prescription.pdf',
      category: 'medical',
      chunkText: 'Take Cetirizine 10mg once daily before sleep.',
      similarity: 0.85
    }]
  });
  assert.ok(res4.answer.includes('Cetirizine'));
  assert.strictEqual(res4.sources[0].documentTitle, 'Dr Smith Prescription');

  // 5. Question about something not present
  const res5 = await service.answerQuestion({
    query: 'What is the password for the Wi-Fi router in the garage?',
    documents: mockDocs
  });

  assert.ok(res5.answer.includes('could not find information'));
  assert.strictEqual(res5.sources.length, 0);
  assert.strictEqual(res5.confidence, 0);
});

test('LlmService: Status and host binding security configuration', () => {
  const service = new LlmService();
  const status = service.getStatus();

  assert.strictEqual(typeof status.isServerRunning, 'boolean');
  assert.strictEqual(status.port, 18432);
  assert.strictEqual(typeof status.isModelDownloaded, 'boolean');
  assert.strictEqual(typeof status.isBinaryAvailable, 'boolean');
});

test('LlmService: Directory resolution for download and runtime environments', () => {
  const service = new LlmService();
  const modelsDir = service.getModelsDirectory(true);
  const binDir = service.getBinDirectory(true);

  assert.ok(typeof modelsDir === 'string' && modelsDir.length > 0);
  assert.ok(typeof binDir === 'string' && binDir.length > 0);
  assert.ok(modelsDir.includes('models'));
  assert.ok(binDir.includes('bin'));
});

test('LlmService: Handles OCR ticket data and travel schedule questions with synonym expansion', async () => {
  const service = new LlmService();

  const ticketDoc = {
    id: 'doc-ticket',
    title: 'shubham ticket',
    category: 'transport',
    person: 'Shubham Tiwari',
    currentVersion: {
      fileName: 'shubham ticket.pdf',
      metadata: {
        docType: 'ticket',
        textContent: `Electronic Reservation Slip (ERS) orl user
BUKAR (BXR) BUXAR (BXR) HOWRAH IN (WH)
Start Date" 22.5ept- 2026 Departure* 23:23 22-Sep-2026 Arial* 11:30 23 Sept 2026
PR Train No Name Css
2704285754 13042 / HIMGIRI EXPRESS SLEEPER CLASS (SL)
Passenger Details
1. SHUBHAM TAR now curfsTIso/uPER EE`
      }
    }
  };

  // 1. Person timing query
  const res1 = await service.answerQuestion({
    query: 'when is shubham train timing?',
    documents: [ticketDoc]
  });
  assert.ok(res1.sources.length > 0);
  assert.strictEqual(res1.sources[0].documentTitle, 'shubham ticket');
  assert.ok(res1.sources[0].snippet.includes('23:23') || res1.sources[0].snippet.includes('HIMGIRI'));

  // 2. Schedule synonym query
  const res2 = await service.answerQuestion({
    query: 'tell me train schedule',
    documents: [ticketDoc]
  });
  assert.ok(res2.sources.length > 0);
  assert.strictEqual(res2.sources[0].documentTitle, 'shubham ticket');
  assert.ok(res2.sources[0].snippet.includes('13042') || res2.sources[0].snippet.includes('HIMGIRI'));
});

test('LlmService: parseAndValidateAiMetadata enforces strict allowed category choices', () => {
  const text = 'PASSPORT REPUBLIC OF INDIA Name: Priya Sharma Date of Expiry: 14/08/2030';

  // 1. Valid categories are accepted
  for (const cat of ['identity', 'insurance', 'medical', 'tax', 'property', 'other']) {
    const json = JSON.stringify({
      category: cat,
      docType: 'passport',
      person: 'Priya Sharma',
      expiryDate: '2030-08-14'
    });
    const parsed = parseAndValidateAiMetadata(json, text, 'passport.pdf');
    assert.strictEqual(parsed.category, cat);
  }

  // 2. Disallowed / invented categories are strictly rejected
  const invalidCats = ['automobile', 'finances', 'random', 'receipt', 'government_docs', ''];
  for (const badCat of invalidCats) {
    const json = JSON.stringify({
      category: badCat,
      docType: 'passport',
      person: 'Priya Sharma',
      expiryDate: '2030-08-14'
    });
    const parsed = parseAndValidateAiMetadata(json, text, 'passport.pdf');
    assert.strictEqual(parsed.category, null, `Should reject invalid category: "${badCat}"`);
  }
});

test('LlmService: parseAndValidateAiMetadata verifies expiry date grounding and rejects hallucinations', () => {
  const groundedText = 'Health Insurance Policy for John Doe. Policy active until 2028-12-31. Ref: POL-8821.';

  // 1. Grounded date present in text is accepted
  const groundedJson = JSON.stringify({
    category: 'insurance',
    docType: 'insurance_policy',
    person: 'John Doe',
    expiryDate: '2028-12-31',
    expirySnippet: 'active until 2028-12-31'
  });
  const groundedResult = parseAndValidateAiMetadata(groundedJson, groundedText, 'policy.pdf');
  assert.strictEqual(groundedResult.expiryDate, '2028-12-31');
  assert.strictEqual(groundedResult.expirySnippet, 'active until 2028-12-31');

  // 2. Hallucinated date with year not in document text is strictly rejected
  const hallucinatedJson = JSON.stringify({
    category: 'insurance',
    docType: 'insurance_policy',
    person: 'John Doe',
    expiryDate: '2035-05-15',
    expirySnippet: 'Expires on 2035-05-15'
  });
  const hallucinatedResult = parseAndValidateAiMetadata(hallucinatedJson, groundedText, 'policy.pdf');
  assert.strictEqual(hallucinatedResult.expiryDate, null, 'Hallucinated date must be null');

  // 3. Invalid date format or impossible calendar day (e.g. Feb 31) is rejected
  const impossibleDateJson = JSON.stringify({
    category: 'insurance',
    docType: 'insurance_policy',
    expiryDate: '2028-02-31'
  });
  const impossibleResult = parseAndValidateAiMetadata(impossibleDateJson, groundedText, 'policy.pdf');
  assert.strictEqual(impossibleResult.expiryDate, null);
});

test('LlmService: parseAndValidateAiMetadata matches family members and rejects false positives', () => {
  const text = 'REPUBLIC OF INDIA PASSPORT SURNAME: SHARMA GIVEN NAMES: PRIYA DATE OF BIRTH: 1995-04-12';
  const knownPersons = ['Priya Sharma', 'Vikram Sharma'];

  // 1. Matches known family member with canonical casing
  const aiJson = JSON.stringify({
    category: 'identity',
    docType: 'passport',
    person: 'priya sharma'
  });
  const res = parseAndValidateAiMetadata(aiJson, text, 'passport.pdf', knownPersons);
  assert.strictEqual(res.person, 'Priya Sharma');

  // 2. Rejects blacklist non-person strings
  const blacklistJson = JSON.stringify({
    category: 'identity',
    docType: 'passport',
    person: 'Government of India'
  });
  const res2 = parseAndValidateAiMetadata(blacklistJson, text, 'passport.pdf', knownPersons);
  assert.strictEqual(res2.person, null);
});

test('LlmService: extractDocumentMetadata seamless offline fallback and neural execution', async () => {
  const service = new LlmService();
  const passportText = `PASSPORT
REPUBLIC OF INDIA
SURNAME: SHARMA
GIVEN NAMES: RAHUL
DATE OF ISSUE: 15/04/2021
DATE OF EXPIRY: 14/04/2031`;

  // 1. When offline (isReady == false), returns deterministic analysis
  assert.strictEqual(service.isReady(), false);
  const fallbackRes = await service.extractDocumentMetadata({
    text: passportText,
    fileName: 'rahul_passport.pdf',
    knownPersons: ['Rahul Sharma']
  });
  assert.strictEqual(fallbackRes.method, 'deterministic');
  assert.strictEqual(fallbackRes.category, 'identity');
  assert.strictEqual(fallbackRes.person, 'Rahul Sharma');
  assert.strictEqual(fallbackRes.expiryDate, '2031-04-14');

  // 2. When neural model is online, invokes local AI and enforces strict schema
  service._isReady = true;
  service._queryLlamaServer = async () => {
    return JSON.stringify({
      category: 'identity',
      docType: 'passport',
      person: 'Rahul Sharma',
      expiryDate: '2031-04-14',
      expirySnippet: 'DATE OF EXPIRY: 14/04/2031',
      issuer: 'Government of India',
      tags: ['passport', 'travel', 'official'],
      confidence: 0.95
    });
  };

  const aiRes = await service.extractDocumentMetadata({
    text: passportText,
    fileName: 'rahul_passport.pdf',
    knownPersons: ['Rahul Sharma']
  });

  assert.strictEqual(aiRes.method, 'local-ai-gemma4');
  assert.strictEqual(aiRes.category, 'identity');
  assert.strictEqual(aiRes.person, 'Rahul Sharma');
  assert.strictEqual(aiRes.expiryDate, '2031-04-14');
  assert.strictEqual(aiRes.expirySnippet, 'DATE OF EXPIRY: 14/04/2031');
  assert.ok(aiRes.tags.includes('passport'));

  // 3. When AI returns an invalid / invented category, system falls back to deterministic category
  service._queryLlamaServer = async () => {
    return JSON.stringify({
      category: 'invalid_category_hallucination',
      docType: 'passport',
      person: 'Rahul Sharma',
      expiryDate: '2031-04-14'
    });
  };

  const guardedRes = await service.extractDocumentMetadata({
    text: passportText,
    fileName: 'rahul_passport.pdf',
    knownPersons: ['Rahul Sharma']
  });

  assert.strictEqual(guardedRes.category, 'identity', 'Must fall back to valid deterministic category');
});

test('LlmService: processImageWithVision extracts coordinates and structured text', async () => {
  const service = new LlmService();
  service._isReady = true;

  service._queryLlamaChat = async () => {
    return JSON.stringify({
      fullText: 'Diagnostic Tool Version 12.0',
      words: [
        { text: 'Diagnostic', x: 20, y: 10, width: 60, height: 14, confidence: 96 },
        { text: 'Tool', x: 85, y: 10, width: 30, height: 14, confidence: 97 },
        { text: 'Version', x: 20, y: 35, width: 50, height: 12, confidence: 95 },
        { text: '12.0', x: 120, y: 35, width: 30, height: 12, confidence: 98 }
      ]
    });
  };

  const dummyImage = Buffer.from('fake-image-bytes');
  const result = await service.processImageWithVision({ imageBuffer: dummyImage, mimeType: 'image/png' });

  assert.strictEqual(result.method, 'multimodal-gemma4-vision');
  assert.strictEqual(result.ocrWords.length, 4);
  assert.strictEqual(result.ocrWords[0].text, 'Diagnostic');
  assert.strictEqual(result.ocrWords[0].x, 20);
  assert.strictEqual(result.ocrWords[0].y, 10);
  assert.strictEqual(result.ocrWords[0].confidence, 96);
  assert.ok(result.text.includes('Diagnostic Tool'));
  assert.ok(result.text.includes('Version'));
});

test('LlmService: processImageWithVision throws on failure for graceful Tesseract fallback', async () => {
  const service = new LlmService();
  service._isReady = true;
  service._queryLlamaChat = async () => {
    throw new Error('Vision projector offline');
  };
  service._queryLlamaCompletion = async () => {
    throw new Error('Completion offline');
  };

  const dummyImage = Buffer.from('fake-image-bytes');
  await assert.rejects(
    async () => await service.processImageWithVision({ imageBuffer: dummyImage }),
    /offline/
  );
});

test('LlmService: parseAndValidateAiMetadata enforces strict category "other" and review needed for unmatched persons', () => {
  const text = 'Life Insurance Policy document for John Doe. Policy issue 2024-01-01.';
  const knownPersons = ['Alice Smith', 'Bob Smith']; // John Doe is NOT an added family member!

  // 1. Unmatched candidate person in document
  const aiJson = JSON.stringify({
    category: 'insurance',
    docType: 'insurance_policy',
    person: 'John Doe'
  });

  const res = parseAndValidateAiMetadata(aiJson, text, 'policy.pdf', knownPersons);
  assert.strictEqual(res.person, null, 'Unmatched person must NOT be auto-assigned');
  assert.strictEqual(res.unmatchedPerson, 'John Doe', 'Unmatched person name must be flagged for review');
  assert.strictEqual(res.category, 'other', 'Document category must be strictly overridden to "other"');
  assert.strictEqual(res.docType, 'other', 'DocType must be overridden to "other"');
  assert.strictEqual(res.isUserMatched, false);

  // 2. Verified added family member correctly assigns category and person
  const aiJsonMatched = JSON.stringify({
    category: 'insurance',
    docType: 'insurance_policy',
    person: 'Alice Smith'
  });
  const resMatched = parseAndValidateAiMetadata(aiJsonMatched, text, 'policy.pdf', knownPersons);
  assert.strictEqual(resMatched.person, 'Alice Smith');
  assert.strictEqual(resMatched.unmatchedPerson, null);
  assert.strictEqual(resMatched.category, 'insurance');
  assert.strictEqual(resMatched.isUserMatched, true);
});

test('LlmService: _buildExtractionPrompt enforces strict zero-temperature guidelines and category constraints', () => {
  const service = new LlmService();
  const prompt = service._buildExtractionPrompt('Passport document for John Doe', 'passport.pdf', ['Alice']);

  assert.ok(prompt.includes('Existing family members in vault: "Alice"'));
  assert.ok(prompt.includes('CRITICAL USER CATEGORIZATION RULES'));
  assert.ok(prompt.includes('category" field MUST be EXACTLY one of: "identity", "insurance", "medical", "tax", "property", "other"'));
  assert.ok(prompt.includes('unmatchedPerson'));
});


