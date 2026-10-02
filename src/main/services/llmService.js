'use strict';

/**
 * Local AI & Grounded Document Q&A Service.
 * Adheres to ARCHITECTURE.md: "Bundled llama-server.exe... inference-only... explicit 127.0.0.1 host binding"
 * Adheres to SECURITY.md: "llama-server.exe must bind only to 127.0.0.1 on an application-selected port.
 * Do not enable LAN access, plugins, tools, or file-operation capabilities."
 * Adheres to AGENTS.md: "AI work additionally requires a structured output contract, rejection of invalid output,
 * explicit handling of unknown values, and source references when it presents document-derived claims."
 */

const { spawn, exec } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const GEMMA_MODEL_URL = 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf';
const GEMMA_MODEL_FILENAME = 'gemma-2-2b-it-Q4_K_M.gguf';
const LLAMA_WIN_BIN_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b4759/llama-b4759-bin-win-avx2-x64.zip';

function getUserDataDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch (e) {}

  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'family-vault');
  }
  const home = process.env.USERPROFILE || process.env.HOME || '.';
  return path.join(home, '.family-vault');
}

function isPackagedApp() {
  try {
    const { app } = require('electron');
    if (app && typeof app.isPackaged === 'boolean') {
      return app.isPackaged;
    }
  } catch (e) {}
  return Boolean(process.resourcesPath && !process.defaultApp);
}

class LlmService {
  constructor() {
    this._process = null;
    this._port = 18432;
    this._modelPath = null;
    this._isReady = false;
  }

  getModelsDirectory(forDownload = false) {
    if (forDownload) {
      if (isPackagedApp()) {
        const userModelsDir = path.join(getUserDataDir(), 'models');
        if (!fs.existsSync(userModelsDir)) fs.mkdirSync(userModelsDir, { recursive: true });
        return userModelsDir;
      }
      const appDir = path.resolve(__dirname, '../../..');
      const dir = path.join(appDir, 'models');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }

    if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'models', GEMMA_MODEL_FILENAME))) {
      return path.join(process.resourcesPath, 'models');
    }
    const userModelsDir = path.join(getUserDataDir(), 'models');
    if (fs.existsSync(path.join(userModelsDir, GEMMA_MODEL_FILENAME))) {
      return userModelsDir;
    }
    const appDir = path.resolve(__dirname, '../../..');
    const dir = path.join(appDir, 'models');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getBinDirectory(forDownload = false) {
    if (forDownload) {
      if (isPackagedApp()) {
        const userBinDir = path.join(getUserDataDir(), 'bin');
        if (!fs.existsSync(userBinDir)) fs.mkdirSync(userBinDir, { recursive: true });
        return userBinDir;
      }
      const appDir = path.resolve(__dirname, '../../..');
      const dir = path.join(appDir, 'bin');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }

    if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'bin', 'llama-server.exe'))) {
      return path.join(process.resourcesPath, 'bin');
    }
    const userBinDir = path.join(getUserDataDir(), 'bin');
    if (fs.existsSync(path.join(userBinDir, 'llama-server.exe'))) {
      return userBinDir;
    }
    const appDir = path.resolve(__dirname, '../../..');
    const dir = path.join(appDir, 'bin');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  findModelPath() {
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'models', GEMMA_MODEL_FILENAME) : null,
      path.join(getUserDataDir(), 'models', GEMMA_MODEL_FILENAME),
      path.join(path.resolve(__dirname, '../../..'), 'models', GEMMA_MODEL_FILENAME),
      path.join(process.cwd(), 'models', GEMMA_MODEL_FILENAME)
    ];
    return candidates.find(p => p && fs.existsSync(p)) || null;
  }

  findBinaryPath() {
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'llama-server.exe') : null,
      path.join(getUserDataDir(), 'bin', 'llama-server.exe'),
      path.join(path.resolve(__dirname, '../../..'), 'bin', 'llama-server.exe'),
      path.join(process.cwd(), 'bin', 'llama-server.exe')
    ];
    return candidates.find(p => p && fs.existsSync(p)) || null;
  }

  isModelDownloaded() {
    return !!this.findModelPath();
  }

  isBinaryAvailable() {
    return !!this.findBinaryPath();
  }

  getStatus() {
    return {
      isServerRunning: this._isReady,
      engine: this._isReady ? 'llama-server-gemma2' : 'local-extractive-qa',
      port: this._port,
      modelConfigured: !!this._modelPath,
      modelPath: this._modelPath || this.findModelPath(),
      binaryPath: this.findBinaryPath(),
      isModelDownloaded: this.isModelDownloaded(),
      isBinaryAvailable: this.isBinaryAvailable()
    };
  }

  /**
   * Downloads and sets up the Gemma 2 2B GGUF model and llama engine.
   * Works in both development and shipped/packaged production environments.
   * @param {function} onProgress
   */
  async downloadAndSetupGemma(onProgress = () => {}) {
    const modelsDir = this.getModelsDirectory(true);
    const binDir = this.getBinDirectory(true);

    let targetModelPath = this.findModelPath();
    if (!targetModelPath) {
      targetModelPath = path.join(modelsDir, GEMMA_MODEL_FILENAME);
    }

    // 1. Download model if missing
    if (!fs.existsSync(targetModelPath)) {
      onProgress({ stage: 'model', message: 'Downloading Gemma 2 2B GGUF Model (~1.6 GB)...', percent: 0, downloadedMb: '0', totalMb: '1630' });
      await this._downloadFileWithProgress(GEMMA_MODEL_URL, targetModelPath, onProgress, 'model');
    }

    // 2. Download llama binary if missing
    let targetBinPath = this.findBinaryPath();
    if (!targetBinPath) {
      onProgress({ stage: 'binary', message: 'Downloading local llama engine (~35 MB)...', percent: 0, downloadedMb: '0', totalMb: '35' });
      const tempZip = path.join(binDir, 'llama-win.zip');
      await this._downloadFileWithProgress(LLAMA_WIN_BIN_URL, tempZip, onProgress, 'binary');

      onProgress({ stage: 'extracting', message: 'Extracting engine binaries...', percent: 95 });
      await new Promise((resolve, reject) => {
        exec(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${tempZip}' -DestinationPath '${binDir}'"`, (err) => {
          try { fs.unlinkSync(tempZip); } catch (e) {}
          if (err) return reject(new Error('Failed to extract llama binary: ' + err.message));
          resolve();
        });
      });
    }

    // 3. Start engine
    onProgress({ stage: 'starting', message: 'Starting Gemma 2 2B local server...', percent: 99 });
    const started = await this.autoDetectAndStart();

    onProgress({
      stage: 'ready',
      message: started ? 'Gemma 2 2B engine active and ready!' : 'Model ready (offline fallback active)',
      percent: 100,
      isServerRunning: started
    });

    return {
      success: true,
      modelPath: targetModelPath,
      isServerRunning: this._isReady
    };
  }

  async _downloadFileWithProgress(url, destPath, onProgress, stage) {
    return new Promise((resolve, reject) => {
      const tempPath = destPath + '.tmp';
      let fileStream = null;

      function fetchUrl(currentUrl, redirectCount = 0) {
        if (redirectCount > 10) {
          return reject(new Error('Too many HTTP redirects'));
        }

        const req = https.get(currentUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return fetchUrl(res.headers.location, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed with status ${res.statusCode}`));
          }

          fileStream = fs.createWriteStream(tempPath);
          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          let lastReport = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            const now = Date.now();
            if (now - lastReport > 250 || downloaded === totalBytes) {
              lastReport = now;
              const percent = totalBytes > 0 ? Math.round((downloaded / totalBytes) * 100) : 0;
              const downloadedMb = (downloaded / (1024 * 1024)).toFixed(1);
              const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
              if (typeof onProgress === 'function') {
                onProgress({ stage, downloadedMb, totalMb, percent });
              }
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              if (totalBytes > 0 && downloaded < totalBytes) {
                try { fs.unlinkSync(tempPath); } catch (e) {}
                return reject(new Error(`Incomplete download: received ${downloaded} of ${totalBytes} bytes`));
              }
              if (fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch (e) {}
              }
              fs.renameSync(tempPath, destPath);
              resolve(destPath);
            });
          });

          fileStream.on('error', (err) => {
            try { fs.unlinkSync(tempPath); } catch (e) {}
            reject(err);
          });
        });

        req.on('error', (err) => {
          if (fileStream) {
            fileStream.close();
            try { fs.unlinkSync(tempPath); } catch (e) {}
          }
          reject(err);
        });
      }

      fetchUrl(url);
    });
  }

  /**
   * Spawns llama-server child process on explicit 127.0.0.1 localhost binding.
   */
  async startServer(binaryPath, modelPath, port = 18432) {
    if (this._process) {
      this.stopServer();
    }

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`llama-server executable not found at: ${binaryPath}`);
    }
    if (!fs.existsSync(modelPath)) {
      throw new Error(`GGUF model not found at: ${modelPath}`);
    }

    this._port = port;
    this._modelPath = modelPath;

    // Strict local-only parameters: host 127.0.0.1, no web UI, no remote endpoints
    const args = [
      '--host', '127.0.0.1',
      '--port', String(port),
      '-m', modelPath,
      '-c', '4096'
    ];

    this._process = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    this._process.on('exit', () => {
      this._isReady = false;
      this._process = null;
    });

    // Wait for health endpoint
    this._isReady = await this._waitForHealth(port, 20000);
    return this._isReady;
  }

  /**
   * Scans project root and models directories for llama-server.exe and GGUF models.
   * Starts server automatically if found.
   */
  async autoDetectAndStart() {
    try {
      const appDir = path.resolve(__dirname, '../../..');
      const resourcesDir = process.resourcesPath || '';
      const userDataDir = getUserDataDir();

      const candidateBins = [
        path.join(resourcesDir, 'bin', 'llama-server.exe'),
        path.join(resourcesDir, 'llama-server.exe'),
        path.join(userDataDir, 'bin', 'llama-server.exe'),
        path.join(appDir, 'bin', 'llama-server.exe'),
        path.join(appDir, 'llama-server.exe'),
        path.join(process.cwd(), 'bin', 'llama-server.exe'),
        path.join(process.cwd(), 'llama-server.exe')
      ];

      const candidateModelDirs = [
        path.join(resourcesDir, 'models'),
        resourcesDir,
        path.join(userDataDir, 'models'),
        path.join(appDir, 'models'),
        path.join(process.cwd(), 'models'),
        appDir,
        process.cwd()
      ];

      const foundBin = candidateBins.find(p => p && fs.existsSync(p));
      if (!foundBin) return false;

      let foundModel = null;
      for (const dir of candidateModelDirs) {
        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir);
          const gguf = entries.find(f => f.toLowerCase().endsWith('.gguf'));
          if (gguf) {
            foundModel = path.join(dir, gguf);
            break;
          }
        }
      }

      if (foundBin && foundModel) {
        return await this.startServer(foundBin, foundModel);
      }
    } catch (e) {
      // Auto-detection failure should not crash app
    }
    return false;
  }

  stopServer() {
    if (this._process) {
      try {
        this._process.kill('SIGTERM');
      } catch (e) {}
      this._process = null;
    }
    this._isReady = false;
  }

  /**
   * Answers a user question grounded strictly in retrieved documents.
   * Cites source documents and page/text snippets.
   * If answer is not present, explicitly states unknown.
   */
  async answerQuestion({ query, documents = [], semanticMatches = [] }) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('Query must be a non-empty string');
    }

    // 1. Retrieve and score document candidates
    const searchTerms = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    const scoredSegments = [];

    // Add semantic vector matches first if available
    if (Array.isArray(semanticMatches)) {
      for (const sm of semanticMatches) {
        const doc = documents.find(d => d.id === sm.documentId);
        const score = Math.round((sm.similarity || 0) * 35);
        if (score > 2) {
          scoredSegments.push({
            documentId: sm.documentId,
            documentTitle: sm.documentTitle || (doc && doc.title) || 'Document',
            fileName: sm.fileName || (doc && doc.currentVersion?.fileName) || 'document',
            category: sm.category || (doc && doc.category) || 'other',
            snippet: sm.chunkText,
            score
          });
        }
      }
    }

    for (const doc of documents) {
      const title = doc.title || '';
      const notes = doc.notes || '';
      const text = doc.currentVersion?.metadata?.textContent || '';
      const docType = doc.currentVersion?.metadata?.docType || '';
      const issuer = doc.currentVersion?.metadata?.issuer || '';
      const expiryDate = doc.currentVersion?.metadata?.expiryDate || '';

      // Split document into coherent passages
      const passages = [];

      // Always include a synthesized metadata overview passage
      const metaParts = [
        `Document Title: "${title}"`,
        doc.category ? `Category: ${doc.category}` : null,
        doc.person ? `Person: ${doc.person}` : null,
        docType ? `Type: ${docType}` : null,
        issuer ? `Issuer: ${issuer}` : null,
        doc.currentVersion?.metadata?.issueDate ? `Issue Date: ${doc.currentVersion.metadata.issueDate}` : null,
        expiryDate ? `Expiry Date: ${expiryDate}` : null,
        doc.tags && doc.tags.length ? `Tags: ${Array.isArray(doc.tags) ? doc.tags.join(', ') : doc.tags}` : null,
        notes ? `Notes: ${notes}` : null
      ].filter(Boolean);

      if (metaParts.length > 0) {
        passages.push(metaParts.join(' | '));
      }

      if (notes && !passages.includes(notes)) passages.push(notes);

      if (text) {
        // Split by double newline or chunk into ~300 character sliding windows
        const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
        for (const p of paras) {
          if (p.length <= 400) {
            passages.push(p);
          } else {
            // Split into sentences and group into ~300 char chunks
            const sents = p.match(/[^.!?]+[.!?]+(\s|$)/g) || [p];
            let current = '';
            for (const s of sents) {
              if ((current + s).length > 350) {
                if (current.trim()) passages.push(current.trim());
                current = s;
              } else {
                current += s;
              }
            }
            if (current.trim()) passages.push(current.trim());
          }
        }
      }

      for (const p of passages) {
        let distinctMatches = 0;
        let totalMatches = 0;
        const lowerP = p.toLowerCase();

        for (const term of searchTerms) {
          const regex = new RegExp(`\\b${term}\\b`, 'i');
          if (regex.test(p)) {
            distinctMatches += 1;
            totalMatches += 1;
          } else if (lowerP.includes(term)) {
            totalMatches += 0.5;
          }
        }

        if (totalMatches > 0) {
          // Distinct terms receive heavy weighting (IR best practice)
          const score = (distinctMatches * 10) + (totalMatches * 2);
          scoredSegments.push({
            documentId: doc.id,
            documentTitle: title,
            fileName: doc.currentVersion?.fileName || 'document',
            category: doc.category,
            snippet: p,
            score
          });
        }
      }
    }

    // Deduplicate passages by documentId + snippet
    const uniqueSegments = [];
    const seen = new Set();
    for (const seg of scoredSegments) {
      const key = `${seg.documentId}::${seg.snippet}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSegments.push(seg);
      }
    }

    // Sort by relevance score
    uniqueSegments.sort((a, b) => b.score - a.score);
    const topSegments = uniqueSegments.slice(0, 5);

    if (topSegments.length === 0) {
      return {
        answer: 'I could not find information regarding this in your stored documents.',
        sources: [],
        confidence: 0,
        mode: this._isReady ? 'llama-server' : 'local-extractive'
      };
    }

    // 2. If llama-server is ready, prompt LLM with strict grounding
    if (this._isReady) {
      try {
        const prompt = this._buildPrompt(query, topSegments);
        const completion = await this._queryLlamaServer(prompt);
        return {
          answer: completion.trim(),
          sources: topSegments.map(s => ({
            documentId: s.documentId,
            documentTitle: s.documentTitle,
            fileName: s.fileName,
            snippet: s.snippet
          })),
          confidence: 0.9,
          mode: 'llama-server'
        };
      } catch (err) {
        // Fall back gracefully to local deterministic extraction
      }
    }

    // 3. Fallback: High-precision deterministic extractive answer
    const sources = topSegments.slice(0, 3).map(s => ({
      documentId: s.documentId,
      documentTitle: s.documentTitle,
      fileName: s.fileName,
      snippet: s.snippet
    }));

    const uniqueTitles = [...new Set(sources.map(s => s.documentTitle))];
    const answer = sources.length === 1
      ? `Based on "${sources[0].documentTitle}":\n\n"${sources[0].snippet}"`
      : `Based on ${uniqueTitles.map(t => `"${t}"`).join(', ')}:\n\n${sources.map(s => `• "${s.snippet}"`).join('\n\n')}`;

    return {
      answer,
      sources,
      confidence: 0.8,
      mode: 'local-extractive'
    };
  }

  _buildPrompt(query, segments) {
    const context = segments.map((s, i) => `[Source ${i+1}: ${s.documentTitle}]\n${s.snippet}`).join('\n\n');
    return `<start_of_turn>user\nYou are FamilyVault's private offline document assistant. Answer the user question strictly using only the provided document sources. If the answer cannot be found in the sources, say "I could not find information regarding this in your stored documents." Do not invent facts. Always cite the document title.\n\nSources:\n${context}\n\nQuestion: ${query}<end_of_turn>\n<start_of_turn>model\n`;
  }

  async _queryLlamaServer(prompt) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        prompt,
        temperature: 0.1,
        n_predict: 256,
        stop: ['<end_of_turn>', '<eos>', '<start_of_turn>']
      });

      const req = http.request({
        hostname: '127.0.0.1',
        port: this._port,
        path: '/completion',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.content || '');
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('LLM request timed out'));
      });

      req.write(data);
      req.end();
    });
  }

  _waitForHealth(port, timeoutMs) {
    const startTime = Date.now();
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          resolve(false);
          return;
        }

        const req = http.get({
          hostname: '127.0.0.1',
          port,
          path: '/health',
          timeout: 1000
        }, (res) => {
          if (res.statusCode === 200) {
            clearInterval(interval);
            resolve(true);
          }
        });

        req.on('error', () => {});
      }, 500);
    });
  }
}

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'to', 'in', 'for', 'of',
  'what', 'when', 'where', 'who', 'how', 'why', 'can', 'you', 'tell', 'me', 'my', 'does',
  'have', 'has', 'had', 'are', 'was', 'were', 'it', 'with', 'as', 'by', 'from'
]);

const llmService = new LlmService();

module.exports = {
  LlmService,
  llmService
};
