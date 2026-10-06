'use strict';

/**
 * SQLCipher Encrypted SQLite Database Layer.
 * Adheres to ARCHITECTURE.md: "encrypted SQLCipher database... stable IDs, content hashes, creation timestamps, and version relationships"
 * Adheres to SECURITY.md: "The SQLite database uses SQLCipher with a key derived from the VMK."
 */

const Database = require('better-sqlite3-multiple-ciphers');
const { v4: uuidv4 } = require('uuid');
const { computeExpiryStatus } = require('../services/extractionService');
const { embeddingService } = require('../services/embeddingService');

const DB_FILE_NAME = 'vault.db';

/**
 * Opens an existing or creates a new SQLCipher database with the derived DB key.
 * @param {string} dbFilePath 
 * @param {Buffer} dbKey 32-byte derived key
 * @returns {Database}
 */
function openVaultDatabase(dbFilePath, dbKey) {
  if (!Buffer.isBuffer(dbKey) || dbKey.length !== 32) {
    throw new Error('Database key must be a 32-byte Buffer');
  }

  const db = new Database(dbFilePath);

  // Set cipher to SQLCipher and supply the 256-bit key in raw hex format
  const hexKey = dbKey.toString('hex');
  db.pragma("cipher = 'sqlcipher'");
  db.pragma(`key = "x'${hexKey}'"`);
  db.pragma('foreign_keys = ON');

  // Verify key validity by running a quick probe
  try {
    db.prepare('PRAGMA user_version').get();
  } catch (err) {
    db.close();
    throw new Error('Database decryption failed: Invalid key or corrupted database');
  }

  initSchema(db);
  return db;
}

/**
 * Initializes database tables, indexes, and full-text search.
 * @param {Database} db 
 */
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      person TEXT,
      tags TEXT,
      notes TEXT,
      current_version_id TEXT,
      is_deleted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      object_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(document_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS extracted_metadata (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
      doc_type TEXT,
      issuer TEXT,
      issue_date TEXT,
      expiry_date TEXT,
      expiry_snippet TEXT,
      issue_snippet TEXT,
      confidence REAL DEFAULT 1.0,
      review_status TEXT NOT NULL DEFAULT 'unreviewed',
      text_content TEXT,
      raw_payload TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vector_embeddings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      vector_blob BLOB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_versions_doc_id ON document_versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_metadata_expiry ON extracted_metadata(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_docs_person ON documents(person);
    CREATE INDEX IF NOT EXISTS idx_docs_category ON documents(category);
    CREATE INDEX IF NOT EXISTS idx_versions_sha256 ON document_versions(sha256);
    CREATE INDEX IF NOT EXISTS idx_vector_doc_id ON vector_embeddings(document_id);
    CREATE INDEX IF NOT EXISTS idx_vector_version_id ON vector_embeddings(version_id);

    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      dob TEXT,
      gender TEXT,
      fathers_name TEXT,
      mothers_name TEXT,
      address TEXT,
      education TEXT,
      marks_10th TEXT,
      marks_12th TEXT,
      extra_details TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_facts (
      id TEXT PRIMARY KEY,
      person_name TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_value TEXT NOT NULL,
      source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      source_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
      confidence REAL DEFAULT 1.0,
      raw_snippet TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_profiles_name ON user_profiles(name);
    CREATE INDEX IF NOT EXISTS idx_profile_facts_person ON profile_facts(person_name);
    CREATE INDEX IF NOT EXISTS idx_profile_facts_doc ON profile_facts(source_document_id);
    CREATE INDEX IF NOT EXISTS idx_profile_facts_field ON profile_facts(field_name);
  `);

  // Migrate columns if upgrading from earlier table definitions
  try { db.exec('ALTER TABLE documents ADD COLUMN is_deleted INTEGER DEFAULT 0;'); } catch (e) {}
  try { db.exec('ALTER TABLE extracted_metadata ADD COLUMN expiry_snippet TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE extracted_metadata ADD COLUMN issue_snippet TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE extracted_metadata ADD COLUMN text_content TEXT;'); } catch (e) {}

  // Initialize FTS5 table if supported
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
        document_id UNINDEXED,
        title,
        category,
        person,
        tags,
        notes,
        text_content
      );
    `);
  } catch (err) {}
}

/**
 * Defensive migration helper to ensure is_deleted column exists on legacy or active open databases.
 */
function ensureIsDeletedColumn(db) {
  try {
    db.exec('ALTER TABLE documents ADD COLUMN is_deleted INTEGER DEFAULT 0;');
  } catch (e) {}
}

/**
 * Inserts a new document record.
 */
function createDocument(db, { id = uuidv4(), title, category = 'other', person = null, tags = [], notes = '' }) {
  const now = new Date().toISOString();
  const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : tags;
  
  const stmt = db.prepare(`
    INSERT INTO documents (id, title, category, person, tags, notes, current_version_id, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
  `);
  stmt.run(id, title, category, person, tagsStr, notes, now, now);

  // Sync with FTS
  try {
    db.prepare(`
      INSERT INTO document_fts (document_id, title, category, person, tags, notes, text_content)
      VALUES (?, ?, ?, ?, ?, ?, '')
    `).run(id, title, category, person || '', tagsStr, notes);
  } catch (e) {}

  return getDocumentById(db, id);
}

/**
 * Creates and records a new immutable version for a document.
 */
function createDocumentVersion(db, {
  documentId,
  objectId,
  sha256,
  fileName,
  fileSize,
  mimeType,
  notes = ''
}) {
  const doc = getDocumentById(db, documentId);
  if (!doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // Calculate next version number
  const lastVersion = db.prepare(`
    SELECT MAX(version_number) as max_v FROM document_versions WHERE document_id = ?
  `).get(documentId);
  const nextVersionNum = (lastVersion && lastVersion.max_v ? lastVersion.max_v : 0) + 1;

  const versionId = uuidv4();
  const now = new Date().toISOString();

  const insertVersionStmt = db.prepare(`
    INSERT INTO document_versions (id, document_id, version_number, object_id, sha256, file_name, file_size, mime_type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateDocStmt = db.prepare(`
    UPDATE documents SET current_version_id = ?, updated_at = ? WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    insertVersionStmt.run(versionId, documentId, nextVersionNum, objectId, sha256, fileName, fileSize, mimeType, notes, now);
    updateDocStmt.run(versionId, now, documentId);
  });

  transaction();

  return getVersionById(db, versionId);
}

/**
 * Retrieves a document by ID with current version details.
 */
function getDocumentById(db, documentId) {
  const row = db.prepare(`
    SELECT d.*, 
           v.version_number, v.file_name, v.file_size, v.mime_type, v.sha256, v.object_id,
           m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.confidence, m.review_status, m.text_content, m.raw_payload
    FROM documents d
    LEFT JOIN document_versions v ON d.current_version_id = v.id
    LEFT JOIN extracted_metadata m ON v.id = m.version_id
    WHERE d.id = ?
  `).get(documentId);

  if (!row) return null;
  return formatDocumentRow(row);
}

/**
 * Lists documents with filtering and search support.
 */
function listDocuments(db, { category, person, tag, search, expiryFilter } = {}) {
  ensureIsDeletedColumn(db);
  let query = `
    SELECT d.*, 
           v.version_number, v.file_name, v.file_size, v.mime_type, v.sha256, v.object_id,
           m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.confidence, m.review_status, m.text_content, m.raw_payload
    FROM documents d
    LEFT JOIN document_versions v ON d.current_version_id = v.id
    LEFT JOIN extracted_metadata m ON v.id = m.version_id
    WHERE (d.is_deleted IS NULL OR d.is_deleted = 0)
  `;
  const params = [];

  if (category) {
    query += ` AND d.category = ?`;
    params.push(category);
  }
  if (person) {
    query += ` AND d.person = ?`;
    params.push(person);
  }
  if (tag) {
    query += ` AND d.tags LIKE ?`;
    params.push(`%"${tag}"%`);
  }
  if (search && search.trim()) {
    const trimmed = search.trim();
    // Try matching title, notes, filename or extracted text
    query += ` AND (d.title LIKE ? OR d.notes LIKE ? OR v.file_name LIKE ? OR m.text_content LIKE ?)`;
    const searchPattern = `%${trimmed}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  query += ` ORDER BY d.updated_at DESC`;

  const rows = db.prepare(query).all(...params);
  const formatted = rows.map(formatDocumentRow);

  if (expiryFilter) {
    return formatted.filter(doc => {
      const status = doc.currentVersion?.metadata?.expiryStatus;
      if (expiryFilter === 'expiring_soon') return status === 'expiring_soon';
      if (expiryFilter === 'expired') return status === 'expired';
      if (expiryFilter === 'has_expiry') return status === 'active' || status === 'expiring_soon' || status === 'expired';
      return true;
    });
  }

  return formatted;
}

/**
 * Lists all documents that have an expiry date, ordered by expiry date ascending.
 */
function listUpcomingExpiries(db) {
  ensureIsDeletedColumn(db);
  const query = `
    SELECT d.*, 
           v.version_number, v.file_name, v.file_size, v.mime_type, v.sha256, v.object_id,
           m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.confidence, m.review_status, m.text_content, m.raw_payload
    FROM documents d
    JOIN document_versions v ON d.current_version_id = v.id
    JOIN extracted_metadata m ON v.id = m.version_id
    WHERE (d.is_deleted IS NULL OR d.is_deleted = 0) AND m.expiry_date IS NOT NULL AND m.expiry_date != ''
    ORDER BY m.expiry_date ASC
  `;
  const rows = db.prepare(query).all();
  return rows.map(formatDocumentRow);
}

/**
 * Retrieves all immutable versions for a document.
 */
function getDocumentVersions(db, documentId) {
  const rows = db.prepare(`
    SELECT v.*, m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.review_status, m.text_content, m.raw_payload
    FROM document_versions v
    LEFT JOIN extracted_metadata m ON v.id = m.version_id
    WHERE v.document_id = ?
    ORDER BY v.version_number DESC
  `).all(documentId);

  return rows;
}

/**
 * Retrieves a single version by versionId.
 */
function getVersionById(db, versionId) {
  const row = db.prepare(`
    SELECT v.*, d.title as document_title,
           m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.review_status, m.confidence, m.text_content, m.raw_payload
    FROM document_versions v
    JOIN documents d ON v.document_id = d.id
    LEFT JOIN extracted_metadata m ON v.id = m.version_id
    WHERE v.id = ?
  `).get(versionId);

  return row || null;
}

/**
 * Finds a document version with a matching SHA256 hash.
 */
function findVersionByHash(db, sha256) {
  return db.prepare(`
    SELECT v.*, d.title as document_title
    FROM document_versions v
    JOIN documents d ON v.document_id = d.id
    WHERE v.sha256 = ?
    LIMIT 1
  `).get(sha256) || null;
}

/**
 * Inserts or updates extracted metadata for a version and updates FTS.
 */
function saveMetadata(db, {
  versionId,
  docType = null,
  issuer = null,
  issueDate = null,
  expiryDate = null,
  expirySnippet = null,
  issueSnippet = null,
  confidence = 1.0,
  reviewStatus = 'unreviewed',
  textContent = null,
  rawPayload = null
}) {
  const existing = db.prepare('SELECT id, version_id FROM extracted_metadata WHERE version_id = ?').get(versionId);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE extracted_metadata
      SET doc_type = ?, issuer = ?, issue_date = ?, expiry_date = ?, expiry_snippet = ?, issue_snippet = ?, confidence = ?, review_status = ?, text_content = ?, raw_payload = ?, updated_at = ?
      WHERE id = ?
    `).run(docType, issuer, issueDate, expiryDate, expirySnippet, issueSnippet, confidence, reviewStatus, textContent, rawPayload ? JSON.stringify(rawPayload) : null, now, existing.id);
  } else {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO extracted_metadata (id, version_id, doc_type, issuer, issue_date, expiry_date, expiry_snippet, issue_snippet, confidence, review_status, text_content, raw_payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, versionId, docType, issuer, issueDate, expiryDate, expirySnippet, issueSnippet, confidence, reviewStatus, textContent, rawPayload ? JSON.stringify(rawPayload) : null, now, now);
  }

  // Update FTS index if textContent is present
  if (textContent) {
    try {
      const version = db.prepare('SELECT document_id FROM document_versions WHERE id = ?').get(versionId);
      if (version) {
        db.prepare('DELETE FROM document_fts WHERE document_id = ?').run(version.document_id);
        const doc = db.prepare('SELECT title, category, person, tags, notes FROM documents WHERE id = ?').get(version.document_id);
        if (doc) {
          db.prepare(`
            INSERT INTO document_fts (document_id, title, category, person, tags, notes, text_content)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(version.document_id, doc.title, doc.category, doc.person || '', doc.tags || '', doc.notes || '', textContent);
        }
      }
    } catch (e) {}
  }
}

/**
 * Updates editable document-level fields (title, person, category, tags, notes).
 * Re-syncs the FTS index after the update.
 * @param {Database} db
 * @param {string} documentId
 * @param {object} fields - { title?, person?, category?, tags?, notes? }
 * @returns {object} updated document
 */
function updateDocumentFields(db, documentId, fields) {
  const doc = getDocumentById(db, documentId);
  if (!doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const title = (fields.title !== undefined && fields.title !== null) ? fields.title : doc.title;
  const person = fields.person !== undefined ? (fields.person || null) : doc.person;
  const category = (fields.category !== undefined && fields.category !== null) ? fields.category : doc.category;
  const tags = fields.tags !== undefined ? (Array.isArray(fields.tags) ? JSON.stringify(fields.tags) : fields.tags) : JSON.stringify(doc.tags);
  const notes = fields.notes !== undefined ? (fields.notes || '') : (doc.notes || '');
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE documents SET title = ?, person = ?, category = ?, tags = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(title, person, category, tags, notes, now, documentId);

  // Re-sync FTS index
  try {
    db.prepare('DELETE FROM document_fts WHERE document_id = ?').run(documentId);
    const textContent = doc.currentVersion?.metadata?.textContent || '';
    db.prepare(`
      INSERT INTO document_fts (document_id, title, category, person, tags, notes, text_content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(documentId, title, category, person || '', tags, notes, textContent);
  } catch (e) {}

  return getDocumentById(db, documentId);
}

/**
 * Soft-deletes a document and removes it from FTS index.
 * Preserves immutable document versions and encrypted objects on disk.
 * @param {Database} db
 * @param {string} documentId
 * @returns {{ success: boolean, documentId: string }}
 */
function deleteDocument(db, documentId, auditDetails) {
  ensureIsDeletedColumn(db);
  const deleteTransaction = db.transaction(() => {
    const doc = db.prepare(`
      SELECT id, title FROM documents
      WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)
    `).get(documentId);
    if (!doc) {
      throw new Error(`Document not found or already deleted: ${documentId}`);
    }

    const now = new Date().toISOString();
    const update = db.prepare(`
      UPDATE documents SET is_deleted = 1, updated_at = ?
      WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)
    `).run(now, documentId);
    if (update.changes !== 1) {
      throw new Error(`Unable to delete active document: ${documentId}`);
    }

    // These indexes and derived facts are derived data. A failure must roll back the soft-delete
    // rather than leaving a document visible in an inconsistent search state.
    db.prepare('DELETE FROM document_fts WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM vector_embeddings WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM profile_facts WHERE source_document_id = ?').run(documentId);

    if (auditDetails) {
      recordAuditEvent(db, 'DOCUMENT_DELETED', auditDetails);
    }

    return { success: true, documentId, title: doc.title };
  });

  return deleteTransaction();
}

/**
 * Inserts an immutable local audit log event.
 */
function recordAuditEvent(db, eventType, details = {}) {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_events (id, event_type, details, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(id, eventType, JSON.stringify(details), timestamp);
}

/**
 * Retrieves audit log events in reverse chronological order.
 * @param {Database} db 
 * @param {number} limit 
 * @returns {Array<{ id: string, eventType: string, details: object, timestamp: string }>}
 */
function listAuditEvents(db, limit = 100) {
  const rows = db.prepare(`
    SELECT id, event_type, details, timestamp
    FROM audit_events
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);

  return rows.map(r => {
    let parsedDetails = {};
    try {
      parsedDetails = JSON.parse(r.details || '{}');
    } catch (e) {}
    return {
      id: r.id,
      eventType: r.event_type,
      details: parsedDetails,
      timestamp: r.timestamp
    };
  });
}

/**
 * Helper to parse JSON tags and structure output cleanly.
 */
function formatDocumentRow(row) {
  let tags = [];
  try {
    tags = JSON.parse(row.tags || '[]');
  } catch (e) {
    tags = [];
  }

  const expiryInfo = computeExpiryStatus(row.expiry_date);

  let ocrWords = [];
  let rawPayload = null;
  if (row.raw_payload) {
    try {
      rawPayload = JSON.parse(row.raw_payload);
      if (rawPayload && Array.isArray(rawPayload.ocrWords)) {
        ocrWords = rawPayload.ocrWords;
      }
    } catch (e) {}
  }

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    person: row.person,
    tags,
    notes: row.notes,
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentVersion: row.current_version_id ? {
      id: row.current_version_id,
      versionNumber: row.version_number,
      fileName: row.file_name,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      sha256: row.sha256,
      objectId: row.object_id,
      metadata: {
        docType: row.doc_type,
        issuer: row.issuer,
        issueDate: row.issue_date,
        expiryDate: row.expiry_date,
        expirySnippet: row.expiry_snippet,
        issueSnippet: row.issue_snippet,
        confidence: row.confidence,
        reviewStatus: row.review_status,
        expiryStatus: expiryInfo.status,
        daysRemaining: expiryInfo.daysRemaining,
        textContent: row.text_content,
        ocrWords,
        rawPayload
      }
    } : null
  };
}

/**
 * Persists vector embeddings for text chunks belonging to a document version.
 * @param {Database} db 
 * @param {string} versionId 
 * @param {string} documentId 
 * @param {Array<{ chunkIndex: number, chunkText: string, vector: Float32Array }>} chunkEmbeddings 
 */
function saveVectorEmbeddings(db, versionId, documentId, chunkEmbeddings) {
  if (!chunkEmbeddings || chunkEmbeddings.length === 0) return;

  const insertStmt = db.prepare(`
    INSERT INTO vector_embeddings (id, document_id, version_id, chunk_index, chunk_text, vector_blob, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM vector_embeddings WHERE version_id = ?').run(versionId);
    for (const item of chunkEmbeddings) {
      const id = uuidv4();
      const blob = embeddingService.vectorToBlob(item.vector);
      insertStmt.run(id, documentId, versionId, item.chunkIndex, item.chunkText, blob, now);
    }
  });

  tx();
}

/**
 * Searches stored vector embeddings using cosine similarity against the query vector.
 * @param {Database} db 
 * @param {Float32Array} queryVector 
 * @param {object} options 
 * @returns {Array<object>}
 */
function searchVectorEmbeddings(db, queryVector, { limit = 5, minScore = 0.05, personName = null } = {}) {
  ensureIsDeletedColumn(db);
  const personClause = typeof personName === 'string' && personName.trim()
    ? 'AND d.person = ? COLLATE NOCASE'
    : '';
  const rows = db.prepare(`
    SELECT v.id, v.document_id, v.version_id, v.chunk_index, v.chunk_text, v.vector_blob,
           d.title as document_title, d.category, d.person, ver.file_name
    FROM vector_embeddings v
    JOIN documents d ON v.document_id = d.id
    JOIN document_versions ver ON v.version_id = ver.id
    WHERE (d.is_deleted IS NULL OR d.is_deleted = 0)
    ${personClause}
  `).all(...(personClause ? [personName.trim()] : []));

  const scored = [];
  for (const row of rows) {
    const chunkVector = embeddingService.blobToVector(row.vector_blob);
    const score = embeddingService.cosineSimilarity(queryVector, chunkVector);
    if (score >= minScore) {
      scored.push({
        id: row.id,
        documentId: row.document_id,
        versionId: row.version_id,
        chunkIndex: row.chunk_index,
        chunkText: row.chunk_text,
        documentTitle: row.document_title,
        category: row.category,
        person: row.person,
        fileName: row.file_name,
        similarity: Math.round(score * 1000) / 1000
      });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

/**
 * Retrieves a list of distinct family members (persons) recorded in the vault.
 * @param {Database} db
 * @returns {Array<string>}
 */
function listDistinctPersons(db) {
  ensureIsDeletedColumn(db);
  const rows = db.prepare(`
    SELECT DISTINCT person as name FROM documents
    WHERE (is_deleted IS NULL OR is_deleted = 0) AND person IS NOT NULL AND TRIM(person) != ''
    UNION
    SELECT DISTINCT name FROM user_profiles
    WHERE name IS NOT NULL AND TRIM(name) != ''
    ORDER BY name ASC
  `).all();
  return rows.map(r => r.name.trim()).filter(Boolean);
}

/**
 * Calculates integer age in years from an ISO date of birth (YYYY-MM-DD).
 */
function calculateAge(dobStr) {
  if (!dobStr || typeof dobStr !== 'string') return null;
  const match = dobStr.match(/\b(19\d\d|20\d\d)[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10) - 1;
  const d = parseInt(match[3], 10);
  const birth = new Date(y, m, d);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 && age <= 130 ? age : null;
}

const PROFILE_FIELD_LABELS = {
  dob: 'Date of Birth',
  fathers_name: "Father's Name",
  mothers_name: "Mother's Name",
  address: 'Residential Address',
  marks_10th: '10th Secondary Marks',
  marks_12th: '12th Higher Secondary Marks',
  education: 'Higher Education / Degree',
  gender: 'Gender',
  license_number: 'Driving License Number',
  id_number: 'National / Passport ID'
};

function normalizeProfileFieldValue(fieldName, val) {
  if (!val) return '';
  let str = String(val).trim().toLowerCase();
  if (fieldName === 'dob') {
    return str.replace(/[/-]/g, '-');
  }
  if (fieldName === 'fathers_name' || fieldName === 'mothers_name') {
    str = str.replace(/^(?:mr\.?|mrs\.?|shri\.?|smt\.?|dr\.?)\s+/i, '');
    return str.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (fieldName === 'marks_10th' || fieldName === 'marks_12th') {
    const pct = str.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    if (pct) return pct[1] + '%';
    const cgpa = str.match(/(?:cgpa|gpa)\s*[:.-]?\s*(\d{1,2}(?:\.\d{1,2})?)/);
    if (cgpa) return 'cgpa ' + cgpa[1];
    return str.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (fieldName === 'gender') {
    if (str.startsWith('m')) return 'male';
    if (str.startsWith('f')) return 'female';
    return str;
  }
  if (fieldName === 'license_number' || fieldName === 'id_number') {
    return str.replace(/[^a-z0-9]/g, '');
  }
  return str.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Creates or updates a canonical user profile in user_profiles.
 */
function upsertUserProfile(db, profile) {
  if (!profile || !profile.name || !profile.name.trim()) {
    throw new Error('User profile name is required');
  }
  const name = profile.name.trim();
  const existing = db.prepare('SELECT id, created_at FROM user_profiles WHERE name = ? COLLATE NOCASE').get(name);
  const now = new Date().toISOString();
  const id = existing ? existing.id : (profile.id || uuidv4());
  const createdAt = existing ? existing.created_at : now;

  let extraDetails = null;
  if (profile.extraDetails) {
    extraDetails = typeof profile.extraDetails === 'string'
      ? profile.extraDetails
      : JSON.stringify(profile.extraDetails);
  }

  db.prepare(`
    INSERT INTO user_profiles (
      id, name, dob, gender, fathers_name, mothers_name, address,
      education, marks_10th, marks_12th, extra_details, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      dob = COALESCE(excluded.dob, user_profiles.dob),
      gender = COALESCE(excluded.gender, user_profiles.gender),
      fathers_name = COALESCE(excluded.fathers_name, user_profiles.fathers_name),
      mothers_name = COALESCE(excluded.mothers_name, user_profiles.mothers_name),
      address = COALESCE(excluded.address, user_profiles.address),
      education = COALESCE(excluded.education, user_profiles.education),
      marks_10th = COALESCE(excluded.marks_10th, user_profiles.marks_10th),
      marks_12th = COALESCE(excluded.marks_12th, user_profiles.marks_12th),
      extra_details = COALESCE(excluded.extra_details, user_profiles.extra_details),
      notes = COALESCE(excluded.notes, user_profiles.notes),
      updated_at = excluded.updated_at
  `).run(
    id,
    name,
    profile.dob || null,
    profile.gender || null,
    profile.fathersName || profile.fathers_name || null,
    profile.mothersName || profile.mothers_name || null,
    profile.address || null,
    profile.education || null,
    profile.marks10th || profile.marks_10th || null,
    profile.marks12th || profile.marks_12th || null,
    extraDetails,
    profile.notes || null,
    createdAt,
    now
  );

  return getUserProfile(db, name);
}

/**
 * Retrieves a canonical user profile by person name.
 */
function getUserProfile(db, name) {
  if (!name) return null;
  const row = db.prepare('SELECT * FROM user_profiles WHERE name = ? COLLATE NOCASE').get(name.trim());
  if (!row) return null;
  let extraDetails = {};
  try {
    if (row.extra_details) extraDetails = JSON.parse(row.extra_details);
  } catch (e) {}

  return {
    id: row.id,
    name: row.name,
    dob: row.dob,
    age: calculateAge(row.dob),
    gender: row.gender,
    fathersName: row.fathers_name,
    mothersName: row.mothers_name,
    address: row.address,
    education: row.education,
    marks10th: row.marks_10th,
    marks12th: row.marks_12th,
    extraDetails,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Deletes a family member / user profile, associated facts, and clears person field from linked documents.
 * Preserves the actual documents themselves as unassigned.
 */
function deleteUserProfile(db, name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Valid person name is required to remove family member');
  }
  const trimmedName = name.trim();

  const deleteTx = db.transaction(() => {
    // 1. Delete canonical user profile record
    const profileRes = db.prepare('DELETE FROM user_profiles WHERE name = ? COLLATE NOCASE').run(trimmedName);

    // 2. Delete atomic extracted profile facts
    const factsRes = db.prepare('DELETE FROM profile_facts WHERE person_name = ? COLLATE NOCASE').run(trimmedName);

    // 3. Clear person field from documents, re-indexing FTS
    const affectedDocs = db.prepare(`
      SELECT d.id, d.title, d.category, d.tags, d.notes, m.text_content
      FROM documents d
      LEFT JOIN document_versions v ON d.current_version_id = v.id
      LEFT JOIN extracted_metadata m ON v.id = m.version_id
      WHERE (d.is_deleted IS NULL OR d.is_deleted = 0) AND d.person = ? COLLATE NOCASE
    `).all(trimmedName);

    const now = new Date().toISOString();
    db.prepare('UPDATE documents SET person = NULL, updated_at = ? WHERE person = ? COLLATE NOCASE').run(now, trimmedName);

    for (const doc of affectedDocs) {
      try {
        db.prepare('DELETE FROM document_fts WHERE document_id = ?').run(doc.id);
        db.prepare(`
          INSERT INTO document_fts (document_id, title, category, person, tags, notes, text_content)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(doc.id, doc.title, doc.category, '', doc.tags || '[]', doc.notes || '', doc.text_content || '');
      } catch (e) {}
    }

    recordAuditEvent(db, 'FAMILY_MEMBER_REMOVED', {
      name: trimmedName,
      affectedDocumentsCount: affectedDocs.length,
      deletedProfile: profileRes.changes > 0,
      deletedFactsCount: factsRes.changes
    });

    return {
      success: true,
      name: trimmedName,
      profileRemoved: profileRes.changes > 0,
      unlinkedDocumentsCount: affectedDocs.length
    };
  });

  return deleteTx();
}

/**
 * Batch saves atomic extracted profile facts linked to their source documents.
 */
function saveProfileFactsBatch(db, facts = []) {
  if (!Array.isArray(facts) || facts.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO profile_facts (
      id, person_name, field_name, field_value, source_document_id, source_version_id, confidence, raw_snippet, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const tx = db.transaction((items) => {
    for (const f of items) {
      if (f.personName && f.fieldName && f.fieldValue && f.sourceDocumentId && f.sourceVersionId) {
        insert.run(
          uuidv4(),
          f.personName.trim(),
          f.fieldName.trim(),
          String(f.fieldValue).trim(),
          f.sourceDocumentId,
          f.sourceVersionId,
          f.confidence ?? 1.0,
          f.rawSnippet || null,
          now
        );
      }
    }
  });
  tx(facts);
}

/**
 * Analyzes all extracted facts across documents for a person and detects contradictions.
 */
function getUserProfileWithContradictions(db, personName) {
  ensureIsDeletedColumn(db);
  const name = (personName || '').trim();
  const canonical = getUserProfile(db, name) || {
    id: null,
    name,
    dob: null,
    age: null,
    gender: null,
    fathersName: null,
    mothersName: null,
    address: null,
    education: null,
    marks10th: null,
    marks12th: null,
    extraDetails: {},
    notes: null
  };

  // Fetch all atomic facts from non-deleted documents
  const facts = db.prepare(`
    SELECT pf.*, d.title as document_title, dv.file_name
    FROM profile_facts pf
    JOIN documents d ON pf.source_document_id = d.id
    JOIN document_versions dv ON pf.source_version_id = dv.id
    WHERE pf.person_name = ? COLLATE NOCASE AND (d.is_deleted IS NULL OR d.is_deleted = 0)
    ORDER BY pf.created_at ASC
  `).all(name);

  // Group facts by field_name
  const grouped = {};
  for (const f of facts) {
    const k = f.field_name.toLowerCase().trim();
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(f);
  }

  const contradictions = {};
  const aggregatedValues = {};

  for (const [fieldKey, factList] of Object.entries(grouped)) {
    const uniqueNormMap = new Map();
    for (const fact of factList) {
      const norm = normalizeProfileFieldValue(fieldKey, fact.field_value);
      if (!norm) continue;
      if (!uniqueNormMap.has(norm)) {
        uniqueNormMap.set(norm, []);
      }
      uniqueNormMap.get(norm).push({
        value: fact.field_value,
        documentId: fact.source_document_id,
        documentTitle: fact.document_title,
        fileName: fact.file_name,
        snippet: fact.raw_snippet,
        createdAt: fact.created_at
      });
    }

    // Set aggregated value to the latest fact's value
    if (factList.length > 0) {
      aggregatedValues[fieldKey] = factList[factList.length - 1].field_value;
    }

    // If multiple documents report conflicting normalized values:
    if (uniqueNormMap.size > 1) {
      const conflictingValues = [];
      for (const [_, examples] of uniqueNormMap.entries()) {
        conflictingValues.push(examples[0]);
      }
      contradictions[fieldKey] = {
        fieldName: fieldKey,
        fieldLabel: PROFILE_FIELD_LABELS[fieldKey] || fieldKey,
        isContradicting: true,
        conflictingValues
      };
    }
  }

  // Count active documents associated with this person
  const docCountRow = db.prepare(`
    SELECT COUNT(DISTINCT d.id) as count
    FROM documents d
    WHERE (d.is_deleted IS NULL OR d.is_deleted = 0) AND d.person = ? COLLATE NOCASE
  `).get(name);

  // Contributing documents with titles and file names
  const sourceDocs = db.prepare(`
    SELECT DISTINCT d.id, d.title, d.category, dv.file_name, d.created_at
    FROM documents d
    LEFT JOIN document_versions dv ON d.current_version_id = dv.id
    WHERE (d.is_deleted IS NULL OR d.is_deleted = 0) AND d.person = ? COLLATE NOCASE
    ORDER BY d.created_at DESC
  `).all(name);

  const effectiveDob = canonical.dob || aggregatedValues.dob || null;
  const profile = {
    ...canonical,
    dob: effectiveDob,
    age: calculateAge(effectiveDob),
    gender: canonical.gender || aggregatedValues.gender || null,
    fathersName: canonical.fathersName || aggregatedValues.fathers_name || null,
    mothersName: canonical.mothersName || aggregatedValues.mothers_name || null,
    address: canonical.address || aggregatedValues.address || null,
    education: canonical.education || aggregatedValues.education || null,
    marks10th: canonical.marks10th || aggregatedValues.marks_10th || null,
    marks12th: canonical.marks12th || aggregatedValues.marks_12th || null,
    licenseNumber: aggregatedValues.license_number || (canonical.extraDetails && canonical.extraDetails.licenseNumber) || null,
    idNumber: aggregatedValues.id_number || (canonical.extraDetails && canonical.extraDetails.idNumber) || null
  };

  return {
    personName: name,
    profile,
    contradictions,
    hasContradictions: Object.keys(contradictions).length > 0,
    contradictionCount: Object.keys(contradictions).length,
    documentsCount: docCountRow ? docCountRow.count : 0,
    sourceDocuments: sourceDocs,
    facts
  };
}

/**
 * Returns summaries of all users / family members with contradiction flags.
 */
function listUserProfilesWithSummaries(db) {
  ensureIsDeletedColumn(db);
  const personRows = db.prepare(`
    SELECT DISTINCT person as name FROM documents
    WHERE (is_deleted IS NULL OR is_deleted = 0) AND person IS NOT NULL AND TRIM(person) != ''
    UNION
    SELECT DISTINCT name FROM user_profiles WHERE name IS NOT NULL AND TRIM(name) != ''
    ORDER BY name ASC
  `).all();

  const summaries = [];
  for (const row of personRows) {
    const full = getUserProfileWithContradictions(db, row.name);
    summaries.push({
      name: full.personName,
      dob: full.profile.dob,
      age: full.profile.age,
      gender: full.profile.gender,
      fathersName: full.profile.fathersName,
      mothersName: full.profile.mothersName,
      education: full.profile.education,
      marks10th: full.profile.marks10th,
      marks12th: full.profile.marks12th,
      address: full.profile.address,
      documentsCount: full.documentsCount,
      hasContradictions: full.hasContradictions,
      contradictionCount: full.contradictionCount,
      contradictions: full.contradictions
    });
  }
  return summaries;
}

module.exports = {
  DB_FILE_NAME,
  openVaultDatabase,
  initSchema,
  createDocument,
  createDocumentVersion,
  getDocumentById,
  listDocuments,
  listUpcomingExpiries,
  listDistinctPersons,
  getDocumentVersions,
  getVersionById,
  findVersionByHash,
  saveMetadata,
  updateDocumentFields,
  deleteDocument,
  recordAuditEvent,
  listAuditEvents,
  saveVectorEmbeddings,
  searchVectorEmbeddings,
  upsertUserProfile,
  getUserProfile,
  deleteUserProfile,
  saveProfileFactsBatch,
  getUserProfileWithContradictions,
  listUserProfilesWithSummaries,
  calculateAge,
  normalizeProfileFieldValue,
  PROFILE_FIELD_LABELS
};
