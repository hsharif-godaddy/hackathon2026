import { describe, it, expect } from 'vitest';
import { exceedsThreshold, resolveThreshold, hasVersionMismatch } from '../threshold.js';
import type { ThresholdConfig } from '../threshold.js';

describe('exceedsThreshold', () => {
  describe('lowerIsBetter with positive baseline', () => {
    it('within threshold returns false', () => {
      // baseline=100, current=105, threshold=0.1
      // (105 - 100) / 100 = 0.05, not > 0.1
      expect(exceedsThreshold(105, 100, 0.1, true)).toBe(false);
    });

    it('exceeding threshold returns true', () => {
      // baseline=100, current=120, threshold=0.1
      // (120 - 100) / 100 = 0.2 > 0.1
      expect(exceedsThreshold(120, 100, 0.1, true)).toBe(true);
    });

    it('improvement (decrease) returns false', () => {
      // baseline=100, current=80, threshold=0.1
      // (80 - 100) / 100 = -0.2, not > 0.1
      expect(exceedsThreshold(80, 100, 0.1, true)).toBe(false);
    });
  });

  describe('higherIsBetter with positive baseline', () => {
    it('within threshold returns false', () => {
      // baseline=100, current=95, threshold=0.1
      // (100 - 95) / 100 = 0.05, not > 0.1
      expect(exceedsThreshold(95, 100, 0.1, false)).toBe(false);
    });

    it('exceeding threshold returns true', () => {
      // baseline=100, current=80, threshold=0.1
      // (100 - 80) / 100 = 0.2 > 0.1
      expect(exceedsThreshold(80, 100, 0.1, false)).toBe(true);
    });

    it('improvement (increase) returns false', () => {
      // baseline=100, current=120, threshold=0.1
      // (100 - 120) / 100 = -0.2, not > 0.1
      expect(exceedsThreshold(120, 100, 0.1, false)).toBe(false);
    });
  });

  describe('baselineScore === 0 with lowerIsBetter', () => {
    it('currentScore <= 0 returns false', () => {
      expect(exceedsThreshold(0, 0, 0.1, true)).toBe(false);
      expect(exceedsThreshold(-5, 0, 0.1, true)).toBe(false);
    });

    it('currentScore > 0 returns true', () => {
      expect(exceedsThreshold(1, 0, 0.1, true)).toBe(true);
      expect(exceedsThreshold(0.001, 0, 0.1, true)).toBe(true);
    });
  });

  describe('baselineScore === 0 with higherIsBetter', () => {
    it('always returns false regardless of currentScore', () => {
      expect(exceedsThreshold(0, 0, 0.1, false)).toBe(false);
      expect(exceedsThreshold(100, 0, 0.1, false)).toBe(false);
      expect(exceedsThreshold(-5, 0, 0.1, false)).toBe(false);
    });
  });

  describe('baselineScore < 0', () => {
    it('always returns false for lowerIsBetter', () => {
      expect(exceedsThreshold(-15, -10, 0.1, true)).toBe(false);
      expect(exceedsThreshold(100, -10, 0.1, true)).toBe(false);
      expect(exceedsThreshold(-5, -10, 0.1, true)).toBe(false);
    });

    it('always returns false for higherIsBetter', () => {
      expect(exceedsThreshold(-15, -10, 0.1, false)).toBe(false);
      expect(exceedsThreshold(100, -10, 0.1, false)).toBe(false);
      expect(exceedsThreshold(-5, -10, 0.1, false)).toBe(false);
    });
  });

  describe('non-finite currentScore', () => {
    it('NaN returns false', () => {
      expect(exceedsThreshold(NaN, 100, 0.1, true)).toBe(false);
      expect(exceedsThreshold(NaN, 100, 0.1, false)).toBe(false);
    });

    it('Infinity returns false', () => {
      expect(exceedsThreshold(Infinity, 100, 0.1, true)).toBe(false);
      expect(exceedsThreshold(Infinity, 100, 0.1, false)).toBe(false);
    });

    it('-Infinity returns false', () => {
      expect(exceedsThreshold(-Infinity, 100, 0.1, true)).toBe(false);
      expect(exceedsThreshold(-Infinity, 100, 0.1, false)).toBe(false);
    });
  });

  describe('non-finite baselineScore', () => {
    it('NaN returns false', () => {
      expect(exceedsThreshold(100, NaN, 0.1, true)).toBe(false);
      expect(exceedsThreshold(100, NaN, 0.1, false)).toBe(false);
    });

    it('Infinity returns false', () => {
      expect(exceedsThreshold(100, Infinity, 0.1, true)).toBe(false);
      expect(exceedsThreshold(100, Infinity, 0.1, false)).toBe(false);
    });

    it('-Infinity returns false', () => {
      expect(exceedsThreshold(100, -Infinity, 0.1, true)).toBe(false);
      expect(exceedsThreshold(100, -Infinity, 0.1, false)).toBe(false);
    });
  });

  describe('boundary cases: exactly at threshold', () => {
    it('exactly at threshold returns false (uses > not >=)', () => {
      // baseline=100, current=110, threshold=0.1
      // (110 - 100) / 100 = 0.1, not > 0.1
      expect(exceedsThreshold(110, 100, 0.1, true)).toBe(false);
    });

    it('exactly at threshold returns false for higherIsBetter', () => {
      // baseline=100, current=90, threshold=0.1
      // (100 - 90) / 100 = 0.1, not > 0.1
      expect(exceedsThreshold(90, 100, 0.1, false)).toBe(false);
    });

    it('just above threshold returns true', () => {
      // baseline=100, current=110.01, threshold=0.1
      // (110.01 - 100) / 100 = 0.1001 > 0.1
      expect(exceedsThreshold(110.01, 100, 0.1, true)).toBe(true);
    });

    it('just above threshold returns true for higherIsBetter', () => {
      // baseline=100, current=89.99, threshold=0.1
      // (100 - 89.99) / 100 = 0.1001 > 0.1
      expect(exceedsThreshold(89.99, 100, 0.1, false)).toBe(true);
    });
  });
});

describe('resolveThreshold', () => {
  it('returns baseline override when present', () => {
    const config: ThresholdConfig = { thresholds: { 'cost': 0.2 }, defaultThreshold: 0.1 };
    expect(resolveThreshold('cost', config, { 'cost': 0.05 })).toBe(0.05);
  });

  it('falls back to config per-evaluator threshold', () => {
    const config: ThresholdConfig = { thresholds: { 'cost': 0.2 }, defaultThreshold: 0.1 };
    expect(resolveThreshold('cost', config, {})).toBe(0.2);
  });

  it('falls back to defaultThreshold', () => {
    const config: ThresholdConfig = { thresholds: {}, defaultThreshold: 0.1 };
    expect(resolveThreshold('cost', config, {})).toBe(0.1);
  });

  it('omitting baselineThresholds uses 2-level cascade', () => {
    const config: ThresholdConfig = { thresholds: { 'cost': 0.2 }, defaultThreshold: 0.1 };
    expect(resolveThreshold('cost', config)).toBe(0.2);
    expect(resolveThreshold('other', config)).toBe(0.1);
  });
});

describe('hasVersionMismatch', () => {
  it('both undefined returns false', () => {
    expect(hasVersionMismatch(undefined, undefined)).toBe(false);
  });

  it('both equal returns false', () => {
    expect(hasVersionMismatch('v1', 'v1')).toBe(false);
  });

  it('different versions returns true', () => {
    expect(hasVersionMismatch('v1', 'v2')).toBe(true);
  });

  it('current defined, baseline undefined returns true', () => {
    expect(hasVersionMismatch('v1', undefined)).toBe(true);
  });

  it('current undefined, baseline defined returns true', () => {
    expect(hasVersionMismatch(undefined, 'v1')).toBe(true);
  });
});
