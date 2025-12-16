import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useSubscriptionCache } from './useSubscriptionCache';

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn() },
}));

const mockInitialize = vi.fn();
const mockRefresh = vi.fn();
const mockStore = {
  lastRefresh: null,
  isRefreshing: false,
  cacheHits: 0,
  cacheMisses: 0,
};

vi.mock('@/stores/useSubscriptionCacheStore', () => ({
  useSubscriptionCacheStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({
        initialize: mockInitialize,
        refresh: mockRefresh,
        ...mockStore,
      });
    }
    return mockStore;
  }),
}));

describe('useSubscriptionCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockStore.lastRefresh = null;
    mockStore.isRefreshing = false;
    mockStore.cacheHits = 0;
    mockStore.cacheMisses = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize cache when JWT is provided', () => {
    renderHook(() => useSubscriptionCache('test-jwt-token'));

    expect(mockInitialize).toHaveBeenCalledWith('test-jwt-token');
  });

  it('should not initialize cache when JWT is null', () => {
    renderHook(() => useSubscriptionCache(null));

    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it('should return cache stats', () => {
    mockStore.cacheHits = 80;
    mockStore.cacheMisses = 20;
    mockStore.lastRefresh = new Date('2024-01-01');
    mockStore.isRefreshing = false;

    const { result } = renderHook(() => useSubscriptionCache('test-jwt'));

    expect(result.current.cacheHits).toBe(80);
    expect(result.current.cacheMisses).toBe(20);
    expect(result.current.hitRate).toBe(80); // 80/100 * 100 = 80%
    expect(result.current.lastRefresh).toEqual(new Date('2024-01-01'));
    expect(result.current.isRefreshing).toBe(false);
  });

  it('should calculate hit rate correctly', () => {
    mockStore.cacheHits = 75;
    mockStore.cacheMisses = 25;

    const { result } = renderHook(() => useSubscriptionCache('test-jwt'));

    expect(result.current.hitRate).toBe(75); // 75/100 * 100 = 75%
  });

  it('should return 0 hit rate when no cache accesses', () => {
    mockStore.cacheHits = 0;
    mockStore.cacheMisses = 0;

    const { result } = renderHook(() => useSubscriptionCache('test-jwt'));

    expect(result.current.hitRate).toBe(0);
  });

  it('should round hit rate to 2 decimal places', () => {
    mockStore.cacheHits = 2;
    mockStore.cacheMisses = 3;

    const { result } = renderHook(() => useSubscriptionCache('test-jwt'));

    // 2/5 * 100 = 40%
    expect(result.current.hitRate).toBe(40);
  });

  it('should setup background refresh timer when JWT is provided', () => {
    renderHook(() => useSubscriptionCache('test-jwt'));

    // Initially not called
    expect(mockRefresh).not.toHaveBeenCalled();

    // Fast-forward 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(mockRefresh).toHaveBeenCalledWith('test-jwt', false);
  });

  it('should call refresh multiple times on interval', () => {
    renderHook(() => useSubscriptionCache('test-jwt'));

    // Fast-forward 15 minutes (3 intervals)
    vi.advanceTimersByTime(15 * 60 * 1000);

    expect(mockRefresh).toHaveBeenCalledTimes(3);
  });

  it('should not setup refresh timer when JWT is null', () => {
    renderHook(() => useSubscriptionCache(null));

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('should cleanup refresh timer on unmount', () => {
    const { unmount } = renderHook(() => useSubscriptionCache('test-jwt'));

    unmount();

    // Timer should be cleared, so advancing time should not trigger refresh
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('should re-initialize when JWT changes', () => {
    const { rerender } = renderHook(
      ({ jwt }) => useSubscriptionCache(jwt),
      { initialProps: { jwt: 'token-1' } }
    );

    expect(mockInitialize).toHaveBeenCalledWith('token-1');

    mockInitialize.mockClear();

    rerender({ jwt: 'token-2' });

    expect(mockInitialize).toHaveBeenCalledWith('token-2');
  });

  it('should handle transition from null to valid JWT', () => {
    const { rerender } = renderHook(
      ({ jwt }) => useSubscriptionCache(jwt),
      { initialProps: { jwt: null } }
    );

    expect(mockInitialize).not.toHaveBeenCalled();

    rerender({ jwt: 'new-token' });

    expect(mockInitialize).toHaveBeenCalledWith('new-token');
  });
});
