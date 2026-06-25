import '@testing-library/jest-dom';

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';

let mockSiteOwnerProduct: string | undefined = undefined;
let mockSubscriptions: Array<{ productId?: string; ownerProduct?: string }> = [];

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    data: mockSubscriptions[0] ?? undefined,
    subscriptions: mockSubscriptions,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (s: unknown) => unknown) =>
    selector({
      site: mockSiteOwnerProduct ? { ownerProduct: mockSiteOwnerProduct } : undefined,
    }),
}));

import { useIsEnterpriseUser } from './useIsEnterpriseUser';

describe('useIsEnterpriseUser', function describeUseIsEnterpriseUser() {
  beforeEach(function resetMocks() {
    mockSiteOwnerProduct = undefined;
    mockSubscriptions = [];
  });

  it('returns false when neither signal is present', function noEnt() {
    const { result } = renderHookWithProviders(() => useIsEnterpriseUser());
    expect(result.current).toBe(false);
  });

  it('returns true when the active site is enterprise-managed (signal 1)', function siteSignal() {
    mockSiteOwnerProduct = 'aab-ent-v1';
    const { result } = renderHookWithProviders(() => useIsEnterpriseUser());
    expect(result.current).toBe(true);
  });

  it('returns true when any subscription has the ent productId (signal 2a)', function subProductId() {
    mockSubscriptions = [
      { productId: 'aab-v1', ownerProduct: 'AiroAppBuilder' },
      { productId: 'aab-ent-v1', ownerProduct: 'aab-ent-v1' },
    ];
    const { result } = renderHookWithProviders(() => useIsEnterpriseUser());
    expect(result.current).toBe(true);
  });

  it('returns true when any subscription has the ent ownerProduct (signal 2b)', function subOwnerProduct() {
    mockSubscriptions = [
      { productId: 'unknown-id', ownerProduct: 'aab-ent-v1' },
    ];
    const { result } = renderHookWithProviders(() => useIsEnterpriseUser());
    expect(result.current).toBe(true);
  });

  it('returns false when only non-ent subscriptions are present', function onlyAab() {
    mockSubscriptions = [
      { productId: 'aab-v1', ownerProduct: 'AiroAppBuilder' },
    ];
    const { result } = renderHookWithProviders(() => useIsEnterpriseUser());
    expect(result.current).toBe(false);
  });

  it('returns true when site is non-ent but a subscription is ent', function siteNonEntButSubEnt() {
    mockSiteOwnerProduct = 'AiroAppBuilder';
    mockSubscriptions = [
      { productId: 'aab-ent-v1', ownerProduct: 'aab-ent-v1' },
    ];
    const { result } = renderHookWithProviders(() => useIsEnterpriseUser());
    expect(result.current).toBe(true);
  });
});
