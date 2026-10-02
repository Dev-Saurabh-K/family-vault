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

  // 3. Question about something not present
  const res3 = await service.answerQuestion({
    query: 'What is the password for the Wi-Fi router in the garage?',
    documents: mockDocs
  });

  assert.ok(res3.answer.includes('could not find information'));
  assert.strictEqual(res3.sources.length, 0);
  assert.strictEqual(res3.confidence, 0);
});

test('LlmService: Status and host binding security configuration', () => {
  const service = new LlmService();
  const status = service.getStatus();

  assert.strictEqual(typeof status.isServerRunning, 'boolean');
  assert.strictEqual(status.port, 18432);
});
