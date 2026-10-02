'use strict';

/**
 * Modular Embedding & Vector Retrieval Service.
 * Adheres to PROJECT.md: "Semantic embeddings are a separate optional layer for meaning-based retrieval;
 * they are not required for basic search and must be abstracted from any single embedding model or vector store."
 * Adheres to SECURITY.md: "embeddings, temporary files, and indexes are sensitive. Persist them encrypted."
 */

const http = require('node:http');

const VECTOR_DIMENSION = 64;

class EmbeddingService {
  constructor() {
    this._port = 18432;
    this._isLocalServerAvailable = false;
  }

  setServerAvailable(isAvailable, port = 18432) {
    this._isLocalServerAvailable = isAvailable;
    this._port = port;
  }

  /**
   * Splits text into coherent passages suitable for vector embedding and retrieval.
   * Preserves short documents intact and uses sliding overlapping windows for longer content.
   * @param {string} text 
   * @param {number} maxChunkLen 
   * @param {number} overlap 
   * @returns {string[]}
   */
  chunkText(text, maxChunkLen = 700, overlap = 150) {
    if (!text || typeof text !== 'string') return [];
    const trimmed = text.trim();
    if (!trimmed) return [];

    const passages = [];
    const paras = trimmed.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paras.length > 1) {
      for (const p of paras) {
        if (p.length <= maxChunkLen) {
          passages.push(p);
        } else {
          let start = 0;
          while (start < p.length) {
            let end = start + maxChunkLen;
            if (end >= p.length) {
              passages.push(p.substring(start).trim());
              break;
            }
            let breakPoint = p.lastIndexOf(' ', end);
            if (breakPoint <= start + (maxChunkLen * 0.5)) breakPoint = end;
            const chunk = p.substring(start, breakPoint).trim();
            if (chunk) passages.push(chunk);
            start = Math.max(breakPoint - overlap, start + 1);
          }
        }
      }
      return passages;
    }

    // Single block or OCR text without double newlines
    if (trimmed.length <= maxChunkLen) {
      return [trimmed];
    }

    let start = 0;
    while (start < trimmed.length) {
      let end = start + maxChunkLen;
      if (end >= trimmed.length) {
        passages.push(trimmed.substring(start).trim());
        break;
      }
      let breakPoint = trimmed.lastIndexOf('\n', end);
      if (breakPoint <= start + (maxChunkLen * 0.5)) {
        breakPoint = trimmed.lastIndexOf(' ', end);
      }
      if (breakPoint <= start + (maxChunkLen * 0.5)) {
        breakPoint = end;
      }

      const chunk = trimmed.substring(start, breakPoint).trim();
      if (chunk) passages.push(chunk);

      start = Math.max(breakPoint - overlap, start + 1);
    }

    return passages.length > 0 ? passages : [trimmed];
  }

  /**
   * Generates a normalized float embedding vector for text.
   * Completely local and offline.
   * @param {string} text 
   * @returns {Promise<Float32Array>}
   */
  async generateEmbedding(text) {
    if (!text || typeof text !== 'string') {
      return new Float32Array(VECTOR_DIMENSION);
    }

    // If local llama-server embedding endpoint is active, try querying it
    if (this._isLocalServerAvailable) {
      try {
        const remoteVector = await this._queryLlamaEmbedding(text);
        if (remoteVector && remoteVector.length > 0) {
          return new Float32Array(remoteVector);
        }
      } catch (err) {
        // Fall back to local feature hashing
      }
    }

    // Deterministic term and character n-gram feature hashing vectorizer (0-dependency, offline)
    return this._hashVectorize(text, VECTOR_DIMENSION);
  }

  /**
   * Deterministic feature hashing vectorizer into a normalized Float32Array.
   */
  _hashVectorize(text, dim = VECTOR_DIMENSION) {
    const vector = new Float32Array(dim);
    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(t => t.length > 1);

    if (tokens.length === 0) return vector;

    for (const token of tokens) {
      // Word hash
      let h = 0x811c9dc5;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
      }
      const idx = h % dim;
      vector[idx] += 1.0;

      // Character tri-grams for subword similarity
      if (token.length >= 3) {
        for (let i = 0; i <= token.length - 3; i++) {
          let th = 0x811c9dc5;
          for (let j = 0; j < 3; j++) {
            th ^= token.charCodeAt(i + j);
            th = (th * 0x01000193) >>> 0;
          }
          vector[th % dim] += 0.5;
        }
      }
    }

    // Normalize to unit length (L2 norm)
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /**
   * Computes cosine similarity between two Float32Arrays.
   * Both are assumed to be L2-normalized unit vectors.
   * @param {Float32Array} a 
   * @param {Float32Array} b 
   * @returns {number} Value between -1.0 and 1.0
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }

  /**
   * Serializes a Float32Array into a Node.js Buffer for SQLite BLOB storage.
   * @param {Float32Array} floatArray 
   * @returns {Buffer}
   */
  vectorToBlob(floatArray) {
    return Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
  }

  /**
   * Deserializes a Buffer from SQLite BLOB back into a Float32Array.
   * @param {Buffer} buffer 
   * @returns {Float32Array}
   */
  blobToVector(buffer) {
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return new Float32Array(ab);
  }

  async _queryLlamaEmbedding(content) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ content });
      const req = http.request({
        hostname: '127.0.0.1',
        port: this._port,
        path: '/embedding',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 5000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.embedding || null);
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Embedding request timed out'));
      });
      req.write(data);
      req.end();
    });
  }
}

const embeddingService = new EmbeddingService();

module.exports = {
  VECTOR_DIMENSION,
  EmbeddingService,
  embeddingService
};
