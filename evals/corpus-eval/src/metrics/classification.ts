import type {
  CaseResult,
  ClassificationMetrics,
  TaskType,
  ActualPath,
} from '../corpus/types.js';

/**
 * Calculate classification metrics from case results
 * Note: Uses r.passed to determine correctness, which excludes error cases
 * from being counted as correct even if taskType happens to match.
 */
export function calculateMetrics(results: CaseResult[]): ClassificationMetrics {
  if (results.length === 0) {
    return {
      total: 0,
      correct: 0,
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1: 0,
    };
  }

  const total = results.length;
  // Use r.passed to avoid counting error cases as correct
  // (error handler defaults to 'general' which would falsely match general test cases)
  const correct = results.filter(r => r.passed).length;
  const accuracy = correct / total;

  // For overall metrics, use macro-averaged precision/recall/f1.
  // Macro-average: calculate metric for each class, then average across classes.
  // This gives equal weight to each class regardless of sample size, which is
  // important when class distributions are imbalanced.
  // Only include classes that have at least one sample (expected or predicted)
  // to avoid deflating F1 for tag slices that contain only one class.
  const taskTypes: TaskType[] = ['publish', 'domain', 'fix', 'general'];

  // Filter to classes with samples (either expected or predicted)
  const relevantClasses = taskTypes.filter(taskType => {
    const hasExpected = results.some(r => r.expected.taskType === taskType);
    const hasPredicted = results.some(r => r.actual.taskType === taskType);
    return hasExpected || hasPredicted;
  });

  const relevantMetrics = relevantClasses.map(taskType => calculateMetricsForClass(results, taskType));
  const numClasses = relevantMetrics.length || 1; // Avoid division by zero

  const precision = relevantMetrics.reduce((sum, m) => sum + m.precision, 0) / numClasses;
  const recall = relevantMetrics.reduce((sum, m) => sum + m.recall, 0) / numClasses;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    total,
    correct,
    accuracy,
    precision,
    recall,
    f1,
  };
}

/**
 * Calculate metrics for a specific class (one-vs-rest)
 * Note: Excludes error cases (path='error') from TP/FP calculations since their
 * default taskType='general' isn't a real prediction. Error cases still count as FN
 * for their expected class.
 */
export function calculateMetricsForClass(
  results: CaseResult[],
  targetClass: TaskType
): ClassificationMetrics {
  const total = results.filter(r => r.expected.taskType === targetClass).length;

  // Exclude error cases from TP/FP - their taskType is a default, not a prediction
  const isRealPrediction = (r: CaseResult) => r.actual.path !== 'error';

  // True positives: predicted positive, actually positive (real prediction)
  const tp = results.filter(
    r => r.expected.taskType === targetClass &&
         r.actual.taskType === targetClass &&
         isRealPrediction(r)
  ).length;

  const correct = tp;

  // False positives: predicted positive, actually negative (real prediction)
  const fp = results.filter(
    r => r.actual.taskType === targetClass &&
         r.expected.taskType !== targetClass &&
         isRealPrediction(r)
  ).length;

  // False negatives: expected this class but didn't predict it
  // Includes both wrong predictions AND error cases
  const fn = results.filter(
    r => r.expected.taskType === targetClass &&
         (r.actual.taskType !== targetClass || !isRealPrediction(r))
  ).length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = total > 0 ? correct / total : 0;

  return {
    total,
    correct,
    accuracy,
    precision,
    recall,
    f1,
  };
}

/**
 * Calculate metrics grouped by task type
 */
export function calculateMetricsByTaskType(
  results: CaseResult[]
): Record<TaskType, ClassificationMetrics> {
  const taskTypes: TaskType[] = ['publish', 'domain', 'fix', 'general'];
  const metrics: Record<string, ClassificationMetrics> = {};

  for (const taskType of taskTypes) {
    metrics[taskType] = calculateMetricsForClass(results, taskType);
  }

  return metrics as Record<TaskType, ClassificationMetrics>;
}

/**
 * Calculate metrics grouped by tag
 */
export function calculateMetricsByTag(
  results: CaseResult[]
): Record<string, ClassificationMetrics> {
  // Collect all unique tags
  const allTags = new Set<string>();
  for (const result of results) {
    for (const tag of result.tags) {
      allTags.add(tag);
    }
  }

  const metrics: Record<string, ClassificationMetrics> = {};

  for (const tag of allTags) {
    const tagResults = results.filter(r => r.tags.includes(tag));
    metrics[tag] = calculateMetrics(tagResults);
  }

  return metrics;
}

/**
 * Calculate metrics grouped by classification path
 */
export function calculateMetricsByPath(
  results: CaseResult[]
): Record<ActualPath, ClassificationMetrics> {
  const paths: ActualPath[] = ['embedding', 'embedding_timeout_fallback', 'haiku', 'initial_prompt', 'timeout', 'error'];
  const metrics: Record<string, ClassificationMetrics> = {};

  for (const path of paths) {
    const pathResults = results.filter(r => r.actual.path === path);
    metrics[path] = calculateMetrics(pathResults);
  }

  return metrics as Record<ActualPath, ClassificationMetrics>;
}

/**
 * Calculate path distribution ratios
 */
export function calculatePathRatios(
  results: CaseResult[]
): { embedding: number; embedding_timeout_fallback: number; haiku: number; initial_prompt: number; timeout: number; error: number } {
  const total = results.length;
  if (total === 0) {
    return { embedding: 0, embedding_timeout_fallback: 0, haiku: 0, initial_prompt: 0, timeout: 0, error: 0 };
  }

  const counts = {
    embedding: results.filter(r => r.actual.path === 'embedding').length,
    embedding_timeout_fallback: results.filter(r => r.actual.path === 'embedding_timeout_fallback').length,
    haiku: results.filter(r => r.actual.path === 'haiku').length,
    initial_prompt: results.filter(r => r.actual.path === 'initial_prompt').length,
    timeout: results.filter(r => r.actual.path === 'timeout').length,
    error: results.filter(r => r.actual.path === 'error').length,
  };

  return {
    embedding: counts.embedding / total,
    embedding_timeout_fallback: counts.embedding_timeout_fallback / total,
    haiku: counts.haiku / total,
    initial_prompt: counts.initial_prompt / total,
    timeout: counts.timeout / total,
    error: counts.error / total,
  };
}
