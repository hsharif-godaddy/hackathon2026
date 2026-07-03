import { describe, it, expect } from 'vitest';
import { enrichScoreModePassRates } from '../score-mode-enricher.js';
import type { ReportingKConfig } from '../score-mode-enricher.js';
import type { ScenarioResult, AggregatedResult, TrialResult } from '../../runner/types.js';
import type { BaselineScores, RegressionResult } from '../types.js';
import type { EvalResult } from '../../evaluators/evaluator.js';
import type { ThresholdConfig } from '../threshold.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTrialWithScore(
  evaluator: string,
  score: number,
  verdict: EvalResult['verdict'] = 'directional',
): TrialResult {
  return {
    trialIndex: 0,
    transcript: {
      scenarioName: 'test-scenario',
      trialIndex: 0,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
    },
    evalResults: [{ evaluator, score, verdict, reason: '' }],
  };
}

function makeScoreModeAgg(options: {
  lowerIsBetter?: boolean;
  evalVersion?: string;
  aggregateScore?: number;
} = {}): AggregatedResult {
  return {
    comparisonMode: 'score',
    passingTrials: 0,
    totalTrials: 3,
    aggregateScore: options.aggregateScore ?? 100,
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
  aggregateScore: number,
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
        aggregateScore,
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

const defaultReporting: ReportingKConfig = { reportingK: [1, 2, 3, 5, 10] };

// ── Validation boundary tests (trialPassesBaseline behavior) ──────────────────

describe('trialPassesBaseline boundary conditions', () => {
  describe('non-finite trial scores — excluded from valid trials (never counted, verdict untouched)', () => {
    it('NaN trial score (sole trial) → enrichment skipped, estimators undefined', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', NaN),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      // Non-finite score is skipped before validTrials++ → validTrials=0 → enrichment skipped.
      expect(enriched['latency'].passAt1).toBeUndefined();
      expect(enriched['latency'].passAtK).toBeUndefined();
      expect(enriched['latency'].passHatK).toBeUndefined();
      expect(enriched['latency'].baselinePassingTrials).toBeUndefined();
    });

    it('Infinity trial score (sole trial) → enrichment skipped, estimators undefined', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', Infinity),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['latency'].passAt1).toBeUndefined();
      expect(enriched['latency'].passAtK).toBeUndefined();
      expect(enriched['latency'].passHatK).toBeUndefined();
      expect(enriched['latency'].baselinePassingTrials).toBeUndefined();
    });

    it('-Infinity trial score (sole trial) → enrichment skipped, estimators undefined', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', -Infinity),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['latency'].passAt1).toBeUndefined();
      expect(enriched['latency'].passAtK).toBeUndefined();
      expect(enriched['latency'].passHatK).toBeUndefined();
      expect(enriched['latency'].baselinePassingTrials).toBeUndefined();
    });

    it('mixed finite + non-finite trials → non-finite dropped from denominator, enrichment proceeds', () => {
      // Two finite passing trials + one NaN trial, distinct trial indices. The NaN
      // trial is excluded from validTrials, so n=2 (both pass) rather than n=3 with
      // one forced failure.
      const trials = [
        makeTrialWithScoreAndIndex('latency', 95, 0),
        makeTrialWithScoreAndIndex('latency', NaN, 1),
        makeTrialWithScoreAndIndex('latency', 98, 2),
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

      const { aggregated: enriched, trials: enrichedTrials } = enrichScoreModePassRates(
        result, baseline, defaultConfig, defaultReporting,
      );

      // n=2 valid (the NaN trial is dropped), c=2 → all pass. resolvedKs=[1] (ceil(2/2)=1).
      expect(enriched['latency'].passAt1).toBe(1);
      expect(enriched['latency'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(enriched['latency'].passHatK).toEqual([{ k: 1, value: 1 }]);
      expect(enriched['latency'].baselinePassingTrials).toBe(2);
      // The NaN trial's verdict is left untouched (never compared against baseline).
      const nanResult = enrichedTrials[1].evalResults.find((e) => e.evaluator === 'latency')!;
      expect(nanResult.verdict).toBe('directional');
      expect(nanResult.baselineComparison).toBeUndefined();
    });
  });

  describe('lowerIsBetter + baseline aggregateScore = 0', () => {
    it('trialScore <= 0 passes', () => {
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 0),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['tokens'].passAt1).toBe(1);
      expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 1 }]);
    });

    it('trialScore > 0 fails', () => {
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 1),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['tokens'].passAt1).toBe(0);
      expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 0 }]);
      expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 0 }]);
    });
  });

  describe('higherIsBetter + baseline aggregateScore = 0', () => {
    it('any trial score passes (mirrors regression-comparator: no exceeded when baseline=0)', () => {
      const result = makeScenario('score', [
        makeTrialWithScore('score', 0),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('score', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['score'].passAt1).toBe(1);
      expect(enriched['score'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(enriched['score'].passHatK).toEqual([{ k: 1, value: 1 }]);
    });

    it('negative trial score still passes when baseline=0 (higher-is-better)', () => {
      const result = makeScenario('score', [
        makeTrialWithScore('score', -5),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('score', 0);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['score'].passAt1).toBe(1);
      expect(enriched['score'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(enriched['score'].passHatK).toEqual([{ k: 1, value: 1 }]);
    });
  });

  describe('threshold = 0 (exact match only)', () => {
    it('score exactly at baseline passes (lowerIsBetter=true)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 100),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig, defaultReporting);

      expect(enriched['tokens'].passAt1).toBe(1);
      expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 1 }]);
    });

    it('score above baseline fails with threshold=0 (lowerIsBetter=true)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('tokens', [
        makeTrialWithScore('tokens', 101),
      ], { lowerIsBetter: true });
      const baseline = makeBaseline('tokens', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig, defaultReporting);

      expect(enriched['tokens'].passAt1).toBe(0);
      expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 0 }]);
      expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 0 }]);
    });

    it('score exactly at baseline passes (lowerIsBetter=false)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('quality', [
        makeTrialWithScore('quality', 100),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('quality', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig, defaultReporting);

      expect(enriched['quality'].passAt1).toBe(1);
      expect(enriched['quality'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(enriched['quality'].passHatK).toEqual([{ k: 1, value: 1 }]);
    });

    it('score below baseline fails with threshold=0 (lowerIsBetter=false)', () => {
      const zeroThresholdConfig = { thresholds: {}, defaultThreshold: 0 };
      const result = makeScenario('quality', [
        makeTrialWithScore('quality', 99),
      ], { lowerIsBetter: false });
      const baseline = makeBaseline('quality', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, zeroThresholdConfig, defaultReporting);

      expect(enriched['quality'].passAt1).toBe(0);
      expect(enriched['quality'].passAtK).toEqual([{ k: 1, value: 0 }]);
      expect(enriched['quality'].passHatK).toEqual([{ k: 1, value: 0 }]);
    });
  });

  describe('undefined baseline aggregateScore → skip enrichment', () => {
    it('baseline entry has no aggregateScore → estimators remain undefined', () => {
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

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['latency'].passAt1).toBeUndefined();
      expect(enriched['latency'].passAtK).toBeUndefined();
      expect(enriched['latency'].passHatK).toBeUndefined();
    });

    it('NaN aggregateScore in baseline → skip enrichment', () => {
      const baseline: BaselineScores = {
        scenarioName: 'test-scenario',
        runId: 'run-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        scores: {
          latency: { passingTrials: 0, totalTrials: 3, aggregateScore: NaN },
        },
      };
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', 90),
      ]);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['latency'].passAt1).toBeUndefined();
      expect(enriched['latency'].passAtK).toBeUndefined();
      expect(enriched['latency'].passHatK).toBeUndefined();
    });
  });

  describe('all trials verdict: unknown → skip enrichment', () => {
    it('estimators remain undefined when all trials are unknown', () => {
      const result = makeScenario('latency', [
        makeTrialWithScore('latency', 90, 'incomplete'),
        makeTrialWithScore('latency', 95, 'incomplete'),
      ]);
      const baseline = makeBaseline('latency', 100);

      const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

      expect(enriched['latency'].passAt1).toBeUndefined();
      expect(enriched['latency'].passAtK).toBeUndefined();
      expect(enriched['latency'].passHatK).toBeUndefined();
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

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].comparisonMode).toBe('score');
  });

  it('evalVersion mismatch → evaluator unchanged', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ], { evalVersion: 'v2' });
    const baseline = makeBaseline('latency', 100, { evalVersion: 'v1' });

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
  });

  it('evalVersion present in current but absent in baseline → evaluator unchanged', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ], { evalVersion: 'v1' });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
  });

  it('evalVersion absent in current but present in baseline → evaluator unchanged', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ]);
    const baseline = makeBaseline('latency', 100, { evalVersion: 'v1' });

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
  });

  it('evalVersion matches in both → enrichment proceeds', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ], { evalVersion: 'v1' });
    const baseline = makeBaseline('latency', 100, { evalVersion: 'v1' });

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['latency'].passAt1).toBeDefined();
    expect(enriched['latency'].passAtK).toBeDefined();
  });

  it('empty trials array → enrichment skipped (no data)', () => {
    const result = makeScenario('latency', []);
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].passHatK).toBeUndefined();
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
        captureErrors: [],
      },
      evalResults: [{ evaluator: 'other', score: 50, verdict: 'directional', reason: '' }],
    };
    const result = makeScenario('latency', [trialWithoutEvaluator]);
    const baseline = makeBaseline('latency', 100);

    // Trial excluded, so zero valid trials → treated like empty trials
    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // No trial has the evaluator → same as empty trials: estimators remain undefined
    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].passingTrials).toBe(0);
  });
});

// ── Core enrichment behavior ──────────────────────────────────────────────────

describe('enrichScoreModePassRates core behavior', () => {
  it('trial within threshold → passAt1=1, baselinePassingTrials=1', () => {
    // baseline=100, score=95, threshold=0.1 → (100-95)/100=0.05 <= 0.1 → pass
    const result = makeScenario('quality', [
      makeTrialWithScore('quality', 95),
    ], { lowerIsBetter: false });
    const baseline = makeBaseline('quality', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // n=1, c=1, resolvedKs=[1]
    expect(enriched['quality'].passAt1).toBe(1);
    expect(enriched['quality'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['quality'].passHatK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['quality'].baselinePassingTrials).toBe(1);
  });

  it('trial exceeds threshold → passAt1=0', () => {
    // baseline=100, score=80, threshold=0.1 → (100-80)/100=0.2 > 0.1 → fail
    const result = makeScenario('quality', [
      makeTrialWithScore('quality', 80),
    ], { lowerIsBetter: false });
    const baseline = makeBaseline('quality', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // n=1, c=0, resolvedKs=[1]
    expect(enriched['quality'].passAt1).toBe(0);
    expect(enriched['quality'].passAtK).toEqual([{ k: 1, value: 0 }]);
    expect(enriched['quality'].passHatK).toEqual([{ k: 1, value: 0 }]);
  });

  it('NaN score (observed verdict, sole trial) → excluded from valid trials, enrichment skipped', () => {
    // NaN is non-finite: skipped before validTrials++ → validTrials=0 → enrichment skipped.
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', NaN),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].passHatK).toBeUndefined();
  });

  it('lowerIsBetter: increase within threshold passes', () => {
    // baseline=100, score=105, threshold=0.1 → (105-100)/100=0.05 <= 0.1 → pass
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 105),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['tokens'].passAt1).toBe(1);
    expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 1 }]);
  });

  it('lowerIsBetter: decrease passes', () => {
    // baseline=100, score=90, threshold=0.1 → (90-100)/100=-0.1 <= 0.1 → pass
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 90),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['tokens'].passAt1).toBe(1);
    expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 1 }]);
  });

  it('lowerIsBetter: increase exceeds threshold fails', () => {
    // baseline=100, score=120, threshold=0.1 → (120-100)/100=0.2 > 0.1 → fail
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 120),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['tokens'].passAt1).toBe(0);
    expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 0 }]);
    expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 0 }]);
  });

  it('all trials pass → passAt1=1, passHatK all 1', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 95),
      makeTrialWithScore('latency', 98),
      makeTrialWithScore('latency', 92),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // n=3, c=3, resolvedKs=[1,2] (ceil(3/2)=2 caps the vector)
    expect(enriched['latency'].passAt1).toBe(1);
    expect(enriched['latency'].passAtK).toEqual([{ k: 1, value: 1 }, { k: 2, value: 1 }]);
    expect(enriched['latency'].passHatK).toEqual([{ k: 1, value: 1 }, { k: 2, value: 1 }]);
    expect(enriched['latency'].baselinePassingTrials).toBe(3);
  });

  it('some trials pass → passAt1=2/3, passHatK < 1', () => {
    // trials: 95 (pass), 120 (fail, >10%), 98 (pass)
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 95),
      makeTrialWithScore('latency', 120),
      makeTrialWithScore('latency', 98),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // n=3, c=2, resolvedKs=[1,2]
    // passAt1 = 2/3
    // passAtK: k=1 → 2/3, k=2 → 1 (n-c=1 < k=2 → 1)
    // passHatK: k=1 → 2/3, k=2 → (2/3)*(1/2) = 1/3
    expect(enriched['latency'].passAt1).toBeCloseTo(2 / 3);
    expect(enriched['latency'].passAtK).toEqual([{ k: 1, value: expect.closeTo(2 / 3) }, { k: 2, value: 1 }]);
    expect(enriched['latency'].passHatK).toEqual([{ k: 1, value: expect.closeTo(2 / 3) }, { k: 2, value: expect.closeTo(1 / 3) }]);
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

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, configLoose, defaultReporting);

    // baseline threshold=0.01 overrides config 0.20
    // (105-100)/100=0.05 > 0.01 → fails
    expect(enriched['tokens'].passAt1).toBe(0);
    expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 0 }]);
    expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 0 }]);
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

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, configStrict, defaultReporting);

    expect(enriched['tokens'].passAt1).toBe(0);
    expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 0 }]);
    expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 0 }]);
  });

  it('pass-rate evaluators are copied unchanged', () => {
    const passRateAgg: AggregatedResult = {
      passAt1: 0.6,
      passAtK: [{ k: 1, value: 0.6 }, { k: 2, value: 0.84 }],
      passHatK: [{ k: 1, value: 0.6 }, { k: 2, value: 0.3 }],
      passingTrials: 3,
      totalTrials: 5,
      comparisonMode: 'passRate',
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

    const { aggregated: enriched } = enrichScoreModePassRates(scenarioWithMixed, baseline, defaultConfig, defaultReporting);

    expect(enriched['bug-hit-rate']).toStrictEqual(passRateAgg);
  });

  it('wilsonCI is stripped from enriched score-mode rows (never leaks to aggregated.json)', () => {
    // n=3, c=2 — a non-degenerate sample that causes buildPassEstimators to
    // produce a wilsonCI interval. The enricher must strip it before writing
    // back to aggregated so it never appears in aggregated.json output.
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 95),
      makeTrialWithScore('latency', 120),
      makeTrialWithScore('latency', 98),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // Estimators must be present (confirming the threshold path ran and produced output).
    expect(enriched['latency'].passAt1).toBeDefined();
    // wilsonCI must be absent — the enricher deliberately strips it.
    expect((enriched['latency'] as unknown as Record<string, unknown>)['wilsonCI']).toBeUndefined();
  });

  it('returns a new record — does not mutate input aggregated', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90),
    ]);
    const baseline = makeBaseline('latency', 100);
    const originalAgg = result.aggregated['latency'];
    const originalTrial = result.trials[0];
    const originalEvalResult = result.trials[0].evalResults[0];

    enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(result.aggregated['latency']).toBe(originalAgg);
    expect(result.aggregated['latency'].passAt1).toBeUndefined();
    expect(result.aggregated['latency'].passAtK).toBeUndefined();
    // input trials array and EvalResult objects must not be mutated
    expect(result.trials[0]).toBe(originalTrial);
    expect(result.trials[0].evalResults[0]).toBe(originalEvalResult);
    expect(result.trials[0].evalResults[0].verdict).toBe('directional');
  });

  it('unknown-verdict trials excluded from denominator', () => {
    // 2 valid trials (both pass), 1 unknown (excluded)
    const trials: TrialResult[] = [
      makeTrialWithScore('latency', 95),
      makeTrialWithScore('latency', 98),
      makeTrialWithScore('latency', 200, 'incomplete'),
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

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // n=2 (valid), c=2, resolvedKs=[1] (ceil(2/2)=1)
    expect(enriched['latency'].passAt1).toBe(1);
    expect(enriched['latency'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['latency'].passHatK).toEqual([{ k: 1, value: 1 }]);
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

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['cost'].passAt1).toBe(1);
    expect(enriched['cost'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['cost'].passHatK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['cost'].baselinePassingTrials).toBe(1);
  });

  it('negative baseline with lowerIsBetter — trial passes (negative baseline is indeterminate)', () => {
    // baseline=-10, score=-15 (decrease, better for lowerIsBetter)
    // With negative baseline aggregateScore, percentage change is undefined.
    // exceedsThreshold returns false → trial passes.
    // This matches RegressionComparator: baselineScore < 0 → exceeded=false.
    const result = makeScenario('metric', [
      makeTrialWithScore('metric', -15),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('metric', -10);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enriched['metric'].passAt1).toBe(1);
    expect(enriched['metric'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['metric'].passHatK).toEqual([{ k: 1, value: 1 }]);
  });

  it('very large score (1e15) — no overflow', () => {
    const result = makeScenario('tokens', [
      makeTrialWithScore('tokens', 1e15 * 1.05),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('tokens', 1e15);

    const { aggregated: enriched } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    // (1e15*1.05 - 1e15) / 1e15 = 0.05 <= 0.1 → pass
    expect(enriched['tokens'].passAt1).toBe(1);
    expect(enriched['tokens'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['tokens'].passHatK).toEqual([{ k: 1, value: 1 }]);
  });

  it('mixed evaluators: pass-rate + score-mode-with-baseline + score-mode-without-baseline', () => {
    const mixed: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrialWithScore('latency', 90)],
      aggregated: {
        'bug-hit-rate': {
          passAt1: 1,
          passAtK: [{ k: 1, value: 1 }],
          passHatK: [{ k: 1, value: 1 }],
          passingTrials: 3,
          totalTrials: 3,
          comparisonMode: 'passRate' as const,
        },
        'latency': {
          comparisonMode: 'score',
          passingTrials: 0,
          totalTrials: 3,
          aggregateScore: 100,
          lowerIsBetter: true,
        },
        'cost': {
          comparisonMode: 'score',
          passingTrials: 0,
          totalTrials: 3,
          aggregateScore: 0.5,
          lowerIsBetter: true,
        },
      },
    };
    const baseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {
        'latency': { passingTrials: 0, totalTrials: 3, aggregateScore: 100 },
        // cost has no baseline entry
      },
    };

    const { aggregated: enriched } = enrichScoreModePassRates(mixed, baseline, defaultConfig, defaultReporting);

    // pass-rate: unchanged
    expect(enriched['bug-hit-rate'].passAt1).toBe(1);
    expect(enriched['bug-hit-rate'].passAtK).toEqual([{ k: 1, value: 1 }]);
    // latency: enriched (has baseline)
    expect(enriched['latency'].passAt1).toBeDefined();
    expect(enriched['latency'].passAtK).toBeDefined();
    // cost: unchanged (no baseline)
    expect(enriched['cost'].passAt1).toBeUndefined();
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

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

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

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('fail');
    expect(evalResult.baselineComparison).toBe('latency: 120 vs baseline 100 (threshold 10%) → fail');
  });

  it('NaN score → verdict left untouched (non-finite excluded from comparison)', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', NaN),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('directional');
    expect(evalResult.baselineComparison).toBeUndefined();
  });

  it('+Infinity score → verdict left untouched (non-finite excluded from comparison)', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', Infinity),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('directional');
    expect(evalResult.baselineComparison).toBeUndefined();
  });
});

// ── Trial verdict enrichment — error paths ────────────────────────────────────

describe('trial verdict enrichment — error paths', () => {
  it('verdict: unknown stays unknown (not enriched)', () => {
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 90, 'incomplete'),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('incomplete');
  });

  it('evaluatorFailed: true (verdict: unknown) stays unknown', () => {
    const trial: TrialResult = {
      trialIndex: 0,
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [], captureErrors: [] },
      evalResults: [{ evaluator: 'latency', score: 90, verdict: 'incomplete', reason: 'evaluator threw', evaluatorFailed: true }],
    };
    const result = makeScenario('latency', [trial], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('incomplete');
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

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, noEntryBaseline, defaultConfig, defaultReporting);

    const evalResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    expect(evalResult.verdict).toBe('directional');
  });

  it('pass-rate evaluator trial verdict unchanged', () => {
    const trial: TrialResult = {
      trialIndex: 0,
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [], captureErrors: [] },
      evalResults: [{ evaluator: 'bug-hit-rate', score: 1.0, verdict: 'pass', reason: '' }],
    };
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [trial],
      aggregated: {
        'bug-hit-rate': { passAt1: 1, passAtK: [{ k: 1, value: 1 }], passHatK: [{ k: 1, value: 1 }], passingTrials: 1, totalTrials: 1, comparisonMode: 'passRate' as const },
      },
    };
    const baseline = makeBaseline('bug-hit-rate', 100);

    const { trials: enrichedTrials } = enrichScoreModePassRates(scenario, baseline, defaultConfig, defaultReporting);

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
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [], captureErrors: [] },
      evalResults: [
        { evaluator: 'latency', score: 120, verdict: 'directional', reason: '' },
        { evaluator: 'quality', score: 95, verdict: 'directional', reason: '' },
      ],
    };
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [trial],
      aggregated: {
        latency: { comparisonMode: 'score', passingTrials: 0, totalTrials: 1, aggregateScore: 100, lowerIsBetter: true },
        quality: { comparisonMode: 'score', passingTrials: 0, totalTrials: 1, aggregateScore: 100, lowerIsBetter: false },
      },
    };
    const baseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {
        latency: { passingTrials: 0, totalTrials: 1, aggregateScore: 100 },
        quality: { passingTrials: 0, totalTrials: 1, aggregateScore: 100 },
      },
    };

    const { trials: enrichedTrials } = enrichScoreModePassRates(scenario, baseline, defaultConfig, defaultReporting);

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
      transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [], captureErrors: [] },
      evalResults: [
        { evaluator: 'latency', score: 95, verdict: 'directional', reason: '' },
        { evaluator: 'cost', score: 0.05, verdict: 'directional', reason: '' },
      ],
    };
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [trial],
      aggregated: {
        latency: { comparisonMode: 'score', passingTrials: 0, totalTrials: 1, aggregateScore: 100, lowerIsBetter: true },
        cost: { comparisonMode: 'score', passingTrials: 0, totalTrials: 1, aggregateScore: 0.10, lowerIsBetter: true },
      },
    };
    const baseline: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: {
        latency: { passingTrials: 0, totalTrials: 1, aggregateScore: 100 },
        // cost has no baseline entry
      },
    };

    const { trials: enrichedTrials } = enrichScoreModePassRates(scenario, baseline, defaultConfig, defaultReporting);

    const latencyResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'latency')!;
    const costResult = enrichedTrials[0].evalResults.find((e) => e.evaluator === 'cost')!;
    expect(latencyResult.verdict).toBe('pass');
    expect(latencyResult.baselineComparison).toBe('latency: 95 vs baseline 100 (threshold 10%) → pass');
    expect(costResult.verdict).toBe('directional');
    expect(costResult.baselineComparison).toBeUndefined();
  });

  it('enriched trials are new TrialResult objects, not same reference as input', () => {
    // score=120 (fail) ensures the trial actually needs updating, producing a new object
    const result = makeScenario('latency', [
      makeTrialWithScore('latency', 120),
    ], { lowerIsBetter: true });
    const baseline = makeBaseline('latency', 100);
    const inputTrial = result.trials[0];

    const { trials: enrichedTrials } = enrichScoreModePassRates(result, baseline, defaultConfig, defaultReporting);

    expect(enrichedTrials[0]).not.toBe(inputTrial);
    expect(enrichedTrials[0].evalResults[0]).not.toBe(inputTrial.evalResults[0]);
    expect(enrichedTrials[0].evalResults[0].verdict).toBe('fail');
    expect(enrichedTrials[0].evalResults[0].baselineComparison).toBe('latency: 120 vs baseline 100 (threshold 10%) → fail');
    // original input untouched
    expect(inputTrial.evalResults[0].verdict).toBe('directional');
  });
});

// ── TOST path (regressionResult provided) ─────────────────────────────────────

function makeRegressionResult(
  entries: Array<{ evaluator: string; exceeded: boolean; hasStatistical?: boolean }>,
): RegressionResult {
  return {
    scenarioName: 'test-scenario',
    gate: 'pass',
    stabilityLevel: 'medium',
    evaluators: entries.map(({ evaluator, exceeded, hasStatistical = true }) => ({
      type: 'compared' as const,
      evaluator,
      currentScore: 1.0,
      baselineScore: 1.0,
      delta: 0,
      exceeded,
      statistical: hasStatistical
        ? {
            method: 'permutation-exact' as const,
            margin: 0.1,
            baselineSD: 0.05,
            k: 2,
            n: { baseline: 3, current: 3 },
            confidenceInterval: { lower: -0.05, upper: 0.05 },
            nonInferiorityProven: !exceeded,
          }
        : undefined,
    })),
  };
}

function makeTrialWithScoreAndIndex(
  evaluator: string,
  score: number,
  trialIndex: number,
  verdict: EvalResult['verdict'] = 'directional',
): TrialResult {
  return {
    trialIndex,
    transcript: {
      scenarioName: 'test-scenario',
      trialIndex,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
    },
    evalResults: [{ evaluator, score, verdict, reason: '' }],
  };
}

describe('enrichScoreModePassRates — TOST path', () => {
  const threeTrials = [
    makeTrialWithScoreAndIndex('latency', 0.5, 0),
    makeTrialWithScoreAndIndex('latency', 0.4, 1),
    makeTrialWithScoreAndIndex('latency', 0.6, 2),
  ];

  const scoreModeScenario: ScenarioResult = {
    scenarioName: 'test-scenario',
    stabilityLevel: 'medium',
    trials: threeTrials,
    aggregated: {
      latency: { comparisonMode: 'score', passingTrials: 0, totalTrials: 3, aggregateScore: 0.5 },
    },
  };

  const baseline = makeBaseline('latency', 0.5);

  it('TOST passed: estimators undefined, baselinePassingTrials=validTrials', () => {
    const rr = makeRegressionResult([{ evaluator: 'latency', exceeded: false }]);

    const { aggregated: enriched } = enrichScoreModePassRates(
      scoreModeScenario, baseline, defaultConfig, defaultReporting, rr,
    );

    // TOST path: no per-trial sample, estimators stay undefined
    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].passHatK).toBeUndefined();
    expect(enriched['latency'].baselinePassingTrials).toBe(3);
  });

  it('TOST passed: per-trial verdicts stay observed, no baselineComparison added', () => {
    const rr = makeRegressionResult([{ evaluator: 'latency', exceeded: false }]);

    const { trials: enrichedTrials } = enrichScoreModePassRates(
      scoreModeScenario, baseline, defaultConfig, defaultReporting, rr,
    );

    for (const trial of enrichedTrials) {
      const er = trial.evalResults.find((e) => e.evaluator === 'latency')!;
      expect(er.verdict).toBe('directional');
      expect(er.baselineComparison).toBeUndefined();
    }
  });

  it('TOST failed: estimators undefined, baselinePassingTrials=0', () => {
    const rr = makeRegressionResult([{ evaluator: 'latency', exceeded: true }]);

    const { aggregated: enriched } = enrichScoreModePassRates(
      scoreModeScenario, baseline, defaultConfig, defaultReporting, rr,
    );

    // TOST path: no per-trial sample, estimators stay undefined
    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].passHatK).toBeUndefined();
    expect(enriched['latency'].baselinePassingTrials).toBe(0);
  });

  it('TOST failed: per-trial verdicts stay observed, no baselineComparison added', () => {
    const rr = makeRegressionResult([{ evaluator: 'latency', exceeded: true }]);

    const { trials: enrichedTrials } = enrichScoreModePassRates(
      scoreModeScenario, baseline, defaultConfig, defaultReporting, rr,
    );

    for (const trial of enrichedTrials) {
      const er = trial.evalResults.find((e) => e.evaluator === 'latency')!;
      expect(er.verdict).toBe('directional');
      expect(er.baselineComparison).toBeUndefined();
    }
  });

  it('statistical=undefined on ComparedResult: falls through to threshold path', () => {
    // hasStatistical=false → threshold fallback should fire
    const rr = makeRegressionResult([{ evaluator: 'latency', exceeded: false, hasStatistical: false }]);
    // score=50, baseline=100, threshold=10% → passes threshold (50% drop > 10% but lowerIsBetter=false
    // so actually: baselineScore - score = 50, relative = 50%, > 10% → FAIL via threshold)
    const result = makeScenario('latency', [makeTrialWithScore('latency', 50)]);
    const bl = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, bl, defaultConfig, defaultReporting, rr);

    // threshold path would fire and produce a verdict: n=1, c=0
    expect(enriched['latency'].passAt1).toBe(0);
    expect(enriched['latency'].passAtK).toEqual([{ k: 1, value: 0 }]);
    expect(enriched['latency'].passHatK).toEqual([{ k: 1, value: 0 }]);
    expect(enriched['latency'].baselinePassingTrials).toBe(0);
  });

  it('evaluator absent from regressionResult: falls through to threshold path', () => {
    const rr = makeRegressionResult([{ evaluator: 'other-evaluator', exceeded: false }]);
    const result = makeScenario('latency', [makeTrialWithScore('latency', 50)]);
    const bl = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, bl, defaultConfig, defaultReporting, rr);

    // threshold path fires: n=1, c=0
    expect(enriched['latency'].passAt1).toBe(0);
    expect(enriched['latency'].passAtK).toEqual([{ k: 1, value: 0 }]);
    expect(enriched['latency'].passHatK).toEqual([{ k: 1, value: 0 }]);
  });

  it('skipped result in regressionResult: falls through to threshold path', () => {
    const rr: RegressionResult = {
      scenarioName: 'test-scenario',
      gate: 'pass',
      stabilityLevel: 'medium',
      evaluators: [{ type: 'skipped', evaluator: 'latency', skipReason: 'no-trial-data' }],
    };
    const result = makeScenario('latency', [makeTrialWithScore('latency', 95)]);
    const bl = makeBaseline('latency', 100);

    const { aggregated: enriched } = enrichScoreModePassRates(result, bl, defaultConfig, defaultReporting, rr);

    // threshold path fires; 95 vs 100, 5% drop <= 10% threshold → pass: n=1, c=1
    expect(enriched['latency'].passAt1).toBe(1);
    expect(enriched['latency'].passAtK).toEqual([{ k: 1, value: 1 }]);
    expect(enriched['latency'].passHatK).toEqual([{ k: 1, value: 1 }]);
  });

  it('TOST path only applies to score-mode evaluators; pass-rate evaluator is copied unchanged', () => {
    const rr = makeRegressionResult([{ evaluator: 'jtbd', exceeded: false }]);
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: [makeTrialWithScore('jtbd', 1, 'pass')],
      aggregated: {
        jtbd: { comparisonMode: 'passRate', passingTrials: 1, totalTrials: 1 },
      },
    };
    const bl: BaselineScores = {
      scenarioName: 'test-scenario',
      runId: 'run-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      scores: { jtbd: { passingTrials: 1, totalTrials: 1 } },
    };

    const { aggregated: enriched } = enrichScoreModePassRates(scenario, bl, defaultConfig, defaultReporting, rr);

    // pass-rate evaluator must not be touched by the TOST path
    expect(enriched['jtbd'].passAt1).toBeUndefined();
    expect(enriched['jtbd'].passAtK).toBeUndefined();
    expect(enriched['jtbd'].comparisonMode).toBe('passRate');
  });

  it('TOST passed with unknown trial: unknown trial excluded from baselinePassingTrials', () => {
    const trials = [
      makeTrialWithScoreAndIndex('latency', 0.5, 0, 'directional'),
      makeTrialWithScoreAndIndex('latency', 0.0, 1, 'incomplete'),
      makeTrialWithScoreAndIndex('latency', 0.6, 2, 'directional'),
    ];
    const scenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials,
      aggregated: {
        latency: { comparisonMode: 'score', passingTrials: 0, totalTrials: 3, aggregateScore: 0.5 },
      },
    };
    const rr = makeRegressionResult([{ evaluator: 'latency', exceeded: false }]);
    const bl = makeBaseline('latency', 0.5);

    const { aggregated: enriched } = enrichScoreModePassRates(scenario, bl, defaultConfig, defaultReporting, rr);

    // TOST path: 2 valid (non-unknown) trials, estimators stay undefined
    expect(enriched['latency'].passAt1).toBeUndefined();
    expect(enriched['latency'].passAtK).toBeUndefined();
    expect(enriched['latency'].baselinePassingTrials).toBe(2);
  });
});

// ── Seam: numeric estimators populated while regression gate is unchanged ──────

describe('enrichScoreModePassRates — numeric estimators do not alter the gate', () => {
  const reporting: ReportingKConfig = { reportingK: [1, 2, 3, 5, 10] };

  const threeTrials = [
    makeTrialWithScoreAndIndex('latency', 0.5, 0),
    makeTrialWithScoreAndIndex('latency', 0.4, 1),
    makeTrialWithScoreAndIndex('latency', 0.6, 2),
  ];
  const scoreModeScenario: ScenarioResult = {
    scenarioName: 'test-scenario',
    stabilityLevel: 'medium',
    trials: threeTrials,
    aggregated: {
      latency: { comparisonMode: 'score', passingTrials: 0, totalTrials: 3, aggregateScore: 0.5 },
    },
  };
  const baseline = makeBaseline('latency', 0.5);

  it('TOST path: estimators stay undefined (not a per-trial sample) but the gate is recorded', () => {
    const rr = makeRegressionResult([{ evaluator: 'latency', exceeded: false }]);
    const gateBefore = rr.gate;

    const { aggregated: enriched } = enrichScoreModePassRates(
      scoreModeScenario, baseline, defaultConfig, reporting, rr,
    );
    const latency = enriched['latency'];

    // TOST yields no per-trial sample, so estimators stay undefined.
    expect(latency.passAt1).toBeUndefined();
    expect(latency.passAtK).toBeUndefined();
    expect(latency.passHatK).toBeUndefined();
    expect(latency.baselinePassingTrials).toBe(3);
    expect(rr.gate).toBe(gateBefore);
  });

  it('threshold path: estimators are numeric from a real per-trial sample', () => {
    const allPassTrials = [
      makeTrialWithScoreAndIndex('latency', 0.5, 0),
      makeTrialWithScoreAndIndex('latency', 0.5, 1),
      makeTrialWithScoreAndIndex('latency', 0.6, 2),
    ];
    const allPassScenario: ScenarioResult = {
      scenarioName: 'test-scenario',
      stabilityLevel: 'medium',
      trials: allPassTrials,
      aggregated: {
        latency: { comparisonMode: 'score', passingTrials: 0, totalTrials: 3, aggregateScore: 0.5 },
      },
    };

    // No regressionResult → threshold fallback. All three trials clear the
    // default threshold of baseline 0.5, so c = n = 3.
    const { aggregated: enriched } = enrichScoreModePassRates(
      allPassScenario, baseline, defaultConfig, reporting,
    );
    const latency = enriched['latency'];

    expect(latency.passAt1).toBe(1);
    // n=3 clamps the reporting vector to {1, 2}.
    expect(latency.passAtK).toEqual([{ k: 1, value: 1 }, { k: 2, value: 1 }]);
    expect(latency.passHatK).toEqual([{ k: 1, value: 1 }, { k: 2, value: 1 }]);
  });
});
