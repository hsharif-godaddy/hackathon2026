import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useEntitlements } from './useEntitlements';

// Mock appFetch
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

import { appFetch } from '@/lib/gasket-config';

describe('useEntitlements', function hooks() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('#useEntitlements', function main() {
    it('returns entitlement ID when API succeeds', async function success() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: { subscription: { entitlementId: 'ent-123' } },
        }),
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useEntitlements({ subscriptionId: 'sub-456' })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBe('ent-123');
    });

    it('returns null when API returns not ok', async function notOk() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useEntitlements({ subscriptionId: 'sub-456' })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBeNull();
    });

    it('returns null when entitlementId is missing', async function missing() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { subscription: {} } }),
      } as Response);

      const { result } = renderHookWithProviders(() =>
        useEntitlements({ subscriptionId: 'sub-456' })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBeNull();
    });

    it('does not fetch when subscriptionId is undefined', async function noSubscription() {
      const { result } = renderHookWithProviders(() =>
        useEntitlements({ subscriptionId: undefined })
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('does not fetch when enabled is false', async function disabled() {
      const { result } = renderHookWithProviders(() =>
        useEntitlements({ subscriptionId: 'sub-456', enabled: false })
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(appFetch).not.toHaveBeenCalled();
    });

    it('encodes subscriptionId in URL', async function encode() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { subscription: { entitlementId: 'ent-123' } } }),
      } as Response);

      renderHookWithProviders(() =>
        useEntitlements({ subscriptionId: 'sub/with/slashes' })
      );

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(
          '/api/entitlements?subscriptionId=sub%2Fwith%2Fslashes',
          { credentials: 'include' }
        );
      });
    });

    it('includes subscriptionId in query key for proper caching', async function cacheKey() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { subscription: { entitlementId: 'ent-1' } } }),
      } as Response);

      const { result, rerender } = renderHookWithProviders(
        ({ subId }) => useEntitlements({ subscriptionId: subId }),
        { initialProps: { subId: 'sub-1' } }
      );

      await waitFor(() => {
        expect(result.current.data).toBe('ent-1');
      });

      // Change subscription ID - should refetch
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { subscription: { entitlementId: 'ent-2' } } }),
      } as Response);

      rerender({ subId: 'sub-2' });

      await waitFor(() => {
        expect(result.current.data).toBe('ent-2');
      });
    });
  });
});
