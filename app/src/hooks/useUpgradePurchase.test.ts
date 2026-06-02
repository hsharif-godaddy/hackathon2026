/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useIsUpgradePolling, useUpgradePurchase } from './useUpgradePurchase';

// Mock query-utils
vi.mock('@/lib/query-utils', () => ({
  waitForQueryUpdate: vi.fn(),
  invalidatePlanQueries: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { waitForQueryUpdate } from '@/lib/query-utils';
import { logger } from '@/lib/request-context';

describe('useUpgradePurchase', function useUpgradePurchaseTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('useIsUpgradePolling', function useIsUpgradePollingTests() {
    it('returns false when no mutation is in progress', function notPolling() {
      const { result } = renderHookWithProviders(() => useIsUpgradePolling());
      expect(result.current).toBe(false);
    });
  });

  describe('handlePurchaseSuccess', function handlePurchaseSuccessTests() {
    it('polls for upgrade and returns updated plan on success', async function upgradeSuccess() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true);

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('plan.upgrade.polling-start', expect.any(Object));
    });

    it('polls for downgrade and waits for downgradedAt/downgradedPlan', async function downgradeSuccess() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true);

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'ultimate',
          'professional',
          undefined,
          false,
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('plan.downgrade.polling-start', expect.any(Object));
    });

    it('returns updated: false on polling timeout', async function pollingTimeout() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(false);

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      expect(pollResult?.updated).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('plan.upgrade.polling-timeout', expect.any(Object));
    });

    it('handles error gracefully and returns default result', async function handleError() {
      vi.mocked(waitForQueryUpdate).mockRejectedValue(new Error('Network error'));

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      expect(pollResult?.updated).toBe(false);
      expect(pollResult?.planAfterPurchase).toBeUndefined();
      expect(pollResult?.grantUpdated).toBe(false);
    });

    it('checks correct condition for upgrade without prior downgrade', async function upgradeConditionNoPriorDowngrade() {
      let capturedCondition: ((data: unknown) => boolean) | undefined;

      vi.mocked(waitForQueryUpdate).mockImplementation(async function (_queryClient, _queryKey, condition) {
        capturedCondition = condition as (data: unknown) => boolean;
        return true;
      });

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      await act(async () => {
        await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined, // no prior downgrade
          true,
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      // Test the condition function
      expect(capturedCondition).toBeDefined();

      // Should return true when plan matches and no downgradedPlan check needed
      const resultTrue = capturedCondition!({ active: { plan: 'ultimate' } });
      expect(resultTrue).toBe(true);

      // Should return false when plan doesn't match
      const resultFalse = capturedCondition!({ active: { plan: 'professional' } });
      expect(resultFalse).toBe(false);
    });

    it('checks correct condition for upgrade with prior downgrade scheduled', async function upgradeConditionWithPriorDowngrade() {
      let capturedCondition: ((data: unknown) => boolean) | undefined;

      vi.mocked(waitForQueryUpdate).mockImplementation(async function (_queryClient, _queryKey, condition) {
        capturedCondition = condition as (data: unknown) => boolean;
        return true;
      });

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      await act(async () => {
        await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          'starter', // prior downgrade to starter was scheduled
          true,
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      expect(capturedCondition).toBeDefined();

      // Should return true when plan matches AND downgradedPlan is cleared
      const resultTrue = capturedCondition!({ active: { plan: 'ultimate', downgradedPlan: undefined } });
      expect(resultTrue).toBe(true);

      // Should return false when plan matches but downgradedPlan still set to old value
      const resultFalse = capturedCondition!({ active: { plan: 'ultimate', downgradedPlan: 'starter' } });
      expect(resultFalse).toBe(false);
    });

    it('checks correct condition for downgrade', async function downgradeCondition() {
      let capturedCondition: ((data: unknown) => boolean) | undefined;

      vi.mocked(waitForQueryUpdate).mockImplementation(async function (_queryClient, _queryKey, condition) {
        capturedCondition = condition as (data: unknown) => boolean;
        return true;
      });

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      await act(async () => {
        await result.current.handlePurchaseSuccess(
          'ultimate',
          'professional',
          undefined,
          false, // downgrade
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      expect(capturedCondition).toBeDefined();

      // Should return true when downgradedAt and downgradedPlan are set
      const resultTrue = capturedCondition!({
        active: {
          plan: 'ultimate',
          downgradedAt: '2024-01-01',
          downgradedPlan: 'professional'
        }
      });
      expect(resultTrue).toBe(true);

      // Should return false when downgradedAt/downgradedPlan are not set
      const resultFalse = capturedCondition!({ active: { plan: 'ultimate' } });
      expect(resultFalse).toBe(false);
    });

    it('tracks isPolling state during mutation', async function isPollingState() {
      let resolveWait: () => void;
      const waitPromise = new Promise<boolean>((resolve) => {
        resolveWait = () => resolve(true);
      });

      vi.mocked(waitForQueryUpdate).mockImplementation(function () { return waitPromise; });

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      expect(result.current.isPolling).toBe(false);

      let pollPromise: Promise<unknown>;
      act(() => {
        pollPromise = result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          undefined,
          undefined
        );
      });

      await waitFor(() => {
        expect(result.current.isPolling).toBe(true);
      });

      await act(async () => {
        resolveWait!();
        await pollPromise;
      });

      await waitFor(() => {
        expect(result.current.isPolling).toBe(false);
      });
    });

    it('polls for creditsMax change after successful upgrade', async function grantPollingOnUpgrade() {
      // First call for subscription, second call for grants
      vi.mocked(waitForQueryUpdate)
        .mockResolvedValueOnce(true) // subscription poll succeeds
        .mockResolvedValueOnce(true); // grant poll succeeds

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          1000 // initialCreditsMax
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(pollResult?.grantUpdated).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('plan.upgrade.grant-polling-start', {
        subscriptionId: 'sub-123',
        initialCreditsMax: 1000,
      });
    });

    it('skips grant polling when subscription polling fails', async function noGrantPollingOnSubscriptionTimeout() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(false); // subscription poll times out

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          1000
        );
      });

      expect(pollResult?.updated).toBe(false);
      expect(pollResult?.grantUpdated).toBe(false);
      // Should not have called grant polling since subscription polling failed
      expect(logger.info).not.toHaveBeenCalledWith('plan.upgrade.grant-polling-start', expect.any(Object));
    });

    it('skips grant polling for D2P (new subscription) with info log', async function d2pSkipsGrantPolling() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true); // subscription poll succeeds

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          undefined, // D2P - no plan before purchase
          'professional',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          undefined // No initial creditsMax for D2P
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(pollResult?.grantUpdated).toBe(false);
      // Should log info (not warn) for D2P - this is expected behavior
      expect(logger.info).toHaveBeenCalledWith('plan.upgrade.grant-polling-skipped', {
        subscriptionId: 'sub-123',
        reason: 'new_subscription',
      });
      // Should NOT log a warning for D2P
      expect(logger.warn).not.toHaveBeenCalledWith('plan.upgrade.grant-polling-skipped', expect.any(Object));
    });

    it('skips grant polling with warning when initialCreditsMax is undefined (cold cache)', async function coldCacheSkipsGrantPolling() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true); // subscription poll succeeds

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional', // Existing subscription
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          undefined // initialCreditsMax is undefined (cold cache)
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(pollResult?.grantUpdated).toBe(false);
      // Should log warning about skipped grant polling for cold cache
      expect(logger.warn).toHaveBeenCalledWith('plan.upgrade.grant-polling-skipped', {
        subscriptionId: 'sub-123',
        reason: 'initial_credits_max_not_found',
        initialCreditsMax: undefined,
      });
      // Should not have attempted grant polling
      expect(logger.info).not.toHaveBeenCalledWith('plan.upgrade.grant-polling-start', expect.any(Object));
    });

    it('skips grant polling for downgrades', async function noGrantPollingOnDowngrade() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true);

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      await act(async () => {
        await result.current.handlePurchaseSuccess(
          'ultimate',
          'professional',
          undefined,
          false, // downgrade
          'test-source',
          'test-product',
          'sub-123',
          1000
        );
      });

      // Should not have called grant polling for downgrades
      expect(logger.info).not.toHaveBeenCalledWith('plan.upgrade.grant-polling-start', expect.any(Object));
    });

    it('handles grant polling timeout', async function grantPollingTimeout() {
      vi.mocked(waitForQueryUpdate)
        .mockResolvedValueOnce(true) // subscription poll succeeds
        .mockResolvedValueOnce(false); // grant poll times out

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          1000
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(pollResult?.grantUpdated).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('plan.upgrade.grant-polling-timeout', {
        subscriptionId: 'sub-123',
        initialCreditsMax: 1000,
      });
    });

    it('polls until creditsMax increases (unified check for BMS and legacy)', async function unifiedCreditsMaxPolling() {
      let capturedCondition: ((data: unknown) => boolean) | undefined;

      vi.mocked(waitForQueryUpdate).mockImplementation(async function (_queryClient, queryKey, condition) {
        // Only capture the grant polling condition (not subscription)
        if (Array.isArray(queryKey) && queryKey[0] === 'credit-grants') {
          capturedCondition = condition as (data: unknown) => boolean;
        }
        return true;
      });

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      await act(async () => {
        await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          1000 // initialCreditsMax
        );
      });

      expect(capturedCondition).toBeDefined();

      // Should return false when creditsMax hasn't increased
      const resultFalse = capturedCondition!(
        [{ id: 'some-grant', type: 'plan-monthly', isAvailable: true, creditsMax: 1000 }]
      );
      expect(resultFalse).toBe(false);

      // Should return true when creditsMax has increased (works for both BMS and legacy)
      const resultTrue = capturedCondition!(
        [{ id: 'new-grant', type: 'plan-monthly', isAvailable: true, creditsMax: 2000 }]
      );
      expect(resultTrue).toBe(true);

      // Should return false when grants array is empty
      const resultEmpty = capturedCondition!([]);
      expect(resultEmpty).toBe(false);

      // Should return false when no plan-monthly grant exists
      const resultNoMatch = capturedCondition!(
        [{ id: 'other-grant', type: 'message-bonus', isAvailable: true, creditsMax: 5000 }]
      );
      expect(resultNoMatch).toBe(false);
    });

    it('returns false when current creditsMax is null (malformed API response)', async function nullCreditsMaxInPolling() {
      let capturedCondition: ((data: unknown) => boolean) | undefined;

      vi.mocked(waitForQueryUpdate).mockImplementation(async function (_queryClient, queryKey, condition) {
        if (Array.isArray(queryKey) && queryKey[0] === 'credit-grants') {
          capturedCondition = condition as (data: unknown) => boolean;
        }
        return true;
      });

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      await act(async () => {
        await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          1000
        );
      });

      expect(capturedCondition).toBeDefined();

      // Should return false when creditsMax is null (malformed API response)
      const resultFalse = capturedCondition!(
        [{ id: 'some-grant', type: 'plan-monthly', isAvailable: true, creditsMax: null }]
      );
      expect(resultFalse).toBe(false);
    });

    it('skips grant polling with warning when initialCreditsMax is null', async function nullInitialCreditsMax() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true);

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          null as unknown as number // Simulate null from malformed API
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(pollResult?.grantUpdated).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('plan.upgrade.grant-polling-skipped', {
        subscriptionId: 'sub-123',
        reason: 'initial_credits_max_not_found',
        initialCreditsMax: null,
      });
    });

    it('logs successful grant polling completion', async function grantPollingComplete() {
      vi.mocked(waitForQueryUpdate)
        .mockResolvedValueOnce(true) // subscription poll succeeds
        .mockResolvedValueOnce(true); // grant poll succeeds

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      await act(async () => {
        await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          1000
        );
      });

      expect(logger.info).toHaveBeenCalledWith('plan.upgrade.grant-polling-complete', {
        subscriptionId: 'sub-123',
      });
    });

    it('polls for grant when initialCreditsMax is 0 (free-tier transition)', async function zeroInitialCreditsMax() {
      vi.mocked(waitForQueryUpdate)
        .mockResolvedValueOnce(true) // subscription poll succeeds
        .mockResolvedValueOnce(true); // grant poll succeeds

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean; grantUpdated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'starter',
          'professional',
          undefined,
          true,
          'test-source',
          'test-product',
          'sub-123',
          0 // Free-tier with 0 creditsMax
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(pollResult?.grantUpdated).toBe(true);
      // Should start polling, not skip with warning
      expect(logger.info).toHaveBeenCalledWith('plan.upgrade.grant-polling-start', {
        subscriptionId: 'sub-123',
        initialCreditsMax: 0,
      });
      expect(logger.warn).not.toHaveBeenCalledWith('plan.upgrade.grant-polling-skipped', expect.any(Object));
    });
  });
});
