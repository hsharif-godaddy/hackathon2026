import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act, waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';

const mockAppFetch = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
  AuthDismissedError: class AuthDismissedError extends Error {
    constructor() { super('Authentication dismissed'); this.name = 'AuthDismissedError'; }
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
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
});
