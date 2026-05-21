import { describe, it, expect } from 'vitest';
import { enrichScoreModePassRates } from '../score-mode-enricher.js';
import type { ScenarioResult, AggregatedResult, TrialResult } from '../../runner/types.js';
import type { BaselineScores } from '../types.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { ThresholdConfig } from '../threshold.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTrialWithScore(
  evaluator: string,
  score: number,
  verdict: EvalResult['verdict'] = 'observed',
): TrialResult {
  return {
    trialIndex: 0,
    transcript: {
      scenarioName: 'test-scenario',
      trialIndex: 0,
      turns: [],
      snapshots: [],
      errors: [],
    },
    evalResults: [{ evaluator, score, verdict, reason: '' }],
  };
}

function makeScoreModeAgg(options: {
  lowerIsBetter?: boolean;
  evalVersion?: string;
  medianScore?: number;
} = {}): AggregatedResult {
  return {
    regressionMode: 'score',
    passingTrials: 0,
    totalTrials: 3,
    medianScore: options.medianScore ?? 100,
    lowerIsBetter: options.lowerIsBetter,
    evalVersion: options.evalVersion,
  };
}

function makeScenario(
  evaluator: string,
  trials: TrialResult[],
  aggOverride: Partial<AggregatedResult> = {},
): ScenarioResult {
  return {
    scenarioName: 'test-scenario',
    stabilityLevel: 'medium',
    trials,
    aggregated: {
      [evaluator]: { ...makeScoreModeAgg(), ...aggOverride },
    },
  };
}

function makeBaseline(
  evaluator: string,
  medianScore: number,
  options: {
    evalVersion?: string;
    regressionThresholds?: Record<string, number>;
  } = {},
): BaselineScores {
  return {
    scenarioName: 'test-scenario',
    runId: 'run-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    scores: {
      [evaluator]: {
        passingTrials: 0,
        totalTrials: 3,
        medianScore,
        evalVersion: options.evalVersion,
      },
    },
    regressionThresholds: options.regressionThresholds,
  };
}

const defaultConfig: ThresholdConfig = {
  thresholds: {},
  defaultThreshold: 0.1,
};

// ── Validation boundary tests (trialPassesBaseline behavior) ──────────────────

describe('trialPassesBaseline boundary conditions', () => {
  describe('non-finite trial scores — explicit failure (non-finite scores never pass baseline)', () => {
    it('NaN trial score → passAtK=false, baselinePassingTrials=0', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', NaN),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      // Non-finite score: validTrials++ but no passingTrials++ → explicit failure
      expect(enriched['latency'].passAtK).toBe(false);
      expect(enriched['latency'].baselinePassingTrials).toBe(0);
    });

    it('Infinity trial score → passAtK=false', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', Infinity),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['latency'].passAtK).toBe(false);
    });

    it('-Infinity trial score → passAtK=false', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', -Infinity),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['latency'].passAtK).toBe(false);
    });
  });

  describe('lowerIsBetter + baselineMedian = 0', () => {
    it('trialScore <= 0 passes', () => {
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 0),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['tokens'].passAtK).toBe(true);
    });

    it('trialScore > 0 fails', () => {
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 1),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['tokens'].passAtK).toBe(false);
    });
  });

  describe('higherIsBetter + baselineMedian = 0', () => {
    it('any trial score passes (mirrors regression-comparator: no exceeded when baseline=0)', () => {
      const result = makeScenario('score', [
        makeTrialWithScore('score', 0),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('score', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['score'].passAtK).toBe(true);
    });

    it('negative trial score still passes when baseline=0 (higher-is-better)', () => {
      const result = makeScenario('score', [
        makeTrialWithScore('score', -5),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('score', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['score'].passAtK).toBe(true);
    });
  });

  describe('threshold = 0 (exact match only)', () => {
    it('score exactly at baseline passes (lowerIsBetter=true)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 100),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig);

      expect(enriched['tokens'].passAtK).toBe(true);
    });

    it('score above baseline fails with threshold=0 (lowerIsBetter=true)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 101),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig);

      expect(enriched['tokens'].passAtK).toBe(false);
    });

    it('score exactly at baseline passes (lowerIsBetter=false)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('quality', [
        makeTrialWithScore('quality', 100),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('quality', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig);

      expect(enriched['quality'].passAtK).toBe(true);
    });

    it('score below baseline fails with threshold=0 (lowerIsBetter=false)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('quality', [
        makeTrialWithScore('quality', 99),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('quality', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig);

      expect(enriched['quality'].passAtK).toBe(false);
    });
  });

  describe('undefined baselineMedian → skip enrichment', () => {
    it('baseline entry has no medianScore → passAtK remains undefined', () => {
      const baseline: BaselineScores = {
        scenarioName: 'test-scenario',
        runId: 'run-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        scores: {
          latency: { passingTrials: 0, totalTrials: 3 },
        },
      };
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', 90),
      ]);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['latency'].passAtK).toBeUndefined();
    });

    it('NaN medianScore in baseline → skip enrichment', () => {
      const baseline: BaselineScores = {
        scenarioName: 'test-scenario',
        runId: 'run-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        scores: {
          latency: { passingTrials: 0, totalTrials: 3, medianScore: NaN },
        },
      };
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', 90),
      ]);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['latency'].passAtK).toBeUndefined();
    });
  });

  describe('all trials verdict: unknown → skip enrichment', () => {
    it('passAtK remains undefined when all trials are unknown', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', 90, 'unknown'),
        makeTrialWithScore('latency', 95, 'unknown'),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

      expect(enriched['latency'].passAtK).toBeUndefined();
    });
  });
});

// ── Error path tests ──────────────────────────────────────────────────────────

describe('enrichScoreModePassRates error paths', () => {
  it('baseline missing evaluator entry → evaluator unchanged', () => {
    const baseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {},
    };
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ]);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].regressionMode).toBe('score');
  });

  it('evalVersion mismatch → evaluator unchanged', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ], { evalVersion: 'v2' });
    const baseline = makeBaseline('latency', 100, { evalVersion: 'v1' });

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBeUndefined();
  });

  it('evalVersion present in current but absent in baseline → evaluator unchanged', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ], { evalVersion: 'v1' });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBeUndefined();
  });

  it('evalVersion absent in current but present in baseline → evaluator unchanged', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ]);
    const baseline = makeBaseline('latency', 100, { evalVersion: 'v1' });

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBeUndefined();
  });

  it('evalVersion matches in both → enrichment proceeds', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ], { evalVersion: 'v1' });
    const baseline = makeBaseline('latency', 100, { evalVersion: 'v1' });

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBeDefined();
  });

  it('empty trials array → enrichment skipped (no data)', () => {
    const result = makeScenario('latency', []);
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].passToTheK).toBeUndefined();
    expect(enriched['latency'].passingTrials).toBe(0);
  });

  it('trial evalResults missing evaluator → trial excluded from count', () => {
    const trialWithoutEvaluator: TrialResult = {
      trialIndex: 0,
      transcript: {
        scenarioName: 'test-scenario',
        trialIndex: 0,
        turns: [],
        snapshots: [],
        errors: [],
      },
      evalResults: [{ evaluator: 'other', score: 50, verdict: 'observed', reason: '' }],
    };
    const result = makeScenario('latency', [trialWithoutEvaluator]);
    const baseline = makeBaseline('latency', 100);

    // Trial excluded, so zero valid trials → treated like empty trials
    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    // No trial has the evaluator → same as empty trials: passAtK remains undefined
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].passingTrials).toBe(0);
  });
});

// ── Core enrichment behavior ──────────────────────────────────────────────────

describe('enrichScoreModePassRates core behavior', () => {
  it('trial within threshold → passAtK=true, baselinePassingTrials=1', () => {
    // baseline=100, score=95, threshold=0.1 → (100-95)/100=0.05 <= 0.1 → pass
    const result = makeScenario('quality', [
      makeTrialWithScore('quality', 95),
    ], { lowerIsBetter: false });
    const baseline = makeBaseline('quality', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['quality'].passAtK).toBe(true);
    expect(enriched['quality'].baselinePassingTrials).toBe(1);
  });

  it('trial exceeds threshold → passAtK=false', () => {
    // baseline=100, score=80, threshold=0.1 → (100-80)/100=0.2 > 0.1 → fail
    const result = makeScenario('quality', [
      makeTrialWithScore('quality', 80),
    ], { lowerIsBetter: false });
    const baseline = makeBaseline('quality', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['quality'].passAtK).toBe(false);
  });

  it('NaN score (observed verdict) → passAtK=false, passToTheK=false', () => {
    // NaN is non-finite: counts as a valid trial (not unknown) but not a passing trial
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', NaN),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBe(false);
    expect(enriched['latency'].passToTheK).toBe(false);
  });

  it('lowerIsBetter: increase within threshold passes', () => {
    // baseline=100, score=105, threshold=0.1 → (105-100)/100=0.05 <= 0.1 → pass
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 105),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['tokens'].passAtK).toBe(true);
  });

  it('lowerIsBetter: decrease passes', () => {
    // baseline=100, score=90, threshold=0.1 → (90-100)/100=-0.1 <= 0.1 → pass
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 90),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['tokens'].passAtK).toBe(true);
  });

  it('lowerIsBetter: increase exceeds threshold fails', () => {
    // baseline=100, score=120, threshold=0.1 → (120-100)/100=0.2 > 0.1 → fail
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 120),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['tokens'].passAtK).toBe(false);
  });

  it('all trials pass → passAtK=true, passToTheK=true', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 95),
      makeTrialWithScore('latency', 98),
      makeTrialWithScore('latency', 92),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBe(true);
    expect(enriched['latency'].passToTheK).toBe(true);
    expect(enriched['latency'].baselinePassingTrials).toBe(3);
  });

  it('some trials pass → passAtK=true, passToTheK=false', () => {
    // trials: 95 (pass), 120 (fail, >10%), 98 (pass)
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 95),
      makeTrialWithScore('latency', 120),
      makeTrialWithScore('latency', 98),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['latency'].passAtK).toBe(true);
    expect(enriched['latency'].passToTheK).toBe(false);
    expect(enriched['latency'].baselinePassingTrials).toBe(2);
  });

  it('baseline regressionThreshold overrides config threshold', () => {
    // strict threshold=0.01: score=105 (5% increase) fails
    const configLoose = { thresholds: {}, defaultThreshold: 0.20 };
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 105),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100, {
      regressionThresholds: { tokens: 0.01 },
    });

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, configLoose);

    // baseline threshold=0.01 overrides config 0.20
    // (105-100)/100=0.05 > 0.01 → fails
    expect(enriched['tokens'].passAtK).toBe(false);
  });

  it('config per-evaluator threshold overrides defaultThreshold', () => {
    // strict per-evaluator threshold=0.01: score=105 (5% increase) fails
    const configStrict: ThresholdConfig = {
      thresholds: { tokens: 0.01 },
      defaultThreshold: 0.20,
    };
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 105),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, configStrict);

    expect(enriched['tokens'].passAtK).toBe(false);
  });

  it('pass-rate evaluators are copied unchanged', () => {
    const passRateAgg: AggregatedResult = {
      passAtK: true,
      passToTheK: false,
      passingTrials: 3,
      totalTrials: 5,
    };
    const scenarioWithMixed: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrialWithScore('latency', 90)],
      aggregated: {
        'bug-hit-rate': passRateAgg,
        'latency': makeScoreModeAgg({ lowerIsBetter: true }),
      },
    };
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(scenarioWithMixed, baseline, defaultConfig);

    expect(enriched['bug-hit-rate']).toStrictEqual(passRateAgg);
  });

  it('returns a new record — does not mutate input aggregated', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ]);
    const baseline = makeBaseline('latency', 100);
    const originalAgg = result.aggregated['latency'];
    const originalTrial = result.trials[0];
    const originalEvalResult = result.trials[0].evalResults[0];

    enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(result.aggregated['latency']).toBe(originalAgg);
    expect(result.aggregated['latency'].passAtK).toBeUndefined();
    // input trials array and EvalResult objects must not be mutated
    expect(result.trials[0]).toBe(originalTrial);
    expect(result.trials[0].evalResults[0]).toBe(originalEvalResult);
    expect(result.trials[0].evalResults[0].verdict).toBe('observed');
  });

  it('unknown-verdict trials excluded from denominator for passToTheK', () => {
    // 2 valid trials (both pass), 1 unknown (excluded)
    const trials: TrialResult[] = [
      makeTrialWithScore('latency', 95),
      makeTrialWithScore('latency', 98),
      makeTrialWithScore('latency', 200, 'unknown'),
    ];
    const result: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials,
      aggregated: {
        latency: { ...makeScoreModeAgg({ lowerIsBetter: true }), totalTrials: 3 },
      },
    };
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    // 2 valid trials, both pass → passToTheK=true
    expect(enriched['latency'].passToTheK).toBe(true);
    expect(enriched['latency'].baselinePassingTrials).toBe(2);
    // totalTrials unchanged
    expect(enriched['latency'].totalTrials).toBe(3);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('enrichScoreModePassRates edge cases', () => {
  it('single trial, single evaluator — passes threshold', () => {
    const result = makeScenario('cost', [
      makeTrialWithScore('cost', 0.05),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('cost', 0.10);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['cost'].passAtK).toBe(true);
    expect(enriched['cost'].baselinePassingTrials).toBe(1);
  });

  it('negative baseline with lowerIsBetter — trial passes (negative baseline is indeterminate)', () => {
    // baseline=-10, score=-15 (decrease, better for lowerIsBetter)
    // With negative baselineMedian, percentage change is undefined.
    // exceedsThreshold returns false → trial passes.
    // This matches RegressionComparator: baselineScore < 0 → exceeded=false.
    const result = makeScenario('metric', [
      makeTrialWithScore('metric', -15),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('metric', -10);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enriched['metric'].passAtK).toBe(true);
  });

  it('very large score (1e15) — no overflow', () => {
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 1e15 * 1.05),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 1e15);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig);

    // (1e15*1.05 - 1e15) / 1e15 = 0.05 <= 0.1 → pass
    expect(enriched['tokens'].passAtK).toBe(true);
  });

  it('mixed evaluators: pass-rate + score-mode-with-baseline + score-mode-without-baseline', () => {
    const mixed: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrialWithScore('latency', 90)],
      aggregated: {
        'bug-hit-rate': {
          passAtK: true,
          passToTheK: true,
          passingTrials: 3,
          totalTrials: 3,
        },
        'latency': {
          regressionMode: 'score',
          passingTrials: 0,
          totalTrials: 3,
          medianScore: 100,
          lowerIsBetter: true,
        },
        'cost': {
          regressionMode: 'score',
          passingTrials: 0,
          totalTrials: 3,
          medianScore: 0.5,
          lowerIsBetter: true,
        },
      },
    };
    const baseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {
        'latency': { passingTrials: 0, totalTrials: 3, medianScore: 100 },
        // cost has no baseline entry
      },
    };

    const { aggregated: enriched } = enrichScoreModePassRates(mixed, baseline, defaultConfig);

    // pass-rate: unchanged
    expect(enriched['bug-hit-rate'].passAtK).toBe(true);
    // latency: enriched (has baseline)
    expect(enriched['latency'].passAtK).toBeDefined();
    // cost: unchanged (no baseline)
    expect(enriched['cost'].passAtK).toBeUndefined();
  });
});

// ── Trial verdict enrichment — boundary tests ─────────────────────────────────

describe('trial verdict enrichment — boundary tests', () => {
  it('passing trial → verdict updated to pass', () => {
    // score=95, baseline=100, lowerIsBetter=true → 5% within 10% threshold → pass
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 95),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('pass');
    expect(evalResult.baselineComparison).toBe('latency: 95 vs baseline 100 (threshold 10%) → pass');
  });

  it('failing trial → verdict updated to fail', () => {
    // score=120, baseline=100, lowerIsBetter=true → 20% exceeds 10% threshold → fail
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 120),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('fail');
    expect(evalResult.baselineComparison).toBe('latency: 120 vs baseline 100 (threshold 10%) → fail');
  });

  it('NaN score → verdict updated to fail (Number.isFinite guard)', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', NaN),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('fail');
    expect(evalResult.baselineComparison).toBe('latency: NaN vs baseline 100 (threshold 10%) → fail');
  });

  it('+Infinity score → verdict updated to fail', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', Infinity),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('fail');
    expect(evalResult.baselineComparison).toBe('latency: Infinity vs baseline 100 (threshold 10%) → fail');
  });
});

// ── Trial verdict enrichment — error paths ────────────────────────────────────

describe('trial verdict enrichment — error paths', () => {
  it('verdict: unknown stays unknown (not enriched)', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90, 'unknown'),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('unknown');
  });

  it('evaluatorFailed: true (verdict: unknown) stays unknown', () => {
    const trial: TrialResult = {
      trialIndex: 0,
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [] },
      evalResults: [{ evaluator: 'latency', score: 90, verdict: 'unknown', reason: 'evaluator threw', evaluatorFailed: true }],
    };
    const result = makeScenario('latency', [trial], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('unknown');
  });

  it('unenriched evaluator (no baseline entry) stays observed', () => {
    const noEntryBaseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {},
    };
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ]);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, noEntryBaseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('observed');
  });

  it('pass-rate evaluator trial verdict unchanged', () => {
    const trial: TrialResult = {
      trialIndex: 0,
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [] },
      evalResults: [{ evaluator: 'bug-hit-rate', score: 1.0, verdict: 'pass', reason: '' }],
    };
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [trial],
      aggregated: {
        'bug-hit-rate': { passAtK: true, passToTheK: true, passingTrials: 1, totalTrials: 1 },
      },
    };
    const baseline = makeBaseline('bug-hit-rate', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(scenario, baseline, defaultConfig);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'bug-hit-rate')!;
    expect(evalResult.verdict).toBe('pass');
  });
});

// ── Trial verdict enrichment — seam and edge cases ───────────────────────────

describe('trial verdict enrichment — seam and edge cases', () => {
  it('multiple score-mode evaluators per trial updated independently', () => {
    // latency: 120 (fail, lowerIsBetter), quality: 95 (pass, higherIsBetter)
    const trial: TrialResult = {
      trialIndex: 0,
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [] },
      evalResults: [
        { evaluator: 'latency', score: 120, verdict: 'observed', reason: '' },
        { evaluator: 'quality', score: 95, verdict: 'observed', reason: '' },
      ],
    };
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [trial],
      aggregated: {
        latency: { regressionMode: 'score', passingTrials: 0, totalTrials: 1, medianScore: 100, lowerIsBetter: true },
        quality: { regressionMode: 'score', passingTrials: 0, totalTrials: 1, medianScore: 100, lowerIsBetter: false },
      },
    };
    const baseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {
        latency: { passingTrials: 0, totalTrials: 1, medianScore: 100 },
        quality: { passingTrials: 0, totalTrials: 1, medianScore: 100 },
      },
    };

    const { trials: enrichedTrials } = enrichScoreModePassRates(scenario, baseline, defaultConfig);

    const latencyResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    const qualityResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'quality')!;
    expect(latencyResult.verdict).toBe('fail');
    expect(latencyResult.baselineComparison).toBe('latency: 120 vs baseline 100 (threshold 10%) → fail');
    expect(qualityResult.verdict).toBe('pass');
    expect(qualityResult.baselineComparison).toBe('quality: 95 vs baseline 100 (threshold 10%) → pass');
  });

  it('mixed enriched + unenriched evaluator in same trial', () => {
    // latency has baseline (will be enriched), cost has no baseline (stays observed)
    const trial: TrialResult = {
      trialIndex: 0,
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [] },
      evalResults: [
        { evaluator: 'latency', score: 95, verdict: 'observed', reason: '' },
        { evaluator: 'cost', score: 0.05, verdict: 'observed', reason: '' },
      ],
    };
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [trial],
      aggregated: {
        latency: { regressionMode: 'score', passingTrials: 0, totalTrials: 1, medianScore: 100, lowerIsBetter: true },
        cost: { regressionMode: 'score', passingTrials: 0, totalTrials: 1, medianScore: 0.10, lowerIsBetter: true },
      },
    };
    const baseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {
        latency: { passingTrials: 0, totalTrials: 1, medianScore: 100 },
        // cost has no baseline entry
      },
    };

    const { trials: enrichedTrials } = enrichScoreModePassRates(scenario, baseline, defaultConfig);

    const latencyResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    const costResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'cost')!;
    expect(latencyResult.verdict).toBe('pass');
    expect(latencyResult.baselineComparison).toBe('latency: 95 vs baseline 100 (threshold 10%) → pass');
    expect(costResult.verdict).toBe('observed');
    expect(costResult.baselineComparison).toBeUndefined();
  });

  it('enriched trials are new TrialResult objects, not same reference as input', () => {
    // score=120 (fail) ensures the trial actually needs updating, producing a new object
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 120),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);
    const inputTrial = result.trials[0];

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig);

    expect(enrichedTrials[0]).not.toBe(inputTrial);
    expect(enrichedTrials[0].evalResults[0]).not.toBe(inputTrial.evalResults[0]);
    expect(enrichedTrials[0].evalResults[0].verdict).toBe('fail');
    expect(enrichedTrials[0].evalResults[0].baselineComparison).toBe('latency: 120 vs baseline 100 (threshold 10%) → fail');
    // original input untouched
    expect(inputTrial.evalResults[0].verdict).toBe('observed');
  });
});
