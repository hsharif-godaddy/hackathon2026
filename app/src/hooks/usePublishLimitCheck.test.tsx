/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { SubscriptionPlan } from '@/types/credits';
import { usePublishLimitCheck } from './usePublishLimitCheck';
import type { SubscriptionQueryData } from './useSubscription';
import { SUBSCRIPTIONS_QUERY_KEY } from './useSubscription';

// --- Module mocks ---

vi.mock('@/lib/logging', () => ({ shipAnalyticsLog: vi.fn() }));
vi.mock('@/lib/gasket-config', () => ({ appFetch: vi.fn() }));

vi.mock('./usePublishedApps', () => ({
  usePublishedApps: vi.fn(() => ({
    publishedApps: [],
    count: 0,            // hook destructures as `count: publishedCount`
    publishedAppIds: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

vi.mock('./useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => false),
}));

// --- Controlled QueryClient mock ---
//
// confirmCanPublish does three things with the QueryClient:
//   1. refetchQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY }) — force a fresh fetch
//   2. getQueryData(SUBSCRIPTIONS_QUERY_KEY)               — read fresh cache value
//   3. getQueryState(SUBSCRIPTIONS_QUERY_KEY)?.status      — detect thrown errors
//
// We mock useQueryClient() to return a controlled stub so we can inject the
// desired post-refetch state (fresh data or error) synchronously, without
// relying on React Query internals or network I/O timing.
//
// vi.hoisted() is required: vi.mock factories are hoisted before const declarations,
// so any variable captured in a factory closure must be declared via vi.hoisted().
const { mockRefetchQueries, mockGetQueryData, mockGetQueryState } = vi.hoisted(() => ({
  mockRefetchQueries: vi.fn<() => Promise<void>>(),
  mockGetQueryData: vi.fn<() => SubscriptionQueryData | undefined>(),
  mockGetQueryState: vi.fn<() => { status: string } | undefined>(),
}));

// Real QueryClient is still needed for useSubscription's useQuery (renders
// without side-effects because the seeded data is fresh).
function makeRealClient(): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
    },
  });
  qc.setQueryData(SUBSCRIPTIONS_QUERY_KEY, { active: null, subscriptions: [] });
  return qc;
}

vi.mock('./useSubscription', async (importOriginal) => {
  const original = await importOriginal<typeof import('./useSubscription')>();
  return {
    ...original,
    useSubscription: vi.fn(() => ({
      data: undefined,
      subscriptions: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })),
  };
});

// Swap useQueryClient to return our controlled stub.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...original,
    useQueryClient: vi.fn(() => ({
      refetchQueries: mockRefetchQueries,
      getQueryData: mockGetQueryData,
      getQueryState: mockGetQueryState,
      // Pass through everything else needed by useQuery/QueryClientProvider
    })),
  };
});

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

function makeSub(plan: SubscriptionPlan): SubscriptionQueryData {
  return {
    active: { id: 'sub-1', plan, status: 'active', customerId: 'cust-1', productId: 'aab-v1', isTrial: false },
    subscriptions: [{ id: 'sub-1', plan, status: 'active', customerId: 'cust-1', productId: 'aab-v1', isTrial: false }],
  };
}

describe('usePublishLimitCheck — confirmCanPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Safe defaults: refetch is a no-op, no query data, no error state.
    mockRefetchQueries.mockResolvedValue(undefined);
    mockGetQueryData.mockReturnValue(undefined);
    mockGetQueryState.mockReturnValue({ status: 'success' });
  });

  it('returns hasPaidPlan:true and canPublish:true when fresh data has a paid plan', async () => {
    // After the refetch, cache contains an Ultimate subscription.
    mockGetQueryData.mockReturnValue(makeSub(SubscriptionPlan.Ultimate));

    const { result } = renderHook(
      () => usePublishLimitCheck({ currentAppId: 'app-1', enabled: true }),
      { wrapper: wrapper(makeRealClient()) }
    );

    let confirmResult: Awaited<ReturnType<typeof result.current.confirmCanPublish>>;
    await act(async () => {
      confirmResult = await result.current.confirmCanPublish();
    });

    expect(mockRefetchQueries).toHaveBeenCalledWith({ queryKey: SUBSCRIPTIONS_QUERY_KEY });
    expect(confirmResult!.hasPaidPlan).toBe(true);
    expect(confirmResult!.isError).toBe(false);
    expect(confirmResult!.canPublish).toBe(true);
  });

  it('returns hasPaidPlan:false and isError:false when fresh data is 200+active:null (403→null scenario)', async () => {
    // Refetch returns a successful 200+null — this is the BFF's 403→null mapping.
    // It is a successful response (not a thrown error), so isError stays false.
    mockGetQueryData.mockReturnValue({ active: null, subscriptions: [] });
    mockGetQueryState.mockReturnValue({ status: 'success' });

    const { result } = renderHook(
      () => usePublishLimitCheck({ currentAppId: 'app-1', enabled: true }),
      { wrapper: wrapper(makeRealClient()) }
    );

    let confirmResult: Awaited<ReturnType<typeof result.current.confirmCanPublish>>;
    await act(async () => {
      confirmResult = await result.current.confirmCanPublish();
    });

    // 200+null is NOT a thrown error — isError:false means caller will paywall (not fail open).
    expect(confirmResult!.hasPaidPlan).toBe(false);
    expect(confirmResult!.isError).toBe(false);
  });

  it('returns isError:true when the refetch throws (fail-open path)', async () => {
    // Refetch threw a network/auth error — query is in error state, cache may be stale/empty.
    mockGetQueryData.mockReturnValue(undefined);
    mockGetQueryState.mockReturnValue({ status: 'error' });

    const { result } = renderHook(
      () => usePublishLimitCheck({ currentAppId: 'app-1', enabled: true }),
      { wrapper: wrapper(makeRealClient()) }
    );

    let confirmResult: Awaited<ReturnType<typeof result.current.confirmCanPublish>>;
    await act(async () => {
      confirmResult = await result.current.confirmCanPublish();
    });

    // A thrown fetch error → isError:true → caller must fail open (let publish proceed).
    expect(confirmResult!.isError).toBe(true);
    expect(confirmResult!.hasPaidPlan).toBe(false);
  });

  it('uses fresh cache value (Starter), not the stale render-time value (Free)', async () => {
    // The component rendered with a Free plan (no publish access).
    // The forced refetch returned a Starter subscription (user purchased between renders).
    mockGetQueryData.mockReturnValue(makeSub(SubscriptionPlan.Starter));
    mockGetQueryState.mockReturnValue({ status: 'success' });

    const { result } = renderHook(
      () => usePublishLimitCheck({ currentAppId: 'app-1', enabled: true }),
      { wrapper: wrapper(makeRealClient()) }
    );

    let confirmResult: Awaited<ReturnType<typeof result.current.confirmCanPublish>>;
    await act(async () => {
      confirmResult = await result.current.confirmCanPublish();
    });

    // confirmCanPublish must use the post-refetch cache (Starter = paid),
    // not the stale render-time snapshot (Free = unpaid).
    expect(confirmResult!.hasPaidPlan).toBe(true);
    expect(confirmResult!.canPublish).toBe(true);
  });
});
