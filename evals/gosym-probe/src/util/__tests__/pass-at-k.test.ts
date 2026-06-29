import { describe, it, expect } from 'vitest';
import {
  passAt1,
  passAtK,
  passHatK,
  resolveReportingKs,
  buildPassEstimators,
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
});
