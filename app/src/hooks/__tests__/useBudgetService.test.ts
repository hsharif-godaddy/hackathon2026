/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import type { CreditStatusResponse } from '@/types/budget';
import { useBudgetService } from '../useBudgetService';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockBudgetData: CreditStatusResponse = {
  budgetId: 'sub-123',
  productKey: 'airo-builder',
  creditsTotal: '1000.000000',
  creditsUsed: '250.000000',
  creditsPending: '10.000000',
  creditsTotalNumeric: 1000,
  creditsUsedNumeric: 250,
  creditsPendingNumeric: 10,
  items: [
    {
      budgetItemId: 'item-1',
      creditsTotal: '500.000000',
      creditsUsed: '200.000000',
      costToCreditRatio: '1.000000',
      startsAt: '2026-04-01T00:00:00Z',
      expiresAt: '2026-05-01T00:00:00Z',
      resetInterval: 'monthly',
      creditsTotalNumeric: 500,
      creditsUsedNumeric: 200,
      type: 'plan-monthly',
    },
    {
      budgetItemId: 'item-2',
      creditsTotal: '500.000000',
      creditsUsed: '50.000000',
      costToCreditRatio: '1.000000',
      startsAt: '2026-04-01T00:00:00Z',
      expiresAt: '2026-07-01T00:00:00Z',
      resetInterval: null,
      creditsTotalNumeric: 500,
      creditsUsedNumeric: 50,
      type: 'credit-pack',
    },
  ],
};

describe('useBudgetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('fetches credit status when enabled with subscriptionId', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockBudgetData }),
    } as Response);

    const { result } = renderHookWithProviders(() =>
      useBudgetService({ subscriptionId: 'sub-123', enabled: true })
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data).toEqual(mockBudgetData);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/credits/status?subscriptionId=sub-123',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('isFetching is true during background refetch, isLoading only on first fetch', async () => {
    let resolveRefetch!: (value: Response) => void;

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockBudgetData }),
      } as Response)
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveRefetch = resolve; })
      );

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      },
    });

    const { result } = renderHookWithProviders(
      () => useBudgetService({ subscriptionId: 'sub-123', enabled: true }),
      { queryClient }
    );

    // First fetch: isLoading = true
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // After first fetch: isLoading = false
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);

    // Trigger background refetch (blocks on deferred promise)
    result.current.refetch();

    await waitFor(() => {
      expect(result.current.isFetching).toBe(true);
    });

    // During refetch: isFetching true, isLoading false (data already exists)
    expect(result.current.isLoading).toBe(false);

    // Resolve the deferred refetch
    resolveRefetch({
      ok: true,
      json: async () => ({ success: true, data: mockBudgetData }),
    } as Response);

    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    });
  });

  it('returns disabled state when enabled is false', () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    const { result } = renderHookWithProviders(() =>
      useBudgetService({ subscriptionId: 'sub-123', enabled: false })
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('disables query when subscriptionId is undefined', () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    const { result } = renderHookWithProviders(() =>
      useBudgetService({ subscriptionId: undefined, enabled: true })
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not retry on 4xx error', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Budget not found' }),
    } as Response);

    // Use a custom QueryClient that respects hook retry config
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: Infinity },
      },
    });

    const { result } = renderHookWithProviders(
      () => useBudgetService({ subscriptionId: 'sub-123', enabled: true }),
      { queryClient }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Only called once (no retries for 4xx)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx error', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'Bad Gateway' }),
    } as Response);

    // Use a custom QueryClient that respects hook retry config
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: Infinity },
      },
    });

    const { result } = renderHookWithProviders(
      () => useBudgetService({ subscriptionId: 'sub-123', enabled: true }),
      { queryClient }
    );

    // retryDelay: min(1000 * 2^attempt, 30000) -> 1s, 2s, 4s = 7s total
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    }, { timeout: 10_000 });

    // Initial + 3 retries = 4 calls
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  }, 15_000);

  it('handles creditsTotalNumeric of 0 without NaN', async () => {
    const zeroBudget: CreditStatusResponse = {
      ...mockBudgetData,
      creditsTotal: '0.000000',
      creditsUsed: '0.000000',
      creditsTotalNumeric: 0,
      creditsUsedNumeric: 0,
      items: [],
    };

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: zeroBudget }),
    } as Response);

    const { result } = renderHookWithProviders(() =>
      useBudgetService({ subscriptionId: 'sub-123', enabled: true })
    );

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    const remaining = result.current.data!.creditsTotalNumeric - result.current.data!.creditsUsedNumeric;
    expect(remaining).toBe(0);
    expect(Number.isNaN(remaining)).toBe(false);
  });
});
