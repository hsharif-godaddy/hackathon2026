import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
/**
 * @vitest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';

const mockAppFetch = vi.hoisted(() => vi.fn());
const mockFetchEcommSubscriptionStatus = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
const MockAuthDismissedError = vi.hoisted(() => {
  return class AuthDismissedError extends Error {
    constructor() { super('Authentication dismissed'); this.name = 'AuthDismissedError'; }
  };
});

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
  AuthDismissedError: MockAuthDismissedError,
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('./useEcommSubscriptionAutoRenewStatus', () => ({
  fetchEcommSubscriptionStatus: (...args: unknown[]) => mockFetchEcommSubscriptionStatus(...args),
}));

import { useEcommSubscriptionAutoRenew } from './useEcommSubscriptionAutoRenew';

/* eslint-disable react-hooks/rules-of-hooks */
describe('useEcommSubscriptionAutoRenew', function useEcommSubscriptionAutoRenewTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  afterEach(function cleanup() {
    vi.resetAllMocks();
  });

  it('should expose setAutoRenew mutation', function exposesMutation() {
    const { result } = renderHookWithProviders(() => useEcommSubscriptionAutoRenew());

    expect(result.current.setAutoRenew).toBeDefined();
    expect(result.current.setAutoRenew.mutate).toBeDefined();
    expect(result.current.setAutoRenew.mutateAsync).toBeDefined();
  });

  it('should successfully update autoRenew to false', async function updateToFalse() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
    });

    const { result } = renderHookWithProviders(() => useEcommSubscriptionAutoRenew());

    await act(async function performMutation() {
      result.current.setAutoRenew.mutate({
        builderEntitlementId: 'entitlement-123',
        autoRenew: false,
      });
    });

    await waitFor(function waitForSuccess() {
      expect(result.current.setAutoRenew.isSuccess).toBe(true);
    });

    expect(mockAppFetch).toHaveBeenCalledWith('/api/ecomm-subscription/auto-renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ builderEntitlementId: 'entitlement-123', autoRenew: false }),
      credentials: 'include',
    }, { authLevel: 3 });
  });

  it('should successfully update autoRenew to true', async function updateToTrue() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, renewalDate: '2027-02-01T00:00:00Z' }),
    });

    const { result } = renderHookWithProviders(() => useEcommSubscriptionAutoRenew());

    await act(async function performMutation() {
      result.current.setAutoRenew.mutate({
        builderEntitlementId: 'entitlement-123',
        autoRenew: true,
      });
    });

    await waitFor(function waitForSuccess() {
      expect(result.current.setAutoRenew.isSuccess).toBe(true);
    });

    expect(result.current.setAutoRenew.data).toEqual({
      success: true,
      renewalDate: '2027-02-01T00:00:00Z',
    });
  });

  it('should call API with correct parameters', async function correctApiCall() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
    });

    const { result } = renderHookWithProviders(() => useEcommSubscriptionAutoRenew());

    await act(async function performMutation() {
      result.current.setAutoRenew.mutate({
        builderEntitlementId: 'test-entitlement-456',
        autoRenew: true,
      });
    });

    await waitFor(function waitForSuccess() {
      expect(result.current.setAutoRenew.isSuccess).toBe(true);
    });

    expect(mockAppFetch).toHaveBeenCalledWith('/api/ecomm-subscription/auto-renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ builderEntitlementId: 'test-entitlement-456', autoRenew: true }),
      credentials: 'include',
    }, { authLevel: 3 });
  });

  describe('reconcile logic (5s delayed fetch)', function reconcileTests() {
    function createQueryClientWithCachedStatus(entitlementId: string): QueryClient {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      qc.setQueryData(['ecomm-subscription-status', entitlementId], {
        autoRenew: true,
        paidThroughDate: '2027-01-29T07:00:00Z',
        subscriptionId: 'sub-123',
      });
      return qc;
    }

    function mockSuccessfulMutation(): void {
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
      });
    }

    async function mutateAndWaitForReconcile(
      result: { current: ReturnType<typeof useEcommSubscriptionAutoRenew> },
      params: { builderEntitlementId: string; autoRenew: boolean }
    ): Promise<void> {
      await act(async () => {
        result.current.setAutoRenew.mutate(params);
      });
      await waitFor(() => expect(result.current.setAutoRenew.isSuccess).toBe(true));
      // Wait for the 5s reconcile timeout + promise resolution
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5100));
      });
    }

    it('should update cache when server confirms expected autoRenew value', async function reconcileConfirmed() {
      const queryClient = createQueryClientWithCachedStatus('ent-1');
      mockSuccessfulMutation();
      mockFetchEcommSubscriptionStatus.mockResolvedValueOnce({
        autoRenew: false,
        paidThroughDate: '2027-02-01T00:00:00Z',
        subscriptionId: 'sub-123',
      });

      const { result } = renderHookWithProviders(
        () => useEcommSubscriptionAutoRenew(),
        { queryClient }
      );

      await mutateAndWaitForReconcile(result, { builderEntitlementId: 'ent-1', autoRenew: false });

      const cached = queryClient.getQueryData(['ecomm-subscription-status', 'ent-1']) as { autoRenew: boolean; paidThroughDate?: string };
      expect(cached.autoRenew).toBe(false);
      expect(cached.paidThroughDate).toBe('2027-02-01T00:00:00Z');
    }, 10000);

    it('should NOT overwrite cache when server returns stale data', async function reconcileStale() {
      const queryClient = createQueryClientWithCachedStatus('ent-2');
      mockSuccessfulMutation();
      mockFetchEcommSubscriptionStatus.mockResolvedValueOnce({
        autoRenew: true,
        paidThroughDate: '2027-01-29T07:00:00Z',
        subscriptionId: 'sub-123',
      });

      const { result } = renderHookWithProviders(
        () => useEcommSubscriptionAutoRenew(),
        { queryClient }
      );

      await mutateAndWaitForReconcile(result, { builderEntitlementId: 'ent-2', autoRenew: false });

      const cached = queryClient.getQueryData(['ecomm-subscription-status', 'ent-2']) as { autoRenew: boolean };
      expect(cached.autoRenew).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('ecomm-subscription.auto-renew.reconcile.stale', {
        builderEntitlementId: 'ent-2',
        expected: false,
        actual: true,
      });
    }, 10000);

    it('should log error when reconcile fetch fails', async function reconcileFetchError() {
      const queryClient = createQueryClientWithCachedStatus('ent-3');
      mockSuccessfulMutation();
      mockFetchEcommSubscriptionStatus.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHookWithProviders(
        () => useEcommSubscriptionAutoRenew(),
        { queryClient }
      );

      await mutateAndWaitForReconcile(result, { builderEntitlementId: 'ent-3', autoRenew: false });

      expect(mockLogger.error).toHaveBeenCalledWith('ecomm-subscription.auto-renew.reconcile.failed', {
        builderEntitlementId: 'ent-3',
        autoRenew: false,
        error: 'Network error',
      });
    }, 10000);

    it('should not log error when reconcile fetch throws AuthDismissedError', async function reconcileAuthDismissed() {
      const queryClient = createQueryClientWithCachedStatus('ent-4');
      mockSuccessfulMutation();
      mockFetchEcommSubscriptionStatus.mockRejectedValueOnce(new (MockAuthDismissedError)());

      const { result } = renderHookWithProviders(
        () => useEcommSubscriptionAutoRenew(),
        { queryClient }
      );

      await mutateAndWaitForReconcile(result, { builderEntitlementId: 'ent-4', autoRenew: false });

      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'ecomm-subscription.auto-renew.reconcile.failed',
        expect.anything()
      );
    }, 10000);

    it('should cancel previous timeout on rapid back-to-back mutations', async function clearTimeoutOnRepeat() {
      const queryClient = createQueryClientWithCachedStatus('ent-5');
      // First mutation
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
      });
      // Second mutation
      mockAppFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
      });
      // Only one reconcile fetch should fire (from the second mutation)
      mockFetchEcommSubscriptionStatus.mockResolvedValueOnce({
        autoRenew: true,
        paidThroughDate: '2027-01-29T07:00:00Z',
        subscriptionId: 'sub-123',
      });

      const { result } = renderHookWithProviders(
        () => useEcommSubscriptionAutoRenew(),
        { queryClient }
      );

      // First mutation (autoRenew=false)
      await act(async () => {
        result.current.setAutoRenew.mutate({ builderEntitlementId: 'ent-5', autoRenew: false });
      });
      await waitFor(() => expect(result.current.setAutoRenew.isSuccess).toBe(true));

      // Wait 2s (less than 5s timeout), then fire second mutation
      await act(async () => { await new Promise((r) => setTimeout(r, 2000)); });

      // Second mutation (autoRenew=true, user cancelled the downgrade)
      await act(async () => {
        result.current.setAutoRenew.mutate({ builderEntitlementId: 'ent-5', autoRenew: true });
      });
      await waitFor(() => expect(result.current.setAutoRenew.isSuccess).toBe(true));

      // Wait for second timeout to fire
      await act(async () => { await new Promise((r) => setTimeout(r, 5100)); });

      // Only one reconcile fetch should have fired (the first was cancelled)
      expect(mockFetchEcommSubscriptionStatus).toHaveBeenCalledTimes(1);
      expect(mockFetchEcommSubscriptionStatus).toHaveBeenCalledWith('ent-5');
    }, 15000);
  });
});
