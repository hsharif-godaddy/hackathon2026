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
    it('should return true for Starter, Professional, Ultimate', function newPaidPlansAlwaysPaid() {
      expect(isPaidPlanForGrants(SubscriptionPlan.Starter)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.Professional)).toBe(true);
      expect(isPaidPlanForGrants(SubscriptionPlan.Ultimate)).toBe(true);
    });

    it('should return false for AiroPlus', function airoPlusNotPaid() {
      expect(isPaidPlanForGrants(SubscriptionPlan.AiroPlus)).toBe(false);
    });

    it('should return false for Free and None plans', function freeAndNoneNotPaid() {
      expect(isPaidPlanForGrants(SubscriptionPlan.Free)).toBe(false);
      expect(isPaidPlanForGrants(SubscriptionPlan.None)).toBe(false);
    });

    it('should return false for null or undefined', function handlesNullish() {
      expect(isPaidPlanForGrants(null)).toBe(false);
      expect(isPaidPlanForGrants(undefined)).toBe(false);
    });
  });
});
