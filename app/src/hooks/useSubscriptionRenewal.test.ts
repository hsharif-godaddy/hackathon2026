/* eslint-disable react-hooks/rules-of-hooks */
/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useIsRenewalPolling, useSubscriptionRenewal } from './useSubscriptionRenewal';

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

// Mock appFetch
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
  AuthDismissedError: class AuthDismissedError extends Error {
    constructor() { super('Authentication dismissed'); this.name = 'AuthDismissedError'; }
  },
}));

import { appFetch } from '@/lib/gasket-config';
import { waitForQueryUpdate } from '@/lib/query-utils';
import { logger } from '@/lib/request-context';

describe('useSubscriptionRenewal', function useSubscriptionRenewalTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('useIsRenewalPolling', function useIsRenewalPollingTests() {
    it('returns false when no mutation is in progress', function notPolling() {
      const { result } = renderHookWithProviders(() => useIsRenewalPolling());
      expect(result.current).toBe(false);
    });
  });

  describe('renewSubscription', function renewSubscriptionTests() {
    it('calls renewal API and polls for status change on success', async function renewalSuccess() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true);

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      let renewalResult: { success: boolean; subscriptionActive: boolean } | undefined;

      await act(async () => {
        renewalResult = await result.current.renewSubscription('sub-123');
      });

      expect(renewalResult?.success).toBe(true);
      expect(renewalResult?.subscriptionActive).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('subscription.renewal.start', expect.any(Object));
      expect(logger.info).toHaveBeenCalledWith('subscription.renewal.api-success', expect.any(Object));
      expect(logger.info).toHaveBeenCalledWith('subscription.renewal.polling-complete', expect.any(Object));
    });

    it('returns success but subscriptionActive false on polling timeout', async function pollingTimeout() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
      vi.mocked(waitForQueryUpdate).mockResolvedValue(false);

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      let renewalResult: { success: boolean; subscriptionActive: boolean } | undefined;

      await act(async () => {
        renewalResult = await result.current.renewSubscription('sub-123');
      });

      expect(renewalResult?.success).toBe(true);
      expect(renewalResult?.subscriptionActive).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('subscription.renewal.polling-timeout', expect.any(Object));
    });

    it('handles API failure gracefully', async function apiFailure() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 402,
        json: async () => ({ error: 'Payment required' }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      let renewalResult: { success: boolean; subscriptionActive: boolean } | undefined;

      await act(async () => {
        renewalResult = await result.current.renewSubscription('sub-123');
      });

      expect(renewalResult?.success).toBe(false);
      expect(renewalResult?.subscriptionActive).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('subscription.renewal.error', expect.any(Object));
    });

    it('handles network errors gracefully', async function networkError() {
      vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      let renewalResult: { success: boolean; subscriptionActive: boolean } | undefined;

      await act(async () => {
        renewalResult = await result.current.renewSubscription('sub-123');
      });

      expect(renewalResult?.success).toBe(false);
      expect(renewalResult?.subscriptionActive).toBe(false);
    });

    it('checks correct condition for subscription status change', async function statusChangeCondition() {
      let capturedCondition: ((data: unknown) => boolean) | undefined;

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      vi.mocked(waitForQueryUpdate).mockImplementation(async (_queryClient, _queryKey, condition) => {
        capturedCondition = condition as (data: unknown) => boolean;
        return true;
      });

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      await act(async () => {
        await result.current.renewSubscription('sub-123');
      });

      // Test the condition function
      expect(capturedCondition).toBeDefined();

      // Should return true when status is 'active'
      const resultTrue = capturedCondition!({ active: { status: 'active' } });
      expect(resultTrue).toBe(true);

      // Should return false when status is 'suspended'
      const resultFalse = capturedCondition!({ active: { status: 'suspended' } });
      expect(resultFalse).toBe(false);
    });

    it('tracks isRenewing state during mutation', async function isRenewingState() {
      let resolveWait: () => void;
      const waitPromise = new Promise<boolean>((resolve) => {
        resolveWait = () => resolve(true);
      });

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
      vi.mocked(waitForQueryUpdate).mockImplementation(() => waitPromise);

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      expect(result.current.isRenewing).toBe(false);

      let renewPromise: Promise<unknown>;
      act(() => {
        renewPromise = result.current.renewSubscription('sub-123');
      });

      await waitFor(() => {
        expect(result.current.isRenewing).toBe(true);
      });

      await act(async () => {
        resolveWait!();
        await renewPromise;
      });

      await waitFor(() => {
        expect(result.current.isRenewing).toBe(false);
      });
    });

    it('sends correct request body to API', async function correctRequestBody() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
      vi.mocked(waitForQueryUpdate).mockResolvedValue(true);

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      await act(async () => {
        await result.current.renewSubscription('sub-456');
      });

      expect(appFetch).toHaveBeenCalledWith(
        '/api/subscriptions/renew',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: 'sub-456',
          }),
        }),
        { authLevel: 3 }
      );
    });

    it('exposes error from failed mutation', async function exposesError() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 402,
        json: async () => ({ error: 'Payment required' }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      expect(result.current.error).toBeNull();

      await act(async () => {
        await result.current.renewSubscription('sub-123');
      });

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
        expect(result.current.error?.message).toContain('Payment required');
      });
    });

    it('resets error when resetError is called', async function resetsError() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscriptionRenewal());

      await act(async () => {
        await result.current.renewSubscription('sub-123');
      });

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });

      act(() => {
        result.current.resetError();
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });
  });
});
