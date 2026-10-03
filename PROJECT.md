# FamilyVault

## Purpose

FamilyVault is a secure, offline Windows desktop vault for a family's important documents: PDFs, scanned PDFs, and common image formats. It securely stores originals, extracts useful text and metadata locally, and helps people find information, track dates, and ask document-grounded questions.

The installed application is replaceable. A user's vault is their data and must be portable independently of the application.

## Product principles

- **Offline by default and by design.** Documents, OCR, AI inference, indexing, and search run locally.
- **Vault-first.** One dedicated vault is opened by the application; data is not scattered across application folders.
- **Originals are authoritative.** Derived text, metadata, summaries, and AI answers never replace originals.
- **AI assists; deterministic code decides.** Validation, access control, encryption, dates, reminders, and queries remain application responsibilities.
- **Keep history.** Documents have immutable versions; importing an updated copy creates a new version rather than replacing history.
- **Portable and future-ready.** The data model supports future local-Wi-Fi sync and encrypted backups without implementing sync now.

## In scope

- Create, unlock, lock, and open portable vaults.
- Import and retain encrypted document originals and immutable versions.
- Local text extraction and Tesseract.js-based OCR with detailed word-level coordinate extraction ({ text, x, y, width, height, confidence }) for structured data and table understanding.
- Structured metadata and full-text search/filtering.
- Optional, separately enabled semantic-search layer later.
- Bundled local AI inference using `llama-server.exe` and an initial Gemma 2 2B GGUF model.
- Encrypted portable backups.

## Explicitly out of scope for now

- Cloud services, user accounts, document sharing, telemetry, and remote support access.
- Local-Wi-Fi device synchronization or any LAN-facing server.
- Mobile clients.
- Requiring users to install Python, OCR dependencies, llama.cpp, or models independently in the production experience.

## Search strategy

The primary search path is metadata filtering and SQLite full-text search. Semantic embeddings are a separate optional layer for meaning-based retrieval; they are not required for basic search and must be abstracted from any single embedding model or vector store.

