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
  assessExtractedTextQuality,
  meanOcrConfidence,
  shouldTrySecondaryOcr,
  chooseOcrCandidate,
  selectPagesForOcr,
  selectSparseTextPages,
  estimateSkewAngle,
  shouldTryDeskewOcr,
  shouldTryRightAngleRotation,
  hasPredominantlyVerticalTextBoxes,
  selectRightAngleOcrOrientation
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

test('ExtractionService: Scales table row and column grouping to high-resolution OCR geometry', () => {
  const highResolutionWords = [
    { text: 'TOTAL', x: 20, y: 150, width: 70, height: 30, confidence: 96 },
    { text: '$100.00', x: 260, y: 156, width: 110, height: 30, confidence: 96 },
    { text: 'Product', x: 20, y: 60, width: 105, height: 36, confidence: 94 },
    { text: 'A', x: 132, y: 57, width: 18, height: 30, confidence: 94 },
    { text: '2', x: 260, y: 64, width: 18, height: 30, confidence: 95 },
    { text: '$50.00', x: 330, y: 60, width: 100, height: 34, confidence: 95 }
  ];

  const result = reconstructStructuredTableLayout(highResolutionWords);
  assert.equal(result.lines.length, 2);
  assert.equal(result.structuredText.split('\n')[0], 'Product A   \t2   \t$50.00');
  assert.equal(result.structuredText.split('\n')[1], 'TOTAL   \t$100.00');
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

test('ExtractionService: Detects corrupt extracted PDF text without rejecting normal tables', () => {
  const corrupted = 'Policy �� �߿ ��� #### ��� �߿ ��� ### Policy �� ��� ��� �߿';
  const readableTable = 'ITEM  QTY  AMOUNT\nProduct A  2  $50.00\nTOTAL  $100.00';
  assert.ok(assessExtractedTextQuality(corrupted) < 0.72);
  assert.ok(assessExtractedTextQuality(readableTable) >= 0.72);
});

test('ExtractionService: Samples OCR pages across long PDFs while retaining all short-PDF pages', () => {
  assert.deepEqual(selectPagesForOcr(2), [1, 2]);
  assert.deepEqual(selectPagesForOcr(3), [1, 2, 3]);
  assert.deepEqual(selectPagesForOcr(12), [1, 6, 12]);
  assert.deepEqual(selectPagesForOcr(12, 2), [1, 12]);
});

test('ExtractionService: Selects sparse pages from mixed native and scanned PDF text', () => {
  const pages = [
    { num: 1, text: 'Page one contains a readable amount due of $100.00.' },
    { num: 2, text: 'Page two contains readable account details and dates.' },
    { num: 3, text: '' },
    { num: 4, text: 'Page four contains readable terms and conditions here.' },
    { num: 5, text: 'Page five contains a readable signature statement.' }
  ];
  assert.deepEqual(selectSparseTextPages(pages), [3]);
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

test('ExtractionService: Estimates page skew from word positions and ignores aligned text', () => {
  const alignedWords = [
    { text: 'Policy', x: 0, y: 0, width: 25, height: 10 },
    { text: 'Number', x: 35, y: 0, width: 30, height: 10 },
    { text: 'AB001', x: 75, y: 0, width: 30, height: 10 }
  ];
  const skewedWords = [
    { text: 'Policy', x: 0, y: 0, width: 25, height: 10 },
    { text: 'Number', x: 35, y: 2, width: 30, height: 10 },
    { text: 'AB001', x: 75, y: 4, width: 30, height: 10 }
  ];

  assert.equal(estimateSkewAngle(alignedWords), 0);
  assert.ok(estimateSkewAngle(skewedWords) > 1.25);
  assert.equal(shouldTryDeskewOcr(alignedWords), false);
  assert.equal(shouldTryDeskewOcr(skewedWords), true);
});

test('ExtractionService: Flags OCR text with many short fragments for orientation checks', () => {
  const sidewaysOcr = '3 3 33 E Cs 33 gl Ee gz 4 FEE 22a i gE S 15 i 1 26 4';
  const readableInvoice = 'Tax Invoice Venkatesh IT Solutions Private Limited Amount Due 61000';
  const sparseOcr = 'a 2 b 7';
  const verticalBoxes = Array.from({ length: 8 }, (_, index) => ({
    text: `word${index}`,
    x: 0,
    y: index * 20,
    width: 8,
    height: 18,
    confidence: 90
  }));
  assert.equal(shouldTryRightAngleRotation(sidewaysOcr), true);
  assert.equal(shouldTryRightAngleRotation(sparseOcr), true);
  assert.equal(shouldTryRightAngleRotation(readableInvoice), false);
  assert.equal(hasPredominantlyVerticalTextBoxes(verticalBoxes), true);
  assert.equal(shouldTryRightAngleRotation('Readable extracted line of text with enough useful words', verticalBoxes), true);
  assert.equal(hasPredominantlyVerticalTextBoxes(verticalBoxes.slice(0, 5)), false);
});

test('ExtractionService: Chooses a right-angle OCR result only when its text score improves', async () => {
  const baseline = {
    data: {
      text: '3 3 33 E Cs 33 gl Ee gz 4 FEE 22a i gE S 15 i 1 26 4',
      words: [{ text: '3', bbox: { x0: 0, y0: 0, x1: 4, y1: 8 }, confidence: 40 }]
    }
  };
  const worker = {
    recognize: async (_image, options) => options.rotateRadians === Math.PI / 2
      ? {
        data: {
          text: 'Tax Invoice Venkatesh IT Solutions Private Limited Amount Due 61000',
          words: [{ text: 'Invoice', bbox: { x0: 0, y0: 0, x1: 40, y1: 10 }, confidence: 96 }]
        }
      }
      : {
        data: {
          text: '3 3 33 E Cs 33 gl Ee gz 4 FEE 22a i gE S 15 i 1 26 4',
          words: [{ text: '3', bbox: { x0: 0, y0: 0, x1: 4, y1: 8 }, confidence: 40 }]
        }
      },
    terminate: async () => {}
  };
  const selected = await selectRightAngleOcrOrientation({
    createWorker: async () => worker
  }, Buffer.from('image'), baseline);
  assert.equal(selected.rotation, Math.PI / 2);
  assert.match(selected.result.data.text, /Tax Invoice/);
});

test('ExtractionService: Accepts modest OCR score improvement when the initial scan is unreadable', async () => {
  const baseline = {
    data: {
      text: 'a 2 b 7',
      words: []
    }
  };
  const worker = {
    recognize: async (_image, options) => options.rotateRadians === Math.PI / 2
      ? { data: { text: 'Invoice 12 34 56', words: [] } }
      : { data: { text: 'a 2 b 7', words: [] } },
    terminate: async () => {}
  };
  const selected = await selectRightAngleOcrOrientation({
    createWorker: async () => worker
  }, Buffer.from('image'), baseline);
  assert.equal(selected.rotation, Math.PI / 2);
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
  const originalCreateWorker = Tesseract.createWorker;
  let autoRotationEnabled = false;
  let workerTerminated = false;

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
  Tesseract.createWorker = async () => ({
    recognize: async (_image, options) => {
      autoRotationEnabled = options.rotateAuto;
      return {
        data: {
          text: 'Expiry date: 2030-08-14',
          words: [{ text: 'Expiry', bbox: { x0: 0, y0: 0, x1: 30, y1: 10 }, confidence: 95 }]
        }
      };
    },
    terminate: async () => { workerTerminated = true; }
  });

  try {
    const result = await extractTextFromBuffer(Buffer.from('pdf'), 'application/pdf');
    assert.equal(result.method, 'pdf-ocr-tesseract-fallback');
    assert.ok(result.text.includes('Expiry date: 2030-08-14'));
    assert.equal(autoRotationEnabled, true);
    assert.equal(workerTerminated, true);
  } finally {
    pdfParseModule.PDFParse = originalPdfParse;
    paddleOcrService.extractText = originalPaddleExtract;
    Tesseract.createWorker = originalCreateWorker;
  }
});

test('ExtractionService: Runs auto-deskew when confident PaddleOCR word positions show skew', async () => {
  const pdfParseModule = require('pdf-parse');
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const Tesseract = require('tesseract.js');
  const originalPdfParse = pdfParseModule.PDFParse;
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalPaddleIsReady = paddleOcrService.isReady;
  const originalPaddleInitialize = paddleOcrService.initialize;
  const originalCreateWorker = Tesseract.createWorker;
  let workerCalls = 0;

  pdfParseModule.PDFParse = class {
    async load() {}
    async getText() { return { total: 1, pages: [{}], text: '' }; }
    async getScreenshot() {
      return { pages: [{ dataUrl: 'data:image/png;base64,AA==' }] };
    }
    async destroy() {}
  };
  paddleOcrService.isReady = () => true;
  paddleOcrService.initialize = async () => {};
  paddleOcrService.extractText = async () => ({
    text: 'Policy number AB001908',
    ocrWords: [
      { text: 'Policy', x: 0, y: 0, width: 25, height: 10, confidence: 92 },
      { text: 'number', x: 35, y: 2, width: 30, height: 10, confidence: 92 },
      { text: 'AB001908', x: 75, y: 4, width: 40, height: 10, confidence: 92 }
    ],
    method: 'ocr-paddleocr-primary'
  });
  Tesseract.createWorker = async () => ({
    recognize: async (_image, options) => {
      assert.equal(options.rotateAuto, true);
      workerCalls += 1;
      return {
        data: {
          text: 'Policy number AB001908',
          words: [{ text: 'Policy', bbox: { x0: 0, y0: 0, x1: 30, y1: 10 }, confidence: 98 }]
        }
      };
    },
    terminate: async () => {}
  });

  try {
    const result = await extractTextFromBuffer(Buffer.from('pdf'), 'application/pdf');
    assert.equal(workerCalls, 1);
    assert.equal(result.method, 'pdf-ocr-tesseract-fallback');
    assert.ok(result.text.includes('Policy number AB001908'));
  } finally {
    pdfParseModule.PDFParse = originalPdfParse;
    paddleOcrService.extractText = originalPaddleExtract;
    paddleOcrService.isReady = originalPaddleIsReady;
    paddleOcrService.initialize = originalPaddleInitialize;
    Tesseract.createWorker = originalCreateWorker;
  }
});

test('ExtractionService: Replaces corrupted native PDF text with readable OCR output', async () => {
  const pdfParseModule = require('pdf-parse');
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const originalPdfParse = pdfParseModule.PDFParse;
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalPaddleIsReady = paddleOcrService.isReady;
  const originalPaddleInitialize = paddleOcrService.initialize;
  const Tesseract = require('tesseract.js');
  const originalRecognize = Tesseract.recognize;
  Tesseract.recognize = async () => ({
    data: { text: 'Policy No: AB-001908\nTotal payable: $1,870.00', words: [] }
  });

  pdfParseModule.PDFParse = class {
    async load() {}
    async getText() {
      return {
        total: 1,
        pages: [{}],
        text: 'Policy �� �߿ ��� #### ��� �߿ ��� ### Policy �� ��� ��� �߿'
      };
    }
    async getScreenshot() {
      return { pages: [{ dataUrl: 'data:image/png;base64,AA==' }] };
    }
    async destroy() {}
  };
  paddleOcrService.isReady = () => true;
  paddleOcrService.initialize = async () => {};
  paddleOcrService.extractText = async () => ({
    text: 'Policy No: AB-001908\nTotal payable: $1,870.00',
    ocrWords: [
      { text: 'Policy', x: 0, y: 0, width: 30, height: 10, confidence: 95 },
      { text: 'AB-001908', x: 40, y: 0, width: 60, height: 10, confidence: 96 }
    ],
    method: 'ocr-paddleocr-primary'
  });

  try {
    const result = await extractTextFromBuffer(Buffer.from('pdf'), 'application/pdf');
    assert.equal(result.method, 'pdf-ocr-paddleocr-primary');
    assert.equal(result.text, 'Page 1\nPolicy No: AB-001908\nTotal payable: $1,870.00');
  } finally {
    pdfParseModule.PDFParse = originalPdfParse;
    paddleOcrService.extractText = originalPaddleExtract;
    paddleOcrService.isReady = originalPaddleIsReady;
    paddleOcrService.initialize = originalPaddleInitialize;
    Tesseract.recognize = originalRecognize;
  }
});

test('ExtractionService: Includes OCR from the last page of a long scanned PDF', async () => {
  const pdfParseModule = require('pdf-parse');
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const originalPdfParse = pdfParseModule.PDFParse;
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalPaddleIsReady = paddleOcrService.isReady;
  const originalPaddleInitialize = paddleOcrService.initialize;
  const requestedPages = [];

  pdfParseModule.PDFParse = class {
    async load() {}
    async getText() { return { total: 12, pages: Array(12).fill({}), text: '' }; }
    async getScreenshot({ page }) {
      requestedPages.push(page);
      return {
        pages: [{
          dataUrl: `data:image/png;base64,${Buffer.from(String(page)).toString('base64')}`
        }]
      };
    }
    async destroy() {}
  };
  paddleOcrService.isReady = () => true;
  paddleOcrService.initialize = async () => {};
  paddleOcrService.extractText = async image => ({
    text: image.toString() === '12' ? 'Expiry date: 2032-08-17' : `Page text ${image.toString()}`,
    ocrWords: [{ text: 'Page', x: 0, y: 0, width: 30, height: 10, confidence: 95 }],
    method: 'ocr-paddleocr-primary'
  });

  try {
    const result = await extractTextFromBuffer(Buffer.from('pdf'), 'application/pdf');
    assert.deepEqual(requestedPages, [1, 6, 12]);
    assert.ok(result.text.includes('Page 12\nExpiry date: 2032-08-17'));
  } finally {
    pdfParseModule.PDFParse = originalPdfParse;
    paddleOcrService.extractText = originalPaddleExtract;
    paddleOcrService.isReady = originalPaddleIsReady;
    paddleOcrService.initialize = originalPaddleInitialize;
  }
});

test('ExtractionService: OCRs only the sparse page in a mixed text/scanned PDF', async () => {
  const pdfParseModule = require('pdf-parse');
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const originalPdfParse = pdfParseModule.PDFParse;
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalPaddleIsReady = paddleOcrService.isReady;
  const originalPaddleInitialize = paddleOcrService.initialize;
  const requestedPages = [];
  const nativePages = [
    { num: 1, text: 'Page one contains a readable amount due of $100.00.' },
    { num: 2, text: 'Page two contains readable account details and dates.' },
    { num: 3, text: '' },
    { num: 4, text: 'Page four contains readable terms and conditions here.' },
    { num: 5, text: 'Page five contains a readable signature statement.' }
  ];

  pdfParseModule.PDFParse = class {
    async load() {}
    async getText() {
      return {
        total: nativePages.length,
        pages: nativePages,
        text: nativePages.map(page => page.text).join('\n')
      };
    }
    async getScreenshot({ page }) {
      requestedPages.push(page);
      return {
        pages: [{
          dataUrl: `data:image/png;base64,${Buffer.from(String(page)).toString('base64')}`
        }]
      };
    }
    async destroy() {}
  };
  paddleOcrService.isReady = () => true;
  paddleOcrService.initialize = async () => {};
  paddleOcrService.extractText = async image => ({
    text: `Scanned page ${image.toString()} expiry date: 2032-08-17`,
    ocrWords: [{ text: 'Scanned', x: 0, y: 0, width: 40, height: 10, confidence: 95 }],
    method: 'ocr-paddleocr-primary'
  });

  try {
    const result = await extractTextFromBuffer(Buffer.from('pdf'), 'application/pdf');
    assert.deepEqual(requestedPages, [3]);
    assert.equal(result.method, 'pdf-ocr-paddleocr-primary');
    assert.ok(result.text.includes('Page 1\nPage one contains a readable amount due of $100.00.'));
    assert.ok(result.text.includes('Page 3\nScanned page 3 expiry date: 2032-08-17'));
    assert.ok(result.text.includes('Page 5\nPage five contains a readable signature statement.'));
  } finally {
    pdfParseModule.PDFParse = originalPdfParse;
    paddleOcrService.extractText = originalPaddleExtract;
    paddleOcrService.isReady = originalPaddleIsReady;
    paddleOcrService.initialize = originalPaddleInitialize;
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

test('ExtractionService: Automatically checks right-angle orientations for sideways image OCR', async () => {
  const { paddleOcrService } = require('../src/main/services/paddleOcrService');
  const Tesseract = require('tesseract.js');
  const originalPaddleExtract = paddleOcrService.extractText;
  const originalPaddleIsReady = paddleOcrService.isReady;
  const originalPaddleInitialize = paddleOcrService.initialize;
  const originalRecognize = Tesseract.recognize;
  const originalCreateWorker = Tesseract.createWorker;
  let rotatedCandidateCalls = 0;
  const sidewaysOcr = '3 3 33 E Cs 33 gl Ee gz 4 FEE 22a i gE S 15 i 1 26 4';

  paddleOcrService.isReady = () => true;
  paddleOcrService.initialize = async () => {};
  paddleOcrService.extractText = async () => ({
    text: sidewaysOcr,
    ocrWords: [{ text: '3', x: 0, y: 0, width: 4, height: 8, confidence: 90 }],
    method: 'ocr-paddleocr-primary'
  });
  Tesseract.recognize = async () => ({
    data: {
      text: sidewaysOcr,
      words: [{ text: '3', bbox: { x0: 0, y0: 0, x1: 4, y1: 8 }, confidence: 40 }]
    }
  });
  Tesseract.createWorker = async () => ({
    recognize: async (_image, options) => {
      rotatedCandidateCalls += 1;
      return options.rotateRadians === Math.PI / 2
        ? {
          data: {
            text: 'Tax Invoice Venkatesh IT Solutions Private Limited Amount Due 61000',
            words: [{ text: 'Invoice', bbox: { x0: 0, y0: 0, x1: 40, y1: 10 }, confidence: 70 }]
          }
        }
        : {
          data: {
            text: sidewaysOcr,
            words: [{ text: '3', bbox: { x0: 0, y0: 0, x1: 4, y1: 8 }, confidence: 40 }]
          }
        };
    },
    terminate: async () => {}
  });

  try {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const result = await extractTextFromBuffer(image, 'image/png');
    assert.equal(rotatedCandidateCalls, 3);
    assert.equal(result.method, 'ocr-tesseract-auto-rotated');
    assert.match(result.text, /Tax Invoice Venkatesh IT Solutions/);
  } finally {
    paddleOcrService.extractText = originalPaddleExtract;
    paddleOcrService.isReady = originalPaddleIsReady;
    paddleOcrService.initialize = originalPaddleInitialize;
    Tesseract.recognize = originalRecognize;
    Tesseract.createWorker = originalCreateWorker;
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
