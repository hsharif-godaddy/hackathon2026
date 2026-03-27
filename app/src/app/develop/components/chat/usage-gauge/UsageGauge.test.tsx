/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import { WarningLevel } from '@/types/usage';
import UsageGauge from './UsageGauge';

const mockOpenUpgradeModal = vi.fn();
const mockOpenCreditsModal = vi.fn();

vi.mock('@/hooks/useDailyUsage', () => ({
  useDailyUsage: vi.fn(() => ({
    data: { percentage: 65 },
    isLoading: false,
    formattedResetTime: { dayKey: 'tomorrow', timeString: '4:10 PM' },
  })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: false, isLoading: false })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    data: {
      id: 'sub-123',
      plan: SubscriptionPlan.Free,
      builderEntitlementId: 'ent-123',
    },
    isLoading: false,
  })),
}));

vi.mock('@/hooks/useSubscriptionWithPolling', () => ({
  useSubscriptionWithPolling: vi.fn(() => ({
    subscription: {
      id: 'sub-123',
      customerId: 'cust-123',
      productId: 'prod-123',
      status: 'active',
      isTrial: false,
      renewsAt: '2026-02-15T00:00:00Z',
      createdAt: '2026-01-15T00:00:00Z',
      updatedAt: '2026-01-15T00:00:00Z',
      plan: SubscriptionPlan.Free,
      builderEntitlementId: 'entitlement-123',
    },
    subscriptions: [],
    isLoading: false,
    isError: false,
    builderEntitlementId: 'entitlement-123',
    isPurchaseDisabled: false,
    isGrantsEnabled: true,
    entitlementPollingTimedOut: false,
  })),
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: vi.fn(() => ({
    data: [
      {
        id: 'grant-1',
        subscriptionId: 'sub-123',
        type: GrantType.PlanMonthly,
        creditsSpent: 30,
        creditsMax: 750,
        isAvailable: true,
        useBefore: '2026-02-15T23:59:59Z',
        createdAt: '2026-01-15T00:00:00Z',
        updatedAt: '2026-01-15T00:00:00Z',
      },
    ],
    isLoading: false,
  })),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: {
    openUpgradeModal: typeof mockOpenUpgradeModal;
    openCreditsModal: typeof mockOpenCreditsModal;
  }) => unknown) => selector({
    openUpgradeModal: mockOpenUpgradeModal,
    openCreditsModal: mockOpenCreditsModal,
  }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((eid: string) => `appbuilder.${eid}.click`),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

describe('UsageGauge', function usageGaugeTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render circular gauge', async function renderGauge() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForGauge() {
        expect(container.querySelector('svg')).toBeInTheDocument();
      });
    });

    it('should render loading state when daily usage data is loading', async function loadingState() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);
      vi.mocked(useDailyUsage).mockReturnValue({
        data: null,
        isLoading: true,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('should render loading state when daily usage data is null', async function nullDataState() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);
      vi.mocked(useDailyUsage).mockReturnValue({
        data: null,
        isLoading: false,
        formattedResetTime: null,
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });
  });

  describe('legacy mode (grants disabled)', function legacyModeTests() {
    beforeEach(async function setupLegacyMode() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');

      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        // appbuilder-usage-purchase enabled by default
        return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
      });
      vi.mocked(useDailyUsage).mockReturnValue({
        data: { percentage: 65, resetTime: '2025-01-10T00:00:00Z' },
        isLoading: false,
        formattedResetTime: { dayKey: 'tomorrow', timeString: '4:10 PM' },
        warningLevel: WarningLevel.NONE,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useDailyUsage>);
    });

    it('should render trigger button with aria-label', async function renderTrigger() {
      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForTrigger() {
        const button = container.querySelector('button');
        expect(button).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-label');
      });
    });

    it('should open popover on hover', async function openPopover() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      const button = container.querySelector('button')!;
      await user.hover(button);

      await waitFor(function waitForPopover() {
        expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
      });
    });

    it('should have tracking eid on trigger button', async function triggerHasTrackingEid() {
      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      const button = container.querySelector('button')!;
      expect(button).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.trigger.open.click');
    });

    it('should render upgrade and buy tokens buttons when purchase is enabled', async function renderButtons() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });
    });

    it('should not render purchase buttons when purchase is disabled', async function noButtons() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForPopover() {
        expect(screen.getByText('builder_usage_daily_title')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_usage_gauge_upgrade')).not.toBeInTheDocument();
    });

    it('should call openUpgradeModal when upgrade button is clicked', async function clickUpgrade() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_upgrade'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('usage_gauge.upgrade', PAYWALL_ITC.UPGRADE);
    });

    it('should call openUpgradeModal when buy tokens button is clicked (grants disabled)', async function clickBuyTokensWithoutGrants() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_tokens'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('usage_gauge.buy_tokens', PAYWALL_ITC.UPGRADE);
      expect(mockOpenCreditsModal).not.toHaveBeenCalled();
    });

    it('should close popover after clicking upgrade button', async function closePopoverAfterUpgrade() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_upgrade'));

      await waitFor(function waitForPopoverClosed() {
        expect(screen.queryByText('builder_usage_daily_title')).not.toBeInTheDocument();
      });
    });

    it('should log analytics when upgrade button is clicked', async function logUpgradeAnalytics() {
      const { shipAnalyticsLog } = await import('@/lib/logging');

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app-123" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_upgrade')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_upgrade'));

      expect(shipAnalyticsLog).toHaveBeenCalledWith('usage_gauge.upgrade.clicked', expect.objectContaining({
        appId: 'test-app-123',
      }));
    });

    it('should log analytics when buy tokens button is clicked', async function logBuyTokensAnalytics() {
      const { shipAnalyticsLog } = await import('@/lib/logging');

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app-456" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForButtons() {
        expect(screen.getByText('builder_usage_gauge_buy_tokens')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_tokens'));

      expect(shipAnalyticsLog).toHaveBeenCalledWith('usage_gauge.buy_tokens.clicked', expect.objectContaining({
        appId: 'test-app-456',
      }));
    });
  });

  describe('grants mode (grants enabled)', function grantsModeTests() {
    beforeEach(async function setupGrantsMode() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');
      const { useCreditGrants } = await import('@/hooks/useCreditGrants');

      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
      });

      vi.mocked(useSubscription).mockReturnValue({
        data: {
          id: 'sub-123',
          productId: 'aab-v1',
          customerId: 'cust-123',
          status: 'active',
          isTrial: false,
          entitlementId: 'ent-123',
          builderEntitlementId: 'builder-ent-123',
          plan: SubscriptionPlan.Free,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          {
            id: 'grant-1',
            subscriptionId: 'sub-123',
            type: GrantType.PlanMonthly,
            llmBudgetUserId: 'budget-user-1',
            llmBudgetId: 'budget-1',
            creditsSpent: 30,
            creditsMax: 750,
            isAvailable: true,
            useBefore: '2026-02-15T23:59:59Z',
            createdAt: '2026-01-15T00:00:00Z',
            updatedAt: '2026-01-15T00:00:00Z',
          },
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render grants UI when grants flag is enabled', async function renderGrantsUI() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForGrantsPopover() {
        expect(screen.getByText('builder_usage_gauge_total_title')).toBeInTheDocument();
        expect(screen.getByText('builder_usage_gauge_manage_plan')).toBeInTheDocument();
      });
    });

    it('should display total credits used and max', async function displayTotalCredits() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForCredits() {
        // Check for total credits title
        expect(screen.getByText('builder_usage_gauge_total_title')).toBeInTheDocument();
        // Check for credits format translation (values passed via FormattedMessage)
        const totalSection = screen.getByText('builder_usage_gauge_total_title').parentElement;
        expect(totalSection).toHaveTextContent('builder_usage_gauge_total_format');
      });
    });

    it('should render Manage my Plan button', async function renderManagePlanButton() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForManagePlanButton() {
        const managePlanButton = screen.getByText('builder_usage_gauge_manage_plan').closest('a');
        expect(managePlanButton).toBeInTheDocument();
        expect(managePlanButton).toHaveAttribute('href', '/manage-plan');
        expect(managePlanButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.manage_plan.click');
        expect(managePlanButton).toHaveAttribute('data-partial', 'componentAiro');
      });
    });

    it('should render monthly plan credits section', async function renderMonthlyCredits() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForMonthlyCredits() {
        expect(screen.getByText('builder_usage_gauge_monthly_credits')).toBeInTheDocument();
      });
    });

    it('should render Upgrade Plan button for free plan users', async function renderUpgradeButton() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade_plan')).toBeInTheDocument();
      });
    });

    it('should render Buy AI Credits button', async function renderBuyCreditsButton() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForBuyCreditsButton() {
        expect(screen.getByText('builder_usage_gauge_buy_credits')).toBeInTheDocument();
      });
    });

    it('should call openUpgradeModal when Upgrade Plan button is clicked', async function clickUpgradePlan() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade_plan')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_upgrade_plan'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('usage_gauge.upgrade', PAYWALL_ITC.UPGRADE);
    });

    it('should call openCreditsModal when Buy AI Credits button is clicked', async function clickBuyCredits() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForBuyCreditsButton() {
        expect(screen.getByText('builder_usage_gauge_buy_credits')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_credits'));

      expect(mockOpenCreditsModal).toHaveBeenCalledWith('usage_gauge.buy_credits', PAYWALL_ITC.CREDITS);
    });

    it('should not render Upgrade Plan button for paid plan users when higher plans is disabled', async function noUpgradeForPaidPlan() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');
      const { useSubscriptionWithPolling } = await import('@/hooks/useSubscriptionWithPolling');

      // Mock appbuilder-higher-plans to false to test legacy behavior
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        if (flag === 'appbuilder-higher-plans') {
          return { data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
      });

      vi.mocked(useSubscription).mockReturnValue({
        data: {
          id: 'sub-123',
          productId: 'aab-v1',
          customerId: 'cust-123',
          status: 'active',
          isTrial: false,
          entitlementId: 'ent-123',
          builderEntitlementId: 'builder-ent-123',
          plan: SubscriptionPlan.Starter,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      vi.mocked(useSubscriptionWithPolling).mockReturnValue({
        subscription: {
          id: 'sub-123',
          customerId: 'cust-123',
          productId: 'prod-123',
          status: 'active',
          isTrial: false,
          renewsAt: '2026-02-15T00:00:00Z',
          createdAt: '2026-01-15T00:00:00Z',
          updatedAt: '2026-01-15T00:00:00Z',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'entitlement-123',
        },
        subscriptions: [],
        isLoading: false,
        isError: false,
        builderEntitlementId: 'entitlement-123',
        isPurchaseDisabled: false,
        isGrantsEnabled: true,
        entitlementPollingTimedOut: false,
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForBuyCreditsButton() {
        expect(screen.getByText('builder_usage_gauge_buy_credits')).toBeInTheDocument();
      });

      // Upgrade button should not be present for paid plans when higher plans is disabled
      expect(screen.queryByText('builder_usage_gauge_upgrade_plan')).not.toBeInTheDocument();
    });

    it('should render Upgrade Plan button for paid plan users when higher plans is enabled', async function upgradeForPaidPlanWithHigherPlans() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');
      const { useSubscriptionWithPolling } = await import('@/hooks/useSubscriptionWithPolling');

      // Mock appbuilder-higher-plans to true
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'app-builder-grants') {
          return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        if (flag === 'appbuilder-higher-plans') {
          return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
        }
        return { data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>;
      });

      vi.mocked(useSubscription).mockReturnValue({
        data: {
          id: 'sub-123',
          productId: 'aab-v1',
          customerId: 'cust-123',
          status: 'active',
          isTrial: false,
          entitlementId: 'ent-123',
          builderEntitlementId: 'builder-ent-123',
          plan: SubscriptionPlan.Starter,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      vi.mocked(useSubscriptionWithPolling).mockReturnValue({
        subscription: {
          id: 'sub-123',
          customerId: 'cust-123',
          productId: 'prod-123',
          status: 'active',
          isTrial: false,
          renewsAt: '2026-02-15T00:00:00Z',
          createdAt: '2026-01-15T00:00:00Z',
          updatedAt: '2026-01-15T00:00:00Z',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'entitlement-123',
        },
        subscriptions: [],
        isLoading: false,
        isError: false,
        builderEntitlementId: 'entitlement-123',
        isPurchaseDisabled: false,
        isGrantsEnabled: true,
        entitlementPollingTimedOut: false,
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade_plan')).toBeInTheDocument();
      });
    });

    it('should render loading state when subscription is loading', async function loadingSubscription() {
      const { useSubscription } = await import('@/hooks/useSubscription');
      vi.mocked(useSubscription).mockReturnValue({
        data: undefined,
        subscriptions: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('should render loading state when grants are loading', async function loadingGrants() {
      const { useCreditGrants } = await import('@/hooks/useCreditGrants');
      vi.mocked(useCreditGrants).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('should display addon credits section when credit packs exist', async function displayAddonCredits() {
      const { useCreditGrants } = await import('@/hooks/useCreditGrants');
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          {
            id: 'grant-1',
            subscriptionId: 'sub-123',
            type: GrantType.PlanMonthly,
            llmBudgetUserId: 'budget-user-1',
            llmBudgetId: 'budget-1',
            creditsSpent: 30,
            creditsMax: 500,
            isAvailable: true,
            useBefore: '2026-02-15T23:59:59Z',
            createdAt: '2026-01-15T00:00:00Z',
            updatedAt: '2026-01-15T00:00:00Z',
          },
          {
            id: 'grant-2',
            subscriptionId: 'sub-123',
            type: GrantType.CreditPack,
            llmBudgetUserId: 'budget-user-1',
            llmBudgetId: 'budget-2',
            creditsSpent: 50,
            creditsMax: 250,
            isAvailable: true,
            useBefore: '2026-03-15T23:59:59Z',
            createdAt: '2026-01-20T00:00:00Z',
            updatedAt: '2026-01-20T00:00:00Z',
          },
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.hover(container.querySelector('button')!);

      await waitFor(function waitForAddonCredits() {
        expect(screen.getByText('builder_usage_gauge_addon_credits')).toBeInTheDocument();
      });
    });

    it('should have correct EIDs on buttons', async function verifyEIDs() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      // Verify trigger button EID
      const triggerButton = container.querySelector('button');
      expect(triggerButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.trigger.open.click');

      await user.hover(triggerButton!);

      await waitFor(function waitForUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade_plan')).toBeInTheDocument();
      });

      // Verify upgrade button EID
      const upgradeButton = screen.getByText('builder_usage_gauge_upgrade_plan').closest('button');
      expect(upgradeButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.upgrade.click');

      // Verify buy credits button EID
      const buyCreditsButton = screen.getByText('builder_usage_gauge_buy_credits').closest('button');
      expect(buyCreditsButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.buy_credits.click');
    });
  });
});
