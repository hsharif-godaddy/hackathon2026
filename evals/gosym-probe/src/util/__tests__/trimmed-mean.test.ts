import { describe, it, expect } from 'vitest';
import { trimmedMean } from '../trimmed-mean.js';

describe('trimmedMean', () => {
  it('returns null for empty array', () => {
    expect(trimmedMean([])).toBeNull();
  });

  it('returns the single element for length-1 (no trimming)', () => {
    expect(trimmedMean([42])).toBe(42);
  });

  it('returns mean of both elements for length-2 (no trimming)', () => {
    expect(trimmedMean([1, 3])).toBe(2);
  });

  it('trims lowest and highest for length-3, returning the middle', () => {
    expect(trimmedMean([1, 5, 9])).toBe(5);
  });

  it('trims one from each side for length-4', () => {
    // [1, 2, 8, 9]: trim 1 and 9, mean of [2, 8] = 5
    expect(trimmedMean([1, 2, 8, 9])).toBe(5);
  });

  it('trimmed mean differs from median on asymmetric length-5 distribution', () => {
    // [0, 2, 3, 7, 10]: median=3, trimmed mean=(2+3+7)/3=4
    expect(trimmedMean([0, 2, 3, 7, 10])).toBe(4);
  });

  it('handles unsorted input', () => {
    // same data as length-3 test but provided unsorted
    expect(trimmedMean([9, 1, 5])).toBe(5);
  });

  it('returns the single middle value when all elements are identical', () => {
    expect(trimmedMean([7, 7, 7, 7, 7])).toBe(7);
  });

  it('handles negative values', () => {
    // [-9, -5, -1]: trim -9 and -1, return -5
    expect(trimmedMean([-9, -5, -1])).toBe(-5);
  });

  it('handles large unclamped values (e.g. token counts)', () => {
    // [100, 500, 1000, 2000, 9999]: trim 100 and 9999, mean of [500, 1000, 2000] = 1166.666...
    expect(trimmedMean([100, 500, 1000, 2000, 9999])).toBeCloseTo(1166.667, 2);
  });

  it('handles zero values', () => {
    expect(trimmedMean([0, 0, 0])).toBe(0);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    trimmedMean(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('excludes NaN values', () => {
    expect(trimmedMean([1, NaN, 3])).toBe(2);
  });

  it('excludes Infinity values', () => {
    expect(trimmedMean([1, Infinity, 3])).toBe(2);
  });

  it('excludes -Infinity values', () => {
    expect(trimmedMean([1, -Infinity, 3])).toBe(2);
  });

  it('returns null when all values are NaN', () => {
    expect(trimmedMean([NaN, NaN, NaN])).toBeNull();
  });

  it('returns null when all values are non-finite', () => {
    expect(trimmedMean([NaN, Infinity, -Infinity])).toBeNull();
  });

  it('filters non-finite before trimming', () => {
    // [NaN, 1, 5, 9, Infinity] → finite=[1, 5, 9] → trim → 5
    expect(trimmedMean([NaN, 1, 5, 9, Infinity])).toBe(5);
  });
});
