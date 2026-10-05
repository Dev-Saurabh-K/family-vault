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
  reconstructStructuredTableLayout,
  normalizeExtractedText,
  hasUsableExtractedText,
  meanOcrConfidence,
  shouldTrySecondaryOcr,
  chooseOcrCandidate
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

test('ExtractionService: Normalizes OCR whitespace without changing document values or table rows', () => {
  const rawText = '\u0000  Policy Number: HV-482901.  \r\n\r\n\r\nTOTAL PAYABLE: $1,870.00.   \rItem\tQuantity\tAmount';
  const normalized = normalizeExtractedText(rawText);

  assert.equal(
    normalized,
    'Policy Number: HV-482901.\n\nTOTAL PAYABLE: $1,870.00.\nItem\tQuantity\tAmount'
  );
  assert.ok(hasUsableExtractedText(normalized));
  assert.equal(hasUsableExtractedText(' \u0000---... '), false);
});

test('ExtractionService: Uses OCR confidence to decide when to compare the secondary engine', () => {
  const weakPaddleWords = [
    { text: 'Policy', confidence: 38 },
    { text: 'N0:', confidence: 42 }
  ];
  const strongTesseractWords = [
    { text: 'Policy', confidence: 91 },
    { text: 'No:', confidence: 94 },
    { text: 'AB-001908', confidence: 92 }
  ];

  assert.equal(meanOcrConfidence(weakPaddleWords), 40);
  assert.equal(shouldTrySecondaryOcr('Policy N0:', weakPaddleWords), true);
  assert.equal(shouldTrySecondaryOcr('Policy No: AB-001908', strongTesseractWords), false);
  assert.equal(chooseOcrCandidate(
    { text: 'Policy N0:', ocrWords: weakPaddleWords, method: 'paddle' },
    { text: 'Policy No: AB-001908', ocrWords: strongTesseractWords, method: 'tesseract' }
  ).method, 'tesseract');
});

test('ExtractionService: Retries low-confidence PaddleOCR and selects the stronger OCR result', async () => {
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const Tesseract = require('tesseract.js');
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalRecognize = Tesseract.recognize;
  let tesseractCalls = 0;

  paddleOcrService.extractText = async () => ({
    text: 'Policy N0: AB-00I908',
    ocrWords: [
      { text: 'Policy', x: 0, y: 0, width: 35, height: 10, confidence: 35 },
      { text: 'AB-00I908', x: 45, y: 0, width: 55, height: 10, confidence: 40 }
    ],
    method: 'ocr-paddleocr-primary'
  });
  Tesseract.recognize = async () => {
    tesseractCalls += 1;
    return {
      data: {
        text: 'Policy No: AB-001908',
        words: [
          { text: 'Policy', bbox: { x0: 0, y0: 0, x1: 35, y1: 10 }, confidence: 95 },
          { text: 'AB-001908', bbox: { x0: 45, y0: 0, x1: 100, y1: 10 }, confidence: 96 }
        ]
      }
    };
  };

  try {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const result = await extractTextFromBuffer(image, 'image/png');
    assert.equal(tesseractCalls, 1);
    assert.equal(result.method, 'ocr-tesseract-fallback');
    assert.equal(result.text, 'Policy No: AB-001908');
  } finally {
    paddleOcrService.extractText = originalPaddleExtract;
    Tesseract.recognize = originalRecognize;
  }
});

test('ExtractionService: Applies OCR confidence comparison to scanned PDF pages', async () => {
  const pdfParseModule = require('pdf-parse');
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const Tesseract = require('tesseract.js');
  const originalPdfParse = pdfParseModule.PDFParse;
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalRecognize = Tesseract.recognize;

  pdfParseModule.PDFParse = class {
    async load() {}
    async getText() { return { total: 1, pages: [{}], text: '' }; }
    async getScreenshot() {
      return { pages: [{ dataUrl: 'data:image/png;base64,AA==' }] };
    }
    async destroy() {}
  };
  paddleOcrService.extractText = async () => ({
    text: 'Expiry 2030-08-14',
    ocrWords: [{ text: 'Expiry', x: 0, y: 0, width: 30, height: 10, confidence: 30 }],
    method: 'ocr-paddleocr-primary'
  });
  Tesseract.recognize = async () => ({
    data: {
      text: 'Expiry date: 2030-08-14',
      words: [{ text: 'Expiry', bbox: { x0: 0, y0: 0, x1: 30, y1: 10 }, confidence: 95 }]
    }
  });

  try {
    const result = await extractTextFromBuffer(Buffer.from('pdf'), 'application/pdf');
    assert.equal(result.method, 'pdf-ocr-tesseract-fallback');
    assert.ok(result.text.includes('Expiry date: 2030-08-14'));
  } finally {
    pdfParseModule.PDFParse = originalPdfParse;
    paddleOcrService.extractText = originalPaddleExtract;
    Tesseract.recognize = originalRecognize;
  }
});

test('ExtractionService: Tesseract fallback marks symbol-only OCR as unavailable', async () => {
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const Tesseract = require('tesseract.js');
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalRecognize = Tesseract.recognize;

  paddleOcrService.extractText = async () => ({
    text: '--- ...',
    ocrWords: [],
    method: 'ocr-paddleocr-primary'
  });
  Tesseract.recognize = async () => ({
    data: { text: '--- ...', words: [] }
  });

  try {
    const validImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const result = await extractTextFromBuffer(validImage, 'image/png');

    assert.equal(result.method, 'ocr-unavailable');
    assert.equal(result.text, '');
    assert.deepEqual(result.ocrWords, []);
  } finally {
    paddleOcrService.extractText = originalPaddleExtract;
    Tesseract.recognize = originalRecognize;
  }
});

test('ExtractionService: Falls back from unusable PaddleOCR text and preserves exact OCR values', async () => {
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const Tesseract = require('tesseract.js');
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalRecognize = Tesseract.recognize;
  let tesseractCalls = 0;

  paddleOcrService.extractText = async () => ({
    text: '--- ...',
    ocrWords: [],
    method: 'ocr-paddleocr-primary'
  });
  Tesseract.recognize = async () => {
    tesseractCalls += 1;
    return {
      data: {
        text: 'Policy No: AB-001908\nTotal: $1,870.00',
        words: []
      }
    };
  };

  try {
    const validImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const result = await extractTextFromBuffer(validImage, 'image/png');

    assert.equal(tesseractCalls, 1);
    assert.equal(result.method, 'ocr-tesseract-fallback');
    assert.equal(result.text, 'Policy No: AB-001908\nTotal: $1,870.00');
    assert.ok(result.text.includes('AB-001908'));
    assert.ok(result.text.includes('$1,870.00'));
  } finally {
    paddleOcrService.extractText = originalPaddleExtract;
    Tesseract.recognize = originalRecognize;
  }
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

test('ExtractionService: Does not mistake an unlabeled first OCR line for the issuer', () => {
  const analysis = analyzeDocumentText(
    'CITY POWER & ELECTRICITY\nAccount: 994821\nAmount Due: $142.50',
    'scan_001.pdf'
  );
  assert.equal(analysis.issuer, null);

  const labeled = analyzeDocumentText(
    'CITY POWER & ELECTRICITY\nIssuer: City Power\nAccount: 994821',
    'scan_001.pdf'
  );
  assert.equal(labeled.issuer, 'City Power');
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

test('ExtractionService: Uses Tesseract after PaddleOCR failure without invoking Gemma vision', async () => {
  const { llmService } = require('../src/main/services/llmService');
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const Tesseract = require('tesseract.js');
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalRecognize = Tesseract.recognize;
  const originalVision = llmService.processImageWithVision;
  let visionCalled = false;

  paddleOcrService.extractText = async () => {
    throw new Error('Simulated PaddleOCR failure');
  };
  Tesseract.recognize = async () => ({
    data: {
      text: 'Aadhaar Card Government of India\nName: Rajesh Kumar',
      words: []
    }
  });
  llmService.processImageWithVision = async () => {
    visionCalled = true;
    throw new Error('Gemma vision must not be used for OCR');
  };

  try {
    const validImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const fallbackRes = await extractTextFromBuffer(validImage, 'image/png');
    assert.strictEqual(fallbackRes.method, 'ocr-tesseract-fallback');
    assert.ok(fallbackRes.text.includes('Aadhaar Card'));
    assert.ok(fallbackRes.text.includes('Rajesh Kumar'));
    assert.strictEqual(visionCalled, false);
  } finally {
    paddleOcrService.extractText = originalPaddleExtract;
    Tesseract.recognize = originalRecognize;
    llmService.processImageWithVision = originalVision;
  }
});
