import { describe, it, expect } from 'vitest';
import { RegressionComparator } from '../regression-comparator.js';
import type { ScenarioResult, AggregatedResult } from
  '../../runner/types.js';
import type { BaselineScores } from '../types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  thresholds: {
    'output-quality': 0.15,
    'prompt-efficiency': 0.2,
  },
  defaultThreshold: 0.1,
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

function makeScoreAgg(medianScore?: number): AggregatedResult {
  return {
    passingTrials: 0,
    totalTrials: 1,
    ...(medianScore !== undefined ? { medianScore } : {}),
    regressionMode: 'score',
  };
}

function makeScoreBaseline(
  medianScore?: number,
  regressionThresholds?: Record<string, number>,
): BaselineScores {
  return {
    scenarioName: 'test-scenario',
    runId: 'baseline-run',
    createdAt: '2026-04-01T00:00:00.000Z',
    category: 'regression',
    scores: {
      latency: {
        passAtK: false,
        passToTheK: false,
        passingTrials: 0,
        totalTrials: 1,
        ...(medianScore !== undefined ? { medianScore } : {}),
      },
    },
    ...(regressionThresholds !== undefined
      ? { regressionThresholds }
      : {}),
  };
}

function makeResult(
  category: 'regression' | 'capability',
  aggregated: Record<string, AggregatedResult>,
): ScenarioResult {
  return {
    scenarioName: 'test-scenario',
    category,
    stabilityLevel: 'medium',
    trials: [],
    aggregated,
  };
}

function makeBaseline(
  scores: Record<string, { passingTrials: number; totalTrials: number }>,
  category: 'regression' | 'capability' = 'regression',
  stabilityLevel?: 'low' | 'medium' | 'high',
): BaselineScores {
  return {
    scenarioName: 'test-scenario',
    runId: 'baseline-run',
    createdAt: '2026-04-01T00:00:00.000Z',
    category,
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
  describe('no baseline (first run)', () => {
    it('gate is missing-baseline for regression-category scenario', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(3, 3),
      });
      const r = comparator.compare(result, null, THRESHOLDS);
      expect(r.gate).toBe('missing-baseline');
      expect(r.hasBaseline).toBe(false);
    });

    it('gate is informational for capability-category scenario', () => {
      const result = makeResult('capability', {
        'bug-hit-rate': makeAgg(3, 3),
      });
      const r = comparator.compare(result, null, THRESHOLDS);
      expect(r.gate).toBe('informational');
      expect(r.hasBaseline).toBe(false);
    });

    it('evaluators have NaN baselineScore and exceeded = false', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(3, 3),
      });
      const r = comparator.compare(result, null, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });

    it('score-mode evaluator with null baseline → gate is missing-baseline', () => {
      const result = makeResult('regression', {
        latency: makeScoreAgg(0.7),
      });
      const r = comparator.compare(result, null, THRESHOLDS);
      expect(r.gate).toBe('missing-baseline');
      expect(r.hasBaseline).toBe(false);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });
  });

  describe('regression-category with baseline', () => {
    it('gate is pass when current scores meet baseline', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(3, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
      expect(r.hasBaseline).toBe(true);
    });

    it('gate is pass when current scores exceed baseline', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(3, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 2, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('gate is error when score drops beyond default threshold', () => {
      // baseline: 3/3 = 1.0, current: 2/3 ≈ 0.667, drop ≈ 0.333 > 0.1
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('error');
    });

    it('gate is error when score drops beyond evaluator-specific threshold', () => {
      // output-quality threshold = 0.15; drop = 1.0 - 0.8 = 0.2 > 0.15
      const result = makeResult('regression', {
        'output-quality': makeAgg(4, 5),
      });
      const baseline = makeBaseline({ 'output-quality': { passingTrials: 5, totalTrials: 5 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('error');
    });

    it('gate is pass when drop is within evaluator-specific threshold', () => {
      // prompt-efficiency threshold = 0.2; drop = 1.0 - 0.9 = 0.1 < 0.2
      const result = makeResult('regression', {
        'prompt-efficiency': makeAgg(9, 10),
      });
      const baseline = makeBaseline({ 'prompt-efficiency': { passingTrials: 10, totalTrials: 10 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('exceeded flag is set on the breaching evaluator', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.exceeded).toBe(true);
    });

    it('delta is currentScore - baselineScore', () => {
      // current = 2/3, baseline = 3/3 = 1.0, delta ≈ -0.333
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.currentScore).toBeCloseTo(2 / 3);
      expect(e?.baselineScore).toBeCloseTo(1.0);
      expect(e?.delta).toBeCloseTo(2 / 3 - 1.0);
    });

    it('uses default threshold for evaluators not in thresholds map', () => {
      // defaultThreshold = 0.1; drop = 1.0 - 0.8 = 0.2 > 0.1
      const result = makeResult('regression', {
        'jtbd-completion': makeAgg(4, 5),
      });
      const baseline = makeBaseline({ 'jtbd-completion': { passingTrials: 5, totalTrials: 5 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('error');
    });
  });

  describe('capability-category scenarios', () => {
    it('gate is always informational even when score drops', () => {
      const result = makeResult('capability', {
        'bug-hit-rate': makeAgg(0, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'capability',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('informational');
    });

    it('still computes delta and exceeded for informational diffs', () => {
      const result = makeResult('capability', {
        'bug-hit-rate': makeAgg(0, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'capability',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.exceeded).toBe(true);
      expect(e?.delta).toBeCloseTo(-1.0);
    });
  });

  // ── Threshold edge cases (task 3) ──────────────────────────────────────────

  describe('threshold edge cases', () => {
    it('exact boundary: drop === threshold → pass (not fail)', () => {
      // threshold = 0.1; baseline = 1.0 (3/3), current = 0.9 (9/10)
      // drop = 0.1 exactly; should NOT exceed
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(9, 10),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 10, totalTrials: 10 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.exceeded).toBe(false);
    });

    it('drop just above threshold → error', () => {
      // threshold = 0.1; baseline = 10/10 = 1.0, current = 8/10 = 0.8, drop = 0.2 > 0.1
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(8, 10),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 10, totalTrials: 10 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('error');
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.exceeded).toBe(true);
    });

    it('current totalTrials === 0 → NaN score, exceeded = false', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(0, 0),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.currentScore)).toBe(true);
    });

    it('baseline totalTrials === 0 → NaN baseline score, exceeded = false', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(3, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 0, totalTrials: 0 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'bug-hit-rate');
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });

    it('new evaluator not in baseline → exceeded = false', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(3, 3),
        'new-eval': makeAgg(2, 3),
      });
      const baseline = makeBaseline({ 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'new-eval');
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });

    it('unknown verdicts count as failures: totalTrials includes all verdicts', () => {
      // TrialAggregator counts unknowns toward totalTrials as failures.
      // Comparator sees totalTrials = 3 (1 unknown counted), passingTrials = 2.
      // Score = 2/3 — same as baseline, delta = 0 — no regression.
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline({
        'bug-hit-rate': { passingTrials: 2, totalTrials: 3 },
      });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('pass');
    });

    it('gate passes when only non-breaching evaluators exist', () => {
      const result = makeResult('regression', {
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

    it('gate is error when one of multiple evaluators breaches', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(3, 3),         // fine
        'prompt-efficiency': makeAgg(6, 10),    // drop 0.4 > 0.2
      });
      const baseline = makeBaseline({
        'bug-hit-rate': { passingTrials: 3, totalTrials: 3 },
        'prompt-efficiency': { passingTrials: 10, totalTrials: 10 },
      });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('error');
    });
  });

  // ── Stability-level gate severity ──────────────────────────────────────────

  describe('stability-level gate severity', () => {
    it('low stability + exceeded threshold → warning', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'regression',
        'low',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('warning');
      expect(r.stabilityLevel).toBe('low');
    });

    it('medium stability + exceeded threshold → error', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'regression',
        'medium',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('error');
      expect(r.stabilityLevel).toBe('medium');
    });

    it('high stability + exceeded threshold → critical', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
        'regression',
        'high',
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('critical');
      expect(r.stabilityLevel).toBe('high');
    });

    it('legacy baseline (no stabilityLevel) + exceeded → error', () => {
      const result = makeResult('regression', {
        'bug-hit-rate': makeAgg(2, 3),
      });
      // no stabilityLevel on baseline → defaults to 'medium' → 'error'
      const baseline = makeBaseline(
        { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
      );
      const r = comparator.compare(result, baseline, THRESHOLDS);
      expect(r.gate).toBe('error');
      expect(r.stabilityLevel).toBe('medium');
    });

    it('stabilityLevel on result reflects baseline level for passing gate',
      () => {
        const result = makeResult('regression', {
          'bug-hit-rate': makeAgg(3, 3),
        });
        const baseline = makeBaseline(
          { 'bug-hit-rate': { passingTrials: 3, totalTrials: 3 } },
          'regression',
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
      const result = makeResult('regression', {
        latency: makeScoreAgg(0.56),
      });
      const baseline = makeScoreBaseline(0.8);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.exceeded).toBe(true);
      expect(r.gate).toBe('error');
    });

    it('passes when relative score drop is within threshold', () => {
      // baseline=0.8, current=0.75, drop=(0.8-0.75)/0.8=0.0625 < 0.15
      const result = makeResult('regression', {
        latency: makeScoreAgg(0.75),
      });
      const baseline = makeScoreBaseline(0.8);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.exceeded).toBe(false);
      expect(r.gate).toBe('pass');
    });

    it('absent baseline medianScore -> exceeded = false', () => {
      // baseline scores entry exists but medianScore is absent
      const result = makeResult('regression', {
        latency: makeScoreAgg(0.5),
      });
      const baseline = makeScoreBaseline();
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.baselineScore)).toBe(true);
    });

    it('absent current medianScore -> exceeded = false', () => {
      const result = makeResult('regression', {
        latency: makeScoreAgg(),
      });
      const baseline = makeScoreBaseline(8.0);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.exceeded).toBe(false);
      expect(Number.isNaN(e?.currentScore)).toBe(true);
    });

    it('baseline threshold overrides config threshold', () => {
      // drop=(0.8-0.65)/0.8=0.1875; config default=0.1 → would flag
      // baseline regressionThresholds.latency=0.25 → should pass
      const result = makeResult('regression', {
        latency: makeScoreAgg(0.65),
      });
      const baseline = makeScoreBaseline(0.8, { latency: 0.25 });
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.exceeded).toBe(false);
      expect(r.gate).toBe('pass');
    });

    it('baseline medianScore = 0 → exceeded = false (no division by zero)',
      () => {
        const result = makeResult('regression', {
          latency: makeScoreAgg(0),
        });
        const baseline = makeScoreBaseline(0);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency');
        expect(e?.exceeded).toBe(false);
      },
    );

    it('currentScore and baselineScore reflect median scores', () => {
      const result = makeResult('regression', {
        latency: makeScoreAgg(0.56),
      });
      const baseline = makeScoreBaseline(0.8);
      const r = comparator.compare(result, baseline, THRESHOLDS);
      const e = r.evaluators.find((x) => x.evaluator === 'latency');
      expect(e?.currentScore).toBeCloseTo(0.56);
      expect(e?.baselineScore).toBeCloseTo(0.8);
      expect(e?.delta).toBeCloseTo(0.56 - 0.8);
    });

    describe('lowerIsBetter evaluator', () => {
      it('flags regression when score increases past threshold', () => {
        // baseline=7000, current=8500, increase=(8500-7000)/7000≈0.214 > 0.1
        const result = makeResult('regression', {
          latency: { ...makeScoreAgg(8500), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(7000);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency');
        expect(e?.exceeded).toBe(true);
        expect(r.gate).toBe('error');
      });

      it('does not flag regression when score decreases (improvement)', () => {
        // baseline=7000, current=5500, decrease — lower is better, this is good
        const result = makeResult('regression', {
          latency: { ...makeScoreAgg(5500), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(7000);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency');
        expect(e?.exceeded).toBe(false);
        expect(r.gate).toBe('pass');
      });

      it('does not flag regression when score increase is within threshold', () => {
        // baseline=7000, current=7500, increase=(7500-7000)/7000≈0.071 < 0.1
        const result = makeResult('regression', {
          latency: { ...makeScoreAgg(7500), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(7000);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency');
        expect(e?.exceeded).toBe(false);
      });

      it('baseline 0 with lowerIsBetter → exceeded = false (no division by zero)', () => {
        const result = makeResult('regression', {
          latency: { ...makeScoreAgg(100), lowerIsBetter: true },
        });
        const baseline = makeScoreBaseline(0);
        const r = comparator.compare(result, baseline, THRESHOLDS);
        const e = r.evaluators.find((x) => x.evaluator === 'latency');
        expect(e?.exceeded).toBe(false);
      });
    });

    describe('stability-level gate severity', () => {
      // baseline=0.8, current=0.5: drop=(0.8-0.5)/0.8=0.375 > 0.1 default
      it('low stability + score drop → warning', () => {
        const result = makeResult('regression', {
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

      it('medium stability + score drop → error', () => {
        const result = makeResult('regression', {
          latency: makeScoreAgg(0.5),
        });
        const baseline = {
          ...makeScoreBaseline(0.8),
          stabilityLevel: 'medium' as const,
        };
        const r = comparator.compare(result, baseline, THRESHOLDS);
        expect(r.gate).toBe('error');
        expect(r.stabilityLevel).toBe('medium');
      });

      it('high stability + score drop → critical', () => {
        const result = makeResult('regression', {
          latency: makeScoreAgg(0.5),
        });
        const baseline = {
          ...makeScoreBaseline(0.8),
          stabilityLevel: 'high' as const,
        };
        const r = comparator.compare(result, baseline, THRESHOLDS);
        expect(r.gate).toBe('critical');
        expect(r.stabilityLevel).toBe('high');
      });

      it('score drop within threshold → pass regardless of stability', () => {
        // drop=(0.8-0.75)/0.8=0.0625 < 0.1 default
        const result = makeResult('regression', {
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
});
