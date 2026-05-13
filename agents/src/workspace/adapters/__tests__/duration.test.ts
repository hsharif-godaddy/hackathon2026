import { describe, it, expect } from 'vitest';
import { parseDurationToSeconds } from '../duration.js';

describe('parseDurationToSeconds', () => {
  it.each([
    ['', 0],
    ['   ', 0],
    ['300s', 300],
    ['5m', 300],
    ['5m0s', 300],
    ['1h', 3600],
    ['1h30m', 5400],
    ['1h30m45s', 5445],
    ['90m', 5400],
    ['1.5s', 1.5],
    ['250ms', 0.25],
    ['100us', 1e-4],
    ['100µs', 1e-4],
    ['5ns', 5e-9],
    ['42', 42],
    ['  42  ', 42],
    ['3.14', 3.14],
  ])('parses %j as %d seconds', (wire, expected) => {
    expect(parseDurationToSeconds(wire)).toBeCloseTo(expected, 6);
  });

  it.each([
    ['garbage', 0],
    ['5mgarbage', 0],
    ['1.5.5s', 0],
    ['5sm', 0],
    ['abc5s', 0],
    ['5s5', 0],
  ])('rejects %j and returns 0', (wire, expected) => {
    expect(parseDurationToSeconds(wire)).toBe(expected);
  });

  it('does not exhibit catastrophic backtracking on adversarial input', () => {
    // Repeated unit-like prefix without a closing digit. Pre-fix, the
    // ^(?:...)+$ shape was vulnerable; after the rewrite this completes
    // in O(n) on input length.
    const adversarial = '1h'.repeat(50_000) + 'X';
    const start = Date.now();
    expect(parseDurationToSeconds(adversarial)).toBe(0);
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
