# FamilyVault

FamilyVault is a Windows desktop application for keeping family documents in a password-protected, portable vault. It stores original documents as encrypted objects, preserves document history, and provides local extraction, search, expiry tracking, and document-grounded assistance.

The vault is designed to remain usable independently of the installed application. FamilyVault is intended to work offline; optional model provisioning requires an internet connection to download the local AI runtime and model.

## What it does

- Creates, opens, locks, and restores password-protected `.vault` folders.
- Imports PDF and image documents and stores originals encrypted.
- Keeps document versions and an audit history; importing a newer version does not overwrite the prior one.
- Extracts document text locally, proposes metadata for review, and tracks expiry dates.
- Searches document metadata and text, with a separate semantic search mode.
- Answers questions from retrieved document content using local inference when the local model is available, with citations where available.
- Builds and restores portable encrypted `.fvbackup` files.
- Maintains family member profiles and surfaces conflicting facts with links to their source documents.

Extracted text, metadata, summaries, and AI answers are derived information. The original document remains the source material, and AI output should be reviewed before relying on it.

## Privacy and security

FamilyVault is designed for local, offline document handling. The application uses password-based vault unlocking, Argon2id key derivation, AES-256-GCM object encryption, and an encrypted SQLCipher database. The Electron renderer communicates with the main process through a restricted preload interface and validated IPC.

The optional local AI server is configured to bind to loopback (`127.0.0.1`); it is not intended to be exposed to a LAN. FamilyVault has no cloud account, cloud document processing, telemetry, or synchronization service. Local-Wi-Fi sync is not implemented.

See [SECURITY.md](SECURITY.md) for the security model and [ARCHITECTURE.md](ARCHITECTURE.md) for system boundaries and vault concepts.

## Requirements

- Windows 10 or later (the application is packaged for Windows).
- Node.js and npm for development.
- For model-assisted OCR and Q&A, the local `llama-server.exe` runtime and Gemma model assets. These are optional for the development setup; without them, available deterministic and local fallback processing may be used.

## Run from source

```powershell
npm install
npm start
```

The first screen lets you create a vault, unlock an existing `.vault` folder, or restore a `.fvbackup` archive. Choose a strong vault password and keep it safe; the application does not provide an account-based or remote recovery flow.

## Optional local AI setup

The packaged application is configured to keep the default installer smaller and does not bundle the model by default. To provision the local runtime and model during development, run:

```powershell
npm run setup:ai
```

This setup downloads llama.cpp Windows binaries and Gemma model files into `bin/` and `models/`. The model download is several gigabytes. Check the source and licensing terms for these third-party assets before distributing a build. For packaging with model assets included, set `BUNDLE_MODEL=true` in the packaging environment; otherwise the model is not included in the package by default. The application can also provide an in-app model setup flow.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm start` | Launch the Electron application from source |
| `npm test` | Run the automated Node.js test suite |
| `npm run package` | Package the application with Electron Forge |
| `npm run make` | Create distributable artifacts with configured makers |
| `npm run setup:ai` | Download local AI runtime and model assets |

`npm run lint` is currently a placeholder; no linting tool is configured.

## Project layout

```text
src/
  main/crypto/       Key derivation, key handling, and encryption
  main/vault/        Vault lifecycle, database, objects, and backups
  main/services/     Extraction, local inference, and embeddings
  index.js           Electron main process entry point
  preload.js         Restricted renderer bridge
  renderer.js        Desktop interface behavior
tests/               Automated tests
scripts/             Development and local AI setup scripts
bin/                 Optional local inference runtime assets
models/              Optional local model assets
```

For the repository's detailed implementation status, see [CURRENT_STATE.md](CURRENT_STATE.md). Product goals and constraints are documented in [PROJECT.md](PROJECT.md) and [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).

## Important scope limits

FamilyVault does not provide cloud storage or AI, user accounts, document sharing, mobile clients, browser form assistance, or device synchronization. Do not treat planned capabilities as implemented; consult `CURRENT_STATE.md` for the repository's current implementation record.
