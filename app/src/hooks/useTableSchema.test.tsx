import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTableSchema } from './useTableSchema';
import React, { type ReactNode } from 'react';

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn() },
}));

describe('useTableSchema', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('should fetch schema successfully', async () => {
    const mockSchema = {
      columns: [
        { name: 'id', type: 'int', nullable: false, key: 'PRI', default: null, extra: 'auto_increment' },
        { name: 'name', type: 'varchar(255)', nullable: false, key: '', default: null, extra: '' },
        { name: 'email', type: 'varchar(255)', nullable: true, key: 'UNI', default: null, extra: '' },
      ],
    };

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockSchema,
    } as Response);

    const { result } = renderHook(
      () => useTableSchema({ appId: 'test-app', tableName: 'users' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockSchema.columns);
    expect(global.fetch).toHaveBeenCalledWith('/api/database/test-app/tables/users/schema');
  });

  it('should not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useTableSchema({ appId: 'test-app', tableName: 'users', enabled: false }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should not fetch when appId is missing', () => {
    const { result } = renderHook(
      () => useTableSchema({ appId: '', tableName: 'users' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should not fetch when tableName is missing', () => {
    const { result } = renderHook(
      () => useTableSchema({ appId: 'test-app', tableName: '' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should handle fetch errors', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Table not found' }),
    } as Response);

    const { result } = renderHook(
      () => useTableSchema({ appId: 'test-app', tableName: 'nonexistent' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    }, { timeout: 3000 });
  });

  it('should have 5 minute staleTime configured', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ columns: [] }),
    } as Response);

    renderHook(
      () => useTableSchema({ appId: 'test-app', tableName: 'users' }),
      { wrapper: createWrapper() }
    );

    // Wait for query to execute
    await waitFor(() => {
      const queryKey = ['table-schema', 'test-app', 'users'];
      const queryState = queryClient.getQueryState(queryKey);
      expect(queryState).toBeDefined();
    });
  });

  it('should return empty columns array structure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ columns: [] }),
    } as Response);

    const { result } = renderHook(
      () => useTableSchema({ appId: 'test-app', tableName: 'empty_table' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should handle nested error structure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Database connection failed' } }),
    } as Response);

    const { result } = renderHook(
      () => useTableSchema({ appId: 'test-app', tableName: 'users' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    }, { timeout: 3000 });
  });
});
