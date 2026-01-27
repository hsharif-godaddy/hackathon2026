import React, { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useModifyDomains } from './useModifyDomains';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useModifyDomains', () => {
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

  it('should modify domains successfully', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        statusJobId: 'job-123',
        status: 'pending',
        message: 'Domain modification started',
      }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'new.example.com', primary: false }],
      },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.statusJobId).toBe('job-123');
  });

  it('should handle modification error', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid domain' }),
    } as Response);

    const { result } = renderHook(() => useModifyDomains(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'invalid', primary: false }],
      },
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
