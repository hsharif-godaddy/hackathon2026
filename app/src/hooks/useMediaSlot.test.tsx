/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useMediaSlot } from './useMediaSlot';

const mockAppId = 'app-123';
const mockSlotName = 'pages/home/hero';

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

describe('useMediaSlot', function useMediaSlotTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('fetches slot data with normalized agent URL', async function fetchesSlot() {
    const mockSlot = { currentUrl: '/img1.jpg', alternatives: [] };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, slot: mockSlot }),
    });

    const { result } = renderHook(
      function useTestMediaSlot() {
        return useMediaSlot({ appId: mockAppId, slotName: mockSlotName });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.slot).toEqual(mockSlot);
    expect(global.fetch).toHaveBeenCalledWith(
      `https://agent.example.com/media/${mockAppId}/slots/${mockSlotName}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
        }),
      }),
    );
  });

  it('returns null when appId is null', async function nullAppId() {
    const { result } = renderHook(
      function useTestMediaSlotNullApp() {
        return useMediaSlot({ appId: null, slotName: mockSlotName });
      },
      { wrapper: createWrapper() },
    );

    expect(result.current.slot).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces plain-text HTTP error bodies', async function httpErrorBody() {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Slot not found: pages/home/hero',
    });

    const { result } = renderHook(
      function useTestMediaSlotHttpError() {
        return useMediaSlot({ appId: mockAppId, slotName: mockSlotName });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.slot).toBeNull();
    expect(result.current.error).toBe('Slot not found: pages/home/hero');
  });
});
