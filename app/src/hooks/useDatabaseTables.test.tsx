import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useDatabaseTables } from './useDatabaseTables';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useDatabaseTables', () => {
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

  it('should fetch tables successfully', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ tables: ['users', 'posts'], count: 2 }),
    } as Response);

    const { result } = renderHook(
      () => useDatabaseTables({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(['users', 'posts']);
  });

  it('should handle 404 as empty state', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(
      () => useDatabaseTables({ appId: 'app-123' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should not fetch when appId is missing', () => {
    const { result } = renderHook(
      () => useDatabaseTables({ appId: '' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useDatabaseTables({ appId: 'app-123', enabled: false }),
      { wrapper: createWrapper() }
    );

    expect(result.current.fetchStatus).toBe('idle');
  });
});
