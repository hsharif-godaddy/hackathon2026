import { describe, expect, it } from 'vitest';

import { PAID_PLANS, SubscriptionPlan } from './credits';

describe('credits types', function creditsTypesTests() {
  describe('PAID_PLANS', function paidPlansTests() {
    it('should include Starter plan', function includesStarter() {
      expect(PAID_PLANS).toContain(SubscriptionPlan.Starter);
    });

    it('should not include Free plan', function excludesFree() {
      expect(PAID_PLANS).not.toContain(SubscriptionPlan.Free);
    });

    it('should not include None plan', function excludesNone() {
      expect(PAID_PLANS).not.toContain(SubscriptionPlan.None);
    });

    it('should be usable with includes() for plan checking', function includesCheck() {
      expect(PAID_PLANS.includes(SubscriptionPlan.Starter)).toBe(true);
      expect(PAID_PLANS.includes(SubscriptionPlan.Free)).toBe(false);
      expect(PAID_PLANS.includes(SubscriptionPlan.None)).toBe(false);
    });

    it('should be an array', function isArray() {
      expect(Array.isArray(PAID_PLANS)).toBe(true);
    });
  });

  describe('SubscriptionPlan enum', function subscriptionPlanTests() {
    it('should have correct values', function correctValues() {
      expect(SubscriptionPlan.None).toBe('none');
      expect(SubscriptionPlan.AiroPlus).toBe('airoPlus');
      expect(SubscriptionPlan.Free).toBe('free');
      expect(SubscriptionPlan.Starter).toBe('starter');
    });
  });
});
