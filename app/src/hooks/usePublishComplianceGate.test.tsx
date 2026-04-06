/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-hooks/rules-of-hooks */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { SiteStatus } from '@/lib/control-plane/types';
import { PublishComplianceBlockReason } from '@/lib/subscription';
import { renderHookWithProviders } from '@/tests/test-utils';
import { SubscriptionStatus, SubscriptionSuspendReason } from '@/types/credits';
import { usePublishComplianceGate } from './usePublishComplianceGate';

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}));

describe('usePublishComplianceGate', function usePublishComplianceGateTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    vi.mocked(useSubscription).mockReturnValue({
      data: undefined,
      subscriptions: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useSwitchboard).mockReturnValue({
      data: false,
      isLoading: false,
    } as ReturnType<typeof useSwitchboard>);
  });

  it('should not block when site is running, flag off, and no subscription', function notBlockedRunning() {
    const { result } = renderHookWithProviders(() =>
      usePublishComplianceGate({ status: SiteStatus.Running })
    );

    expect(result.current.isBlocked).toBe(false);
    expect(result.current.blockReason).toBeNull();
    expect(result.current.blockMessage).toBeNull();
  });

  it('should block when site is suspended regardless of flag', function blockedSiteSuspended() {
    vi.mocked(useSwitchboard).mockReturnValue({
      data: false,
      isLoading: false,
    } as ReturnType<typeof useSwitchboard>);

    const { result } = renderHookWithProviders(() =>
      usePublishComplianceGate({ status: SiteStatus.Suspended })
    );

    expect(result.current.isBlocked).toBe(true);
    expect(result.current.blockReason).toBe(PublishComplianceBlockReason.SiteSuspended);
    expect(result.current.blockMessage).toBe('builder_manageplan_apps_publish_blocked_suspended');
  });

  it('should block subscription when flag is true and subscription is non-compliant', function blockedSubscription() {
    vi.mocked(useSwitchboard).mockReturnValue({
      data: true,
      isLoading: false,
    } as ReturnType<typeof useSwitchboard>);
    vi.mocked(useSubscription).mockReturnValue({
      data: {
        status: SubscriptionStatus.Suspended,
        reason: SubscriptionSuspendReason.Legal,
      } as ReturnType<typeof useSubscription>['data'],
      subscriptions: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHookWithProviders(() =>
      usePublishComplianceGate({ status: SiteStatus.Running })
    );

    expect(result.current.isBlocked).toBe(true);
    expect(result.current.blockReason).toBe(PublishComplianceBlockReason.SubscriptionNonCompliant);
    expect(result.current.blockMessage).toBe('builder_manageplan_apps_publish_blocked_subscription');
  });

  it('should not block subscription path when flag is false', function flagOffAllowsPublish() {
    vi.mocked(useSwitchboard).mockReturnValue({
      data: false,
      isLoading: false,
    } as ReturnType<typeof useSwitchboard>);
    vi.mocked(useSubscription).mockReturnValue({
      data: {
        status: SubscriptionStatus.Suspended,
        reason: SubscriptionSuspendReason.Legal,
      } as ReturnType<typeof useSubscription>['data'],
      subscriptions: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHookWithProviders(() =>
      usePublishComplianceGate({ status: SiteStatus.Running })
    );

    expect(result.current.isBlocked).toBe(false);
    expect(result.current.blockReason).toBeNull();
    expect(result.current.blockMessage).toBeNull();
  });

  it('should prefer site_suspended when site suspended even if subscription is non-compliant', function siteWins() {
    vi.mocked(useSwitchboard).mockReturnValue({
      data: true,
      isLoading: false,
    } as ReturnType<typeof useSwitchboard>);
    vi.mocked(useSubscription).mockReturnValue({
      data: {
        status: SubscriptionStatus.Suspended,
        reason: SubscriptionSuspendReason.Policy,
      } as ReturnType<typeof useSubscription>['data'],
      subscriptions: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHookWithProviders(() =>
      usePublishComplianceGate({ status: SiteStatus.Suspended })
    );

    expect(result.current.blockReason).toBe(PublishComplianceBlockReason.SiteSuspended);
    expect(result.current.blockMessage).toBe('builder_manageplan_apps_publish_blocked_suspended');
  });

  it('should pass enabled false to underlying hooks', function disabledHooks() {
    renderHookWithProviders(() =>
      usePublishComplianceGate({ status: SiteStatus.Running }, { enabled: false })
    );

    expect(useSubscription).toHaveBeenCalledWith({ enabled: false });
    expect(useSwitchboard).toHaveBeenCalledWith('appbuilder-suspended-compliance-banner', {
      enabled: false,
    });
  });

  it('should treat null site as not site-suspended for subscription-only block', function nullSite() {
    vi.mocked(useSwitchboard).mockReturnValue({
      data: true,
      isLoading: false,
    } as ReturnType<typeof useSwitchboard>);
    vi.mocked(useSubscription).mockReturnValue({
      data: {
        status: SubscriptionStatus.Suspended,
        reason: SubscriptionSuspendReason.Fraud,
      } as ReturnType<typeof useSubscription>['data'],
      subscriptions: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHookWithProviders(() => usePublishComplianceGate(null));

    expect(result.current.isBlocked).toBe(true);
    expect(result.current.blockReason).toBe(PublishComplianceBlockReason.SubscriptionNonCompliant);
  });
});
