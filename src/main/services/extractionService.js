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

  // Sort words vertically first (y), then horizontally (x)
  const sorted = [...ocrWords].sort((a, b) => {
    if (Math.abs(a.y - b.y) <= lineThreshold) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  const lines = [];
  let currentLine = [];
  let currentLineY = null;

  for (const word of sorted) {
    if (currentLineY === null) {
      currentLine.push(word);
      currentLineY = word.y;
    } else if (Math.abs(word.y - currentLineY) <= lineThreshold) {
      currentLine.push(word);
    } else {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
      currentLine = [word];
      currentLineY = word.y;
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
        if (gap >= columnGapThreshold) {
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

        // If native PDF text is absent or insufficient (e.g. scanned ticket or photo PDF),
        // automatically perform OCR on rendered page screenshots
        const cleanedText = text.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').trim();
        let method = 'native-pdf';

        if (cleanedText.length < 40) {
          try {
            const Tesseract = require('tesseract.js');
            const pagesToOcr = Math.min(pageCount, 3);
            let combinedOcr = '';
            const allWords = [];
            for (let p = 1; p <= pagesToOcr; p++) {
              const shot = await parser.getScreenshot({ page: p });
              if (shot && shot.pages && shot.pages[0] && shot.pages[0].dataUrl) {
                const ocrResult = await Tesseract.recognize(shot.pages[0].dataUrl, 'eng');
                const pageWords = extractOcrWordCoordinates(ocrResult?.data);
                if (pageWords.length > 0) {
                  allWords.push(...pageWords);
                }
                const pageText = ocrResult?.data?.text?.trim() || '';
                if (pageText) {
                  combinedOcr += (combinedOcr ? '\n\n' : '') + pageText;
                }
              }
            }
            if (combinedOcr.length > cleanedText.length) {
              ocrWords = allWords;
              const structured = reconstructStructuredTableLayout(ocrWords);
              text = structured.structuredText && structured.structuredText.length >= combinedOcr.length
                ? structured.structuredText
                : combinedOcr;
              method = 'pdf-ocr-tesseract';
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
        const text = data.text ? data.text.trim() : '';
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

  // For image formats, perform OCR with Tesseract.js and extract detailed coordinates
  if (mimeType.startsWith('image/')) {
    try {
      const Tesseract = require('tesseract.js');
      const res = await Tesseract.recognize(buffer, 'eng');
      const rawText = res && res.data && res.data.text ? res.data.text.trim() : '';
      ocrWords = extractOcrWordCoordinates(res && res.data);
      const structured = reconstructStructuredTableLayout(ocrWords);
      const text = structured.structuredText && structured.structuredText.length >= rawText.length
        ? structured.structuredText
        : rawText;

      return {
        text,
        pageCount: 1,
        method: 'ocr-tesseract',
        ocrWords
      };
    } catch (e) {
      return { text: '', pageCount: 1, method: 'ocr-unavailable', ocrWords: [] };
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
    },
    // 4. Day/Month/Year: 14/04/2031 or 14-04-2031
    {
      regex: /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](19\d\d|20\d\d)\b/g,
      handler: (m) => toIsoDate(m[3], m[2], m[1])
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

  return Array.from(tagsSet).slice(0, 7);
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

  if (/passport|republic|nationality|travel document/i.test(lowerText)) {
    docType = 'passport';
    category = 'identity';
  } else if (/driver['’]?s?\s*license|driving\s*licence|motor\s*vehicle|dl\s*no/i.test(lowerText)) {
    docType = 'driving_license';
    category = 'identity';
  } else if (/national\s*id|identity\s*card|aadhaar|pan\s*card|voter\s*id|social\s*security|ssn/i.test(lowerText)) {
    docType = 'identity_card';
    category = 'identity';
  } else if (/insurance|policy\s*no|premium|coverage|insured|sum\s*assured|deductible|claim\s*no/i.test(lowerText)) {
    docType = 'insurance_policy';
    category = 'insurance';
  } else if (/tax\s*return|form\s*1040|w-?2|1099|incometax|internal\s*revenue|revenue\s*service|irs|itr/i.test(lowerText)) {
    docType = 'tax_document';
    category = 'tax';
  } else if (/prescription|clinic|hospital|patient|doctor|physician|diagnosis|medical\s*center|lab\s*report|blood\s*test|lipid\s*profile/i.test(lowerText)) {
    docType = 'medical_record';
    category = 'medical';
  } else if (/deed|mortgage|lease|lease\s*agreement|tenant|landlord|rental\s*agreement|property\s*tax|land\s*registry|title\s*deed/i.test(lowerText)) {
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

  // Detect Family Member / Person
  const knownPersons = (options && options.knownPersons) ? options.knownPersons : [];
  const person = detectPerson(text, knownPersons);

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

  return {
    docType,
    category,
    person,
    tags,
    suggestedTitle,
    notesSummary,
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
  extractOcrWordCoordinates,
  reconstructStructuredTableLayout,
  findDateCandidates,
  analyzeDocumentText,
  computeExpiryStatus,
  detectPerson,
  generateAutoTags,
  suggestDocumentTitle
};
