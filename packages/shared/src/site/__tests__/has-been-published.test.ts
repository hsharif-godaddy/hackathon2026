import { describe, expect, it } from 'vitest';

import { hasBeenPublished } from '../has-been-published.js';

describe('hasBeenPublished', () => {
  it('returns true for active publish variant in lifecycle', () => {
    expect(
      hasBeenPublished({
        variantsWithLifecycle: [{ variant: 'publish', status: 'active' }],
      }),
    ).toBe(true);
  });

  it('returns false for inactive publish variant', () => {
    expect(
      hasBeenPublished({
        variantsWithLifecycle: [{ variant: 'publish', status: 'inactive' }],
      }),
    ).toBe(false);
  });

  it('falls back to variants includes publish', () => {
    expect(hasBeenPublished({ variants: ['preview', 'publish'] })).toBe(true);
    expect(hasBeenPublished({ variants: ['preview'] })).toBe(false);
  });

  it('ignores legacy variants when lifecycle is present', () => {
    expect(
      hasBeenPublished({
        variants: ['publish'],
        variantsWithLifecycle: [{ variant: 'publish', status: 'inactive' }],
      }),
    ).toBe(false);
  });
});
