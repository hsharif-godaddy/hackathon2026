import { describe, expect, it } from 'vitest';

import type { CreditGrant } from '@/types/credits';
import { GrantFinalState, GrantType, SubscriptionPlan } from '@/types/credits';
import {
  formatCreditDate,
  formatFullCreditDate,
  getActiveGrant,
  getBillingPeriod,
  getCreditPackGrants,
  getMonthlyPlanGrant,
  getPackName,
  getPlanDisplayLabelKey,
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

  describe('#getPackName', function getPackNameTests() {
    it('should return small pack key for credits <= 2500', function smallPack() {
      expect(getPackName(2500)).toBe('builder_manageplan_pack_small');
      expect(getPackName(1000)).toBe('builder_manageplan_pack_small');
    });

    it('should return medium pack key for credits <= 5000', function mediumPack() {
      expect(getPackName(5000)).toBe('builder_manageplan_pack_medium');
      expect(getPackName(3000)).toBe('builder_manageplan_pack_medium');
    });

    it('should return large pack key for credits > 5000', function largePack() {
      expect(getPackName(10000)).toBe('builder_manageplan_pack_large');
      expect(getPackName(5001)).toBe('builder_manageplan_pack_large');
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
});
