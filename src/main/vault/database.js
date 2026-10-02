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
  `);

  // Migrate columns if upgrading from earlier table definitions
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
 * Inserts a new document record.
 */
function createDocument(db, { id = uuidv4(), title, category = 'other', person = null, tags = [], notes = '' }) {
  const now = new Date().toISOString();
  const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : tags;
  
  const stmt = db.prepare(`
    INSERT INTO documents (id, title, category, person, tags, notes, current_version_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
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
           m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.confidence, m.review_status, m.text_content
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
  let query = `
    SELECT d.*, 
           v.version_number, v.file_name, v.file_size, v.mime_type, v.sha256, v.object_id,
           m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.confidence, m.review_status, m.text_content
    FROM documents d
    LEFT JOIN document_versions v ON d.current_version_id = v.id
    LEFT JOIN extracted_metadata m ON v.id = m.version_id
    WHERE 1=1
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
  const query = `
    SELECT d.*, 
           v.version_number, v.file_name, v.file_size, v.mime_type, v.sha256, v.object_id,
           m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.confidence, m.review_status, m.text_content
    FROM documents d
    JOIN document_versions v ON d.current_version_id = v.id
    JOIN extracted_metadata m ON v.id = m.version_id
    WHERE m.expiry_date IS NOT NULL AND m.expiry_date != ''
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
    SELECT v.*, m.doc_type, m.issuer, m.issue_date, m.expiry_date, m.expiry_snippet, m.issue_snippet, m.review_status, m.text_content
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
        textContent: row.text_content
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
function searchVectorEmbeddings(db, queryVector, { limit = 5, minScore = 0.05 } = {}) {
  const rows = db.prepare(`
    SELECT v.id, v.document_id, v.version_id, v.chunk_index, v.chunk_text, v.vector_blob,
           d.title as document_title, d.category, d.person, ver.file_name
    FROM vector_embeddings v
    JOIN documents d ON v.document_id = d.id
    JOIN document_versions ver ON v.version_id = ver.id
  `).all();

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

module.exports = {
  DB_FILE_NAME,
  openVaultDatabase,
  initSchema,
  createDocument,
  createDocumentVersion,
  getDocumentById,
  listDocuments,
  listUpcomingExpiries,
  getDocumentVersions,
  getVersionById,
  findVersionByHash,
  saveMetadata,
  recordAuditEvent,
  saveVectorEmbeddings,
  searchVectorEmbeddings
};
