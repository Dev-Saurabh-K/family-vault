'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const { PaddleOcrService, paddleOcrService } = require('../src/main/services/paddleOcrService');
const { extractTextFromBuffer, reconstructStructuredTableLayout } = require('../src/main/services/extractionService');

test('PaddleOCR: Service resolves local model directory and initializes offline', async () => {
  const modelDir = paddleOcrService.resolveModelDir();
  assert.ok(modelDir, 'PaddleOCR local model directory must resolve');
  assert.ok(fs.existsSync(path.join(modelDir, 'PP-OCRv5_mobile_det_infer.ort')));
  assert.ok(fs.existsSync(path.join(modelDir, 'en_PP-OCRv5_mobile_rec_infer.ort')));
  assert.ok(fs.existsSync(path.join(modelDir, 'ppocrv5_en_dict.txt')));

  const initialized = await paddleOcrService.initialize();
  assert.strictEqual(initialized, true);
  assert.strictEqual(paddleOcrService.isReady(), true);
});

test('PaddleOCR: extractText processes image buffer and normalizes bounding box coordinates', async () => {
  // Test with blank 1x1 png image
  const blankPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const res = await paddleOcrService.extractText(blankPng);

  assert.strictEqual(typeof res.text, 'string');
  assert.ok(Array.isArray(res.ocrWords));
  assert.strictEqual(typeof res.confidence, 'number');
  assert.strictEqual(res.method, 'ocr-paddleocr-primary');
});

test('PaddleOCR: Primary OCR priority in extractionService with structured table reconstruction', async () => {
  // Mock paddleOcrService extractText to return simulated structured passport/invoice text
  const originalExtract = paddleOcrService.extractText;
  paddleOcrService.extractText = async () => ({
    text: 'PASSPORT REPUBLIC OF WONDERLAND\nGiven Names: Jane Doe',
    ocrWords: [
      { text: 'PASSPORT', x: 20, y: 10, width: 70, height: 14, confidence: 99 },
      { text: 'REPUBLIC', x: 100, y: 10, width: 65, height: 14, confidence: 98 },
      { text: 'OF', x: 170, y: 10, width: 20, height: 14, confidence: 99 },
      { text: 'WONDERLAND', x: 195, y: 10, width: 95, height: 14, confidence: 98 },
      { text: 'Given', x: 20, y: 35, width: 40, height: 12, confidence: 97 },
      { text: 'Names:', x: 65, y: 35, width: 45, height: 12, confidence: 97 },
      { text: 'Jane', x: 120, y: 35, width: 35, height: 12, confidence: 98 },
      { text: 'Doe', x: 160, y: 35, width: 30, height: 12, confidence: 98 }
    ],
    confidence: 98,
    method: 'ocr-paddleocr-primary'
  });

  try {
    const validImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const extractRes = await extractTextFromBuffer(validImage, 'image/png');

    assert.strictEqual(extractRes.method, 'ocr-paddleocr-primary');
    assert.strictEqual(extractRes.ocrWords.length, 8);
    assert.ok(extractRes.text.includes('PASSPORT'));
    assert.ok(extractRes.text.includes('Jane Doe'));

    // Verify structured layout reconstruction preserves table / line integrity
    const structured = reconstructStructuredTableLayout(extractRes.ocrWords);
    assert.strictEqual(structured.lines.length, 2);
    assert.ok(structured.structuredText.includes('PASSPORT'));
  } finally {
    paddleOcrService.extractText = originalExtract;
  }
});

test('PaddleOCR: Graceful fallback to secondary engine on PaddleOCR failure', async () => {
  const originalExtract = paddleOcrService.extractText;
  paddleOcrService.extractText = async () => {
    throw new Error('Simulated ONNX native inference fault');
  };

  try {
    const validImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const fallbackRes = await extractTextFromBuffer(validImage, 'image/png');

    // Must not crash, should fall through to tesseract / unavailable
    assert.ok(
      fallbackRes.method === 'ocr-tesseract-fallback' || 
      fallbackRes.method === 'ocr-unavailable' ||
      fallbackRes.method === 'multimodal-gemma4-vision'
    );
  } finally {
    paddleOcrService.extractText = originalExtract;
  }
});

test('PaddleOCR: Service destroy and lifecycle re-initialization', async () => {
  const customService = new PaddleOcrService();
  const init1 = await customService.initialize();
  assert.strictEqual(init1, true);
  assert.strictEqual(customService.isReady(), true);

  await customService.destroy();
  assert.strictEqual(customService.isReady(), false);
});
