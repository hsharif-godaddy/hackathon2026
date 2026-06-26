import { describe, expect, it } from 'vitest';
import { RegressionComparator } from '../regression-comparator.js';
import type { ScenarioResult, AggregatedResult, TrialResult } from
  '../../runner/types.js';
import type { BaselineScores, ComparedRegressionEvalResult } from '../types.js';
import type { Transcript } from '../../runner/transcript.js';
import type { StatisticalRegressionConfig } from '../../../config/environments/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const THRESHOLDS: StatisticalRegressionConfig = {
  alpha: 0.05,
  k: 2.0,
  minMarginFraction: 0.05,
  seed: 42,
  fallbackThresholds: {
    thresholds: {
      'output-quality': 0.15,
      'prompt-efficiency': 0.2,
    },
    defaultThreshold: 0.1,
  },
};

function makeAgg(
  passingTrials: number,
  totalTrials: number,
): AggregatedResult {
  return {
    passAtK: passingTrials > 0,
    passToTheK: passingTrials === totalTrials && totalTrials > 0,
    passingTrials,
    totalTrials,
  };
}

function makeScoreAgg(aggregateScore?: number): AggregatedResult {
  return {
    passingTrials: 0,
    totalTrials: 1,
    ...(aggregateScore !== undefined ? { aggregateScore } : {}),
    regressionMode: 'score',
  };
}

function makeScoreBaseline(
  aggregateScore?: number,
  regressionThresholds?: Record<string, number>,
): BaselineScores {
  return {
    scenarioName: 'test-scenario',
    runId: 'baseline-run',
    createdAt: '2026-04-01T00:00:00.000Z',
    scores: {
      latency: {
        passAtK: false,
        passToTheK: false,
        passingTrials: 0,
        totalTrials: 1,
        ...(aggregateScore !== undefined ? { aggregateScore } : {}),
      },
    },
    ...(regressionThresholds !== undefined
      ? { regressionThresholds }
      : {}),
  };
}

function makeResult(
  aggregated: Record<string, AggregatedResult>,
  trials: TrialResult[] = [],
): ScenarioResult {
  return {
    scenarioName: 'test-scenario',
    stabilityLevel: 'medium',
    trials,
    aggregated,
  };
}

function makeTrialResult(
  index: number,
  evaluatorName: string,
  score: number,
  verdict: 'pass' | 'fail' | 'observed' = score === 1 ? 'pass' : 'fail',
): TrialResult {
  return {
    trialIndex: index,
    transcript: {} as Transcript,
    evalResults: [{ evaluator: evaluatorName, score, verdict, reason: '' }],
  };
}

function makeBaseline(
  scores: Record<string, { passingTrials: number; totalTrials: number }>,
  stabilityLevel?: 'low' | 'medium' | 'high',
): BaselineScores {
  return {
    scenarioName: 'test-scenario',
    runId: 'baseline-run',
    createdAt: '2026-04-01T00:00:00.000Z',
    ...(stabilityLevel !== undefined ? { stabilityLevel } : {}),
    scores: Object.fromEntries(
      Object.entries(scores).map(([k, v]) => [
        k,
        {
          passAtK: v.passingTrials > 0,
          passToTheK: v.passingTrials === v.totalTrials,
          ...v,
        },
      ]),
    ),
  };
}

const comparator = new RegressionComparator();

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RegressionComparator', () => {
  describe('version mismatch handling', () => {
    it('skips evaluator comparison when evaluator versions differ', () => {
      const result = makeResult({
        latency: {
          ...makeScoreAgg(0.7),
          evalVersion: 'current-version',
        },
      });
      const baseline = makeScoreBaseline(0.9);
      baseline.scores.latency.evalVersion = 'baseline-version';

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');

      expect(e).toMatchObject({
        type: 'skipped',
        skipReason: 'evaluator-version-mismatch',
        currentEvalVersion: 'current-version',
        baselineEvalVersion: 'baseline-version',
      });
      expect(r.gate).toBe('fail');
    });

    it('skips evaluator comparison when baseline version is missing', () => {
      const result = makeResult({
        latency: {
          ...makeScoreAgg(0.7),
          evalVersion: 'current-version',
        },
      });
      const r = comparator.compare(result, makeScoreBaseline(0.9), THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');

      expect(e).toMatchObject({
        type: 'skipped',
        skipReason: 'evaluator-version-mismatch',
        currentEvalVersion: 'current-version',
      });
      expect(r.gate).toBe('fail');
    });
  });

  describe('scenario with baseline', () => {
    it('gate is pass when current scores meet baseline', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(3, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('gate is pass when current scores exceed baseline', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(3, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 2, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('gate is warning when score drops beyond default threshold', () => {
      // baseline: 3/3 = 1.0, current: 2/3 ≈ 0.667, drop ≈ 0.333 > 0.1
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
    });

    it('gate is warning when score drops beyond evaluator-specific threshold', () => {
      // output-quality threshold = 0.15; drop = 1.0 - 0.8 = 0.2 > 0.15
      const result = makeResult({
        'output-quality': makeAgg(4, 5),
      });
      const baseline = makeBaseline({ 'output-quality': { passingTrials: 5, totalTrials: 5 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
    });

    it('gate is pass when drop is within evaluator-specific threshold', () => {
      // prompt-efficiency threshold = 0.2; drop = 1.0 - 0.9 = 0.1 < 0.2
      const result = makeResult({
        'prompt-efficiency': makeAgg(9, 10),
      });
      const baseline = makeBaseline({ 'prompt-efficiency': { passingTrials: 10, totalTrials: 10 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('exceeded flag is set on the breaching evaluator', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(true);
    });

    it('delta is currentScore - baselineScore', () => {
      // current = 2/3, baseline = 3/3 = 1.0, delta ≈ -0.333
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate') as ComparedRegressionEvalResult | undefined;
      expect(e?.currentScore).toBeCloseTo(2 / 3);
      expect(e?.baselineScore).toBeCloseTo(1.0);
      expect(e?.delta).toBeCloseTo(2 / 3 - 1.0);
    });

    it('uses default threshold for evaluators not in thresholds map', () => {
      // defaultThreshold = 0.1; drop = 1.0 - 0.8 = 0.2 > 0.1
      const result = makeResult({
        'jtbd-completion': makeAgg(4, 5),
      });
      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
    });
  });

  // ── Version-skipped gate (all evaluators skipped) ─────────────────────────

  describe('version-skipped gate', () => {
    it('gate is fail when all evaluators are version-skipped', () => {
      const result = makeResult({
        latency: {
          ...makeScoreAgg(0.7),
          evalVersion: 'v2',
        },
        'output-quality': {
          ...makeAgg(2, 3),
          evalVersion: 'v2',
        },
      });
      const baseline = makeScoreBaseline(0.9);
      baseline.scores.latency.evalVersion = 'v1';
      baseline.scores['output-quality'] = {
        passAtK: true,
        passToTheK: true,
        passingTrials: 3,
        totalTrials: 3,
        evalVersion: 'v1',
      };

      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('fail');
      expect(r.evaluators.every((e) => e.type === 'skipped')).toBe(true);
    });

    it('gate is pass when at least one evaluator is not version-skipped', () => {
      const result = makeResult({
        latency: {
          ...makeScoreAgg(0.7),
          evalVersion: 'v2',
        },
        'bug-hit-rate': makeAgg(3, 3),
      });
      const baseline = makeScoreBaseline(0.9);
      baseline.scores.latency.evalVersion = 'v1';
      baseline.scores['bug-hit-rate'] = {
        passAtK: true,
        passToTheK: true,
        passingTrials: 3,
        totalTrials: 3,
      };

      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });
  });

  // ── Threshold edge cases (task 3) ──────────────────────────────────────────

  describe('threshold edge cases', () => {
    it('exact boundary: drop === threshold → pass (not fail)', () => {
      // threshold = 0.1; baseline = 1.0 (3/3), current = 0.9 (9/10)
      // drop = 0.1 exactly; should NOT exceed
      const result = makeResult({
        'bug-hit-rate': makeAgg(9, 10),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 10, totalTrials: 10 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(false);
    });

    it('drop just above threshold → warning', () => {
      // threshold = 0.1; baseline = 10/10 = 1.0, current = 8/10 = 0.8, drop = 0.2 > 0.1
      const result = makeResult({
        'bug-hit-rate': makeAgg(8, 10),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 10, totalTrials: 10 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(true);
    });

    it('current totalTrials === 0 → skipped with no-trial-data', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(0, 0),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.type).toBe('skipped');
      expect(e && 'skipReason' in e && e.skipReason).toBe('no-trial-data');
    });

    it('baseline totalTrials === 0 → NaN baseline score, exceeded = false', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(3, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 0, totalTrials: 0 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });

    it('new evaluator not in baseline → exceeded = false', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(3, 3),
        'new-eval': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'new-eval') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });

    it('unknown verdicts count as failures: totalTrials includes all verdicts', () => {
      // TrialAggregator counts unknowns toward totalTrials as failures.
      // Comparator sees totalTrials = 3 (1 unknown counted), passingTrials = 2.
      // Score = 2/3 — same as baseline, delta = 0 — no regression.
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({
        'bug-hit-rate': { passingTrials: 2, totalTrials: 3 },
      });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('gate passes when only non-breaching evaluators exist', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(3, 3),
        'prompt-efficiency': makeAgg(9, 10),
      });
      const baseline = makeBaseline({
        'bug-hit-rate': { passingTrials: 3, totalTrials: 3 },
        'prompt-efficiency': { passingTrials: 10, totalTrials: 10 },
      });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('gate is warning when one of multiple evaluators breaches', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(3, 3),         // fine
        'prompt-efficiency': makeAgg(6, 10),    // drop 0.4 > 0.2
      });
      const baseline = makeBaseline({
        'bug-hit-rate': { passingTrials: 3, totalTrials: 3 },
        'prompt-efficiency': { passingTrials: 10, totalTrials: 10 },
      });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
    });
  });

  // ── Stability-level gate severity ──────────────────────────────────────────

  describe('stability-level gate severity', () => {
    it('low stability + exceeded threshold → warning', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'low',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
      expect(r.stabilityLevel).toBe('low');
    });

    it('medium stability + exceeded threshold → warning', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'medium',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
      expect(r.stabilityLevel).toBe('medium');
    });

    it('high stability + exceeded threshold → warning', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'high',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
      expect(r.stabilityLevel).toBe('high');
    });

    it('legacy baseline (no stabilityLevel) + exceeded → warning', () => {
      const result = makeResult({
        'bug-hit-rate': makeAgg(2, 3),
      });
      // no stabilityLevel on baseline → defaults to 'medium' → 'warning'
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
      expect(r.stabilityLevel).toBe('medium');
    });

    it('stabilityLevel on result reflects baseline level for passing gate',
      () => {
        const result = makeResult({
          'bug-hit-rate': makeAgg(3, 3),
        });
        const baseline = makeBaseline(
          { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
          'high',
        );
        const r = comparator.compare(result, baseline, THRESHOLDS);
        expect(r.gate).toBe('pass');
        expect(r.stabilityLevel).toBe('high');
      },
    );
  });

  // ── Score-mode evaluator ───────────────────────────────────────────────────

  describe('score-mode evaluator', () => {
    it('flags regression when relative score drop exceeds threshold', () => {
      // baseline=0.8, current=0.56, drop=(0.8-0.56)/0.8=0.3 > 0.15 default
      const result = makeResult({
        latency: makeScoreAgg(0.56),
      });
      const baseline = makeScoreBaseline(0.8);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(true);
      expect(r.gate).toBe('warning');
    });

    it('passes when relative score drop is within threshold', () => {
      // baseline=0.8, current=0.75, drop=(0.8-0.75)/0.8=0.0625 < 0.15
      const result = makeResult({
        latency: makeScoreAgg(0.75),
      });
      const baseline = makeScoreBaseline(0.8);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(false);
      expect(r.gate).toBe('pass');
    });

    it('absent baseline aggregateScore -> exceeded = false', () => {
      // baseline scores entry exists but aggregateScore is absent
      const result = makeResult({
        latency: makeScoreAgg(0.5),
      });
      const baseline = makeScoreBaseline();
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });

    it('absent current aggregateScore → skipped with no-score-data', () => {
      const result = makeResult({
        latency: makeScoreAgg(),
      });
      const baseline = makeScoreBaseline(8.0);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.type).toBe('skipped');
      expect(e && 'skipReason' in e && e.skipReason).toBe('no-score-data');
    });

    it('baseline threshold overrides config threshold', () => {
      // drop=(0.8-0.65)/0.8=0.1875; config default=0.1 → would flag
      // baseline regressionThresholds.latency=0.25 → should pass
      const result = makeResult({
        latency: makeScoreAgg(0.65),
      });
      const baseline = makeScoreBaseline(0.8, { latency: 0.25 });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(false);
      expect(r.gate).toBe('pass');
    });

    it('baseline aggregateScore = 0 → exceeded = false (no division by zero)',
      () => {
        const result = makeResult({
          latency: makeScoreAgg(0),
        });
        const baseline = makeScoreBaseline(0);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
        expect(e?.exceeded).toBe(false);
      },
    );

    it('currentScore and baselineScore reflect aggregate scores', () => {
      const result = makeResult({
        latency: makeScoreAgg(0.56),
      });
      const baseline = makeScoreBaseline(0.8);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
      expect(e?.currentScore).toBeCloseTo(0.56);
      expect(e?.baselineScore).toBeCloseTo(0.8);
      expect(e?.delta).toBeCloseTo(0.56 - 0.8);
    });

    describe('lowerIsBetter evaluator', () => {
      it('flags regression when score increases past threshold', () => {
        // baseline=7000, current=8500, increase=(8500-7000)/7000≈0.214 > 0.1
        const result = makeResult({
          latency: { ...makeScoreAgg(8500), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(7000);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
        expect(e?.exceeded).toBe(true);
        expect(r.gate).toBe('warning');
      });

      it('does not flag regression when score decreases (improvement)', () => {
        // baseline=7000, current=5500, decrease — lower is better, this is good
        const result = makeResult({
          latency: { ...makeScoreAgg(5500), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(7000);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
        expect(e?.exceeded).toBe(false);
        expect(r.gate).toBe('pass');
      });

      it('does not flag regression when score increase is within threshold', () => {
        // baseline=7000, current=7500, increase=(7500-7000)/7000≈0.071 < 0.1
        const result = makeResult({
          latency: { ...makeScoreAgg(7500), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(7000);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
        expect(e?.exceeded).toBe(false);
      });

      it('baseline 0 with lowerIsBetter, currentScore > 0 → exceeded = true (regression from perfect baseline)', () => {
        const result = makeResult({
          latency: { ...makeScoreAgg(100), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(0);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
        expect(e?.exceeded).toBe(true);
      });

      it('baseline 0 with lowerIsBetter, currentScore also 0 → exceeded = false (no regression from perfect baseline)', () => {
        const result = makeResult({
          latency: { ...makeScoreAgg(0), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(0);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;
        expect(e?.exceeded).toBe(false);
      });
    });

    describe('stability-level gate severity', () => {
      // baseline=0.8, current=0.5: drop=(0.8-0.5)/0.8=0.375 > 0.1 default
      it('low stability + score drop → warning', () => {
        const result = makeResult({
          latency: makeScoreAgg(0.5),
        });
        const baseline = {
          ...makeScoreBaseline(0.8),
          stabilityLevel: 'low' as const,
        };
        const r = comparator.compare(result, baseline, THRESHOLDS);
        expect(r.gate).toBe('warning');
        expect(r.stabilityLevel).toBe('low');
      });

      it('medium stability + score drop → warning', () => {
        const result = makeResult({
          latency: makeScoreAgg(0.5),
        });
        const baseline = {
          ...makeScoreBaseline(0.8),
          stabilityLevel: 'medium' as const,
        };
        const r = comparator.compare(result, baseline, THRESHOLDS);
        expect(r.gate).toBe('warning');
        expect(r.stabilityLevel).toBe('medium');
      });

      it('high stability + score drop → warning', () => {
        const result = makeResult({
          latency: makeScoreAgg(0.5),
        });
        const baseline = {
          ...makeScoreBaseline(0.8),
          stabilityLevel: 'high' as const,
        };
        const r = comparator.compare(result, baseline, THRESHOLDS);
        expect(r.gate).toBe('warning');
        expect(r.stabilityLevel).toBe('high');
      });

      it('score drop within threshold → pass regardless of stability', () => {
        // drop=(0.8-0.75)/0.8=0.0625 < 0.1 default
        const result = makeResult({
          latency: makeScoreAgg(0.75),
        });
        const baseline = {
          ...makeScoreBaseline(0.8),
          stabilityLevel: 'high' as const,
        };
        const r = comparator.compare(result, baseline, THRESHOLDS);
        expect(r.gate).toBe('pass');
      });
    });
  });

  // ── Statistical path (Task 1: integration seam tests) ─────────────────────

  describe('statistical path (baseline has trialScores)', () => {
    it('produces statistical metadata on compared result for pass-rate evaluator', () => {
      // baseline: 7/10 passing, SD ≈ 0.458, margin ≈ 0.916 (wide)
      const baselineTrialScores = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
      const trials = [0, 1, 2, 3, 4].map((i) =>
        makeTrialResult(i, 'jtbd-completion', 1, 'pass'),
      );
      const result = makeResult({ 'jtbd-completion': makeAgg(5, 5) }, trials);

      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 7, totalTrials: 10 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;

      expect(e?.statistical).toBeDefined();
      expect(e?.statistical?.method).toBe('wilson-score');
      expect(e?.statistical?.n).toEqual({ baseline: 10, current: 5 });
      expect(typeof e?.statistical?.margin).toBe('number');
      expect(e?.statistical?.margin).toBeGreaterThan(0);
      expect(typeof e?.statistical?.baselineSD).toBe('number');
      expect(typeof e?.statistical?.nonInferiorityProven).toBe('boolean');
      expect(e?.statistical?.confidenceInterval).toHaveProperty('lower');
      expect(e?.statistical?.confidenceInterval).toHaveProperty('upper');
    });

    it('produces statistical metadata on compared result for score-mode evaluator', () => {
      const baselineTrialScores = [0.85, 0.80, 0.88, 0.82, 0.84];
      const currentScores = [0.82, 0.84, 0.83, 0.85, 0.81];
      const trials = currentScores.map((s, i) =>
        makeTrialResult(i, 'latency', s, 'observed'),
      );
      const result = makeResult(
        { latency: { ...makeScoreAgg(0.83), regressionMode: 'score' } },
        trials,
      );
      const baseline = makeScoreBaseline(0.838);
      baseline.scores.latency.trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency') as ComparedRegressionEvalResult | undefined;

      expect(e?.statistical).toBeDefined();
      expect(['permutation-exact', 'permutation-mc']).toContain(e?.statistical?.method);
      expect(e?.statistical?.n).toEqual({ baseline: 5, current: 5 });
      expect(e?.statistical?.k).toBe(2.0);
    });

    it('falls back when baseline lacks trialScores — no statistical field', () => {
      const result = makeResult({ 'jtbd-completion': makeAgg(3, 3) });
      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 3, totalTrials: 3 } });
      // no trialScores on baseline

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;

      expect(e?.statistical).toBeUndefined();
      expect(r.gate).toBe('pass');
    });

    it('uses statistical path for evaluators with trialScores and fallback for those without', () => {
      // 'scored-eval' has trialScores; 'legacy-eval' does not
      const baselineTrialScores = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
      const trials = [0, 1, 2].map((i) => ({
        trialIndex: i,
        transcript: {} as Transcript,
        evalResults: [
          { evaluator: 'scored-eval', score: 1, verdict: 'pass' as const, reason: '' },
          { evaluator: 'legacy-eval', score: 1, verdict: 'pass' as const, reason: '' },
        ],
      }));
      const result = makeResult(
        {
          'scored-eval': makeAgg(3, 3),
          'legacy-eval': makeAgg(3, 3),
        },
        trials,
      );

      const baseline = makeBaseline({
        'scored-eval': { passingTrials: 7, totalTrials: 10 },
        'legacy-eval': { passingTrials: 3, totalTrials: 3 },
      });
      baseline.scores['scored-eval'].trialScores = baselineTrialScores;
      // legacy-eval has no trialScores

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const scoredE = r.evaluators.find((x) => x.evaluator === 'scored-eval') as ComparedRegressionEvalResult | undefined;
      const legacyE = r.evaluators.find((x) => x.evaluator === 'legacy-eval') as ComparedRegressionEvalResult | undefined;

      expect(scoredE?.statistical).toBeDefined();
      expect(legacyE?.statistical).toBeUndefined();
    });

    it('gate is pass when TOST proves non-inferiority (current = 100%, high-variance baseline)', () => {
      // baseline: 7/10, SD ≈ 0.458, margin ≈ 0.916 (wider than any possible drop)
      const baselineTrialScores = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
      const trials = [0, 1, 2, 3, 4].map((i) =>
        makeTrialResult(i, 'jtbd-completion', 1, 'pass'),
      );
      const result = makeResult({ 'jtbd-completion': makeAgg(5, 5) }, trials);

      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 7, totalTrials: 10 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(false);
      expect(e?.statistical?.nonInferiorityProven).toBe(true);
    });

    it('gate is fail when TOST detects clear regression (0/5 vs baseline 5/5)', () => {
      // baseline all-pass (SD=0, margin=0) → any difference fails TOST
      const baselineTrialScores = [1, 1, 1, 1, 1];
      const trials = [0, 1, 2, 3, 4].map((i) =>
        makeTrialResult(i, 'jtbd-completion', 0, 'fail'),
      );
      const result = makeResult({ 'jtbd-completion': makeAgg(0, 5) }, trials);

      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('fail');
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(true);
      expect(e?.statistical?.nonInferiorityProven).toBe(false);
    });

    it('gate is fail when all evaluators are version-skipped', () => {
      const result = makeResult({
        latency: { ...makeScoreAgg(0.7), evalVersion: 'v2' },
      });
      const baseline = makeScoreBaseline(0.9);
      baseline.scores.latency.evalVersion = 'v1';
      baseline.scores.latency.trialScores = [0.9, 0.9, 0.9, 0.9, 0.9];

      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('fail');
      expect(r.evaluators.every((e) => e.type === 'skipped')).toBe(true);
    });

    it('gate is fail when TOST-failing evaluator coexists with fallback-warning evaluator', () => {
      // 'tost-eval' has trialScores and regresses → TOST fail (statistical)
      // 'legacy-eval' has no trialScores and regresses → threshold breach (no statistical)
      // Gate must be 'fail' (TOST evidence dominates), not 'warning'.
      const baselineTrialScores = [1, 1, 1, 1, 1];
      const trials = [0, 1, 2, 3, 4].map((i) => ({
        trialIndex: i,
        transcript: {} as Transcript,
        evalResults: [
          { evaluator: 'tost-eval', score: 0, verdict: 'fail' as const, reason: '' },
          { evaluator: 'legacy-eval', score: 0, verdict: 'fail' as const, reason: '' },
        ],
      }));
      const result = makeResult(
        {
          'tost-eval': makeAgg(0, 5),
          'legacy-eval': makeAgg(0, 5),
        },
        trials,
      );

      const baseline = makeBaseline({
        'tost-eval': { passingTrials: 5, totalTrials: 5 },
        'legacy-eval': { passingTrials: 5, totalTrials: 5 },
      });
      baseline.scores['tost-eval'].trialScores = baselineTrialScores;
      // legacy-eval has no trialScores → fallback threshold path

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const tostE = r.evaluators.find((x) => x.evaluator === 'tost-eval') as ComparedRegressionEvalResult | undefined;
      const legacyE = r.evaluators.find((x) => x.evaluator === 'legacy-eval') as ComparedRegressionEvalResult | undefined;

      expect(tostE?.exceeded).toBe(true);
      expect(tostE?.statistical).toBeDefined();
      expect(legacyE?.exceeded).toBe(true);
      expect(legacyE?.statistical).toBeUndefined();
      // Key assertion: TOST fail dominates over fallback warning
      expect(r.gate).toBe('fail');
    });
  });

  // ── Error paths with statistical config (Task 2) ────────────────────────────

  describe('statistical error paths', () => {
    it('falls back to threshold when baseline trialScores is empty array', () => {
      const trials = [0, 1, 2].map((i) =>
        makeTrialResult(i, 'jtbd-completion', 1, 'pass'),
      );
      const result = makeResult({ 'jtbd-completion': makeAgg(3, 3) }, trials);
      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 3, totalTrials: 3 } });
      baseline.scores['jtbd-completion'].trialScores = []; // empty → fallback

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      expect(e?.statistical).toBeUndefined();
      expect(r.gate).toBe('pass');
    });

    it('gate is warning (not fail) when fallback threshold is exceeded', () => {
      // No trialScores → fallback path. Threshold breach → warning.
      const result = makeResult({ 'bug-hit-rate': makeAgg(2, 3) });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      // No trialScores on baseline

      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate') as ComparedRegressionEvalResult | undefined;
      expect(e?.exceeded).toBe(true);
      expect(e?.statistical).toBeUndefined();
    });

    it('falls back to threshold when current run has no extractable trial scores', () => {
      // trials is empty → extractCurrentTrialScores returns [] → fallback
      const baselineTrialScores = [1, 1, 1, 1, 1];
      const result = makeResult({ 'jtbd-completion': makeAgg(3, 3) }); // trials=[]
      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      expect(e?.statistical).toBeUndefined();
      expect(r.gate).toBe('pass');
    });

    it('excludes evaluatorFailed trials from current trial scores', () => {
      // 2 valid trials, 1 evaluatorFailed → only 2 scores extracted
      const baselineTrialScores = [1, 1, 1, 1, 1];
      const trials: TrialResult[] = [
        makeTrialResult(0, 'jtbd-completion', 1, 'pass'),
        {
          trialIndex: 1,
          transcript: {} as Transcript,
          evalResults: [{
            evaluator: 'jtbd-completion', score: 0, verdict: 'fail', reason: '',
            evaluatorFailed: true,
          }],
        },
        makeTrialResult(2, 'jtbd-completion', 1, 'pass'),
      ];
      const result = makeResult({ 'jtbd-completion': makeAgg(2, 3) }, trials);
      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      // TOST should run (2 valid scores extracted)
      expect(e?.statistical).toBeDefined();
      expect(e?.statistical?.n.current).toBe(2);
    });

    it('excludes unknown-verdict trials from current trial scores', () => {
      const baselineTrialScores = [1, 1, 1, 1, 1];
      const trials: TrialResult[] = [
        makeTrialResult(0, 'jtbd-completion', 1, 'pass'),
        {
          trialIndex: 1,
          transcript: {} as Transcript,
          evalResults: [{
            evaluator: 'jtbd-completion', score: 0.5, verdict: 'unknown' as const, reason: '',
          }],
        },
        makeTrialResult(2, 'jtbd-completion', 1, 'pass'),
      ];
      const result = makeResult({ 'jtbd-completion': makeAgg(2, 3) }, trials);
      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      expect(e?.statistical?.n.current).toBe(2); // unknown excluded
    });
  });

  // ── minMargin floor behavior ──────────────────────────────────────────────

  describe('minMargin floor behavior', () => {
    it('marginFloored: true propagates into StatisticalMetadata for zero-variance baseline', () => {
      // Use non-binary scores (0.5) so isBinaryScores = false → tostPermutation is used.
      // tostProportions (Wilson CI) cannot prove non-inferiority for p=1.0, n=5 against a 0.05
      // margin because the Wilson CI lower bound (~-0.74) falls well below -margin.
      // With tostPermutation, identical distributions prove non-inferiority trivially.
      // SD=0 so k*SD=0; relative floor = frac(0.05) * mean(0.5) = 0.025 lifts the
      // margin → marginFloored=true.
      const baselineTrialScores = [0.5, 0.5, 0.5, 0.5, 0.5];
      const trials = [0, 1, 2, 3, 4].map((i) =>
        makeTrialResult(i, 'jtbd-completion', 0.5, 'pass'),
      );
      const result = makeResult({ 'jtbd-completion': makeAgg(5, 5) }, trials);

      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;

      expect(r.gate).toBe('pass');
      expect(e?.statistical?.marginFloored).toBe(true);
      expect(e?.statistical?.margin).toBeCloseTo(0.025, 10);
    });

    it('floor flips a verdict from fail to pass with wide minMargin', () => {
      const WIDE_FLOOR_CONFIG: StatisticalRegressionConfig = {
        ...THRESHOLDS,
        minMarginFraction: 0.5,
      };
      const NO_FLOOR_CONFIG: StatisticalRegressionConfig = {
        ...THRESHOLDS,
        minMarginFraction: 0,
      };

      // Non-binary baseline (0.5s, SD=0). Current: 0.4s (mean drop = 0.1).
      // isBinaryScores = false → tostPermutation used (not tostProportions).
      // Without floor: margin=0, uniform-match fires → 0.4 ≠ 0.5 → exceeded.
      // With wide floor (0.5): margin=0.5 >> drop=0.1 → tostPermutation proves non-inferiority.
      const baselineTrialScores = [0.5, 0.5, 0.5, 0.5, 0.5];
      const trials = [0, 1, 2, 3, 4].map((i) =>
        makeTrialResult(i, 'jtbd-completion', 0.4, 'fail'),
      );
      const result = makeResult({ 'jtbd-completion': makeAgg(0, 5) }, trials);

      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      baseline.scores['jtbd-completion'].trialScores = baselineTrialScores;

      // Without floor (minMargin=0): SD=0 → uniform-match branch fires, 0.4 ≠ 0.5 → exceeded
      const rNoFloor = comparator.compare(result, baseline, NO_FLOOR_CONFIG);
      const eNoFloor = rNoFloor.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      expect(eNoFloor?.exceeded).toBe(true);

      // With wide floor (minMargin=0.5): margin floored to 0.5, drop=0.1 within margin → passes
      const rFloor = comparator.compare(result, baseline, WIDE_FLOOR_CONFIG);
      const eFloor = rFloor.evaluators.find((x) => x.evaluator === 'jtbd-completion') as ComparedRegressionEvalResult | undefined;
      expect(eFloor?.exceeded).toBe(false);
      expect(eFloor?.statistical?.marginFloored).toBe(true);
    });
  });

  // ── Relative-floor comparator integration (Phase 4) ───────────────────────
  //
  // These verify the relative floor end-to-end through compare(), on the
  // lowerIsBetter score-mode path (the post-#5369 raw-measurement evaluators:
  // total-time-taken, agent-steps, prompt-efficiency). They assert behavior
  // confirmed against the live permutation TOST, NOT a naive mean-delta: the
  // permutation CI upper bound is roughly twice the observed mean difference,
  // so the effective flag boundary sits well below frac·mean.

  describe('relative-floor comparator integration', () => {
    function makeScoreModeTrials(name: string, scores: number[]): TrialResult[] {
      return scores.map((s, i) => makeTrialResult(i, name, s, 'observed'));
    }

    function makeLowerIsBetterResult(name: string, currentScores: number[]): ScenarioResult {
      const mean = currentScores.reduce((sum, s) => sum + s, 0) / currentScores.length;
      return makeResult(
        { [name]: { ...makeScoreAgg(mean), lowerIsBetter: true } },
        makeScoreModeTrials(name, currentScores),
      );
    }

    function makeScoreModeBaseline(name: string, trialScores: number[]): BaselineScores {
      const mean = trialScores.reduce((sum, s) => sum + s, 0) / trialScores.length;
      return {
        scenarioName: 'test-scenario',
        runId: 'baseline-run',
        createdAt: '2026-04-01T00:00:00.000Z',
        scores: {
          [name]: {
            passAtK: false,
            passToTheK: false,
            passingTrials: 0,
            totalTrials: trialScores.length,
            aggregateScore: mean,
            trialScores,
          },
        },
      };
    }

    it('(seam — #5369) low-variance baseline: floor passes a small drift the dead floor flagged', () => {
      // total-time-taken style: baseline ≈300s, SD≈0.5 (k·SD=1). Current ≈306s
      // (≈2% slower) — exactly the sub-5% jitter the relative floor must absorb
      // and the absolute-0.05 floor (now dead) silently flagged.
      const baselineTrialScores = [299.5, 300.5, 299.5, 300.5, 299.5, 300.5];
      const currentScores = [305.5, 306.5, 305.5, 306.5, 305.5, 306.5];
      const result = makeLowerIsBetterResult('total-time-taken', currentScores);
      const baseline = makeScoreModeBaseline('total-time-taken', baselineTrialScores);

      // Floor ON (frac=0.05): margin = max(k·SD=1, 0.05·300=15) = 15 → drift within tolerance.
      const rFloor = comparator.compare(result, baseline, THRESHOLDS);
      const eFloor = rFloor.evaluators.find((x) => x.evaluator === 'total-time-taken') as ComparedRegressionEvalResult | undefined;
      expect(rFloor.gate).toBe('pass');
      expect(eFloor?.exceeded).toBe(false);
      expect(eFloor?.statistical?.margin).toBeCloseTo(15, 10);
      expect(eFloor?.statistical?.marginFloored).toBe(true);

      // Floor OFF (frac=0): margin collapses to k·SD=1 — the dead-floor bug — and
      // the same 2% jitter is flagged as a regression.
      const noFloorConfig: StatisticalRegressionConfig = { ...THRESHOLDS, minMarginFraction: 0 };
      const rNoFloor = comparator.compare(result, baseline, noFloorConfig);
      const eNoFloor = rNoFloor.evaluators.find((x) => x.evaluator === 'total-time-taken') as ComparedRegressionEvalResult | undefined;
      expect(eNoFloor?.exceeded).toBe(true);
      expect(eNoFloor?.statistical?.margin).toBeCloseTo(1, 10);
    });

    it('(seam — #5369) low-variance baseline: genuine ~7% degradation still flags with floor on', () => {
      // Same baseline, current ≈321s (≈7% slower) — beyond the 5% floor, so the
      // permutation CI lower bound clears the margin and the gate fails.
      const baselineTrialScores = [299.5, 300.5, 299.5, 300.5, 299.5, 300.5];
      const currentScores = [320.5, 321.5, 320.5, 321.5, 320.5, 321.5];
      const result = makeLowerIsBetterResult('total-time-taken', currentScores);
      const baseline = makeScoreModeBaseline('total-time-taken', baselineTrialScores);

      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'total-time-taken') as ComparedRegressionEvalResult | undefined;
      expect(r.gate).toBe('fail');
      expect(e?.exceeded).toBe(true);
      expect(e?.statistical?.margin).toBeCloseTo(15, 10);
    });

    it('(error path — new prod path) constant-zero baseline routes to uniform-match', () => {
      // mean=0 AND SD=0 → margin=0 → strict uniform-match (a live prod path now
      // that the floor is relative; the absolute 0.05 floor never reached it).
      const baselineTrialScores = [0, 0, 0, 0, 0];
      const baseline = makeScoreModeBaseline('agent-steps', baselineTrialScores);

      // All-zero current matches the constant exactly → passes.
      const allZero = comparator.compare(
        makeLowerIsBetterResult('agent-steps', [0, 0, 0, 0, 0]),
        baseline,
        THRESHOLDS,
      );
      const eZero = allZero.evaluators.find((x) => x.evaluator === 'agent-steps') as ComparedRegressionEvalResult | undefined;
      expect(allZero.gate).toBe('pass');
      expect(eZero?.exceeded).toBe(false);
      expect(eZero?.statistical?.method).toBe('uniform-match');
      expect(eZero?.statistical?.margin).toBe(0);

      // A single positive trial breaks the uniform match → flags.
      const positive = comparator.compare(
        makeLowerIsBetterResult('agent-steps', [0, 0, 1, 0, 0]),
        baseline,
        THRESHOLDS,
      );
      const ePositive = positive.evaluators.find((x) => x.evaluator === 'agent-steps') as ComparedRegressionEvalResult | undefined;
      expect(positive.gate).toBe('fail');
      expect(ePositive?.exceeded).toBe(true);
      expect(ePositive?.statistical?.method).toBe('uniform-match');
    });

    it('(edge — policy boundary) zero-variance integer baseline tolerates no upward deviation', () => {
      // Baseline [4,4,4,4,4]: SD=0 so k·SD=0; floor = 0.05·4 = 0.2, below integer
      // granularity. The relative floor cannot supply real tolerance here, so the
      // gate flags any upward step — the irreducible policy guess for a
      // zero-variance small-integer baseline (no noise estimate available).
      const baselineTrialScores = [4, 4, 4, 4, 4];
      const baseline = makeScoreModeBaseline('agent-steps', baselineTrialScores);

      const allFour = comparator.compare(
        makeLowerIsBetterResult('agent-steps', [4, 4, 4, 4, 4]),
        baseline,
        THRESHOLDS,
      );
      const eAllFour = allFour.evaluators.find((x) => x.evaluator === 'agent-steps') as ComparedRegressionEvalResult | undefined;
      expect(allFour.gate).toBe('pass');
      expect(eAllFour?.exceeded).toBe(false);
      expect(eAllFour?.statistical?.margin).toBeCloseTo(0.2, 10);
      expect(eAllFour?.statistical?.marginFloored).toBe(true);

      const oneFive = comparator.compare(
        makeLowerIsBetterResult('agent-steps', [4, 4, 4, 4, 5]),
        baseline,
        THRESHOLDS,
      );
      const eOneFive = oneFive.evaluators.find((x) => x.evaluator === 'agent-steps') as ComparedRegressionEvalResult | undefined;
      expect(oneFive.gate).toBe('fail');
      expect(eOneFive?.exceeded).toBe(true);

      const twoFives = comparator.compare(
        makeLowerIsBetterResult('agent-steps', [4, 4, 4, 5, 5]),
        baseline,
        THRESHOLDS,
      );
      const eTwoFives = twoFives.evaluators.find((x) => x.evaluator === 'agent-steps') as ComparedRegressionEvalResult | undefined;
      expect(twoFives.gate).toBe('fail');
      expect(eTwoFives?.exceeded).toBe(true);
    });
  });
});
