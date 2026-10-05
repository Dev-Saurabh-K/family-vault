'use strict';

const http = require('node:http');
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
    evidenceStrength: result.modelUsed
      ? Number(result.evidenceStrength >= 0 && result.evidenceStrength <= 0.65)
      : Number(result.evidenceStrength >= (evaluationCase.minEvidenceStrength || 0)
        && result.evidenceStrength <= (evaluationCase.maxEvidenceStrength ?? 1))
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
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      responseMode: result.mode,
      usedLocalModel: result.modelUsed === true,
      modelFallbackReason: result.modelFallbackReason || null
    };
}

function summarize(mode, evaluations) {
    const checks = evaluations.flatMap(evaluation => Object.values(evaluation.checks));
    const generated = evaluations.filter(item => item.usedLocalModel);
    return {
      mode,
      totalCases: evaluations.length,
      passedCases: evaluations.filter(item => item.passed).length,
      answerFactCoverage: Number((
        evaluations.reduce((sum, item) => sum + item.checks.answerFacts, 0) / evaluations.length
      ).toFixed(3)),
      sourcePrecision: Number((
        evaluations.reduce((sum, item) => sum + item.checks.sourcePrecision, 0) / evaluations.length
      ).toFixed(3)),
      sourceRecall: Number((
        evaluations.reduce((sum, item) => sum + item.checks.sourceRecall, 0) / evaluations.length
      ).toFixed(3)),
      meanCheckScore: Number((checks.reduce((sum, score) => sum + score, 0) / checks.length).toFixed(3)),
      modelResponseCases: evaluations.filter(item => item.usedLocalModel).length,
      fallbackCases: evaluations.filter(item => item.modelFallbackReason).length,
      averageModelLatencyMs: generated.length
        ? Number((generated.reduce((sum, item) => sum + item.elapsedMs, 0) / generated.length).toFixed(2))
        : null,
      averageLatencyMs: Number((
        evaluations.reduce((sum, item) => sum + item.elapsedMs, 0) / evaluations.length
      ).toFixed(2)),
      evaluations
    };
}

async function requireHealthyLocalServer(port) {
    await new Promise((resolve, reject) => {
      const request = http.get({
        hostname: '127.0.0.1',
        port,
        path: '/health',
        timeout: 2000
      }, response => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Local Gemma server health check returned HTTP ${response.statusCode}`));
        }
      });
      request.on('timeout', () => request.destroy(new Error('Local Gemma server health check timed out')));
      request.on('error', error => reject(new Error(
        `Could not reach a healthy local Gemma server at 127.0.0.1:${port}: ${error.message}`
      )));
    });
}

async function main() {
    const modelMode = process.argv.includes('--model');
    const configuredPort = Number(process.env.FAMILYVAULT_LLM_PORT || 18432);
    if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
      throw new Error('FAMILYVAULT_LLM_PORT must be an integer from 1 to 65535');
    }

    const service = new LlmService();
    service._port = configuredPort;
    if (modelMode) {
      await requireHealthyLocalServer(configuredPort);
      service._isReady = true;
    }

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
    if (modelMode && !evaluationCase.shouldAbstain && result.mode !== 'llama-server') {
      result.modelFallbackReason = 'Local model response was rejected or unavailable; extractive fallback was returned.';
    }
    evaluations.push(scoreCase(evaluationCase, result, documents));
  }

  const summary = summarize(
    modelMode ? 'local-gemma-via-loopback' : 'local-extractive',
    evaluations
  );
  summary.note = modelMode
    ? 'Uses only an already-running local server at 127.0.0.1. Does not start a server, download a model, or contact the internet.'
    : 'This deterministic baseline measures retrieval, grounding, scope, and abstention without starting Gemma.';

  console.log(JSON.stringify(summary, null, 2));
  const expectedModelCases = cases.filter(evaluationCase => !evaluationCase.shouldAbstain).length;
  if (modelMode && summary.modelResponseCases !== expectedModelCases) {
    console.error(`Only ${summary.modelResponseCases}/${expectedModelCases} answerable cases returned a validated local model response.`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('Gemma Q&A baseline evaluation failed:', error);
  process.exitCode = 1;
});
