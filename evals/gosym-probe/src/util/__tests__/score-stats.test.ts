import { describe, it, expect } from 'vitest';
import { computeScoreStats } from '../score-stats.js';

describe('computeScoreStats', () => {
  it('returns zero stats for empty array', () => {
    expect(computeScoreStats([])).toEqual({
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stddev: 0,
    });
  });

  it('returns correct stats for single score (stddev is 0)', () => {
    expect(computeScoreStats([0.8])).toEqual({
      min: 0.8,
      max: 0.8,
      mean: 0.8,
      median: 0.8,
      stddev: 0,
    });
  });

  it('interpolates median for even-length array', () => {
    // sorted: [0.2, 0.4, 0.6, 0.8] → median = (0.4 + 0.6) / 2 = 0.5
    const result = computeScoreStats([0.8, 0.2, 0.6, 0.4]);
    expect(result.min).toBeCloseTo(0.2);
    expect(result.max).toBeCloseTo(0.8);
    expect(result.median).toBeCloseTo(0.5);
  });

  it('picks middle element as median for odd-length array', () => {
    // sorted: [0.1, 0.5, 0.9] → median = 0.5
    const result = computeScoreStats([0.9, 0.1, 0.5]);
    expect(result.median).toBeCloseTo(0.5);
  });

  it('handles boundary scores 0 and 1', () => {
    // mean=0.5, variance=0.25, stddev=0.5
    const result = computeScoreStats([0, 1]);
    expect(result.min).toBe(0);
    expect(result.max).toBe(1);
    expect(result.mean).toBeCloseTo(0.5);
    expect(result.median).toBeCloseTo(0.5);
    expect(result.stddev).toBeCloseTo(0.5);
  });

  it('computes standard deviation correctly', () => {
    // [0, 0, 1, 1]: mean=0.5, variance=0.25, stddev=0.5
    const result = computeScoreStats([0, 0, 1, 1]);
    expect(result.mean).toBeCloseTo(0.5);
    expect(result.stddev).toBeCloseTo(0.5);
  });
});
