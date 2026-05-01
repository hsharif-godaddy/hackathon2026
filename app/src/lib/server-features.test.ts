import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const checkSwitchboardFlag = vi.fn();
vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: (...args: unknown[]) => checkSwitchboardFlag(...args),
}));

import { getServerFeatureFlags, type ServerFeatureFlags } from './server-features';

const req = { headers: new Headers() };

describe('server-features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkSwitchboardFlag.mockResolvedValue(false);
  });

  describe('getServerFeatureFlags', () => {
    it('should return all expected feature flag keys', async () => {
      const flags = await getServerFeatureFlags(req);

      // Verify the shape of the returned object
      expect(flags).toHaveProperty('showPricingSection');
    });

    it('should return correct types for all flags', async () => {
      const flags = await getServerFeatureFlags(req);

      expect(typeof flags.showPricingSection).toBe('boolean');
    });

    describe('showPricingSection', () => {
      it('should return true when Switchboard flag is true', async () => {
        checkSwitchboardFlag.mockResolvedValue(true);

        const flags = await getServerFeatureFlags(req);

        expect(flags.showPricingSection).toBe(true);
        expect(checkSwitchboardFlag).toHaveBeenCalledWith('appbuilder-pricing-section', req);
      });

      it('should return false when Switchboard flag is false', async () => {
        checkSwitchboardFlag.mockResolvedValue(false);

        const flags = await getServerFeatureFlags(req);

        expect(flags.showPricingSection).toBe(false);
      });

      it('should fail closed when Switchboard lookup fails', async () => {
        checkSwitchboardFlag.mockRejectedValue(new Error('boom'));

        const flags = await getServerFeatureFlags(req);

        expect(flags.showPricingSection).toBe(false);
      });
    });

    describe('type safety', () => {
      it('should satisfy ServerFeatureFlags interface', async () => {
        const flags = await getServerFeatureFlags(req);

        // TypeScript compile-time check - this assignment should work
        const typedFlags: ServerFeatureFlags = flags;

        expect(typedFlags).toBeDefined();
      });
    });
  });
});
