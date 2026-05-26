import { describe, it, expect } from 'vitest';
import {
  computeMargin,
  tostProportions,
  tostPermutation,
} from '../statistical-tests.js';

// ── computeMargin ─────────────────────────────────────────────────────────────

describe('computeMargin', () => {
  describe('boundary: empty and degenerate inputs', () => {
    it('returns 0 for empty array', () => {
      expect(computeMargin([], 2)).toBe(0);
    });

    it('returns 0 for single value (no variance)', () => {
      expect(computeMargin([0.5], 2)).toBe(0);
    });

    it('returns 0 when all values are identical (SD=0)', () => {
      expect(computeMargin([0.5, 0.5, 0.5], 2)).toBe(0);
    });
  });

  describe('boundary: k multiplier', () => {
    // [0, 1]: mean=0.5, sum_sq_dev=0.5, pop_var=0.25, SD=0.5
    it('applies k=1 multiplier: [0, 1] → 0.5', () => {
      expect(computeMargin([0, 1], 1)).toBeCloseTo(0.5, 10);
    });

    it('applies k=2 multiplier: [0, 1] → 1.0', () => {
      expect(computeMargin([0, 1], 2)).toBeCloseTo(1.0, 10);
    });

    it('applies k=3 multiplier: [0, 1] → 1.5', () => {
      expect(computeMargin([0, 1], 3)).toBeCloseTo(1.5, 10);
    });
  });

  describe('boundary: hand-computed expected values', () => {
    it('pair [0, 1], k=2: population SD=0.5 → margin=1.0', () => {
      // pop_var = ((0-0.5)^2 + (1-0.5)^2) / 2 = 0.25, SD = 0.5
      expect(computeMargin([0, 1], 2)).toBeCloseTo(1.0, 10);
    });

    it('[0, 0.5, 1], k=2: population SD=sqrt(1/6) → margin=2*sqrt(1/6)', () => {
      // mean=0.5, sum_sq_dev=(0.25+0+0.25)=0.5, pop_var=0.5/3=1/6
      const expected = 2 * Math.sqrt(1 / 6);
      expect(computeMargin([0, 0.5, 1], 2)).toBeCloseTo(expected, 10);
    });

    it('high-variance [0, 0, 0, 1, 1, 1], k=2: SD=0.5 → margin=1.0', () => {
      // mean=0.5, exactly 3 zeros and 3 ones, pop_var=0.25
      expect(computeMargin([0, 0, 0, 1, 1, 1], 2)).toBeCloseTo(1.0, 10);
    });
  });
});

// ── tostProportions ───────────────────────────────────────────────────────────

describe('tostProportions', () => {
  const opts = { alpha: 0.05, margin: 0.5 };

  describe('boundary: clear pass — identical all-1 distributions', () => {
    it('all-1s vs all-1s with generous margin → non-inferior', () => {
      // Wilson CI for p=1, n=5 gives [0.5656, 1.0]; CI_lower ≈ -0.434 > -0.5
      const result = tostProportions(
        [1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1],
        opts,
      );
      expect(result.nonInferiorityProven).toBe(true);
      expect(result.observedDiff).toBeCloseTo(0, 10);
    });

    it('method is wilson-score', () => {
      const result = tostProportions([1, 1, 1], [1, 1, 1], opts);
      expect(result.method).toBe('wilson-score');
    });
  });

  describe('boundary: clear fail — all-1s baseline vs all-0s current', () => {
    it('all-0s vs all-1s → not non-inferior', () => {
      // observedDiff = -1, CI_lower = -1 << -0.5
      const result = tostProportions(
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
        opts,
      );
      expect(result.nonInferiorityProven).toBe(false);
      expect(result.observedDiff).toBeCloseTo(-1, 10);
    });

    it('CI upper bound is still negative (regression so severe CI is entirely negative)', () => {
      const result = tostProportions(
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
        opts,
      );
      expect(result.confidenceInterval.upper).toBeLessThan(0);
    });
  });

  describe('boundary: SD=0 edge case — margin=0 demands perfection', () => {
    it('identical distributions with margin=0 → non-inferior fails (CI_lower < 0)', () => {
      // When baseline SD=0 and margin=0: requires CI_lower > 0, which fails
      // because any Wilson CI for finite n gives CI_lower < p_c
      const result = tostProportions(
        [1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1],
        { alpha: 0.05, margin: 0 },
      );
      // CI_lower ≈ -0.434 is not > 0
      expect(result.nonInferiorityProven).toBe(false);
    });
  });

  describe('boundary: known-correct CI bounds', () => {
    // baseline=[0,0,1,1,1], n=5, p_b=0.6
    // current=[1,1,1,1,1], n=5, p_c=1.0
    // Wilson CI for p_c=1, n=5: center≈0.7828, half≈0.2172 → [0.5656, 1.0]
    // Wilson CI for p_b=0.6, n=5: center≈0.5566, half≈0.3259 → [0.2307, 0.8825]
    // Newcombe CI_lower = 0.4 - sqrt((1-0.5656)^2 + (0.8825-0.6)^2) ≈ -0.118
    // Newcombe CI_upper = 0.4 + sqrt(0 + (0.6-0.2307)^2) ≈ 0.769
    it('CI bounds match Newcombe formula for p_c=1 vs p_b=0.6', () => {
      const result = tostProportions(
        [0, 0, 1, 1, 1],
        [1, 1, 1, 1, 1],
        { alpha: 0.05, margin: 0.2 },
      );
      expect(result.observedDiff).toBeCloseTo(0.4, 10);
      expect(result.confidenceInterval.lower).toBeCloseTo(-0.118, 2);
      expect(result.confidenceInterval.upper).toBeCloseTo(0.769, 2);
      // CI_lower = -0.118 > -0.2 → non-inferior
      expect(result.nonInferiorityProven).toBe(true);
    });

    it('reports margin as passed in opts', () => {
      const result = tostProportions([0, 1], [0, 1], { alpha: 0.05, margin: 0.3 });
      expect(result.margin).toBe(0.3);
    });
  });

  describe('boundary: lowerIsBetter direction', () => {
    it('lowerIsBetter: improvement triggers non-inferiority on upper bound', () => {
      // For lowerIsBetter, non-inferiority means current is not worse (not higher)
      // than baseline + margin. Proven when CI_upper < +margin.
      // baseline=[0,0,0,0,0] (p=0), current=[1,1,1,1,1] (p=1): diff=+1
      // CI_upper > margin=0.5 → NOT non-inferior (current is WORSE for lowerIsBetter)
      const result = tostProportions(
        [0, 0, 0, 0, 0],
        [1, 1, 1, 1, 1],
        { alpha: 0.05, margin: 0.5, lowerIsBetter: true },
      );
      expect(result.nonInferiorityProven).toBe(false);
    });

    it('lowerIsBetter: current lower than baseline → non-inferior', () => {
      // current=all-0s vs baseline=all-1s: diff = -1, CI_upper ≈ -0.566 < 0.5
      const result = tostProportions(
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
        { alpha: 0.05, margin: 0.5, lowerIsBetter: true },
      );
      expect(result.nonInferiorityProven).toBe(true);
    });
  });

  describe('boundary: edge — single trial each', () => {
    it('1 pass vs 1 pass with margin=1 → non-inferior', () => {
      const result = tostProportions([1], [1], { alpha: 0.05, margin: 1 });
      expect(result.nonInferiorityProven).toBe(true);
    });

    it('1 fail vs 1 pass → not non-inferior with margin=0.5', () => {
      const result = tostProportions([1], [0], { alpha: 0.05, margin: 0.5 });
      expect(result.nonInferiorityProven).toBe(false);
    });
  });
});

// ── tostPermutation ───────────────────────────────────────────────────────────

describe('tostPermutation', () => {
  describe('boundary: exact path (n_combined ≤ 15)', () => {
    it('uses permutation-exact method when n_combined ≤ 15', () => {
      // baseline=5, current=5 → combined=10 ≤ 15
      const result = tostPermutation(
        [0, 0, 1, 1, 1],
        [0, 0, 1, 1, 1],
        { alpha: 0.05, margin: 0.5 },
      );
      expect(result.method).toBe('permutation-exact');
    });

    it('exact path: identical groups → observedDiff = 0', () => {
      const result = tostPermutation(
        [0, 1, 0, 1, 0],
        [0, 1, 0, 1, 0],
        { alpha: 0.05, margin: 0.5 },
      );
      expect(result.observedDiff).toBeCloseTo(0, 10);
    });

    it('exact path: combined n=15 (boundary) uses exact method', () => {
      const baseline = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]; // n=10
      const current  = [0, 1, 0, 1, 1];                  // n=5 → combined=15
      const result = tostPermutation(baseline, current, { alpha: 0.05, margin: 1.0 });
      expect(result.method).toBe('permutation-exact');
    });
  });

  describe('boundary: MC path (n_combined > 15)', () => {
    it('uses permutation-mc method when n_combined > 15', () => {
      // baseline=8, current=8 → combined=16 > 15
      const baseline = [0, 0, 0, 0, 1, 1, 1, 1];
      const current  = [0, 0, 0, 0, 1, 1, 1, 1];
      const result = tostPermutation(baseline, current, { alpha: 0.05, margin: 0.5, seed: 42 });
      expect(result.method).toBe('permutation-mc');
    });
  });

  describe('boundary: seeded determinism', () => {
    it('same seed produces identical results', () => {
      const baseline = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 0.3, 0.7, 0.5, 0.1];
      const current  = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 1.0,
                        0.15, 0.35, 0.55, 0.75, 0.95, 0.05];
      const r1 = tostPermutation(baseline, current, { alpha: 0.05, margin: 0.4, seed: 123 });
      const r2 = tostPermutation(baseline, current, { alpha: 0.05, margin: 0.4, seed: 123 });
      expect(r1.nonInferiorityProven).toBe(r2.nonInferiorityProven);
      expect(r1.confidenceInterval.lower).toBeCloseTo(r2.confidenceInterval.lower, 10);
      expect(r1.confidenceInterval.upper).toBeCloseTo(r2.confidenceInterval.upper, 10);
    });

    it('different seeds can produce different results on MC path', () => {
      const baseline = Array.from({ length: 10 }, (_, i) => i / 10);
      const current  = Array.from({ length: 10 }, (_, i) => (i + 0.5) / 10);
      const r1 = tostPermutation(baseline, current, { alpha: 0.05, margin: 0.3, seed: 1 });
      const r2 = tostPermutation(baseline, current, { alpha: 0.05, margin: 0.3, seed: 99999 });
      // Results should be close but the CI bounds may differ slightly
      expect(r1.method).toBe('permutation-mc');
      expect(r2.method).toBe('permutation-mc');
    });
  });

  describe('boundary: identical samples (zero-variance case)', () => {
    it('all-same baseline and current → observedDiff = 0', () => {
      const result = tostPermutation(
        [0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5],
        { alpha: 0.05, margin: 0.5 },
      );
      expect(result.observedDiff).toBeCloseTo(0, 10);
    });

    it('identical samples with positive margin → non-inferior', () => {
      // Combined n=6 ≤ 15 → exact. Null dist is all zeros → CI = [0, 0]
      // CI_lower = 0 > -0.5 → pass
      const result = tostPermutation(
        [1, 1, 1],
        [1, 1, 1],
        { alpha: 0.05, margin: 0.5 },
      );
      expect(result.nonInferiorityProven).toBe(true);
    });
  });

  describe('boundary: clear regression fails', () => {
    it('large negative observed diff with tight margin → not non-inferior', () => {
      // baseline = all-1s, current = all-0s: diff = -1
      // Even with generous margin=0.5, -1 < -0.5 → fail
      const result = tostPermutation(
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
        { alpha: 0.05, margin: 0.5 },
      );
      expect(result.nonInferiorityProven).toBe(false);
    });
  });

  describe('boundary: lowerIsBetter direction', () => {
    it('lowerIsBetter: current much higher than baseline → not non-inferior', () => {
      const result = tostPermutation(
        [0, 0, 0, 0, 0],
        [1, 1, 1, 1, 1],
        { alpha: 0.05, margin: 0.5, lowerIsBetter: true },
      );
      expect(result.nonInferiorityProven).toBe(false);
    });

    it('lowerIsBetter: current lower than baseline → non-inferior', () => {
      // current=[0,0,0,0,0] lower than baseline=[1,1,1,1,1] → non-inferior
      const result = tostPermutation(
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
        { alpha: 0.05, margin: 0.5, lowerIsBetter: true },
      );
      expect(result.nonInferiorityProven).toBe(true);
    });
  });

  describe('boundary: ties', () => {
    it('handles all-zero scores without error', () => {
      expect(() =>
        tostPermutation([0, 0, 0], [0, 0, 0], { alpha: 0.05, margin: 0.1 }),
      ).not.toThrow();
    });

    it('all-zero scores: observedDiff = 0', () => {
      const result = tostPermutation([0, 0, 0], [0, 0, 0], { alpha: 0.05, margin: 0.1 });
      expect(result.observedDiff).toBeCloseTo(0, 10);
    });
  });

  describe('CI structure', () => {
    it('CI lower is less than or equal to CI upper', () => {
      const result = tostPermutation(
        [0.3, 0.5, 0.7, 0.4, 0.6],
        [0.4, 0.6, 0.8, 0.3, 0.5],
        { alpha: 0.05, margin: 0.4 },
      );
      expect(result.confidenceInterval.lower).toBeLessThanOrEqual(
        result.confidenceInterval.upper,
      );
    });

    it('reports baselineSD', () => {
      const result = tostPermutation(
        [0, 1, 0, 1, 0],
        [1, 0, 1, 0, 1],
        { alpha: 0.05, margin: 0.5 },
      );
      expect(result.baselineSD).toBeGreaterThanOrEqual(0);
    });
  });
});


// ── power validation ──────────────────────────────────────────────────────────

describe('power validation', () => {
  // baseline has 10 trials; margin = 2 * populationSD(baseline)
  // For binary [0,0,0,0,0,1,1,1,1,1]: SD = 0.5, margin = 1.0

  const baseline10 = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]; // SD=0.5, margin at k=2 = 1.0

  describe('n=5+10: proves non-inferiority at k=2 (identical distribution)', () => {
    it('tostPermutation: 5 current trials from identical distribution → non-inferior', () => {
      const margin = computeMargin(baseline10, 2); // 2 * 0.5 = 1.0
      const current5 = [0, 1, 0, 1, 1]; // same distribution, mean=0.6

      // Combined = 15 → exact path
      const result = tostPermutation(baseline10, current5, { alpha: 0.05, margin });
      expect(result.method).toBe('permutation-exact');
      expect(result.nonInferiorityProven).toBe(true);
    });

    it('tostProportions: 5 current trials → non-inferior', () => {
      const margin = computeMargin(baseline10, 2);
      const current5 = [0, 1, 0, 1, 1];

      const result = tostProportions(baseline10, current5, { alpha: 0.05, margin });
      expect(result.nonInferiorityProven).toBe(true);
    });
  });

  describe('n=3+10: wide CI cannot prove non-inferiority at tight margin', () => {
    it('tostPermutation: 3 current trials with tight margin (k=0.5) → not provable', () => {
      // With k=0.5: margin = 0.5 * 0.5 = 0.25
      // SE_perm ≈ 0.5 * sqrt(1/3 + 1/10) ≈ 0.329
      // q_97.5 ≈ 1.96 * 0.329 ≈ 0.645
      // CI_lower ≈ 0 - 0.645 = -0.645 < -0.25 → fails
      const tightMargin = computeMargin(baseline10, 0.5); // 0.25
      const current3 = [0, 1, 0]; // mean ≈ 0.333

      const result = tostPermutation(baseline10, current3, { alpha: 0.05, margin: tightMargin });
      expect(result.nonInferiorityProven).toBe(false);
    });

    it('tostProportions: 3 current trials with tight margin → not provable', () => {
      const tightMargin = computeMargin(baseline10, 0.5); // 0.25
      const current3 = [0, 1, 0];

      const result = tostProportions(baseline10, current3, { alpha: 0.05, margin: tightMargin });
      expect(result.nonInferiorityProven).toBe(false);
    });

    it('n=3+10 does prove non-inferiority at k=2 (margin matches CI width)', () => {
      // This verifies the statistical boundary: k=2 is generous enough for n=3
      // because 1.96 * sqrt(1/3 + 1/10) ≈ 1.29 < 2.0
      const margin = computeMargin(baseline10, 2); // 1.0
      const current3 = [0, 1, 0]; // same distribution

      const result = tostPermutation(baseline10, current3, { alpha: 0.05, margin });
      expect(result.nonInferiorityProven).toBe(true);
    });
  });
});
