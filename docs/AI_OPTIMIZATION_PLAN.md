# AI Optimization & Step-by-Step Improvement Plan

> **Document Status**: Proposed / Step-by-Step Implementation Guide  
> **Target Scope**: Local AI inference, Gemma-4-E2B prompting, metadata extraction, profile facts, and Q&A context  
> **Constraint Check**: Adheres strictly to `PROJECT.md`, `SECURITY.md`, and `AGENTS.md` (100% offline, `127.0.0.1` binding, deterministic authority over AI suggestions).

---

## 1. Executive Summary & Problem Diagnosis

FamilyVault uses **PaddleOCR (PP-OCRv5)** for OCR and bundled **Gemma-4-E2B GGUF** via `llama-server.exe` for metadata reasoning and Q&A. However, several AI features suffer from prompt overloading and cognitive choke:

1. **The "Kitchen-Sink" Monolithic Prompt**: A single prompt in `_buildExtractionPrompt` commands a 2B CPU model to perform 12 simultaneous tasks (classification, doc typing, person matching, conditional routing, ISO date parsing, snippet copying, issuer extraction, title generation, tag creation, confidence estimation, and table layout parsing).
2. **The 256-Token Truncation Trap**: `_queryLlamaServer` defaults to `maxTokens = 256`. When Gemma generates a 12-field JSON object, it runs out of tokens before closing the JSON. The parse fails, and the application throws the entire AI result away, falling back to deterministic heuristics.
3. **Misaligned Workload Allocation**:
   - The LLM is tasked with date parsing and boolean set matching—tasks that deterministic JavaScript regex handles in 0.2 ms with 100% accuracy.
   - Complex biographical fact extraction (Father's name, Mother's name, Residential address) in `extractProfileFacts` is left entirely to brittle regexes that fail on noisy scans.
4. **Q&A Context Bloat**: `answerQuestion` injects metadata, raw OCR coordinate text dumps (`OCR Words: ...`), full text, and sliding-window chunks of the same text into Gemma's context window, causing 3x–4x redundancy.

---

## 2. Step-by-Step Implementation Roadmap

The improvements are structured into 5 independent, non-breaking steps that can be implemented sequentially.

```mermaid
flowchart LR
    Step1["Step 1<br/>Token Budget & JSON Safety"] --> Step2["Step 2<br/>Micro-Prompting for Metadata"]
    Step2 --> Step3["Step 3<br/>Deterministic Routing & Dates"]
    Step3 --> Step4["Step 4<br/>AI Profile Fact Extraction"]
    Step4 --> Step5["Step 5<br/>Q&A Context Optimization"]
```

---

### Step 1: Fix Token Choke & Strengthen JSON Repair

#### Objective:
Ensure the LLM never gets cut off mid-JSON, and that minor formatting quirks (like markdown code blocks or trailing commas) never cause the entire output to be discarded.

#### Target Files:
- `src/main/services/llmService.js`

#### Tasks:
1. **Increase `maxTokens` for Metadata Extraction**:
   In `llmService.js#extractDocumentMetadata`:
   ```javascript
   // Change from default 256 to 512 for structured metadata
   const rawAiResponse = await this._queryLlamaServer(prompt, null, 512);
   ```
2. **Defensive JSON Extraction**:
   Enhance `extractJsonFromText(rawText)` in `llmService.js` to:
   - Strip leading/trailing markdown fences (````json ... ````).
   - Clean up common LLM trailing commas before closing braces (`,\s*}` $\rightarrow$ `}`).
   - If closing brace is missing due to a network or process cut, attempt to append `}` to salvage parsed keys.
3. **Optional GBNF Grammar in `llama-server`**:
   Add a JSON grammar schema to the `/completion` payload in `_queryLlamaServer` to physically constrain the engine's token sampling to valid JSON characters.

#### Verification:
- Run `npm test tests/llmService.test.js`.
- Test importing a document with a long title and verify that `extractDocumentMetadata` does not throw syntax errors.

---

### Step 2: Deconstruct the Monolithic Prompt into Focused Micro-Prompts

#### Objective:
Relieve cognitive load on the 2B model by asking only for high-level semantic insights (category, document type, suggested title), letting code handle deterministic tasks.

#### Target Files:
- `src/main/services/llmService.js` (`_buildExtractionPrompt`)

#### Current Overloaded Schema (12 Fields):
```json
{
  "category": "...",
  "docType": "...",
  "person": "...",
  "unmatchedPerson": "...",
  "expiryDate": "...",
  "expirySnippet": "...",
  "issueDate": "...",
  "issuer": "...",
  "title": "...",
  "tags": ["..."],
  "confidence": 0.95
}
```

#### Proposed Streamlined Micro-Prompt Schema (3–4 Fields):
```json
{
  "category": "identity | insurance | medical | tax | property | other",
  "docType": "passport | driving_license | identity_card | insurance_policy | tax_document | medical_record | property_document | other",
  "detectedName": "Candidate person name on the document, or null",
  "suggestedTitle": "Short, clear human-readable title"
}
```

#### Prompt Redesign:
1. Remove all negative rules about `"unmatchedPerson"`, forcing categories to `"other"`, and confidence numbers.
2. Remove date extraction requests from the prompt entirely.
3. Keep the prompt under 200 words.

#### Verification:
- Measure prompt latency on CPU (should drop from ~6s to ~1.8s).
- Verify that `suggestedTitle` and `category` accuracy increase significantly.

---

### Step 3: Enforce Deterministic Routing, Dates, and Member Grounding in Code

#### Objective:
Delegate dates, tags, and family member matching 100% to deterministic JavaScript code, which does not hallucinate.

#### Target Files:
- `src/main/services/llmService.js` (`parseAndValidateAiMetadata`)
- `src/main/services/extractionService.js`

#### Tasks:
1. **Deterministic Dates**:
   - `extractionService.findDateCandidates(text)` already extracts and classifies dates using regex and surrounding label proximity (`valid until`, `expiry`, `issue date`).
   - Use these candidates directly as the authority for `expiryDate` and `issueDate`.
2. **Deterministic Family Member Matching**:
   - Take the LLM's `detectedName` (or regex candidates) and test against `knownPersons` using normalized token matching in JavaScript.
   - If matched: assign `person = matchedName`.
   - If not matched: set `unmatchedPerson = detectedName`, `person = null`, and enforce the business rule `category = 'other'` in JavaScript:
     ```javascript
     if (isUnmatchedPerson) {
       category = 'other';
       docType = 'other';
     }
     ```
3. **Deterministic Auto-Tags**:
   - `extractionService.generateAutoTags(text, category, docType)` already handles keyword matching. Combine deterministic tags with any LLM hints cleanly in code.

#### Verification:
- Run `npm test tests/autoCategorizeAndPersonDetection.test.js`.
- Confirm that unknown names correctly trigger `unmatchedPerson` without LLM confusion.

---

### Step 4: Upgrade Profile Fact Extraction with Targeted AI Fallback

#### Objective:
Fix the fragility of biographical fact extraction (Father's name, Mother's name, Residential address) in `extractProfileFacts`.

#### Target Files:
- `src/main/services/extractionService.js`
- `src/main/vault/vaultService.js` (`_processDocumentProfileBackground`)

#### Current Problem:
When extracting address and parentage, code uses strict regexes like:
`text.match(/(?:father['']?s?\s*name|father\s*name)\s*[:.-]?\s*([A-Za-z\s.'-]+)/i)`
This fails on OCR noise (e.g. `S/O: John Doe`, `C/O: Jane`, multi-line addresses, Indian/international ID cards).

#### Proposed Architecture:
1. **Pass 1 (Fast Deterministic)**: Run existing regex rules first. If high confidence facts are found, use them immediately.
2. **Pass 2 (Targeted LLM Fallback)**: If critical fields (`address`, `fathers_name`, `mothers_name`) are missing and `text` contains relevant keywords (`address`, `s/o`, `c/o`, `parent`), prompt Gemma with a micro-prompt:
   ```text
   Extract the residential address and parent names from this document snippet.
   Respond with ONLY valid JSON:
   {
     "address": "<full address string or null>",
     "fathersName": "<name or null>",
     "mothersName": "<name or null>"
   }
   ```
3. **Anti-Hallucination Grounding**:
   Validate that the extracted tokens exist in the source OCR text before saving to `profile_facts` (already enforced by `_processDocumentProfileBackground`).

#### Verification:
- Run `npm test tests/userProfile.test.js`.
- Test with varied ID cards (Driver's License, Aadhaar, Passport) and verify that complex addresses are captured accurately.

---

### Step 5: Clean Up & Deduplicate Q&A Context Passages

#### Objective:
Eliminate duplicate context text, reduce prompt tokens, and sharpen Gemma's answer quality during Q&A.

#### Target Files:
- `src/main/services/llmService.js` (`answerQuestion` & `_buildPrompt`)

#### Current Problem:
For every document in context, `answerQuestion` injects:
1. Document metadata string
2. Space-separated dump of all OCR word coordinates (`OCR Words: ...`)
3. The full document text (`trimmedText`)
4. Multiple sliding-window chunks of that exact same text
This floods the prompt with 3x–4x redundant repetitions of the same words.

#### Tasks:
1. **Omit Raw `ocrWords` Dump**: If clean `textContent` is available, skip injecting `OCR Words: ...`.
2. **Passage Deduplication**: When adding sliding-window passages, ensure chunks that overlap > 70% with an already added chunk are skipped.
3. **Profile Fact Prioritization**: When answering biographical questions (e.g. *"What is Alice's address?"*), prioritize facts from `user_profiles` / `profile_facts` at the top of the context block.

#### Verification:
- Run `npm test tests/llmService.test.js`.
- Ask multi-document questions and check the console logs for prompt token count (should reduce by ~40%).

---

## 3. Implementation Order & Safety Checklist

| Step | Complexity | Level | Risk of Regression | Expected Benefit |
| :---: | :---: | :---: | :---: | :--- |
| **Step 1** | Low | Level 1 | Very Low | Eliminates 100% of JSON truncation crashes. |
| **Step 2** | Medium | Level 1 | Low | Faster inference, reliable titles & categories. |
| **Step 3** | Medium | Level 1 | Low | 100% deterministic dates; zero hallucinated members. |
| **Step 4** | Medium | Level 1 | Low | Significantly captures addresses & parent names from scans. |
| **Step 5** | Low | Level 1 | Very Low | Faster Q&A responses, cleaner citations, no token bloat. |

All planned changes are **Level 1** architectural changes (local implementation, bug fixes, preserving documented offline boundaries), allowing safe and structured execution.
