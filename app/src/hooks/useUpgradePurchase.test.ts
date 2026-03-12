/* eslint-disable react-hooks/rules-of-hooks */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useIsUpgradePolling, useUpgradePurchase } from './useUpgradePurchase';

// Mock waitForQueryUpdate
vi.mock('@/lib/query-utils', () => ({
  waitForQueryUpdate: vi.fn(),
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

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product'
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('plan.upgrade.polling-start', expect.any(Object));
    });

    it('polls for downgrade and waits for downgradedAt/downgradedPlan', async function downgradeSuccess() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true);

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'ultimate',
          'professional',
          undefined,
          false,
          'test-source',
          'test-product'
        );
      });

      expect(pollResult?.updated).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('plan.downgrade.polling-start', expect.any(Object));
    });

    it('returns updated: false on polling timeout', async function pollingTimeout() {
      vi.mocked(waitForQueryUpdate).mockResolvedValue(false);

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product'
        );
      });

      expect(pollResult?.updated).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('plan.upgrade.polling-timeout', expect.any(Object));
    });

    it('handles error gracefully and returns default result', async function handleError() {
      vi.mocked(waitForQueryUpdate).mockRejectedValue(new Error('Network error'));

      const { result } = renderHookWithProviders(() => useUpgradePurchase());

      let pollResult: { planAfterPurchase: string | undefined; updated: boolean } | undefined;

      await act(async () => {
        pollResult = await result.current.handlePurchaseSuccess(
          'professional',
          'ultimate',
          undefined,
          true,
          'test-source',
          'test-product'
        );
      });

      expect(pollResult?.updated).toBe(false);
      expect(pollResult?.planAfterPurchase).toBeUndefined();
    });

    it('checks correct condition for upgrade without prior downgrade', async function upgradeConditionNoPriorDowngrade() {
      let capturedCondition: ((data: unknown) => boolean) | undefined;

      vi.mocked(waitForQueryUpdate).mockImplementation(async (_queryClient, _queryKey, condition) => {
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
          'test-product'
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

      vi.mocked(waitForQueryUpdate).mockImplementation(async (_queryClient, _queryKey, condition) => {
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
          'test-product'
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

      vi.mocked(waitForQueryUpdate).mockImplementation(async (_queryClient, _queryKey, condition) => {
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
          'test-product'
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

      vi.mocked(waitForQueryUpdate).mockImplementation(() => waitPromise);

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
          'test-product'
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
  });
});
