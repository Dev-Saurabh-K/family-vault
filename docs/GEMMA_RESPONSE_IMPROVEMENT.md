# Improving Gemma Q&A Responses

This guide describes a practical, testable sequence for improving FamilyVault's
offline Gemma responses. The goal is to make answers more accurate, relevant,
readable, and well-grounded in the user's vault—not merely longer or more
confident.

## Current behavior

The current Q&A path in `src/main/services/llmService.js`:

- Retrieves document text using semantic matches, query terms, and a small
  synonym map, then keeps up to three document passages.
- Adds relevant saved-profile fields when the question asks about them.
- Restricts documents and profile context to a named family member when the
  person is resolved; unknown or ambiguous names stop before other people's
  data is searched.
- Asks Gemma to answer from the supplied sources, lead with a concise answer,
  handle conflicting profile facts cautiously, and avoid printing source
  markers.
- Calls the local llama-server with temperature `0.0` and a 256-token limit
  for single-source answers or 512 tokens for multi-source answers, then
  removes common Gemma control tokens and source markers.
- Falls back to a deterministic extractive answer if Gemma is unavailable or
  the model call fails.
- Returns a heuristic `evidenceStrength` based on retrieval relevance,
  extraction quality, review state, and detectable conflicts. It is not
  calibrated or currently displayed in the UI.
- Checks generated numeric values and alphanumeric identifiers against the
  retrieved source text. If a value is unsupported, it returns the local
  extractive answer instead; generated text is withheld from the chat until
  validation passes.

OCR quality also affects answer quality. Documents are processed with
PaddleOCR first and Tesseract.js when PaddleOCR fails, is unavailable, returns
no usable text, or reports low word-level confidence. Incorrect OCR text can
therefore produce incorrect answers regardless of prompt quality.

When a normal search finds no answer, the chat offers an explicit **Search all
documents anyway** action. It retries the same question across all documents'
stored OCR/extracted text, OCR word coordinates, and extracted document
metadata (including document type, issuer, issue/expiry dates and evidence,
review state, and extraction confidence), along with the semantic index.
It includes other family members' documents and omits profile records. The
broader scope is opt-in per retry; normal named-person restrictions remain
unchanged. When the local Gemma server is available, the retry uses it for the
answer; otherwise the deterministic extractive response is used. Responses
with sources display a bottom-of-answer caution that another family member's
documents may be included and OCR/AI interpretations can be wrong, advising
users to verify the cited originals.

## Recommended implementation sequence

Make and measure one change at a time. Preserve the person-scoping behavior,
offline processing, and source references throughout.

### 1. Create a baseline evaluation set

Run `npm run eval:qa` from the application directory for the committed
synthetic evaluation set in `tests/fixtures/gemmaQaEvaluation.js`. It reports
answer-fact coverage, source precision/recall, person-scope compliance,
abstention, required source types, forbidden facts, evidence strength, and
latency for each case.
The fixture contains:

- A direct fact lookup, such as a document number, date, amount, or address.
- A question requiring facts from more than one document.
- A question about a named family member, including a similarly named member.
- A question whose answer is absent from the vault.
- A question where documents disagree.
- An OCR-heavy scan with a known extracted-text result.
- A question that could match a tempting but irrelevant document.
- Conflicting values from separate documents and uncertain OCR evidence.

Each case records expected answer facts, acceptable/required source document
IDs, whether the answer should abstain, and whether person scope must apply.
Fixtures use synthetic data only. This initial command intentionally uses the
deterministic local-extractive route and does not start Gemma; it establishes a
repeatable retrieval, evidence, and fallback baseline without model download
or startup. Use the same cases in a model-enabled evaluation environment to
measure generated answer quality after the Gemma server is deliberately
started.

Compare case-level results before and after each change; do not treat the
aggregate pass count as a calibrated quality score.

The local extractive baseline is `npm run eval:qa`. To evaluate generated
Gemma answers, first start the model from FamilyVault's Model Settings, then
run `npm run eval:qa:model`. This opt-in command checks the existing server's
health at `127.0.0.1` and sends only the synthetic fixture prompts to that
loopback address. It never starts a server or downloads a model. The report
includes answer-fact coverage, source precision/recall, passed cases, answer
latency, validated model-response count, and model-to-extractive fallbacks.
Abstention cases that have no retrieved evidence are not counted as generated
answer failures because the Q&A service intentionally returns before
generation. A nonzero exit indicates an answerable case did not return a
validated model answer. No fixture data is read from the vault or sent over
the internet. Model-generated answers are checked against the existing
conservative `0.65` evidence-strength cap; fixture-specific confidence ranking
thresholds apply only to the deterministic extractive baseline.

On 2026-10-06, the model-enabled run returned validated Gemma answers for all
8 answerable synthetic cases and abstained on the 2 cases with no retrieved
answer. It scored 10/10 overall, with 1.00 answer-fact coverage, 1.00 source
precision, 1.00 source recall, no extractive fallbacks, and mean latency of
3.88 seconds per generated answer (3.10 seconds across all cases). This is one
run against synthetic fixtures on the current local machine—not a general
quality or performance guarantee. The lexical evaluation cannot prove full
semantic entailment or replace human review.

Before retrieval reranking, the local-extractive baseline passed **5 of 7
cases**. The multi-document case
retrieved both sources but did not include the arrival-station fact in the
answer evidence. The misleading-related-document case treated passport
replacement assistance in a travel-insurance document as relevant to a
passport-expiry question and did not abstain. These are recorded as baseline
gaps that the retrieval optimization above now covers.

### 2. Improve retrieval before changing the prompt

Implemented in `answerQuestion()` in `src/main/services/llmService.js`:

1. Lexical coverage, synonym coverage, and semantic similarity now contribute
   to a normalized score with weights `0.70`, `0.10`, and `0.20`.
2. Semantic passages must have a lexical anchor and either adequate lexical
   coverage or similarity of at least `0.42`; this prevents unrelated vector
   matches from entering context on similarity alone.
3. Resolved person's name tokens are removed from relevance scoring, so a
   document does not rank merely because it repeats the requested person's
   name.
4. Synthesized metadata and notes receive less ranking weight than extracted
   document text. This helps select the passage containing an actual answer
   rather than a title-only metadata summary.
5. Equivalent expiry terms are normalized. Passport/visa/license expiry
   questions require the type and expiry to be tied in the same sentence, or
   require the document title/type to identify that document and the passage
   to contain its expiry fact.
6. Duplicate chunks are reduced to the strongest passage per document, with
   up to three distinct document sources retained.
7. Person filtering remains in place before retrieval and model context
   assembly.

The initial synthetic local-extractive evaluation improved from **5/7 to 7/7**
cases after retrieval reranking.
It now includes both facts in the multi-document answer and abstains when a
travel-insurance document mentions passport replacement but does not state a
passport expiry. The evaluation originally contained seven cases; it now
contains ten, including conflicting document values, low-confidence OCR, and
verified direct evidence. An additional unit test verifies that stronger
semantic similarity reranks a lexical tie and that each document contributes
only one passage. This measures retrieval and fallback behavior, not generated
Gemma answer quality.

### 3. Improve extracted-text quality

Implemented in `src/main/services/extractionService.js`:

1. `normalizeExtractedText()` normalizes line endings, removes null bytes,
   trims line-edge whitespace, and collapses excessive blank lines without
   rewriting identifiers, amounts, or table columns.
2. Native PDF text and image/PDF OCR outputs use the same normalization.
   Scanned PDF OCR preserves page separators in extracted text.
3. Native PDF extraction now estimates text quality from readable character
   content and corruption markers. When its score is low, OCR is tried on the
   rendered pages and replaces the native text only when its measured text
   quality is meaningfully stronger (or native text was short and OCR returned
   more content).
4. For long scanned PDFs, the bounded three-page OCR pass samples the first,
   middle, and last pages instead of only the first three. Short PDFs still OCR
   every page within the three-page limit.
5. When the PDF parser exposes per-page native text, sparse or corrupted pages
   are selected for OCR (up to three) even if other pages contain readable
   selectable text. OCR replaces only a page whose text materially improves
   or fills an otherwise sparse page; native text from the remaining pages is
   retained.
6. PaddleOCR output must contain at least one letter or digit to be treated as
   usable. If not, or if its mean word confidence is below 65, the image/PDF
   flow tries Tesseract and chooses the higher-confidence usable result; if
   Tesseract output is also unusable, the image result is marked
   `ocr-unavailable`.
7. Scanned PDFs report `pdf-ocr-mixed` when pages used both PaddleOCR and
   Tesseract, instead of implying the entire PDF used only one engine.
8. OCR cleanup does not autocorrect ambiguous names, dates, or numbers; exact
   extracted content remains available for review.
9. OCR table reconstruction scales its row-alignment and column-gap thresholds
   from the median detected word height, while preserving the existing pixel
   thresholds as minimums. This avoids assuming all images have identical
   resolution and font size.
10. Scanned PDF pages with weak OCR confidence or word coordinates that indicate
    a small skew are passed through Tesseract's local automatic gradient
    correction. Its corrected OCR is compared with PaddleOCR and replaces it
    only when word confidence is higher. This affects OCR processing only; the
    original PDF is never rotated or modified. PDF page rotation metadata is
    already honored by the renderer.
11. Image uploads and scanned PDF pages whose OCR is dominated by short,
    fragmented tokens are checked at 90, 180, and 270 degrees with local
    Tesseract OCR. The app compares the rotated results with the initial
    orientation and uses a rotated result only when its text/confidence score
    improves materially. Sparse OCR results now trigger these checks too, and
    nearly unreadable baselines use a lower improvement threshold so a useful
    rotated result is not discarded for a small score difference. This handles
    rotation baked into a scan without changing the stored source image or PDF;
    ordinary, readable pages skip the extra orientation passes.
12. Right-angle correction is also triggered when OCR word boxes show a
    predominantly vertical text flow (at least six boxes, with most boxes
    taller than wide). This catches rotated pages whose initial OCR happens to
    produce plausible-looking words and would not meet the text-fragment
    heuristic alone.

Strict extraction regressions cover line ending/whitespace normalization,
preservation of exact IDs and amounts, corrupted-native-text replacement,
normal-table-text retention, sampled last-page OCR in long PDFs, sparse-page
OCR in mixed native/scanned PDFs, high-resolution table layout, symbol-only OCR
rejection, Tesseract
fallback after unusable PaddleOCR output, and the case where neither engine
returns usable text. Deskew regressions cover skew estimation, skipping aligned
text, and enabling automatic gradient correction for skewed PDF OCR. Rotation
regressions cover suspicious-text detection, selecting a better right-angle
OCR result, checking vertical word-box geometry, and skipping orientation
checks for readable text in normal horizontal layouts.

### 4. Make the answer contract explicit

Implemented in `_buildPrompt()` in `src/main/services/llmService.js`. The
prompt now requires source-grounded concise answers, preserves exact values,
instructs the model to report conflicts instead of choosing a side, and
abstains when the supplied evidence does not answer the specific question. It
also treats source contents as untrusted data (not instructions), prohibits
unsupported inferences and invented citations, and advises against guessing
or silently correcting OCR values.

Embedded Gemma turn-control tokens in source titles, snippets, and the query
are escaped before prompt construction so untrusted content cannot terminate
the user turn. Prompt tests verify the answer contract, evidence values, and
malicious source/query token handling. Source retrieval and citations remain
application-owned.

### 5. Clean and validate model output

Implemented in `_cleanAnswer()` and the Gemma Q&A response path in
`src/main/services/llmService.js`. The output cleaner removes Gemma control
tokens and source markers, normalizes punctuation spacing and excessive blank
lines, and removes exact repeated sentences while preserving bullet/list
formatting. If cleanup leaves no usable answer, the service logs the condition
and returns its deterministic extractive fallback with `local-extractive`
mode and fallback evidence strength rather than returning an empty Gemma
answer as a successful model response.

Regression tests cover duplicate answer text, cleanup while retaining bullets,
and a control-token/source-marker-only completion. Truncation and semantic
claim verification are not inferred from text heuristics: they still require
model completion metadata or a reliable answer-evidence validator.

### 6. Tune generation limits only from evidence

Implemented in `answerQuestion()` and `_queryLlamaServer()` in
`src/main/services/llmService.js`: Q&A keeps temperature `0.0` and uses
`n_predict: 256` for a single selected source, while multi-source answers can
use up to `512` tokens to synthesize facts without hitting the shorter cap.
This is a generation ceiling, not a target; the concise-answer prompt remains
unchanged. Document metadata extraction continues to use the default
256-token limit.

Tests verify the default 256-token request and the two Q&A budgets. The
deterministic evaluation now passes 10/10 cases, but Gemma was not started
during that evaluation, so response completeness and latency under actual
inference remain to be measured on a running local model. Temperature remains
unchanged because there is no measured evidence that changing it improves
factuality.

### 7. Report confidence conservatively

Implemented in `_calculateEvidenceStrength()` in
`src/main/services/llmService.js`. Q&A results now expose `evidenceStrength`
instead of the former fixed `confidence` value. The estimate uses retrieval
relevance, stored extraction confidence, and review status; query-relevant
conflicting labeled values and explicit profile conflicts lower the result.
Generated Gemma answers are capped at `0.65` because their claims are not yet
independently checked against the cited snippets. No-evidence responses return
zero.

This is a heuristic evidence-strength indicator, **not a calibrated
probability** and it is not currently shown in the chat UI. The expanded
synthetic evaluation checks that uncertain OCR and conflicting evidence score
lower than reviewed direct evidence. It passed **10/10** cases. Live Gemma
calibration still requires a model-enabled evaluation set and measured
human-reviewed outcomes.

### 8. Validate generated answer values against evidence

Implemented in `_validateAnswerValues()` and the Gemma Q&A response path in
`src/main/services/llmService.js`. Before an answer is returned, numeric
values (including dates, amounts, percentages, and unit-bearing values) and
alphanumeric identifiers are compared with exact normalized values from the
selected source titles and snippets. Formatting commas and whitespace are
ignored; currency symbols and identifier characters are retained. An
unsupported value rejects the model answer and uses the deterministic
extractive fallback.

Q&A output is now buffered until validation completes. The renderer receives
the complete generated answer only after validation, so unsupported streamed
claims are not briefly shown to the user. Tests cover a changed identifier,
an altered identifier prefix/length, a missing currency symbol, a valid
source-backed answer, and fallback behavior without emitting invalid text.

This is a targeted literal-value guard, not semantic claim verification: it
does not prove that each sentence is supported or that a value is attached to
the right label when that same value appears elsewhere in the context. The
harder evaluation checks those literal regressions; the local-extractive
baseline remains **10/10** and does not start Gemma.

### 9. Screen generated prose for unsupported claims

Implemented in `_validateAnswerClaims()` in
`src/main/services/llmService.js`. After cleanup and literal-value checking,
each generated sentence is compared with normalized content words from the
selected source titles and snippets. A sentence is rejected if it contains
unsupported terms accounting for more than 20% of its content words; a
single-content-word sentence must be directly present in the evidence. Rejected
answers fall back to deterministic extraction, and no model text is streamed
before validation.

This is a conservative lexical screen, **not semantic entailment**: a true
paraphrase that uses unsupported synonyms can be rejected, and shared terms
cannot prove that a relationship or label is correct. Numeric values and
identifiers still use the separate exact-value validator. Regression cases
verify an ordinary grounded answer passes while an invented account status
forces the extractive fallback without exposing model text.

### 10. Compare low-confidence OCR and ground generated metadata

Implemented across `src/main/services/extractionService.js` and
`src/main/services/llmService.js`.

For image files and rendered scanned-PDF pages, PaddleOCR remains the fast
primary engine. When its word-level mean confidence is below 65, the service
also runs the existing local Tesseract fallback and selects the usable result
with the higher mean OCR confidence. If confidence is missing, the service
preserves prior behavior and accepts usable PaddleOCR output rather than
running a second engine without a comparison signal. Text extraction,
identifiers, tables, and line breaks are not autocorrected.

Metadata extraction now:

- Accepts issue/expiry dates only when a parsed source date occurs near an
  appropriate explicit label; the evidence snippet is taken from that source
  context rather than copied from the model.
- Accepts an issuer only when its name appears in the extracted text or
  filename; deterministic extraction also requires an explicit issuer/
  authority/provider label instead of treating the first OCR line as issuer.
  A generated title is accepted only when it shares meaningful terms with
  those inputs.
- Retains only source-grounded AI tags and lets a deterministic non-generic
  classification override a conflicting model classification.
- Caps self-reported model confidence at `0.75`; deterministic evidence can
  still raise the final extraction confidence when explicit date evidence
  supports it.
- Instructs Gemma to respect table/line layout, distinguish date types, avoid
  assuming the first OCR line is an issuer, and treat OCR text/filenames as
  untrusted data.

Synthetic regressions cover low-confidence Paddle output for both an image
and a scanned PDF page, selecting a higher-confidence Tesseract result,
rejecting unrelated dates and invented issuers/titles, and prompt injection
inside OCR text and filenames. These tests verify the selection and grounding
rules, not real-world OCR accuracy across all scanners, languages, or document
formats. A representative, user-reviewed document corpus is still required
to measure actual accuracy and tune the confidence threshold.

## Suggested code locations

| Concern | Likely location |
| --- | --- |
| Passage scoring, deduplication, context selection | `src/main/services/llmService.js`, `answerQuestion()` |
| Prompt wording | `src/main/services/llmService.js`, `_buildPrompt()` |
| Generation parameters and streaming | `src/main/services/llmService.js`, `_queryLlamaServer()` |
| Output cleanup | `src/main/services/llmService.js`, `_cleanAnswer()` |
| Person-scoped document retrieval and indexing | `src/main/vault/vaultService.js`, `askQuestion()` |
| OCR and extracted text | `src/main/services/extractionService.js` |
| Q&A and model behavior tests | `tests/llmService.test.js`, `tests/userProfile.test.js` |
| OCR behavior tests | `tests/extraction.test.js`, `tests/paddleOcr.test.js` |

Confirm the current call graph and test conventions before editing; names and
responsibilities can change as the code evolves.

## Completion checklist

- [ ] Baseline cases cover factual lookup, multi-source answers, missing facts,
  conflicting facts, named-person scope, and OCR-heavy documents.
- [ ] Retrieval returns relevant, non-redundant evidence and retains source
  identity.
- [ ] Named-person queries never include another person's documents or profile
  facts in model context.
- [x] Unsupported questions abstain instead of guessing.
- [x] Conflicting facts are surfaced as conflicting, not resolved arbitrarily.
- [x] Output cleanup removes duplicate sentences and model control tokens.
- [x] Model failure or empty output uses the deterministic fallback.
- [ ] Every generated semantic claim is checked against returned sources.
- [x] Generated numbers and identifiers are checked against retrieved text
  before the answer is exposed.
- [x] Generated answer sentences receive a conservative source-term grounding
  check before the answer is exposed.
- [x] Low-confidence OCR is compared with the existing secondary engine and
  AI metadata fields are grounded against extracted source text.
- [ ] OCR accuracy is benchmarked on a representative, user-reviewed corpus
  spanning the formats and languages supported by the app.
- [x] Returned evidence strength uses retrieval, extraction, review, and
  conflict signals without claiming to be a calibrated probability.
- [x] OCR cleanup preserves exact values and does not invent corrections.
- [ ] Gemma latency and generated-response completeness are measured against
  the baseline on a running local model.
- [ ] Targeted tests and the full test suite pass.
- [ ] Relevant architecture or current-state documentation is updated if
  runtime behavior changes.

## Validation commands

Run from the application directory:

```powershell
npm run eval:qa
npm run eval:qa:model
npm test -- --test-name-pattern="LlmService|VaultService"
npm test
```

`npm run eval:qa:model` requires an already-running, healthy local Gemma server
on port `18432`; optionally set `FAMILYVAULT_LLM_PORT` to a different local
port. It will fail fast if the loopback health check fails.

The first command runs the existing test runner with a focused name filter;
if the Node.js version or test-runner options do not apply that filter, run the
full suite instead. Add focused regression tests for any changed retrieval,
prompt, output-cleaning, or confidence behavior.
