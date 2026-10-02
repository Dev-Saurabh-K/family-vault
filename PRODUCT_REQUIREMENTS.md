# FamilyVault Product Requirements

## Product outcome

FamilyVault helps a family keep important documents private, organized, and useful without handing them to a cloud service. A user should be able to securely retain an original document, understand its important details, find it later, see time-sensitive information such as expiry dates, and ask grounded questions about it.

## Target user

A person or family responsible for documents such as insurance policies, identity documents, medical records, tax documents, property records, warranties, certificates, and bills. They may have mixed digital PDFs, scans, and photos, and should not need technical knowledge or an internet connection to use the product.

## Required user outcomes for the first usable release

### 1. Secure portable document keeping

- A user can create and unlock a password-protected vault.
- The vault can be moved independently of the installed app and opened on a supported device using its password.
- A user can import supported PDFs and images.
- The original imported content remains encrypted and is never silently replaced or discarded.

### 2. Document history

- A user can create a newer version of a document.
- The current version is easy to identify.
- Earlier versions remain accessible as history and are not automatically overwritten or deleted.

### 3. Useful local extraction and review

- FamilyVault extracts text locally from digital documents or scanned/image documents.
- It proposes metadata such as document type, owner/person, issuer, tags, issue date, and expiry date where available.
- The user can review and correct extracted metadata.
- Unknown, ambiguous, or low-confidence details are shown as needing review rather than silently presented as fact.

### 4. Expiry awareness

- When an expiry date appears in a document or is confirmed by a user, it is visible on the document's detail view.
- The app clearly labels it as active, expiring soon, or expired based on deterministic date logic.
- An upcoming-expiries view lets the user see relevant documents together.
- The displayed expiry date retains its source: original page/text where available, or a clear indication that the user entered/confirmed it.

### 5. Find and understand documents

- A user can search and filter by metadata and document text locally.
- Search can filter by fields such as person, category, issuer, tag, and expiry period.
- A user can ask a question about their documents.
- Answers are generated locally, are grounded in retrieved document content, cite the relevant document and page/section where possible, and explicitly say when the answer cannot be found.
- AI answers do not modify records, dates, reminders, or originals.

### 6. Recovery through encrypted backups

- A user can create a portable encrypted backup of a vault.
- A user can restore a backup without weakening the vault's password protection or deleting data unexpectedly.

## Recommended delivery order

Versioning belongs in the foundation, not a later enhancement. It protects history from the first import onward and avoids an unsafe migration from mutable files later.

1. Vault lifecycle, encryption, encrypted object storage, import, and immutable versions.
2. Text extraction/OCR, metadata review, and expiry-date display.
3. Metadata/full-text search and expiry overview.
4. Grounded local document Q&A with citations.
5. Encrypted backup and restore.
6. Optional semantic retrieval after the metadata/FTS experience is solid.

## Future capability: local browser form assistance

FamilyVault may later offer a browser extension that helps a user fill complex web forms more accurately and quickly using details the user has already stored in their vault. This is a future product concept, not a current feature or implementation task.

Desired user experience:

- The user explicitly invokes assistance for a form or field.
- The extension recommends values and identifies their source document; it does not silently submit, invent, or alter form data.
- The user reviews and approves every value before it is filled or submitted.
- Assistance works locally and preserves the same privacy promise as the desktop app.

Required future design constraints before any implementation:

- The extension is a separate trust boundary and requires a Level 3 approval and security design.
- No cloud relay, remote API, telemetry, or background website data collection.
- No general website scraping or automatic submission.
- Site access and vault-data access must be explicit, minimal, user-visible, and revocable.
- The desktop app must not expose its vault, VMK, SQLCipher database, or a LAN service to the extension.
- Data suggestions must be constrained, source-linked, validated, and treated as untrusted until user approval.

## Non-goals for this release

- Cloud sync, accounts, collaboration, mobile access, or local-Wi-Fi sync.
- A browser extension or any browser-to-vault integration.
- Automated form submission or autonomous AI actions.
- Replacing professional/legal/medical advice with AI answers.

## Acceptance standard

A user-facing capability is complete only when it satisfies its stated outcome offline, handles invalid/missing data safely, preserves document history, exposes sources for derived claims when appropriate, and has been verified with relevant tests and realistic manual checks.

