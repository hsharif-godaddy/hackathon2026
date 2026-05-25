import { describe, it, expect } from 'vitest';

import type { CaseResult } from '../../corpus/types.js';
import { calculateClassifierAbSummary } from '../classifier-ab.js';

function baseCase(overrides: Partial<CaseResult>): CaseResult {
  return {
    caseId: 'c1',
    prompt: 'p',
    expected: { taskType: 'fix', path: 'any', minConfidence: 0 },
    actual: { taskType: 'fix', confidence: 90, path: 'embedding' },
    passed: true,
    failures: [],
    pathWarnings: [],
    latencyMs: 10,
    tags: [],
    ...overrides,
  };
}

describe('calculateClassifierAbSummary', () => {
  it('returns zeros when no shadow data', () => {
    const s = calculateClassifierAbSummary([baseCase({})]);
    expect(s.casesWithShadow).toBe(0);
    expect(s.agreeRatio).toBe(0);
  });

  it('counts agree and disagree', () => {
    const results: CaseResult[] = [
      baseCase({
        classifierComparison: {
          agree: true,
          lr: { taskType: 'general', confidence: 90, requiresHaikuVerification: false },
          nn: { taskType: 'general', confidence: 70, requiresHaikuVerification: false },
        },
      }),
      baseCase({
        classifierComparison: {
          agree: false,
          lr: { taskType: 'fix', confidence: 90, requiresHaikuVerification: false },
          nn: { taskType: 'general', confidence: 60, requiresHaikuVerification: true },
        },
      }),
    ];
    const s = calculateClassifierAbSummary(results);
    expect(s.casesWithShadow).toBe(2);
    expect(s.agreeCount).toBe(1);
    expect(s.disagreeCount).toBe(1);
    expect(s.agreeRatio).toBe(0.5);
    expect(s.disagreeRatio).toBe(0.5);
  });

  it('counts LR gold NN wrong', () => {
    const results: CaseResult[] = [
      baseCase({
        expected: { taskType: 'fix', path: 'any', minConfidence: 0 },
        classifierComparison: {
          agree: false,
          lr: { taskType: 'fix', confidence: 85, requiresHaikuVerification: false },
          nn: { taskType: 'publish', confidence: 70, requiresHaikuVerification: false },
        },
      }),
    ];
    const s = calculateClassifierAbSummary(results);
    expect(s.lrMatchesGoldNnWrongCount).toBe(1);
    expect(s.lrMatchesGoldNnWrongRatio).toBe(1);
  });

  it('counts NN Haiku + LR fast path gold', () => {
    const results: CaseResult[] = [
      baseCase({
        expected: { taskType: 'fix', path: 'any', minConfidence: 0 },
        actual: { taskType: 'fix', confidence: 90, path: 'embedding' },
        classifierComparison: {
          agree: false,
          lr: { taskType: 'fix', confidence: 85, requiresHaikuVerification: false },
          nn: { taskType: 'fix', confidence: 50, requiresHaikuVerification: true },
        },
      }),
    ];
    const s = calculateClassifierAbSummary(results);
    expect(s.nnHaikuLrConfidentSetupCount).toBe(1);
    expect(s.nnHaikuLrConfidentFastPathGoldCount).toBe(1);
    expect(s.nnHaikuLrConfidentFastPathGoldRatio).toBe(1);
  });
});
