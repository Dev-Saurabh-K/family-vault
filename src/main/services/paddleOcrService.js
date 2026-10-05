'use strict';

/**
 * PaddleOCR Service using ppu-paddle-ocr and onnxruntime-node.
 * Serves as FamilyVault's primary dedicated OCR engine for scanned documents, images, and non-searchable PDFs.
 * 
 * Complies with PROJECT.md and SECURITY.md constraints:
 * - 100% offline with bundled local models
 * - Zero network calls or external APIs
 * - Output treated as untrusted suggestions with deterministic validation downstream
 */

const fs = require('node:fs');
const path = require('node:path');

class PaddleOcrService {
  constructor() {
    this._service = null;
    this._isReady = false;
    this._modelDir = null;
    this._initPromise = null;
  }

  /**
   * Resolves the local directory containing PaddleOCR ONNX models and dictionary.
   * @param {string|null} [customDir=null]
   * @returns {string|null}
   */
  resolveModelDir(customDir = null) {
    if (customDir && fs.existsSync(customDir)) {
      return customDir;
    }

    const candidates = [
      path.join(__dirname, '..', '..', '..', 'models', 'paddleocr'),
      path.join(process.cwd(), 'models', 'paddleocr'),
      path.join(process.resourcesPath || '', 'models', 'paddleocr')
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        const detModel = path.join(candidate, 'PP-OCRv5_mobile_det_infer.ort');
        const recModel = path.join(candidate, 'en_PP-OCRv5_mobile_rec_infer.ort');
        const dictFile = path.join(candidate, 'ppocrv5_en_dict.txt');
        if (fs.existsSync(detModel) && fs.existsSync(recModel) && fs.existsSync(dictFile)) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Initializes the PaddleOCR service using local ONNX model files.
   * @param {string|null} [customModelDir=null]
   * @returns {Promise<boolean>}
   */
  async initialize(customModelDir = null) {
    if (this._isReady && this._service) {
      return true;
    }

    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        const modelDir = this.resolveModelDir(customModelDir);
        if (!modelDir) {
          this._isReady = false;
          return false;
        }

        const { PaddleOcrService: PpuPaddleOcrService } = require('ppu-paddle-ocr');

        const detPath = path.join(modelDir, 'PP-OCRv5_mobile_det_infer.ort');
        const recPath = path.join(modelDir, 'en_PP-OCRv5_mobile_rec_infer.ort');
        const dictPath = path.join(modelDir, 'ppocrv5_en_dict.txt');

        this._service = new PpuPaddleOcrService({
          model: {
            detection: detPath,
            recognition: recPath,
            charactersDictionary: dictPath
          },
          debugging: {
            verbose: false,
            debug: false
          }
        });

        await this._service.initialize();
        this._modelDir = modelDir;
        this._isReady = true;
        return true;
      } catch (err) {
        this._isReady = false;
        this._service = null;
        return false;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  }

  /**
   * Checks whether the PaddleOCR service is initialized and ready for inference.
   * @returns {boolean}
   */
  isReady() {
    return Boolean(this._isReady && this._service);
  }

  /**
   * Extracts text and spatial word coordinates from an image buffer using PaddleOCR.
   * @param {Buffer|ArrayBuffer} imageInput 
   * @returns {Promise<{ text: string, ocrWords: Array<object>, confidence: number, method: string }>}
   */
  async extractText(imageInput) {
    if (!this.isReady()) {
      const initialized = await this.initialize();
      if (!initialized || !this._service) {
        throw new Error('PaddleOCR service is not initialized');
      }
    }

    let arrayBuffer;
    if (Buffer.isBuffer(imageInput)) {
      arrayBuffer = imageInput.buffer.slice(imageInput.byteOffset, imageInput.byteOffset + imageInput.byteLength);
    } else if (imageInput instanceof ArrayBuffer) {
      arrayBuffer = imageInput;
    } else {
      throw new Error('Unsupported image input type for PaddleOCR. Expected Buffer or ArrayBuffer.');
    }

    const res = await this._service.recognize(arrayBuffer);
    const rawText = (res && typeof res.text === 'string') ? res.text.trim() : '';

    const ocrWords = [];
    if (res && Array.isArray(res.lines)) {
      for (const line of res.lines) {
        if (Array.isArray(line)) {
          for (const item of line) {
            if (item && item.text) {
              const text = item.text.trim();
              if (text) {
                const box = item.box || {};
                const x = Math.max(0, Math.round(box.x ?? 0));
                const y = Math.max(0, Math.round(box.y ?? 0));
                const width = Math.max(0, Math.round(box.width ?? 0));
                const height = Math.max(0, Math.round(box.height ?? 0));
                const confidence = Math.round((item.confidence ?? 0) * 100);

                ocrWords.push({
                  text,
                  x,
                  y,
                  width,
                  height,
                  confidence
                });
              }
            }
          }
        }
      }
    }

    const confidence = Math.round((res && res.confidence !== undefined ? res.confidence : 0) * 100);

    return {
      text: rawText,
      ocrWords,
      confidence,
      method: 'ocr-paddleocr-primary'
    };
  }

  /**
   * Destroys and cleans up the underlying ONNX Runtime sessions.
   * @returns {Promise<void>}
   */
  async destroy() {
    if (this._service && typeof this._service.destroy === 'function') {
      try {
        await this._service.destroy();
      } catch (e) {}
    }
    this._service = null;
    this._isReady = false;
    this._modelDir = null;
  }
}

const paddleOcrService = new PaddleOcrService();

module.exports = {
  PaddleOcrService,
  paddleOcrService
};
