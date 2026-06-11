import { describe, expect, it } from 'vitest';

import { isTLAShopper } from '@/lib/is-tla-shopper';

describe('isTLAShopper', () => {
  it('returns true for three-character shopper IDs', function threeChar() {
    expect(isTLAShopper('abc')).toBe(true);
  });

  it('returns false for longer shopper IDs', function longerId() {
    expect(isTLAShopper('12345678')).toBe(false);
  });

  it('returns false for shorter or missing IDs', function missingOrShort() {
    expect(isTLAShopper('ab')).toBe(false);
    expect(isTLAShopper(undefined)).toBe(false);
    expect(isTLAShopper(null)).toBe(false);
  });
});
