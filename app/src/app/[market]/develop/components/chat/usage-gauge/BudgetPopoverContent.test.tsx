/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import type { CreditStatusItem, CreditStatusResponse } from '@/types/budget';
import { SubscriptionPlan } from '@/types/credits';
import { BudgetPopoverContent } from './BudgetPopoverContent';

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((eid: string) => `appbuilder.${eid}.click`),
}));

vi.mock('@/hooks/useSubscriptionWithPolling', () => ({
  useSubscriptionWithPolling: vi.fn(),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}));

import { useSubscriptionWithPolling } from '@/hooks/useSubscriptionWithPolling';
import { useSwitchboard } from '@/hooks/useSwitchboard';

vi.mock('@ux/text-lockup', () => ({
  default: ({ eyebrow, title }: { eyebrow: string; title: ReactNode }) => (
    <div data-testid="text-lockup">
      <span>{eyebrow}</span>
      <div>{title}</div>
    </div>
  ),
}));

function createMockItem(overrides: Partial<CreditStatusItem> = {}): CreditStatusItem {
  return {
    budgetItemId: 'item-1',
    creditsTotal: '750',
    creditsUsed: '30',
    costToCreditRatio: '1',
    startsAt: '2026-01-15T00:00:00Z',
    expiresAt: '2026-02-15T23:59:59Z',
    resetInterval: 'monthly',
    creditsTotalNumeric: 750,
    creditsUsedNumeric: 30,
    type: 'plan-monthly',
    ...overrides,
  }
}

function createMockData(overrides: Partial<CreditStatusResponse> = {}): CreditStatusResponse {
  const items = overrides.items ?? [createMockItem()]
  const totalNumeric = items.reduce(function sumTotal(s, i) { return s + i.creditsTotalNumeric }, 0)
  const usedNumeric = items.reduce(function sumUsed(s, i) { return s + i.creditsUsedNumeric }, 0)
  return {
    budgetId: 'budget-1',
    productKey: 'aab-v1',
    creditsTotal: String(totalNumeric),
    creditsUsed: String(usedNumeric),
    creditsPending: '0',
    creditsTotalNumeric: totalNumeric,
    creditsUsedNumeric: usedNumeric,
    creditsPendingNumeric: 0,
    items,
    ...overrides,
  }
}

const defaultProps = {
  data: createMockData(),
  onUpgradeClick: vi.fn(),
  onBuyCreditsClick: vi.fn(),
};

function mockSubscription(plan: SubscriptionPlan = SubscriptionPlan.Free, entitlementId?: string) {
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
      plan,
      builderEntitlementId: entitlementId,
    },
    subscriptions: [],
    isLoading: false,
    isError: false,
    builderEntitlementId: entitlementId,
    isPurchaseDisabled: !entitlementId,
    entitlementPollingTimedOut: false,
  });
}

function mockHigherPlansFlag(enabled: boolean) {
  vi.mocked(useSwitchboard).mockReturnValue({
    data: enabled,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useSwitchboard>);
}

describe('BudgetPopoverContent', function budgetPopoverContentTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockSubscription(SubscriptionPlan.Free, 'entitlement-123');
    mockHigherPlansFlag(true);
  });

  describe('rendering', function renderingTests() {
    it('should render total credits from budget data', function renderTotalCredits() {
      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      expect(screen.getByText('builder_usage_gauge_total_title')).toBeInTheDocument();
      const container = screen.getByText('builder_usage_gauge_total_title').parentElement;
      expect(container).toHaveTextContent('builder_usage_gauge_total_format');
    });

    it('should render manage plan button', function renderManagePlan() {
      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      const button = screen.getByText('builder_usage_gauge_manage_plan').closest('a');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('href', '/manage-plan');
    });

    it('should render monthly credits when plan-monthly item exists', function renderMonthlyCredits() {
      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      expect(screen.getByText('builder_usage_gauge_monthly_credits')).toBeInTheDocument();
    });

    it('should render addon credits when credit-pack items exist', function renderAddonCredits() {
      const data = createMockData({
        items: [
          createMockItem(),
          createMockItem({ budgetItemId: 'item-2', type: 'credit-pack', creditsTotalNumeric: 250, creditsUsedNumeric: 50 }),
        ],
      });

      renderWithProviders(<BudgetPopoverContent {...defaultProps} data={data} />);

      expect(screen.getByText('builder_usage_gauge_addon_credits')).toBeInTheDocument();
    });

    it('should render reset info from plan-monthly expiresAt', function renderResetInfo() {
      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      expect(screen.getByText(/builder_usage_gauge_reset_free/)).toBeInTheDocument();
    });

    it('should render paid reset message for paid plans', function renderPaidResetInfo() {
      mockSubscription(SubscriptionPlan.Starter, 'entitlement-123');

      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      expect(screen.getByText(/builder_usage_gauge_reset_paid/)).toBeInTheDocument();
    });
  });

  describe('edge cases', function edgeCaseTests() {
    it('should show 0/0 total when no items', function noItems() {
      const data = createMockData({ items: [] });

      renderWithProviders(<BudgetPopoverContent {...defaultProps} data={data} />);

      expect(screen.getByText('builder_usage_gauge_total_title')).toBeInTheDocument();
      expect(screen.queryByText('builder_usage_gauge_monthly_credits')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_usage_gauge_addon_credits')).not.toBeInTheDocument();
    });

    it('should omit reset info when expiresAt is null', function expiresAtNull() {
      const data = createMockData({
        items: [createMockItem({ expiresAt: null })],
      });

      renderWithProviders(<BudgetPopoverContent {...defaultProps} data={data} />);

      expect(screen.queryByText(/builder_usage_gauge_reset_free/)).not.toBeInTheDocument();
      expect(screen.queryByText(/builder_usage_gauge_reset_paid/)).not.toBeInTheDocument();
    });

    it('should omit reset info when no plan-monthly item', function noPlanMonthlyItem() {
      const data = createMockData({
        items: [createMockItem({ budgetItemId: 'pack-1', type: 'credit-pack' })],
      });

      renderWithProviders(<BudgetPopoverContent {...defaultProps} data={data} />);

      expect(screen.queryByText(/builder_usage_gauge_reset_free/)).not.toBeInTheDocument();
    });
  });

  describe('action buttons', function actionButtonTests() {
    it('should render upgrade button for free plan', function upgradeButton() {
      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      expect(screen.getByText('builder_usage_gauge_upgrade_plan')).toBeInTheDocument();
    });

    it('should not render upgrade button for Ultimate plan', function noUpgradeForUltimate() {
      mockSubscription(SubscriptionPlan.Ultimate, 'entitlement-123');

      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      expect(screen.queryByText('builder_usage_gauge_upgrade_plan')).not.toBeInTheDocument();
    });

    it('should call onUpgradeClick', async function clickUpgrade() {
      const onUpgradeClick = vi.fn();
      const { user } = renderWithProviders(
        <BudgetPopoverContent {...defaultProps} onUpgradeClick={onUpgradeClick} />
      );

      await user.click(screen.getByText('builder_usage_gauge_upgrade_plan'));

      expect(onUpgradeClick).toHaveBeenCalledTimes(1);
    });

    it('should call onBuyCreditsClick', async function clickBuyCredits() {
      const onBuyCreditsClick = vi.fn();
      const { user } = renderWithProviders(
        <BudgetPopoverContent {...defaultProps} onBuyCreditsClick={onBuyCreditsClick} />
      );

      await user.click(screen.getByText('builder_usage_gauge_buy_credits'));

      expect(onBuyCreditsClick).toHaveBeenCalledTimes(1);
    });

    it('should disable buttons when entitlementId is missing', function disabledButtons() {
      mockSubscription(SubscriptionPlan.Free, undefined);

      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      const buyCreditsButton = screen.getByText('builder_usage_gauge_buy_credits').closest('button');
      expect(buyCreditsButton).toBeDisabled();
    });

    it('should have correct EIDs', function correctEIDs() {
      renderWithProviders(<BudgetPopoverContent {...defaultProps} />);

      const upgradeButton = screen.getByText('builder_usage_gauge_upgrade_plan').closest('button');
      expect(upgradeButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.upgrade.click');

      const buyCreditsButton = screen.getByText('builder_usage_gauge_buy_credits').closest('button');
      expect(buyCreditsButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.buy_credits.click');
    });
  });
});
