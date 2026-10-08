'use strict';

/**
 * Vault Service orchestrating the vault lifecycle, key management,
 * encrypted storage, and document versioning.
 * Strictly adheres to ARCHITECTURE.md, SECURITY.md, and PRODUCT_REQUIREMENTS.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');

const { deriveKek, DEFAULT_ARGON2_PARAMS } = require('../crypto/kdf');
const { wrapKey, unwrapKey } = require('../crypto/cipher');
const { generateVmk, deriveSubkeys, zeroizeBuffer } = require('../crypto/keys');
const { createManifest, readManifest, writeManifest } = require('./manifest');
const { storeObject, readObject, ensureObjectsDir } = require('./objectStore');
const extractionService = require('../services/extractionService');
const { llmService, resolvePersonScope } = require('../services/llmService');
const { createVaultBackup, restoreVaultBackup } = require('./backupService');
const dbLayer = require('./database');
const { embeddingService } = require('../services/embeddingService');

const SUPPORTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp'];

class VaultService {
  constructor(customLlmService = null) {
    this._activeVaultPath = null;
    this._activeManifest = null;
    this._vmk = null;
    this._kek = null;
    this._dbKey = null;
    this._objectKey = null;
    this._db = null;
    this._llmService = customLlmService || llmService;
    this._profileEventListener = null;
  }

  setProfileEventListener(listener) {
    this._profileEventListener = typeof listener === 'function' ? listener : null;
  }

  emitProfileEvent(event, data) {
    if (typeof this._profileEventListener === 'function') {
      try {
        this._profileEventListener(event, data);
      } catch (e) {}
    }
  }

  isUnlocked() {
    return this._db !== null && this._vmk !== null;
  }

  getStatus() {
    return {
      isUnlocked: this.isUnlocked(),
      vaultPath: this._activeVaultPath,
      vaultId: this._activeManifest ? this._activeManifest.vaultId : null
    };
  }

  _assertUnlocked() {
    if (!this.isUnlocked()) {
      throw new Error('Vault is locked. Unlock the vault to perform this action.');
    }
  }

  /**
   * Creates a new encrypted vault at vaultPath.
   */
  async createVault({ vaultPath, password, kdfParams = {} }) {
    if (this.isUnlocked()) {
      this.lockVault();
    }

    if (!vaultPath || typeof vaultPath !== 'string') {
      throw new Error('Invalid vault path');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Ensure directory exists
    if (!fs.existsSync(vaultPath)) {
      fs.mkdirSync(vaultPath, { recursive: true });
    } else {
      const contents = fs.readdirSync(vaultPath);
      if (contents.length > 0) {
        throw new Error('Target vault directory must be empty');
      }
    }

    // 1. Generate VMK and KDF salt
    const vaultId = uuidv4();
    const vmk = generateVmk();
    const salt = crypto.randomBytes(16);

    const mergedKdfParams = {
      ...DEFAULT_ARGON2_PARAMS,
      ...kdfParams
    };

    // 2. Derive KEK via Argon2id
    const kek = await deriveKek(password, salt, mergedKdfParams);

    // 3. Wrap VMK with AES-256-GCM
    const wrapData = wrapKey(vmk, kek);

    // 4. Create and write manifest.json
    const manifest = createManifest({
      vaultId,
      kdfParams: mergedKdfParams,
      salt,
      wrapData
    });
    writeManifest(vaultPath, manifest);

    // 5. Ensure objects/ and derived/ directories
    ensureObjectsDir(vaultPath);
    const derivedDir = path.join(vaultPath, 'derived');
    if (!fs.existsSync(derivedDir)) {
      fs.mkdirSync(derivedDir, { recursive: true });
    }

    // 6. Derive DB and Object keys via HKDF-SHA256
    const { dbKey, objectKey } = deriveSubkeys(vmk, vaultId);

    // 7. Initialize encrypted database
    const dbPath = path.join(vaultPath, dbLayer.DB_FILE_NAME);
    const db = dbLayer.openVaultDatabase(dbPath, dbKey);
    dbLayer.recordAuditEvent(db, 'VAULT_CREATED', { vaultId, createdAt: manifest.createdAt });

    // 8. Set active state
    this._activeVaultPath = vaultPath;
    this._activeManifest = manifest;
    this._vmk = vmk;
    this._kek = kek;
    this._dbKey = dbKey;
    this._objectKey = objectKey;
    this._db = db;

    return {
      vaultId,
      vaultPath,
      createdAt: manifest.createdAt
    };
  }

  /**
   * Unlocks an existing vault with password.
   */
  async unlockVault({ vaultPath, password }) {
    if (this.isUnlocked()) {
      this.lockVault();
    }

    if (!vaultPath || !fs.existsSync(vaultPath)) {
      throw new Error(`Vault directory does not exist: ${vaultPath}`);
    }

    // 1. Read and validate manifest
    const manifest = readManifest(vaultPath);

    // 2. Derive KEK from password using manifest KDF params
    const salt = Buffer.from(manifest.kdf.params.salt, 'base64');
    const kek = await deriveKek(password, salt, manifest.kdf.params);

    // 3. Authenticate and unwrap VMK
    const wrapData = {
      iv: Buffer.from(manifest.keyWrap.iv, 'base64'),
      authTag: Buffer.from(manifest.keyWrap.authTag, 'base64'),
      wrappedKey: Buffer.from(manifest.keyWrap.wrappedVmk, 'base64')
    };

    let vmk;
    try {
      vmk = unwrapKey(wrapData, kek);
    } catch (err) {
      zeroizeBuffer(kek);
      throw new Error('Incorrect password or vault data has been tampered with');
    }

    // 4. Derive subkeys
    const { dbKey, objectKey } = deriveSubkeys(vmk, manifest.vaultId);

    // 5. Open encrypted SQLCipher database
    const dbPath = path.join(vaultPath, dbLayer.DB_FILE_NAME);
    let db;
    try {
      db = dbLayer.openVaultDatabase(dbPath, dbKey);
    } catch (err) {
      zeroizeBuffer(vmk);
      zeroizeBuffer(kek);
      zeroizeBuffer(dbKey);
      zeroizeBuffer(objectKey);
      throw new Error(`Failed to decrypt vault database: ${err.message}`);
    }

    // 6. Ensure objects directory exists
    ensureObjectsDir(vaultPath);

    dbLayer.recordAuditEvent(db, 'VAULT_UNLOCKED', { timestamp: new Date().toISOString() });

    // 7. Set active state
    this._activeVaultPath = vaultPath;
    this._activeManifest = manifest;
    this._vmk = vmk;
    this._kek = kek;
    this._dbKey = dbKey;
    this._objectKey = objectKey;
    this._db = db;

    return {
      vaultId: manifest.vaultId,
      vaultPath,
      formatVersion: manifest.formatVersion,
      createdAt: manifest.createdAt
    };
  }

  /**
   * Locks the vault and securely zeroes all key material.
   */
  lockVault() {
    if (this._db) {
      try {
        dbLayer.recordAuditEvent(this._db, 'VAULT_LOCKED', { timestamp: new Date().toISOString() });
        this._db.close();
      } catch (err) {
        // ignore close error
      }
      this._db = null;
    }

    if (this._vmk) zeroizeBuffer(this._vmk);
    if (this._kek) zeroizeBuffer(this._kek);
    if (this._dbKey) zeroizeBuffer(this._dbKey);
    if (this._objectKey) zeroizeBuffer(this._objectKey);

    this._vmk = null;
    this._kek = null;
    this._dbKey = null;
    this._objectKey = null;
    this._activeVaultPath = null;
    this._activeManifest = null;

    return { locked: true };
  }

  /**
   * Changes the vault password without re-encrypting any stored document objects.
   */
  async changePassword({ oldPassword, newPassword, kdfParams = {} }) {
    this._assertUnlocked();

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long');
    }

    // Re-verify old password
    const currentSalt = Buffer.from(this._activeManifest.kdf.params.salt, 'base64');
    const testKek = await deriveKek(oldPassword, currentSalt, this._activeManifest.kdf.params);

    const currentWrapData = {
      iv: Buffer.from(this._activeManifest.keyWrap.iv, 'base64'),
      authTag: Buffer.from(this._activeManifest.keyWrap.authTag, 'base64'),
      wrappedKey: Buffer.from(this._activeManifest.keyWrap.wrappedVmk, 'base64')
    };

    try {
      const verified = unwrapKey(currentWrapData, testKek);
      zeroizeBuffer(verified);
      zeroizeBuffer(testKek);
    } catch (e) {
      zeroizeBuffer(testKek);
      throw new Error('Current password verification failed');
    }

    // Derive new KEK with fresh random salt
    const newSalt = crypto.randomBytes(16);
    const mergedParams = {
      ...DEFAULT_ARGON2_PARAMS,
      ...kdfParams
    };
    const newKek = await deriveKek(newPassword, newSalt, mergedParams);

    // Re-wrap the existing VMK
    const newWrapData = wrapKey(this._vmk, newKek);

    // Update manifest
    const updatedManifest = {
      ...this._activeManifest,
      updatedAt: new Date().toISOString(),
      kdf: {
        algorithm: 'argon2id',
        params: {
          memoryCost: mergedParams.memoryCost,
          timeCost: mergedParams.timeCost,
          parallelism: mergedParams.parallelism,
          salt: newSalt.toString('base64')
        }
      },
      keyWrap: {
        algorithm: 'aes-256-gcm',
        iv: newWrapData.iv.toString('base64'),
        authTag: newWrapData.authTag.toString('base64'),
        wrappedVmk: newWrapData.wrappedKey.toString('base64')
      }
    };

    writeManifest(this._activeVaultPath, updatedManifest);
    this._activeManifest = updatedManifest;

    zeroizeBuffer(this._kek);
    this._kek = newKek;

    dbLayer.recordAuditEvent(this._db, 'PASSWORD_CHANGED', { timestamp: new Date().toISOString() });

    return { success: true };
  }

  /**
   * Imports a document file, creates Document record and immutable Version 1.
   */
  async importDocument({
    filePath,
    title,
    category = 'other',
    person = null,
    tags = [],
    notes = '',
    preExtractedText = null,
    preExtractedOcrWords = null,
    preAnalyzedMetadata = null,
    asyncProfile = false
  }) {
    this._assertUnlocked();

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Source file does not exist: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }

    const fileName = path.basename(filePath);
    const plaintextBuffer = fs.readFileSync(filePath);
    const mimeType = this._guessMimeType(ext);

    // 1. Encrypt and store original as an immutable object
    const { objectId, sha256, byteLength } = storeObject(
      this._activeVaultPath,
      this._objectKey,
      plaintextBuffer
    );

    // 2. Insert document record
    const docTitle = title && title.trim() ? title.trim() : path.parse(fileName).name;
    const doc = dbLayer.createDocument(this._db, {
      title: docTitle,
      category,
      person,
      tags,
      notes
    });

    // 3. Insert immutable Version 1
    const version = dbLayer.createDocumentVersion(this._db, {
      documentId: doc.id,
      versionNumber: 1,
      objectId,
      sha256,
      fileName,
      fileSize: byteLength,
      mimeType,
      notes: 'Initial version'
    });

    dbLayer.recordAuditEvent(this._db, 'DOCUMENT_IMPORTED', {
      documentId: doc.id,
      versionId: version.id,
      fileName,
      sha256
    });

    // 4. Extract text and analyze metadata locally (reuse pre-extracted data if provided)
    try {
      let text = (typeof preExtractedText === 'string') ? preExtractedText : null;
      let ocrWords = Array.isArray(preExtractedOcrWords) ? preExtractedOcrWords : [];

      if (!text) {
        const extracted = await extractionService.extractTextFromBuffer(plaintextBuffer, mimeType);
        text = extracted.text || '';
        ocrWords = extracted.ocrWords || [];
      }

      if (text) {
        const knownPersons = dbLayer.listDistinctPersons(this._db);
        let analysis = (preAnalyzedMetadata && (preAnalyzedMetadata.docType || preAnalyzedMetadata.category))
          ? preAnalyzedMetadata
          : null;

        if (!analysis) {
          if (this._llmService && typeof this._llmService.extractDocumentMetadata === 'function') {
            analysis = await this._llmService.extractDocumentMetadata({
              text,
              fileName,
              knownPersons,
              strictToAddedUsers: true
            });
          } else {
            analysis = extractionService.analyzeDocumentText(text, fileName, { knownPersons, strictToAddedUsers: true });
          }
        }

        // STRICT CATEGORIZATION & PERSON MATCHING:
        // If unmatched person is detected, category stays 'other' for review and no rogue person is auto-assigned
        if (category === 'other' && analysis.category && analysis.category !== 'other' && !analysis.unmatchedPerson) {
          this._db.prepare('UPDATE documents SET category = ? WHERE id = ?').run(analysis.category, doc.id);
          doc.category = analysis.category;
        }

        // If title was not provided by user, auto-assign AI generated title
        const rawFileNameNoExt = path.parse(fileName).name;
        if ((!title || title.trim() === rawFileNameNoExt) && (analysis.suggestedTitle || analysis.title)) {
          const aiTitle = (analysis.suggestedTitle || analysis.title).trim();
          this._db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(aiTitle, doc.id);
          doc.title = aiTitle;
        }

        // Only auto-assign person if matched to an existing added family member
        const effectivePerson = person || (analysis.person && !analysis.unmatchedPerson ? analysis.person : null);
        if (!person && analysis.person && !analysis.unmatchedPerson) {
          const isKnown = knownPersons.some(kp => kp.toLowerCase() === analysis.person.toLowerCase());
          if (isKnown) {
            this._db.prepare('UPDATE documents SET person = ? WHERE id = ?').run(analysis.person, doc.id);
            doc.person = analysis.person;
          }
        }

        // If tags were not explicitly provided, auto-assign generated tags
        if ((!tags || (Array.isArray(tags) && tags.length === 0)) && Array.isArray(analysis.tags) && analysis.tags.length > 0) {
          this._db.prepare('UPDATE documents SET tags = ? WHERE id = ?').run(JSON.stringify(analysis.tags), doc.id);
          doc.tags = analysis.tags;
        }

        // If notes were not explicitly provided, auto-assign notes summary
        if ((!notes || !notes.trim()) && analysis.notesSummary) {
          this._db.prepare('UPDATE documents SET notes = ? WHERE id = ?').run(analysis.notesSummary, doc.id);
          doc.notes = analysis.notesSummary;
        }

        dbLayer.saveMetadata(this._db, {
          versionId: version.id,
          docType: analysis.docType,
          issuer: analysis.issuer,
          issueDate: analysis.issueDate,
          expiryDate: analysis.expiryDate,
          expirySnippet: analysis.expirySnippet,
          issueSnippet: analysis.issueSnippet,
          confidence: analysis.confidence,
          reviewStatus: analysis.reviewStatus,
          textContent: text,
          rawPayload: {
            ocrWords,
            method: analysis.method || 'ocr-tesseract',
            unmatchedPerson: analysis.unmatchedPerson || null
          }
        });

        // Post-save background profile information schema processing & fluid UI notification
        if (effectivePerson) {
          const profileTask = this._processDocumentProfileBackground({
            docId: doc.id,
            versionId: version.id,
            text,
            person: effectivePerson,
            isAsync: Boolean(asyncProfile)
          });

          if (asyncProfile) {
            profileTask.catch(err => {
              console.warn('[vaultService] Background profile extraction caught error:', err.message);
            });
          } else {
            try {
              await profileTask;
            } catch (profileErr) {
              // Profile extraction failure should never abort import
            }
          }
        }

        // Generate and store vector embeddings for semantic search
        try {
          const chunks = embeddingService.chunkText(text);
          if (chunks.length > 0) {
            const chunkEmbeddings = [];
            for (let i = 0; i < chunks.length; i++) {
              const vector = await embeddingService.generateEmbedding(chunks[i]);
              chunkEmbeddings.push({
                chunkIndex: i,
                chunkText: chunks[i],
                vector
              });
            }
            dbLayer.saveVectorEmbeddings(this._db, version.id, doc.id, chunkEmbeddings);
          }
        } catch (embErr) {
          // Embedding generation failure should never abort import
        }
      }
    } catch (e) {
      // extraction failure should never abort import
    }

    return dbLayer.getDocumentById(this._db, doc.id);
  }

  /**
   * Adds an immutable newer version to an existing document.
   * Adheres to PROJECT.md: "Keep history. Documents have immutable versions; importing an updated copy
   * creates a new version rather than replacing history."
   */
  async addDocumentVersion({ documentId, filePath, notes = '' }) {
    this._assertUnlocked();

    const doc = dbLayer.getDocumentById(this._db, documentId);
    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Source file does not exist: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    const fileName = path.basename(filePath);
    const plaintextBuffer = fs.readFileSync(filePath);
    const mimeType = this._guessMimeType(ext);

    // 1. Encrypt and store new object
    const { objectId, sha256, byteLength } = storeObject(
      this._activeVaultPath,
      this._objectKey,
      plaintextBuffer
    );

    // 2. Create new immutable version record
    const version = dbLayer.createDocumentVersion(this._db, {
      documentId,
      objectId,
      sha256,
      fileName,
      fileSize: byteLength,
      mimeType,
      notes
    });

    dbLayer.recordAuditEvent(this._db, 'VERSION_ADDED', {
      documentId,
      versionId: version.id,
      versionNumber: version.version_number,
      fileName,
      sha256
    });

    // 3. Extract text and analyze metadata
    try {
      const { text, ocrWords = [] } = await extractionService.extractTextFromBuffer(plaintextBuffer, mimeType);
      if (text) {
        const analysis = extractionService.analyzeDocumentText(text, fileName);
        dbLayer.saveMetadata(this._db, {
          versionId: version.id,
          docType: analysis.docType,
          issuer: analysis.issuer,
          issueDate: analysis.issueDate,
          expiryDate: analysis.expiryDate,
          expirySnippet: analysis.expirySnippet,
          issueSnippet: analysis.issueSnippet,
          confidence: analysis.confidence,
          reviewStatus: analysis.reviewStatus,
          textContent: text,
          rawPayload: {
            ocrWords,
            method: 'ocr-tesseract'
          }
        });

        // Generate and store vector embeddings for semantic search
        try {
          const chunks = embeddingService.chunkText(text);
          if (chunks.length > 0) {
            const chunkEmbeddings = [];
            for (let i = 0; i < chunks.length; i++) {
              const vector = await embeddingService.generateEmbedding(chunks[i]);
              chunkEmbeddings.push({
                chunkIndex: i,
                chunkText: chunks[i],
                vector
              });
            }
            dbLayer.saveVectorEmbeddings(this._db, version.id, documentId, chunkEmbeddings);
          }
        } catch (embErr) {
          // Non-blocking
        }
      }
    } catch (e) {}

    return dbLayer.getDocumentById(this._db, documentId);
  }

  /**
   * Retrieves a document by ID with current version and all version history.
   */
  getDocument(documentId) {
    this._assertUnlocked();
    const doc = dbLayer.getDocumentById(this._db, documentId);
    if (!doc) return null;

    const versions = dbLayer.getDocumentVersions(this._db, documentId);
    return {
      ...doc,
      versions
    };
  }

  /**
   * Updates document-level metadata fields (title, person, category, tags, notes).
   * Adheres to PRODUCT_REQUIREMENTS.md §3: "The user can review and correct extracted metadata."
   */
  updateDocumentMetadata({ documentId, title, person, category, tags, notes }) {
    this._assertUnlocked();

    if (!documentId) {
      throw new Error('documentId is required');
    }

    const doc = dbLayer.getDocumentById(this._db, documentId);
    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const updatedDoc = dbLayer.updateDocumentFields(this._db, documentId, {
      title, person, category, tags, notes
    });

    dbLayer.recordAuditEvent(this._db, 'DOCUMENT_METADATA_UPDATED', {
      documentId,
      changedFields: {
        ...(title !== undefined && { title }),
        ...(person !== undefined && { person }),
        ...(category !== undefined && { category }),
        ...(tags !== undefined && { tags }),
        ...(notes !== undefined && { notes })
      }
    });

    return updatedDoc;
  }

  /**
   * Soft-deletes a document and records an immutable audit log event.
   * Preserves immutable versions and encrypted objects on disk.
   */
  deleteDocument(documentId) {
    this._assertUnlocked();
    if (!documentId) throw new Error('documentId is required');

    const doc = dbLayer.getDocumentById(this._db, documentId);
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    return dbLayer.deleteDocument(this._db, documentId, {
      documentId,
      title: doc.title,
      category: doc.category,
      person: doc.person,
      deletedAt: new Date().toISOString()
    });
  }

  /**
   * Lists documents with optional filters and search.
   */
  listDocuments(filters = {}) {
    this._assertUnlocked();
    return dbLayer.listDocuments(this._db, filters);
  }

  /**
   * Lists all documents that have upcoming expiries or are expired.
   */
  listUpcomingExpiries() {
    this._assertUnlocked();
    return dbLayer.listUpcomingExpiries(this._db);
  }

  /**
   * Retrieves unique family members (persons) recorded across vault documents.
   * @returns {Array<string>}
   */
  listFamilyMembers() {
    this._assertUnlocked();
    return dbLayer.listDistinctPersons(this._db);
  }

  /**
   * Extracts text, runs OCR, and pre-analyzes document metadata (category, person, tags, suggested title).
   * Used for responsive live autofill in the Import Document modal with user-editable review.
   * @param {string} filePath
   * @returns {Promise<object>}
   */
  async preAnalyzeDocument(filePath) {
    this._assertUnlocked();

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Source file does not exist: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }

    const fileName = path.basename(filePath);
    const plaintextBuffer = fs.readFileSync(filePath);
    const mimeType = this._guessMimeType(ext);

    // 1. Extract text and OCR coordinates
    const { text, ocrWords = [] } = await extractionService.extractTextFromBuffer(plaintextBuffer, mimeType);

    // 2. Query known family members already recorded in the vault for high-confidence matching
    const knownPersons = dbLayer.listDistinctPersons(this._db);

    // 3. Run AI-powered or deterministic classification, person detection, and auto-tag generation
    let analysis;
    if (this._llmService && typeof this._llmService.extractDocumentMetadata === 'function') {
      analysis = await this._llmService.extractDocumentMetadata({
        text,
        fileName,
        knownPersons,
        strictToAddedUsers: true
      });
    } else {
      analysis = extractionService.analyzeDocumentText(text, fileName, { knownPersons, strictToAddedUsers: true });
    }

    return {
      ...analysis,
      textContent: text,
      ocrWords
    };
  }

  /**
   * Post-save background process applying the profile information schema over scanned OCR text.
   * Emits progress events for real-time UI fluid card animation and updates profile facts & contradictions.
   */
  async _processDocumentProfileBackground({ docId, versionId, text, person, onProgress, isAsync = false }) {
    if (!person || !text || !this.isUnlocked() || !this._db) return;

    try {
      const sleep = (ms) => isAsync ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();

      const notify = (evt) => {
        if (typeof onProgress === 'function') onProgress(evt);
        this.emitProfileEvent(evt.progress === 100 ? 'profile:analysis-completed' : 'profile:analysis-progress', evt);
      };

      notify({ personName: person, documentId: docId, progress: 15, step: 'started' });
      await sleep(220);

      // Step 1: Extract structured profile facts using Information Schema
      const extractedFacts = extractionService.extractProfileFacts(text, person).map(f => ({
        ...f,
        sourceDocumentId: docId,
        sourceVersionId: versionId
      }));

      notify({ personName: person, documentId: docId, progress: 55, step: 'schema_matched' });
      await sleep(260);

      // Step 2: Grounding & anti-hallucination verification against source OCR text
      const groundedFacts = extractedFacts.filter(f => {
        if (!f.fieldValue) return false;
        const textLower = text.toLowerCase();
        const valLower = String(f.fieldValue).toLowerCase();
        if (textLower.includes(valLower)) return true;
        const tokens = valLower.replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/).filter(t => t.length >= 3);
        return tokens.length > 0 && tokens.every(t => textLower.includes(t));
      });

      notify({ personName: person, documentId: docId, progress: 85, step: 'grounding_verified' });
      await sleep(220);

      // Step 3: Batch persist verified facts and upsert user profile
      if (groundedFacts.length > 0) {
        dbLayer.saveProfileFactsBatch(this._db, groundedFacts);
      }
      dbLayer.upsertUserProfile(this._db, { name: person });

      const updatedProfile = dbLayer.getUserProfileWithContradictions(this._db, person);

      notify({
        personName: person,
        documentId: docId,
        progress: 100,
        step: 'completed',
        updatedFields: groundedFacts.map(f => f.fieldName),
        profile: updatedProfile
      });
    } catch (err) {
      console.warn('[vaultService] _processDocumentProfileBackground error:', err.message);
    }
  }

  /**
   * Performs semantic similarity search across embedded text passages.
   * @param {object} options
   * @param {string} options.query
   * @param {number} [options.limit=5]
   * @param {number} [options.minScore=0.05]
   */
  async searchSemantic({ query, limit = 5, minScore = 0.05 }) {
    this._assertUnlocked();
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }
    const queryVector = await embeddingService.generateEmbedding(query.trim());
    return dbLayer.searchVectorEmbeddings(this._db, queryVector, { limit, minScore });
  }

  /**
   * Updates and confirms metadata for a document version.
   */
  updateMetadata({ versionId, docType, issuer, issueDate, expiryDate, reviewStatus = 'confirmed' }) {
    this._assertUnlocked();

    const version = dbLayer.getVersionById(this._db, versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    let rawPayload = null;
    if (version.raw_payload) {
      try {
        rawPayload = JSON.parse(version.raw_payload);
      } catch (e) {}
    }

    dbLayer.saveMetadata(this._db, {
      versionId,
      docType,
      issuer,
      issueDate,
      expiryDate,
      expirySnippet: version.expiry_snippet,
      issueSnippet: version.issue_snippet,
      confidence: 1.0,
      reviewStatus,
      textContent: version.text_content,
      rawPayload
    });

    dbLayer.recordAuditEvent(this._db, 'METADATA_REVIEWED', {
      versionId,
      docType,
      expiryDate,
      reviewStatus
    });

    return dbLayer.getDocumentById(this._db, version.document_id);
  }

  /**
   * Decrypts and exports a specific document version to destinationPath.
   */
  exportDocumentVersion({ versionId, destinationPath }) {
    this._assertUnlocked();

    const version = dbLayer.getVersionById(this._db, versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    const decryptedBuffer = readObject(this._activeVaultPath, this._objectKey, version.object_id);

    // Verify SHA-256 integrity
    const hash = crypto.createHash('sha256').update(decryptedBuffer).digest('hex');
    if (hash !== version.sha256) {
      throw new Error('Integrity check failed: Decrypted object hash does not match version record');
    }

    fs.writeFileSync(destinationPath, decryptedBuffer);
    dbLayer.recordAuditEvent(this._db, 'VERSION_EXPORTED', { versionId, destinationPath });

    return { success: true, destinationPath };
  }

  /**
   * Decrypts a document version in-memory for secure preview in renderer.
   * Does NOT write unencrypted content to persistent application locations.
   */
  getDocumentVersionContent({ versionId }) {
    this._assertUnlocked();

    const version = dbLayer.getVersionById(this._db, versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    const decryptedBuffer = readObject(this._activeVaultPath, this._objectKey, version.object_id);

    // Verify SHA-256 integrity
    const hash = crypto.createHash('sha256').update(decryptedBuffer).digest('hex');
    if (hash !== version.sha256) {
      throw new Error('Integrity check failed: Decrypted object hash does not match version record');
    }

    return {
      versionId: version.id,
      documentId: version.document_id,
      fileName: version.file_name,
      mimeType: version.mime_type,
      fileSize: version.file_size,
      base64Data: decryptedBuffer.toString('base64')
    };
  }

  /**
   * Grounded local Q&A over stored documents with citations.
   */
  async askQuestion(query, options = {}) {
    this._assertUnlocked();
    const searchAllDocuments = options.searchAllDocuments === true;
    const profiles = dbLayer.listUserProfilesWithSummaries(this._db).map(({ name }) => {
      const { profile, contradictions } = dbLayer.getUserProfileWithContradictions(this._db, name);
      return { profile, contradictions };
    });
    const initialDocuments = dbLayer.listDocuments(this._db, {});
    const personScope = searchAllDocuments
      ? { status: 'none' }
      : resolvePersonScope(query, profiles, initialDocuments);
    if (personScope.status === 'not_found') {
      return {
        answer: `"${personScope.personName}" is not in the saved family profiles. Add them to the vault before asking about their documents.`,
        sources: [],
        confidence: 0,
        mode: 'local-extractive',
        hasResults: false,
        personScope: { status: 'not_found', personName: personScope.personName }
      };
    }
    if (personScope.status === 'ambiguous') {
      return {
        answer: `I found multiple family members matching that name: ${personScope.candidates.join(', ')}. Please ask using a more specific name.`,
        sources: [],
        confidence: 0,
        mode: 'local-extractive',
        hasResults: false,
        personScope: { status: 'ambiguous', candidates: personScope.candidates }
      };
    }

    const normalizedPerson = personScope.personName?.toLowerCase();
    const indexedDocuments = personScope.status === 'matched'
      ? initialDocuments.filter(doc => (doc.person || '').trim().toLowerCase() === normalizedPerson)
      : initialDocuments;
    const relevantProfiles = personScope.status === 'matched'
      ? profiles.filter(entry => entry.profile.name.trim().toLowerCase() === normalizedPerson)
      : profiles;

    await this._ensureDocumentsIndexed(indexedDocuments);
    const allDocs = personScope.status === 'matched'
      ? dbLayer.listDocuments(this._db, {}).filter(doc => (doc.person || '').trim().toLowerCase() === normalizedPerson)
      : dbLayer.listDocuments(this._db, {});
    let semanticMatches = [];
    try {
      if (allDocs.length > 0 && query && typeof query === 'string' && query.trim()) {
        const queryVector = await embeddingService.generateEmbedding(query.trim());
        semanticMatches = dbLayer.searchVectorEmbeddings(this._db, queryVector, {
          limit: 5,
          minScore: 0.08,
          personName: personScope.status === 'matched' ? personScope.personName : null
        })
          .filter(match => allDocs.some(doc => doc.id === match.documentId));
      }
    } catch (e) {}
    return await this._llmService.answerQuestion({
      query,
      documents: allDocs,
      semanticMatches,
      profiles: relevantProfiles,
      searchAllDocuments,
      onToken: options.onToken
    });
  }

  /**
   * Auto-indexes or repairs text content for documents that were imported without text.
   */
  async _ensureDocumentsIndexed(documents = null) {
    if (!this._db || !this._activeVaultPath || !this._objectKey) return;
    try {
      const docs = Array.isArray(documents) ? documents : dbLayer.listDocuments(this._db, {});
      for (const doc of docs) {
        const existingText = doc.currentVersion?.metadata?.textContent || '';
        const cleanedExisting = existingText.replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').trim();
        if (doc.currentVersion && (!existingText || cleanedExisting.length < 40)) {
          try {
            const decryptedBuffer = readObject(this._activeVaultPath, this._objectKey, doc.currentVersion.objectId);
            const { text, ocrWords = [] } = await extractionService.extractTextFromBuffer(decryptedBuffer, doc.currentVersion.mimeType);
            if (text && text.trim()) {
              const analysis = extractionService.analyzeDocumentText(text, doc.currentVersion.fileName);
              dbLayer.saveMetadata(this._db, {
                versionId: doc.currentVersion.id,
                docType: analysis.docType || doc.currentVersion.metadata?.docType || 'other',
                issuer: analysis.issuer || doc.currentVersion.metadata?.issuer || null,
                issueDate: analysis.issueDate || doc.currentVersion.metadata?.issueDate || null,
                expiryDate: analysis.expiryDate || doc.currentVersion.metadata?.expiryDate || null,
                expirySnippet: analysis.expirySnippet || doc.currentVersion.metadata?.expirySnippet || null,
                issueSnippet: analysis.issueSnippet || doc.currentVersion.metadata?.issueSnippet || null,
                confidence: analysis.confidence || doc.currentVersion.metadata?.confidence || 0.5,
                reviewStatus: doc.currentVersion.metadata?.reviewStatus || 'proposed',
                textContent: text,
                rawPayload: {
                  ocrWords,
                  method: 'ocr-tesseract'
                }
              });

              // Generate vector embeddings
              try {
                const chunks = embeddingService.chunkText(text);
                const chunkEmbeddings = [];
                for (let i = 0; i < chunks.length; i++) {
                  const vec = await embeddingService.generateEmbedding(chunks[i]);
                  chunkEmbeddings.push({ chunkIndex: i, chunkText: chunks[i], vector: vec });
                }
                dbLayer.saveVectorEmbeddings(this._db, doc.currentVersion.id, doc.id, chunkEmbeddings);
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  /**
   * Retrieves all user/family member profile summaries with contradiction counts.
   */
  listUserProfiles() {
    this._assertUnlocked();
    return dbLayer.listUserProfilesWithSummaries(this._db);
  }

  /**
   * Retrieves a full user profile with atomic extracted facts and contradiction analysis.
   */
  getUserProfile(personName) {
    this._assertUnlocked();
    return dbLayer.getUserProfileWithContradictions(this._db, personName);
  }

  /**
   * Creates or updates a canonical user profile record.
   */
  saveUserProfile(profile) {
    this._assertUnlocked();
    return dbLayer.upsertUserProfile(this._db, profile);
  }

  /**
   * Adds a new family member profile to the vault.
   */
  addFamilyMember(profile) {
    this._assertUnlocked();
    if (!profile || !profile.name || !profile.name.trim()) {
      throw new Error('Family member name is required');
    }
    const saved = dbLayer.upsertUserProfile(this._db, profile);
    dbLayer.recordAuditEvent(this._db, 'FAMILY_MEMBER_ADDED', {
      name: saved.name,
      dob: saved.dob,
      gender: saved.gender
    });
    return saved;
  }

  /**
   * Removes a family member profile and unlinks person field from documents.
   */
  removeFamilyMember(name) {
    this._assertUnlocked();
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Family member name is required');
    }
    return dbLayer.deleteUserProfile(this._db, name);
  }

  getAiStatus() {
    return llmService.getStatus();
  }

  /**
   * Creates an encrypted, standalone portable backup.
   */
  createBackup(destinationFilePath) {
    this._assertUnlocked();
    const result = createVaultBackup(this._activeVaultPath, destinationFilePath);
    dbLayer.recordAuditEvent(this._db, 'BACKUP_CREATED', {
      destination: destinationFilePath,
      objectCount: result.objectCount
    });
    return result;
  }

  /**
   * Restores an encrypted vault backup into a target directory.
   */
  restoreBackup({ backupFilePath, targetVaultPath }) {
    return restoreVaultBackup(backupFilePath, targetVaultPath);
  }

  /**
   * Returns encrypted audit log history for security and compliance review.
   * @param {number} limit 
   * @returns {Array<{ id: string, eventType: string, details: object, timestamp: string }>}
   */
  listAuditLogs(limit = 100) {
    this._assertUnlocked();
    return dbLayer.listAuditEvents(this._db, limit);
  }

  /**
   * Exports audit log records as formatted JSON to a user-chosen destination.
   * @param {string} destinationPath 
   * @returns {{ success: boolean, count: number, destinationPath: string }}
   */
  exportAuditLogs(destinationPath) {
    this._assertUnlocked();
    if (!destinationPath) throw new Error('destinationPath is required');
    const logs = this.listAuditLogs(1000);
    fs.writeFileSync(destinationPath, JSON.stringify(logs, null, 2), 'utf-8');
    dbLayer.recordAuditEvent(this._db, 'AUDIT_LOGS_EXPORTED', { destination: destinationPath, count: logs.length });
    return { success: true, count: logs.length, destinationPath };
  }

  _guessMimeType(ext) {
    switch (ext) {
      case '.pdf': return 'application/pdf';
      case '.png': return 'image/png';
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.webp': return 'image/webp';
      case '.tiff': return 'image/tiff';
      case '.bmp': return 'image/bmp';
      default: return 'application/octet-stream';
    }
  }
}

// Singleton instance for the Electron application
const vaultService = new VaultService();

module.exports = {
  VaultService,
  vaultService,
  SUPPORTED_EXTENSIONS
};
