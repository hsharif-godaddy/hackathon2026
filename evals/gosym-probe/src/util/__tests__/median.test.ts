import { describe, it, expect } from 'vitest';
import { median } from '../median.js';

describe('median', () => {
  it('returns null for empty array', () => {
    expect(median([])).toBeNull();
  });

  it('returns the single element for length-1', () => {
    expect(median([42])).toBe(42);
  });

  it(
    'returns the middle element for odd-length array',
    () => {
      expect(median([3, 1, 2])).toBe(2);
    },
  );

  it(
    'returns average of two middle elements for '
    + 'even-length array',
    () => {
      expect(median([4, 1, 3, 2])).toBe(2.5);
    },
  );

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('handles negative numbers', () => {
    expect(median([-5, -1, -3])).toBe(-3);
  });

  it('handles decimal values', () => {
    expect(median([1.5, 2.5])).toBe(2.0);
  });
});
