/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('@/utils/conversion-event', () => ({
  fireConversionEvent: vi.fn(),
}));

import { appFetch } from '@/lib/gasket-config';
import type { AiroSubscription } from '@/lib/mgmt-airo/types';
import { fireConversionEvent } from '@/utils/conversion-event';
import { useConversionEvent } from './useConversionEvent';

const mockAppFetch = vi.mocked(appFetch);
const mockFireConversionEvent = vi.mocked(fireConversionEvent);

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const makeSubscription = (overrides: Partial<AiroSubscription> = {}): AiroSubscription => ({
  id: 'sub-1',
  productId: 'aab-v1',
  customerId: 'cust-1',
  status: 'active',
  isTrial: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  attributes: [{
    id: 'attr-1',
    ownerType: 'subscription',
    ownerId: 'sub-1',
    key: 'free-plan',
    value: { orderId: 'order-123', conversionEventDate: null },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }],
  ...overrides,
});

describe('useConversionEvent', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    sessionStorage.clear();
    mockAppFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fires event and calls acknowledge for subscription with free-plan attribute + conversionEventDate null', () => {
    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    expect(mockFireConversionEvent).toHaveBeenCalledWith({ orderId: 'order-123' });
    expect(mockAppFetch).toHaveBeenCalledWith(
      '/api/subscriptions/acknowledge',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ subscriptionId: 'sub-1' }),
      }),
    );
  });

  it('does not fire when conversionEventDate is set (non-null)', () => {
    const sub = makeSubscription({
      attributes: [{
        id: 'attr-1', ownerType: 'subscription', ownerId: 'sub-1', key: 'free-plan',
        value: { orderId: 'order-123', conversionEventDate: '2026-04-23T12:00:00Z' },
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      }],
    });
    renderHook(() => useConversionEvent(sub), { wrapper: createWrapper(queryClient) });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
    expect(mockAppFetch).not.toHaveBeenCalled();
  });

  it('does not fire when subscription is undefined', () => {
    renderHook(() => useConversionEvent(undefined), { wrapper: createWrapper(queryClient) });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when subscription has no free-plan attribute', () => {
    const sub = makeSubscription({ attributes: [] });
    renderHook(() => useConversionEvent(sub), { wrapper: createWrapper(queryClient) });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when subscription has no attributes at all', () => {
    const sub = makeSubscription({ attributes: undefined });
    renderHook(() => useConversionEvent(sub), { wrapper: createWrapper(queryClient) });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('fires only once on rerender with same props', () => {
    const wrapper = createWrapper(queryClient);
    const { rerender } = renderHook(() => useConversionEvent(makeSubscription()), { wrapper });
    rerender();

    expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
  });

  it('sets sessionStorage key before firing', () => {
    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    expect(sessionStorage.getItem('airo:conversion:acknowledged:sub-1')).toBe('true');
  });

  it('does not fire when sessionStorage already has key', () => {
    sessionStorage.setItem('airo:conversion:acknowledged:sub-1', 'true');

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('logs warning when acknowledge call fails', async () => {
    const { logger } = await import('@/lib/request-context');
    mockAppFetch.mockResolvedValue(new Response('{}', { status: 500 }));

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.acknowledge.failed', expect.any(Object));
    });
  });

  it('logs error when acknowledge call rejects', async () => {
    const { logger } = await import('@/lib/request-context');
    mockAppFetch.mockRejectedValue(new Error('network error'));

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.acknowledge.error', expect.any(Object));
    });
  });

  it('fires event on subscription arriving after cache refresh', () => {
    const wrapper = createWrapper(queryClient);
    const { rerender } = renderHook(
      ({ sub }: { sub: AiroSubscription | undefined }) => useConversionEvent(sub),
      { wrapper, initialProps: { sub: undefined } },
    );

    expect(mockFireConversionEvent).not.toHaveBeenCalled();

    rerender({ sub: makeSubscription() });
    expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
  });
});
