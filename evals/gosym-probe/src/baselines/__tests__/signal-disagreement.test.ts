import { describe, it, expect } from 'vitest';
import { findSignalDisagreements } from '../signal-disagreement.js';
import type { ScenarioResult, TrialResult } from '../../runner/types.js';
import type { EvalResult } from '../../evaluators/evaluator.js';

function evalResult(
  evaluator: string,
  verdict: EvalResult['verdict'],
): EvalResult {
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
  return {
    scenarioName: 'build-landing-page',
    stabilityLevel: 'low',
    trials,
    aggregated: {},
  };
}

function pair(
  staticVerdict: EvalResult['verdict'],
  judgeVerdict: EvalResult['verdict'],
): ScenarioResult[] {
  return [
    scenario([
      trial(0, [
        evalResult('expected-artifact-match', staticVerdict),
        evalResult('narrow-artifact-judge', judgeVerdict),
      ]),
    ]),
  ];
}

describe('findSignalDisagreements', () => {
  it('flags static-fail / judge-pass', () => {
    const out = findSignalDisagreements(pair('fail', 'pass'));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('static-fail-judge-pass');
    expect(out[0].trialLabel).toBe('T1');
  });

  it('flags static-pass / judge-fail', () => {
    const out = findSignalDisagreements(pair('pass', 'fail'));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('static-pass-judge-fail');
  });

  it('does not flag agreement (both pass)', () => {
    expect(findSignalDisagreements(pair('pass', 'pass'))).toHaveLength(0);
  });

  it('does not flag agreement (both fail)', () => {
    expect(findSignalDisagreements(pair('fail', 'fail'))).toHaveLength(0);
  });

  it('skips non-comparable verdicts (incomplete, directional)', () => {
    expect(findSignalDisagreements(pair('incomplete', 'pass'))).toHaveLength(0);
    expect(findSignalDisagreements(pair('pass', 'incomplete'))).toHaveLength(0);
    expect(findSignalDisagreements(pair('directional', 'pass'))).toHaveLength(0);
    expect(findSignalDisagreements(pair('pass', 'directional'))).toHaveLength(0);
  });

  it('skips when one evaluator is absent', () => {
    const results = [
      scenario([trial(0, [evalResult('expected-artifact-match', 'fail')])]),
    ];
    expect(findSignalDisagreements(results)).toHaveLength(0);
  });

  it('reports each disagreeing trial across a multi-trial scenario', () => {
    const results = [
      scenario([
        trial(0, [
          evalResult('expected-artifact-match', 'fail'),
          evalResult('narrow-artifact-judge', 'pass'),
        ]),
        trial(1, [
          evalResult('expected-artifact-match', 'pass'),
          evalResult('narrow-artifact-judge', 'pass'),
        ]),
        trial(2, [
          evalResult('expected-artifact-match', 'pass'),
          evalResult('narrow-artifact-judge', 'fail'),
        ]),
      ]),
    ];
    const out = findSignalDisagreements(results);
    expect(out.map((d) => d.trialLabel)).toEqual(['T1', 'T3']);
  });

  it('honors custom evaluator names', () => {
    const results = [
      scenario([
        trial(0, [
          evalResult('static-x', 'fail'),
          evalResult('judge-y', 'pass'),
        ]),
      ]),
    ];
    expect(
      findSignalDisagreements(results, 'static-x', 'judge-y'),
    ).toHaveLength(1);
  });
});
