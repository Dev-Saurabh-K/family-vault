# FamilyVault

> **Secure, 100% offline, privacy-first desktop vault for family documents.**  
> Built with Electron, SQLCipher, Argon2id, AES-256-GCM, PaddleOCR, and local Gemma AI.

---

## Table of Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [System Architecture](#system-architecture)
- [Feature Highlights](#feature-highlights)
  - [Portable Vaults & Zero-Knowledge Architecture](#portable-vaults--zero-knowledge-architecture)
  - [Document Ingestion & Live Pre-Analysis](#document-ingestion--live-pre-analysis)
  - [Deep Text Extraction & Dual OCR Pipeline](#deep-text-extraction--dual-ocr-pipeline)
  - [Local AI Grounded Q&A & Metadata Reasoning](#local-ai-grounded-qa--metadata-reasoning)
  - [Biographical Profiles & Contradiction Detection](#biographical-profiles--contradiction-detection)
  - [Search: Keyword (FTS5) & Semantic Similarity](#search-keyword-fts5--semantic-similarity)
  - [Expiry Tracking & Audit Logging](#expiry-tracking--audit-logging)
  - [Dual-Theme UI & Settings Hub](#dual-theme-ui--settings-hub)
- [Cryptographic & Security Model](#cryptographic--security-model)
- [Repository Layout](#repository-layout)
- [System Requirements](#system-requirements)
- [Installation & Setup](#installation--setup)
  - [1. Clone & Install Dependencies](#1-clone--install-dependencies)
  - [2. Run Development App](#2-run-development-app)
  - [3. Local AI Setup (Optional / Offline Bundle)](#3-local-ai-setup-optional--offline-bundle)
- [Build & Packaging](#build--packaging)
- [Automated Test Suite](#automated-test-suite)
- [Explicit Scope Boundaries](#explicit-scope-boundaries)
- [License](#license)

---

## Overview

**FamilyVault** is a Windows desktop application designed to securely organize, understand, and protect sensitive family records—passports, birth certificates, insurance policies, academic transcripts, property deeds, tax filings, and medical histories.

Unlike traditional cloud-based document managers or generic drive storage:
1. **It runs entirely offline.** All encryption, OCR, full-text indexing, vector search, and AI inference execute locally on your machine. Zero bytes leave your computer.
2. **The vault is portable and decoupled from the application.** Documents and metadata reside in a self-contained `.vault` folder structure. The installed app is disposable; your vault remains your own.
3. **Originals are immutable.** Uploaded documents are encrypted and preserved as immutable versions. AI extractions and OCR results are strictly treated as untrusted suggestions, never overwriting original files.

---

## Core Principles

- **Offline by Default & by Design**: No cloud backend, no remote AI APIs, no analytics, no telemetry, and no LAN listeners.
- **Vault-First Architecture**: One master password unlocks a self-contained, portable `.vault` directory containing an encrypted database and encrypted binary objects.
- **Originals are Authoritative**: Derived OCR text, AI summaries, and metadata never modify or replace original documents.
- **Deterministic Code Decides**: Deterministic validation, access control, date calculation, cryptographic verification, and schemas govern all actions; AI models provide suggestions only.
- **Immutable Version History**: Re-uploading an amended or updated document appends a new immutable version rather than overwriting past history.
- **Strict Network Boundary**: Renderer window runs with Node integration disabled, context isolation enabled, and Content Security Policy `connect-src 'none'`.

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             DESKTOP RENDERER                                │
│        Responsive UI (Light / Dark Themes) • Context Isolated Preload       │
│               window.familyVault typed IPC Bridge (No Node.js)              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Validated IPC
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                            ELECTRON MAIN PROCESS                            │
│                                                                             │
│  ┌───────────────────────┐  ┌─────────────────────┐  ┌───────────────────┐  │
│  │ Cryptography Engine   │  │ Vault Core Service  │  │ Database Service  │  │
│  │ • Argon2id KDF        │  │ • Manifest Validation│  │ • SQLCipher DB   │  │
│  │ • AES-256-GCM Envelope│  │ • Encrypted Objects │  │ • SQLite FTS5     │  │
│  │ • HKDF Subkey Deriv   │  │ • Version History   │  │ • Vector Store    │  │
│  │ • Memory Zeroization  │  │ • Backup & Restore  │  │ • Audit Events    │  │
│  └───────────────────────┘  └─────────────────────┘  └───────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────┐  ┌─────────────────────┐  │
│  │ Text Extraction & OCR Pipeline               │  │ Semantic Search     │  │
│  │ • PDF-Parse (Native Digital Text)            │  │ • Feature Hashing   │  │
│  │ • Primary: PaddleOCR PP-OCRv5 (ONNX Runtime) │  │ • Cosine Similarity │  │
│  │ • Fallback: Tesseract.js (Offline)           │  │ • Passage Chunking  │  │
│  │ • Deterministic Date & Issuer Detectors      │  │ • SQLCipher Blobs   │  │
│  └──────────────────────────────────────────────┘  └─────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Local AI Intelligence (Strict Loopback: 127.0.0.1:18432)              │  │
│  │ • Supervised llama-server.exe child process                           │  │
│  │ • Bundled Gemma-4-E2B GGUF Model (Greedy T=0 Decoding)                │  │
│  │ • Defensive JSON Repair & Micro-Prompting                             │  │
│  │ • Grounded Q&A with Document & Profile Citations                      │  │
│  │ • Deterministic Extractive QA Fallback (Active if AI runtime offline) │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ AES-256-GCM / SQLCipher
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                           PORTABLE .vault FOLDER                            │
│  • manifest.json (Salt, KDF parameters, wrapped VMK)                        │
│  • vault.db (SQLCipher encrypted relational database + FTS5)                │
│  • objects/<objectId>.enc (Authenticated AES-256-GCM encrypted binaries)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Feature Highlights

### Portable Vaults & Zero-Knowledge Architecture
- **Single Master Password**: Vault creation and unlocking require only your master password.
- **No Cloud Accounts or Recovery Backdoors**: There are no account servers, third-party reset portals, or recovery keys.
- **Fast Password Change**: Change your vault password without re-encrypting underlying document files; only the Vault Master Key (VMK) wrapper in `manifest.json` is re-encrypted.
- **Portable Backups (`.fvbackup`)**: Export and restore encrypted single-file vault backups with tamper-evident SHA-256 checksums.

### Document Ingestion & Live Pre-Analysis
- **Real-Time Analysis on Browse**: Select an image or PDF, and FamilyVault's pre-analysis engine instantly extracts text via OCR and deterministically predicts:
  - Suggested document title
  - Classification (`identity`, `insurance`, `medical`, `tax`, `property`, `other`)
  - Family member association (matched against registered vault profiles)
  - Issue & expiration dates
  - Issuing authority
  - Relevant category tags
- **Full User Control**: Review, amend, or accept extracted metadata in the import modal before encrypting and writing to disk.
- **Instant Save**: Pre-analyzed metadata is passed directly to the vault storage engine, completing document import in under 100ms.

### Deep Text Extraction & Dual OCR Pipeline
- **Native PDF Ingestion**: Extracts digital text layers with spatial heuristics via `pdf-parse`.
- **Primary OCR: PaddleOCR PP-OCRv5**:
  - Executes directly via `onnxruntime-node` on CPU or DirectML.
  - Generates word-level coordinates (`{ text, x, y, width, height, confidence }`).
  - Reconstructs columnar tables, receipts, ID cards, and multi-column documents with high deterministic precision.
- **Reliable Fallback: Tesseract.js**: Automatically engaged if PaddleOCR encounters an error or unsupported format.
- **Deterministic Date Intelligence**: Supports ISO, DMY, MDY, hyphenated formats (`14-APR-2031`), bilingual month names, and standard ID abbreviations (`EXP`, `DOE`, `VAL THRU`, `DOI`, `EFF`).

### Local AI Grounded Q&A & Metadata Reasoning
- **Bundled Gemma-4-E2B Model**: Runs locally via `llama-server.exe` bound exclusively to loopback `127.0.0.1:18432`.
- **Grounded Q&A with Citations**: Ask natural language questions across your family's documents. Responses cite specific source documents and biographical profile fields.
- **Anti-Hallucination Boundaries**:
  - Prompts execute with greedy decoding (`temperature = 0.0`).
  - Family member queries are restricted strictly to that person's documents.
  - Unknown or contradictory facts are explicitly flagged as unresolved rather than guessed.
- **Deterministic Extractive Fallback**: If the local AI runtime or model weights are not loaded, a rule-based extractive search engine takes over seamlessly without interrupting Q&A.

### Biographical Profiles & Contradiction Detection
- **Family Member Registry**: Manage canonical records for each family member (names, birth dates, parents, addresses, academic records, ID numbers).
- **Background Fact Ingestion**: When new documents are saved, relevant biographical facts are extracted and linked to the source document.
- **Cross-Document Contradiction Engine**: Flags discrepancies when different documents make conflicting claims (e.g., differing dates of birth, mismatched father's name spellings, differing addresses), providing side-by-side discrepancy reports citing source files.

### Search: Keyword (FTS5) & Semantic Similarity
- **Full-Text Search (SQLite FTS5)**: Search document titles, extracted OCR text, issuers, tags, and notes with sub-millisecond query response times.
- **Modular Semantic Search**: Toggle semantic search mode to retrieve documents based on conceptual meaning using localized feature-vector embeddings and cosine similarity scoring.
- **Defensive Fallback**: If vector operations encounter an issue, search automatically cascades to full-text keyword retrieval.

### Expiry Tracking & Audit Logging
- **Expiry Alert Dashboard**: Automatically tracks active, expiring soon (within 60/90 days), and expired documents (passports, driver's licenses, insurance policies, certifications).
- **Tamper-Evident Encrypted Audit Trail**: Records key vault events (`VAULT_CREATED`, `DOCUMENT_IMPORTED`, `DOCUMENT_DELETED`, `PASSWORD_CHANGED`, `FAMILY_MEMBER_ADDED`) in an encrypted SQLCipher table with 1-click JSON export.
- **Soft Deletion Safety**: Deleting a document removes its index entries and records an audit log while safely preserving raw encrypted disk objects to prevent catastrophic accidental data loss.

### Dual-Theme UI & Settings Hub
- **Warm Off-White Light Mode**: Clean ivory canvas (`#f7f6f2`), warm stone sidebar (`#f0eee8`), crisp white cards, and charcoal typography.
- **Stealth Slate Dark Mode**: Deep slate background (`#212121`), subtle borders, and emerald accents.
- **Instant Persistence**: Instant theme switching in the launcher and navigation bar with zero flash of unstyled content.

---

## Cryptographic & Security Model

FamilyVault follows the security guidelines documented in [`SECURITY.md`](SECURITY.md):

| Component | Specification | Description |
| --- | --- | --- |
| **KDF** | Argon2id | Derives a 256-bit Key Encryption Key (KEK) using `@noble/hashes`. Uses high memory and iteration parameters with a 16-byte cryptographically secure random salt. |
| **VMK** | CSPRNG 256-bit Key | Vault Master Key generated using Node.js `crypto.randomBytes(32)`. Never persisted in plaintext. |
| **Key Wrapping** | AES-256-GCM | VMK is wrapped by the KEK with a 12-byte IV and 16-byte authentication tag in `manifest.json`. |
| **Subkey Derivation** | HKDF-SHA256 | Derives distinct subkeys (`dbKey`, `objectKey`) from the VMK to enforce cryptographic domain separation. |
| **Object Encryption** | AES-256-GCM (`FVOBJ001`) | Binary documents are stored as encrypted envelopes with magic header `FVOBJ001`, 12-byte IV, 16-byte tag, and SHA-256 integrity digest. |
| **Database Encryption**| SQLCipher (v4) | Relational database `vault.db` is encrypted at rest using `better-sqlite3-multiple-ciphers` with raw key material derived via HKDF. |
| **Key Lifecycle** | Memory Zeroization | Key buffers are explicitly scrubbed (`buffer.fill(0)`) upon vault lock, process termination, or error conditions. |
| **IPC Isolation** | Electron ContextBridge | Renderer has no direct Node.js or filesystem access. All IPC channels are strictly validated with Zod schemas. |
| **Network Isolation** | CSP `connect-src 'none'` | Loopback AI requests (`127.0.0.1:18432`) are performed solely by the main process. Zero outbound internet capability. |

---

## Repository Layout

```text
family-vault/
├── bin/                          # Optional bundled local llama-server binaries
├── models/                       # Local model weights
│   ├── gemma-4-e2b.gguf          # Multimodal local LLM weights
│   └── paddleocr/                # Bundled ONNX models for PP-OCRv5
├── docs/                         # Architecture & design documents
│   ├── AI_OPTIMIZATION_PLAN.md
│   ├── OCR_PADDLEOCR_INTEGRATION.md
│   └── PROFILE_BACKGROUND_EXTRACTION.md
├── scripts/                      # Setup and verification utilities
│   ├── evaluate-gemma-qa.js      # Grounded Q&A benchmark suite
│   ├── setup-ai.js               # CLI downloader for llama-server & Gemma
│   └── sync-release.js           # Release bundling utility
├── src/
│   ├── index.html                # Responsive desktop interface markup
│   ├── index.css                 # Dual-theme styling (Light & Dark modes)
│   ├── index.js                  # Electron main process entry point & CSP
│   ├── preload.js                # Secure context-isolated IPC bridge
│   ├── renderer.js               # Desktop UI controller & view state
│   ├── main/
│   │   ├── crypto/               # Cryptographic primitives
│   │   │   ├── cipher.js         # AES-256-GCM envelope encryption & verification
│   │   │   ├── kdf.js            # Argon2id KEK derivation
│   │   │   └── keys.js           # VMK generation, HKDF subkeys, zeroization
│   │   ├── services/             # Core processing services
│   │   │   ├── embeddingService.js  # Offline passage chunking & feature hashing
│   │   │   ├── extractionService.js # PDF parsing, OCR routing, metadata rules
│   │   │   ├── llmService.js        # Local llama-server runner & grounded Q&A
│   │   │   └── paddleOcrService.js  # Offline PaddleOCR (PP-OCRv5) engine
│   │   └── vault/                # Vault persistence & state
│   │       ├── backupService.js  # Encrypted .fvbackup export and restoration
│   │       ├── database.js       # SQLCipher schema, FTS5 sync, profiles
│   │       ├── manifest.js       # Manifest schema validation & atomic write
│   │       ├── objectStore.js    # Encrypted object storage (objects/<id>.enc)
│   │       └── vaultService.js   # Master vault lifecycle orchestration
│   └── shared/                   # Shared validation schemas & IPC contracts
├── tests/                        # Automated unit and integration tests
├── AGENTS.md                     # Agent development rules and change levels
├── ARCHITECTURE.md               # Architectural boundaries and flow diagrams
├── CURRENT_STATE.md              # Living implementation record and verification status
├── PROJECT.md                    # Product principles and scope constraints
├── SECURITY.md                   # Formal security model and threat handling
└── package.json                  # Dependencies, build scripts, and configuration
```

---

## System Requirements

- **Operating System**: Windows 10 or Windows 11 (64-bit).
- **Runtime**: Node.js 20.x or later (for development).
- **Architecture**: x64 with AVX2 support (standard on modern Intel/AMD processors).
- **Memory**:
  - 4 GB RAM minimum for vault operations and standard OCR.
  - 8 GB+ RAM recommended when running the local Gemma-4-E2B AI model.
- **Storage**:
  - ~150 MB for the base application.
  - Optional ~3.5 GB for local Gemma AI model weights and `llama-server.exe`.

---

## Installation & Setup

### 1. Clone & Install Dependencies

```powershell
git clone https://github.com/your-username/family-vault.git
cd family-vault
npm install
```

### 2. Run Development App

Launch the application directly from source:

```powershell
npm start
```

Upon launch, FamilyVault displays the vault launcher:
1. **Create Vault**: Choose an empty directory, enter a strong password, and create your `.vault`.
2. **Unlock Vault**: Select an existing `.vault` folder and unlock it with your password.
3. **Restore Backup**: Select a `.fvbackup` archive and restore your vault.

### 3. Local AI Setup (Optional / Offline Bundle)

FamilyVault is fully functional without AI dependencies (using deterministic text extraction, PaddleOCR/Tesseract, and SQLite FTS5 search). To enable local conversational Q&A and AI metadata reasoning:

#### Option A: In-App 1-Click Setup
Open the **Ask Assistant** modal inside the application and click **Download Local AI Runtime**. The app streams download progress directly in the UI.

#### Option B: Terminal Setup Script
Run the automated downloader from PowerShell:

```powershell
npm run setup:ai
```

This downloads `llama-server.exe` into `bin/` and `gemma-4-e2b.gguf` into `models/`. Once downloaded, FamilyVault will automatically supervise the local inference engine on `127.0.0.1:18432` with zero network exposure.

---

## Build & Packaging

FamilyVault uses **Electron Forge** with prebuilt native module bindings (`better-sqlite3-multiple-ciphers`, `onnxruntime-node`).

### Package Executable
To compile and package the standalone Windows application:

```powershell
npm run package
```
The packaged build is placed in:
```text
out/family-vault-win32-x64/
├── family-vault.exe
├── resources/
│   ├── app.asar
│   ├── bin/                 # llama-server.exe (when pre-bundled)
│   └── models/              # PaddleOCR and Gemma model weights
```

### Create Distributable Installers
To create Windows Squirrel installers and ZIP distributions:

```powershell
npm run make
```
Distributables are generated in `out/make/`.

---

## Automated Test Suite

FamilyVault maintains comprehensive automated unit, integration, and security tests using the Node.js native test runner.

Run the entire test suite:

```powershell
npm test
```

### Test Coverage Breakdown
All 133 automated tests pass across 12 test suites:

- `tests/crypto.test.js`: Argon2id KDF, AES-256-GCM envelope, VMK wrapping/unwrapping, subkey derivation, memory zeroization.
- `tests/vaultService.test.js`: Vault creation, password unlock, tamper detection, immutable version history, inline metadata editing, password rewrapping, and audit logging.
- `tests/userProfile.test.js`: Biographical facts extraction, profile updates, and cross-document contradiction detection.
- `tests/autoCategorizeAndPersonDetection.test.js`: Automatic categorization, family member detection against vault registry, auto-tag generation, title suggestions, and pre-analysis.
- `tests/documentDeletion.test.js`: Document soft-deletion, index purging, disk object preservation, and audit logging.
- `tests/extraction.test.js`: Date detection (ISO, DMY, MDY, abbreviations), authority recognition, document classification, and expiry calculation.
- `tests/paddleOcr.test.js`: PaddleOCR model loading, coordinate extraction, pipeline routing, and fallback handling.
- `tests/embedding.test.js`: Text chunking, feature vectorization, cosine similarity, BLOB serialization, and semantic search.
- `tests/llmService.test.js`: Grounded Q&A, citation verification, missing knowledge rejection, loopback port binding security, and deterministic extractive QA fallback.
- `tests/backup.test.js`: Portable `.fvbackup` creation, cryptographic restoration, and tamper detection.
- `tests/ipcValidation.test.js`: IPC schema validation and path traversal defenses.
- `tests/theme.test.js`: Theme switching and stylesheet configuration integrity.

---

## Explicit Scope Boundaries

To maintain strict security and air-gapped privacy, the following are **strictly out of scope**:
- ❌ **No Cloud Sync or Cloud Storage**: No AWS, GCP, Azure, or remote web backends.
- ❌ **No Remote AI APIs**: No external requests to OpenAI, Anthropic, Google Gemini, or cloud LLMs.
- ❌ **No Telemetry or Analytics**: Zero tracking, error reporting pings, or background usage reporting.
- ❌ **No LAN Listeners**: `llama-server.exe` is bound strictly to `127.0.0.1`; no local network access or Wi-Fi sync is currently enabled.
- ❌ **No Account or Recovery Systems**: Password-only unlock; no biometric, DPAPI, or administrative override bypasses.

---

## License

FamilyVault is released under the **MIT License**. See the repository for details.
