/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('@/utils/instrumentation', () => ({
  fireConversionEvent: vi.fn(),
}));

import { appFetch } from '@/lib/gasket-config';
import type { AiroSubscription } from '@/lib/mgmt-airo/types';
import { fireConversionEvent } from '@/utils/instrumentation';
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
  ...overrides,
});

const makeAttributesResponse = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  json: () => Promise.resolve({
    success: true,
    data: {
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
    },
  }),
} as Response);

function mockFetchResponses(attributesResponse: Response = makeAttributesResponse() as Response) {
  mockAppFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('?include=attributes')) {
      return Promise.resolve(attributesResponse);
    }
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  });
}

describe('useConversionEvent', () => {
  let queryClient: QueryClient;
  let testId = 0;

  function uniqueId() {
    return `sub-${++testId}`;
  }

  function makeSubWithAttrs(id: string) {
    const sub = makeSubscription({ id });
    const response = {
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          ...sub,
          attributes: [{
            id: 'attr-1', ownerType: 'subscription', ownerId: id, key: 'free-plan',
            value: { orderId: `order-${id}`, conversionEventDate: null },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      }),
    } as Response;
    return { sub, response };
  }

  function mockFetchForSub(attrsResponse: Response) {
    mockAppFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('?include=attributes')) {
        return Promise.resolve(attrsResponse);
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    mockFetchResponses();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches attributes and fires event for trial subscription with unacknowledged conversion', async () => {
    const id = uniqueId();
    const { sub, response } = makeSubWithAttrs(id);
    mockFetchForSub(response);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useConversionEvent(sub), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockFireConversionEvent).toHaveBeenCalledWith({ orderId: `order-${id}` });
    });

    expect(mockAppFetch).toHaveBeenCalledWith(
      `/api/subscriptions/${id}?include=attributes`,
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(mockAppFetch).toHaveBeenCalledWith(
      `/api/subscriptions/${id}/acknowledge`,
      expect.objectContaining({ method: 'POST' }),
    );

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions'] });
    });
  });

  it('does not fetch attributes for non-trial subscription', () => {
    renderHook(() => useConversionEvent(makeSubscription({ isTrial: false })), { wrapper: createWrapper(queryClient) });

    expect(mockAppFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('?include=attributes'),
      expect.anything(),
    );
    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when conversionEventDate is set', async () => {
    mockFetchResponses({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          ...makeSubscription(),
          attributes: [{
            id: 'attr-1', ownerType: 'subscription', ownerId: 'sub-1', key: 'free-plan',
            value: { orderId: 'order-123', conversionEventDate: '2026-04-23T12:00:00Z' },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      }),
    } as Response);

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when subscription is undefined', () => {
    renderHook(() => useConversionEvent(undefined), { wrapper: createWrapper(queryClient) });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when subscription has no free-plan attribute', async () => {
    mockFetchResponses({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: { ...makeSubscription(), attributes: [] },
      }),
    } as Response);

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when free-plan attribute has no orderId', async () => {
    mockFetchResponses({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          ...makeSubscription(),
          attributes: [{
            id: 'attr-1', ownerType: 'subscription', ownerId: 'sub-1', key: 'free-plan',
            value: { conversionEventDate: null },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      }),
    } as Response);

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when orderId is not a string', async () => {
    mockFetchResponses({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          ...makeSubscription(),
          attributes: [{
            id: 'attr-1', ownerType: 'subscription', ownerId: 'sub-1', key: 'free-plan',
            value: { orderId: 123, conversionEventDate: null },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      }),
    } as Response);

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('fires only once on rerender with same props', async () => {
    const id = uniqueId();
    const { sub, response } = makeSubWithAttrs(id);
    mockFetchForSub(response);
    const wrapper = createWrapper(queryClient);
    const { rerender } = renderHook(() => useConversionEvent(sub), { wrapper });

    await waitFor(() => {
      expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
    });

    rerender();
    expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fire again for same subscription across remounts', async () => {
    const id = uniqueId();
    const { sub, response } = makeSubWithAttrs(id);
    mockFetchForSub(response);

    const wrapper = createWrapper(queryClient);
    const { unmount } = renderHook(() => useConversionEvent(sub), { wrapper });

    await waitFor(() => {
      expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
    });

    unmount();
    mockFireConversionEvent.mockClear();

    const queryClient2 = createQueryClient();
    const wrapper2 = createWrapper(queryClient2);
    mockFetchForSub(response);
    renderHook(() => useConversionEvent(sub), { wrapper: wrapper2 });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining(`${id}?include=attributes`),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
    queryClient2.clear();
  });

  it('logs error when acknowledge call rejects', async () => {
    const id = uniqueId();
    const { sub, response } = makeSubWithAttrs(id);
    const { logger } = await import('@/lib/request-context');
    mockAppFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('?include=attributes')) {
        return Promise.resolve(response);
      }
      return Promise.reject(new Error('network error'));
    });

    renderHook(() => useConversionEvent(sub), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.acknowledge.error', expect.any(Object));
    });
  });

  it('logs warning when acknowledge POST returns non-ok response and does not re-fire on rerender', async () => {
    const id = uniqueId();
    const { sub, response } = makeSubWithAttrs(id);
    const { logger } = await import('@/lib/request-context');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockAppFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('?include=attributes')) {
        return Promise.resolve(response);
      }
      return Promise.resolve({ ok: false, status: 500 } as Response);
    });

    const { rerender } = renderHook(() => useConversionEvent(sub), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockFireConversionEvent).toHaveBeenCalledWith({ orderId: `order-${id}` });
    });

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.acknowledge.http-error', expect.objectContaining({
        subscriptionId: id,
        status: 500,
      }));
    });

    expect(invalidateSpy).not.toHaveBeenCalled();

    mockFireConversionEvent.mockClear();
    rerender();
    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('logs non-Error rejection from acknowledge call', async () => {
    const id = uniqueId();
    const { sub, response } = makeSubWithAttrs(id);
    const { logger } = await import('@/lib/request-context');
    mockAppFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('?include=attributes')) {
        return Promise.resolve(response);
      }
      return Promise.reject('string rejection');
    });

    renderHook(() => useConversionEvent(sub), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.acknowledge.error', expect.objectContaining({
        error: 'Unknown error',
      }));
    });
  });

  it('does not fire when attributes fetch returns non-ok and logs error', async () => {
    const { logger } = await import('@/lib/request-context');
    mockFetchResponses({
      ok: false,
      status: 403,
    } as Response);

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.attributes.error', expect.objectContaining({
        subscriptionId: expect.any(String),
      }));
    }, { timeout: 3000 });
  });

  it('does not fire when attributes fetch returns unsuccessful response body', async () => {
    mockFetchResponses({
      ok: true,
      json: () => Promise.resolve({ success: false, error: 'bad data' }),
    } as Response);

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when attributes fetch returns missing data without error message', async () => {
    mockFetchResponses({
      ok: true,
      json: () => Promise.resolve({ success: true, data: null }),
    } as Response);

    renderHook(() => useConversionEvent(makeSubscription()), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

});
