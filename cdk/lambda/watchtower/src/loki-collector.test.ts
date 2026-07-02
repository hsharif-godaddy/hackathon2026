import { describe, it, expect } from 'vitest';
import { sumResults, byLabel, statusCount } from './loki-collector.js';

const vec = (metric: Record<string, string>, value: number) =>
  ({ metric, value: [0, String(value)] as [number, string] });

describe('sumResults', () => {
  it('returns 0 for empty array', () => {
    expect(sumResults([])).toBe(0);
  });

  it('sums all value fields', () => {
    expect(sumResults([vec({}, 10), vec({}, 25)])).toBe(35);
  });

  it('treats non-numeric values as 0', () => {
    expect(sumResults([vec({}, NaN), vec({}, 5)])).toBe(5);
  });
});

describe('byLabel', () => {
  it('extracts label values and sorts by count descending', () => {
    const results = [vec({ job: 'foo' }, 30), vec({ job: 'bar' }, 80)];
    expect(byLabel(results, 'job')).toEqual([['bar', 80], ['foo', 30]]);
  });

  it('filters out entries where the label is absent', () => {
    const results = [vec({}, 10), vec({ job: 'x' }, 5)];
    expect(byLabel(results, 'job')).toEqual([['x', 5]]);
  });

  it('returns empty array for empty input', () => {
    expect(byLabel([], 'job')).toEqual([]);
  });
});

describe('statusCount', () => {
  it('sums counts for specified HTTP status codes', () => {
    const results = [
      vec({ status: '200' }, 1000),
      vec({ status: '500' }, 5),
      vec({ status: '502' }, 3),
      vec({ status: '503' }, 2),
    ];
    expect(statusCount(results, '500', '502', '503')).toBe(10);
  });

  it('returns 0 when none of the specified codes are present', () => {
    const results = [vec({ status: '200' }, 100)];
    expect(statusCount(results, '500', '502')).toBe(0);
  });

  it('returns 0 for empty input', () => {
    expect(statusCount([], '500')).toBe(0);
  });

  it('handles missing status field gracefully', () => {
    const results = [vec({}, 50)]; // no status label
    expect(statusCount(results, '500')).toBe(0);
  });
});
