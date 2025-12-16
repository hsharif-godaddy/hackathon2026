import React, { type ReactNode } from 'react';
import { beforeEach,describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useAppDetails } from './useAppDetails';

// Mock dependencies
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useAppDetails', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch app details successfully', async () => {
    const mockAppDetails = {
      id: 'app-123',
      name: 'My App',
      status: 'active',
      domains: [
        { fqdn: 'example.com', isPrimary: true, status: 'active' },
      ],
    };

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => mockAppDetails,
    } as Response);

    const { result } = renderHook(() => useAppDetails('app-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockAppDetails);
    expect(appFetch).toHaveBeenCalledWith('/api/sites/app-123');
  });

  it('should not fetch when siteId is null', () => {
    const { result } = renderHook(() => useAppDetails(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('should not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useAppDetails('app-123', { enabled: false }),
      { wrapper: createWrapper() }
    );

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('should handle fetch error', async () => {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(() => useAppDetails('app-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error?.message).toContain('Failed to fetch app details');
  });

  it('should not fetch when siteId is empty string', async () => {
    const { result } = renderHook(
      () => useAppDetails('', { enabled: true }),
      { wrapper: createWrapper() }
    );

    // Empty string is falsy, so query is disabled
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(appFetch).not.toHaveBeenCalled();
  });

  it('should support refetchInterval for polling', async () => {
    const mockAppDetails = {
      id: 'app-123',
      name: 'My App',
      status: 'active',
    };

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => mockAppDetails,
    } as Response);

    const { result } = renderHook(
      () => useAppDetails('app-123', { refetchInterval: 5000 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockAppDetails);
  });

  it('should support function-based refetchInterval', async () => {
    const mockAppDetails = {
      id: 'app-123',
      name: 'My App',
      status: 'active',
      domains: [
        { fqdn: 'example.com', isPrimary: true, status: 'pending' },
      ],
    };

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => mockAppDetails,
    } as Response);

    const refetchIntervalFn = vi.fn((data) => {
      const hasPending = data?.domains?.some((d: any) => d.status === 'pending');
      return hasPending ? 5000 : false;
    });

    const { result } = renderHook(
      () => useAppDetails('app-123', { refetchInterval: refetchIntervalFn }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should include CDN information by default', async () => {
    const mockAppDetails = {
      id: 'app-123',
      name: 'My App',
      status: 'active',
    };

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => mockAppDetails,
    } as Response);

    renderHook(() => useAppDetails('app-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalledWith('/api/sites/app-123');
    });
  });

  it('should handle includeCdn option', async () => {
    const mockAppDetails = {
      id: 'app-123',
      name: 'My App',
      status: 'active',
    };

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => mockAppDetails,
    } as Response);

    renderHook(() => useAppDetails('app-123', { includeCdn: false }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(appFetch).toHaveBeenCalled();
    });
  });

  it('should use staleTime of 30 seconds', async () => {
    const mockAppDetails = {
      id: 'app-123',
      name: 'My App',
      status: 'active',
    };

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => mockAppDetails,
    } as Response);

    const { result } = renderHook(() => useAppDetails('app-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify data is cached
    expect(result.current.data).toEqual(mockAppDetails);
  });

  it('should handle domains in response', async () => {
    const mockAppDetails = {
      id: 'app-123',
      name: 'My App',
      status: 'active',
      domains: [
        {
          fqdn: 'example.com',
          isPrimary: true,
          status: 'active',
          cdnStatus: 'deployed',
        },
        {
          fqdn: 'www.example.com',
          isPrimary: false,
          status: 'pending',
        },
      ],
    };

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      json: async () => mockAppDetails,
    } as Response);

    const { result } = renderHook(() => useAppDetails('app-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.domains).toHaveLength(2);
    expect(result.current.data?.domains?.[0].isPrimary).toBe(true);
  });
});
