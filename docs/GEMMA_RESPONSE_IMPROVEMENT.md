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
- Calls the local llama-server with temperature `0.0` and a 256-token
  generation limit, then removes common Gemma control tokens and source
  markers.
- Falls back to a deterministic extractive answer if Gemma is unavailable or
  the model call fails.

OCR quality also affects answer quality. Documents are processed with
PaddleOCR first and Tesseract.js when PaddleOCR fails, is unavailable, or
returns no usable text. Incorrect OCR text can therefore produce incorrect
answers regardless of prompt quality.

## Recommended implementation sequence

Make and measure one change at a time. Preserve the person-scoping behavior,
offline processing, and source references throughout.

### 1. Create a baseline evaluation set

Run `npm run eval:qa` from the application directory for the committed
synthetic evaluation set in `tests/fixtures/gemmaQaEvaluation.js`. It reports
answer-fact coverage, source precision/recall, person-scope compliance,
abstention, required source types, forbidden facts, and latency for each case.
The fixture contains:

- A direct fact lookup, such as a document number, date, amount, or address.
- A question requiring facts from more than one document.
- A question about a named family member, including a similarly named member.
- A question whose answer is absent from the vault.
- A question where documents disagree.
- An OCR-heavy scan with a known extracted-text result.
- A question that could match a tempting but irrelevant document.

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

The synthetic local-extractive evaluation improved from **5/7 to 7/7** cases.
It now includes both facts in the multi-document answer and abstains when a
travel-insurance document mentions passport replacement but does not state a
passport expiry. The same seven checks run in `npm run eval:qa`; an additional
unit test verifies that stronger semantic similarity reranks a lexical tie
and that each document contributes only one passage. This measures retrieval
and fallback behavior, not generated Gemma answer quality.

### 3. Improve extracted-text quality

Use the stored OCR and extraction results as evidence, not as unquestioned
truth.

1. Normalize whitespace and repeated OCR artifacts while preserving table
   rows, labels, dates, amounts, and identifiers.
2. Keep page boundaries and source provenance when combining multi-page
   documents.
3. Detect empty or clearly unusable extraction results and expose them for
   reprocessing or user review instead of treating them as reliable evidence.
4. Add fixtures for common scan errors and verify that cleanup does not alter
   meaningful values.
5. Do not silently "correct" ambiguous names, dates, or numbers in the
   extraction layer. If a value cannot be reliably interpreted, keep the
   original text and let the answer abstain or explain the uncertainty.

### 4. Make the answer contract explicit

Keep the prompt concise and specify output behavior, not unsupported facts.
The answer instructions should require Gemma to:

- Answer only from the provided evidence and say when evidence is insufficient.
- Put the direct answer first and avoid repeating it.
- Preserve exact names, dates, amounts, identifiers, and units from sources.
- Distinguish a direct source fact from an interpretation of OCR text.
- Treat conflicting sources as unresolved and describe the conflict without
  choosing a value.
- Avoid inferring missing facts or claiming that a source says something it
  does not.
- Avoid emitting internal source markers; citations are attached by the
  application.

Use representative prompt tests for both supported facts and unsupported
questions. Do not ask Gemma to create citations; keep source selection and
citations in application code.

### 5. Clean and validate model output

Continue cleaning model-specific control tokens, but also test for:

- Empty or whitespace-only responses.
- Repeated answer sentences and malformed spacing.
- Incomplete responses that end at the generation limit.
- Unrequested internal markers or prompt fragments.
- Statements not supported by any supplied passage.

If the model returns no usable answer, use the existing deterministic
extractive fallback. Do not return a success-shaped, confident answer when
generation failed.

### 6. Tune generation limits only from evidence

The Q&A request currently uses temperature `0.0` and `n_predict: 256`.
Temperature changes do not improve the quality of retrieved evidence and
should not be the first tuning lever. If answers are cut off, test a larger
generation limit on the evaluation set and measure latency and completeness.
Keep the smallest limit that reliably returns complete answers. Change
temperature only if repeatable tests show a readability benefit without a
drop in factual accuracy.

### 7. Report confidence conservatively

The current Q&A path assigns a fixed confidence value to generated answers.
Do not treat that value as a calibrated probability. If confidence is shown
to users, derive it from measurable signals such as retrieval quality,
agreement between sources, and whether the answer is directly supported.
Otherwise, remove or relabel the value so it is not mistaken for certainty.

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
- [ ] Unsupported questions abstain instead of guessing.
- [ ] Conflicting facts are surfaced as conflicting, not resolved arbitrarily.
- [ ] Output is concise, complete, free of model control tokens, and grounded
  in returned sources.
- [ ] Model failure or empty output uses the deterministic fallback.
- [ ] OCR cleanup preserves exact values and does not invent corrections.
- [ ] Latency and response quality are compared with the baseline.
- [ ] Targeted tests and the full test suite pass.
- [ ] Relevant architecture or current-state documentation is updated if
  runtime behavior changes.

## Validation commands

Run from the application directory:

```powershell
npm run eval:qa
npm test -- --test-name-pattern="LlmService|VaultService"
npm test
```

The first command runs the existing test runner with a focused name filter;
if the Node.js version or test-runner options do not apply that filter, run the
full suite instead. Add focused regression tests for any changed retrieval,
prompt, output-cleaning, or confidence behavior.
