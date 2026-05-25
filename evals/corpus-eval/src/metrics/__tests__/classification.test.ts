import { describe, it, expect } from 'vitest';
import {
  calculateMetrics,
  calculateMetricsForClass,
  calculateMetricsByTaskType,
  calculatePathRatios,
} from '../classification.js';
import type { CaseResult, TaskType } from '../../corpus/types.js';

function createMockResult(overrides: Partial<CaseResult> & { expected: { taskType: TaskType }, actual: { taskType: TaskType } }): CaseResult {
  return {
    caseId: 'test-001',
    prompt: 'test prompt',
    expected: {
      taskType: overrides.expected.taskType,
      path: 'any',
      minConfidence: 0,
    },
    actual: {
      taskType: overrides.actual.taskType,
      confidence: 80,
      path: 'embedding',
    },
    passed: overrides.passed ?? (overrides.expected.taskType === overrides.actual.taskType),
    failures: overrides.failures ?? [],
    pathWarnings: overrides.pathWarnings ?? [],
    latencyMs: 100,
    tags: [],
    ...overrides,
  };
}

describe('calculateMetrics', () => {
  it('returns zero metrics for empty results', () => {
    const metrics = calculateMetrics([]);
    expect(metrics.total).toBe(0);
    expect(metrics.correct).toBe(0);
    expect(metrics.accuracy).toBe(0);
  });

  it('calculates 100% accuracy when all cases pass', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' }, passed: true }),
      createMockResult({ caseId: '2', expected: { taskType: 'domain' }, actual: { taskType: 'domain' }, passed: true }),
      createMockResult({ caseId: '3', expected: { taskType: 'fix' }, actual: { taskType: 'fix' }, passed: true }),
    ];
    const metrics = calculateMetrics(results);
    expect(metrics.total).toBe(3);
    expect(metrics.correct).toBe(3);
    expect(metrics.accuracy).toBe(1);
  });

  it('calculates accuracy based on passed field, not taskType match', () => {
    // This test verifies that error cases (which default to 'general')
    // don't incorrectly count as correct when expected is also 'general'
    const results: CaseResult[] = [
      createMockResult({
        caseId: '1',
        expected: { taskType: 'general' },
        actual: { taskType: 'general' },
        passed: false, // Error case - passed should be false even if taskType matches
        failures: ['Classification error: timeout'],
      }),
      createMockResult({
        caseId: '2',
        expected: { taskType: 'general' },
        actual: { taskType: 'general' },
        passed: true, // Real correct classification
      }),
    ];
    const metrics = calculateMetrics(results);
    expect(metrics.total).toBe(2);
    expect(metrics.correct).toBe(1); // Only the truly passed case
    expect(metrics.accuracy).toBe(0.5);
  });

  it('calculates partial accuracy correctly', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' }, passed: true }),
      createMockResult({ caseId: '2', expected: { taskType: 'domain' }, actual: { taskType: 'general' }, passed: false, failures: ['mismatch'] }),
      createMockResult({ caseId: '3', expected: { taskType: 'fix' }, actual: { taskType: 'fix' }, passed: true }),
      createMockResult({ caseId: '4', expected: { taskType: 'general' }, actual: { taskType: 'publish' }, passed: false, failures: ['mismatch'] }),
    ];
    const metrics = calculateMetrics(results);
    expect(metrics.total).toBe(4);
    expect(metrics.correct).toBe(2);
    expect(metrics.accuracy).toBe(0.5);
  });
});

describe('calculateMetricsForClass', () => {
  it('calculates true positives correctly', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' } }),
      createMockResult({ caseId: '2', expected: { taskType: 'publish' }, actual: { taskType: 'publish' } }),
      createMockResult({ caseId: '3', expected: { taskType: 'domain' }, actual: { taskType: 'domain' } }),
    ];
    const metrics = calculateMetricsForClass(results, 'publish');
    expect(metrics.total).toBe(2); // 2 expected publish
    expect(metrics.correct).toBe(2); // 2 correct publish predictions
  });

  it('calculates false positives correctly', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' } }),
      createMockResult({ caseId: '2', expected: { taskType: 'domain' }, actual: { taskType: 'publish' } }), // FP
    ];
    const metrics = calculateMetricsForClass(results, 'publish');
    // TP = 1, FP = 1, precision = 1 / (1 + 1) = 0.5
    expect(metrics.precision).toBe(0.5);
  });

  it('calculates false negatives correctly', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' } }),
      createMockResult({ caseId: '2', expected: { taskType: 'publish' }, actual: { taskType: 'domain' } }), // FN
    ];
    const metrics = calculateMetricsForClass(results, 'publish');
    // TP = 1, FN = 1, recall = 1 / (1 + 1) = 0.5
    expect(metrics.recall).toBe(0.5);
  });

  it('calculates F1 score correctly', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' } }), // TP
      createMockResult({ caseId: '2', expected: { taskType: 'domain' }, actual: { taskType: 'publish' } }),  // FP
      createMockResult({ caseId: '3', expected: { taskType: 'publish' }, actual: { taskType: 'domain' } }),  // FN
    ];
    const metrics = calculateMetricsForClass(results, 'publish');
    // TP = 1, FP = 1, FN = 1
    // Precision = 1 / 2 = 0.5
    // Recall = 1 / 2 = 0.5
    // F1 = 2 * 0.5 * 0.5 / (0.5 + 0.5) = 0.5
    expect(metrics.precision).toBe(0.5);
    expect(metrics.recall).toBe(0.5);
    expect(metrics.f1).toBe(0.5);
  });

  it('handles class with no samples', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' } }),
    ];
    const metrics = calculateMetricsForClass(results, 'fix');
    expect(metrics.total).toBe(0);
    expect(metrics.correct).toBe(0);
    expect(metrics.accuracy).toBe(0);
  });
});

describe('calculateMetricsByTaskType', () => {
  it('returns metrics for all task types', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish' } }),
    ];
    const metrics = calculateMetricsByTaskType(results);
    expect(metrics).toHaveProperty('publish');
    expect(metrics).toHaveProperty('domain');
    expect(metrics).toHaveProperty('fix');
    expect(metrics).toHaveProperty('general');
  });
});

describe('calculatePathRatios', () => {
  it('returns zero ratios for empty results', () => {
    const ratios = calculatePathRatios([]);
    expect(ratios.embedding).toBe(0);
    expect(ratios.haiku).toBe(0);
    expect(ratios.initial_prompt).toBe(0);
    expect(ratios.timeout).toBe(0);
    expect(ratios.error).toBe(0);
  });

  it('calculates path ratios correctly', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'publish' }, actual: { taskType: 'publish', path: 'embedding' } }),
      createMockResult({ caseId: '2', expected: { taskType: 'domain' }, actual: { taskType: 'domain', path: 'embedding' } }),
      createMockResult({ caseId: '3', expected: { taskType: 'fix' }, actual: { taskType: 'fix', path: 'haiku' } }),
      createMockResult({ caseId: '4', expected: { taskType: 'general' }, actual: { taskType: 'general', path: 'error' } }),
    ];
    const ratios = calculatePathRatios(results);
    expect(ratios.embedding).toBe(0.5);
    expect(ratios.haiku).toBe(0.25);
    expect(ratios.initial_prompt).toBe(0);
    expect(ratios.timeout).toBe(0);
    expect(ratios.error).toBe(0.25);
  });

  it('calculates initial_prompt path ratio correctly', () => {
    const results: CaseResult[] = [
      createMockResult({ caseId: '1', expected: { taskType: 'general' }, actual: { taskType: 'general', path: 'initial_prompt' } }),
      createMockResult({ caseId: '2', expected: { taskType: 'general' }, actual: { taskType: 'general', path: 'initial_prompt' } }),
      createMockResult({ caseId: '3', expected: { taskType: 'publish' }, actual: { taskType: 'publish', path: 'embedding' } }),
      createMockResult({ caseId: '4', expected: { taskType: 'fix' }, actual: { taskType: 'fix', path: 'haiku' } }),
    ];
    const ratios = calculatePathRatios(results);
    expect(ratios.initial_prompt).toBe(0.5);
    expect(ratios.embedding).toBe(0.25);
    expect(ratios.haiku).toBe(0.25);
    expect(ratios.timeout).toBe(0);
    expect(ratios.error).toBe(0);
  });
});
