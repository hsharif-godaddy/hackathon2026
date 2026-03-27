import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';
import { usePaywallFeatureFlags } from './usePaywallFeatureFlags';

// Mock useSwitchboard
vi.mock('./useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}));

import { useSwitchboard } from './useSwitchboard';

describe('usePaywallFeatureFlags', function hooks() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('#usePaywallFeatureFlags', function main() {
    it('returns both flags as true when both switchboard flags are true', async function bothTrue() {
      // Mock both calls in order: first paywall, then markets
      vi.mocked(useSwitchboard)
        .mockReturnValueOnce({ data: true, isLoading: false, isError: false } as any)
        .mockReturnValueOnce({ data: true, isLoading: false, isError: false } as any);

      const { result } = renderHookWithProviders(() => usePaywallFeatureFlags());

      expect(result.current.data).toEqual({ paywall: true, markets: true });
      expect(result.current.isLoading).toBe(false);
    });

    it('returns paywall false when paywall flag is false', async function paywallFalse() {
      vi.mocked(useSwitchboard)
        .mockReturnValueOnce({ data: false, isLoading: false, isError: false } as any)
        .mockReturnValueOnce({ data: true, isLoading: false, isError: false } as any);

      const { result } = renderHookWithProviders(() => usePaywallFeatureFlags());

      expect(result.current.data).toEqual({ paywall: false, markets: true });
    });

    it('returns markets false when markets flag is false', async function marketsFalse() {
      vi.mocked(useSwitchboard)
        .mockReturnValueOnce({ data: true, isLoading: false, isError: false } as any)
        .mockReturnValueOnce({ data: false, isLoading: false, isError: false } as any);

      const { result } = renderHookWithProviders(() => usePaywallFeatureFlags());

      expect(result.current.data).toEqual({ paywall: true, markets: false });
    });

    it('returns isLoading true when either flag is loading', async function loading() {
      vi.mocked(useSwitchboard)
        .mockReturnValueOnce({ data: undefined, isLoading: true, isError: false } as any)
        .mockReturnValueOnce({ data: true, isLoading: false, isError: false } as any);

      const { result } = renderHookWithProviders(() => usePaywallFeatureFlags());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();
    });

    it('returns isError true when either flag has error', async function error() {
      vi.mocked(useSwitchboard)
        .mockReturnValueOnce({ data: undefined, isLoading: false, isError: true } as any)
        .mockReturnValueOnce({ data: true, isLoading: false, isError: false } as any);

      const { result } = renderHookWithProviders(() => usePaywallFeatureFlags());

      expect(result.current.isError).toBe(true);
    });

    it('defaults to false when data is undefined', async function undefinedData() {
      vi.mocked(useSwitchboard)
        .mockReturnValueOnce({ data: undefined, isLoading: false, isError: false } as any)
        .mockReturnValueOnce({ data: undefined, isLoading: false, isError: false } as any);

      const { result } = renderHookWithProviders(() => usePaywallFeatureFlags());

      expect(result.current.data).toEqual({ paywall: false, markets: false });
    });
  });
});
