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
const os = require('node:os');
const extractionService = require('./extractionService');

const VALID_CATEGORIES = new Set([
  'identity',
  'insurance',
  'medical',
  'tax',
  'property',
  'other'
]);

const VALID_DOC_TYPES = new Set([
  'passport',
  'driving_license',
  'identity_card',
  'insurance_policy',
  'tax_document',
  'medical_record',
  'property_document',
  'other'
]);

function isValidIsoDate(str) {
  if (!str || typeof str !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, day] = str.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === m && d.getUTCDate() === day;
}

function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try {
    return JSON.parse(text);
  } catch (e) {}

  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx !== -1 && endIdx > startIdx) {
    const candidate = text.substring(startIdx, endIdx + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {}
  }
  return null;
}

function parseAndValidateAiMetadata(rawContent, text, fileName, knownPersons = [], options = {}) {
  if (!rawContent || typeof rawContent !== 'string') {
    return null;
  }

  const parsed = extractJsonFromText(rawContent);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  // 1. Strict Category Validation
  let category = null;
  if (typeof parsed.category === 'string') {
    const rawCat = parsed.category.toLowerCase().trim();
    if (VALID_CATEGORIES.has(rawCat)) {
      category = rawCat;
    }
  }

  // 2. Strict DocType Validation
  let docType = null;
  if (typeof parsed.docType === 'string') {
    const rawType = parsed.docType.toLowerCase().trim().replace(/[-\s]+/g, '_');
    if (VALID_DOC_TYPES.has(rawType)) {
      docType = rawType;
    }
  }

  // 3. Strict Person detection: must strictly match added users in knownPersons
  // Unmatched users must not be auto-assigned; they get flagged for review and category becomes 'other'
  let person = null;
  let unmatchedPerson = null;

  let candidatePerson = null;
  if (typeof parsed.person === 'string' && parsed.person.trim()) {
    candidatePerson = parsed.person.trim().replace(/^(?:Name|Patient|Cardholder|Policyholder|Insured|Citizen|MR|MRS|MS|DR)\s*[:.-]?\s*/i, '').trim();
  } else if (typeof parsed.unmatchedPerson === 'string' && parsed.unmatchedPerson.trim()) {
    candidatePerson = parsed.unmatchedPerson.trim().replace(/^(?:Name|Patient|Cardholder|Policyholder|Insured|Citizen|MR|MRS|MS|DR)\s*[:.-]?\s*/i, '').trim();
  }

  const blacklist = /\b(?:government|republic|passport|department|authority|insurance|hospital|clinic|bank|ministry|embassy|official|unknown|none|n\/a|null|undefined|sample|test|validity)\b/i;
  if (candidatePerson && (candidatePerson.length < 2 || candidatePerson.length > 80 || blacklist.test(candidatePerson))) {
    candidatePerson = null;
  }

  const strictToAddedUsers = options && options.strictToAddedUsers !== undefined
    ? options.strictToAddedUsers
    : (Array.isArray(knownPersons) && knownPersons.length > 0);

  if (candidatePerson) {
    if (Array.isArray(knownPersons) && knownPersons.length > 0) {
      const matched = knownPersons.find(kp => 
        kp.toLowerCase() === candidatePerson.toLowerCase() ||
        candidatePerson.toLowerCase() === kp.toLowerCase()
      );
      if (matched) {
        person = matched;
      } else {
        // Candidate person is NOT an added family member in the vault!
        unmatchedPerson = candidatePerson;
      }
    } else if (strictToAddedUsers) {
      // Vault has 0 added family members, so any detected person is unmatched
      unmatchedPerson = candidatePerson;
    } else {
      // Fallback when knownPersons is empty and strictToAddedUsers is false
      person = candidatePerson;
    }
  }

  // Also check text directly for known persons if candidatePerson wasn't matched
  if (!person && Array.isArray(knownPersons) && knownPersons.length > 0) {
    for (const kp of knownPersons) {
      if (!kp || typeof kp !== 'string' || kp.trim().length < 2) continue;
      const escaped = kp.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text || '')) {
        person = kp.trim();
        unmatchedPerson = null;
        break;
      }
    }
  }

  // STRICT RULE: If an unmatched person is detected:
  // "unmatched user will be categorised to any other category which user need to review and add new user"
  if (unmatchedPerson && !person) {
    category = 'other';
    docType = 'other';
  }

  // 4. Grounded Expiry Date: strictly YYYY-MM-DD and grounded in text
  let expiryDate = null;
  let expirySnippet = null;
  if (typeof parsed.expiryDate === 'string' && isValidIsoDate(parsed.expiryDate.trim())) {
    const candidateDate = parsed.expiryDate.trim();
    const [year, month, day] = candidateDate.split('-');
    const lowerDoc = (text || '').toLowerCase();
    const hasYear = lowerDoc.includes(year);
    const hasDay = lowerDoc.includes(day) || lowerDoc.includes(String(parseInt(day, 10)));

    if (hasYear && (hasDay || typeof parsed.expirySnippet === 'string')) {
      expiryDate = candidateDate;
      if (typeof parsed.expirySnippet === 'string' && parsed.expirySnippet.trim()) {
        expirySnippet = parsed.expirySnippet.trim().slice(0, 150);
      }
    }
  }

  // 5. Issue Date
  let issueDate = null;
  let issueSnippet = null;
  if (typeof parsed.issueDate === 'string' && isValidIsoDate(parsed.issueDate.trim())) {
    const candidateDate = parsed.issueDate.trim();
    const [year] = candidateDate.split('-');
    if ((text || '').includes(year)) {
      issueDate = candidateDate;
      if (typeof parsed.issueSnippet === 'string' && parsed.issueSnippet.trim()) {
        issueSnippet = parsed.issueSnippet.trim().slice(0, 150);
      }
    }
  }

  // 6. Issuer
  let issuer = null;
  if (typeof parsed.issuer === 'string' && parsed.issuer.trim()) {
    issuer = parsed.issuer.trim().slice(0, 80);
  }

  // 7. Tags
  let tags = [];
  if (Array.isArray(parsed.tags)) {
    tags = parsed.tags
      .filter(t => typeof t === 'string' && t.trim().length >= 2 && t.trim().length <= 30)
      .map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
      .filter(Boolean)
      .slice(0, 6);
  }

  // 8. Confidence
  let confidence = (typeof parsed.confidence === 'number' && !isNaN(parsed.confidence))
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.92;

  if (unmatchedPerson && !person) {
    confidence = Math.min(confidence, 0.65);
  }

  return {
    category,
    docType,
    person,
    unmatchedPerson,
    isUserMatched: Boolean(person),
    expiryDate,
    expirySnippet,
    issueDate,
    issueSnippet,
    issuer,
    tags,
    confidence
  };
}

const GEMMA_MODEL_URL = 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf';
const GEMMA_MODEL_FILENAME = 'gemma-4-e2b.gguf';
const GEMMA_MMPROJ_URL = 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-F16.gguf';
const GEMMA_MMPROJ_FILENAME = 'mmproj-gemma-4-e2b.gguf';
const LLAMA_WIN_BIN_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b11384/llama-b11384-bin-win-cpu-x64.zip';

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
    this._projectorPath = null;
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
    const candidateNames = [
      'gemma-4-e2b.gguf',
      'gemma-4-e2b-it.gguf',
      'gemma-4-e2b-Q4_K_M.gguf',
      'gemma-4-e2b-it-Q4_K_M.gguf',
      GEMMA_MODEL_FILENAME
    ];

    const searchDirs = [
      process.resourcesPath ? path.join(process.resourcesPath, 'models') : null,
      path.join(getUserDataDir(), 'models'),
      path.join(path.resolve(__dirname, '../../..'), 'models'),
      path.join(process.cwd(), 'models')
    ].filter(Boolean);

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const fn of candidateNames) {
        const full = path.join(dir, fn);
        if (fs.existsSync(full)) return full;
      }
      try {
        const files = fs.readdirSync(dir);
        const match = files.find(f => /gemma[-_]?4.*\.gguf$/i.test(f) && !f.startsWith('mmproj'));
        if (match) return path.join(dir, match);
      } catch (e) {}
    }

    return null;
  }

  findProjectorPath() {
    const candidateNames = [
      'mmproj-gemma-4-e2b.gguf',
      'mmproj-gemma-4-e2b-f16.gguf',
      'mmproj-model-f16.gguf',
      GEMMA_MMPROJ_FILENAME
    ];

    const searchDirs = [
      process.resourcesPath ? path.join(process.resourcesPath, 'models') : null,
      path.join(getUserDataDir(), 'models'),
      path.join(path.resolve(__dirname, '../../..'), 'models'),
      path.join(process.cwd(), 'models')
    ].filter(Boolean);

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const fn of candidateNames) {
        const full = path.join(dir, fn);
        if (fs.existsSync(full)) return full;
      }
      try {
        const files = fs.readdirSync(dir);
        const match = files.find(f => /mmproj.*\.gguf$/i.test(f));
        if (match) return path.join(dir, match);
      } catch (e) {}
    }

    return null;
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
      engine: this._isReady ? 'llama-server-gemma4-e2b (CPU)' : 'local-extractive-qa',
      modelName: 'Gemma-4-E2B (CPU Multimodal)',
      port: this._port,
      modelConfigured: !!this._modelPath,
      modelPath: this._modelPath || this.findModelPath(),
      projectorPath: this._projectorPath || this.findProjectorPath(),
      binaryPath: this.findBinaryPath(),
      isModelDownloaded: this.isModelDownloaded(),
      isBinaryAvailable: this.isBinaryAvailable()
    };
  }

  /**
   * Downloads and sets up the Gemma-4-E2B multimodal GGUF model and CPU llama engine.
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
      onProgress({ stage: 'model', message: 'Downloading Gemma-4-E2B Model (~2.9 GB)...', percent: 0, downloadedMb: '0', totalMb: '2960' });
      await this._downloadFileWithProgress(GEMMA_MODEL_URL, targetModelPath, onProgress, 'model');
    }

    // 2. Download multimodal vision projector if missing
    let targetProjectorPath = this.findProjectorPath();
    if (!targetProjectorPath) {
      targetProjectorPath = path.join(modelsDir, GEMMA_MMPROJ_FILENAME);
    }
    if (!fs.existsSync(targetProjectorPath)) {
      onProgress({ stage: 'projector', message: 'Downloading Gemma-4-E2B Vision Projector (~940 MB)...', percent: 0, downloadedMb: '0', totalMb: '940' });
      try {
        await this._downloadFileWithProgress(GEMMA_MMPROJ_URL, targetProjectorPath, onProgress, 'projector');
      } catch (projErr) {
        console.warn('[llmService] Vision projector download skipped/failed:', projErr.message);
      }
    }

    // 3. Download llama binary if missing
    let targetBinPath = this.findBinaryPath();
    if (!targetBinPath) {
      onProgress({ stage: 'binary', message: 'Downloading local CPU llama engine (~35 MB)...', percent: 0, downloadedMb: '0', totalMb: '35' });
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

    // 4. Start engine
    onProgress({ stage: 'starting', message: 'Starting Gemma-4-E2B CPU local server...', percent: 99 });
    const started = await this.autoDetectAndStart();

    onProgress({
      stage: 'ready',
      message: started ? 'Gemma-4-E2B CPU multimodal engine active and ready!' : 'Model ready (offline fallback active)',
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

        const req = https.get(currentUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FamilyVault/1.0'
          }
        }, (res) => {
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

    binaryPath = binaryPath || this.findBinaryPath();
    modelPath = modelPath || this.findModelPath();

    if (!binaryPath || !fs.existsSync(binaryPath)) {
      throw new Error(`llama-server executable not found at: ${binaryPath}`);
    }
    if (!modelPath || !fs.existsSync(modelPath)) {
      throw new Error(`GGUF model not found at: ${modelPath}`);
    }

    this._port = port;
    this._modelPath = modelPath;

    // Strict local-only parameters: host 127.0.0.1, no web UI, no remote endpoints
    // CPU version: optimize threads to host CPU core count, enforce 0 GPU offload
    const cpuCount = os.cpus() ? os.cpus().length : 4;
    const threadCount = Math.max(2, Math.min(12, Math.floor(cpuCount)));
    const args = [
      '--host', '127.0.0.1',
      '--port', String(port),
      '-m', modelPath,
      '-c', '4096',
      '-t', String(threadCount),
      '-ngl', '0' // CPU execution: zero GPU offload layers, purely host CPU
    ];

    const projectorPath = this.findProjectorPath();
    if (projectorPath) {
      this._projectorPath = projectorPath;
      args.push('--mmproj', projectorPath);
    }

    this._process = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stderrBuffer = '';
    if (this._process.stderr) {
      this._process.stderr.on('data', (chunk) => {
        stderrBuffer = (stderrBuffer + chunk.toString()).slice(-1000);
      });
    }

    this._process.on('exit', (code) => {
      this._isReady = false;
      this._process = null;
      if (code && code !== 0) {
        console.warn(`[llmService] llama-server exited with code ${code}. Stderr: ${stderrBuffer.trim()}`);
      }
    });

    // Wait for health endpoint
    this._isReady = await this._waitForHealth(port, 45000);
    return this._isReady;
  }

  /**
   * Scans project root and models directories for llama-server.exe and GGUF models.
   * Starts server automatically if found.
   */
  async autoDetectAndStart() {
    try {
      // Check if llama-server is already running and responding on this port
      const isAlreadyHealthy = await new Promise((resolve) => {
        const req = http.get({
          hostname: '127.0.0.1',
          port: this._port,
          path: '/health',
          timeout: 800
        }, res => resolve(res.statusCode === 200));
        req.on('error', () => resolve(false));
      });
      if (isAlreadyHealthy) {
        this._isReady = true;
        return true;
      }

      const foundBin = this.findBinaryPath();
      const foundModel = this.findModelPath();

      if (foundBin && foundModel) {
        return await this.startServer(foundBin, foundModel);
      } else {
        console.warn('[llmService] autoDetectAndStart missing files:', { foundBin, foundModel });
      }
    } catch (e) {
      console.warn('[llmService] autoDetectAndStart caught error:', e.message || e);
    }
    return false;
  }

  stopServer() {
    if (this._process) {
      try {
        this._process.kill();
      } catch (e) {}
      this._process = null;
    }
    this._isReady = false;
  }

  isReady() {
    return Boolean(this._isReady);
  }

  /**
   * Strictly extracts metadata (category, person, expiryDate, tags, docType)
   * using local Gemma-4-E2B model when available, falling back to deterministic extraction.
   * Adheres to AGENTS.md:
   * "AI work additionally requires a structured output contract, rejection of invalid output,
   * explicit handling of unknown values, and source references when it presents document-derived claims."
   * Category is strictly enforced to: identity, insurance, medical, tax, property, other.
   * Expiry date is strictly validated and grounded in document text.
   * Person is matched against known family members or validated individual name.
   */
  async extractDocumentMetadata({ text, fileName = '', knownPersons = [] }) {
    // 1. Run deterministic baseline extraction
    const deterministic = extractionService.analyzeDocumentText(text, fileName, { knownPersons });

    // 2. If local AI server is not ready or text is empty, return deterministic analysis
    if (!this._isReady || !text || !text.trim()) {
      return {
        ...deterministic,
        method: 'deterministic'
      };
    }

    // 3. Local neural extraction via llama-server
    try {
      const prompt = this._buildExtractionPrompt(text, fileName, knownPersons);
      const rawAiResponse = await this._queryLlamaServer(prompt);
      const validatedAi = parseAndValidateAiMetadata(rawAiResponse, text, fileName, knownPersons);

      if (!validatedAi) {
        return {
          ...deterministic,
          method: 'deterministic'
        };
      }

      // Merge AI extraction with deterministic validation
      // STRICT RULE: If an unmatched person is detected or if AI produced an invalid or unsupported category
      const isUnmatched = Boolean(validatedAi.unmatchedPerson && !validatedAi.person) || Boolean(deterministic.unmatchedPerson && !deterministic.person);
      const unmatchedPerson = validatedAi.unmatchedPerson || deterministic.unmatchedPerson || null;
      const category = isUnmatched ? 'other' : (validatedAi.category || deterministic.category);
      const docType = isUnmatched ? 'other' : (validatedAi.docType || deterministic.docType);
      const person = isUnmatched ? null : (validatedAi.person || (deterministic.unmatchedPerson ? null : deterministic.person));
      const expiryDate = validatedAi.expiryDate || deterministic.expiryDate;
      const expirySnippet = validatedAi.expirySnippet || deterministic.expirySnippet;
      const issueDate = validatedAi.issueDate || deterministic.issueDate;
      const issueSnippet = validatedAi.issueSnippet || deterministic.issueSnippet;
      const issuer = validatedAi.issuer || deterministic.issuer;

      // Merge and deduplicate tags
      const combinedTags = [...new Set([...(validatedAi.tags || []), ...(deterministic.tags || [])])].slice(0, 8);

      // Generate suggested human-readable title
      const suggestedTitle = extractionService.suggestDocumentTitle(
        fileName,
        category,
        docType,
        person,
        issuer,
        issueDate,
        expiryDate
      );

      // Build provenance summary
      const noteParts = [];
      if (expiryDate) noteParts.push(`Expiry Date: ${expiryDate}`);
      if (issueDate) noteParts.push(`Issue Date: ${issueDate}`);
      if (issuer) noteParts.push(`Issuer: ${issuer}`);
      const notesSummary = noteParts.length > 0 ? noteParts.join('. ') + '.' : '';

      return {
        docType,
        category,
        person,
        unmatchedPerson,
        tags: combinedTags,
        suggestedTitle,
        notesSummary,
        issuer,
        issueDate,
        issueSnippet,
        expiryDate,
        expirySnippet,
        confidence: isUnmatched ? Math.min(validatedAi.confidence, 0.65) : Math.max(validatedAi.confidence, deterministic.confidence),
        reviewStatus: isUnmatched ? 'needs_review' : 'proposed',
        method: 'local-ai-gemma4'
      };
    } catch (err) {
      console.warn('[llmService] AI metadata extraction failed, falling back to deterministic:', err.message || err);
      return {
        ...deterministic,
        method: 'deterministic'
      };
    }
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
    const rawTerms = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    // Travel & document synonym expansion for enhanced retrieval recall
    const SYNONYM_MAP = {
      schedule: ['timing', 'departure', 'arrival', 'time', 'train', 'flight', 'ticket', 'date'],
      timing: ['schedule', 'time', 'departure', 'arrival', 'train', 'flight'],
      time: ['timing', 'schedule', 'departure', 'arrival', 'hours'],
      train: ['express', 'railway', 'irctc', 'pnr', 'ticket', 'berth', 'station', 'bogey', 'coach'],
      ticket: ['pnr', 'booking', 'train', 'flight', 'reservation', 'boarding'],
      flight: ['airline', 'ticket', 'departure', 'arrival', 'airport'],
      when: ['date', 'time', 'timing', 'schedule', 'departure', 'expiry', 'validity'],
      where: ['station', 'city', 'address', 'location', 'airport', 'terminal'],
      cost: ['fare', 'price', 'amount', 'total', 'fee', 'charge'],
      fee: ['fare', 'price', 'amount', 'cost', 'total'],
      fare: ['fee', 'price', 'cost', 'amount', 'total', 'ticket']
    };

    const expandedTerms = new Set(rawTerms);
    for (const term of rawTerms) {
      if (SYNONYM_MAP[term]) {
        for (const syn of SYNONYM_MAP[term]) {
          expandedTerms.add(syn);
        }
      }
    }
    const searchTerms = [...expandedTerms];

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

      // Check if document title, filename, or person matches raw query terms
      const docName = `${title} ${doc.currentVersion?.fileName || ''} ${doc.person || ''}`.toLowerCase();
      let docTitleBonus = 0;
      for (const term of rawTerms) {
        if (docName.includes(term)) {
          docTitleBonus += 15;
        }
      }

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
        const trimmedText = text.trim();
        // If document is concise (tickets, invoices, IDs, certificates <= 2500 chars),
        // keep the entire document intact as a primary context block
        if (trimmedText.length <= 2500) {
          passages.push(trimmedText);
        }

        // Sliding overlapping window chunking (window size 800, overlap 150)
        let start = 0;
        const maxChunkLen = 800;
        const overlap = 150;
        while (start < trimmedText.length) {
          let end = start + maxChunkLen;
          if (end >= trimmedText.length) {
            const lastChunk = trimmedText.substring(start).trim();
            if (lastChunk && !passages.includes(lastChunk)) passages.push(lastChunk);
            break;
          }
          let breakPoint = trimmedText.lastIndexOf('\n', end);
          if (breakPoint <= start + (maxChunkLen * 0.5)) {
            breakPoint = trimmedText.lastIndexOf(' ', end);
          }
          if (breakPoint <= start + (maxChunkLen * 0.5)) {
            breakPoint = end;
          }

          const chunk = trimmedText.substring(start, breakPoint).trim();
          if (chunk && !passages.includes(chunk)) {
            passages.push(chunk);
          }
          start = Math.max(breakPoint - overlap, start + 1);
        }
      }

      for (const p of passages) {
        let distinctRawMatches = 0;
        let distinctExpandedMatches = 0;
        let totalMatches = 0;
        const lowerP = p.toLowerCase();

        for (const term of rawTerms) {
          const regex = new RegExp(`\\b${term}\\b`, 'i');
          if (regex.test(p)) {
            distinctRawMatches += 1;
            totalMatches += 1;
          } else if (lowerP.includes(term)) {
            totalMatches += 0.5;
          }
        }

        for (const term of searchTerms) {
          if (!rawTerms.includes(term)) {
            const regex = new RegExp(`\\b${term}\\b`, 'i');
            if (regex.test(p)) {
              distinctExpandedMatches += 1;
              totalMatches += 0.5;
            }
          }
        }

        const totalRelevance = (distinctRawMatches * 15) + (distinctExpandedMatches * 5) + (totalMatches * 2) + docTitleBonus;
        if (totalRelevance > 0) {
          scoredSegments.push({
            documentId: doc.id,
            documentTitle: title || doc.currentVersion?.fileName || 'Document',
            fileName: doc.currentVersion?.fileName || 'document',
            category: doc.category,
            snippet: p,
            score: totalRelevance
          });
        }
      }
    }

    // Deduplicate passages by documentId + snippet, retaining highest score
    const segmentMap = new Map();
    for (const seg of scoredSegments) {
      const key = `${seg.documentId}::${seg.snippet}`;
      if (!segmentMap.has(key) || segmentMap.get(key).score < seg.score) {
        segmentMap.set(key, seg);
      }
    }

    const uniqueSegments = Array.from(segmentMap.values());
    uniqueSegments.sort((a, b) => b.score - a.score);

    // Prune redundant sub-snippets from the same document
    const nonRedundant = [];
    for (const seg of uniqueSegments) {
      const isSub = nonRedundant.some(existing => 
        existing.documentId === seg.documentId && existing.snippet.includes(seg.snippet)
      );
      if (!isSub) {
        nonRedundant.push(seg);
      }
    }

    const topSegments = nonRedundant.slice(0, 3);

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
        console.warn('[llmService] Llama server query error:', err.message || err);
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
    return `<start_of_turn>user
You are FamilyVault's private offline document assistant. Answer the user's question directly, accurately, and concisely using the provided document sources.
- Synthesize facts across the sources, including document titles, passenger or person names, dates, times, train or flight names, stations, and reference numbers.
- The sources may contain OCR text with minor scanning typos (e.g., "5ept" for "Sept", "Arial" for "Arrival", "Departure* 23:23"). Accurately interpret these travel details.
- When asked about a specific person (e.g., "shubham"), check the document titles and passenger sections to find the relevant ticket or document.
- State the exact facts (times, dates, train/flight names, locations) found in the sources.
- If and only if the sources genuinely contain no relevant information to answer the question, say "I could not find information regarding this in your stored documents."
- Always cite the document title.

Sources:
${context}

Question: ${query}<end_of_turn>
<start_of_turn>model
`;
  }

  _buildExtractionPrompt(text, fileName, knownPersons = []) {
    const truncatedText = (text || '').slice(0, 3500).trim();
    const hasKnown = Array.isArray(knownPersons) && knownPersons.length > 0;
    const knownPersonsHint = hasKnown
      ? `Existing family members in vault: ${knownPersons.map(p => `"${p}"`).join(', ')}.
CRITICAL USER CATEGORIZATION RULES:
- If this document belongs to one of these known family members, match and output their exact name in "person".
- If this document belongs to a person NOT in the above list, you MUST set "person": null and set "unmatchedPerson": "<detected person name>".
- If "unmatchedPerson" is set (unmatched user), you MUST set "category": "other" and "docType": "other" so the user can review and add the new member.\n`
      : `Vault has NO added family members yet.
CRITICAL USER CATEGORIZATION RULES:
- If any person name is found in the document, you MUST set "person": null and set "unmatchedPerson": "<detected person name>".
- You MUST set "category": "other" and "docType": "other" so the user can review and add the new member.\n`;

    return `<start_of_turn>user
You are a strict offline document analysis AI for FamilyVault. Extract metadata from the document text and filename.

STRICT CONSTRAINTS & REQUIREMENTS:
1. You MUST respond with ONLY a single valid JSON object. Do not include markdown code block fences (\`\`\`), conversational preamble, or explanations.
2. The "category" field MUST be EXACTLY one of: "identity", "insurance", "medical", "tax", "property", "other". Be strict; if uncertain or unmatched person, output "other".
3. The "docType" field MUST be EXACTLY one of: "passport", "driving_license", "identity_card", "insurance_policy", "tax_document", "medical_record", "property_document", "other".
4. "person": The primary person, family member, policyholder, patient, or cardholder named on this document.
${knownPersonsHint}
5. "unmatchedPerson": String name of detected individual if not in the known members list, or null.
6. "expiryDate": The official expiration date, validity end date, or renewal deadline formatted strictly as "YYYY-MM-DD". If there is no expiration date in the document, set to null.
7. "expirySnippet": The exact short text snippet from the document where the expiration date was found, or null.
8. "issueDate": The issuance, effective, or start date formatted as "YYYY-MM-DD", or null.
9. "issuer": The organization, agency, hospital, or company that issued the document, or null.
10. "tags": An array of 1 to 5 short keyword strings describing the document (e.g. ["health", "policy", "dental"]).
11. "confidence": A float between 0.0 and 1.0 indicating confidence.

Filename: ${fileName}
Document Text:
${truncatedText}<end_of_turn>
<start_of_turn>model
`;
  }

  async _queryLlamaServer(prompt) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        prompt,
        temperature: 0.0,
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
        timeout: 60000
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

  /**
   * Processes a document image buffer using Gemma-4-E2B multimodal vision capabilities.
   * Extracts text, tabular layout, and word-level coordinates: { text, x, y, width, height, confidence }
   * Returns: { text: string, ocrWords: Array<object>, method: 'multimodal-gemma4-vision' }
   * Throws on failure so caller gracefully falls back to local Tesseract.js.
   */
  async processImageWithVision({ imageBuffer, mimeType = 'image/png', prompt }) {
    if (!this._isReady) {
      throw new Error('Local Gemma-4-E2B neural engine is not running');
    }
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error('Invalid or empty image buffer');
    }

    const base64Data = imageBuffer.toString('base64');
    const systemPrompt = prompt || `You are an expert offline multimodal OCR and document understanding model.
Examine this document image closely.
Extract all visible text in logical reading order, preserving tabular alignments, columns, numbers, and dates.
Output a JSON object with:
{
  "fullText": "extracted document text preserving layout",
  "words": [
    { "text": "word", "x": 10, "y": 20, "width": 40, "height": 15, "confidence": 95 }
  ]
}
If exact bounding boxes are not measurable, return { "fullText": "..." }. Respond ONLY with JSON.`;

    const requestPayload = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 2048
    };

    let rawContent = '';
    try {
      rawContent = await this._queryLlamaChat(requestPayload);
    } catch (chatErr) {
      // Fallback: try raw completion with image_data payload
      const completionPayload = {
        prompt: `<start_of_turn>user\n${systemPrompt}<end_of_turn>\n<start_of_turn>model\n`,
        image_data: [{ data: base64Data, id: 1 }],
        temperature: 0.1,
        n_predict: 2048
      };
      rawContent = await this._queryLlamaCompletion(completionPayload);
    }

    if (!rawContent || !rawContent.trim()) {
      throw new Error('Empty response from multimodal vision inference');
    }

    const parsedJson = extractJsonFromText(rawContent);
    let extractedText = '';
    let ocrWords = [];

    if (parsedJson && typeof parsedJson === 'object') {
      if (typeof parsedJson.fullText === 'string') {
        extractedText = parsedJson.fullText.trim();
      } else if (typeof parsedJson.text === 'string') {
        extractedText = parsedJson.text.trim();
      }

      if (Array.isArray(parsedJson.words)) {
        ocrWords = parsedJson.words
          .filter(w => w && typeof w.text === 'string' && w.text.trim())
          .map(w => ({
            text: w.text.trim(),
            x: Math.max(0, Math.round(Number(w.x) || 0)),
            y: Math.max(0, Math.round(Number(w.y) || 0)),
            width: Math.max(0, Math.round(Number(w.width) || 0)),
            height: Math.max(0, Math.round(Number(w.height) || 0)),
            confidence: Math.max(0, Math.min(100, Math.round(Number(w.confidence) || 90)))
          }));
      }
    }

    if (!extractedText && !ocrWords.length) {
      extractedText = rawContent
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```/g, '')
        .trim();
    }

    if (!extractedText && !ocrWords.length) {
      throw new Error('No readable text extracted by multimodal model');
    }

    if (ocrWords.length > 0) {
      const structured = extractionService.reconstructStructuredTableLayout(ocrWords);
      if (structured.structuredText && structured.structuredText.length >= extractedText.length) {
        extractedText = structured.structuredText;
      }
    }

    return {
      text: extractedText,
      ocrWords,
      method: 'multimodal-gemma4-vision'
    };
  }

  async _queryLlamaChat(payload) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const req = http.request({
        hostname: '127.0.0.1',
        port: this._port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 45000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              return reject(new Error(`Chat completion returned status ${res.statusCode}: ${body}`));
            }
            const parsed = JSON.parse(body);
            const content = parsed.choices?.[0]?.message?.content || '';
            resolve(content);
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Multimodal chat request timed out'));
      });

      req.write(data);
      req.end();
    });
  }

  async _queryLlamaCompletion(payload) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const req = http.request({
        hostname: '127.0.0.1',
        port: this._port,
        path: '/completion',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 45000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              return reject(new Error(`Completion returned status ${res.statusCode}: ${body}`));
            }
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
        reject(new Error('Completion request timed out'));
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
  llmService,
  parseAndValidateAiMetadata,
  VALID_CATEGORIES,
  VALID_DOC_TYPES
};
