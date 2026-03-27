import React, { type ReactNode } from 'react';
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useSecretOperations } from './useSecretOperations';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useSecretOperations', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should perform secret operations successfully', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Operations completed',
        operations: { added: 1, updated: 1, deleted: 1 },
      }),
    } as Response);

    const { result } = renderHook(() => useSecretOperations(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      variant: 'preview',
      operations: {
        additions: [{ name: 'NEW_KEY', value: 'value' }],
        updates: [{ name: 'EXISTING_KEY', value: 'new_value' }],
        deletions: ['OLD_KEY'],
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.operations.added).toBe(1);
  });

  it('should handle operation error', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid secret' }),
    } as Response);

    const { result } = renderHook(() => useSecretOperations(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      appId: 'app-123',
      variant: 'preview',
      operations: {
        additions: [{ name: '', value: '' }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
