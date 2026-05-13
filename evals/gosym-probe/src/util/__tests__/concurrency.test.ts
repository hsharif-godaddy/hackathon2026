import { describe, it, expect } from 'vitest';
import {
  clampConcurrency,
  effectiveConcurrency,
} from '../concurrency.js';

describe('clampConcurrency', () => {
  it('returns undefined when override is undefined', () => {
    expect(clampConcurrency(undefined, 5)).toBeUndefined();
  });

  it('clamps override above max', () => {
    expect(clampConcurrency(10, 3)).toBe(3);
  });

  it('returns override when below max', () => {
    expect(clampConcurrency(2, 5)).toBe(2);
  });

  it('returns override when equal to max', () => {
    expect(clampConcurrency(4, 4)).toBe(4);
  });
});

describe('effectiveConcurrency', () => {
  it('uses max when override is undefined', () => {
    expect(effectiveConcurrency(undefined, 5)).toBe(5);
  });

  it('clamps override above max', () => {
    expect(effectiveConcurrency(10, 3)).toBe(3);
  });

  it('returns override when below max', () => {
    expect(effectiveConcurrency(2, 5)).toBe(2);
  });

  it('returns override when equal to max', () => {
    expect(effectiveConcurrency(4, 4)).toBe(4);
  });
});
