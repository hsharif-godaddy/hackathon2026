import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getServerFeatureFlags, type ServerFeatureFlags } from './server-features';

describe('server-features', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('getServerFeatureFlags', () => {
    it('should return all expected feature flag keys', () => {
      const flags = getServerFeatureFlags();

      // Verify the shape of the returned object
      expect(flags).toHaveProperty('showPricingSection');
    });

    it('should return correct types for all flags', () => {
      const flags = getServerFeatureFlags();

      expect(typeof flags.showPricingSection).toBe('boolean');
    });

    describe('showPricingSection', () => {
      it('should return true when SHOW_PRICING_SECTION is "true"', () => {
        vi.stubEnv('SHOW_PRICING_SECTION', 'true');

        const flags = getServerFeatureFlags();

        expect(flags.showPricingSection).toBe(true);
      });

      it('should return false when SHOW_PRICING_SECTION is "false"', () => {
        vi.stubEnv('SHOW_PRICING_SECTION', 'false');

        const flags = getServerFeatureFlags();

        expect(flags.showPricingSection).toBe(false);
      });

      it('should return false when SHOW_PRICING_SECTION is undefined', () => {
        vi.stubEnv('SHOW_PRICING_SECTION', undefined);

        const flags = getServerFeatureFlags();

        expect(flags.showPricingSection).toBe(false);
      });

      it('should return false when SHOW_PRICING_SECTION is empty string', () => {
        vi.stubEnv('SHOW_PRICING_SECTION', '');

        const flags = getServerFeatureFlags();

        expect(flags.showPricingSection).toBe(false);
      });

      it('should return false when SHOW_PRICING_SECTION is "TRUE" (case sensitive)', () => {
        vi.stubEnv('SHOW_PRICING_SECTION', 'TRUE');

        const flags = getServerFeatureFlags();

        expect(flags.showPricingSection).toBe(false);
      });

      it('should return false when SHOW_PRICING_SECTION is "1"', () => {
        vi.stubEnv('SHOW_PRICING_SECTION', '1');

        const flags = getServerFeatureFlags();

        expect(flags.showPricingSection).toBe(false);
      });
    });

    describe('type safety', () => {
      it('should satisfy ServerFeatureFlags interface', () => {
        const flags = getServerFeatureFlags();

        // TypeScript compile-time check - this assignment should work
        const typedFlags: ServerFeatureFlags = flags;

        expect(typedFlags).toBeDefined();
      });
    });
  });
});
