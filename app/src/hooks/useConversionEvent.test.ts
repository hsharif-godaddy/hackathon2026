/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Query, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
  // useSubscription's refetchInterval/retry guards do `error instanceof
  // AuthDismissedError`; these must be real constructors or the guard throws.
  AuthDismissedError: class AuthDismissedError extends Error {},
  AuthSessionExpiredError: class AuthSessionExpiredError extends Error {},
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
import {
  attributesRefetchInterval,
  CONVERSION_POLL_INTERVAL_MS,
  gateRefetchInterval,
  MAX_CONVERSION_POLL_DURATION_MS,
  useConversionEvent,
} from './useConversionEvent';
import type { SubscriptionQueryData } from './useSubscription';

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

const freePlanAttribute = (value: Record<string, unknown>, ownerId = 'sub-1') => ({
  id: 'attr-1',
  ownerType: 'subscription',
  ownerId,
  key: 'free-plan',
  value,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

// `acknowledgedIds` is module-level and persists across tests in this file (it
// models the real per-tab dedup). Each test that expects a fresh fire must use a
// unique subscription id so a prior test's fire doesn't suppress it.
let testIdCounter = 0;
const uniqueId = () => `sub-${++testIdCounter}`;

/** Minimal Query stand-in for exercising the pure refetchInterval predicates. */
function fakeQuery<T>(data: T | undefined): Query<T> {
  return { state: { data } } as unknown as Query<T>;
}

// --- Integration harness ---------------------------------------------------
// The hook is now self-contained: it reads the subscription list itself (gate
// layer) and the per-subscription attributes (attribute layer). Tests drive
// behavior by mocking both endpoints rather than passing a subscription arg.

interface MockEndpointOptions {
  /** Subscription id used for the trial sub, its attributes, and the acknowledge URL. */
  id?: string;
  /** Response for GET /api/subscriptions (the gate read). Defaults to a trial sub with the given id. */
  listActive?: AiroSubscription | null;
  /** Response for GET /api/subscriptions/:id?include=attributes. */
  attributesResponse?: Response;
  /** Override the acknowledge POST response. */
  acknowledgeResponse?: Response | (() => Promise<Response>);
}

const okJson = (body: unknown): Response => ({
  ok: true,
  json: () => Promise.resolve(body),
} as Response);

function mockEndpoints(opts: MockEndpointOptions = {}) {
  const id = opts.id ?? 'sub-1';
  const listActive = opts.listActive === undefined ? makeSubscription({ id }) : opts.listActive;
  const defaultAttrs = okJson({
    success: true,
    data: { ...makeSubscription({ id }), attributes: [freePlanAttribute({ orderId: `order-${id}`, conversionEventDate: null }, id)] },
  });
  mockAppFetch.mockImplementation(function (url: string, init?: RequestInit) {
    if (typeof url === 'string' && url.includes('?include=attributes')) {
      return Promise.resolve(opts.attributesResponse ?? defaultAttrs);
    }
    if (typeof url === 'string' && url.endsWith('/acknowledge') && init?.method === 'POST') {
      if (typeof opts.acknowledgeResponse === 'function') return opts.acknowledgeResponse();
      return Promise.resolve(opts.acknowledgeResponse ?? ({ ok: true, status: 200 } as Response));
    }
    // GET /api/subscriptions (list / gate read)
    return Promise.resolve(okJson({
      success: true,
      data: { subscriptions: listActive ? [listActive] : [], active: listActive },
    }));
  });
}

describe('useConversionEvent predicates', () => {
  describe('gateRefetchInterval', () => {
    it('keeps polling while no subscription is visible yet (provisioning race)', () => {
      const q = fakeQuery<SubscriptionQueryData>({ subscriptions: [], active: null });
      expect(gateRefetchInterval(q, 0)).toBe(CONVERSION_POLL_INTERVAL_MS);
    });

    it('stops once a subscription resolves', () => {
      const q = fakeQuery<SubscriptionQueryData>({ subscriptions: [makeSubscription()], active: makeSubscription() });
      expect(gateRefetchInterval(q, 0)).toBe(false);
    });

    it('stops once the time cap is reached even if no subscription resolved', () => {
      const q = fakeQuery<SubscriptionQueryData>({ subscriptions: [], active: null });
      expect(gateRefetchInterval(q, MAX_CONVERSION_POLL_DURATION_MS)).toBe(false);
    });

    it('keeps polling just under the time cap', () => {
      const q = fakeQuery<SubscriptionQueryData>({ subscriptions: [], active: null });
      expect(gateRefetchInterval(q, MAX_CONVERSION_POLL_DURATION_MS - 1)).toBe(CONVERSION_POLL_INTERVAL_MS);
    });
  });

  describe('attributesRefetchInterval', () => {
    const withFreePlan = (value: Record<string, unknown>) =>
      fakeQuery<AiroSubscription>({ ...makeSubscription(), attributes: [freePlanAttribute(value)] });

    it('does not poll when there is no subscriptionId', () => {
      expect(attributesRefetchInterval(fakeQuery<AiroSubscription>(undefined), undefined, 0)).toBe(false);
    });

    it('keeps polling while orderId has not landed yet', () => {
      const q = fakeQuery<AiroSubscription>({ ...makeSubscription(), attributes: [] });
      expect(attributesRefetchInterval(q, 'sub-1', 0)).toBe(CONVERSION_POLL_INTERVAL_MS);
    });

    it('stops once orderId is present (effect will fire)', () => {
      const q = withFreePlan({ orderId: 'order-123', conversionEventDate: null });
      expect(attributesRefetchInterval(q, 'sub-1', 0)).toBe(false);
    });

    it('stops when already acknowledged server-side', () => {
      const q = withFreePlan({ orderId: 'order-123', conversionEventDate: '2026-04-23T12:00:00Z' });
      expect(attributesRefetchInterval(q, 'sub-1', 0)).toBe(false);
    });

    it('stops at the time cap even if orderId never lands', () => {
      const q = fakeQuery<AiroSubscription>({ ...makeSubscription(), attributes: [] });
      expect(attributesRefetchInterval(q, 'sub-1', MAX_CONVERSION_POLL_DURATION_MS)).toBe(false);
    });
  });
});

describe('useConversionEvent', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    mockEndpoints();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fires the event and acknowledges for a trial subscription with unacknowledged conversion', async () => {
    const id = uniqueId();
    mockEndpoints({ id });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

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

  it('polls through the provisioning race: no subscription -> trial -> orderId, all without remount', async () => {
    const id = uniqueId();
    // The gate read returns no subscription, then a trial; the attributes read returns no
    // orderId, then an orderId. Swapping these across poll ticks exercises the actual wiring:
    // a regression that dropped refetchInterval from either query would never reach the fire.
    let listActive: AiroSubscription | null = null;
    let attrsValue: Record<string, unknown> = {};
    mockAppFetch.mockImplementation(function (url: string, init?: RequestInit) {
      if (typeof url === 'string' && url.includes('?include=attributes')) {
        return Promise.resolve(okJson({
          success: true,
          data: { ...makeSubscription({ id }), attributes: Object.keys(attrsValue).length ? [freePlanAttribute(attrsValue, id)] : [] },
        }));
      }
      if (typeof url === 'string' && url.endsWith('/acknowledge') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200 } as Response);
      }
      return Promise.resolve(okJson({
        success: true,
        data: { subscriptions: listActive ? [listActive] : [], active: listActive },
      }));
    });

    vi.useFakeTimers();
    try {
      renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

      // Phase 0: gate read resolves with no subscription -> attributes query never enabled.
      await vi.advanceTimersByTimeAsync(0);
      expect(mockAppFetch).toHaveBeenCalledWith('/api/subscriptions', expect.anything(), expect.anything());
      expect(mockAppFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
      expect(mockFireConversionEvent).not.toHaveBeenCalled();

      // Phase 1: trial provisions; the next gate poll observes it and enables the attributes
      // query, which still has no orderId. Two intervals: one to refetch the gate, one for the
      // enable->fetch chain (subscriptionId change re-renders, then the attributes query fetches).
      listActive = makeSubscription({ id });
      await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
      expect(mockAppFetch).toHaveBeenCalledWith(
        `/api/subscriptions/${id}?include=attributes`,
        expect.anything(),
      );
      expect(mockFireConversionEvent).not.toHaveBeenCalled();

      // Phase 2: free-plan orderId lands; a later attributes poll observes it and fires once.
      attrsValue = { orderId: `order-${id}`, conversionEventDate: null };
      await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
      expect(mockFireConversionEvent).toHaveBeenCalledWith({ orderId: `order-${id}` });
      expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);

      // Phase 3: both predicates must stop now. A wiring regression that returned the interval
      // on success would keep hammering the endpoints; assert the fetch counts are frozen.
      const attrFetchesAfterFire = mockAppFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('?include=attributes'),
      ).length;
      const gateFetchesAfterFire = mockAppFetch.mock.calls.filter(
        ([url]) => url === '/api/subscriptions',
      ).length;
      await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS * 3);
      const attrFetchesLater = mockAppFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('?include=attributes'),
      ).length;
      const gateFetchesLater = mockAppFetch.mock.calls.filter(
        ([url]) => url === '/api/subscriptions',
      ).length;
      expect(attrFetchesLater).toBe(attrFetchesAfterFire);
      expect(gateFetchesLater).toBe(gateFetchesAfterFire);
      expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fetch attributes for a non-trial subscription', async () => {
    mockEndpoints({ listActive: makeSubscription({ isTrial: false }) });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    // Let the gate read resolve.
    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith('/api/subscriptions', expect.anything(), expect.anything());
    });

    expect(mockAppFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('?include=attributes'),
      expect.anything(),
    );
    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when no subscription is provisioned yet', async () => {
    mockEndpoints({ listActive: null });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith('/api/subscriptions', expect.anything(), expect.anything());
    });

    expect(mockAppFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('?include=attributes'),
      expect.anything(),
    );
    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('warns once when the attributes poll exhausts without an orderId', async () => {
    const id = uniqueId();
    const { logger } = await import('@/lib/request-context');
    // Trial is present, but the free-plan attribute never gets an orderId, so the
    // attribute layer polls to the cap and stops. That silent stop must leave a breadcrumb.
    mockEndpoints({
      id,
      attributesResponse: okJson({
        success: true,
        data: { ...makeSubscription({ id }), attributes: [freePlanAttribute({ conversionEventDate: null }, id)] },
      }),
    });

    vi.useFakeTimers();
    try {
      renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });
      // Advance past the wall-clock cap, one poll interval at a time.
      const ticks = Math.ceil(MAX_CONVERSION_POLL_DURATION_MS / CONVERSION_POLL_INTERVAL_MS) + 1;
      for (let i = 0; i < ticks; i++) {
        await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
      }
    } finally {
      vi.useRealTimers();
    }

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
    const exhaustionCalls = logger.warn.mock.calls.filter(
      ([event, ctx]) => event === 'conversion.poll.exhausted' && (ctx as { layer?: string })?.layer === 'attributes' && (ctx as { subscriptionId?: string })?.subscriptionId === id,
    );
    expect(exhaustionCalls).toHaveLength(1);
  });

  it('does not fire when conversionEventDate is already set', async () => {
    mockEndpoints({
      attributesResponse: okJson({
        success: true,
        data: { ...makeSubscription(), attributes: [freePlanAttribute({ orderId: 'order-123', conversionEventDate: '2026-04-23T12:00:00Z' })] },
      }),
    });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when there is no free-plan attribute', async () => {
    mockEndpoints({
      attributesResponse: okJson({ success: true, data: { ...makeSubscription(), attributes: [] } }),
    });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when free-plan attribute has no orderId', async () => {
    mockEndpoints({
      attributesResponse: okJson({
        success: true,
        data: { ...makeSubscription(), attributes: [freePlanAttribute({ conversionEventDate: null })] },
      }),
    });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when orderId is not a string', async () => {
    mockEndpoints({
      attributesResponse: okJson({
        success: true,
        data: { ...makeSubscription(), attributes: [freePlanAttribute({ orderId: 123, conversionEventDate: null })] },
      }),
    });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('fires only once across rerenders', async () => {
    const id = uniqueId();
    mockEndpoints({ id });
    const wrapper = createWrapper(queryClient);
    const { rerender } = renderHook(() => useConversionEvent(), { wrapper });

    await waitFor(() => {
      expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
    });

    rerender();
    expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fire again for the same subscription across remounts', async () => {
    const id = uniqueId();
    mockEndpoints({ id });
    const wrapper = createWrapper(queryClient);
    const { unmount } = renderHook(() => useConversionEvent(), { wrapper });

    await waitFor(() => {
      expect(mockFireConversionEvent).toHaveBeenCalledTimes(1);
    });

    unmount();
    mockFireConversionEvent.mockClear();

    const queryClient2 = createQueryClient();
    mockEndpoints({ id });
    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient2) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining(`${id}?include=attributes`),
        expect.anything(),
      );
    });

    // acknowledgedIds is module-level, so the prior fire suppresses a re-fire.
    expect(mockFireConversionEvent).not.toHaveBeenCalled();
    queryClient2.clear();
  });

  it('logs an error when the acknowledge call rejects', async () => {
    const { logger } = await import('@/lib/request-context');
    mockEndpoints({ id: uniqueId(), acknowledgeResponse: () => Promise.reject(new Error('network error')) });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.acknowledge.error', expect.any(Object));
    });
  });

  it('logs a warning when the acknowledge POST returns non-ok and does not re-fire', async () => {
    const id = uniqueId();
    const { logger } = await import('@/lib/request-context');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockEndpoints({ id, acknowledgeResponse: { ok: false, status: 500 } as Response });

    const { rerender } = renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

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

  it('logs a non-Error rejection from the acknowledge call', async () => {
    const { logger } = await import('@/lib/request-context');
    mockEndpoints({ id: uniqueId(), acknowledgeResponse: () => Promise.reject('string rejection') });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith('conversion.acknowledge.error', expect.objectContaining({
        error: 'Unknown error',
      }));
    });
  });

  it('does not fire and logs an error when the attributes fetch returns non-ok', async () => {
    const { logger } = await import('@/lib/request-context');
    mockEndpoints({ attributesResponse: { ok: false, status: 403 } as Response });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

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

  it('logs the attributes error once across repeated poll failures', async () => {
    const id = uniqueId();
    const { logger } = await import('@/lib/request-context');
    // Each failed poll throws a fresh error instance; without per-key dedup the keyed effect
    // would re-fire every ~5s until the cap. Assert one log despite many failing ticks.
    mockEndpoints({ id, attributesResponse: { ok: false, status: 403 } as Response });

    vi.useFakeTimers();
    try {
      renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(CONVERSION_POLL_INTERVAL_MS);
      }
    } finally {
      vi.useRealTimers();
    }

    const errorCalls = logger.warn.mock.calls.filter(
      ([event, ctx]) => event === 'conversion.attributes.error' && (ctx as { subscriptionId?: string })?.subscriptionId === id,
    );
    expect(errorCalls).toHaveLength(1);
  });

  it('does not fire when the attributes fetch returns an unsuccessful body', async () => {
    mockEndpoints({ attributesResponse: okJson({ success: false, error: 'bad data' }) });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });

  it('does not fire when the attributes fetch returns missing data', async () => {
    mockEndpoints({ attributesResponse: okJson({ success: true, data: null }) });

    renderHook(() => useConversionEvent(), { wrapper: createWrapper(queryClient) });

    await waitFor(() => {
      expect(mockAppFetch).toHaveBeenCalledWith(
        expect.stringContaining('?include=attributes'),
        expect.anything(),
      );
    });

    expect(mockFireConversionEvent).not.toHaveBeenCalled();
  });
});
