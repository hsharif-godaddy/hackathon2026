/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { fetchCommerceBinding, useCommerceBinding } from '@/hooks/useCommerceBinding';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import { renderHookWithProviders } from '@/tests/test-utils';

const COMMERCE_BINDING_URL = '/api/apps/app-1/commerce/binding';

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

function mockBindingResponse(body: unknown, status = 200) {
  vi.mocked(appFetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as Response);
}

describe('useCommerceBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('#fetchCommerceBinding', () => {
    it('returns the durable Commerce binding response shape', async () => {
      const responseBody = {
        configured: true,
        binding: {
          appId: 'app-1',
          storeId: 'store-abc',
          channelId: null,
          status: 'store_bound',
          source: 'user_selected',
          lastVerifiedAt: null,
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z',
        },
      };
      mockBindingResponse(responseBody);

      await expect(fetchCommerceBinding('app-1')).resolves.toEqual(responseBody);
      expect(appFetch).toHaveBeenCalledWith(
        COMMERCE_BINDING_URL,
        { headers: { Accept: 'application/json' }, signal: undefined }
      );
    });

    it('returns unconfigured responses without remapping them', async () => {
      const responseBody = { configured: false, binding: null };
      mockBindingResponse(responseBody);

      await expect(fetchCommerceBinding('app-1')).resolves.toEqual(responseBody);
    });

    it('throws when the durable Commerce binding request fails', async () => {
      mockBindingResponse({ error: 'App not found' }, 404);

      await expect(fetchCommerceBinding('app-1')).rejects.toThrow(
        'Failed to resolve Commerce binding (404)'
      );
      expect(logger.warn).toHaveBeenCalledWith('commerce.binding.fetch.error', {
        appId: 'app-1',
        status: 404,
      });
    });
  });

  describe('#useCommerceBinding', () => {
    it('does not fetch when appId is missing', async () => {
      const { result } = renderHookWithProviders(() => useCommerceBinding(undefined));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(appFetch).not.toHaveBeenCalled();
    });

    it('returns the durable Commerce binding response', async () => {
      const responseBody = {
        configured: true,
        binding: {
          appId: 'app-1',
          storeId: 'store-abc',
          channelId: 'channel-abc',
          status: 'channel_ready',
          source: 'tool_channel_ensure',
          lastVerifiedAt: '2026-07-07T00:00:00.000Z',
          createdAt: '2026-07-07T00:00:00.000Z',
          updatedAt: '2026-07-07T00:00:00.000Z',
        },
      };
      mockBindingResponse(responseBody);

      const { result } = renderHookWithProviders(() => useCommerceBinding('app-1'));

      await waitFor(() => {
        expect(result.current.data).toEqual(responseBody);
      });
    });
  });
});
