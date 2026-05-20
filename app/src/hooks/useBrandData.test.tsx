/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { BRAND_DATA_UPDATED_EVENT, useBrandData } from './useBrandData';

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicApiUrl: vi.fn(),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const BRAND_URL = 'https://agent.example/apps/app-123/brand-data';

const mockBrandData = {
  version: 1,
  brandName: 'TestBrand',
  palette: {
    primary: '#000',
    secondary: '#111',
    accent: '#222',
    background: '#fff',
    foreground: '#000',
    theme: 'light' as const,
  },
};

function mockResponse(init: { ok: boolean; status?: number; statusText?: string; json?: unknown; text?: string }) {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    statusText: init.statusText ?? '',
    json: async () => init.json ?? {},
    text: async () => init.text ?? '',
  } as unknown as Response;
}

describe('useBrandData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildDynamicApiUrl).mockResolvedValue(BRAND_URL);
  });

  describe('enabled option', () => {
    it('does not fetch when enabled is false', async () => {
      const { result } = renderHook(() => useBrandData('app-123', { enabled: false }));

      // Allow any pending microtasks (none expected) to flush
      await Promise.resolve();

      expect(agentFetch).not.toHaveBeenCalled();
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('fetches when enabled is true (default)', async () => {
      vi.mocked(agentFetch).mockResolvedValue(mockResponse({ ok: true, json: mockBrandData }));

      const { result } = renderHook(() => useBrandData('app-123'));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockBrandData);
      });

      expect(agentFetch).toHaveBeenCalledWith(BRAND_URL, { siteId: 'app-123' });
    });

    it('fetches when enabled flips from false to true', async () => {
      vi.mocked(agentFetch).mockResolvedValue(mockResponse({ ok: true, json: mockBrandData }));

      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => useBrandData('app-123', { enabled }),
        { initialProps: { enabled: false } },
      );

      expect(agentFetch).not.toHaveBeenCalled();

      rerender({ enabled: true });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockBrandData);
      });
      expect(agentFetch).toHaveBeenCalledTimes(1);
    });

    it('does not fetch when appId is undefined regardless of enabled', async () => {
      renderHook(() => useBrandData(undefined, { enabled: true }));
      await Promise.resolve();
      expect(agentFetch).not.toHaveBeenCalled();
    });

    it('ignores BRAND_DATA_UPDATED_EVENT while disabled', async () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useBrandData('app-123', { enabled: false }));

        act(() => {
          window.dispatchEvent(new CustomEvent(BRAND_DATA_UPDATED_EVENT, { detail: { appId: 'app-123' } }));
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(600);
        });

        expect(agentFetch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('error handling', () => {
    it('treats 401 as not-ready (no error surfaced, debug-logged)', async () => {
      vi.mocked(agentFetch).mockResolvedValue(
        mockResponse({ ok: false, status: 401, statusText: 'Unauthorized', text: 'unauthorized' }),
      );

      const { result } = renderHook(() => useBrandData('app-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'hook.brand_data.fetch.skip_401',
        expect.objectContaining({ appId: 'app-123', attempt: 1 }),
      );
    });

    it('escalates to warn after persistent 401s', async () => {
      vi.mocked(agentFetch).mockResolvedValue(
        mockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }),
      );

      const { result } = renderHook(() => useBrandData('app-123'));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Two more retries via refetch (event-triggered path is debounced;
      // refetch is the synchronous equivalent for test purposes).
      await act(async () => {
        await result.current.refetch();
      });
      await act(async () => {
        await result.current.refetch();
      });

      expect(vi.mocked(logger.debug).mock.calls.filter(([name]) => name === 'hook.brand_data.fetch.skip_401')).toHaveLength(3);
      expect(logger.warn).toHaveBeenCalledWith(
        'hook.brand_data.fetch.persistent_401',
        expect.objectContaining({ appId: 'app-123', attempts: 3 }),
      );
      expect(vi.mocked(logger.warn).mock.calls.filter(([name]) => name === 'hook.brand_data.fetch.persistent_401')).toHaveLength(1);
    });

    it('resets the 401 counter after a successful fetch', async () => {
      vi.mocked(agentFetch)
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }))
        .mockResolvedValueOnce(mockResponse({ ok: true, json: mockBrandData }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }));

      const { result } = renderHook(() => useBrandData('app-123'));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.refetch();
      });
      await act(async () => {
        await result.current.refetch();
      });
      await act(async () => {
        await result.current.refetch();
      });

      // 3 401s total but split by a success → counter never reaches threshold
      expect(logger.warn).not.toHaveBeenCalledWith(
        'hook.brand_data.fetch.persistent_401',
        expect.anything(),
      );
    });

    it('logs body and surfaces error on non-401 failure', async () => {
      vi.mocked(agentFetch).mockResolvedValue(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: '{"error":"db down"}',
        }),
      );

      const { result } = renderHook(() => useBrandData('app-123'));

      await waitFor(() => {
        expect(result.current.error).toBeInstanceOf(Error);
      });

      expect(result.current.error?.message).toContain('500');
      expect(result.current.error?.message).toContain('Internal Server Error');
      expect(logger.warn).toHaveBeenCalledWith(
        'hook.brand_data.fetch.failure',
        expect.objectContaining({
          appId: 'app-123',
          status: 500,
          statusText: 'Internal Server Error',
          body: '{"error":"db down"}',
        }),
      );
    });

    it('falls back to <unreadable> when response body cannot be read', async () => {
      const bodyReadError = new Error('stream closed');
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({}),
        text: async () => {
          throw bodyReadError;
        },
      } as unknown as Response);

      const { result } = renderHook(() => useBrandData('app-123'));

      await waitFor(() => {
        expect(result.current.error).toBeInstanceOf(Error);
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'hook.brand_data.fetch.failure',
        expect.objectContaining({ body: '<unreadable>' }),
      );
    });
  });
});
