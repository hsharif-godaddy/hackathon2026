import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useDomainAttach } from './useDomainAttach';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useDomainAttach', () => {
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

  it('should attach domain successfully', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Domain attached' }),
    } as Response);

    const { result } = renderHook(() => useDomainAttach(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      domainName: 'example.com',
      ip: '192.168.1.1',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should handle attach error', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid domain' }),
    } as Response);

    const { result } = renderHook(() => useDomainAttach(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      domainName: 'invalid.com',
      ip: '192.168.1.1',
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    }, { timeout: 10000 });
  }, 15000);
});
