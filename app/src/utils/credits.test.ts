import { describe, expect, it } from 'vitest';

import type { CreditGrant } from '@/types/credits';
import { GrantFinalState, GrantType, SubscriptionPlan } from '@/types/credits';
import {
  formatCreditDate,
  formatFullCreditDate,
  getActiveGrant,
  getActiveGrants,
  getBillingPeriod,
  getCreditPackGrants,
  getEffectiveCreditsSpent,
  getMonthlyPlanGrant,
  getPlanDisplayLabelKey,
  getPlanFromSubscription,
  getTotalCreditsFromGrants,
} from '@/utils/credits';

function createMockGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'grant-1',
    subscriptionId: 'sub-1',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 5000,
    creditsSpent: 2500,
    isAvailable: true,
    finalState: null,
    useBefore: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
    consumedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('credits', function creditsTests() {
  describe('#getMonthlyPlanGrant', function getMonthlyPlanGrantTests() {
    it('should return monthly plan grant when present', function returnMonthly() {
      const monthlyGrant = createMockGrant({ id: 'monthly-1', type: GrantType.PlanMonthly });
      const creditPackGrant = createMockGrant({ id: 'pack-1', type: GrantType.CreditPack });
      const grants = [creditPackGrant, monthlyGrant];

      const result = getMonthlyPlanGrant(grants);

      expect(result).toBe(monthlyGrant);
      expect(result?.id).toBe('monthly-1');
    });

    it('should return undefined when no monthly grant exists', function returnUndefined() {
      const grants = [
        createMockGrant({ id: 'pack-1', type: GrantType.CreditPack }),
        createMockGrant({ id: 'pack-2', type: GrantType.CreditPack }),
      ];

      const result = getMonthlyPlanGrant(grants);

      expect(result).toBeUndefined();
    });

    it('should return undefined for empty grants array', function emptyArray() {
      const result = getMonthlyPlanGrant([]);

      expect(result).toBeUndefined();
    });
  });

  describe('#getCreditPackGrants', function getCreditPackGrantsTests() {
    it('should filter only credit pack grants', function filterPacks() {
      const monthlyGrant = createMockGrant({ id: 'monthly-1', type: GrantType.PlanMonthly });
      const creditPackGrant = createMockGrant({ id: 'pack-1', type: GrantType.CreditPack });
      const grants = [monthlyGrant, creditPackGrant];

      const result = getCreditPackGrants(grants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('pack-1');
    });

    it('should sort non-expired grants before expired grants', function sortExpiredLast() {
      const now = new Date();
      const expiredGrant = createMockGrant({
        id: 'expired-1',
        isAvailable: false,
        finalState: GrantFinalState.Expired,
        useBefore: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // yesterday
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        isAvailable: true,
        finalState: null,
        useBefore: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      });
      const grants = [expiredGrant, activeGrant];

      const result = getCreditPackGrants(grants);

      expect(result[0].id).toBe('active-1');
      expect(result[1].id).toBe('expired-1');
    });

    it('should sort by useBefore within same expiration status', function sortByUseBefore() {
      const now = new Date();
      const laterGrant = createMockGrant({
        id: 'later-1',
        useBefore: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days
      });
      const soonerGrant = createMockGrant({
        id: 'sooner-1',
        useBefore: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days
      });
      const grants = [laterGrant, soonerGrant];

      const result = getCreditPackGrants(grants);

      expect(result[0].id).toBe('sooner-1');
      expect(result[1].id).toBe('later-1');
    });

    it('should return empty array when no credit packs exist', function emptyResult() {
      const grants = [createMockGrant({ type: GrantType.PlanMonthly })];

      const result = getCreditPackGrants(grants);

      expect(result).toHaveLength(0);
    });

    it('should treat useBefore: null as non-expired and sort it after dated grants', function nullUseBeforeSortedLast() {
      const now = new Date();
      const nullUseBeforeGrant = createMockGrant({
        id: 'no-expiry-1',
        useBefore: null,
        isAvailable: true,
        finalState: null,
      });
      const soonExpiringGrant = createMockGrant({
        id: 'soon-expiring-1',
        useBefore: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days
        isAvailable: true,
        finalState: null,
      });
      const grants = [nullUseBeforeGrant, soonExpiringGrant];

      const result = getCreditPackGrants(grants);

      expect(result[0].id).toBe('soon-expiring-1');
      expect(result[1].id).toBe('no-expiry-1');
    });

    it('should sort useBefore: null grants before expired grants', function nullUseBeforeBeforeExpired() {
      const now = new Date();
      const nullUseBeforeGrant = createMockGrant({
        id: 'no-expiry-1',
        useBefore: null,
        isAvailable: true,
        finalState: null,
      });
      const expiredGrant = createMockGrant({
        id: 'expired-1',
        useBefore: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // yesterday
        isAvailable: true,
        finalState: null,
      });
      const grants = [expiredGrant, nullUseBeforeGrant];

      const result = getCreditPackGrants(grants);

      expect(result[0].id).toBe('no-expiry-1');
      expect(result[1].id).toBe('expired-1');
    });

    it('should handle two grants with useBefore: null', function twoNullUseBefore() {
      const nullGrant1 = createMockGrant({
        id: 'no-expiry-1',
        useBefore: null,
        isAvailable: true,
        finalState: null,
      });
      const nullGrant2 = createMockGrant({
        id: 'no-expiry-2',
        useBefore: null,
        isAvailable: true,
        finalState: null,
      });
      const grants = [nullGrant1, nullGrant2];

      const result = getCreditPackGrants(grants);

      expect(result).toHaveLength(2);
      // Order is stable (original order preserved)
      expect(result.map((g) => g.id)).toContain('no-expiry-1');
      expect(result.map((g) => g.id)).toContain('no-expiry-2');
    });

    it('should include both addon and standalone credit packs', function includesBoth() {
      const addonPack = createMockGrant({ id: 'addon-1', type: GrantType.CreditPack, creditsMax: 250 });
      const standalonePack = createMockGrant({ id: 'standalone-1', type: GrantType.StandaloneCreditPack, creditsMax: 100 });
      const planGrant = createMockGrant({ id: 'plan-1', type: GrantType.PlanMonthly });
      const grants = [planGrant, addonPack, standalonePack];

      const result = getCreditPackGrants(grants);

      expect(result).toHaveLength(2);
      expect(result.map((g) => g.id)).toContain('addon-1');
      expect(result.map((g) => g.id)).toContain('standalone-1');
    });

    it('should sort consumed BMS grant (useBefore: null, finalState: Consumed) after active grants', function consumedBmsGrantSortedLast() {
      const now = new Date();
      const consumedBmsGrant = createMockGrant({
        id: 'consumed-bms-1',
        useBefore: null,
        isAvailable: false,
        finalState: GrantFinalState.Consumed,
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        useBefore: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        isAvailable: true,
        finalState: null,
      });
      const grants = [consumedBmsGrant, activeGrant];

      const result = getCreditPackGrants(grants);

      expect(result[0].id).toBe('active-1');
      expect(result[1].id).toBe('consumed-bms-1');
    });
  });

  describe('#getActiveGrant', function getActiveGrantTests() {
    it('should return grant with soonest expiration', function returnSoonest() {
      const now = new Date();
      const laterGrant = createMockGrant({
        id: 'later-1',
        useBefore: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const soonerGrant = createMockGrant({
        id: 'sooner-1',
        useBefore: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const grants = [laterGrant, soonerGrant];

      const result = getActiveGrant(grants);

      expect(result?.id).toBe('sooner-1');
    });

    it('should exclude unavailable grants', function excludeUnavailable() {
      const now = new Date();
      const unavailableGrant = createMockGrant({
        id: 'unavailable-1',
        isAvailable: false,
        useBefore: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const availableGrant = createMockGrant({
        id: 'available-1',
        isAvailable: true,
        useBefore: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const grants = [unavailableGrant, availableGrant];

      const result = getActiveGrant(grants);

      expect(result?.id).toBe('available-1');
    });

    it('should exclude grants with finalState', function excludeFinalState() {
      const now = new Date();
      const consumedGrant = createMockGrant({
        id: 'consumed-1',
        finalState: GrantFinalState.Consumed,
        useBefore: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        finalState: null,
        useBefore: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const grants = [consumedGrant, activeGrant];

      const result = getActiveGrant(grants);

      expect(result?.id).toBe('active-1');
    });

    it('should exclude expired grants', function excludeExpired() {
      const now = new Date();
      const expiredGrant = createMockGrant({
        id: 'expired-1',
        useBefore: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // yesterday
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        useBefore: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const grants = [expiredGrant, activeGrant];

      const result = getActiveGrant(grants);

      expect(result?.id).toBe('active-1');
    });

    it('should return undefined when no available grants', function returnUndefined() {
      const now = new Date();
      const expiredGrant = createMockGrant({
        id: 'expired-1',
        useBefore: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      });
      const grants = [expiredGrant];

      const result = getActiveGrant(grants);

      expect(result).toBeUndefined();
    });

    it('should return undefined for empty array', function emptyArray() {
      const result = getActiveGrant([]);

      expect(result).toBeUndefined();
    });
  });

  describe('#getActiveGrants', function getActiveGrantsTests() {
    it('should filter out consumed grants', function filterConsumed() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const consumedGrant = createMockGrant({
        id: 'consumed-1',
        isAvailable: false,
        finalState: GrantFinalState.Consumed,
        useBefore: futureDate,
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        isAvailable: true,
        finalState: null,
        useBefore: futureDate,
      });
      const grants = [consumedGrant, activeGrant];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active-1');
    });

    it('should filter out expired grants by finalState', function filterExpired() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const expiredGrant = createMockGrant({
        id: 'expired-1',
        isAvailable: true,
        finalState: GrantFinalState.Expired,
        useBefore: futureDate,
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        isAvailable: true,
        finalState: null,
        useBefore: futureDate,
      });
      const grants = [expiredGrant, activeGrant];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active-1');
    });

    it('should filter out unavailable grants', function filterUnavailable() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const unavailableGrant = createMockGrant({
        id: 'unavailable-1',
        isAvailable: false,
        finalState: null,
        useBefore: futureDate,
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        isAvailable: true,
        finalState: null,
        useBefore: futureDate,
      });
      const grants = [unavailableGrant, activeGrant];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active-1');
    });

    it('should filter out grants past expiration date', function filterPastExpiration() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const pastDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

      const expiredByDateGrant = createMockGrant({
        id: 'expired-date-1',
        isAvailable: true,
        finalState: null,
        useBefore: pastDate,
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        isAvailable: true,
        finalState: null,
        useBefore: futureDate,
      });
      const grants = [expiredByDateGrant, activeGrant];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active-1');
    });

    it('should return all grants when all are active', function allActive() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const grant1 = createMockGrant({
        id: 'active-1',
        isAvailable: true,
        finalState: null,
        useBefore: futureDate,
      });
      const grant2 = createMockGrant({
        id: 'active-2',
        isAvailable: true,
        finalState: null,
        useBefore: futureDate,
      });
      const grants = [grant1, grant2];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(2);
      expect(result.map((g) => g.id)).toEqual(['active-1', 'active-2']);
    });

    it('should return empty array when all grants are inactive', function allInactive() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const consumedGrant = createMockGrant({
        id: 'consumed-1',
        isAvailable: false,
        finalState: GrantFinalState.Consumed,
        useBefore: futureDate,
      });
      const expiredGrant = createMockGrant({
        id: 'expired-1',
        isAvailable: true,
        finalState: GrantFinalState.Expired,
        useBefore: futureDate,
      });
      const grants = [consumedGrant, expiredGrant];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(0);
    });

    it('should return empty array for empty input', function emptyInput() {
      const result = getActiveGrants([]);

      expect(result).toHaveLength(0);
    });

    it('should include grants with useBefore: null as active (never expires)', function nullUseBeforeActive() {
      const nullUseBeforeGrant = createMockGrant({
        id: 'no-expiry-1',
        useBefore: null,
        isAvailable: true,
        finalState: null,
        creditsSpent: 100,
        creditsMax: 5000,
      });

      const result = getActiveGrants([nullUseBeforeGrant]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('no-expiry-1');
    });

    it('should exclude exhausted grants with useBefore: null', function nullUseBeforeExhausted() {
      const exhaustedBmsGrant = createMockGrant({
        id: 'exhausted-bms-1',
        useBefore: null,
        isAvailable: true,
        finalState: null,
        creditsSpent: 5000,
        creditsMax: 5000,
      });

      const result = getActiveGrants([exhaustedBmsGrant]);

      expect(result).toHaveLength(0);
    });

    it('should handle mixed null and dated useBefore grants', function mixedNullAndDatedUseBefore() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const pastDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

      const nullUseBeforeGrant = createMockGrant({
        id: 'no-expiry-1',
        useBefore: null,
        isAvailable: true,
        finalState: null,
      });
      const futureGrant = createMockGrant({
        id: 'future-1',
        useBefore: futureDate,
        isAvailable: true,
        finalState: null,
      });
      const pastGrant = createMockGrant({
        id: 'past-1',
        useBefore: pastDate,
        isAvailable: true,
        finalState: null,
      });
      const grants = [nullUseBeforeGrant, futureGrant, pastGrant];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(2);
      expect(result.map((g) => g.id)).toContain('no-expiry-1');
      expect(result.map((g) => g.id)).toContain('future-1');
      expect(result.map((g) => g.id)).not.toContain('past-1');
    });

    it('should handle mixed consumed and expired grants correctly', function mixedInactive() {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const grants = [
        createMockGrant({
          id: 'consumed-1',
          isAvailable: false,
          finalState: GrantFinalState.Consumed,
          useBefore: futureDate,
        }),
        createMockGrant({
          id: 'expired-1',
          isAvailable: true,
          finalState: GrantFinalState.Expired,
          useBefore: futureDate,
        }),
        createMockGrant({
          id: 'active-1',
          isAvailable: true,
          finalState: null,
          useBefore: futureDate,
        }),
      ];

      const result = getActiveGrants(grants);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active-1');
    });
  });

  describe('#formatCreditDate', function formatCreditDateTests() {
    it('should format date with short month and day', function formatDate() {
      // Use noon UTC to avoid timezone-related day shifts
      const result = formatCreditDate('2026-02-15T12:00:00.000Z', 'en-US');

      // The result should contain Feb and a day number
      expect(result).toMatch(/Feb\s*\d+/);
    });

    it('should handle different locales', function handleLocale() {
      const resultEN = formatCreditDate('2026-01-15T12:00:00.000Z', 'en-US');
      const resultDE = formatCreditDate('2026-01-15T12:00:00.000Z', 'de-DE');

      expect(resultEN).toMatch(/Jan/);
      expect(resultDE).toMatch(/Jan/);
    });
  });

  describe('#formatFullCreditDate', function formatFullCreditDateTests() {
    it('should format date with full month name and year', function formatFullDate() {
      // Use noon UTC to avoid timezone-related day shifts
      const result = formatFullCreditDate('2026-02-15T12:00:00.000Z', 'en-US');

      expect(result).toMatch(/February.*2026/);
    });
  });

  describe('#getBillingPeriod', function getBillingPeriodTests() {
    it('should return period based on anchor day', function returnPeriod() {
      // Use noon UTC to avoid timezone issues
      const createdAt = '2026-01-15T12:00:00.000Z';
      const anchorDate = new Date(createdAt);
      const expectedAnchorDay = anchorDate.getDate();

      const { periodStart, periodEnd } = getBillingPeriod(createdAt);

      expect(periodStart.getDate()).toBe(expectedAnchorDay);
      expect(periodEnd.getDate()).toBe(expectedAnchorDay);
    });

    it('should return valid date objects', function validDates() {
      const createdAt = '2026-01-10T00:00:00.000Z';

      const { periodStart, periodEnd } = getBillingPeriod(createdAt);

      expect(periodStart).toBeInstanceOf(Date);
      expect(periodEnd).toBeInstanceOf(Date);
      expect(periodEnd.getTime()).toBeGreaterThan(periodStart.getTime());
    });
  });

  describe('#getPlanFromSubscription', function getPlanFromSubscriptionTests() {
    it('should return explicit plan when set', function explicitPlan() {
      const result = getPlanFromSubscription({
        plan: SubscriptionPlan.Starter,
        productId: 'aab-v1',
        isTrial: false,
        hadAiroPlus: true,
      });

      expect(result).toBe(SubscriptionPlan.Starter);
    });

    it('should return AiroPlus for aab-v1 with hadAiroPlus and non-trial', function legacyAiroPlus() {
      const result = getPlanFromSubscription({
        productId: 'aab-v1',
        isTrial: false,
        hadAiroPlus: true,
      });

      expect(result).toBe(SubscriptionPlan.AiroPlus);
    });

    it('should return None for aab-v1 with hadAiroPlus and trial', function legacyTrial() {
      const result = getPlanFromSubscription({
        productId: 'aab-v1',
        isTrial: true,
        hadAiroPlus: true,
      });

      expect(result).toBe(SubscriptionPlan.None);
    });

    it('should return None for aab-v1 without hadAiroPlus', function noHadAiroPlus() {
      const result = getPlanFromSubscription({
        productId: 'aab-v1',
        isTrial: false,
      });

      expect(result).toBe(SubscriptionPlan.None);
    });

    it('should return None for aab-v1 with hadAiroPlus false', function hadAiroPlusFalse() {
      const result = getPlanFromSubscription({
        productId: 'aab-v1',
        isTrial: false,
        hadAiroPlus: false,
      });

      expect(result).toBe(SubscriptionPlan.None);
    });

    it('should return None when no plan and non-aab-v1 product', function unknownProduct() {
      const result = getPlanFromSubscription({
        productId: 'other-product',
        isTrial: false,
        hadAiroPlus: true,
      });

      expect(result).toBe(SubscriptionPlan.None);
    });

    it('should return Ultimate for an aab-ent-v1 subscription with no plan field', function entFallback() {
      // Post-mhp-core#749, enterprise subs may surface to the BFF without a
      // `plan` field. Map them to Ultimate so plan-aware UI treats the
      // member as on the top tier: `isPaidPlanForGrants(Ultimate)` is true
      // and `canUpgradePlan(Ultimate)` is false. The enterprise-aware UI
      // gates (`useEnterpriseManaged`, `useIsEnterpriseUser`) still take
      // precedence; this mapping is the safe fallback for code that reads
      // the plan directly.
      const result = getPlanFromSubscription({
        productId: 'aab-ent-v1',
        isTrial: false,
        hadAiroPlus: false,
      });

      expect(result).toBe(SubscriptionPlan.Ultimate);
    });

    it('should honor an explicit plan field on an aab-ent-v1 subscription', function entWithExplicitPlan() {
      // The early-return on `subscription.plan` wins — the ent fallback
      // never fires when the backend has set a plan.
      const result = getPlanFromSubscription({
        productId: 'aab-ent-v1',
        plan: SubscriptionPlan.Professional,
        isTrial: false,
        hadAiroPlus: false,
      });

      expect(result).toBe(SubscriptionPlan.Professional);
    });
  });

  describe('#getPlanDisplayLabelKey', function getPlanDisplayLabelKeyTests() {
    it('should return correct key for AiroPlus plan', function airoPlus() {
      const result = getPlanDisplayLabelKey(SubscriptionPlan.AiroPlus);

      expect(result).toBe('builder_manageplan_plan_airo_plus');
    });

    it('should return correct key for Starter plan', function starter() {
      const result = getPlanDisplayLabelKey(SubscriptionPlan.Starter);

      expect(result).toBe('builder_manageplan_plan_starter');
    });

    it('should return correct key for Free plan', function free() {
      const result = getPlanDisplayLabelKey(SubscriptionPlan.Free);

      expect(result).toBe('builder_manageplan_plan_free');
    });

    it('should return empty string for None plan', function none() {
      const result = getPlanDisplayLabelKey(SubscriptionPlan.None);

      expect(result).toBe('');
    });
  });

  describe('#getTotalCreditsFromGrants', function getTotalCreditsFromGrantsTests() {
    it('should sum credits across all grants including fully exhausted ones', function includesExhausted() {
      // Reproduces the bug: user has an exhausted plan grant plus a partially-used
      // credit pack. The popover shows 687/800, so the gauge must also see 687/800.
      const planGrant = createMockGrant({
        id: 'plan-1',
        type: GrantType.PlanMonthly,
        creditsSpent: 500,
        creditsMax: 500,
      });
      const creditPack = createMockGrant({
        id: 'pack-1',
        type: GrantType.CreditPack,
        creditsSpent: 187,
        creditsMax: 300,
      });

      const result = getTotalCreditsFromGrants([planGrant, creditPack]);

      expect(result.totalCreditsSpent).toBe(687);
      expect(result.totalCreditsMax).toBe(800);
    });

    it('should cap spent per-grant via getEffectiveCreditsSpent', function capsPerGrantSpent() {
      const overspentGrant = createMockGrant({
        id: 'overspent-1',
        creditsSpent: 6000,
        creditsMax: 5000,
      });
      const normalGrant = createMockGrant({
        id: 'normal-1',
        creditsSpent: 100,
        creditsMax: 1000,
      });

      const result = getTotalCreditsFromGrants([overspentGrant, normalGrant]);

      // Overspent grant contributes 5000 (capped), not 6000
      expect(result.totalCreditsSpent).toBe(5100);
      expect(result.totalCreditsMax).toBe(6000);
    });

    it('should return zeros for empty grants array', function emptyArray() {
      const result = getTotalCreditsFromGrants([]);

      expect(result.totalCreditsSpent).toBe(0);
      expect(result.totalCreditsMax).toBe(0);
    });

    it('should return zeros for undefined grants', function undefinedGrants() {
      const result = getTotalCreditsFromGrants(undefined);

      expect(result.totalCreditsSpent).toBe(0);
      expect(result.totalCreditsMax).toBe(0);
    });

    it('should return zeros for null grants', function nullGrants() {
      const result = getTotalCreditsFromGrants(null);

      expect(result.totalCreditsSpent).toBe(0);
      expect(result.totalCreditsMax).toBe(0);
    });

    it('should include expired and consumed grants (matches popover display)', function includesFinalState() {
      const now = new Date();
      const expiredGrant = createMockGrant({
        id: 'expired-1',
        finalState: GrantFinalState.Expired,
        useBefore: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        creditsSpent: 100,
        creditsMax: 500,
      });
      const consumedGrant = createMockGrant({
        id: 'consumed-1',
        finalState: GrantFinalState.Consumed,
        isAvailable: false,
        creditsSpent: 250,
        creditsMax: 250,
      });
      const activeGrant = createMockGrant({
        id: 'active-1',
        finalState: null,
        isAvailable: true,
        creditsSpent: 50,
        creditsMax: 500,
      });

      const result = getTotalCreditsFromGrants([expiredGrant, consumedGrant, activeGrant]);

      expect(result.totalCreditsSpent).toBe(400);
      expect(result.totalCreditsMax).toBe(1250);
    });

    it('should tolerate grants with null creditsMax', function nullMax() {
      const brokenGrant = createMockGrant({
        id: 'broken-1',
        creditsSpent: null,
        creditsMax: null,
      });
      const goodGrant = createMockGrant({
        id: 'good-1',
        creditsSpent: 100,
        creditsMax: 500,
      });

      const result = getTotalCreditsFromGrants([brokenGrant, goodGrant]);

      expect(result.totalCreditsSpent).toBe(100);
      expect(result.totalCreditsMax).toBe(500);
    });

    it('should aggregate plan-monthly, addon credit-pack, and standalone credit-pack grants', function aggregateAll() {
      const planGrant = createMockGrant({
        id: 'plan-1',
        type: GrantType.PlanMonthly,
        creditsSpent: 300,
        creditsMax: 500,
      });
      const addonPack = createMockGrant({
        id: 'addon-pack-1',
        type: GrantType.CreditPack,
        creditsSpent: 100,
        creditsMax: 250,
      });
      const standalonePack = createMockGrant({
        id: 'standalone-pack-1',
        type: GrantType.StandaloneCreditPack,
        creditsSpent: 50,
        creditsMax: 100,
      });

      const result = getTotalCreditsFromGrants([planGrant, addonPack, standalonePack]);

      expect(result.totalCreditsSpent).toBe(450);
      expect(result.totalCreditsMax).toBe(850);
    });
  });

  describe('#getEffectiveCreditsSpent', function getEffectiveCreditsSpentTests() {
    it('should return creditsSpent when less than creditsMax', function spentLessThanMax() {
      const result = getEffectiveCreditsSpent(2500, 5000);

      expect(result).toBe(2500);
    });

    it('should return creditsMax when creditsSpent exceeds creditsMax', function spentExceedsMax() {
      const result = getEffectiveCreditsSpent(6000, 5000);

      expect(result).toBe(5000);
    });

    it('should return creditsMax when creditsSpent equals creditsMax', function spentEqualsMax() {
      const result = getEffectiveCreditsSpent(5000, 5000);

      expect(result).toBe(5000);
    });

    it('should return 0 when creditsSpent is 0', function spentIsZero() {
      const result = getEffectiveCreditsSpent(0, 5000);

      expect(result).toBe(0);
    });

    it('should return 0 when both values are null', function bothNull() {
      const result = getEffectiveCreditsSpent(null, null);

      expect(result).toBe(0);
    });

    it('should return 0 when both values are undefined', function bothUndefined() {
      const result = getEffectiveCreditsSpent(undefined, undefined);

      expect(result).toBe(0);
    });

    it('should treat null creditsSpent as 0', function nullSpent() {
      const result = getEffectiveCreditsSpent(null, 5000);

      expect(result).toBe(0);
    });

    it('should treat undefined creditsSpent as 0', function undefinedSpent() {
      const result = getEffectiveCreditsSpent(undefined, 5000);

      expect(result).toBe(0);
    });

    it('should return 0 when creditsMax is null and creditsSpent is positive', function nullMax() {
      const result = getEffectiveCreditsSpent(2500, null);

      expect(result).toBe(0);
    });

    it('should return 0 when creditsMax is 0', function maxIsZero() {
      const result = getEffectiveCreditsSpent(100, 0);

      expect(result).toBe(0);
    });
  });
});
