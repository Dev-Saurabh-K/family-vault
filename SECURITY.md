# FamilyVault Security Model

## Security goals

Protect document originals and sensitive derived data at rest; keep processing local; prevent renderer and local-AI boundary escapes; and make vault portability possible without weakening password-based protection.

## Key hierarchy

```text
User password
  → Argon2id (unique salt and stored, versioned parameters)
  → key-encryption key (KEK)
  → authenticated unwrap
  → random 256-bit vault master key (VMK)
  → derived/separated keys for SQLCipher database and encrypted objects
```

The password is never the vault encryption key. The VMK is generated randomly when a vault is created. A password change rewraps the VMK with a KEK derived from the new password; it must not require re-encrypting all document objects. Use mature, audited cryptographic libraries and authenticated encryption; do not design custom cryptography.

## At-rest storage

- The SQLite database uses SQLCipher with a key derived from the VMK.
- Original document objects are encrypted independently with authenticated encryption and integrity verification.
- OCR text, chunks, metadata exports, indexes, embeddings, temporary files, and backups are sensitive. Persist them encrypted or avoid persisting them.
- Keep plaintext only in memory or tightly controlled short-lived working locations when technically necessary; clean up on success, failure, cancellation, and lock.
- Never log passwords, keys, decrypted text, document bytes, or sensitive prompts/responses.

## Unlock and lock

Unlock is password-only. On unlock, derive the KEK with Argon2id, authenticate and unwrap the VMK, then open the database/services. On lock, close databases and document streams, clear key material from reachable application state as far as the runtime permits, cancel processing where possible, and remove transient plaintext.

Vault manifests may contain non-secret format and KDF metadata plus wrapped-key material. They must be versioned and authenticated; treat any tampering or failed authentication as an unlock/storage error, never as a condition to repair silently.

## Electron boundary

- Enable context isolation and keep Node integration disabled in renderer windows.
- Expose a minimal, typed preload API; validate all IPC inputs and authorise every operation in main.
- Validate paths and vault ownership before reading/writing. Do not accept arbitrary renderer-provided paths as authority.
- Use restrictive content security policy and avoid loading remote web content.

## OCR and AI boundary

Local OCR (Tesseract.js) and llama.cpp run locally within the application boundary. Their inputs/outputs are untrusted data: limit inputs, validate structured output, enforce time/resource limits where feasible, and do not expose secrets beyond what each job requires. `llama-server.exe` must bind only to `127.0.0.1` on an application-selected port. Do not enable LAN access, plugins, tools, or file-operation capabilities.

## Threat and change review

Changes to cryptography, key lifecycle, SQLCipher use, vault structure, backup structure, local-network behavior, trust boundaries, or sync design are Level 3 changes under `AGENTS.md` and require explicit human approval before implementation. Security bugs may be mitigated immediately only when the mitigation preserves this architecture; otherwise explain the risk and request approval.

