import { describe, it, expect } from 'vitest';
import {
  passAt1,
  passAtK,
  passHatK,
  resolveReportingKs,
  buildPassEstimators,
  wilsonConfidenceInterval,
  formatWilsonCI,
  formatPass1,
  type WilsonCI,
} from '../pass-at-k.js';

describe('passAt1', () => {
  it('returns c/n for valid counts', () => {
    expect(passAt1(5, 3)).toBeCloseTo(0.6, 10);
  });

  it('returns 0 when no trials pass', () => {
    expect(passAt1(5, 0)).toBe(0);
  });

  it('returns 1 when all trials pass', () => {
    expect(passAt1(5, 5)).toBe(1);
  });

  it('returns null for n=0 (trust-boundary guard)', () => {
    expect(passAt1(0, 0)).toBeNull();
  });

  it('returns null for negative n', () => {
    expect(passAt1(-1, 0)).toBeNull();
  });
});

describe('passAtK boundary guards', () => {
  it('returns null for n=0', () => {
    expect(passAtK(0, 0, 1)).toBeNull();
  });

  it('returns null for k<1', () => {
    expect(passAtK(5, 3, 0)).toBeNull();
  });

  it('returns null for k>n', () => {
    expect(passAtK(5, 3, 6)).toBeNull();
  });

  it('returns 1.0 when all k draws cannot avoid a pass (n-c<k)', () => {
    expect(passAtK(5, 3, 3)).toBe(1);
  });

  it('returns 0 when c=0 (no draw can pass)', () => {
    expect(passAtK(5, 0, 2)).toBe(0);
  });

  it('returns 1 when c=n', () => {
    expect(passAtK(5, 5, 2)).toBe(1);
  });

  it('treats c>n defensively as c=n', () => {
    expect(passAtK(5, 7, 2)).toBe(1);
  });
});

describe('passHatK boundary guards', () => {
  it('returns null for n=0', () => {
    expect(passHatK(0, 0, 1)).toBeNull();
  });

  it('returns null for k<1', () => {
    expect(passHatK(5, 3, 0)).toBeNull();
  });

  it('returns null for k>n', () => {
    expect(passHatK(5, 3, 6)).toBeNull();
  });

  it('returns 0 when c<k (cannot draw k passing)', () => {
    expect(passHatK(5, 2, 3)).toBe(0);
  });

  it('returns 0 when c=0', () => {
    expect(passHatK(5, 0, 2)).toBe(0);
  });

  it('returns 1 when c=n', () => {
    expect(passHatK(5, 5, 2)).toBe(1);
  });

  it('treats c>n defensively as c=n', () => {
    expect(passHatK(5, 7, 2)).toBe(1);
  });
});

describe('estimator correctness', () => {
  it('passAtK at k=1 equals c/n', () => {
    expect(passAtK(5, 3, 1)).toBeCloseTo(passAt1(5, 3) as number, 10);
  });

  it('passHatK at k=1 equals c/n', () => {
    expect(passHatK(5, 3, 1)).toBeCloseTo(passAt1(5, 3) as number, 10);
  });

  it('matches independent C(n-c,k)/C(n,k) for passAtK (n=5,c=3,k=2 -> 0.9)', () => {
    expect(passAtK(5, 3, 2)).toBeCloseTo(0.9, 10);
  });

  it('matches independent C(c,k)/C(n,k) for passHatK (n=5,c=3,k=2 -> 0.3)', () => {
    expect(passHatK(5, 3, 2)).toBeCloseTo(0.3, 10);
  });

  it('passAtK is non-decreasing in k', () => {
    const k1: number = passAtK(10, 4, 1) as number;
    const k2: number = passAtK(10, 4, 2) as number;
    const k3: number = passAtK(10, 4, 3) as number;
    expect(k2).toBeGreaterThanOrEqual(k1);
    expect(k3).toBeGreaterThanOrEqual(k2);
  });

  it('passHatK is non-increasing in k', () => {
    const k1: number = passHatK(10, 6, 1) as number;
    const k2: number = passHatK(10, 6, 2) as number;
    const k3: number = passHatK(10, 6, 3) as number;
    expect(k2).toBeLessThanOrEqual(k1);
    expect(k3).toBeLessThanOrEqual(k2);
  });
});

describe('numeric stability', () => {
  it('passAtK stays finite and in [0,1] for large n', () => {
    const value: number = passAtK(200, 137, 50) as number;
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it('passHatK stays finite and in [0,1] for large n', () => {
    const value: number = passHatK(200, 137, 50) as number;
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});

describe('resolveReportingKs', () => {
  it('clamps to ceil(n/2)', () => {
    expect(resolveReportingKs([1, 2, 3, 5, 10], 5)).toEqual([1, 2, 3]);
  });

  it('always includes 1 even when the vector omits it', () => {
    expect(resolveReportingKs([5, 10], 6)).toEqual([1]);
  });

  it('dedupes and sorts ascending', () => {
    expect(resolveReportingKs([3, 1, 3, 2, 1], 10)).toEqual([1, 2, 3]);
  });

  it('drops non-integer and out-of-range values', () => {
    expect(resolveReportingKs([1, 2.5, 0, -1, 3], 10)).toEqual([1, 3]);
  });

  it('returns [] for n<=0', () => {
    expect(resolveReportingKs([1, 2, 3], 0)).toEqual([]);
  });
});

describe('buildPassEstimators', () => {
  it('returns numeric estimators keyed by k', () => {
    const result = buildPassEstimators(5, 3, [1, 2, 3]);
    expect(result.passAt1).toBeCloseTo(0.6, 10);
    expect(result.passAtK?.find((e) => e.k === 2)?.value).toBeCloseTo(0.9, 10);
    expect(result.passHatK?.find((e) => e.k === 2)?.value).toBeCloseTo(0.3, 10);
  });

  it('keys passAtK/passHatK by every resolved k', () => {
    const result = buildPassEstimators(5, 3, [1, 2, 3]);
    expect((result.passAtK ?? []).map((e) => e.k).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect((result.passHatK ?? []).map((e) => e.k).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('returns all-undefined fields when n<=0 (spread guards omit them)', () => {
    const result = buildPassEstimators(0, 0, [1, 2, 3]);
    expect(result.passAt1).toBeUndefined();
    expect(result.passAtK).toBeUndefined();
    expect(result.passHatK).toBeUndefined();
  });

  it('includes wilsonCI when n>0', () => {
    const result = buildPassEstimators(5, 3, [1, 2, 3]);
    expect(result.wilsonCI).toBeDefined();
    expect(result.wilsonCI?.n).toBe(5);
  });

  it('omits wilsonCI when n<=0', () => {
    const result = buildPassEstimators(0, 0, [1, 2, 3]);
    expect(result.wilsonCI).toBeUndefined();
  });
});

describe('wilsonConfidenceInterval boundary guards', () => {
  it('returns null for n=0', () => {
    expect(wilsonConfidenceInterval(0, 0)).toBeNull();
  });

  it('returns null for negative n', () => {
    expect(wilsonConfidenceInterval(-1, 0)).toBeNull();
  });

  it('returns null for n=NaN', () => {
    expect(wilsonConfidenceInterval(NaN, 3)).toBeNull();
  });

  it('returns null for n=Infinity', () => {
    expect(wilsonConfidenceInterval(Infinity, 3)).toBeNull();
  });

  it('returns null for c=NaN', () => {
    expect(wilsonConfidenceInterval(5, NaN)).toBeNull();
  });

  it('returns null for c=Infinity', () => {
    expect(wilsonConfidenceInterval(5, Infinity)).toBeNull();
  });

  it('returns null for z=0', () => {
    expect(wilsonConfidenceInterval(5, 3, 0)).toBeNull();
  });

  it('returns null for z negative', () => {
    expect(wilsonConfidenceInterval(5, 3, -1)).toBeNull();
  });

  it('returns null for z=NaN', () => {
    expect(wilsonConfidenceInterval(5, 3, NaN)).toBeNull();
  });

  it('returns null for z=Infinity', () => {
    expect(wilsonConfidenceInterval(5, 3, Infinity)).toBeNull();
  });

  it('clamps c>n to n', () => {
    const clamped: WilsonCI = wilsonConfidenceInterval(5, 10) as WilsonCI;
    const exact: WilsonCI = wilsonConfidenceInterval(5, 5) as WilsonCI;
    expect(clamped).not.toBeNull();
    expect(clamped.lower).toBeCloseTo(exact.lower, 10);
    expect(clamped.upper).toBeCloseTo(exact.upper, 10);
  });

  it('clamps c<0 to 0', () => {
    const clamped: WilsonCI = wilsonConfidenceInterval(5, -3) as WilsonCI;
    const exact: WilsonCI = wilsonConfidenceInterval(5, 0) as WilsonCI;
    expect(clamped).not.toBeNull();
    expect(clamped.lower).toBeCloseTo(exact.lower, 10);
    expect(clamped.upper).toBeCloseTo(exact.upper, 10);
  });
});

describe('wilsonConfidenceInterval correctness', () => {
  it('n=5/c=3: lower<=p<=upper, bounds in [0,1]', () => {
    const ci: WilsonCI = wilsonConfidenceInterval(5, 3) as WilsonCI;
    const p: number = 3 / 5;
    expect(ci).not.toBeNull();
    expect(ci.lower).toBeLessThanOrEqual(p);
    expect(ci.upper).toBeGreaterThanOrEqual(p);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
    expect(ci.n).toBe(5);
  });

  it('n=100/c=67: lower<=p<=upper, bounds in [0,1]', () => {
    const ci: WilsonCI = wilsonConfidenceInterval(100, 67) as WilsonCI;
    const p: number = 67 / 100;
    expect(ci.lower).toBeLessThanOrEqual(p);
    expect(ci.upper).toBeGreaterThanOrEqual(p);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
  });

  it('n=1/c=0: lower=0, upper covers uncertainty', () => {
    const ci: WilsonCI = wilsonConfidenceInterval(1, 0) as WilsonCI;
    expect(ci.lower).toBeCloseTo(0, 5);
    expect(ci.upper).toBeGreaterThan(0);
  });

  it('n=1/c=1: upper=1, lower covers uncertainty', () => {
    const ci: WilsonCI = wilsonConfidenceInterval(1, 1) as WilsonCI;
    expect(ci.upper).toBeCloseTo(1, 5);
    expect(ci.lower).toBeLessThan(1);
  });

  it('width narrows as n increases (same pass rate)', () => {
    const small: WilsonCI = wilsonConfidenceInterval(5, 3) as WilsonCI;
    const large: WilsonCI = wilsonConfidenceInterval(100, 60) as WilsonCI;
    const smallWidth: number = small.upper - small.lower;
    const largeWidth: number = large.upper - large.lower;
    expect(largeWidth).toBeLessThan(smallWidth);
  });

  it('known value n=5/c=3/z=1.96: lower~0.2307, upper~0.8824', () => {
    const ci: WilsonCI = wilsonConfidenceInterval(5, 3, 1.96) as WilsonCI;
    expect(ci.lower).toBeCloseTo(0.2307, 3);
    expect(ci.upper).toBeCloseTo(0.8824, 3);
  });
});

describe('formatWilsonCI', () => {
  it('returns sentinel when ci is undefined', () => {
    expect(formatWilsonCI(undefined, '---')).toBe('---');
  });

  it('renders [lower, upper] as 2 decimal strings', () => {
    const ci: WilsonCI = { lower: 0.23456, upper: 0.87654, n: 5 };
    expect(formatWilsonCI(ci, '---')).toBe('[0.23, 0.88]');
  });

  it('renders 0.00 lower and 1.00 upper at boundaries', () => {
    const ci: WilsonCI = { lower: 0, upper: 1, n: 1 };
    expect(formatWilsonCI(ci, '---')).toBe('[0.00, 1.00]');
  });
});

describe('formatPass1 extended signature', () => {
  it('renders bare value when no n/ci given (backward compat)', () => {
    expect(formatPass1(0.6, '---')).toBe('0.60');
  });

  it('returns sentinel for undefined value', () => {
    expect(formatPass1(undefined, '---')).toBe('---');
  });

  it('returns sentinel for non-finite value', () => {
    expect(formatPass1(NaN, '---')).toBe('---');
  });

  it('renders value with (n=N) when stats provided but no ci', () => {
    expect(formatPass1(0.6, '---', { n: 5 })).toBe('0.60 (n=5)');
  });

  it('renders full format with n and ci', () => {
    const ci: WilsonCI = { lower: 0.234, upper: 0.876, n: 5 };
    expect(formatPass1(0.6, '---', { n: 5, ci })).toBe('0.60 (n=5) [0.23, 0.88]');
  });

  it('renders without ci annotation when ci is undefined even if stats provided', () => {
    expect(formatPass1(0.6, '---', { n: 5, ci: undefined })).toBe('0.60 (n=5)');
  });
});
