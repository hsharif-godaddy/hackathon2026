import { describe, expect, it } from 'vitest';

import { KNOWN_ISC_CODES, normalizeIsc } from './isc-config';

describe('KNOWN_ISC_CODES', () => {
  it('contains the four Phase 1 campaign codes', () => {
    expect(KNOWN_ISC_CODES).toEqual(
      expect.arrayContaining(['GDWELCOME', 'GOTIME', 'GOGERMANY', 'GOINDIA'])
    );
  });
});

describe('normalizeIsc', () => {
  it('returns the canonical form for an exact allowlist match', () => {
    expect(normalizeIsc('GDWELCOME')).toBe('GDWELCOME');
  });

  it('uppercases lowercase input before matching', () => {
    expect(normalizeIsc('gdwelcome')).toBe('GDWELCOME');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeIsc('  GDWELCOME  ')).toBe('GDWELCOME');
  });

  it('returns null for an unknown code', () => {
    expect(normalizeIsc('FAKECODE')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizeIsc('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(normalizeIsc('   ')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeIsc(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeIsc(undefined)).toBeNull();
  });
});
