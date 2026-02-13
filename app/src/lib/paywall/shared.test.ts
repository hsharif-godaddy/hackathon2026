import { describe, expect, it } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';
import {
  GRANTS_PAID_PLANS,
  isMatchingProject,
  isPaidPlan,
  isPaidPlanForGrants,
  PAID_PLANS,
  PAYWALL_CONFIG,
  PAYWALL_ITC,
  PLAN_PRIORITY,
} from './shared';

describe('paywall/shared', function paywallSharedTests() {
  describe('PAID_PLANS (legacy - grants disabled)', function paidPlansTests() {
    it('should include all paid plans', function includesPaidPlans() {
      expect(PAID_PLANS).toContain(SubscriptionPlan.Starter);
      expect(PAID_PLANS).toContain(SubscriptionPlan.Professional);
      expect(PAID_PLANS).toContain(SubscriptionPlan.Ultimate);
      expect(PAID_PLANS).toContain(SubscriptionPlan.AiroPlus);
    });

    it('should not include Free or None plans', function excludesFreePlans() {
      expect(PAID_PLANS).not.toContain(SubscriptionPlan.Free);
      expect(PAID_PLANS).not.toContain(SubscriptionPlan.None);
    });

    it('should have exactly 4 plans', function exactCount() {
      expect(PAID_PLANS).toHaveLength(4);
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

  describe('isPaidPlan', function isPaidPlanTests() {
    it('should return true for all paid plans', function paidPlansTrue() {
      expect(isPaidPlan(SubscriptionPlan.Starter)).toBe(true);
      expect(isPaidPlan(SubscriptionPlan.Professional)).toBe(true);
      expect(isPaidPlan(SubscriptionPlan.Ultimate)).toBe(true);
      expect(isPaidPlan(SubscriptionPlan.AiroPlus)).toBe(true);
    });

    it('should return false for Free and None', function freePlansFalse() {
      expect(isPaidPlan(SubscriptionPlan.Free)).toBe(false);
      expect(isPaidPlan(SubscriptionPlan.None)).toBe(false);
    });

    it('should return false for null or undefined', function handlesNullish() {
      expect(isPaidPlan(null)).toBe(false);
      expect(isPaidPlan(undefined)).toBe(false);
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
      expect(isPaidPlanForGrants(null, false)).toBe(false);
      expect(isPaidPlanForGrants(undefined, true)).toBe(false);
      expect(isPaidPlanForGrants(undefined, false)).toBe(false);
    });
  });

  describe('PLAN_PRIORITY', function planPriorityTests() {
    it('should rank Ultimate highest', function ultimateHighest() {
      expect(PLAN_PRIORITY[SubscriptionPlan.Ultimate]).toBeGreaterThan(PLAN_PRIORITY[SubscriptionPlan.Professional]);
      expect(PLAN_PRIORITY[SubscriptionPlan.Ultimate]).toBeGreaterThan(PLAN_PRIORITY[SubscriptionPlan.Starter]);
      expect(PLAN_PRIORITY[SubscriptionPlan.Ultimate]).toBeGreaterThan(PLAN_PRIORITY[SubscriptionPlan.Free]);
    });

    it('should rank Professional above Starter', function professionalAboveStarter() {
      expect(PLAN_PRIORITY[SubscriptionPlan.Professional]).toBeGreaterThan(PLAN_PRIORITY[SubscriptionPlan.Starter]);
    });

    it('should rank Starter above Free and AiroPlus', function starterAboveFreeAndAiroPlus() {
      expect(PLAN_PRIORITY[SubscriptionPlan.Starter]).toBeGreaterThan(PLAN_PRIORITY[SubscriptionPlan.Free]);
      expect(PLAN_PRIORITY[SubscriptionPlan.Starter]).toBeGreaterThan(PLAN_PRIORITY[SubscriptionPlan.AiroPlus]);
    });

    it('should rank Free above AiroPlus', function freeAboveAiroPlus() {
      expect(PLAN_PRIORITY[SubscriptionPlan.Free]).toBeGreaterThan(PLAN_PRIORITY[SubscriptionPlan.AiroPlus]);
    });

    it('should rank None lowest', function noneLowest() {
      expect(PLAN_PRIORITY[SubscriptionPlan.None]).toBeLessThan(PLAN_PRIORITY[SubscriptionPlan.Free]);
      expect(PLAN_PRIORITY[SubscriptionPlan.None]).toBeLessThan(PLAN_PRIORITY[SubscriptionPlan.AiroPlus]);
      expect(PLAN_PRIORITY[SubscriptionPlan.None]).toBeLessThan(PLAN_PRIORITY[SubscriptionPlan.Starter]);
    });
  });

  describe('isMatchingProject', function isMatchingProjectTests() {
    it('should return true for matching Airo Plus project', function matchingProject() {
      const node = {
        group: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.GROUP,
        status: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.STATUS,
        billing: {
          id: 'billing-123',
          plan: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.PLAN,
        },
      };
      expect(isMatchingProject(node)).toBe(true);
    });

    it('should return false for non-matching group', function nonMatchingGroup() {
      const node = {
        group: 'other-group',
        status: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.STATUS,
        billing: {
          id: 'billing-123',
          plan: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.PLAN,
        },
      };
      expect(isMatchingProject(node)).toBe(false);
    });

    it('should return false for non-matching status', function nonMatchingStatus() {
      const node = {
        group: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.GROUP,
        status: 'INACTIVE',
        billing: {
          id: 'billing-123',
          plan: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.PLAN,
        },
      };
      expect(isMatchingProject(node)).toBe(false);
    });

    it('should return false for missing billing', function missingBilling() {
      const node = {
        group: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.GROUP,
        status: PAYWALL_CONFIG.PROJECT_MATCH_CRITERIA.STATUS,
      };
      expect(isMatchingProject(node)).toBe(false);
    });
  });

  describe('PAYWALL_ITC', function paywallItcTests() {
    it('should have correct ITC values', function correctItcValues() {
      expect(PAYWALL_ITC.PUBLISH).toBe('upp_airo_ai_builder_publish');
      expect(PAYWALL_ITC.UPGRADE).toBe('upp_airo_ai_builder_upgrade');
      expect(PAYWALL_ITC.CREDITS).toBe('upp_airo_ai_Builder_credit');
    });
  });
});
