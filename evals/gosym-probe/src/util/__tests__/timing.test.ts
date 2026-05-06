import { describe, it, expect } from 'vitest';
import { trialDurationMs, formatDuration, computeTimingStats } from '../timing.js';
import type { Turn } from '../../runner/transcript.js';
import { makeMinimalTurn as makeTurn } from '../../reporters/__tests__/fixtures.js';

function makeTrial(turns: Turn[]): { transcript: { turns: Turn[] } } {
  return { transcript: { turns } };
}

describe('trialDurationMs', () => {
  it('returns 0 for empty array', () => {
    expect(trialDurationMs([])).toBe(0);
  });

  it('returns 0 for single turn', () => {
    expect(trialDurationMs([makeTurn(5000)])).toBe(0);
  });

  it('returns delta between first and last turn for 2 turns', () => {
    const turns = [makeTurn(1000), makeTurn(4000)];
    expect(trialDurationMs(turns)).toBe(3000);
  });

  it('returns delta between first and last for 3+ turns', () => {
    const turns = [makeTurn(0), makeTurn(1000), makeTurn(5000)];
    expect(trialDurationMs(turns)).toBe(5000);
  });

  it('clamps to 0 when last timestamp precedes first', () => {
    const turns = [
      makeTurn(100),
      makeTurn(9999),
      makeTurn(50),
    ];
    expect(trialDurationMs(turns)).toBe(0);
  });

  it('handles large timestamps correctly', () => {
    const turns = [
      makeTurn(1_700_000_000_000),
      makeTurn(1_700_000_005_000),
    ];
    expect(trialDurationMs(turns)).toBe(5000);
  });

  it('returns 0 when first turn timestamp is NaN', () => {
    expect(trialDurationMs([makeTurn(NaN), makeTurn(5000)])).toBe(0);
  });

  it('returns 0 when last turn timestamp is NaN', () => {
    expect(trialDurationMs([makeTurn(1000), makeTurn(NaN)])).toBe(0);
  });

  it('returns 0 when both timestamps are NaN', () => {
    expect(trialDurationMs([makeTurn(NaN), makeTurn(NaN)])).toBe(0);
  });
});

describe('computeTimingStats', () => {
  it('returns zero stats for empty trials array', () => {
    expect(computeTimingStats([])).toEqual({
      totalDurationMs: 0,
      avgTrialDurationMs: 0,
      avgTurnsPerTrial: 0,
    });
  });

  it('returns stats for a single trial', () => {
    const trial = makeTrial([makeTurn(0), makeTurn(5000)]);
    expect(computeTimingStats([trial])).toEqual({
      totalDurationMs: 5000,
      avgTrialDurationMs: 5000,
      avgTurnsPerTrial: 2,
    });
  });

  it('averages duration and turns across multiple trials', () => {
    // trial1: 3000ms, 2 turns; trial2: 9000ms, 3 turns
    const t1 = makeTrial([makeTurn(0), makeTurn(3000)]);
    const t2 = makeTrial([makeTurn(0), makeTurn(7000), makeTurn(9000)]);
    const result = computeTimingStats([t1, t2]);
    expect(result.totalDurationMs).toBe(12000);
    expect(result.avgTrialDurationMs).toBe(6000);
    expect(result.avgTurnsPerTrial).toBe(2.5); // unrounded
  });

  it('delegates duration to trialDurationMs (NaN timestamps → 0ms)', () => {
    // trialDurationMs returns 0 for NaN timestamps; turns are still counted
    const trial = makeTrial([makeTurn(NaN), makeTurn(NaN)]);
    const result = computeTimingStats([trial]);
    expect(result.totalDurationMs).toBe(0);
    expect(result.avgTurnsPerTrial).toBe(2);
  });
});

describe('formatDuration', () => {
  it('returns 0s for zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('returns 0s for negative values', () => {
    expect(formatDuration(-5000)).toBe('0s');
  });

  it('returns 0s for NaN', () => {
    expect(formatDuration(NaN)).toBe('0s');
  });

  it('returns 0s for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0s');
  });

  it('returns 0s for -Infinity', () => {
    expect(formatDuration(-Infinity)).toBe('0s');
  });

  it('rounds sub-second to nearest second', () => {
    expect(formatDuration(1)).toBe('0s');
    expect(formatDuration(500)).toBe('1s');
    expect(formatDuration(999)).toBe('1s');
  });

  it('formats seconds under a minute', () => {
    expect(formatDuration(1_000)).toBe('1s');
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(59_000)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(61_000)).toBe('1m 1s');
    expect(formatDuration(150_000)).toBe('2m 30s');
    expect(formatDuration(3_599_000)).toBe('59m 59s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m 0s');
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s');
    expect(formatDuration(86_400_000)).toBe('24h 0m 0s');
  });
});
