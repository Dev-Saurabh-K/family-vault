# Current Repository State

Last updated: 2026-10-03 (Asia/Kolkata)

## What exists

The repository contains a complete, fully tested, functional implementation of FamilyVault Phases 1 through 6:

- **Documentation**: `AGENTS.md`, `PROJECT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRODUCT_REQUIREMENTS.md`, and `CURRENT_STATE.md`.
- **Core Cryptography**:
  - `src/main/crypto/kdf.js`: Argon2id KEK derivation with `@noble/hashes`.
  - `src/main/crypto/cipher.js`: AES-256-GCM authenticated cipher for VMK wrapping and object envelope encryption/decryption with `FVOBJ001` header.
  - `src/main/crypto/keys.js`: 256-bit random VMK generation, HKDF-SHA256 subkey derivation (`dbKey`, `objectKey`), and memory zeroization.
- **Vault Core & Storage**:
  - `src/main/vault/manifest.js`: Versioned `manifest.json` schema validation (Zod) and atomic persistence.
  - `src/main/vault/objectStore.js`: Encrypted immutable object storage under `objects/<objectId>.enc` with SHA-256 integrity and path traversal protection.
  - `src/main/vault/database.js`: SQLCipher encrypted relational SQLite database with tables for `documents`, immutable `document_versions`, `extracted_metadata`, `audit_events`, and `vector_embeddings`, plus FTS5 virtual table synchronization.
  - `src/main/vault/vaultService.js`: Vault lifecycle management (create, unlock, lock, zeroize keys, password rewrapping, document import with automatic offline text extraction & analysis, immutable version appending, export, metadata review/confirmation, upcoming expiries, grounded local AI Q&A, semantic similarity search, and portable encrypted backup/restore).
  - `src/main/vault/backupService.js`: Portable encrypted vault backup generation (`.fvbackup`) and cryptographic restoration with SHA-256 tamper verification.
- **Text Extraction & Deterministic Analysis**:
  - `src/main/services/extractionService.js`: Offline PDF text extraction (`pdf-parse`), image and scanned PDF OCR pipeline (`tesseract.js`) with detailed word-level coordinate extraction (`{ text, x, y, width, height, confidence }`) and tabular column layout reconstruction, deterministic date detection (ISO, DMY, MDY formats), document classification (passports, driving licenses, identity cards, insurance policies, tax documents, medical records, property/deeds), family member (person) detection matching existing vault persons and labeled name patterns, automatic relevant tag generation (`generateAutoTags`), human-readable document title suggestions (`suggestDocumentTitle`), source match/provenance extraction, and deterministic expiry status logic (`active`, `expiring_soon`, `expired`).
- **Semantic Vector Embeddings & Similarity Retrieval**:
  - `src/main/services/embeddingService.js`: Modular, 100% offline embedding service supporting normalized vector generation, text passage chunking, cosine similarity scoring, BLOB serialization/deserialization for SQLCipher storage, and deterministic feature-hashing vectorization (with optional local `llama-server` embedding endpoint support).
- **Local AI & Grounded Document Q&A**:
  - `src/main/services/llmService.js`:
    - Strict AI document metadata extraction (`extractDocumentMetadata`): Prompts local Gemma 2 model to extract strictly structured JSON metadata. Enforces categorization strictly to `identity`, `insurance`, `medical`, `tax`, `property`, `other`. Invalid categories are rejected and fallback to deterministic analysis.
    - AI-powered family member detection: Matches candidate names against existing family members (`knownPersons`) with canonical naming, or extracts individual cardholders/patients/policyholders while strictly filtering false positive entities (authorities, governments, hospitals).
    - Grounded expiry date detection: Validates ISO `YYYY-MM-DD` formatting and verifies date numbers against document text to prevent AI hallucinations.
    - Grounded document Q&A engine with citations (`answerQuestion`). Manages local `llama-server.exe` child process targeting Google Gemma 2 2B GGUF (`gemma-2-2b-it-Q4_K_M.gguf`, enforcing strict `--host 127.0.0.1:18432` binding, no LAN, no web UI, Gemma 2 turn formatting) with a built-in deterministic extractive QA fallback that scores passages by distinct query term coverage, formats citations, and guarantees no cloud leakage.
  - Automated setup & packaging: `scripts/setup-ai.js` (`npm run setup:ai`) and `forge.config.js` `packagerConfig.extraResource` (`bin/` and `models/`) to bundle or place the engine and model alongside `app.asar`.
  - In-app 1-click setup: Direct download and configuration card in the AI modal with real-time progress bar and percentage display, streaming updates via IPC (`ai:download-gemma` and `ai:download-progress`).
- **Electron Shell & UI**:
  - `src/main/ipc.js`: Strictly typed and validated IPC handlers including pre-analysis (`document:pre-analyze`), family member enumeration (`vault:list-family-members`), metadata review, upcoming expiries, AI assistant Q&A, 1-click Gemma 2 2B download/setup, semantic vector search, encrypted audit log queries, and encrypted backup/restore.
  - `src/preload.js`: Secure context-isolated bridge exposing `window.familyVault`.
  - `src/index.js`: Electron main process with strict Content Security Policy (`connect-src 'none'`), sandbox mode, and lock-on-exit key cleanup.
  - `src/index.html`, `src/index.css`, `src/renderer.js`: Responsive dark-mode desktop UI supporting:
    - Secure vault launcher with password-only unlock and restore tabs.
    - Category sidebar filters and dynamic Family Member (Person) dropdown filter.
    - Time-sensitive Expiry Alert Banner with quick-view and session dismissal.
    - Clickable tag filtering with active tag bar and 1-click clear.
    - Search bar with Keyword vs Semantic search toggle.
    - Document import modal with live pre-analysis: on browsing a file, an in-modal progress loader analyzes the document via OCR/text extraction and automatically fills title, category, family member (with `<datalist>` auto-suggestions), tags, and notes, displaying a detection summary banner while giving the user full editing control before encrypting and saving.
    - Detail drawer with in-memory preview, extracted OCR & plaintext inspection panel with structured word-coordinate viewer, count badge, and 1-click clipboard copy.
    - Inline document metadata editing in the detail drawer (title, category, person, tags, notes) with toggle controls, input validation, and real-time FTS re-indexing.
    - End-to-end document deletion with 1-click delete buttons on every document card (`.btn-card-delete`), the drawer header (`#btn-delete-document-header`), and the drawer footer (`#btn-delete-document`), confirmation dialog (`#modal-confirm-delete`), and immediate reactive UI feedback. Soft-deletes records in SQLCipher (`is_deleted = 1`), purges FTS5 full-text indexes and vector embeddings, logs immutable `DOCUMENT_DELETED` audit events, and strictly preserves encrypted disk objects in `objects/`.
    - Automatic defensive SQLite migration (`ensureIsDeletedColumn`) that gracefully ensures the `is_deleted` column exists on newly created or legacy opened vaults without query errors.
    - Metadata review and confirmation modal with provenance snippets.
    - Immutable version history timeline and new version upload.
    - Master password change modal.
    - Tamper-evident encrypted audit log viewer modal with 1-click JSON export (`btn-export-audit-logs`).
    - Conversational multi-turn Grounded AI Assistant modal with chat bubbles, 1-click Gemma 2 2B setup card, answer copy, clickable citations, and clear chat button.
- **Test Suite**:
  - `tests/crypto.test.js`: Unit tests for Argon2id, VMK wrapping/unwrapping, AES-256-GCM envelope, HKDF, and zeroization.
  - `tests/vaultService.test.js`: Integration tests for vault creation, unlock with password, lock zeroization, tamper detection, document import, immutable multi-version history, inline metadata updating & FTS re-indexing, document soft-deletion with audit trail and semantic search filtering, in-memory preview, export, password rewrapping, and encrypted audit logging.
  - `tests/autoCategorizeAndPersonDetection.test.js`: Unit and integration tests for auto-categorization, family member detection matching known vault members, auto-tag generation, title suggestion, and `preAnalyzeDocument`.
  - `tests/documentDeletion.test.js`: Comprehensive integration tests for multi-document deletion, FTS search removal, semantic vector search cleanup, immutable disk object preservation, and audit logging.
  - `tests/extraction.test.js`: Unit and integration tests for date extraction, document classification, deterministic expiry calculation, metadata review confirmation, and upcoming expiries queries.
  - `tests/embedding.test.js`: Unit and integration tests for passage chunking, normalized vector generation, cosine similarity, BLOB serialization, and end-to-end semantic search across encrypted vault documents.
  - `tests/llmService.test.js`: Unit tests for local grounded document Q&A, citation extraction, missing-knowledge handling, localhost binding security, and OCR travel ticket/schedule retrieval.
  - `tests/backup.test.js`: Integration tests for encrypted portable vault backup creation, tamper detection, and complete restoration.
  - `tests/ipcValidation.test.js`: Security and input validation tests (path traversal protection, schema enforcement).

## Implementation status

| Area | Status | Verified By |
| --- | --- | --- |
| Documentation and architectural constraints | Documented & Enforced | Manual review & adherence |
| Electron / Desktop UI application | Implemented (Phases 1-6) | Manual & Electron Forge configuration |
| Portable vault format (`.vault`) | Implemented | `tests/vaultService.test.js` |
| SQLCipher storage | Implemented (`better-sqlite3-multiple-ciphers`) | `tests/vaultService.test.js` |
| Argon2id and vault key lifecycle | Implemented | `tests/crypto.test.js`, `tests/vaultService.test.js` |
| Encrypted object storage | Implemented | `tests/crypto.test.js`, `tests/vaultService.test.js` |
| Document import/immutable versioning | Implemented | `tests/vaultService.test.js` |
| Password change without re-encryption | Implemented | `tests/vaultService.test.js` |
| Strict Offline Enforcement (CSP `connect-src 'none'`) | Implemented | `src/index.js` |
| Local Text Extraction & Deterministic Analysis | Implemented (Phase 2) | `tests/extraction.test.js` |
| Metadata Review & Confirmation Flow | Implemented (Phase 2) | `tests/extraction.test.js` |
| Expiry Awareness & Upcoming Expiries View | Implemented (Phase 3) | `tests/extraction.test.js` |
| Full-Text Search (FTS5) | Implemented (Phase 3) | `tests/vaultService.test.js`, `tests/extraction.test.js` |
| Grounded Local Document Q&A with Citations | Implemented (Phase 4) | `tests/llmService.test.js` |
| llama-server process supervision (127.0.0.1 binding) | Implemented (Phase 4) | `src/main/services/llmService.js` |
| Encrypted Portable Backup and Restore | Implemented (Phase 5) | `tests/backup.test.js` |
| Modular Semantic Embeddings Layer | Implemented (Phase 6) | `tests/embedding.test.js` |
| Encrypted Audit Log History & Inspection | Implemented | `tests/vaultService.test.js` |
| Standalone Windows Desktop Packaging | Verified (`electron-forge package`) | Packaged to `out/family-vault-win32-x64/` |
| Local-Wi-Fi sync | Explicitly not implemented | Kept out of scope per architectural constraints |

- **User Database & Cross-Document Contradiction Detection**:
  - `src/main/vault/database.js`:
    - `user_profiles` table: Encrypted at rest in SQLCipher storing canonical biographical, parental, address, academic (10th/12th marks), and educational profiles.
    - `profile_facts` table: Encrypted atomic facts extracted from documents (`dob`, `fathers_name`, `mothers_name`, `address`, `marks_10th`, `marks_12th`, `education`, `gender`) with provenance linking to source documents and versions (`ON DELETE CASCADE`).
    - Cross-document contradiction engine (`getUserProfileWithContradictions`): Groups facts by normalized field values across documents; flags discrepancies when different documents make conflicting claims (e.g. conflicting birthdates, differing father's name spellings, conflicting marks, differing addresses); prepares side-by-side discrepancy reports citing source document titles and text snippets.
  - `src/main/services/extractionService.js`: `extractProfileFacts(text, personName)` parses OCR and plain text to extract parental names, dates of birth, full address strings, 10th marks (percentages, CGPA, boards, years), 12th marks (stream, boards, percentages), and higher education degrees.
  - `src/main/vault/vaultService.js`: Automatically triggers profile fact extraction and canonical profile upserting during document import; exposes `listUserProfiles`, `getUserProfile`, and `saveUserProfile`.
  - `src/index.html` & `src/renderer.js`:
    - "Users & Profiles" sidebar item with real-time profile count badge.
    - Responsive two-pane modal (`#modal-users-profiles`): left pane lists family members with contradiction alert tags (`⚠️ X Discrepancies`); right pane displays structured identity, parental, address, and academic cards alongside source document references.
    - Prominent **Contradiction Alert Box** highlighting conflicting values side-by-side with source document citations.
    - In-app profile editing modal (`#modal-edit-user-profile`) allowing users to override or confirm canonical details.

## Verification Commands Used

```bash
npm test
```
All 32 automated tests pass across:
- `tests/crypto.test.js`
- `tests/vaultService.test.js`
- `tests/userProfile.test.js`
- `tests/autoCategorizeAndPersonDetection.test.js`
- `tests/documentDeletion.test.js`
- `tests/extraction.test.js`
- `tests/embedding.test.js`
- `tests/llmService.test.js`
- `tests/backup.test.js`
- `tests/ipcValidation.test.js`

```bash
npm run package
```
Packaging builds `family-vault.exe` directly in `out/family-vault-win32-x64/` with all native SQLCipher bindings cleanly prepared and **Option B verified**: both `llama-server.exe` and Google Gemma 2 2B weights (`gemma-2-2b-it-Q4_K_M.gguf`, 1.70 GB) are packaged directly under `out/family-vault-win32-x64/resources/` via `packagerConfig.extraResource`, providing a 100% offline out-of-the-box local neural AI experience on first run.

## Distribution Notes

1. **Option B (100% Offline Pre-bundled Distribution)**: Both `bin/` and `models/` are populated and packaged alongside `app.asar`. When installed on any user's PC, FamilyVault immediately starts `llama-server.exe` on `127.0.0.1:18432` without any internet connection.
2. Local Wi-Fi sync is reserved for future approved architecture changes.
