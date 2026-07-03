import { describe, it, expect } from 'vitest';
import { computeGraderStability } from '../grader-stability.js';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';
import type { EvalResult } from '../../evaluators/evaluator.js';

function ev(evaluator: string, verdict: EvalResult['verdict']): EvalResult {
  return { evaluator, score: verdict === 'pass' ? 1 : 0, verdict, reason: 'x' };
}

function trial(index: number, results: EvalResult[]): TrialResult {
  return {
    trialIndex: index,
    transcript: {
      scenarioName: 'test',
      trialIndex: index,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
    },
    evalResults: results,
  };
}

function scenario(trials: TrialResult[]): ScenarioResult {
  return { scenarioName: 's', stabilityLevel: 'low', trials, aggregated: {} };
}

function find(s: ReturnType<typeof computeGraderStability>, name: string) {
  return s.perEvaluator.find((e) => e.evaluator === name);
}

describe('computeGraderStability', () => {
  it('flip-rate is 1/N when an evaluator holds one verdict across trials', () => {
    const s = computeGraderStability([
      scenario([
        trial(0, [ev('static', 'pass')]),
        trial(1, [ev('static', 'pass')]),
        trial(2, [ev('static', 'pass')]),
        trial(3, [ev('static', 'pass')]),
      ]),
    ]);
    const e = find(s, 'static')!;
    expect(e.trials).toBe(4);
    expect(e.distinctVerdicts).toBe(1);
    expect(e.flipRate).toBeCloseTo(0.25);
  });

  it('flip-rate rises with a noisier (flipping) evaluator', () => {
    const s = computeGraderStability([
      scenario([
        trial(0, [ev('judge', 'pass')]),
        trial(1, [ev('judge', 'fail')]),
        trial(2, [ev('judge', 'incomplete')]),
        trial(3, [ev('judge', 'pass')]),
      ]),
    ]);
    const e = find(s, 'judge')!;
    expect(e.distinctVerdicts).toBe(3);
    expect(e.flipRate).toBeCloseTo(0.75);
  });

  it('excludes observed (score-mode) evaluators from flip-rate', () => {
    const s = computeGraderStability([
      scenario([
        trial(0, [ev('token-usage', 'directional')]),
        trial(1, [ev('token-usage', 'directional')]),
      ]),
    ]);
    expect(find(s, 'token-usage')).toBeUndefined();
  });

  it('computes static-vs-judge disagreement rate over comparable trials', () => {
    const s = computeGraderStability([
      scenario([
        // disagree
        trial(0, [
          ev('expected-artifact-match', 'fail'),
          ev('narrow-artifact-judge', 'pass'),
        ]),
        // agree
        trial(1, [
          ev('expected-artifact-match', 'pass'),
          ev('narrow-artifact-judge', 'pass'),
        ]),
        // judge unknown → not comparable, excluded from denominator
        trial(2, [
          ev('expected-artifact-match', 'pass'),
          ev('narrow-artifact-judge', 'incomplete'),
        ]),
      ]),
    ]);
    expect(s.comparableTrials).toBe(2);
    expect(s.disagreements).toBe(1);
    expect(s.disagreementRate).toBeCloseTo(0.5);
  });

  it('disagreement rate is 0 when there are no comparable trials', () => {
    const s = computeGraderStability([
      scenario([trial(0, [ev('expected-artifact-match', 'pass')])]),
    ]);
    expect(s.comparableTrials).toBe(0);
    expect(s.disagreementRate).toBe(0);
  });
});
