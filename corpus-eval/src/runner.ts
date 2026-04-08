import type { Corpus, CaseResult, EvalReport, TaskType, ActualPath } from './corpus/types.js';
import { loadCorpus, loadAllCorpora, mergeCorpora, filterByTags, filterSkipped } from './corpus/loader.js';
import { createEvaluator, type EvaluatorConfig } from './evaluators/index.js';
import {
  calculateMetrics,
  calculateMetricsByTaskType,
  calculateMetricsByTag,
  calculateMetricsByPath,
  calculatePathRatios,
  buildConfusionMatrix,
  calculateLatencyStats,
} from './metrics/index.js';

export interface RunOptions {
  /** Path to corpus file or directory */
  corpusPath: string;

  /** Model to use for classification */
  model?: string;

  /** Tags to filter by (include only cases with these tags) */
  tags?: string[];

  /** Enable verbose output */
  verbose?: boolean;

  /** Timeout per case in milliseconds */
  timeoutMs?: number;

  /** Max concurrent requests (default: 5) */
  concurrency?: number;
}

/**
 * Run corpus evaluation
 */
export async function runEvaluation(options: RunOptions): Promise<EvalReport> {
  const startTime = Date.now();

  console.log(`\nCorpus Evaluation`);
  console.log(`=================`);
  console.log(`Corpus: ${options.corpusPath}`);
  if (options.model) {
    console.log(`Model: ${options.model}`);
  }
  if (options.tags?.length) {
    console.log(`Tags: ${options.tags.join(', ')}`);
  }
  console.log();

  // Load corpus
  let corpus: Corpus;
  const stats = await import('node:fs/promises').then(fs => fs.stat(options.corpusPath));

  if (stats.isDirectory()) {
    const corpora = await loadAllCorpora(options.corpusPath);
    corpus = mergeCorpora(corpora);
    console.log(`Loaded ${corpora.length} corpus files`);
  } else {
    corpus = await loadCorpus(options.corpusPath);
    console.log(`Loaded corpus: ${corpus.metadata.name}`);
  }

  // Filter by tags if specified
  if (options.tags?.length) {
    corpus = filterByTags(corpus, options.tags);
    console.log(`Filtered to ${corpus.cases.length} cases by tags`);
  }

  // Filter out skipped cases
  const { corpus: activeCorpus, skippedCount } = filterSkipped(corpus);
  if (skippedCount > 0) {
    console.log(`Skipped ${skippedCount} test cases`);
  }

  const concurrency = options.concurrency ?? 5;
  console.log(`Running ${activeCorpus.cases.length} test cases (concurrency: ${concurrency})...\n`);

  // Create and run evaluator
  // Confidence threshold can be overridden via env var CORPUS_EVAL_CONFIDENCE_THRESHOLD
  // If not set, each evaluator uses its own default
  const envThreshold = process.env.CORPUS_EVAL_CONFIDENCE_THRESHOLD;

  const evaluatorConfig: EvaluatorConfig = {
    model: options.model || corpus.config?.defaultModel || 'haiku',
    timeoutMs: options.timeoutMs || corpus.config?.timeoutMs || 5000,
    verbose: options.verbose,
    confidenceThreshold: envThreshold ? parseInt(envThreshold, 10) : undefined,
    concurrency: options.concurrency,
  };

  const evaluator = createEvaluator(corpus.metadata.agent, evaluatorConfig);
  const evalResult = await evaluator.evaluate(activeCorpus);

  if (!evalResult.success) {
    throw new Error(`Evaluation failed: ${evalResult.error}`);
  }

  const results = evalResult.results!;

  // Calculate metrics
  const overallMetrics = calculateMetrics(results);
  const byTaskType = calculateMetricsByTaskType(results);
  const byTag = calculateMetricsByTag(results);
  const byPath = calculateMetricsByPath(results);
  const pathRatios = calculatePathRatios(results);
  const confusionMatrix = buildConfusionMatrix(results);
  const latencyStats = calculateLatencyStats(results);

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const pathMismatches = results.filter(r => r.pathWarnings.length > 0).length;

  // Build report
  const report: EvalReport = {
    metadata: {
      timestamp: new Date().toISOString(),
      corpusPath: options.corpusPath,
      corpusName: corpus.metadata.name,
      modelUsed: evaluatorConfig.model!,
      duration: Date.now() - startTime,
    },
    summary: {
      total: results.length,
      passed,
      failed,
      skipped: skippedCount,
      accuracy: overallMetrics.accuracy,
      avgLatencyMs: latencyStats.avg,
      embeddingPathRatio: pathRatios.embedding,
      haikuPathRatio: pathRatios.haiku,
      initialPromptPathRatio: pathRatios.initial_prompt,
      pathMismatches,
    },
    metrics: {
      overall: overallMetrics,
      byTaskType,
      byTag,
      byPath,
    },
    confusionMatrix,
    latency: latencyStats,
    cases: results,
    failures: results
      .filter(r => !r.passed)
      .map(r => ({
        caseId: r.caseId,
        prompt: r.prompt,
        expected: r.expected.taskType,
        actual: r.actual.taskType,
        failures: r.failures,
      })),
    pathWarnings: results
      .filter(r => r.pathWarnings.length > 0)
      .map(r => ({
        caseId: r.caseId,
        prompt: r.prompt,
        expectedPath: r.expected.path,
        actualPath: r.actual.path,
        warning: r.pathWarnings[0],
      })),
  };

  return report;
}

/**
 * Print evaluation summary to console
 */
export function printSummary(report: EvalReport): void {
  const { summary, metrics, latency } = report;

  console.log(`\nResults Summary`);
  console.log(`===============`);
  console.log(`Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed} | Skipped: ${summary.skipped}`);
  console.log(`Classification Accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
  console.log(`F1 Score: ${(metrics.overall.f1 * 100).toFixed(1)}%`);
  console.log();

  console.log(`Path Efficiency`);
  console.log(`---------------`);
  console.log(`Embedding (fast): ${(summary.embeddingPathRatio * 100).toFixed(1)}%`);
  console.log(`Haiku (fallback): ${(summary.haikuPathRatio * 100).toFixed(1)}%`);
  if (summary.initialPromptPathRatio > 0) {
    console.log(`Initial Prompt (bypass): ${(summary.initialPromptPathRatio * 100).toFixed(1)}%`);
  }
  if (summary.pathMismatches > 0) {
    console.log(`Path Warnings: ${summary.pathMismatches} cases took unexpected path`);
  }
  console.log();

  console.log(`Latency`);
  console.log(`-------`);
  console.log(`Avg: ${latency.avg}ms | P50: ${latency.p50}ms | P95: ${latency.p95}ms`);
  console.log();

  console.log(`Per-Category Accuracy`);
  console.log(`---------------------`);
  for (const [taskType, m] of Object.entries(metrics.byTaskType)) {
    if (m.total > 0) {
      console.log(`  ${taskType.padEnd(10)}: ${(m.accuracy * 100).toFixed(1)}% (${m.correct}/${m.total})`);
    }
  }
  console.log();

  // Show critical tag metrics (tags that affect billing)
  const criticalTags = ['initial', 'question', 'negation'];
  const tagMetrics = Object.entries(metrics.byTag)
    .filter(([tag]) => criticalTags.includes(tag))
    .sort((a, b) => b[1].total - a[1].total);

  if (tagMetrics.length > 0) {
    console.log(`Critical Tag Accuracy`);
    console.log(`---------------------`);
    for (const [tag, m] of tagMetrics) {
      if (m.total > 0) {
        console.log(`  ${tag.padEnd(12)}: ${(m.accuracy * 100).toFixed(1)}% (${m.correct}/${m.total})`);
      }
    }
    console.log();
  }

  if (report.failures.length > 0) {
    console.log(`Classification Failures (${report.failures.length})`);
    console.log(`--------------------------`);
    for (const failure of report.failures.slice(0, 10)) {
      console.log(`  [${failure.caseId}] Expected: ${failure.expected}, Got: ${failure.actual}`);
      console.log(`    Prompt: "${failure.prompt.substring(0, 60)}..."`);
      failure.failures.forEach(f => console.log(`    - ${f}`));
    }
    if (report.failures.length > 10) {
      console.log(`  ... and ${report.failures.length - 10} more failures`);
    }
    console.log();
  }

  if (report.pathWarnings.length > 0) {
    console.log(`Path Warnings (${report.pathWarnings.length})`);
    console.log(`-------------`);
    for (const warning of report.pathWarnings.slice(0, 5)) {
      console.log(`  [${warning.caseId}] Expected: ${warning.expectedPath}, Got: ${warning.actualPath}`);
      console.log(`    Prompt: "${warning.prompt.substring(0, 60)}..."`);
    }
    if (report.pathWarnings.length > 5) {
      console.log(`  ... and ${report.pathWarnings.length - 5} more path warnings`);
    }
    console.log();
  }

  console.log(`Duration: ${(report.metadata.duration / 1000).toFixed(1)}s`);
}
