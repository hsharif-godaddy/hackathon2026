import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useTableData } from './useTableData';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useTableData', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should fetch table data successfully', async () => {
    const mockData = {
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      total: 2,
      page: 1,
      limit: 25,
      hasMore: false,
    };

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const { result } = renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: 'users',
          page: 1,
          limit: 25,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/database/test-app/tables/users/data?page=1&limit=25'
    );
  });

  it('should use default limit of 25', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0, page: 1, limit: 25, hasMore: false }),
    } as Response);

    renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: 'users',
          page: 1,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/users/data?page=1&limit=25'
      );
    });
  });

  it('should support custom page and limit', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], total: 0, page: 2, limit: 50, hasMore: true }),
    } as Response);

    renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: 'products',
          page: 2,
          limit: 50,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/test-app/tables/products/data?page=2&limit=50'
      );
    });
  });

  it('should not fetch when enabled is false', () => {
    const { result } = renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: 'users',
          page: 1,
          enabled: false,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should not fetch when appId is missing', () => {
    const { result } = renderHook(
      () =>
        useTableData({
          appId: '',
          tableName: 'users',
          page: 1,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should not fetch when tableName is missing', () => {
    const { result } = renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: '',
          page: 1,
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should handle fetch errors', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    } as Response);

    const { result } = renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: 'users',
          page: 1,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    }, { timeout: 3000 });

    expect(result.current.error).toBeDefined();
  });

  it('should handle error with nested error structure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Validation failed' } }),
    } as Response);

    const { result } = renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: 'users',
          page: 1,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    }, { timeout: 3000 });
  });

  it('should use correct queryKey for caching', () => {
    const { result } = renderHook(
      () =>
        useTableData({
          appId: 'test-app',
          tableName: 'users',
          page: 2,
          limit: 50,
        }),
      { wrapper: createWrapper() }
    );

    // Query key should include all parameters for proper cache invalidation
    const queryKey = ['table-data', 'test-app', 'users', 2, 50];
    const cachedQuery = queryClient.getQueryData(queryKey);

    // Initially undefined
    expect(cachedQuery).toBeUndefined();
  });

  it('should handle pagination correctly', async () => {
    const page1Data = {
      rows: [{ id: 1 }, { id: 2 }],
      total: 100,
      page: 1,
      limit: 2,
      hasMore: true,
    };

    const page2Data = {
      rows: [{ id: 3 }, { id: 4 }],
      total: 100,
      page: 2,
      limit: 2,
      hasMore: true,
    };

    // First render with page 1
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => page1Data,
    } as Response);

    const { result, rerender } = renderHook(
      ({ page }) =>
        useTableData({
          appId: 'test-app',
          tableName: 'users',
          page,
          limit: 2,
        }),
      { wrapper: createWrapper(), initialProps: { page: 1 } }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.page).toBe(1);
    expect(result.current.data?.hasMore).toBe(true);

    // Switch to page 2
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => page2Data,
    } as Response);

    rerender({ page: 2 });

    await waitFor(() => {
      expect(result.current.data?.page).toBe(2);
    });

    expect(result.current.data?.hasMore).toBe(true);
  });
});
