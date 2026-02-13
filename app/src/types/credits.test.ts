import { describe, expect, it } from 'vitest';

import { GRANTS_PAID_PLANS, isPaidPlanForGrants, PAID_PLANS } from '@/lib/paywall/shared';
import { SubscriptionPlan } from './credits';

describe('credits types', function creditsTypesTests() {
  describe('SubscriptionPlan enum', function subscriptionPlanTests() {
    it('should have correct values', function correctValues() {
      expect(SubscriptionPlan.None).toBe('none');
      expect(SubscriptionPlan.AiroPlus).toBe('airoPlus');
      expect(SubscriptionPlan.Free).toBe('free');
      expect(SubscriptionPlan.Starter).toBe('starter');
    });
  });

  describe('PAID_PLANS (legacy - grants disabled)', function paidPlansTests() {
    it('should include Starter and AiroPlus plans', function includesPaidPlans() {
      expect(PAID_PLANS).toContain(SubscriptionPlan.Starter);
      expect(PAID_PLANS).toContain(SubscriptionPlan.AiroPlus);
    });

    it('should not include Free or None plans', function excludesFreePlans() {
      expect(PAID_PLANS).not.toContain(SubscriptionPlan.Free);
      expect(PAID_PLANS).not.toContain(SubscriptionPlan.None);
    });
  });

  describe('GRANTS_PAID_PLANS (grants enabled)', function grantsPaidPlansTests() {
    it('should include Starter, Professional, and Ultimate plans', function includesNewPaidPlans() {
      expect(GRANTS_PAID_PLANS).toContain(SubscriptionPlan.Starter);
      expect(GRANTS_PAID_PLANS).toContain(SubscriptionPlan.Professional);
      expect(GRANTS_PAID_PLANS).toContain(SubscriptionPlan.Ultimate);
      expect(GRANTS_PAID_PLANS).toHaveLength(3);
    });

    it('should not include AiroPlus, Free, or None plans', function excludesOthers() {
      expect(GRANTS_PAID_PLANS).not.toContain(SubscriptionPlan.AiroPlus);
      expect(GRANTS_PAID_PLANS).not.toContain(SubscriptionPlan.Free);
      expect(GRANTS_PAID_PLANS).not.toContain(SubscriptionPlan.None);
    });
  });

  describe('isPaidPlanForGrants', function isPaidPlanForGrantsTests() {
    it('should return true for Starter, Professional, Ultimate regardless of grants flag', function newPaidPlansAlwaysPaid() {
      expect(isPaidPlanForGrants(SubscriptionPlan.Starter, true)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.Starter, false)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.Professional, true)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.Professional, false)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.Ultimate, true)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.Ultimate, false)).toBe(true);
    });

    it('should return true for AiroPlus only when grants is disabled', function airoPlusLegacyOnly() {
      expect(isPaidPlanForGrants(SubscriptionPlan.AiroPlus, false)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.AiroPlus, true)).toBe(false);
    });

    it('should return false for Free and None plans', function freeAndNoneNotPaid() {
      expect(isPaidPlanForGrants(SubscriptionPlan.Free, true)).toBe(false);
      expect(isPaidPlanForGrants(SubscriptionPlan.Free, false)).toBe(false);
      expect(isPaidPlanForGrants(SubscriptionPlan.None, true)).toBe(false);
      expect(isPaidPlanForGrants(SubscriptionPlan.None, false)).toBe(false);
    });

    it('should return false for null or undefined', function handlesNullish() {
      expect(isPaidPlanForGrants(null, true)).toBe(false);
      expect(isPaidPlanForGrants(undefined, false)).toBe(false);
    });
  });
});
