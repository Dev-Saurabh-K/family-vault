# Comprehensive Audit: Untrackable Elements in FamilyVault

**Project:** FamilyVault (Offline Secure Family Document Vault)  
**Date:** October 2026  
**Status:** Audit & Analysis Report (No Code Modified)  
**Scope:** Repository, Vault Storage, Audit Logs, AI/OCR Pipeline, Ephemeral State, and Environmental Configuration  

---

## Executive Summary

This audit catalogs all items, states, data points, and operational events across the **FamilyVault** project that are **untrackable**. 

In FamilyVault, untrackability arises from three distinct causes:
1. **Security & Privacy by Design**: Deliberate decisions to eliminate tracking (e.g. strict offline operation, zero telemetry, memory zeroization of cryptographic keys, scrubbing host filesystem paths).
2. **Version Control & Physical Storage Constraints**: File size limitations (e.g. multi-gigabyte neural network model weights) and append-only encrypted disk object storage.
3. **Audit Trail & System Observability Gaps**: Operations in the current codebase that occur without recording events in the encrypted `audit_events` table or database changelogs.

---

## 1. Version Control & Repository Untrackables (Git Level)

The following components cannot or should not be tracked by Git, along with identified `.gitignore` blind spots:

### 1.1 Large AI Model Weights (GGUF Weights)
* **Location:** `models/gemma-4-e2b.gguf` (~3.11 GB), `models/mmproj-gemma-4-e2b.gguf` (~986 MB).
* **Why Untrackable:** Standard Git and remote hosting providers (e.g. GitHub) enforce strict file size limits (100 MB hard limit). These binary weights cannot be tracked in version control and are ignored via `.gitignore`.
* **Impact:** Requires out-of-band provisioning via `scripts/setup-ai.js` (`npm run setup:ai`) or Electron Forge extra resources packaging.
* *(Note: PaddleOCR models in `models/paddleocr/*.ort` are ~5 MB to ~8 MB and are currently tracked in Git).*

### 1.2 Compiled Platform Binaries
* **Location:** `bin/*.exe` (`bin/llama-server.exe`, benchmark utilities, test binaries).
* **Why Untrackable:** Compiled C++ native binaries for Windows x64 cannot be tracked across platforms or diffed in source control. Ignored via `.gitignore`.

### 1.3 Packaged Application Releases & Build Artifacts
* **Location:** `out/` (e.g. `out/family-vault-win32-x64/`).
* **Why Untrackable:** Generated binary builds and bundled ASAR archives are ephemeral distribution targets.

### 1.4 Native Node Addons (`.node` binaries)
* **Location:** `node_modules/better-sqlite3-multiple-ciphers/`, `node_modules/onnxruntime-node/bin/`.
* **Why Untrackable:** Platform-specific compiled C/C++ addons installed dynamically during `npm install`.

### 1.5 Identified `.gitignore` Blind Spots (Potential Leak Risks)
* **Vault Storage Directories (`*.vault/`)**: The `.gitignore` does not contain `*.vault`. If a developer creates a test or real vault inside the repository workspace (e.g., `MyFamily.vault/`), Git treats it as untracked files, posing a risk of accidental staging of encrypted user documents or database files (`git add .`).
* **Vault Backup Archives (`*.fvbackup`)**: Portable backup files created in the workspace are not ignored.
* **Partial Downloads (`*.download`)**: `scripts/setup-ai.js` downloads model files with a `.download` suffix. Interrupted downloads in root or subdirectories are not explicitly ignored.

---

## 2. Vault Storage & Physical Filesystem Untrackables (On-Disk Data)

### 2.1 Orphaned Encrypted Objects in `objects/`
* **Mechanism:** Documents are stored as encrypted blobs in `objects/<objectId>.enc` with authenticated headers (`FVOBJ001`).
* **Untrackable Scenarios:**
  * **Soft-Deleted Documents:** When a document is soft-deleted (`deleteDocument()`), the database sets `is_deleted = 1` and purges FTS/vector indexes. In accordance with data preservation rules, the physical file `objects/<objectId>.enc` is retained on disk indefinitely. However, there is no orphan index or reference counter; without querying SQLCipher, disk objects cannot be tracked to active vs deleted documents.
  * **Interrupted Imports:** If `storeObject()` writes the encrypted object to disk and a subsequent step (such as SQLite transaction, OCR, or process interruption) fails before `createDocumentVersion()` commits, the `.enc` file remains on disk forever, untracked by `vault.db`.
* **Garbage Collection:** There is no garbage collection or orphan-detection scanner in the current vault implementation.

### 2.2 Host File Origin & Provenance
* **Mechanism:** During `importDocument({ filePath })`, only `file_name` (basename), `file_size`, and `mime_type` are persisted in `document_versions`.
* **Untrackable Data:** The original host filesystem path (e.g. `C:\Users\Username\Documents\Personal\passport.pdf`) is deliberately scrubbed. Once imported, where the document came from on the user's hard drive is completely untrackable.

### 2.3 Host Filesystem Timestamps & Attributes
* **Untrackable Data:** The original file creation (`ctime`), last modified (`mtime`), and file permissions from the host operating system are not stored. `created_at` records only the timestamp when the document was imported into FamilyVault.

### 2.4 Cryptographic Content Opacity at Rest
* **Mechanism:** All files in `objects/*.enc` are encrypted with AES-256-GCM using keys derived from the Vault Master Key (VMK).
* **Untrackable State:** To any external process, OS file indexer, or backup tool, the contents, document types, owners, and dates of objects on disk are completely untrackable without the master password.

---

## 3. Audit Trail & System Observability Gaps (`audit_events` Table)

The encrypted `audit_events` table logs major lifecycle events (`VAULT_CREATED`, `VAULT_UNLOCKED`, `VAULT_LOCKED`, `PASSWORD_CHANGED`, `DOCUMENT_IMPORTED`, `VERSION_ADDED`, `DOCUMENT_METADATA_UPDATED`, `METADATA_REVIEWED`, `DOCUMENT_DELETED`, `VERSION_EXPORTED`, `FAMILY_MEMBER_ADDED`, `FAMILY_MEMBER_REMOVED`, `BACKUP_CREATED`, `AUDIT_LOGS_EXPORTED`). 

However, several operations remain **untrackable** in the audit log:

### 3.1 Document Decryption & Viewing (Read Access)
* **Code Reference:** `VaultService.getDocumentVersionContent({ versionId })`.
* **Status:** **Untracked.**
* **Explanation:** When a user opens a document to view or preview it in the drawer, the encrypted blob is read, decrypted into memory, and returned as base64. No `DOCUMENT_VIEWED` or `DOCUMENT_READ` audit event is recorded. An authorized user can inspect any document without leaving a trace in the audit log.

### 3.2 Search & Inquiries (Keywords and Semantic Search)
* **Code Reference:** `VaultService.listDocuments({ search })` and `VaultService.searchSemantic({ query })`.
* **Status:** **Untracked.**
* **Explanation:** Queries executed against the SQLite FTS5 index and semantic vector similarity searches are not logged. What terms were searched and when is untrackable.

### 3.3 Local AI Inquiries & Prompts
* **Code Reference:** `VaultService.askQuestion(query)` / `LlmService.answerQuestion()`.
* **Status:** **Untracked.**
* **Explanation:** Questions submitted to the AI Assistant and generated responses with citations are not recorded in `audit_events`.

### 3.4 Failed Master Password Unlock Attempts (Brute-Force Attacks)
* **Code Reference:** `VaultService.unlockVault({ password })`.
* **Status:** **Untracked inside the Vault.**
* **Explanation:** Because `audit_events` lives inside the encrypted SQLCipher database, a failed unlock attempt means the database cannot be opened. Therefore, failed attempts cannot be written to the database. An adversary attempting brute-force guesses leaves zero log entries inside the vault.

### 3.5 Profile Modifications via `saveUserProfile`
* **Code Reference:** `VaultService.saveUserProfile(profile)` / `dbLayer.upsertUserProfile`.
* **Status:** **Untracked.**
* **Explanation:** While `addFamilyMember` logs `FAMILY_MEMBER_ADDED` and `removeFamilyMember` logs `FAMILY_MEMBER_REMOVED`, calling `saveUserProfile` (which modifies DOB, address, parentage, or academic marks) does not record an audit event.

### 3.6 Contradiction Resolution & Discrepancy Decisions
* **Code Reference:** `dbLayer.getUserProfileWithContradictions`.
* **Status:** **Untracked.**
* **Explanation:** Cross-document contradictions (e.g. differing birth dates on passport vs license) are calculated dynamically in-memory. If a user manually edits a canonical profile value to resolve a discrepancy, no record is made documenting which contradictory fact was rejected or why.

### 3.7 Historical Metadata Diffs (No Rollback History)
* **Code Reference:** `VaultService.updateDocumentMetadata`.
* **Status:** **Prior Values Untracked.**
* **Explanation:** `DOCUMENT_METADATA_UPDATED` records `{ changedFields: { ... } }` with the *new* values, but the *prior* values in `documents` are overwritten in-place. There is no historical diff table or metadata revision history.

### 3.8 Vault Restores (`restoreBackup`)
* **Code Reference:** `VaultService.restoreBackup` / `restoreVaultBackup`.
* **Status:** **Untracked in Log.**
* **Explanation:** `createBackup` records `BACKUP_CREATED`, but `restoreBackup` copies the archive to disk without unlocking the database, leaving no `BACKUP_RESTORED` event in the restored database.

### 3.9 Discarded Document Pre-Analysis Sessions
* **Code Reference:** `VaultService.preAnalyzeDocument(filePath)`.
* **Status:** **Untracked.**
* **Explanation:** When a user selects a file in the import modal, OCR and LLM pre-analysis run in memory. If the user cancels the modal, the fact that this document was read and analyzed in memory leaves no log.

### 3.10 Abnormal Application Crashes & Forceful Terminations
* **Code Reference:** `src/index.js` (`before-quit`).
* **Status:** **Untracked.**
* **Explanation:** `VAULT_LOCKED` is logged on clean exit. If the process is killed via Task Manager, crashes at the native layer, or loses power, no lock event is recorded.

---

## 4. Deep Document Content Untrackables (Things Inside Documents)

When physical or digital documents are ingested, certain internal elements cannot be parsed or tracked by the deterministic and OCR/LLM pipelines:

### 4.1 Non-Textual Visual Elements
* **Signatures & Handwritten Endorsements:** PaddleOCR and Tesseract detect text characters. Physical cursive signatures and official signing blocks are untracked as structured identity assertions.
* **Rubber Stamps, Seals, and Watermarks:** Official government or corporate ink stamps, embossed seals, and background security watermarks are ignored or filtered out as noise.
* **Photographs & Biometric Graphics:** Headshots on passports or IDs are stored in the raw document image but are untracked in structured metadata.

### 4.2 Non-Standard Tables & Flow Structure
* **Complex Multi-Column or Rotated Layouts:** While PaddleOCR extracts bounding coordinates `{ text, x, y, width, height, confidence }`, irregular table grids, nested cells, or slanted text can lose reading order during text reconstruction.

### 4.3 PDF Internal Layers & Metadata
* **Vector Paths & Annotations:** Embedded vector drawings, form XObjects, PDF annotations, and embedded fonts are flattened during rendering and not tracked as discrete PDF objects.
* **Hidden Revisions & Incremental Updates:** Multi-revision PDFs containing hidden or redacted layers only expose rendered visual text.

---

## 5. Ephemeral In-Memory State (Untrackable by Cryptographic Design)

In strict adherence to `SECURITY.md`, several runtime artifacts are intentionally untrackable at rest:

### 5.1 In-Memory Cryptographic Master & Subkeys
* **Key Material:** Vault Master Key (VMK), `dbKey`, `objectKey`, and Argon2id KEK.
* **Lifecycle:** Kept exclusively in volatile process heap buffers.
* **Zeroization:** Cleared with `crypto.randomFillSync()` / `buffer.fill(0)` on vault lock. They leave zero traces in swap or storage by design.

### 5.2 Decrypted File Buffers
* **Lifecycle:** Decrypted bytes for in-memory preview are converted to Base64 data strings for IPC transmission and garbage-collected after rendering. No unencrypted temporary files are written to the host filesystem.

### 5.3 AI Assistant Conversational Chat History
* **Lifecycle:** The multi-turn chat conversation with the local Gemma model lives entirely in renderer DOM memory (`chatHistory`).
* **Persistence:** When the user closes the modal, navigates away, or locks the vault, the conversation history is completely discarded. There is no conversation history table in `vault.db`.

### 5.4 Raw LLM Prompts & Responses
* **Policy:** `SECURITY.md` mandates: *"Never log passwords, keys, decrypted text, document bytes, or sensitive prompts/responses."*
* **Untrackability:** Raw prompt payloads sent to `llama-server.exe` on `127.0.0.1:18432` and raw text completions are neither logged to disk nor stored in the database.

---

## 6. Host Environment & Portability Gaps

### 6.1 Application Display Settings Across Devices
* **Storage Location:** Electron renderer `window.localStorage` (`fv_theme`).
* **Untrackability Across Machines:** Because theme preference is saved in the host machine's Chromium user data profile rather than inside `manifest.json` or `vault.db`, moving a `.vault` directory to another computer does not preserve the user's theme preference.

### 6.2 Window Geometry & Recent Vault Locations
* **Status:** Window size and last-opened vault paths are not recorded inside the portable vault format.

### 6.3 Remote Telemetry & Diagnostics (Zero by Design)
* **Policy:** `PROJECT.md` mandates: *"No cloud backend, remote API, document upload, telemetry, analytics, or advertising."*
* **Status:** All usage metrics, error rates, and crash reports are 100% untrackable remotely.

---

## 7. Summary Matrix: Tracked vs. Untrackable Elements

| Domain | Tracked Elements | Untrackable Elements | Primary Reason |
| :--- | :--- | :--- | :--- |
| **Source Control (Git)** | Code, tests, documentation, OCR models (`.ort`) | Model weights (`.gguf`), Windows binaries (`.exe`), build outputs (`out/`) | GitHub 100MB limit; platform binaries |
| **Git Configuration** | `node_modules/`, `bin/*.exe`, `models/*.gguf` | `*.vault`, `*.fvbackup`, `*.download` | Gaps in `.gitignore` |
| **Disk Storage** | Active versions, valid object envelopes | Orphaned `.enc` files from deleted docs or aborted imports | Append-only security model; no GC |
| **Document Lineage** | Filename, filesize, SHA-256 hash, import date | Original host filesystem path, original OS ctime/mtime | Privacy preservation; portability |
| **Audit Log: Reads** | Exported versions (`VERSION_EXPORTED`) | In-app document view / decryption (`getDocumentVersionContent`) | Gaps in read auditing |
| **Audit Log: Queries** | None | Keyword searches, semantic vector searches, AI Q&A prompts | Untracked operations |
| **Audit Log: Auth** | Successful unlock (`VAULT_UNLOCKED`) | Failed master password attempts | Database encrypted at rest during failure |
| **Audit Log: Profiles**| Added / removed members (`FAMILY_MEMBER_ADDED`) | In-place edits (`saveUserProfile`), discrepancy resolutions | Method omission in `vaultService` |
| **Audit Log: Metadata**| Current metadata state, change event timestamps | Historical metadata diffs / prior field values | In-place update schema |
| **Document Content** | OCR text, spatial coordinates, extracted dates/names | Handwritten signatures, stamps, seals, photo faces | OCR engine scope limitations |
| **Runtime Memory** | None (by design) | Master keys (VMK, dbKey), decrypted buffers, chat history | Security zeroization & RAM lifecycle |
| **User Preferences** | None in vault container | UI theme (`fv_theme`), window size, active tab | Stored in host `localStorage`, not vault |
| **Diagnostics** | Local encrypted audit logs | Remote crashes, telemetry, analytics | Strict offline privacy constraint |

---

## 8. Observations & Recommendations (For Future Considerations)

*(Provided for architectural awareness; no code changes have been applied per instructions)*

1. **Harden `.gitignore`:**
   Add `*.vault`, `*.vault/`, `*.fvbackup`, and `*.download` to `.gitignore` to prevent inadvertent commits of test or personal vaults into source control.
2. **Add Read-Access Auditing:**
   Consider logging `DOCUMENT_VIEWED` in `audit_events` inside `getDocumentVersionContent` if internal auditability of document access is desired.
3. **Log Profile Modifications:**
   Call `recordAuditEvent(this._db, 'PROFILE_UPDATED', ...)` in `VaultService.saveUserProfile`.
4. **Implement an Object Orphan Checker:**
   Add a maintenance/integrity utility that reconciles physical files in `objects/` against active and soft-deleted references in `document_versions`.
5. **Persist Vault UI Preferences in `manifest.json` or `vault.db`:**
   If cross-machine theme portability is desired, store UI preferences inside the encrypted vault container rather than host `localStorage`.
