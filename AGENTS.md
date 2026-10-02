# FamilyVault Agent Instructions

## Read first

Before changing this repository, read `PROJECT.md`, `CURRENT_STATE.md`, `ARCHITECTURE.md`, and `SECURITY.md`. The planned architecture is not evidence that it is already implemented; `CURRENT_STATE.md` is the record of reality.

## Product constraints

FamilyVault is a Windows desktop application for storing and understanding family documents entirely offline. Its data lives in a portable, dedicated vault format, independently of the installed application.

Non-negotiable constraints:

- No cloud backend, remote API, document upload, telemetry, analytics, or advertising.
- No LAN listener or network-exposed service. Future local-Wi-Fi sync is a design consideration only; do not implement it without approval.
- The renderer must not access Node.js, the filesystem, secrets, or the database directly.
- Store documents and derived sensitive content encrypted at rest. Do not write plaintext copies to persistent application locations.
- Password-only vault unlock. Do not add account, biometric, DPAPI, recovery, or remote-unlock flows without approval.
- Treat original documents as source material, application validation as authority, and AI output as untrusted suggestions.

## Do Not Do This

- Do not add Express, a web backend, Docker runtime infrastructure, MongoDB, PostgreSQL, Redis, or a cloud database.
- Do not bind `llama-server` to `0.0.0.0`, expose it on LAN, or enable unneeded tool/agent capabilities.
- Do not call cloud AI APIs or silently fall back to them.
- Do not store plaintext source documents, SQLCipher keys, passwords, or the vault master key in logs, settings, crash reports, or source control.
- Do not let raw LLM output run SQL, alter files, set reminders, or become metadata without schema and deterministic validation.
- Do not use an LLM for cryptography, hashing, date arithmetic, access control, or conflict resolution.
- Do not overwrite or automatically delete document versions, including apparent duplicates.
- Do not replace working code merely to make it stylistically different.
- Do not represent a planned component as implemented.

## Architectural change policy

Classify a proposed change before making it:

| Level | Change | Rule |
| --- | --- | --- |
| 1 | Local implementation, tests, UI, bug fixes, refactors that preserve documented boundaries | Proceed; explain in the final report. |
| 2 | New/replaced library, database/schema migration, build or packaging change | Explain need, alternatives, migration/rollback effect, and test plan before implementation. |
| 3 | Security, offline, vault format, network/trust boundary, encrypted storage, key management, or sync architecture | Stop and obtain explicit human approval before implementation. |

When uncertain, treat a change as the higher level.

## Agent workflow

1. Inspect the repository and `CURRENT_STATE.md`; locate the relevant implementation and tests.
2. State the assumption if the task requires one that materially affects behavior.
3. Identify the change level and follow its policy.
4. Make the smallest coherent change that preserves existing behavior and architectural boundaries.
5. Add or update focused tests when implementation changes behavior.
6. Run relevant checks (typecheck, tests, build, and security-specific checks as applicable).
7. Report changed files, checks actually run and their results, and any remaining limitation. Never claim a feature works without verification.

## Definition of done

A feature is done only when its implementation, validation, errors/edge cases, and appropriate tests are complete; relevant UI and IPC integration exist; offline operation is preserved; and existing behavior is not regressed. Security-sensitive work additionally requires appropriate key/data lifecycle handling and a review against `SECURITY.md`. AI work additionally requires a structured output contract, rejection of invalid output, explicit handling of unknown values, and source references when it presents document-derived claims.

