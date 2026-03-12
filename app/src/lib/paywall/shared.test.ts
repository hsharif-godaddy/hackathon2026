import { describe, expect, it } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';
import {
  canUpgradePlan,
  GRANTS_PAID_PLANS,
  isMatchingProject,
  isPaidPlan,
  isPaidPlanForGrants,
  isPlanUpgrade,
  isProfessionalOrAbove,
  PAID_PLANS,
  PAYWALL_CONFIG,
  PAYWALL_ITC,
  PLAN_PRIORITY,
  PROFESSIONAL_AND_ABOVE_PLANS,
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

  describe('canUpgradePlan', function canUpgradePlanTests() {
    describe('when higher plans flag is OFF (legacy)', function flagOff() {
      it('should return true for Free and None plans', function freeAndNoneCanUpgrade() {
        expect(canUpgradePlan(SubscriptionPlan.Free, false)).toBe(true);
        expect(canUpgradePlan(SubscriptionPlan.None, false)).toBe(true);
      });

      it('should return false for paid plans', function paidPlansCannotUpgrade() {
        expect(canUpgradePlan(SubscriptionPlan.Starter, false)).toBe(false);
        expect(canUpgradePlan(SubscriptionPlan.Professional, false)).toBe(false);
        expect(canUpgradePlan(SubscriptionPlan.Ultimate, false)).toBe(false);
        expect(canUpgradePlan(SubscriptionPlan.AiroPlus, false)).toBe(false);
      });
    });

    describe('when higher plans flag is ON', function flagOn() {
      it('should return true for all non-Ultimate plans', function nonUltimateTrue() {
        expect(canUpgradePlan(SubscriptionPlan.Free, true)).toBe(true);
        expect(canUpgradePlan(SubscriptionPlan.Starter, true)).toBe(true);
        expect(canUpgradePlan(SubscriptionPlan.Professional, true)).toBe(true);
        expect(canUpgradePlan(SubscriptionPlan.AiroPlus, true)).toBe(true);
        expect(canUpgradePlan(SubscriptionPlan.None, true)).toBe(true);
      });

      it('should return false for Ultimate plan', function ultimateFalse() {
        expect(canUpgradePlan(SubscriptionPlan.Ultimate, true)).toBe(false);
      });
    });

    it('should return true for null or undefined (no plan = show upgrade)', function handlesNullish() {
      expect(canUpgradePlan(null, true)).toBe(true);
      expect(canUpgradePlan(undefined, true)).toBe(true);
      expect(canUpgradePlan(null, false)).toBe(true);
      expect(canUpgradePlan(undefined, false)).toBe(true);
    });
  });

  describe('PROFESSIONAL_AND_ABOVE_PLANS', function professionalAndAbovePlansTests() {
    it('should include Professional and Ultimate', function includesCorrectPlans() {
      expect(PROFESSIONAL_AND_ABOVE_PLANS).toContain(SubscriptionPlan.Professional);
      expect(PROFESSIONAL_AND_ABOVE_PLANS).toContain(SubscriptionPlan.Ultimate);
    });

    it('should have exactly 2 plans', function exactCount() {
      expect(PROFESSIONAL_AND_ABOVE_PLANS).toHaveLength(2);
    });

    it('should not include lower-tier plans', function excludesLowerTiers() {
      expect(PROFESSIONAL_AND_ABOVE_PLANS).not.toContain(SubscriptionPlan.Free);
      expect(PROFESSIONAL_AND_ABOVE_PLANS).not.toContain(SubscriptionPlan.Starter);
      expect(PROFESSIONAL_AND_ABOVE_PLANS).not.toContain(SubscriptionPlan.AiroPlus);
      expect(PROFESSIONAL_AND_ABOVE_PLANS).not.toContain(SubscriptionPlan.None);
    });
  });

  describe('isProfessionalOrAbove', function isProfessionalOrAboveTests() {
    it('should return true for Professional and Ultimate', function professionalAndUltimate() {
      expect(isProfessionalOrAbove(SubscriptionPlan.Professional)).toBe(true);
      expect(isProfessionalOrAbove(SubscriptionPlan.Ultimate)).toBe(true);
    });

    it('should return false for lower-tier plans', function lowerTiers() {
      expect(isProfessionalOrAbove(SubscriptionPlan.Free)).toBe(false);
      expect(isProfessionalOrAbove(SubscriptionPlan.Starter)).toBe(false);
      expect(isProfessionalOrAbove(SubscriptionPlan.AiroPlus)).toBe(false);
      expect(isProfessionalOrAbove(SubscriptionPlan.None)).toBe(false);
    });

    it('should return false for null or undefined', function handlesNullish() {
      expect(isProfessionalOrAbove(null)).toBe(false);
      expect(isProfessionalOrAbove(undefined)).toBe(false);
    });
  });

  describe('PAYWALL_ITC', function paywallItcTests() {
    it('should have correct ITC values', function correctItcValues() {
      expect(PAYWALL_ITC.PUBLISH).toBe('upp_airo_ai_builder_publish');
      expect(PAYWALL_ITC.UPGRADE).toBe('upp_airo_ai_builder_upgrade');
      expect(PAYWALL_ITC.CREDITS).toBe('upp_airo_ai_Builder_credit');
    });
  });

  describe('isPlanUpgrade', function isPlanUpgradeTests() {
    it('should return true for upgrades (Starter -> Professional)', function starterToProfessional() {
      expect(isPlanUpgrade(SubscriptionPlan.Starter, SubscriptionPlan.Professional)).toBe(true);
    });

    it('should return true for upgrades (Starter -> Ultimate)', function starterToUltimate() {
      expect(isPlanUpgrade(SubscriptionPlan.Starter, SubscriptionPlan.Ultimate)).toBe(true);
    });

    it('should return true for upgrades (Professional -> Ultimate)', function professionalToUltimate() {
      expect(isPlanUpgrade(SubscriptionPlan.Professional, SubscriptionPlan.Ultimate)).toBe(true);
    });

    it('should return true for upgrades (Free -> Starter)', function freeToStarter() {
      expect(isPlanUpgrade(SubscriptionPlan.Free, SubscriptionPlan.Starter)).toBe(true);
    });

    it('should return false for downgrades (Professional -> Starter)', function professionalToStarter() {
      expect(isPlanUpgrade(SubscriptionPlan.Professional, SubscriptionPlan.Starter)).toBe(false);
    });

    it('should return false for downgrades (Ultimate -> Professional)', function ultimateToProfessional() {
      expect(isPlanUpgrade(SubscriptionPlan.Ultimate, SubscriptionPlan.Professional)).toBe(false);
    });

    it('should return false for downgrades (Ultimate -> Starter)', function ultimateToStarter() {
      expect(isPlanUpgrade(SubscriptionPlan.Ultimate, SubscriptionPlan.Starter)).toBe(false);
    });

    it('should return false for same plan (no change)', function samePlan() {
      expect(isPlanUpgrade(SubscriptionPlan.Starter, SubscriptionPlan.Starter)).toBe(false);
      expect(isPlanUpgrade(SubscriptionPlan.Professional, SubscriptionPlan.Professional)).toBe(false);
      expect(isPlanUpgrade(SubscriptionPlan.Ultimate, SubscriptionPlan.Ultimate)).toBe(false);
    });

    it('should return false for null or undefined old plan', function handlesNullOldPlan() {
      expect(isPlanUpgrade(null, SubscriptionPlan.Starter)).toBe(false);
      expect(isPlanUpgrade(undefined, SubscriptionPlan.Starter)).toBe(false);
    });

    it('should return false for null or undefined new plan', function handlesNullNewPlan() {
      expect(isPlanUpgrade(SubscriptionPlan.Starter, null)).toBe(false);
      expect(isPlanUpgrade(SubscriptionPlan.Starter, undefined)).toBe(false);
    });

    it('should handle string plan values', function handlesStringPlans() {
      // Enum values are lowercase: 'starter', 'professional', 'ultimate'
      expect(isPlanUpgrade('starter', 'professional')).toBe(true);
      expect(isPlanUpgrade('professional', 'starter')).toBe(false);
    });
  });
});
