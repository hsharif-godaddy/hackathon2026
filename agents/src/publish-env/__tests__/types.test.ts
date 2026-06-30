import { describe, expect, it } from 'vitest';

import { mergePublishEnvContributions } from '../types.js';

describe('mergePublishEnvContributions', () => {
  it('merges vars and dedupes managed update policies', () => {
    expect(mergePublishEnvContributions([
      {
        source: 'commerce',
        vars: {
          GODADDY_STORE_ID: 'store-1',
        },
        updateIfCurrentValueIn: {
          GODADDY_STORE_ID: ['store-old', 'store-old'],
        },
      },
      {
        source: 'another-skill',
        vars: {
          OTHER_KEY: 'other-value',
        },
        updateIfCurrentValueIn: {
          GODADDY_STORE_ID: ['store-older'],
        },
      },
    ])).toEqual({
      vars: {
        GODADDY_STORE_ID: 'store-1',
        OTHER_KEY: 'other-value',
      },
      updateIfCurrentValueIn: {
        GODADDY_STORE_ID: ['store-old', 'store-older'],
      },
    });
  });

  it('rejects conflicting values for the same env key', () => {
    expect(() => mergePublishEnvContributions([
      {
        source: 'commerce',
        vars: {
          SHARED_KEY: 'commerce-value',
        },
      },
      {
        source: 'another-skill',
        vars: {
          SHARED_KEY: 'other-value',
        },
      },
    ])).toThrow('Conflicting publish env value for SHARED_KEY from another-skill');
  });
});
