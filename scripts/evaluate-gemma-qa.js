'use strict';

const { LlmService } = require('../src/main/services/llmService');
const {
  cases,
  createEvaluationDocuments,
  createEvaluationProfiles
} = require('../tests/fixtures/gemmaQaEvaluation');

function scoreCase(evaluationCase, result, documents) {
  const answer = result.answer.toLowerCase();
  const sourceIds = result.sources
    .filter(source => source.documentId)
    .map(source => source.documentId);
  const sourceTypes = result.sources.map(source => source.sourceType);
  const factsFound = evaluationCase.expectedFacts.filter(fact =>
    answer.includes(fact.toLowerCase())
  );
  const requiredIds = evaluationCase.requiredSourceDocumentIds || [];
  const scopedDocumentIds = documents
    .filter(document => document.person === evaluationCase.personScope)
    .map(document => document.id);
  const checks = {
    answerFacts: evaluationCase.expectedFacts.length === 0
      ? 1
      : factsFound.length / evaluationCase.expectedFacts.length,
    sourcePrecision: sourceIds.length === 0
      ? (evaluationCase.shouldAbstain || requiredIds.length === 0 ? 1 : 0)
      : sourceIds.filter(id => evaluationCase.acceptableSourceDocumentIds.includes(id)).length / sourceIds.length,
    sourceRecall: requiredIds.length === 0
      ? 1
      : requiredIds.filter(id => sourceIds.includes(id)).length / requiredIds.length,
    abstention: evaluationCase.shouldAbstain
      ? Number(/could not find information/i.test(result.answer) && result.sources.length === 0)
      : 1,
    personScope: evaluationCase.personScope
      ? Number(sourceIds.every(id => scopedDocumentIds.includes(id)))
      : 1,
    requiredSourceTypes: (evaluationCase.requiredSourceTypes || []).every(type =>
      sourceTypes.includes(type)
    ) ? 1 : 0,
    forbiddenFacts: (evaluationCase.forbiddenAnswerTerms || []).every(term =>
      !answer.includes(term.toLowerCase())
    ) ? 1 : 0,
    evidenceStrength: result.evidenceStrength >= (evaluationCase.minEvidenceStrength || 0)
      && result.evidenceStrength <= (evaluationCase.maxEvidenceStrength ?? 1)
      ? 1
      : 0
  };

  return {
    id: evaluationCase.id,
    description: evaluationCase.description,
    passed: Object.values(checks).every(score => score === 1),
    checks,
    answer: result.answer,
    evidenceStrength: result.evidenceStrength,
    sourceIds,
    sourceTypes,
    elapsedMs: Number(result.elapsedMs.toFixed(2))
  };
}

async function main() {
  const service = new LlmService();
  const evaluations = [];

  for (const evaluationCase of cases) {
    const documents = createEvaluationDocuments(evaluationCase.documentIds);
    const startedAt = performance.now();
    const result = await service.answerQuestion({
      query: evaluationCase.query,
      documents,
      profiles: createEvaluationProfiles(evaluationCase.profileNames)
    });
    result.elapsedMs = performance.now() - startedAt;
    evaluations.push(scoreCase(evaluationCase, result, documents));
  }

  const summary = {
    mode: 'local-extractive',
    note: 'This deterministic baseline measures retrieval, grounding, scope, and abstention without starting Gemma.',
    totalCases: evaluations.length,
    passedCases: evaluations.filter(item => item.passed).length,
    averageLatencyMs: Number((
      evaluations.reduce((sum, item) => sum + item.elapsedMs, 0) / evaluations.length
    ).toFixed(2)),
    evaluations
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error('Gemma Q&A baseline evaluation failed:', error);
  process.exitCode = 1;
});
