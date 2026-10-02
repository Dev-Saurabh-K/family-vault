# FamilyVault Architecture

## Target application shape

```text
React renderer
    │  narrow, typed preload API
    ▼
Electron main process
    ├── Vault core (keys, lifecycle, paths, object storage)
    ├── SQLCipher database and search
    ├── import / processing job system
    ├── OCRService → PaddleOCR runtime (primary)
    ├── LLMService → bundled llama-server.exe → Qwen3 4B GGUF
    └── optional EmbeddingService + VectorStore
```

The renderer communicates only through validated IPC exposed by preload. The Electron main process owns filesystem access, database access, decryption, worker processes, and all sensitive state.

## Vault format

A vault is a dedicated portable format, conceptually `FamilyVault.vault/`, not a ZIP archive and not a collection of AppData files. The final on-disk packaging details are a Level 3 decision. Its durable concepts are:

```text
vault manifest (format/schema/crypto versions, vault ID, wrapped key metadata)
encrypted SQLCipher database
encrypted immutable document objects
encrypted derived objects (OCR text, chunks, indexes when stored)
optional encrypted vector/index data
```

Object identity is independent of filename. Records use stable IDs, content hashes, creation timestamps, and version relationships. This allows later sync to compare immutable objects and versions rather than filenames.

## Data model principles

- `Document` is the logical family record.
- `DocumentVersion` is immutable and references an encrypted object, content hash, size, media type, and creation time.
- Metadata, text extraction, OCR output, classifications, and summaries are derived data associated with a version and retain provenance/status.
- A current version is a pointer/selection; it does not invalidate older versions.
- Future sync fields may include stable device-neutral IDs and causal/version metadata, but no synchronization protocol is implemented now.

## Core flows

### Import

```text
selected file → validate type/path → hash → create encrypted object
→ create immutable DocumentVersion → enqueue local processing
```

Do not treat a matching hash as permission to delete, overwrite, or silently hide a document.

### Processing

```text
version → native PDF text extraction when available
→ OCRService when text is absent/insufficient
→ normalized text → validated extraction/classification
→ metadata + FTS indexing → optional embeddings/indexing
```

`OCRService` is an abstraction. PaddleOCR is the initial primary implementation because it is a dedicated document OCR pipeline. A future Windows OCR implementation may conform to the same interface, but must not alter product behavior or become a platform prerequisite without the required change review.

### Search and answers

```text
user query → validated metadata filters and/or SQLite FTS → results
                                      └→ optional semantic retrieval → sources → local LLM answer
```

The LLM may parse a query into a constrained schema or write a grounded answer; application code validates the schema, executes allowed queries, and displays source references.

## Local AI runtime

Bundle `llama-server.exe` and the initial Qwen3 4B GGUF with the application distribution; keep model assets outside `app.asar`. The server is launched and supervised by the main process on an application-selected local port with an explicit `127.0.0.1` host binding. It is inference-only, not a general agent or files tool. The LLM and embedding interfaces must remain replaceable.

## Backups and future sync

Backups are portable encrypted vault backups; they preserve enough manifest, object, version, and database data to restore safely. Future local-Wi-Fi sync must operate on authenticated, encrypted vault objects and immutable versions. It is intentionally unimplemented and must not be approximated by exposing current services to the network.

