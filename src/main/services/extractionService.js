'use strict';

/**
 * Extraction and deterministic metadata analysis service.
 * Adheres to ARCHITECTURE.md: "native PDF text extraction when available -> OCRService when text is absent/insufficient
 * -> normalized text -> validated extraction/classification"
 * Adheres to PRODUCT_REQUIREMENTS.md: "Treat original documents as source material, application validation as authority,
 * and AI output as untrusted suggestions. The app clearly labels it as active, expiring soon, or expired based on deterministic date logic."
 */

const path = require('path');
const pdfParse = require('pdf-parse');

const MONTH_NAMES = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

/**
 * Normalizes word bounding boxes and coordinates from Tesseract data.
 * Extracts detailed spatial information: { text, x, y, width, height, confidence }
 * @param {object} resData
 * @returns {Array<{ text: string, x: number, y: number, width: number, height: number, confidence: number }>}
 */
function extractOcrWordCoordinates(resData) {
  if (!resData) return [];

  // Tesseract.js provides resData.words as an array of word objects
  let rawWords = Array.isArray(resData.words) ? resData.words : [];
  if (rawWords.length === 0 && Array.isArray(resData.lines)) {
    for (const line of resData.lines) {
      if (Array.isArray(line.words)) {
        rawWords.push(...line.words);
      }
    }
  }

  return rawWords
    .filter(w => w && typeof w.text === 'string' && w.text.trim())
    .map(w => {
      const text = w.text.trim();
      const bbox = w.bbox || {};
      const x0 = bbox.x0 !== undefined ? bbox.x0 : (bbox.left !== undefined ? bbox.left : (w.x ?? 0));
      const y0 = bbox.y0 !== undefined ? bbox.y0 : (bbox.top !== undefined ? bbox.top : (w.y ?? 0));
      const x1 = bbox.x1 !== undefined ? bbox.x1 : (bbox.right !== undefined ? bbox.right : (x0 + (bbox.width || w.width || 0)));
      const y1 = bbox.y1 !== undefined ? bbox.y1 : (bbox.bottom !== undefined ? bbox.bottom : (y0 + (bbox.height || w.height || 0)));

      const width = Math.max(0, x1 - x0);
      const height = Math.max(0, y1 - y0);
      const confidence = Math.round(w.confidence !== undefined ? w.confidence : 0);

      return {
        text,
        x: Math.max(0, Math.round(x0)),
        y: Math.max(0, Math.round(y0)),
        width: Math.round(width),
        height: Math.round(height),
        confidence
      };
    });
}

/**
 * Reconstructs lines and tabular layouts from OCR word coordinates.
 * Words on approximately the same vertical line (y within line threshold)
 * are grouped, then sorted horizontally by x.
 * Horizontal column gaps are formatted to preserve structured/tabular readability.
 * @param {Array<{ text: string, x: number, y: number, width: number, height: number, confidence: number }>} ocrWords
 * @param {number} [lineThreshold=12]
 * @param {number} [columnGapThreshold=24]
 * @returns {{ structuredText: string, lines: Array<Array<object>> }}
 */
function reconstructStructuredTableLayout(ocrWords, lineThreshold = 12, columnGapThreshold = 24) {
  if (!Array.isArray(ocrWords) || ocrWords.length === 0) {
    return { structuredText: '', lines: [] };
  }

  const heights = ocrWords
    .map(word => Number(word.height))
    .filter(height => Number.isFinite(height) && height > 0)
    .sort((a, b) => a - b);
  const medianHeight = heights.length
    ? heights[Math.floor(heights.length / 2)]
    : 0;
  const adaptiveLineThreshold = Math.max(lineThreshold, medianHeight * 0.6);
  const adaptiveColumnThreshold = Math.max(columnGapThreshold, medianHeight * 1.5);

  // Use vertical centers so mixed glyph heights and scaled scans group consistently.
  const sorted = [...ocrWords].sort((a, b) => {
    const centerDifference = (a.y + a.height / 2) - (b.y + b.height / 2);
    return centerDifference || a.x - b.x;
  });

  const lines = [];
  let currentLine = [];
  let currentLineCenter = 0;

  for (const word of sorted) {
    const wordCenter = word.y + word.height / 2;
    if (currentLine.length === 0) {
      currentLine.push(word);
      currentLineCenter = wordCenter;
    } else if (Math.abs(wordCenter - currentLineCenter) <= adaptiveLineThreshold) {
      currentLine.push(word);
      currentLineCenter = currentLine.reduce(
        (sum, lineWord) => sum + lineWord.y + lineWord.height / 2,
        0
      ) / currentLine.length;
    } else {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
      currentLine = [word];
      currentLineCenter = wordCenter;
    }
  }

  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.x - b.x);
    lines.push(currentLine);
  }

  // Format into tabular text with column-gap alignment
  const textLines = lines.map(line => {
    let lineStr = '';
    let lastRight = null;
    for (const w of line) {
      if (lastRight === null) {
        lineStr += w.text;
      } else {
        const gap = w.x - lastRight;
        if (gap >= adaptiveColumnThreshold) {
          lineStr += '   \t' + w.text;
        } else {
          lineStr += ' ' + w.text;
        }
      }
      lastRight = w.x + w.width;
    }
    return lineStr;
  });

  return {
    structuredText: textLines.join('\n'),
    lines
  };
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+$/g, '').replace(/^[\t ]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasUsableExtractedText(text) {
  return /[\p{L}\p{N}]/u.test(normalizeExtractedText(text));
}

function assessExtractedTextQuality(text) {
  const normalized = normalizeExtractedText(text);
  if (!hasUsableExtractedText(normalized)) return 0;

  const visible = normalized.replace(/\s/g, '');
  if (!visible.length) return 0;
  const useful = (visible.match(/[\p{L}\p{N}.,:;!?%$€£()/#&'"-]/gu) || []).length;
  const replacementMarks = (visible.match(/[�□]/g) || []).length;
  const controlMarks = (visible.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  const usefulRatio = useful / visible.length;
  const corruptionPenalty = Math.min(0.75, ((replacementMarks + controlMarks) / visible.length) * 3);
  return Math.max(0, Math.min(1, usefulRatio - corruptionPenalty));
}

function meanOcrConfidence(ocrWords) {
  const confidences = (Array.isArray(ocrWords) ? ocrWords : [])
    .map(word => Number(word?.confidence))
    .filter(value => Number.isFinite(value) && value >= 0);
  if (!confidences.length) return null;
  return confidences.reduce((sum, value) => sum + Math.min(value, 100), 0) / confidences.length;
}

function shouldTrySecondaryOcr(text, ocrWords) {
  if (!hasUsableExtractedText(text)) return true;
  const confidence = meanOcrConfidence(ocrWords);
  return confidence !== null && confidence < 65;
}

function estimateSkewAngle(ocrWords) {
  const words = (Array.isArray(ocrWords) ? ocrWords : [])
    .filter(word => Number.isFinite(word?.x)
      && Number.isFinite(word?.y)
      && Number.isFinite(word?.width)
      && Number.isFinite(word?.height)
      && word.width > 0
      && word.height > 0)
    .sort((a, b) => a.x - b.x);
  const heights = words.map(word => word.height).sort((a, b) => a - b);
  if (heights.length < 3) return 0;

  const medianHeight = heights[Math.floor(heights.length / 2)];
  const angles = [];
  for (let leftIndex = 0; leftIndex < words.length - 1; leftIndex++) {
    const left = words[leftIndex];
    const leftCenterY = left.y + left.height / 2;
    for (let rightIndex = leftIndex + 1; rightIndex < words.length; rightIndex++) {
      const right = words[rightIndex];
      const horizontalDistance = right.x + right.width / 2 - (left.x + left.width / 2);
      const gap = right.x - (left.x + left.width);
      if (horizontalDistance < medianHeight * 1.5) continue;
      if (gap > medianHeight * 8) break;

      const verticalDifference = right.y + right.height / 2 - leftCenterY;
      if (Math.abs(verticalDifference) > Math.min(medianHeight * 1.5, horizontalDistance * 0.12)) {
        continue;
      }

      const angle = Math.atan2(verticalDifference, horizontalDistance) * (180 / Math.PI);
      if (Math.abs(angle) <= 8) angles.push(angle);
    }
  }

  if (angles.length < 2) return 0;
  angles.sort((a, b) => a - b);
  return angles[Math.floor(angles.length / 2)];
}

function shouldTryDeskewOcr(ocrWords) {
  return Math.abs(estimateSkewAngle(ocrWords)) >= 1.25;
}

function hasPredominantlyVerticalTextBoxes(ocrWords) {
  const positionedWords = (Array.isArray(ocrWords) ? ocrWords : [])
    .filter(word => Number.isFinite(word?.width)
      && Number.isFinite(word?.height)
      && word.width > 0
      && word.height > 0);
  if (positionedWords.length < 6) return false;

  const verticalWordRatio = positionedWords
    .filter(word => word.height >= word.width * 1.25)
    .length / positionedWords.length;
  return verticalWordRatio >= 0.7;
}

function shouldTryRightAngleRotation(text, ocrWords = []) {
  if (hasPredominantlyVerticalTextBoxes(ocrWords)) return true;
  const tokens = normalizeExtractedText(text).match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length === 0) return false;
  const shortTokenRatio = tokens.filter(token => token.length <= 2).length / tokens.length;
  const meaningfulTokenRatio = tokens.filter(token => token.length >= 3).length / tokens.length;
  if (tokens.length < 15) {
    return (tokens.length <= 6 && shortTokenRatio >= 0.65 && meaningfulTokenRatio < 0.65)
      || (!ocrWords.length && normalizeExtractedText(text).length < 40);
  }
  return shortTokenRatio >= 0.3 && meaningfulTokenRatio < 0.65;
}

function scoreOcrText(text, ocrWords) {
  const normalizedText = normalizeExtractedText(text);
  const tokens = normalizedText.match(/[\p{L}\p{N}]+/gu) || [];
  if (!tokens.length) return 0;

  const meaningfulTokenRatio = tokens.filter(token => token.length >= 3).length / tokens.length;
  const confidence = meanOcrConfidence(ocrWords) ?? 0;
  return confidence * 0.5 + meaningfulTokenRatio * 40;
}

function scoreOcrOrientation(result) {
  return scoreOcrText(
    result?.data?.text,
    extractOcrWordCoordinates(result?.data)
  );
}

async function selectRightAngleOcrOrientation(Tesseract, image, baselineResult) {
  const worker = await Tesseract.createWorker('eng');
  try {
    let best = {
      result: baselineResult,
      rotation: 0,
      score: scoreOcrOrientation(baselineResult)
    };

    for (const rotation of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const result = await worker.recognize(image, { rotateRadians: rotation });
      const score = scoreOcrOrientation(result);
      if (score > best.score) best = { result, rotation, score };
    }

    const baselineScore = scoreOcrOrientation(baselineResult);
    const requiredImprovement = baselineScore < 30 ? 3 : 8;
    return best.rotation !== 0 && best.score >= baselineScore + requiredImprovement
      ? best
      : { result: baselineResult, rotation: 0, score: baselineScore };
  } finally {
    await worker.terminate();
  }
}

async function recognizePdfPageWithDeskew(Tesseract, image) {
  const worker = await Tesseract.createWorker('eng');
  try {
    return await worker.recognize(image, { rotateAuto: true });
  } finally {
    await worker.terminate();
  }
}

function chooseOcrCandidate(primary, secondary) {
  if (!primary || !hasUsableExtractedText(primary.text)) {
    return secondary && hasUsableExtractedText(secondary.text) ? secondary : null;
  }
  if (!secondary || !hasUsableExtractedText(secondary.text)) return primary;

  const primaryConfidence = meanOcrConfidence(primary.ocrWords);
  const secondaryConfidence = meanOcrConfidence(secondary.ocrWords);
  if (primaryConfidence === null || secondaryConfidence === null) return primary;
  return secondaryConfidence > primaryConfidence ? secondary : primary;
}

function selectPagesForOcr(pageCount, maxPages = 3) {
  const totalPages = Math.max(1, Math.floor(Number(pageCount) || 1));
  const limit = Math.max(1, Math.floor(Number(maxPages) || 1));
  if (totalPages <= limit) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (limit === 1) return [1];

  const selected = new Set();
  for (let index = 0; index < limit; index++) {
    selected.add(1 + Math.floor((index * (totalPages - 1)) / (limit - 1)));
  }
  return [...selected].sort((a, b) => a - b);
}

function selectSparseTextPages(pages, maxPages = 3) {
  if (!Array.isArray(pages) || !pages.length) return [];
  const sparsePages = pages.map((page, index) => ({
    page,
    pageNumber: typeof page === 'object' && Number.isInteger(page?.num)
      ? page.num
      : index + 1
  })).filter(({ page }) => {
    const text = normalizeExtractedText(typeof page === 'string' ? page : page?.text);
    return text.length < 40 || assessExtractedTextQuality(text) < 0.72;
  }).map(({ pageNumber }) => pageNumber);
  if (sparsePages.length <= maxPages) return sparsePages;
  const selectedIndices = selectPagesForOcr(sparsePages.length, maxPages)
    .map(pageNumber => pageNumber - 1);
  return selectedIndices.map(index => sparsePages[index]);
}

/**
 * Extracts plain text and detailed OCR coordinates from document buffers.
 * @param {Buffer} buffer 
 * @param {string} mimeType 
 * @returns {Promise<{ text: string, pageCount: number, method: string, ocrWords: Array<object> }>}
 */
async function extractTextFromBuffer(buffer, mimeType) {
  let ocrWords = [];

  if (mimeType === 'application/pdf') {
    try {
      const pdfParseModule = require('pdf-parse');
      if (pdfParseModule.PDFParse) {
        const parser = new pdfParseModule.PDFParse({ data: buffer });
        await parser.load();
        const textResult = await parser.getText();
        const pageCount = (textResult && textResult.total) || (textResult && textResult.pages && textResult.pages.length) || 1;
        let text = textResult && typeof textResult.text === 'string'
          ? textResult.text.trim()
          : (typeof textResult === 'string' ? textResult.trim() : '');
        text = normalizeExtractedText(text);
        const nativePages = Array.isArray(textResult?.pages)
          ? textResult.pages.map((page, index) => ({
            num: Number.isInteger(page?.num) ? page.num : index + 1,
            text: typeof page === 'string' ? page : typeof page?.text === 'string' ? page.text : null
          }))
          : [];
        const hasPageText = nativePages.length === pageCount
          && nativePages.every(page => typeof page.text === 'string');

        // If native PDF text is absent or insufficient (e.g. scanned ticket or photo PDF),
        // automatically perform OCR on rendered page screenshots
        const cleanedText = normalizeExtractedText(text.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, ''));
        let method = 'native-pdf';

        const nativeTextQuality = assessExtractedTextQuality(cleanedText);
        const pagesToOcr = hasPageText
          ? selectSparseTextPages(nativePages, 3)
          : cleanedText.length < 40 || nativeTextQuality < 0.72
            ? selectPagesForOcr(pageCount, 3)
            : [];

        if (pagesToOcr.length > 0) {
          try {
            const ocrPages = [];
            const allWords = [];
            const ocrTextByPage = new Map();
            let usedPaddle = false;
            let usedTesseract = false;
            let usedAutoRotation = false;

            for (const p of pagesToOcr) {
              const shot = await parser.getScreenshot({ page: p });
              if (shot && shot.pages && shot.pages[0] && shot.pages[0].dataUrl) {
                const dataUrl = shot.pages[0].dataUrl;
                const imgBuf = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                let pageCandidate = null;
                let candidateWords = [];

                // 1. Primary: Local PaddleOCR PP-OCRv5 via onnxruntime-node
                try {
                  const { paddleOcrService } = require('./paddleOcrService');
                  if (paddleOcrService) {
                    if (!paddleOcrService.isReady()) {
                      await paddleOcrService.initialize();
                    }
                    if (paddleOcrService.isReady()) {
                      const paddleRes = await paddleOcrService.extractText(imgBuf);
                      if (paddleRes) {
                        const paddleText = normalizeExtractedText(paddleRes.text);
                        candidateWords = Array.isArray(paddleRes.ocrWords) ? paddleRes.ocrWords : [];
                        const structuredPage = reconstructStructuredTableLayout(candidateWords).structuredText;
                        const candidateText = structuredPage.length >= paddleText.length
                          ? structuredPage
                          : paddleText;
                        if (hasUsableExtractedText(candidateText)) {
                          pageCandidate = {
                            text: candidateText,
                            ocrWords: candidateWords,
                            method: 'paddle'
                          };
                        }
                      }
                    }
                  }
                } catch (paddleErr) {
                  // Fall through to the local Tesseract fallback
                }

                // 2. Fallback: Local Tesseract.js upon PaddleOCR failure or unavailability
                const tryDeskew = shouldTryDeskewOcr(pageCandidate?.ocrWords);
                const tryRightAngleRotation = shouldTryRightAngleRotation(
                  pageCandidate?.text,
                  pageCandidate?.ocrWords
                );
                if (shouldTrySecondaryOcr(pageCandidate?.text, pageCandidate?.ocrWords)
                  || tryDeskew
                  || tryRightAngleRotation) {
                  try {
                    const Tesseract = require('tesseract.js');
                    let ocrResult = await recognizePdfPageWithDeskew(Tesseract, dataUrl);
                    let rotation = 0;
                    if (tryRightAngleRotation || shouldTryRightAngleRotation(
                      ocrResult?.data?.text,
                      extractOcrWordCoordinates(ocrResult?.data)
                    )) {
                      const selectedOrientation = await selectRightAngleOcrOrientation(
                        Tesseract,
                        dataUrl,
                        ocrResult
                      );
                      ocrResult = selectedOrientation.result;
                      rotation = selectedOrientation.rotation;
                    }
                    const tessWords = extractOcrWordCoordinates(ocrResult?.data);
                    const tessText = normalizeExtractedText(ocrResult?.data?.text);
                    const structuredPage = reconstructStructuredTableLayout(tessWords).structuredText;
                    const candidateText = structuredPage.length >= tessText.length
                      ? structuredPage
                      : tessText;
                    if (hasUsableExtractedText(candidateText)) {
                      const tesseractCandidate = {
                        text: candidateText,
                        ocrWords: tessWords,
                        method: 'tesseract',
                        rotation
                      };
                      pageCandidate = rotation
                        && scoreOcrText(tesseractCandidate.text, tesseractCandidate.ocrWords)
                          > scoreOcrText(pageCandidate?.text, pageCandidate?.ocrWords)
                        ? tesseractCandidate
                        : chooseOcrCandidate(pageCandidate, tesseractCandidate);
                    }
                  } catch (tessErr) {}
                }

                const pageText = pageCandidate?.text || '';
                const pageWords = pageCandidate?.ocrWords || [];
                if (pageText) {
                  if (pageCandidate.method === 'paddle') usedPaddle = true;
                  if (pageCandidate.method === 'tesseract') usedTesseract = true;
                  if (pageCandidate.rotation) {
                    usedTesseract = true;
                    usedAutoRotation = true;
                  }
                  ocrTextByPage.set(p, pageText);
                  allWords.push(...pageWords);
                }
              }
            }

            let replacedPage = false;
            if (hasPageText) {
              for (const page of nativePages) {
                const ocrText = ocrTextByPage.get(page.num);
                if (!ocrText) continue;
                const nativePageText = normalizeExtractedText(page.text);
                const improvesQuality = assessExtractedTextQuality(ocrText)
                  >= assessExtractedTextQuality(nativePageText) + 0.08;
                const fillsSparsePage = nativePageText.length < 40
                  && ocrText.length > nativePageText.length;
                if (improvesQuality || fillsSparsePage) {
                  page.text = ocrText;
                  replacedPage = true;
                }
              }
              if (replacedPage) {
                text = normalizeExtractedText(nativePages
                  .map(page => `Page ${page.num}\n${normalizeExtractedText(page.text)}`)
                  .join('\n\n'));
              }
            } else {
              ocrPages.push(...[...ocrTextByPage.entries()]
                .sort(([a], [b]) => a - b)
                .map(([pageNumber, pageText]) => `Page ${pageNumber}\n${pageText}`));
              const ocrText = normalizeExtractedText(ocrPages.join('\n\n'));
              const ocrTextQuality = assessExtractedTextQuality(ocrText);
              replacedPage = ocrTextQuality >= nativeTextQuality + 0.08
                || (cleanedText.length < 40 && ocrText.length > cleanedText.length);
              if (replacedPage) text = ocrText;
            }

            if (replacedPage) {
              ocrWords = allWords;
              method = usedAutoRotation
                ? usedPaddle ? 'pdf-ocr-mixed-auto-rotated' : 'pdf-ocr-tesseract-auto-rotated'
                : usedPaddle && usedTesseract
                  ? 'pdf-ocr-mixed'
                : usedPaddle
                  ? 'pdf-ocr-paddleocr-primary'
                  : 'pdf-ocr-tesseract-fallback';
            }
          } catch (ocrErr) {}
        }

        await parser.destroy();
        return {
          text,
          pageCount,
          method,
          ocrWords
        };
      } else if (typeof pdfParseModule === 'function') {
        const data = await pdfParseModule(buffer);
        const text = normalizeExtractedText(data.text);
        return {
          text,
          pageCount: data.numpages || 1,
          method: 'native-pdf',
          ocrWords: []
        };
      }
    } catch (err) {
      try {
        const str = buffer.toString('utf8');
        if (str && /^[\x20-\x7E\s\r\n\t]+$/.test(str.substring(0, 100))) {
          return { text: str.trim(), pageCount: 1, method: 'plaintext-fallback', ocrWords: [] };
        }
      } catch (e) {}
      return { text: '', pageCount: 1, method: 'pdf-parse-error', ocrWords: [] };
    }
  }

  // For images, use PaddleOCR (PP-OCRv5) first and Tesseract.js as its local fallback.
  if (mimeType.startsWith('image/')) {
    let paddleCandidate = null;
    // 1. Primary: Local PaddleOCR PP-OCRv5 via onnxruntime-node
    try {
      const { paddleOcrService } = require('./paddleOcrService');
      if (paddleOcrService) {
        if (!paddleOcrService.isReady()) {
          await paddleOcrService.initialize();
        }
        if (paddleOcrService.isReady()) {
          const paddleRes = await paddleOcrService.extractText(buffer);
          if (paddleRes && typeof paddleRes.text === 'string' && (paddleRes.text.trim().length > 0 || (Array.isArray(paddleRes.ocrWords) && paddleRes.ocrWords.length > 0))) {
            const rawText = normalizeExtractedText(paddleRes.text);
            const ocrWords = Array.isArray(paddleRes.ocrWords) ? paddleRes.ocrWords : [];
            const structured = reconstructStructuredTableLayout(ocrWords);
            const text = normalizeExtractedText(structured.structuredText && structured.structuredText.length >= rawText.length
              ? structured.structuredText
              : rawText);
            if (!hasUsableExtractedText(text)) {
              throw new Error('PaddleOCR returned no usable text');
            }
            paddleCandidate = {
              text,
              ocrWords,
              method: paddleRes.method || 'ocr-paddleocr-primary'
            };
            if (!shouldTrySecondaryOcr(text, ocrWords) && !shouldTryRightAngleRotation(text, ocrWords)) {
              return { ...paddleCandidate, pageCount: 1 };
            }
          }
        }
      }
    } catch (paddleErr) {
      // Fall through to the local Tesseract fallback
    }

    // 2. Use Tesseract when PaddleOCR fails or reports low word confidence.
    try {
      const Tesseract = require('tesseract.js');
      let res = await Tesseract.recognize(buffer, 'eng').catch(() => null);
      if (!res || !res.data) {
        return paddleCandidate
          ? { ...paddleCandidate, pageCount: 1 }
          : { text: '', pageCount: 1, method: 'ocr-unavailable', ocrWords: [] };
      }
      let rotation = 0;
      if (shouldTryRightAngleRotation(paddleCandidate?.text, paddleCandidate?.ocrWords)
        || shouldTryRightAngleRotation(res.data.text, extractOcrWordCoordinates(res.data))) {
        const selectedOrientation = await selectRightAngleOcrOrientation(Tesseract, buffer, res);
        res = selectedOrientation.result;
        rotation = selectedOrientation.rotation;
      }
      const rawText = normalizeExtractedText(res.data.text);
      ocrWords = extractOcrWordCoordinates(res.data);
      const structured = reconstructStructuredTableLayout(ocrWords);
      const text = normalizeExtractedText(structured.structuredText && structured.structuredText.length >= rawText.length
        ? structured.structuredText
        : rawText);
      if (!hasUsableExtractedText(text)) {
        return paddleCandidate
          ? { ...paddleCandidate, pageCount: 1 }
          : { text: '', pageCount: 1, method: 'ocr-unavailable', ocrWords: [] };
      }

      const tesseractCandidate = {
        text,
        method: rotation ? 'ocr-tesseract-auto-rotated' : 'ocr-tesseract-fallback',
        ocrWords
      };
      const selected = rotation
        && scoreOcrText(tesseractCandidate.text, tesseractCandidate.ocrWords)
          > scoreOcrText(paddleCandidate?.text, paddleCandidate?.ocrWords)
        ? tesseractCandidate
        : chooseOcrCandidate(paddleCandidate, tesseractCandidate);
      return selected
        ? { ...selected, pageCount: 1 }
        : { text: '', pageCount: 1, method: 'ocr-unavailable', ocrWords: [] };
    } catch (e) {
      return paddleCandidate
        ? { ...paddleCandidate, pageCount: 1 }
        : { text: '', pageCount: 1, method: 'ocr-unavailable', ocrWords: [] };
    }
  }

  return { text: '', pageCount: 1, method: 'unsupported', ocrWords: [] };
}

/**
 * Normalizes date components into YYYY-MM-DD.
 */
function toIsoDate(year, month, day) {
  const y = parseInt(year, 10);
  const m = String(parseInt(month, 10)).padStart(2, '0');
  const d = String(parseInt(day, 10)).padStart(2, '0');
  if (isNaN(y) || y < 1900 || y > 2100) return null;
  return `${y}-${m}-${d}`;
}

/**
 * Finds all potential date occurrences and their surrounding context in text.
 */
function findDateCandidates(text) {
  const candidates = [];
  if (!text) return candidates;

  const patterns = [
    // 1. ISO: YYYY-MM-DD or YYYY/MM/DD
    {
      regex: /\b(19\d\d|20\d\d)[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/g,
      handler: (m) => toIsoDate(m[1], m[2], m[3])
    },
    // 2. Day Month Year: 25 Jan 2026, 25 January 2026, 25-Jan-2026, 25/Jan/2026, 21 MAR / MAR 2031
    {
      regex: /\b(0?[1-9]|[12]\d|3[01])[-/\s]+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s*[\/]\s*[A-Za-z]+)?[-/\s,]+(19\d\d|20\d\d)\b/gi,
      handler: (m) => {
        const monthNum = MONTH_NAMES[m[2].toLowerCase()];
        return monthNum ? toIsoDate(m[3], monthNum, m[1]) : null;
      }
    },
    // 3. Month Day, Year: January 25, 2026, Jan-25-2026, Jan/25/2026
    {
      regex: /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s*[\/]\s*[A-Za-z]+)?[-/\s]+(0?[1-9]|[12]\d|3[01])[-/\s,]+(19\d\d|20\d\d)\b/gi,
      handler: (m) => {
        const monthNum = MONTH_NAMES[m[1].toLowerCase()];
        return monthNum ? toIsoDate(m[3], monthNum, m[2]) : null;
      }
    },
    // 4. Day/Month/Year: 14/04/2031 or 14-04-2031
    {
      regex: /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](19\d\d|20\d\d)\b/g,
      handler: (m) => toIsoDate(m[3], m[2], m[1])
    },
    // 5. Month/Day/Year (unambiguous US format when day > 12): 08/25/2030 or 12/31/2028
    {
      regex: /\b(0?[1-9]|1[0-2])[-/.](1[3-9]|2\d|3[01])[-/.](19\d\d|20\d\d)\b/g,
      handler: (m) => toIsoDate(m[3], m[1], m[2])
    }
  ];

  for (const p of patterns) {
    let match;
    while ((match = p.regex.exec(text)) !== null) {
      const iso = p.handler(match);
      if (iso) {
        const start = Math.max(0, match.index - 50);
        const end = Math.min(text.length, match.index + match[0].length + 50);
        const prefix = text.substring(start, match.index).replace(/\s+/g, ' ').trim();
        const suffix = text.substring(match.index + match[0].length, end).replace(/\s+/g, ' ').trim();
        const snippet = text.substring(start, end).replace(/\s+/g, ' ').trim();

        candidates.push({
          date: iso,
          raw: match[0],
          prefix,
          suffix,
          snippet,
          index: match.index
        });
      }
    }
  }

  // Sort by position in text and deduplicate
  candidates.sort((a, b) => a.index - b.index);
  const uniqueCandidates = [];
  const seenKeys = new Set();
  for (const c of candidates) {
    const key = `${c.date}::${c.index}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueCandidates.push(c);
    }
  }
  return uniqueCandidates;
}

const PERSON_NAME_STOP_WORDS = new Set([
  'republic', 'department', 'authority', 'government', 'united', 'states',
  'national', 'hospital', 'insurance', 'state', 'farm', 'health', 'service',
  'office', 'company', 'bank', 'ministry', 'medical', 'clinic', 'passport',
  'driving', 'driver', 'license', 'licence', 'official', 'policy', 'date',
  'birth', 'address', 'gender', 'sex', 'signature', 'number', 'expiry',
  'valid', 'issue', 'permanent', 'temporary', 'invoice', 'total', 'amount',
  'notice', 'federation', 'confederation', 'commonwealth', 'kingdom',
  'center', 'centre', 'laboratories', 'laboratory', 'prescription', 'doctor',
  'physician', 'patient', 'insured', 'holder', 'policyholder', 'cardholder',
  'applicant', 'beneficiary', 'employee', 'taxpayer', 'tenant', 'landlord',
  'mortgage', 'agreement', 'document', 'report', 'specimen', 'sample', 'wonderland'
]);

/**
 * Sanitizes and validates a candidate person name string.
 */
function cleanPersonName(rawName) {
  if (!rawName) return null;
  // Discard anything after a newline
  const firstLine = rawName.split(/[\r\n]+/)[0];
  let cleaned = firstLine.replace(/[^a-zA-Z\s'’-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 40) return null;

  const words = cleaned.split(' ').filter(w => w.length > 1);
  if (words.length === 0) return null;

  // Stop collecting words upon encountering a stop word (e.g. "David Miller Blood Test" -> "David Miller")
  const validWords = [];
  for (const w of words) {
    if (PERSON_NAME_STOP_WORDS.has(w.toLowerCase())) {
      break;
    }
    validWords.push(w);
  }

  if (validWords.length === 0) return null;

  // Check capitalization (at least one word should start with uppercase)
  const hasCapital = validWords.some(w => /^[A-Z]/.test(w));
  if (!hasCapital) return null;

  return validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/**
 * Detects family member / person from document text.
 * Checks known persons first for high accuracy matching, then falls back to labeled regex heuristics.
 * @param {string} text
 * @param {Array<string>} [knownPersons=[]]
 * @returns {string|null}
 */
function detectPerson(text, knownPersons = []) {
  if (!text) return null;

  // 1. Check known family members recorded in the vault first
  if (Array.isArray(knownPersons) && knownPersons.length > 0) {
    for (const kp of knownPersons) {
      if (!kp || typeof kp !== 'string') continue;
      const trimmed = kp.trim();
      if (trimmed.length < 3) continue;

      // Word boundary match (case-insensitive)
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text)) {
        return trimmed;
      }
    }
  }

  // 2. Specific check for Passport layout: Given Names & Surname
  const givenMatch = text.match(/(?:Given\s+Names?|First\s+Name)[:\t ]+([A-Za-z'’-]+(?:[ \t]+[A-Za-z'’-]+)?)/i);
  const surnameMatch = text.match(/(?:Surname|Last\s+Name)[:\t ]+([A-Za-z'’-]+)/i);
  if (givenMatch && surnameMatch) {
    const combined = `${givenMatch[1].trim()} ${surnameMatch[1].trim()}`;
    const cleaned = cleanPersonName(combined);
    if (cleaned) return cleaned;
  }

  // 3. Check labeled patterns in document (matching only on the same line)
  const labeledPatterns = [
    /(?:Given\s+Names?|First\s+Name)[:\t ]+([A-Za-z'’-]+(?:[ \t]+[A-Za-z'’-]+)?)/i,
    /(?:Patient(?:\s+Name)?|Insured(?:\s+Name)?|Policyholder|Cardholder|Taxpayer|Applicant|Employee|Tenant|Member\s+Name|Name\s+of\s+Holder|Name)[:\t ]+([A-Za-z'’-]+(?:[ \t]+[A-Za-z'’-]+){1,3})/i,
    /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/
  ];

  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = cleanPersonName(match[1]);
      if (candidate) return candidate;
    }
  }

  return null;
}

/**
 * Generates relevant semantic tags based on category, document type, person, and text content.
 * @param {string} text
 * @param {string} category
 * @param {string} docType
 * @param {string|null} person
 * @param {string|null} issueDate
 * @param {string|null} expiryDate
 * @returns {Array<string>}
 */
function generateAutoTags(text, category, docType, person, issueDate, expiryDate) {
  const tagsSet = new Set();
  const lowerText = (text || '').toLowerCase();

  // Category tag
  if (category && category !== 'other') {
    tagsSet.add(category);
  }

  // Document type tag
  if (docType && docType !== 'other') {
    tagsSet.add(docType.replace(/_/g, '-'));
  }

  // Category-specific semantic tags
  if (category === 'identity') {
    tagsSet.add('id');
    if (/passport/i.test(lowerText)) tagsSet.add('travel');
    if (/license|licence/i.test(lowerText)) tagsSet.add('driver');
    if (/visa/i.test(lowerText)) tagsSet.add('visa');
    if (/national\s*id|identity\s*card|aadhaar|ssn/i.test(lowerText)) tagsSet.add('national-id');
  } else if (category === 'insurance') {
    tagsSet.add('policy');
    if (/health|medical/i.test(lowerText)) tagsSet.add('health');
    if (/auto|car|motor|vehicle/i.test(lowerText)) tagsSet.add('vehicle');
    if (/life/i.test(lowerText)) tagsSet.add('life');
    if (/home|property|renter/i.test(lowerText)) tagsSet.add('home');
  } else if (category === 'medical') {
    if (/prescription|rx/i.test(lowerText)) tagsSet.add('prescription');
    if (/lab|test|blood|lipid|panel/i.test(lowerText)) tagsSet.add('lab-report');
    if (/vaccin|immuniz/i.test(lowerText)) tagsSet.add('vaccine');
    if (/dental|dentist/i.test(lowerText)) tagsSet.add('dental');
    if (/hospital|clinic/i.test(lowerText)) tagsSet.add('hospital');
  } else if (category === 'tax') {
    tagsSet.add('finance');
    if (/1040/i.test(lowerText)) tagsSet.add('form-1040');
    if (/w-?2/i.test(lowerText)) tagsSet.add('w2');
    if (/return/i.test(lowerText)) tagsSet.add('return');
  } else if (category === 'property') {
    tagsSet.add('legal');
    if (/lease|rental/i.test(lowerText)) tagsSet.add('lease');
    if (/mortgage/i.test(lowerText)) tagsSet.add('mortgage');
    if (/deed/i.test(lowerText)) tagsSet.add('deed');
  }

  // General document semantic keywords (applicable across all categories including 'other')
  if (/invoice/i.test(lowerText)) tagsSet.add('invoice');
  if (/receipt/i.test(lowerText)) tagsSet.add('receipt');
  if (/bill|utility|electric|water|gas|internet/i.test(lowerText)) tagsSet.add('utility');
  if (/statement|bank/i.test(lowerText)) tagsSet.add('statement');
  if (/education|degree|diploma|transcript|certificate|university|college|school/i.test(lowerText)) tagsSet.add('education');
  if (/employment|salary|payslip|paystub|offer\s*letter|contract/i.test(lowerText)) tagsSet.add('employment');
  if (/vehicle|registration|car|automobile|title/i.test(lowerText) && !tagsSet.has('vehicle')) tagsSet.add('vehicle');

  // Year tag from dates
  const yearMatch = (expiryDate || issueDate || '').match(/\b(20\d\d)\b/);
  if (yearMatch) {
    tagsSet.add(yearMatch[1]);
  } else {
    const textYear = lowerText.match(/\b(20[2-3]\d)\b/);
    if (textYear) {
      tagsSet.add(textYear[1]);
    }
  }

  return Array.from(tagsSet).slice(0, 8);
}

const DOC_TYPE_LABELS = {
  passport: 'Passport',
  driving_license: 'Driving License',
  identity_card: 'Identity Card',
  insurance_policy: 'Insurance Policy',
  tax_document: 'Tax Document',
  medical_record: 'Medical Record',
  property_document: 'Property Document',
  other: 'Document'
};

/**
 * Suggests a clear, human-readable document title based on analysis.
 */
function suggestDocumentTitle(fileName, category, docType, person, issuer, issueDate, expiryDate) {
  const baseType = DOC_TYPE_LABELS[docType] || 'Document';
  const year = (expiryDate || issueDate || '').substring(0, 4);

  if (person && docType !== 'other') {
    return `${baseType} - ${person}`;
  }
  if (person && category !== 'other') {
    const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
    return `${catLabel} - ${person}`;
  }
  if (issuer && docType !== 'other') {
    return `${baseType} - ${issuer}`;
  }
  if (year && docType !== 'other') {
    return `${baseType} (${year})`;
  }
  if (docType !== 'other') {
    return baseType;
  }

  // Fallback to formatted filename
  if (fileName) {
    const clean = path.parse(fileName).name.replace(/[-_]+/g, ' ').trim();
    if (clean) {
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }
  }

  return 'Document';
}

/**
 * Proposes document type, category, person, tags, suggested title, issuer, issue date, and expiry date based on text analysis.
 * @param {string} text
 * @param {string} [fileName='']
 * @param {object} [options={}]
 * @param {Array<string>} [options.knownPersons=[]]
 */
function analyzeDocumentText(text, fileName = '', options = {}) {
  const lowerText = (text + ' ' + fileName).toLowerCase();

  // Document Type & Category Classification
  let docType = 'other';
  let category = 'other';

  if (/\b(?:passport|travel\s*document)\b/i.test(lowerText) || (/passport/i.test(lowerText) && /republic|nationality/i.test(lowerText))) {
    docType = 'passport';
    category = 'identity';
  } else if (/driver['’]?s?\s*license|driving\s*licence|motor\s*vehicle|dl\s*no/i.test(lowerText)) {
    docType = 'driving_license';
    category = 'identity';
  } else if (/\b(?:tax\s*return|form\s*1040|w-?2|1099|incometax|income\s*tax|internal\s*revenue|revenue\s*service|irs|itr)\b/i.test(lowerText)) {
    docType = 'tax_document';
    category = 'tax';
  } else if (/insurance|policy\s*no|premium|coverage|insured|sum\s*assured|deductible|claim\s*no/i.test(lowerText)) {
    docType = 'insurance_policy';
    category = 'insurance';
  } else if (/prescription|clinic|hospital|patient|doctor|physician|diagnosis|medical\s*center|lab\s*report|blood\s*test|lipid\s*profile/i.test(lowerText)) {
    docType = 'medical_record';
    category = 'medical';
  } else if (/deed|mortgage|lease|lease\s*agreement|tenant|landlord|rental\s*agreement|property\s*tax|land\s*registry|title\s*deed/i.test(lowerText)) {
    docType = 'property_document';
    category = 'property';
  } else if (/national\s*id|identity\s*card|aadhaar|pan\s*card|voter\s*id|social\s*security|ssn/i.test(lowerText)) {
    docType = 'identity_card';
    category = 'identity';
  }

  // Detect Dates
  const candidates = findDateCandidates(text);

  let expiryDate = null;
  let expirySnippet = null;
  let issueDate = null;
  let issueSnippet = null;
  let confidence = 0.5;

  const expiryKeywords = /\b(expir\w*|exp\.?|valid\s+until|valid\s+thru|valid\s+through|valid\s+to|val\s+thru|val\s+to|end\s+date|(?:d\.o\.e\.?|doe\b(?=\s*[:\-0-9]))|validity|renewal|renew\s+by|effective[^\n]+?\bto|from[^\n]+?\bto|term[^\n]+?\bto|until|thru|through)\b/i;
  const issueKeywords = /\b(issu\w*|iss\.?|(?:d\.o\.i\.?|doi\b(?=\s*[:\-0-9]))|date\s+of\s+issue|valid\s+from|start\s+date|eff\.?\s*date|effective\s+date|effective)\b/i;

  for (const candidate of candidates) {
    const prefix = candidate.prefix || '';
    const expMatches = prefix.match(new RegExp(expiryKeywords.source, 'gi'));
    const issMatches = prefix.match(new RegExp(issueKeywords.source, 'gi'));
    const lastExpIdx = expMatches ? prefix.toLowerCase().lastIndexOf(expMatches[expMatches.length - 1].toLowerCase()) : -1;
    const lastIssIdx = issMatches ? prefix.toLowerCase().lastIndexOf(issMatches[issMatches.length - 1].toLowerCase()) : -1;

    if (lastExpIdx > lastIssIdx && lastExpIdx !== -1) {
      if (!expiryDate || candidate.date > expiryDate) {
        expiryDate = candidate.date;
        expirySnippet = candidate.snippet;
        confidence = 0.9;
      }
    } else if (lastIssIdx > lastExpIdx && lastIssIdx !== -1) {
      if (!issueDate || candidate.date < issueDate) {
        issueDate = candidate.date;
        issueSnippet = candidate.snippet;
      }
    } else if (expiryKeywords.test(candidate.snippet) && !issueKeywords.test(prefix)) {
      if (!expiryDate || candidate.date > expiryDate) {
        expiryDate = candidate.date;
        expirySnippet = candidate.snippet;
        confidence = 0.85;
      }
    }
  }

  // If no explicit expiry found with keyword, and we have multiple dates, choose future date
  if (!expiryDate && candidates.length > 0) {
    const today = new Date().toISOString().substring(0, 10);
    const futureDates = candidates.filter(c => c.date >= today);
    if (futureDates.length > 0) {
      futureDates.sort((a, b) => b.date.localeCompare(a.date));
      expiryDate = futureDates[0].date;
      expirySnippet = futureDates[0].snippet;
      confidence = 0.6;
    }
  }

  // Only assign an issuer when the document explicitly labels it or contains a recognized authority
  let issuer = null;
  const issuerMatch = String(text || '').match(
    /(?:issuer|issued\s+by|issuing\s+authority|authority|provider|insurer|bank|hospital)\s*[:\-]\s*([^\r\n|;]{3,80})/i
  );
  if (issuerMatch) {
    issuer = issuerMatch[1].trim();
  }

  if (!issuer) {
    const recognizedAuthorityPatterns = [
      /\b(Department of Motor Vehicles|California DMV|DMV|Bureau of Motor Vehicles|BMV|DVLA)\b/i,
      /\b(Department of State|Passport Agency|Ministry of Foreign Affairs|Ministry of External Affairs)\b/i,
      /\b(Blue Cross(?:\s+Blue\s+Shield)?|State Farm|Geico|Progressive|Allstate|UnitedHealthcare|Aetna|Cigna|Kaiser Permanente|MetLife)\b/i,
      /\b(Internal Revenue Service|IRS|Social Security Administration|SSA)\b/i
    ];
    for (const pattern of recognizedAuthorityPatterns) {
      const match = String(text || '').match(pattern);
      if (match) {
        issuer = match[1].trim();
        break;
      }
    }
  }

  // Detect Family Member / Person with strict matching to added users
  const knownPersons = (options && options.knownPersons) ? options.knownPersons : [];
  const strictToAddedUsers = options && options.strictToAddedUsers !== undefined
    ? options.strictToAddedUsers
    : (Array.isArray(knownPersons) && knownPersons.length > 0);

  const detectedCandidate = detectPerson(text, knownPersons);
  let person = null;
  let unmatchedPerson = null;

  if (detectedCandidate) {
    if (Array.isArray(knownPersons) && knownPersons.length > 0) {
      const matched = knownPersons.find(kp => 
        kp.toLowerCase() === detectedCandidate.toLowerCase() ||
        detectedCandidate.toLowerCase() === kp.toLowerCase()
      );
      if (matched) {
        person = matched;
      } else {
        unmatchedPerson = detectedCandidate;
      }
    } else if (strictToAddedUsers) {
      // Vault has 0 added family members, so any detected person is unmatched
      unmatchedPerson = detectedCandidate;
    } else {
      // Fallback for standalone helper calls without knownPersons
      person = detectedCandidate;
    }
  }

  // STRICT RULE: If an unmatched person is detected:
  // "unmatched user will be categorised to any other category which user need to review and add new user"
  if (unmatchedPerson && !person) {
    category = 'other';
    docType = 'other';
    confidence = Math.min(confidence, 0.65);
  }

  // Generate Auto-Tags
  const tags = generateAutoTags(text, category, docType, person, issueDate, expiryDate);

  // Suggest Document Title
  const suggestedTitle = suggestDocumentTitle(fileName, category, docType, person, issuer, issueDate, expiryDate);

  // Build notes summary from detected provenance
  const noteParts = [];
  if (expiryDate) noteParts.push(`Expiry Date: ${expiryDate}`);
  if (issueDate) noteParts.push(`Issue Date: ${issueDate}`);
  if (issuer) noteParts.push(`Issuer: ${issuer}`);
  const notesSummary = noteParts.length > 0 ? noteParts.join('. ') + '.' : '';

  let reviewStatus = 'proposed';
  if (unmatchedPerson && !person) {
    reviewStatus = 'needs_review';
  } else if (confidence < 0.85) {
    reviewStatus = 'needs_review';
  }

  return {
    docType,
    category,
    person,
    unmatchedPerson,
    isUserMatched: Boolean(person),
    tags,
    suggestedTitle,
    notesSummary,
    issuer,
    issueDate,
    issueSnippet,
    expiryDate,
    expirySnippet,
    confidence,
    reviewStatus
  };
}

/**
 * Deterministically computes expiry status and days remaining.
 * @param {string|null} expiryDateStr ISO format (YYYY-MM-DD)
 * @returns {{ status: 'expired' | 'expiring_soon' | 'active' | 'none', daysRemaining: number | null }}
 */
function computeExpiryStatus(expiryDateStr) {
  if (!expiryDateStr) {
    return { status: 'none', daysRemaining: null };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expDate = new Date(expiryDateStr);
  expDate.setHours(0, 0, 0, 0);

  if (isNaN(expDate.getTime())) {
    return { status: 'none', daysRemaining: null };
  }

  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'expired', daysRemaining: diffDays };
  } else if (diffDays <= 60) {
    return { status: 'expiring_soon', daysRemaining: diffDays };
  } else {
    return { status: 'active', daysRemaining: diffDays };
  }
}

/**
 * Extracts structured profile facts (parent names, DOB, address, 10th/12th marks, education, gender)
 * from document text for user profiling and contradiction analysis.
 */
function extractProfileFacts(text, personName = null) {
  const facts = [];
  if (!text || typeof text !== 'string') return facts;

  // 1. Father's Name
  const fatherMatch = text.match(/(?:father['’]?s?\s*name|father\s*name)\s*[:.-]?\s*([A-Za-z\s.'-]+)/i) ||
                      text.match(/\b(?:s\/o\.?|son\s+of|d\/o\.?|daughter\s+of|c\/o\.?|care\s+of)\s*[:.-]?\s*([A-Za-z\s.'-]+)/i);
  if (fatherMatch) {
    const rawVal = fatherMatch[1].split(/[\r\n;,]|\b(?:dob|date\s+of\s+birth|address|pin|sex|gender)\b/i)[0].trim();
    const cleaned = cleanPersonName(rawVal);
    if (cleaned) {
      facts.push({
        personName,
        fieldName: 'fathers_name',
        fieldValue: cleaned,
        rawSnippet: fatherMatch[0].slice(0, 120),
        confidence: 0.95
      });
    }
  }

  // 2. Mother's Name
  const motherMatch = text.match(/(?:mother['’]?s?\s*name|mother\s*name|\bm\/o\.?|\bmother)\s*[:.-]?\s*([A-Za-z\s.'-]+)/i);
  if (motherMatch) {
    const rawVal = motherMatch[1].split(/[\r\n;,]|\b(?:dob|date\s+of\s+birth|address|pin|sex|gender)\b/i)[0].trim();
    const cleaned = cleanPersonName(rawVal);
    if (cleaned) {
      facts.push({
        personName,
        fieldName: 'mothers_name',
        fieldValue: cleaned,
        rawSnippet: motherMatch[0].slice(0, 120),
        confidence: 0.95
      });
    }
  }

  // 3. Date of Birth (DOB)
  const dobMatch = text.match(/(?:date\s*of\s*birth|birth\s*date|\bd\.?o\.?b\.?)\s*[:.-]?\s*([0-9a-zA-Z\s/,-]+)/i);
  if (dobMatch) {
    const dates = findDateCandidates(dobMatch[1]);
    if (dates.length > 0) {
      facts.push({
        personName,
        fieldName: 'dob',
        fieldValue: dates[0].date,
        rawSnippet: dobMatch[0].slice(0, 100),
        confidence: 0.95
      });
    }
  }

  // 4. Gender
  const genderMatch = text.match(/\b(?:gender|sex)\s*[:.-]?\s*(male|female|other|m|f)\b/i);
  if (genderMatch) {
    const g = genderMatch[1].toLowerCase();
    const val = g.startsWith('m') ? 'Male' : (g.startsWith('f') ? 'Female' : 'Other');
    facts.push({
      personName,
      fieldName: 'gender',
      fieldValue: val,
      rawSnippet: genderMatch[0].slice(0, 50),
      confidence: 0.95
    });
  }

  // 5. 10th Marks / Secondary School Examination
  const has10thContext = /(?:10th|class\s*x\b|secondary\s*school|matriculation|high\s*school|ssc\b)/i.test(text);
  if (has10thContext) {
    let markVal = null;
    let snippet = '';

    const pctMatch = text.match(/(?:percentage|marks\s*(?:obtained|%|percent)?|aggregate|result)\s*[:.-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*%?)/i) ||
                     text.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    const cgpaMatch = text.match(/(?:cgpa|gpa)\s*[:.-]?\s*(\d{1,2}(?:\.\d{1,2})?)/i);
    const boardMatch = text.match(/\b(CBSE|ICSE|State\s*Board|WBBSE|UP\s*Board|Maharashtra\s*Board|BIE|NIOS)\b/i);
    const yearMatch = text.match(/\b(20\d\d|19\d\d)\b/);

    if (pctMatch) {
      let pct = pctMatch[1].trim();
      if (!pct.endsWith('%')) pct += '%';
      markVal = pct;
      snippet = pctMatch[0];
    } else if (cgpaMatch) {
      markVal = `CGPA ${cgpaMatch[1]}`;
      snippet = cgpaMatch[0];
    }

    if (markVal) {
      const extra = [];
      if (boardMatch) extra.push(boardMatch[1].toUpperCase());
      if (yearMatch) extra.push(yearMatch[1]);
      const full10th = extra.length > 0 ? `${markVal} (${extra.join(', ')})` : markVal;

      facts.push({
        personName,
        fieldName: 'marks_10th',
        fieldValue: full10th,
        rawSnippet: snippet.slice(0, 100),
        confidence: 0.92
      });
    }
  }

  // 6. 12th Marks / Higher Secondary / Intermediate
  const has12thContext = /(?:12th|class\s*xii\b|senior\s*secondary|intermediate|higher\s*secondary|hsc\b)/i.test(text);
  if (has12thContext) {
    let markVal = null;
    let snippet = '';

    const pctMatch = text.match(/(?:percentage|marks\s*(?:obtained|%|percent)?|aggregate|result)\s*[:.-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*%?)/i) ||
                     text.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    const cgpaMatch = text.match(/(?:cgpa|gpa)\s*[:.-]?\s*(\d{1,2}(?:\.\d{1,2})?)/i);
    const streamMatch = text.match(/\b(Science|Commerce|Arts|Humanities|PCM|PCB)\b/i);
    const boardMatch = text.match(/\b(CBSE|ICSE|State\s*Board|WBBSE|UP\s*Board|Maharashtra\s*Board|BIE|NIOS)\b/i);
    const yearMatch = text.match(/\b(20\d\d|19\d\d)\b/);

    if (pctMatch) {
      let pct = pctMatch[1].trim();
      if (!pct.endsWith('%')) pct += '%';
      markVal = pct;
      snippet = pctMatch[0];
    } else if (cgpaMatch) {
      markVal = `CGPA ${cgpaMatch[1]}`;
      snippet = cgpaMatch[0];
    }

    if (markVal) {
      const extra = [];
      if (streamMatch) extra.push(streamMatch[1]);
      if (boardMatch) extra.push(boardMatch[1].toUpperCase());
      if (yearMatch) extra.push(yearMatch[1]);
      const full12th = extra.length > 0 ? `${markVal} (${extra.join(', ')})` : markVal;

      facts.push({
        personName,
        fieldName: 'marks_12th',
        fieldValue: full12th,
        rawSnippet: snippet.slice(0, 100),
        confidence: 0.92
      });
    }
  }

  // 7. Higher Education / Degree
  const degreeMatch = text.match(/\b(Bachelor\s+of\s+[A-Za-z\s]+|Master\s+of\s+[A-Za-z\s]+|Doctor\s+of\s+[A-Za-z\s]+|B\.?Tech|B\.?E\.?|B\.?Sc|B\.?Com|B\.?A|BBA|BCA|M\.?Tech|M\.?B\.?A|M\.?Sc|M\.?A|MCA|MBBS|BDS|MD|Ph\.?D|Diploma)\b(?:\s+(?:in|of)\s+([A-Za-z\s]+))?/i);
  if (degreeMatch) {
    const deg = degreeMatch[0].split(/[\r\n;,]+/)[0].trim();
    if (deg.length >= 3 && deg.length <= 80) {
      facts.push({
        personName,
        fieldName: 'education',
        fieldValue: deg,
        rawSnippet: degreeMatch[0].slice(0, 100),
        confidence: 0.90
      });
    }
  }

  // 8. Address
  const addrMatch = text.match(/(?:permanent\s*address|residential\s*address|present\s*address|residence|residing\s+at|address)\s*[:.-]?\s*([^\n\r]+(?:\r?\n[^\n\r]+){0,3})/i);
  if (addrMatch) {
    let rawAddr = addrMatch[1].split(/\r?\n(?:\s*(?:date|signature|mobile|phone|tel|email|aadhaar|pan|dl|license|issue)\b[:.-])/i)[0];
    rawAddr = rawAddr.replace(/\s+/g, ' ').trim();
    if (rawAddr.length >= 10 && rawAddr.length <= 200 && !/^(?:none|n\/a|same\s+as|null|not\s+mentioned)$/i.test(rawAddr)) {
      facts.push({
        personName,
        fieldName: 'address',
        fieldValue: rawAddr,
        rawSnippet: addrMatch[0].slice(0, 160),
        confidence: 0.88
      });
    }
  }

  // 9. License Number (Driving License / DL)
  const dlMatch = text.match(/(?:driving\s*licen[sc]e(?:\s*(?:no\.?|number|#))?|\bdl\s*(?:no\.?|#)\b|\blicen[sc]e\s*(?:no\.?|number|#))\s*[:.-]?\s*([A-Za-z0-9/-]{5,25})/i);
  if (dlMatch) {
    const rawVal = dlMatch[1].trim().replace(/[.,;]$/, '');
    if (rawVal.length >= 5 && /\d/.test(rawVal) && !/^(?:expires|validity|issue|class|vehicle|state|null)$/i.test(rawVal)) {
      facts.push({
        personName,
        fieldName: 'license_number',
        fieldValue: rawVal.toUpperCase(),
        rawSnippet: dlMatch[0].slice(0, 100),
        confidence: 0.95
      });
    }
  }

  // 10. National ID / Passport Number
  const passMatch = text.match(/\b(?:passport\s*(?:no\.?|number|#)?)\s*[:.-]?\s*([A-Za-z0-9]{6,12})\b/i);
  if (passMatch) {
    const rawVal = passMatch[1].trim().toUpperCase();
    if (/\d/.test(rawVal)) {
      facts.push({
        personName,
        fieldName: 'id_number',
        fieldValue: rawVal,
        rawSnippet: passMatch[0].slice(0, 80),
        confidence: 0.95
      });
    }
  }

  return facts;
}

/**
 * Async extraction of profile facts combining fast deterministic Pass 1
 * with targeted local LLM fallback (Pass 2) for missing biographical fields.
 * Adheres strictly to Step 4 of docs/AI_OPTIMIZATION_PLAN.md.
 */
async function extractProfileFactsWithAi(text, personName = null, llmService = null) {
  const deterministicFacts = extractProfileFacts(text, personName);
  if (!llmService || typeof llmService.extractBiographicalFacts !== 'function' || !llmService.isReady()) {
    return deterministicFacts;
  }

  const hasFather = deterministicFacts.some(f => f.fieldName === 'fathers_name');
  const hasMother = deterministicFacts.some(f => f.fieldName === 'mothers_name');
  const hasAddress = deterministicFacts.some(f => f.fieldName === 'address');

  // If all critical biographical facts were found deterministically, no LLM query needed
  if (hasFather && hasMother && hasAddress) {
    return deterministicFacts;
  }

  // Check if text has any biographical indicator before invoking LLM to save CPU resources
  const hasBioKeywords = /\b(father|mother|parent|s\/o|d\/o|c\/o|address|residence|residing|permanent|street|road|lane|colony|block|sector|flat|apt|apartment|p\.?o\.?|pin|zip)\b/i.test(text || '');
  if (!hasBioKeywords) {
    return deterministicFacts;
  }

  try {
    const aiFacts = await llmService.extractBiographicalFacts({
      text,
      person: personName,
      missingFields: {
        fathersName: !hasFather,
        mothersName: !hasMother,
        address: !hasAddress
      }
    });

    if (aiFacts) {
      if (!hasFather && aiFacts.fathersName) {
        deterministicFacts.push({
          personName,
          fieldName: 'fathers_name',
          fieldValue: aiFacts.fathersName,
          rawSnippet: aiFacts.fathersSnippet || `Father: ${aiFacts.fathersName}`,
          confidence: 0.88,
          method: 'local-ai-gemma4'
        });
      }
      if (!hasMother && aiFacts.mothersName) {
        deterministicFacts.push({
          personName,
          fieldName: 'mothers_name',
          fieldValue: aiFacts.mothersName,
          rawSnippet: aiFacts.mothersSnippet || `Mother: ${aiFacts.mothersName}`,
          confidence: 0.88,
          method: 'local-ai-gemma4'
        });
      }
      if (!hasAddress && aiFacts.address) {
        deterministicFacts.push({
          personName,
          fieldName: 'address',
          fieldValue: aiFacts.address,
          rawSnippet: aiFacts.addressSnippet || `Address: ${aiFacts.address}`,
          confidence: 0.85,
          method: 'local-ai-gemma4'
        });
      }
    }
  } catch (err) {
    console.warn('[extractionService] extractProfileFactsWithAi AI fallback error:', err.message || err);
  }

  return deterministicFacts;
}

module.exports = {
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
  scoreOcrOrientation,
  scoreOcrText,
  selectRightAngleOcrOrientation,
  findDateCandidates,
  analyzeDocumentText,
  computeExpiryStatus,
  detectPerson,
  generateAutoTags,
  suggestDocumentTitle,
  cleanPersonName,
  extractProfileFacts,
  extractProfileFactsWithAi
};
