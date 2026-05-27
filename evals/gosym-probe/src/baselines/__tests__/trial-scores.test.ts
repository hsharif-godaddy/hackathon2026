import { describe, it, expect } from 'vitest';
import {
  isValidTrialScore,
  extractTrialScoresForEvaluator,
  extractAllTrialScores,
} from '../trial-scores.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { TrialResult } from '../../runner/types.js';
import type { Transcript } from '../../runner/transcript.js';

describe('isValidTrialScore', () => {
  it('returns true for a passing result', () => {
    expect(isValidTrialScore({ evaluatorFailed: false, verdict: 'pass' })).toBe(true);
  });

  it('returns true for a failing result (still valid for scoring)', () => {
    expect(isValidTrialScore({ evaluatorFailed: false, verdict: 'fail' })).toBe(true);
  });

  it('returns true for a partial result', () => {
    expect(isValidTrialScore({ verdict: 'partial' })).toBe(true);
  });

  it('returns true for an observed result', () => {
    expect(isValidTrialScore({ verdict: 'observed' })).toBe(true);
  });

  it('returns false when evaluatorFailed is true', () => {
    expect(isValidTrialScore({ evaluatorFailed: true, verdict: 'fail' })).toBe(false);
  });

  it('returns false when verdict is unknown', () => {
    expect(isValidTrialScore({ evaluatorFailed: false, verdict: 'unknown' })).toBe(false);
  });

  it('returns false when evaluatorFailed is true and verdict is unknown', () => {
    expect(isValidTrialScore({ evaluatorFailed: true, verdict: 'unknown' })).toBe(false);
  });

  it('returns true when evaluatorFailed is undefined and verdict is pass', () => {
    expect(isValidTrialScore({ verdict: 'pass' })).toBe(true);
  });
});

function makeEvalResult(overrides: Partial<EvalResult> & Pick<EvalResult, 'evaluator' | 'score' | 'verdict'>): EvalResult {
  return {
    reason: 'test',
    ...overrides,
  };
}

function makeTranscript(index: number): Transcript {
  return {
    scenarioName: 'test-scenario',
    trialIndex: index,
    turns: [],
    snapshots: [],
    errors: [],
    captureErrors: [],
  };
}

function makeTrial(index: number, evalResults: EvalResult[]): TrialResult {
  return {
    trialIndex: index,
    transcript: makeTranscript(index),
    evalResults,
  };
}

describe('extractTrialScoresForEvaluator', () => {
  it('extracts scores for a named evaluator across trials', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.8, verdict: 'pass' }),
        makeEvalResult({ evaluator: 'speed', score: 0.5, verdict: 'pass' }),
      ]),
      makeTrial(1, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.9, verdict: 'pass' }),
        makeEvalResult({ evaluator: 'speed', score: 0.6, verdict: 'pass' }),
      ]),
    ];

    const scores = extractTrialScoresForEvaluator('accuracy', trials);
    expect(scores).toEqual([0.8, 0.9]);
  });

  it('skips trials where the evaluator is absent', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.8, verdict: 'pass' }),
      ]),
      makeTrial(1, [
        makeEvalResult({ evaluator: 'speed', score: 0.6, verdict: 'pass' }),
      ]),
    ];

    const scores = extractTrialScoresForEvaluator('accuracy', trials);
    expect(scores).toEqual([0.8]);
  });

  it('skips trials where evaluatorFailed is true', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.8, verdict: 'pass' }),
      ]),
      makeTrial(1, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.0, verdict: 'fail', evaluatorFailed: true }),
      ]),
    ];

    const scores = extractTrialScoresForEvaluator('accuracy', trials);
    expect(scores).toEqual([0.8]);
  });

  it('skips trials where verdict is unknown', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.8, verdict: 'pass' }),
      ]),
      makeTrial(1, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.0, verdict: 'unknown' }),
      ]),
    ];

    const scores = extractTrialScoresForEvaluator('accuracy', trials);
    expect(scores).toEqual([0.8]);
  });

  it('returns empty array when evaluator not present in any trial', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'speed', score: 0.5, verdict: 'pass' }),
      ]),
    ];

    const scores = extractTrialScoresForEvaluator('accuracy', trials);
    expect(scores).toEqual([]);
  });

  it('returns empty array for empty trials', () => {
    const scores = extractTrialScoresForEvaluator('accuracy', []);
    expect(scores).toEqual([]);
  });
});

describe('extractAllTrialScores', () => {
  it('groups scores by evaluator name across trials', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.8, verdict: 'pass' }),
        makeEvalResult({ evaluator: 'speed', score: 0.5, verdict: 'pass' }),
      ]),
      makeTrial(1, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.9, verdict: 'partial' }),
        makeEvalResult({ evaluator: 'speed', score: 0.6, verdict: 'pass' }),
      ]),
    ];

    const result = extractAllTrialScores(trials);
    expect(result.get('accuracy')).toEqual([0.8, 0.9]);
    expect(result.get('speed')).toEqual([0.5, 0.6]);
  });

  it('excludes evaluator-failed results', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.8, verdict: 'pass' }),
        makeEvalResult({ evaluator: 'accuracy', score: 0.0, verdict: 'fail', evaluatorFailed: true }),
      ]),
    ];

    const result = extractAllTrialScores(trials);
    expect(result.get('accuracy')).toEqual([0.8]);
  });

  it('excludes unknown-verdict results', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.8, verdict: 'pass' }),
      ]),
      makeTrial(1, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.0, verdict: 'unknown' }),
      ]),
    ];

    const result = extractAllTrialScores(trials);
    expect(result.get('accuracy')).toEqual([0.8]);
  });

  it('returns empty map for empty trials', () => {
    const result = extractAllTrialScores([]);
    expect(result.size).toBe(0);
  });

  it('handles trials with no valid results', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'accuracy', score: 0.0, verdict: 'unknown' }),
        makeEvalResult({ evaluator: 'speed', score: 0.0, verdict: 'fail', evaluatorFailed: true }),
      ]),
    ];

    const result = extractAllTrialScores(trials);
    expect(result.size).toBe(0);
  });

  it('includes observed-verdict results', () => {
    const trials: TrialResult[] = [
      makeTrial(0, [
        makeEvalResult({ evaluator: 'token-usage', score: 1500, verdict: 'observed' }),
      ]),
    ];

    const result = extractAllTrialScores(trials);
    expect(result.get('token-usage')).toEqual([1500]);
  });
});
