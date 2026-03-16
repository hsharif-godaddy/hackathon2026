import { describe, expect, it } from 'vitest';

import { getEffectiveCreditsSpent } from '@/utils/credits';

describe('FeedbackForm subscription info calculation', function subscriptionCalculationTests() {
  describe('multiple grants calculation', function multipleGrantsTests() {
    it('should calculate total spent with capping for multiple grants', function testMultipleGrants() {
      const grants = [
        { creditsSpent: 1500, creditsMax: 1500 }, // At limit
        { creditsSpent: 52, creditsMax: 50 },     // Over limit
        { creditsSpent: 30, creditsMax: 250 },    // Under limit
      ];

      const totalSpent = grants.reduce(
        (sum, grant) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
        0
      );
      const totalMax = grants.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);

      // 1500 (capped at 1500) + 50 (capped at 50) + 30 = 1580
      expect(totalSpent).toBe(1580);
      // 1500 + 50 + 250 = 1800
      expect(totalMax).toBe(1800);

      // Display format: "1580/1800" (NOT "220/1800" which would be max - spent)
      const display = `${totalSpent}/${totalMax}`;
      expect(display).toBe('1580/1800');
    });

    it('should handle the original bug scenario from JIRA', function testJiraBugScenario() {
      // Original bug: 52 spent / 50 max was displaying as "-2/50"
      const grants = [
        { creditsSpent: 52, creditsMax: 50 },
      ];

      const totalSpent = grants.reduce(
        (sum, grant) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
        0
      );
      const totalMax = grants.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);

      // Should display "50/50", not "-2/50"
      expect(totalSpent).toBe(50);
      expect(totalMax).toBe(50);

      const display = `${totalSpent}/${totalMax}`;
      expect(display).toBe('50/50');

      // OLD BUG LOGIC (what we fixed):
      // const remaining = totalMax - totalSpent; // 50 - 52 = -2
      // const buggyDisplay = `${remaining}/${totalMax}`; // "-2/50" ❌
      // expect(buggyDisplay).toBe('-2/50'); // This was the bug!
    });

    it('should handle mixed null/undefined values in grants', function testMixedNullValues() {
      const grants = [
        { creditsSpent: null, creditsMax: 100 },
        { creditsSpent: 30, creditsMax: null },
        { creditsSpent: undefined, creditsMax: undefined },
        { creditsSpent: 50, creditsMax: 200 },
      ];

      const totalSpent = grants.reduce(
        (sum, grant) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
        0
      );
      const totalMax = grants.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);

      // 0 + 0 + 0 + 50 = 50
      expect(totalSpent).toBe(50);
      // 100 + 0 + 0 + 200 = 300
      expect(totalMax).toBe(300);
    });
  });
});
