'use strict';

/**
 * Extraction and deterministic metadata analysis service.
 * Adheres to ARCHITECTURE.md: "native PDF text extraction when available -> OCRService when text is absent/insufficient
 * -> normalized text -> validated extraction/classification"
 * Adheres to PRODUCT_REQUIREMENTS.md: "Treat original documents as source material, application validation as authority,
 * and AI output as untrusted suggestions. The app clearly labels it as active, expiring soon, or expired based on deterministic date logic."
 */

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
 * Extracts plain text from document buffers.
 * @param {Buffer} buffer 
 * @param {string} mimeType 
 * @returns {Promise<{ text: string, pageCount: number, method: string }>}
 */
async function extractTextFromBuffer(buffer, mimeType) {
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

        // If native PDF text is absent or insufficient (e.g. scanned ticket or photo PDF),
        // automatically perform OCR on rendered page screenshots
        const cleanedText = text.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').trim();
        let method = 'native-pdf';

        if (cleanedText.length < 40) {
          try {
            const Tesseract = require('tesseract.js');
            const pagesToOcr = Math.min(pageCount, 3);
            let combinedOcr = '';
            for (let p = 1; p <= pagesToOcr; p++) {
              const shot = await parser.getScreenshot({ page: p });
              if (shot && shot.pages && shot.pages[0] && shot.pages[0].dataUrl) {
                const ocrResult = await Tesseract.recognize(shot.pages[0].dataUrl, 'eng');
                const pageText = ocrResult?.data?.text?.trim() || '';
                if (pageText) {
                  combinedOcr += (combinedOcr ? '\n\n' : '') + pageText;
                }
              }
            }
            if (combinedOcr.length > cleanedText.length) {
              text = combinedOcr;
              method = 'pdf-ocr-tesseract';
            }
          } catch (ocrErr) {}
        }

        await parser.destroy();
        return {
          text,
          pageCount,
          method
        };
      } else if (typeof pdfParseModule === 'function') {
        const data = await pdfParseModule(buffer);
        const text = data.text ? data.text.trim() : '';
        return {
          text,
          pageCount: data.numpages || 1,
          method: 'native-pdf'
        };
      }
    } catch (err) {
      try {
        const str = buffer.toString('utf8');
        if (str && /^[\x20-\x7E\s\r\n\t]+$/.test(str.substring(0, 100))) {
          return { text: str.trim(), pageCount: 1, method: 'plaintext-fallback' };
        }
      } catch (e) {}
      return { text: '', pageCount: 1, method: 'pdf-parse-error' };
    }
  }

  // For image formats, attempt OCR if engine is available
  if (mimeType.startsWith('image/')) {
    try {
      const Tesseract = require('tesseract.js');
      const res = await Tesseract.recognize(buffer, 'eng');
      const text = res && res.data && res.data.text ? res.data.text.trim() : '';
      return {
        text,
        pageCount: 1,
        method: 'ocr-tesseract'
      };
    } catch (e) {
      return { text: '', pageCount: 1, method: 'ocr-unavailable' };
    }
  }

  return { text: '', pageCount: 1, method: 'unsupported' };
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
    // 2. Day Month Year: 25 Jan 2026 or 25 January 2026
    {
      regex: /\b(0?[1-9]|[12]\d|3[01])\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,\s]+(19\d\d|20\d\d)\b/gi,
      handler: (m) => {
        const monthNum = MONTH_NAMES[m[2].toLowerCase()];
        return monthNum ? toIsoDate(m[3], monthNum, m[1]) : null;
      }
    },
    // 3. Month Day, Year: January 25, 2026
    {
      regex: /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(0?[1-9]|[12]\d|3[01])[,\s]+(19\d\d|20\d\d)\b/gi,
      handler: (m) => {
        const monthNum = MONTH_NAMES[m[1].toLowerCase()];
        return monthNum ? toIsoDate(m[3], monthNum, m[2]) : null;
      }
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

  // Sort by position in text
  candidates.sort((a, b) => a.index - b.index);
  return candidates;
}

/**
 * Proposes document type, issuer, issue date, and expiry date based on text analysis.
 */
function analyzeDocumentText(text, fileName = '') {
  const lowerText = (text + ' ' + fileName).toLowerCase();

  // Document Type Classification
  let docType = 'other';
  let category = 'other';

  if (/passport|republic|nationality|travel document/i.test(lowerText)) {
    docType = 'passport';
    category = 'identity';
  } else if (/driver['’]?s?\s*license|driving\s*licence|motor\s*vehicle/i.test(lowerText)) {
    docType = 'driving_license';
    category = 'identity';
  } else if (/insurance|policy\s*no|premium|coverage|insured/i.test(lowerText)) {
    docType = 'insurance_policy';
    category = 'insurance';
  } else if (/tax\s*return|form\s*1040|w-2|incometax|internal\s*revenue/i.test(lowerText)) {
    docType = 'tax_document';
    category = 'tax';
  } else if (/prescription|clinic|hospital|patient|doctor|diagnosis|medical\s*center/i.test(lowerText)) {
    docType = 'medical_record';
    category = 'medical';
  } else if (/deed|mortgage|lease|tenant|property|land\s*registry/i.test(lowerText)) {
    docType = 'property_document';
    category = 'property';
  }

  // Detect Dates
  const candidates = findDateCandidates(text);

  let expiryDate = null;
  let expirySnippet = null;
  let issueDate = null;
  let issueSnippet = null;
  let confidence = 0.5;

  const expiryKeywords = /expir|valid\s+until|valid\s+thru|valid\s+through|valid\s+to|end\s+date/i;
  const issueKeywords = /issu|date\s+of\s+issue|valid\s+from|start\s+date/i;

  for (const candidate of candidates) {
    // Check prefix first, then snippet
    if (expiryKeywords.test(candidate.prefix)) {
      if (!expiryDate || candidate.date > expiryDate) {
        expiryDate = candidate.date;
        expirySnippet = candidate.snippet;
        confidence = 0.9;
      }
    } else if (issueKeywords.test(candidate.prefix)) {
      if (!issueDate || candidate.date < issueDate) {
        issueDate = candidate.date;
        issueSnippet = candidate.snippet;
      }
    } else if (expiryKeywords.test(candidate.snippet) && !issueKeywords.test(candidate.prefix)) {
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

  // Guess issuer from text lines
  let issuer = null;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 50);
  if (lines.length > 0) {
    issuer = lines[0];
  }

  return {
    docType,
    category,
    issuer,
    issueDate,
    issueSnippet,
    expiryDate,
    expirySnippet,
    confidence,
    reviewStatus: confidence >= 0.85 ? 'proposed' : 'needs_review'
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

module.exports = {
  extractTextFromBuffer,
  findDateCandidates,
  analyzeDocumentText,
  computeExpiryStatus
};
