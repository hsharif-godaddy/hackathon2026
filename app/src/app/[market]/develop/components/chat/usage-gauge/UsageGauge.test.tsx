/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import UsageGauge from './UsageGauge';

const mockOpenUpgradeModal = vi.fn();
const mockOpenCreditsModal = vi.fn();

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(function () { return {
    data: {
      id: 'sub-123',
      plan: SubscriptionPlan.Free,
      builderEntitlementId: 'ent-123',
    },
    isLoading: false,
  }; }),
}));

vi.mock('@/hooks/useSubscriptionWithPolling', () => ({
  useSubscriptionWithPolling: vi.fn(function () { return {
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
    entitlementPollingTimedOut: false,
  }; }),
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: vi.fn(function () { return {
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
    isFetching: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }; }),
}));

vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: (selector: (state: {
    openUpgradeModal: typeof mockOpenUpgradeModal;
    openCreditsModal: typeof mockOpenCreditsModal;
  }) => unknown) => selector({
    openUpgradeModal: mockOpenUpgradeModal,
    openCreditsModal: mockOpenCreditsModal,
  }),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function () { return true; }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

const mockLogImpressionEvent = vi.fn(function () { return vi.fn(); });
vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (eid: string) { return `appbuilder.${eid}.click`; }),
  logImpressionEvent: (...args: unknown[]) => mockLogImpressionEvent(...args),
}));

describe('UsageGauge', function usageGaugeTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render circular gauge', async function renderGauge() {
      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForGauge() {
        expect(container.querySelector('svg')).toBeInTheDocument();
      });
    });
  });

  describe('grants mode', function grantsModeTests() {
    beforeEach(async function setupGrantsMode() {
      const { useSubscription } = await import('@/hooks/useSubscription');
      const { useCreditGrants } = await import('@/hooks/useCreditGrants');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      // Budget service OFF for grants-mode tests
      vi.mocked(useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'app-builder-budget-service') return false;
        return true;
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
        isFetching: false,
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

      await user.click(container.querySelector('button')!);

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

      await user.click(container.querySelector('button')!);

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

      await user.click(container.querySelector('button')!);

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

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForMonthlyCredits() {
        expect(screen.getByText('builder_usage_gauge_monthly_credits')).toBeInTheDocument();
      });
    });

    it('should render Upgrade Plan button for free plan users', async function renderUpgradeButton() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForUpgradeButton() {
        expect(screen.getByText('builder_usage_gauge_upgrade_plan')).toBeInTheDocument();
      });
    });

    it('should render Buy AI Credits button', async function renderBuyCreditsButton() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForBuyCreditsButton() {
        expect(screen.getByText('builder_usage_gauge_buy_credits')).toBeInTheDocument();
      });
    });

    it('should call openUpgradeModal when Upgrade Plan button is clicked', async function clickUpgradePlan() {
      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

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

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForBuyCreditsButton() {
        expect(screen.getByText('builder_usage_gauge_buy_credits')).toBeInTheDocument();
      });

      await user.click(screen.getByText('builder_usage_gauge_buy_credits'));

      expect(mockOpenCreditsModal).toHaveBeenCalledWith('usage_gauge.buy_credits', PAYWALL_ITC.CREDITS);
    });

    it('should not render Upgrade Plan button for Ultimate plan users', async function noUpgradeForUltimate() {
      const { useSubscription } = await import('@/hooks/useSubscription');
      const { useSubscriptionWithPolling } = await import('@/hooks/useSubscriptionWithPolling');

      vi.mocked(useSubscription).mockReturnValue({
        data: {
          id: 'sub-123',
          productId: 'aab-v1',
          customerId: 'cust-123',
          status: 'active',
          isTrial: false,
          entitlementId: 'ent-123',
          builderEntitlementId: 'builder-ent-123',
          plan: SubscriptionPlan.Ultimate,
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
          plan: SubscriptionPlan.Ultimate,
          builderEntitlementId: 'entitlement-123',
        },
        subscriptions: [],
        isLoading: false,
        isError: false,
        builderEntitlementId: 'entitlement-123',
        isPurchaseDisabled: false,

        entitlementPollingTimedOut: false,
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

      await waitFor(function waitForBuyCreditsButton() {
        expect(screen.getByText('builder_usage_gauge_buy_credits')).toBeInTheDocument();
      });

      // Upgrade button should not be present for Ultimate users (highest tier)
      expect(screen.queryByText('builder_usage_gauge_upgrade_plan')).not.toBeInTheDocument();
    });

    it('should render Upgrade Plan button for non-Ultimate paid plan users', async function upgradeForNonUltimatePaidPlan() {
      const { useSubscription } = await import('@/hooks/useSubscription');
      const { useSubscriptionWithPolling } = await import('@/hooks/useSubscriptionWithPolling');

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

        entitlementPollingTimedOut: false,
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

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
        isFetching: true,
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('gauge percentage matches popover totals when plan grant is exhausted', async function gaugeMatchesPopover() {
      // Regression test: the gauge used to filter out exhausted grants, so a
      // user with an exhausted plan grant (500/500) plus a partial credit pack
      // (187/300) would see "687/800" in the popover but ~62% on the gauge.
      // Both must now reflect the same 687/800 == ~85.875%.
      const { useCreditGrants } = await import('@/hooks/useCreditGrants');
      vi.mocked(useCreditGrants).mockReturnValue({
        data: [
          {
            id: 'plan-1',
            subscriptionId: 'sub-123',
            type: GrantType.PlanMonthly,
            llmBudgetUserId: 'budget-user-1',
            llmBudgetId: 'budget-1',
            creditsSpent: 500,
            creditsMax: 500,
            isAvailable: true,
            useBefore: '2026-02-15T23:59:59Z',
            createdAt: '2026-01-15T00:00:00Z',
            updatedAt: '2026-01-15T00:00:00Z',
          },
          {
            id: 'pack-1',
            subscriptionId: 'sub-123',
            type: GrantType.CreditPack,
            llmBudgetUserId: 'budget-user-1',
            llmBudgetId: 'budget-2',
            creditsSpent: 187,
            creditsMax: 300,
            isAvailable: true,
            useBefore: '2026-03-15T23:59:59Z',
            createdAt: '2026-01-20T00:00:00Z',
            updatedAt: '2026-01-20T00:00:00Z',
          },
        ],
        isFetching: false,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button[data-percentage]')).toBeInTheDocument();
      });

      // 687/800 = 85.875% → Math.round → 86. The old buggy active-only
      // behavior (pack-only: 187/300 = 62.33%) would produce 62.
      const trigger = container.querySelector('button[data-percentage]');
      expect(trigger).toHaveAttribute('data-percentage', '86');
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
        isFetching: false,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { user, container } = renderWithProviders(<UsageGauge appId="test-app" />);

      await waitFor(function waitForButton() {
        expect(container.querySelector('button')).toBeInTheDocument();
      });

      await user.click(container.querySelector('button')!);

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

      await user.click(triggerButton!);

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

