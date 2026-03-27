import { beforeEach,describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useMediaManifest } from './useMediaManifest';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (options: unknown) => actual.useQuery({ ...(options as Record<string, unknown>), retry: false }),
  };
});

const mockAppId = 'app-123';

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useMediaManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns null manifest when appId is null', async () => {
    const { result } = renderHook(() => useMediaManifest({ appId: null }), {
      wrapper: createWrapper(),
    });

    expect(result.current.manifest).toBeNull();
    expect(result.current.slotNames).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches and returns manifest successfully', async () => {
    const mockManifest = {
      'slot-1': { currentUrl: '/img1.jpg', alternatives: [] },
      'slot-2': { currentUrl: '/img2.jpg', alternatives: [] },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, manifest: mockManifest }),
    });

    const { result } = renderHook(() => useMediaManifest({ appId: mockAppId }), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.manifest).toEqual(mockManifest);
    expect(result.current.slotNames).toEqual(['slot-1', 'slot-2']);
    expect(result.current.error).toBeNull();
    
    expect(global.fetch).toHaveBeenCalledWith(
      'https://agent.example.com/media/app-123/manifest',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
        }),
      })
    );
  });

  it('handles fetch error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    });

    const { result } = renderHook(() => useMediaManifest({ appId: mockAppId }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe('Internal Server Error');
  });

  it('handles missing agent url', async () => {
    const { dynamicApiConfigService } = await import('@/config/dynamic-api');
    (dynamicApiConfigService.getConfigForSite as ReturnType<typeof vi.fn>).mockResolvedValue({ agentUrl: null });

    const { result } = renderHook(() => useMediaManifest({ appId: mockAppId }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe('Agent URL not available');
  });

  it('does not fetch when enabled is false', async () => {
    const { result } = renderHook(() => useMediaManifest({ appId: mockAppId, enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
