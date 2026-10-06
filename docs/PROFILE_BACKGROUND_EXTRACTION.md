# Profile Background Extraction & Information Schema Architecture

## Overview

This document specifies the decoupled architecture between:
1. **Interactive Document Scanning (Pre-Import)**: Fast, non-blocking document-level classification and metadata tagging.
2. **Post-Save Background Profile Extraction (Post-Import)**: Asynchronous information schema pipeline that extracts biographical, residential, identity credential, and academic facts, accompanied by fluid card-filling animations in the UI.

---

## 1. Phase 1: Interactive Pre-Import Scan (Document-Level Only)

### Boundary Rules
During the interactive pre-analysis phase (`vaultService.preAnalyzeDocument`):
- OCR is performed (`PaddleOCR PP-OCRv5` / `Tesseract` / PDF parsing).
- Document-level classification is evaluated:
  - `title`: Human-readable document name suggestion.
  - `category`: `identity`, `insurance`, `medical`, `tax`, `property`, `other`.
  - `docType`: `passport`, `driving_license`, `insurance_policy`, `tax_document`, `medical_record`, `property_document`, `other`.
  - `person`: Matched added family member, or flagged as `unmatchedPerson` with `category = 'other'` for review.
  - `issueDate` & `expiryDate`: Document validity dates.
  - `issuer`: Issuing authority or company.
  - `tags`: 1–5 search tags.
- **Strict Omission**: No personal biographical profile data is extracted during this scan. Fields such as `gender`, `address`, `license_number`, `fathers_name`, `mothers_name`, `marks_10th`, `marks_12th`, and `education` are **not** extracted.
- **Rationale**:
  - Eliminates latency during interactive file selection.
  - Prevents premature commitment of biographical inferences for documents the user may cancel or edit.
  - Preserves privacy and zero data leakage.

---

## 2. Phase 2: Post-Save Background Processing Pipeline

### Trigger & Lifecycle
When the user clicks **Save / Import Document** (`document:import` or `document:add-version`):
1. The encrypted document and its version are committed to SQLCipher and the AES-256-GCM chunked object store.
2. The import method completes immediately, returning success to unblock the UI and display the confirmation toast.
3. An asynchronous background task `_processDocumentProfileBackground` is initiated.

### Information Schema
The background engine applies a comprehensive structured schema over the saved OCR text:

```typescript
interface ProfileInformationSchema {
  // 1. Demographics
  gender?: 'Male' | 'Female' | 'Other';
  dob?: string; // YYYY-MM-DD

  // 2. Family Relations
  fathersName?: string;
  mothersName?: string;

  // 3. Residence & Location
  address?: string; // Clean residential address

  // 4. Identity & Government Credentials
  licenseNumber?: string; // Driving license alphanumeric string
  idNumber?: string;      // National ID / SSN / Aadhaar / Voter ID

  // 5. Academic Credentials
  marks10th?: string;     // Percentage / CGPA, Board, Year
  marks12th?: string;     // Percentage / CGPA, Board, Stream, Year
  education?: string;     // Degree / Major / University
}
```

### Anti-Hallucination & Grounding Verification
Per `AGENTS.md` constraints:
- Every extracted profile fact must have an exact matching snippet in the OCR text.
- Extracted values must pass deterministic validation (pattern format, character length, date normalization).
- Any value failing grounding verification is rejected.

### Database Persistence & Contradiction Resolution
- Atomic facts are inserted into `profile_facts` with `source_document_id`, `source_version_id`, `raw_snippet`, and `confidence`.
- The canonical record in `user_profiles` is upserted with normalized values.
- Cross-document contradiction detection (`getUserProfileWithContradictions`) evaluates whether previous documents for this person contain conflicting values (e.g. differing license numbers or addresses) and creates discrepancy records with source document links.

---

## 3. UI Fluid Card-Filling Animation

### Animation Mechanics
When background analysis executes for a person:
1. **Reservoir Layer (`.fluid-fill-reservoir`)**:
   - Translucent acrylic gradient positioned at the bottom of the targeted profile card.
   - Height ascends fluidly from `0%` to `100%` corresponding to progress milestones (`15%` -> `55%` -> `85%` -> `100%`).
2. **Fluid Wave Crest (`@keyframes fluidWave`)**:
   - Sine wave horizontal oscillation (`translateX` with subtle scale shifts) to simulate liquid filling.
3. **Completion Pulse (`.fluid-fill-complete`)**:
   - Upon completion (100%), the card illuminates with a subtle luminescent glow.
   - The newly extracted values fade in smoothly, and the liquid reservoir gently settles into the dark acrylic backdrop.

### Main Dashboard Document Card Fluid Filling Animation
When a new document is imported:
1. `importDocument` returns the document record immediately, closing the import modal and rendering the new card on the main dashboard (`#doc-grid`).
2. The newly added `.doc-card` renders with an active `.doc-card-fluid-reservoir` and `.card-fluid-filling` state displaying a live progress indicator (`.doc-card-fluid-badge`).
3. As background processing streams telemetry milestones (`15%` -> `55%` -> `85%` -> `100%`), the fluid reservoir in the document card rises dynamically with undulating sine waves.
4. Upon 100% completion, the document card triggers `.card-fluid-complete`, displaying a luminescent green confirmation flash, transitioning the badge to `✓ AI Ready`, and settling smoothly into normal card styling.

### IPC Telemetry Events
- `profile:analysis-started`: `{ personName, documentId, docTitle }`
- `profile:analysis-progress`: `{ personName, documentId, progress, step }`
- `profile:analysis-completed`: `{ personName, documentId, updatedFields, profile }`
