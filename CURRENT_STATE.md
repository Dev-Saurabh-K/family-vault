# Current Repository State

Last updated: 2026-10-03 (Asia/Kolkata)

## What exists

The repository contains a complete, fully tested, functional implementation of FamilyVault Phases 1 through 5:

- **Documentation**: `AGENTS.md`, `PROJECT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRODUCT_REQUIREMENTS.md`, and `CURRENT_STATE.md`.
- **Core Cryptography**:
  - `src/main/crypto/kdf.js`: Argon2id KEK derivation with `@noble/hashes`.
  - `src/main/crypto/cipher.js`: AES-256-GCM authenticated cipher for VMK wrapping and object envelope encryption/decryption with `FVOBJ001` header.
  - `src/main/crypto/keys.js`: 256-bit random VMK generation, HKDF-SHA256 subkey derivation (`dbKey`, `objectKey`), and memory zeroization.
- **Vault Core & Storage**:
  - `src/main/vault/manifest.js`: Versioned `manifest.json` schema validation (Zod) and atomic persistence.
  - `src/main/vault/objectStore.js`: Encrypted immutable object storage under `objects/<objectId>.enc` with SHA-256 integrity and path traversal protection.
  - `src/main/vault/database.js`: SQLCipher encrypted relational SQLite database with tables for `documents`, immutable `document_versions`, `extracted_metadata`, and `audit_events`, plus FTS5 virtual table synchronization.
  - `src/main/vault/vaultService.js`: Vault lifecycle management (create, unlock, lock, zeroize keys, password rewrapping, document import with automatic offline text extraction & analysis, immutable version appending, export, metadata review/confirmation, upcoming expiries, grounded local AI Q&A, and portable encrypted backup/restore).
  - `src/main/vault/backupService.js`: Portable encrypted vault backup generation (`.fvbackup`) and cryptographic restoration with SHA-256 tamper verification.
- **Text Extraction & Deterministic Analysis**:
  - `src/main/services/extractionService.js`: Offline PDF text extraction (`pdf-parse`), image OCR pipeline (`tesseract.js`), deterministic date detection (ISO, DMY, MDY formats), document classification (passports, driving licenses, insurance policies, tax documents, medical records, property/deeds), source match/provenance extraction, and deterministic expiry status logic (`active`, `expiring_soon`, `expired`).
- **Local AI & Grounded Document Q&A**:
  - `src/main/services/llmService.js`: Grounded local document question answering engine with citations. Manages local `llama-server.exe` child process (enforcing strict `--host 127.0.0.1` binding, no LAN, no web UI) with a built-in deterministic extractive QA fallback that scores passages by distinct query term coverage, formats citations, and guarantees no cloud leakage.
- **Electron Shell & UI**:
  - `src/main/ipc.js`: Strictly typed and validated IPC handlers including metadata review, upcoming expiries, AI assistant Q&A, and encrypted backup/restore.
  - `src/preload.js`: Secure context-isolated bridge exposing `window.familyVault`.
  - `src/index.js`: Electron main process with strict Content Security Policy (`connect-src 'none'`), sandbox mode, and lock-on-exit key cleanup.
  - `src/index.html`, `src/index.css`, `src/renderer.js`: Responsive dark-mode desktop UI supporting vault launcher, backup restore tab, document workspace, category filters, upcoming expiries sidebar views, search bar, import modal, detail drawer with in-memory preview, metadata review and confirmation modal, provenance snippets, immutable version history timeline, version upload, password change modal, and interactive Grounded AI Assistant modal with clickable citations.
- **Test Suite**:
  - `tests/crypto.test.js`: Unit tests for Argon2id, VMK wrapping/unwrapping, AES-256-GCM envelope, HKDF, and zeroization.
  - `tests/vaultService.test.js`: Integration tests for vault creation, unlock with password, lock zeroization, tamper detection, document import, immutable multi-version history, in-memory preview, export, and password rewrapping.
  - `tests/extraction.test.js`: Unit and integration tests for date extraction, document classification, deterministic expiry calculation, metadata review confirmation, and upcoming expiries queries.
  - `tests/llmService.test.js`: Unit tests for local grounded document Q&A, citation extraction, missing-knowledge handling, and localhost binding security.
  - `tests/backup.test.js`: Integration tests for encrypted portable vault backup creation, tamper detection, and complete restoration.
  - `tests/ipcValidation.test.js`: Security and input validation tests (path traversal protection, schema enforcement).

## Implementation status

| Area | Status | Verified By |
| --- | --- | --- |
| Documentation and architectural constraints | Documented & Enforced | Manual review & adherence |
| Electron / Desktop UI application | Implemented (Phases 1-5) | Manual & Electron Forge configuration |
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
| Optional embeddings/vector search | Not started (Planned Phase 6) | Pending Phase 6 |
| Local-Wi-Fi sync | Explicitly not implemented | Kept out of scope |

## Verification Commands Used

```bash
npm test
```
All 13 tests pass across:
- `tests/crypto.test.js`
- `tests/vaultService.test.js`
- `tests/extraction.test.js`
- `tests/llmService.test.js`
- `tests/backup.test.js`
- `tests/ipcValidation.test.js`

## Remaining Limitations & Next Steps

1. Bundling the final precompiled `llama-server.exe` executable and Qwen3 4B GGUF weights into the release installer distribution outside `app.asar`.
2. Phase 6 (optional semantic retrieval / vector embeddings layer) can be evaluated after production field use.
