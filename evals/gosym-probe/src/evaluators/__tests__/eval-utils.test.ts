import { describe, it, expect } from 'vitest';
import {
  scoreToVerdict,
  computeProbeDelta,
  PASS_THRESHOLD,
  ZERO_PROBE,
} from '../eval-utils.js';

describe('scoreToVerdict', () => {
  it('returns pass when score >= PASS_THRESHOLD', () => {
    expect(scoreToVerdict(PASS_THRESHOLD)).toBe('pass');
    expect(scoreToVerdict(0.9)).toBe('pass');
    expect(scoreToVerdict(1.0)).toBe('pass');
  });

  it('returns fail when score < PASS_THRESHOLD', () => {
    expect(scoreToVerdict(0.69)).toBe('fail');
    expect(scoreToVerdict(0.5)).toBe('fail');
    expect(scoreToVerdict(0.39)).toBe('fail');
    expect(scoreToVerdict(0.0)).toBe('fail');
  });
});

describe('computeProbeDelta', () => {
  it('returns ZERO_PROBE when baseline is undefined', () => {
    const current = {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
      calls: 5,
    };

    const delta = computeProbeDelta(current, undefined);

    expect(delta).toEqual(ZERO_PROBE);
  });

  it('computes the difference between current and baseline', () => {
    const baseline = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      calls: 2,
    };
    const current = {
      promptTokens: 600,
      completionTokens: 250,
      totalTokens: 850,
      calls: 7,
    };

    const delta = computeProbeDelta(current, baseline);

    expect(delta).toEqual({
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
      calls: 5,
    });
  });

  it('returns zeroes when current equals baseline', () => {
    const usage = {
      promptTokens: 300,
      completionTokens: 100,
      totalTokens: 400,
      calls: 3,
    };

    const delta = computeProbeDelta(usage, usage);

    expect(delta).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    });
  });

  it('clamps all fields to zero when baseline exceeds current', () => {
    const baseline = {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
      calls: 5,
    };
    const current = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      calls: 2,
    };

    const delta = computeProbeDelta(current, baseline);

    expect(delta).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    });
  });
});

