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
      expect(flags).toHaveProperty('showHighTierPlans');
    });

    it('should return correct types for all flags', () => {
      const flags = getServerFeatureFlags();

      expect(typeof flags.showPricingSection).toBe('boolean');
      expect(typeof flags.showHighTierPlans).toBe('boolean');
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

    describe('showHighTierPlans', () => {
      it('should return true when SHOW_HIGH_TIER_PLANS is "true"', () => {
        vi.stubEnv('SHOW_HIGH_TIER_PLANS', 'true');

        const flags = getServerFeatureFlags();

        expect(flags.showHighTierPlans).toBe(true);
      });

      it('should return false when SHOW_HIGH_TIER_PLANS is "false"', () => {
        vi.stubEnv('SHOW_HIGH_TIER_PLANS', 'false');

        const flags = getServerFeatureFlags();

        expect(flags.showHighTierPlans).toBe(false);
      });

      it('should return false when SHOW_HIGH_TIER_PLANS is undefined', () => {
        vi.stubEnv('SHOW_HIGH_TIER_PLANS', undefined);

        const flags = getServerFeatureFlags();

        expect(flags.showHighTierPlans).toBe(false);
      });

      it('should return false when SHOW_HIGH_TIER_PLANS is empty string', () => {
        vi.stubEnv('SHOW_HIGH_TIER_PLANS', '');

        const flags = getServerFeatureFlags();

        expect(flags.showHighTierPlans).toBe(false);
      });

      it('should return false when SHOW_HIGH_TIER_PLANS is "TRUE" (case sensitive)', () => {
        vi.stubEnv('SHOW_HIGH_TIER_PLANS', 'TRUE');

        const flags = getServerFeatureFlags();

        expect(flags.showHighTierPlans).toBe(false);
      });

      it('should return false when SHOW_HIGH_TIER_PLANS is "1"', () => {
        vi.stubEnv('SHOW_HIGH_TIER_PLANS', '1');

        const flags = getServerFeatureFlags();

        expect(flags.showHighTierPlans).toBe(false);
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
