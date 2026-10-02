'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { LlmService } = require('../src/main/services/llmService');

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
