import { describe, it, expect } from 'vitest';
import { hourWindow } from './windows.js';

describe('hourWindow', () => {
  it('returns the most recent settled hour (one-hour ingestion watermark), not the just-closed hour', () => {
    const now = Date.parse('2026-06-26T14:37:12Z');
    // current hour starts 14:00 → settled hour is 12:00–13:00, not 13:00–14:00.
    expect(hourWindow(now)).toEqual({ startIso: '2026-06-26T12:00:00.000Z', endIso: '2026-06-26T13:00:00.000Z' });
  });

  it('handles an exact hour boundary', () => {
    const now = Date.parse('2026-06-26T14:00:00Z');
    expect(hourWindow(now)).toEqual({ startIso: '2026-06-26T12:00:00.000Z', endIso: '2026-06-26T13:00:00.000Z' });
  });
});
