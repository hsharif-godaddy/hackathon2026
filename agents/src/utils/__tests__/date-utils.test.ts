import { describe, it, expect } from 'vitest';
import { toIsoDateString } from '../date-utils.js';

describe('toIsoDateString', () => {
  const REF = Date.UTC(2026, 4, 5, 12, 0, 0); // 2026-05-05T12:00:00.000Z

  it('subtracts minutesAgo from the reference and returns ISO 8601', () => {
    expect(toIsoDateString(REF, 30)).toBe('2026-05-05T11:30:00.000Z');
  });

  it('returns the reference timestamp when minutesAgo is 0', () => {
    expect(toIsoDateString(REF, 0)).toBe('2026-05-05T12:00:00.000Z');
  });

  it('supports multi-hour spans (180 minutes = 3h)', () => {
    expect(toIsoDateString(REF, 180)).toBe('2026-05-05T09:00:00.000Z');
  });

  it('crosses a day boundary when the subtraction wraps past midnight UTC', () => {
    const start = Date.UTC(2026, 4, 5, 0, 30, 0); // 00:30 UTC
    expect(toIsoDateString(start, 60)).toBe('2026-05-04T23:30:00.000Z');
  });

  it('returns a future ISO when minutesAgo is negative (permissive behavior documented)', () => {
    expect(toIsoDateString(REF, -30)).toBe('2026-05-05T12:30:00.000Z');
  });

  it('accepts fractional minutes (1.5 → 90 seconds before reference)', () => {
    expect(toIsoDateString(REF, 1.5)).toBe('2026-05-05T11:58:30.000Z');
  });
});
