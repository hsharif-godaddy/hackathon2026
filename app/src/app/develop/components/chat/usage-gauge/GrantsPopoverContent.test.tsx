import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantType } from '@/types/credits';
import { GrantsPopoverContent } from './GrantsPopoverContent';

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((eid: string) => `appbuilder.${eid}.click`),
}));

vi.mock('@ux/text-lockup', () => ({
  default: ({ eyebrow, title }: { eyebrow: string; title: ReactNode }) => (
    <div data-testid="text-lockup">
      <span>{eyebrow}</span>
      <div>{title}</div>
    </div>
  ),
}));

const createMockGrant = (overrides: Partial<CreditGrant> = {}): CreditGrant => ({
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
  ...overrides,
});

const defaultProps = {
  grants: [createMockGrant()],
  isFreePlan: true,
  onUpgradeClick: vi.fn(),
  onBuyCreditsClick: vi.fn(),
};

describe('GrantsPopoverContent', function grantsPopoverContentTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render total credits title', function renderTitle() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      expect(screen.getByText('builder_usage_gauge_total_title')).toBeInTheDocument();
    });

    it('should render total credits spent and max', function renderTotalCredits() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      const container = screen.getByText('builder_usage_gauge_total_title').parentElement;
      // Values are passed to FormattedMessage translation string
      expect(container).toHaveTextContent('builder_usage_gauge_total_format');
    });

    it('should render manage plan button with correct href', function renderManagePlanButton() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      const button = screen.getByText('builder_usage_gauge_manage_plan').closest('a');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('href', '/manage-plan');
    });

    it('should render manage plan button with correct EID and data-partial', function renderManagePlanEID() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      const button = screen.getByText('builder_usage_gauge_manage_plan').closest('a');
      expect(button).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.manage_plan.click');
      expect(button).toHaveAttribute('data-partial', 'componentAiro');
    });

    it('should render monthly credits section when plan grant exists', function renderMonthlyCredits() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      expect(screen.getByText('builder_usage_gauge_monthly_credits')).toBeInTheDocument();
    });

    it('should not render monthly credits section when no plan grant', function noMonthlyCredits() {
      const grantsWithoutPlan = [createMockGrant({ type: GrantType.CreditPack })];
      renderWithProviders(<GrantsPopoverContent {...defaultProps} grants={grantsWithoutPlan} />);

      expect(screen.queryByText('builder_usage_gauge_monthly_credits')).not.toBeInTheDocument();
    });

    it('should render reset info when plan grant has useBefore', function renderResetInfo() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      expect(screen.getByText(/builder_usage_gauge_reset_free/)).toBeInTheDocument();
    });

    it('should render paid reset message for paid plans', function renderPaidResetInfo() {
      renderWithProviders(
        <GrantsPopoverContent
          {...defaultProps}
          isFreePlan={false}
        />
      );

      expect(screen.getByText(/builder_usage_gauge_reset_paid/)).toBeInTheDocument();
    });
  });

  describe('free plan UI', function freePlanTests() {
    it('should render upgrade button for free plan', function renderUpgradeButton() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} isFreePlan={true} />);

      expect(screen.getByText('builder_usage_gauge_upgrade_plan')).toBeInTheDocument();
    });

    it('should render buy credits button as secondary for free plan', function renderBuyCreditsSecondary() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} isFreePlan={true} />);

      const buyCreditsButton = screen.getByText('builder_usage_gauge_buy_credits').closest('button');
      expect(buyCreditsButton).toHaveClass('ux-button-secondary');
    });

    it('should call onUpgradeClick when upgrade button is clicked', async function clickUpgrade() {
      const onUpgradeClick = vi.fn();
      const { user } = renderWithProviders(
        <GrantsPopoverContent {...defaultProps} onUpgradeClick={onUpgradeClick} />
      );

      await user.click(screen.getByText('builder_usage_gauge_upgrade_plan'));

      expect(onUpgradeClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('paid plan UI', function paidPlanTests() {
    it('should not render upgrade button for paid plan', function noUpgradeButton() {
      renderWithProviders(
        <GrantsPopoverContent
          {...defaultProps}
          isFreePlan={false}
        />
      );

      expect(screen.queryByText('builder_usage_gauge_upgrade_plan')).not.toBeInTheDocument();
    });

    it('should render buy credits button as primary for paid plan', function renderBuyCreditsAsPrimary() {
      renderWithProviders(
        <GrantsPopoverContent
          {...defaultProps}
          isFreePlan={false}
        />
      );

      const buyCreditsButton = screen.getByText('builder_usage_gauge_buy_credits').closest('button');
      expect(buyCreditsButton).toHaveClass('ux-button-primary');
    });
  });

  describe('credit packs', function creditPackTests() {
    it('should render addon credits section when credit packs exist', function renderAddonCredits() {
      const grantsWithCreditPack = [
        createMockGrant(),
        createMockGrant({
          id: 'grant-2',
          type: GrantType.CreditPack,
          creditsSpent: 50,
          creditsMax: 250,
        }),
      ];

      renderWithProviders(<GrantsPopoverContent {...defaultProps} grants={grantsWithCreditPack} />);

      expect(screen.getByText('builder_usage_gauge_addon_credits')).toBeInTheDocument();
    });

    it('should not render addon credits section when no credit packs', function noAddonCredits() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      expect(screen.queryByText('builder_usage_gauge_addon_credits')).not.toBeInTheDocument();
    });

    it('should calculate remaining credits correctly', function calculateRemainingCredits() {
      const grantsWithCreditPack = [
        createMockGrant(),
        createMockGrant({
          id: 'grant-2',
          type: GrantType.CreditPack,
          creditsSpent: 50,
          creditsMax: 250,
        }),
      ];

      renderWithProviders(<GrantsPopoverContent {...defaultProps} grants={grantsWithCreditPack} />);

      // Credit pack: 250 max - 50 spent = 200 remaining
      // Values are passed to FormattedMessage translation string
      const addonSection = screen.getByText('builder_usage_gauge_addon_credits').parentElement;
      expect(addonSection).toHaveTextContent('builder_usage_gauge_credits_format');
    });
  });

  describe('button interactions', function buttonInteractionTests() {
    it('should call onBuyCreditsClick when buy credits button is clicked', async function clickBuyCredits() {
      const onBuyCreditsClick = vi.fn();
      const { user } = renderWithProviders(
        <GrantsPopoverContent {...defaultProps} onBuyCreditsClick={onBuyCreditsClick} />
      );

      await user.click(screen.getByText('builder_usage_gauge_buy_credits'));

      expect(onBuyCreditsClick).toHaveBeenCalledTimes(1);
    });

    it('should have correct EID on upgrade button', function upgradeButtonEID() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      const upgradeButton = screen.getByText('builder_usage_gauge_upgrade_plan').closest('button');
      expect(upgradeButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.upgrade.click');
    });

    it('should have correct EID on buy credits button', function buyCreditsButtonEID() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      const buyCreditsButton = screen.getByText('builder_usage_gauge_buy_credits').closest('button');
      expect(buyCreditsButton).toHaveAttribute('data-eid', 'appbuilder.usage_gauge.popover.buy_credits.click');
    });

    it('should have data-partial attribute on buttons', function dataPartialAttribute() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      const upgradeButton = screen.getByText('builder_usage_gauge_upgrade_plan').closest('button');
      const buyCreditsButton = screen.getByText('builder_usage_gauge_buy_credits').closest('button');

      expect(upgradeButton).toHaveAttribute('data-partial', 'componentAiro');
      expect(buyCreditsButton).toHaveAttribute('data-partial', 'componentAiro');
    });
  });

  describe('edge cases', function edgeCaseTests() {
    it('should handle undefined grants', function handleUndefinedGrants() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} grants={undefined} />);

      // Should render the component with total format translation
      const container = screen.getByText('builder_usage_gauge_total_title').parentElement;
      expect(container).toHaveTextContent('builder_usage_gauge_total_format');
    });

    it('should handle empty grants array', function handleEmptyGrants() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} grants={[]} />);

      // Should render the component with total format translation
      const container = screen.getByText('builder_usage_gauge_total_title').parentElement;
      expect(container).toHaveTextContent('builder_usage_gauge_total_format');
    });

    it('should handle null appId', function handleNullAppId() {
      renderWithProviders(<GrantsPopoverContent {...defaultProps} />);

      expect(screen.getByText('builder_usage_gauge_total_title')).toBeInTheDocument();
    });
  });
});
