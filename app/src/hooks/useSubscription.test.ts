import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import { useSubscription } from './useSubscription';

// Mock appFetch
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

import { appFetch } from '@/lib/gasket-config';

describe('useSubscription', function hooks() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('#useSubscription', function main() {
    it('returns subscription data when API succeeds', async function success() {
      const mockSubscription = {
        id: 'sub-123',
        plan: SubscriptionPlan.AiroPlus,
        productId: 'AiroPlusAppBuilderProduct',
        isTrial: false,
      };

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { subscription: mockSubscription } }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockSubscription);
    });

    it('returns null when API returns not ok', async function notOk() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBeNull();
    });

    it('returns null when subscription is missing from response', async function missing() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBeNull();
    });

    it('calls API with correct endpoint and credentials', async function endpoint() {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { subscription: { id: 'sub-123' } } }),
      } as Response);

      renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith('/api/subscription', { credentials: 'include' });
      });
    });

    it('handles free plan subscription', async function freePlan() {
      const mockSubscription = {
        id: 'sub-456',
        plan: SubscriptionPlan.Free,
        productId: 'FreeAppBuilderProduct',
        isTrial: true,
      };

      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { subscription: mockSubscription } }),
      } as Response);

      const { result } = renderHookWithProviders(() => useSubscription());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data?.plan).toBe(SubscriptionPlan.Free);
      expect(result.current.data?.isTrial).toBe(true);
    });
  });
});
