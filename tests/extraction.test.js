'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { 
  findDateCandidates, 
  analyzeDocumentText, 
  computeExpiryStatus, 
  extractTextFromBuffer,
  extractOcrWordCoordinates,
  reconstructStructuredTableLayout
} = require('../src/main/services/extractionService');
const { VaultService } = require('../src/main/vault/vaultService');

test('ExtractionService: extractTextFromBuffer handles plaintext and invalid buffers gracefully', async () => {
  const plainBuf = Buffer.from('Hello world plain text content', 'utf8');
  const resPlain = await extractTextFromBuffer(plainBuf, 'application/pdf');
  assert.strictEqual(typeof resPlain.text, 'string');
  assert.ok(Array.isArray(resPlain.ocrWords));

  const emptyBuf = Buffer.from('', 'utf8');
  const resEmpty = await extractTextFromBuffer(emptyBuf, 'application/pdf');
  assert.strictEqual(resEmpty.text, '');
  assert.ok(Array.isArray(resEmpty.ocrWords));
});

test('ExtractionService: extractOcrWordCoordinates normalizes Tesseract word bounding boxes and coordinates', () => {
  const sampleTesseractData = {
    words: [
      { text: '®', bbox: { x0: 0, y0: 2, x1: 12, y1: 20 }, confidence: 0 },
      { text: 'DirectX', bbox: { x0: 20, y0: 6, x1: 67, y1: 17 }, confidence: 96.2 },
      { text: 'Diagnostic', bbox: { x0: 73, y0: 6, x1: 140, y1: 20 }, confidence: 95.8 }
    ]
  };

  const words = extractOcrWordCoordinates(sampleTesseractData);
  assert.strictEqual(words.length, 3);
  assert.deepStrictEqual(words[0], {
    text: '®',
    x: 0,
    y: 2,
    width: 12,
    height: 18,
    confidence: 0
  });
  assert.deepStrictEqual(words[1], {
    text: 'DirectX',
    x: 20,
    y: 6,
    width: 47,
    height: 11,
    confidence: 96
  });
  assert.deepStrictEqual(words[2], {
    text: 'Diagnostic',
    x: 73,
    y: 6,
    width: 67,
    height: 14,
    confidence: 96
  });
});

test('ExtractionService: reconstructStructuredTableLayout groups lines and preserves tabular column structure', () => {
  const tableWords = [
    { text: 'DirectX', x: 20, y: 6, width: 47, height: 11, confidence: 96 },
    { text: 'Diagnostic', x: 73, y: 6, width: 67, height: 14, confidence: 96 },
    { text: 'Tool', x: 145, y: 7, width: 30, height: 13, confidence: 97 },
    { text: 'Version', x: 20, y: 30, width: 50, height: 12, confidence: 95 },
    { text: '12.0', x: 145, y: 30, width: 30, height: 12, confidence: 98 }
  ];

  const result = reconstructStructuredTableLayout(tableWords);
  assert.strictEqual(result.lines.length, 2);
  assert.ok(result.structuredText.includes('DirectX Diagnostic Tool'));
  assert.ok(result.structuredText.includes('Version   \t12.0'));
});

test('ExtractionService: Deterministic date detection and candidate matching', () => {
  const sampleText = `
    REPUBLIC OF WONDERLAND
    PASSPORT
    Given Names: Jane
    Date of Issue: 2020-05-15
    Valid Until / Expiration Date: 2028-05-14
    Authority: Passport Office
  `;

  const candidates = findDateCandidates(sampleText);
  assert.strictEqual(candidates.length, 2);
  assert.strictEqual(candidates[0].date, '2020-05-15');
  assert.strictEqual(candidates[1].date, '2028-05-14');

  const analysis = analyzeDocumentText(sampleText, 'jane_passport.pdf');
  assert.strictEqual(analysis.docType, 'passport');
  assert.strictEqual(analysis.category, 'identity');
  assert.strictEqual(analysis.issueDate, '2020-05-15');
  assert.strictEqual(analysis.expiryDate, '2028-05-14');
  assert.ok(analysis.expirySnippet.includes('2028-05-14'));
  assert.strictEqual(analysis.confidence >= 0.85, true);
});

test('ExtractionService: Expiry status deterministic logic', () => {
  // Expired in past
  const expiredStatus = computeExpiryStatus('2020-01-01');
  assert.strictEqual(expiredStatus.status, 'expired');
  assert.strictEqual(expiredStatus.daysRemaining < 0, true);

  // Far future (active)
  const activeStatus = computeExpiryStatus('2099-12-31');
  assert.strictEqual(activeStatus.status, 'active');
  assert.strictEqual(activeStatus.daysRemaining > 60, true);

  // Null date
  const noneStatus = computeExpiryStatus(null);
  assert.strictEqual(noneStatus.status, 'none');
  assert.strictEqual(noneStatus.daysRemaining, null);
});

test('VaultService: Integrated metadata review and upcoming expiries flow', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-test-extraction-'));
  const vaultPath = path.join(tmpDir, 'ExtractionTest.vault');

  const testKdfParams = { timeCost: 1, memoryCost: 4096, parallelism: 1 };
  const service = new VaultService();
  await service.createVault({ vaultPath, password: 'StrongPassword123!', kdfParams: testKdfParams });

  // Create a simulated document with valid minimal 1x1 PNG
  const sampleFilePath = path.join(tmpDir, 'insurance_policy.png');
  const valid1x1Png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(sampleFilePath, valid1x1Png);

  const imported = await service.importDocument({
    filePath: sampleFilePath,
    title: 'Health Insurance Policy',
    category: 'insurance',
    person: 'Alice'
  });

  const versionId = imported.currentVersion.id;

  // Manually/programmatically update metadata as a review step
  const updated = service.updateMetadata({
    versionId,
    docType: 'insurance_policy',
    issuer: 'Blue Health Corp',
    issueDate: '2025-01-01',
    expiryDate: '2027-01-01',
    reviewStatus: 'confirmed'
  });

  assert.strictEqual(updated.currentVersion.metadata.docType, 'insurance_policy');
  assert.strictEqual(updated.currentVersion.metadata.issuer, 'Blue Health Corp');
  assert.strictEqual(updated.currentVersion.metadata.expiryDate, '2027-01-01');
  assert.strictEqual(updated.currentVersion.metadata.reviewStatus, 'confirmed');

  // Verify it appears in upcoming expiries
  const expiries = service.listUpcomingExpiries();
  assert.strictEqual(expiries.length, 1);
  assert.strictEqual(expiries[0].title, 'Health Insurance Policy');

  service.lockVault();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ExtractionService: Multimodal vision OCR priority and graceful Tesseract fallback', async () => {
  const { llmService } = require('../src/main/services/llmService');

  // Case 1: When multimodal model is ready, it is used as primary
  llmService._isReady = true;
  llmService.processImageWithVision = async () => ({
    text: 'Aadhaar Card Government of India\nName: Rajesh Kumar',
    ocrWords: [
      { text: 'Aadhaar', x: 20, y: 15, width: 60, height: 14, confidence: 98 },
      { text: 'Card', x: 85, y: 15, width: 35, height: 14, confidence: 98 },
      { text: 'Name:', x: 20, y: 40, width: 45, height: 12, confidence: 95 },
      { text: 'Rajesh', x: 70, y: 40, width: 50, height: 12, confidence: 97 },
      { text: 'Kumar', x: 125, y: 40, width: 45, height: 12, confidence: 97 }
    ],
    method: 'multimodal-gemma4-vision'
  });

  const validImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const visionRes = await extractTextFromBuffer(validImage, 'image/png');
  assert.strictEqual(visionRes.method, 'multimodal-gemma4-vision');
  assert.strictEqual(visionRes.ocrWords.length, 5);
  assert.ok(visionRes.text.includes('Aadhaar Card'));
  assert.ok(visionRes.text.includes('Rajesh Kumar'));

  // Case 2: When multimodal model fails or throws, gracefully falls back
  llmService.processImageWithVision = async () => {
    throw new Error('Neural model execution failure');
  };

  const fallbackRes = await extractTextFromBuffer(validImage, 'image/png');
  // Should gracefully proceed to fallback without unhandled rejections
  assert.ok(fallbackRes.method === 'ocr-tesseract-fallback' || fallbackRes.method === 'ocr-unavailable');
});
