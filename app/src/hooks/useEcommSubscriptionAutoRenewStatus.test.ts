import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';

const mockAppFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
}));

import { useEcommSubscriptionAutoRenewStatus } from './useEcommSubscriptionAutoRenewStatus';

/* eslint-disable react-hooks/rules-of-hooks */
describe('useEcommSubscriptionAutoRenewStatus', function useEcommSubscriptionAutoRenewStatusTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  afterEach(function cleanup() {
    vi.resetAllMocks();
  });

  it('should not fetch when builderEntitlementId is undefined', function noFetchWithoutId() {
    const { result } = renderHookWithProviders(() =>
      useEcommSubscriptionAutoRenewStatus(undefined)
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('should not fetch when builderEntitlementId is null', function noFetchWithNull() {
    const { result } = renderHookWithProviders(() =>
      useEcommSubscriptionAutoRenewStatus(null)
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('should fetch subscription status when builderEntitlementId is provided', async function fetchesWithId() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscriptionId: 'sub-123',
        autoRenew: true,
        paidThroughDate: '2027-01-29T07:00:00Z',
      }),
    });

    const { result } = renderHookWithProviders(() =>
      useEcommSubscriptionAutoRenewStatus('entitlement-123')
    );

    await waitFor(function waitForData() {
      expect(result.current.data).toBeDefined();
    });

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/ecomm-subscription/status?builderEntitlementId=entitlement-123',
      { credentials: 'include' }
    );
    expect(result.current.data).toEqual({
      subscriptionId: 'sub-123',
      autoRenew: true,
      paidThroughDate: '2027-01-29T07:00:00Z',
    });
  });

  it('should encode special characters in builderEntitlementId', async function encodesSpecialChars() {
    mockAppFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscriptionId: 'sub-123',
        autoRenew: true,
      }),
    });

    renderHookWithProviders(() =>
      useEcommSubscriptionAutoRenewStatus('entitlement/with&special=chars')
    );

    await waitFor(function waitForFetch() {
      expect(mockAppFetch).toHaveBeenCalled();
    });

    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/ecomm-subscription/status?builderEntitlementId=entitlement%2Fwith%26special%3Dchars',
      { credentials: 'include' }
    );
  });

  it('should handle API error response', async function handlesApiError() {
    mockAppFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Subscription not found' }),
    });

    const { result } = renderHookWithProviders(() =>
      useEcommSubscriptionAutoRenewStatus('entitlement-404')
    );

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Subscription not found');
  });

  it('should handle API error with fallback message', async function handlesApiErrorFallback() {
    mockAppFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = renderHookWithProviders(() =>
      useEcommSubscriptionAutoRenewStatus('entitlement-500')
    );

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Failed to fetch subscription status: 500');
  });

  it('should handle JSON parse error gracefully', async function handlesJsonParseError() {
    mockAppFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('Invalid JSON'); },
    });

    const { result } = renderHookWithProviders(() =>
      useEcommSubscriptionAutoRenewStatus('entitlement-bad-json')
    );

    await waitFor(function waitForError() {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Failed to fetch subscription status: 500');
  });
});
