import { describe, expect, it } from 'vitest';
import { REGRESSION_DEFAULTS } from '../defaults.js';
import { createConfig as createLocalDev } from '../local.dev.js';
import { createConfig as createLocalTest } from '../local.test.js';
import { createConfig as createLocalProd } from '../local.prod.js';

// These guard the *shipped* relative-floor fraction. The comparator tests pin
// floor behavior using hardcoded 0.05 fixtures; nothing there asserts the value
// actually deployed. A typo in defaults.ts (or a stray per-env override) would
// pass every comparator test and silently disable the floor in prod, so the
// fraction is pinned both at the constant and at the effective per-env value.
describe('REGRESSION_DEFAULTS', () => {
  it('ships minMarginFraction = 0.05 (5% relative floor)', () => {
    expect(REGRESSION_DEFAULTS.minMarginFraction).toBe(0.05);
  });

  it('every environment resolves an effective minMarginFraction of 0.05', () => {
    const creators = {
      'local.dev': createLocalDev,
      'local.test': createLocalTest,
      'local.prod': createLocalProd,
    };
    for (const [env, createConfig] of Object.entries(creators)) {
      expect(
        createConfig().regression.minMarginFraction,
        `${env} must not override the relative floor`,
      ).toBe(0.05);
    }
  });
});
