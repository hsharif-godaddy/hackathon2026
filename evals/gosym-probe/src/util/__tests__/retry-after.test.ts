import { describe, it, expect } from 'vitest';

import { parseRetryAfterMs } from '../retry-after.js';

function headersWithRetryAfter(value: string): Headers {
  const h = new Headers();
  h.set('retry-after', value);
  return h;
}

const DEFAULT_CAP = 300_000;

describe('parseRetryAfterMs — validation boundary tests', () => {
  it('returns null when headers is undefined', () => {
    expect(parseRetryAfterMs(undefined)).toBeNull();
  });

  it('returns null when retry-after header is absent', () => {
    expect(parseRetryAfterMs(new Headers())).toBeNull();
  });

  it('returns null for empty string header value', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter(''))).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('abc'))).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('0'))).toBeNull();
  });

  it('returns null for negative value', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('-5'))).toBeNull();
  });

  it('returns null for Infinity string', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('Infinity'))).toBeNull();
  });

  it('returns null for NaN string', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('NaN'))).toBeNull();
  });

  it('converts a valid positive integer to milliseconds', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('10'))).toBe(10_000);
  });

  it('caps at default 5-minute maximum', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('86400'))).toBe(DEFAULT_CAP);
  });

  it('respects a custom maxWaitMs cap', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('120'), 60_000)).toBe(60_000);
  });

  it('does not cap when value is below custom maxWaitMs', () => {
    expect(parseRetryAfterMs(headersWithRetryAfter('30'), 60_000)).toBe(30_000);
  });
});
