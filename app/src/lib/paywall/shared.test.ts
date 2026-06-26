import { describe, expect, it } from 'vitest';

import { SubscriptionPlan } from '@/types/credits';
import {
  canUpgradePlan,
  GRANTS_PAID_PLANS,
  hasActivePaidPlan,
  isPaidPlan,
  isPaidPlanForGrants,
  isPlanUpgrade,
  isProfessionalOrAbove,
  isStarterOrAbove,
  landingItc,
  PAID_PLANS,
  PAYWALL_ITC,
  PLAN_PRIORITY,
  PROFESSIONAL_AND_ABOVE_PLANS,
  STARTER_AND_ABOVE_PLANS,
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

  describe('canUpgradePlan', function canUpgradePlanTests() {
    it('should return true for all non-Ultimate plans', function nonUltimateTrue() {
      expect(canUpgradePlan(SubscriptionPlan.Free)).toBe(true);
      expect(canUpgradePlan(SubscriptionPlan.Starter)).toBe(true);
      expect(canUpgradePlan(SubscriptionPlan.Professional)).toBe(true);
      expect(canUpgradePlan(SubscriptionPlan.AiroPlus)).toBe(true);
      expect(canUpgradePlan(SubscriptionPlan.None)).toBe(true);
    });

    it('should return false for Ultimate plan', function ultimateFalse() {
      expect(canUpgradePlan(SubscriptionPlan.Ultimate)).toBe(false);
    });

    it('should return true for null or undefined (no plan = show upgrade)', function handlesNullish() {
      expect(canUpgradePlan(null)).toBe(true);
      expect(canUpgradePlan(undefined)).toBe(true);
    });
  });

  describe('STARTER_AND_ABOVE_PLANS', function starterAndAbovePlansTests() {
    it('should include Starter, Professional, and Ultimate', function includesCorrectPlans() {
      expect(STARTER_AND_ABOVE_PLANS).toContain(SubscriptionPlan.Starter);
      expect(STARTER_AND_ABOVE_PLANS).toContain(SubscriptionPlan.Professional);
      expect(STARTER_AND_ABOVE_PLANS).toContain(SubscriptionPlan.Ultimate);
    });

    it('should have exactly 3 plans', function exactCount() {
      expect(STARTER_AND_ABOVE_PLANS).toHaveLength(3);
    });

    it('should not include lower-tier plans', function excludesLowerTiers() {
      expect(STARTER_AND_ABOVE_PLANS).not.toContain(SubscriptionPlan.Free);
      expect(STARTER_AND_ABOVE_PLANS).not.toContain(SubscriptionPlan.AiroPlus);
      expect(STARTER_AND_ABOVE_PLANS).not.toContain(SubscriptionPlan.None);
    });
  });

  describe('isStarterOrAbove', function isStarterOrAboveTests() {
    it('should return true for Starter, Professional, and Ultimate', function starterAndAbove() {
      expect(isStarterOrAbove(SubscriptionPlan.Starter)).toBe(true);
      expect(isStarterOrAbove(SubscriptionPlan.Professional)).toBe(true);
      expect(isStarterOrAbove(SubscriptionPlan.Ultimate)).toBe(true);
    });

    it('should return false for lower-tier plans', function lowerTiers() {
      expect(isStarterOrAbove(SubscriptionPlan.Free)).toBe(false);
      expect(isStarterOrAbove(SubscriptionPlan.AiroPlus)).toBe(false);
      expect(isStarterOrAbove(SubscriptionPlan.None)).toBe(false);
    });

    it('should return false for null or undefined', function handlesNullish() {
      expect(isStarterOrAbove(null)).toBe(false);
      expect(isStarterOrAbove(undefined)).toBe(false);
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
      expect(PAYWALL_ITC.BUILD_A_THON_PROMPT_SUBMISSION).toBe(
        'airo-build-a-thon-prompt-submission',
      );
      expect(PAYWALL_ITC.PUBLISH).toBe('upp_airo_ai_builder_publish');
      expect(PAYWALL_ITC.UPGRADE).toBe('upp_airo_ai_builder_upgrade');
      expect(PAYWALL_ITC.CREDITS).toBe('upp_airo_ai_Builder_credit');
      expect(PAYWALL_ITC.DOMAIN_PURCHASE).toBe('airo_ai_builder_domain_purchase');
      expect(PAYWALL_ITC.DOMAIN_EXPEDITE_PURCHASE).toBe(
        'airo_ai_builder_domain_expedite_purchase',
      );
      expect(PAYWALL_ITC.ATTACH_DOMAIN).toBe('airo_ai_builder_attach_domain');
    });
  });

  describe('#landingItc', function landingItcTests() {
    it('should return campaign ITC for mapped useCase', function buildathon() {
      expect(landingItc('airo-build-a-thon')).toBe(
        PAYWALL_ITC.BUILD_A_THON_PROMPT_SUBMISSION,
      );
    });

    it('should return null for unmapped useCase', function unmapped() {
      expect(landingItc('games')).toBeNull();
    });

    it('should return null for empty useCase', function emptyUseCase() {
      expect(landingItc('')).toBeNull();
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

  describe('hasActivePaidPlan', function hasActivePaidPlanTests() {
    it('returns true for an active grants-paid plan', function activePaid() {
      expect(hasActivePaidPlan({ status: 'active', plan: SubscriptionPlan.Ultimate })).toBe(true);
      expect(hasActivePaidPlan({ status: 'active', plan: SubscriptionPlan.Starter })).toBe(true);
    });

    it('returns false when status is not active', function inactivePaid() {
      expect(hasActivePaidPlan({ status: 'cancelled', plan: SubscriptionPlan.Ultimate })).toBe(false);
      expect(hasActivePaidPlan({ status: 'suspended', plan: SubscriptionPlan.Starter })).toBe(false);
    });

    it('returns false for non-grants-paid plans even when active', function activeUnpaid() {
      expect(hasActivePaidPlan({ status: 'active', plan: SubscriptionPlan.Free })).toBe(false);
      expect(hasActivePaidPlan({ status: 'active', plan: SubscriptionPlan.AiroPlus })).toBe(false);
    });

    it('returns false for null/undefined subscription or missing plan', function missing() {
      expect(hasActivePaidPlan(null)).toBe(false);
      expect(hasActivePaidPlan(undefined)).toBe(false);
      expect(hasActivePaidPlan({ status: 'active' })).toBe(false);
      expect(hasActivePaidPlan({ status: 'active', plan: null })).toBe(false);
    });
  });
});
