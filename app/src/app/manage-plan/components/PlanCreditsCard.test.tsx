/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import type { AiroSubscription } from '@/lib/mgmt-airo';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import PlanCreditsCard from './PlanCreditsCard';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params) {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((event: string) => `appbuilder.${event}.click`),
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

function createMockSubscription(overrides: Partial<AiroSubscription> = {}): AiroSubscription {
  return {
    id: 'sub-1',
    plan: SubscriptionPlan.Free,
    status: 'active',
    renewsAt: '2026-02-04T00:00:00.000Z',
    builderEntitlementId: 'test-entitlement-123',
    ...overrides,
  } as AiroSubscription;
}

function createMockPlanGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'plan-grant-1',
    subscriptionId: 'sub-1',
    type: GrantType.PlanMonthly,
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 10000,
    creditsSpent: 2500,
    isAvailable: true,
    finalState: null,
    useBefore: '2026-02-04T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-14T00:00:00.000Z',
    ...overrides,
  };
}

function createMockCreditPack(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'pack-1',
    subscriptionId: 'sub-1',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 5000,
    creditsSpent: 1000,
    isAvailable: true,
    finalState: null,
    useBefore: '2026-02-04T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('PlanCreditsCard', function planCreditsCardTests() {
  const mockOpenPaywall = vi.fn();

  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders basic content', function basicContentTests() {
    it('should render plan title', function renderTitle() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_plan_title')).toBeInTheDocument();
    });

    it('should render reset info when available', function renderResetInfo() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Reset info text should be present (with date and time params)
      const resetInfo = screen.getByText(/builder_manageplan_reset_info/);
      expect(resetInfo).toBeInTheDocument();
    });

    it('should render progress bar', function renderProgressBar() {
      const { container } = renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Progress bar container should be rendered (CreditProgressBar component)
      const progressBarContainer = container.querySelector('[class*="rounded-full"]');
      expect(progressBarContainer).toBeInTheDocument();
    });

    it('should return null when subscription is not provided', function returnNullNoSubscription() {
      const { container } = renderWithProviders(
        <PlanCreditsCard
          subscription={null as unknown as AiroSubscription}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should return null when planGrant is not provided', function returnNullNoPlanGrant() {
      const { container } = renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={null as unknown as CreditGrant}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render credits info tooltip', function renderCreditsTooltip() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // InfoTooltip renders a button with aria-label for accessibility
      const tooltipTrigger = screen.getByRole('button', { name: 'builder_common_more_info' });
      expect(tooltipTrigger).toBeInTheDocument();
    });

    it('should render responsive ActiveTag (hidden on mobile, visible on desktop)', function renderResponsiveActiveTag() {
      const planGrant = createMockPlanGrant({ id: 'active-grant' });

      const { container } = renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={planGrant}
          activeGrantId="active-grant"
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Should have two ActiveTag instances - one for mobile (sm:hidden) and one for desktop (hidden sm:inline)
      const activeTagSpans = container.querySelectorAll('span.hidden, span.sm\\:hidden');
      expect(activeTagSpans.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('plan badge display', function planBadgeTests() {
    it('should show Free plan tag for free users', function freePlanTag() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_plan_free')).toBeInTheDocument();
    });

    it('should show AiroPlus plan tag for AiroPlus users', function airoPlusTag() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.AiroPlus })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_plan_airo_plus')).toBeInTheDocument();
    });

    it('should show Starter plan tag for Starter users', function starterTag() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_plan_starter')).toBeInTheDocument();
    });
  });

  describe('plan features section', function planFeaturesTests() {
    it('should render plan features label', function renderPlanFeaturesLabel() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant({ creditsMax: 150 })}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_plan_features')).toBeInTheDocument();
    });

    it('should render credits per month with correct count', function renderCreditsPerMonth() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant({ creditsMax: 150 })}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Translation mock returns key with params: "builder_manageplan_plan_credits_per_month:{"count":150}"
      expect(screen.getByText(/builder_manageplan_plan_credits_per_month/)).toBeInTheDocument();
    });

    it('should render publish limit for Starter plan', function renderPublishLimitStarter() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Translation mock returns key with params: "builder_manageplan_plan_publish_limit:{"count":N}"
      expect(screen.getByText(/builder_manageplan_plan_publish_limit/)).toBeInTheDocument();
    });

    it('should render publish limit for Professional plan', function renderProfessionalPublishLimit() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Professional })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Professional plan has a publish limit of 10
      expect(screen.getByText(/builder_manageplan_plan_publish_limit/)).toBeInTheDocument();
    });

    it('should not render publish limit for Free plan (limit is 0)', function renderFreeNoPublishLimit() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Free plan has publish limit of 0, so publish limit row is not shown
      expect(screen.queryByText(/builder_manageplan_plan_publish_limit/)).not.toBeInTheDocument();
    });
  });

  describe('active tag display', function activeTagTests() {
    it('should show active tag when grant is active', function showActiveTag() {
      const planGrant = createMockPlanGrant({ id: 'active-grant' });

      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={planGrant}
          activeGrantId="active-grant"
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Two ActiveTags are rendered (mobile and desktop responsive versions)
      const activeTags = screen.getAllByText('builder_manageplan_active');
      expect(activeTags.length).toBe(2);
    });

    it('should not show active tag when grant is not active', function noActiveTag() {
      const planGrant = createMockPlanGrant({ id: 'plan-grant' });

      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription()}
          planGrant={planGrant}
          activeGrantId="other-grant"
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_active')).not.toBeInTheDocument();
    });
  });

  describe('button visibility for Free plan', function freePlanButtonTests() {
    it('should show Upgrade button for Free plan with credit packs', function freeWithPacksUpgrade() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
    });

    it('should show Buy Credits button for Free plan with credit packs', function freeWithPacksBuyCredits() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
    });

    it('should NOT show Downgrade button for Free plan', function freeNoDowngrade() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: true }}
          onDowngradeClick={vi.fn()}
          isGrantsEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
    });

    it('should NOT show any buttons for Free plan without credit packs', function freeNoPacksNoButtons() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_manageplan_buy_credits')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
    });
  });

  describe('button visibility for Starter plan', function starterPlanButtonTests() {
    it('should show Downgrade button for Starter plan when autoRenew is true', function starterNoPacks() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: true }}
          onDowngradeClick={vi.fn()}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_downgrade_plan')).toBeInTheDocument();
    });

    it('should NOT show Downgrade button when autoRenew is false', function noDowngradeWhenAutoRenewFalse() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: false }}
          onDowngradeClick={vi.fn()}
          isGrantsEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
    });

    it('should show Buy Credits and Downgrade buttons for Starter plan with credit packs', function starterWithPacks() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: true }}
          onDowngradeClick={vi.fn()}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_downgrade_plan')).toBeInTheDocument();
    });

    it('should NOT show Upgrade button for Starter plan', function starterNoUpgrade() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
    });
  });

  describe('button visibility for AiroPlus plan (treated as non-paid when grants enabled)', function airoPlusPlanButtonTests() {
    it('should NOT show Downgrade button for AiroPlus plan', function airoPlusNoDowngrade() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.AiroPlus })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: true }}
          onDowngradeClick={vi.fn()}
          isGrantsEnabled={true}
        />
      );

      // AiroPlus is not a paid plan when grants enabled, so no downgrade option
      expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
    });

    it('should show Buy Credits button for AiroPlus plan with credit packs', function airoPlusBuyCredits() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.AiroPlus })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // AiroPlus treated as non-paid, so shows Buy Credits like Free plan
      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
    });

    it('should show Upgrade button for AiroPlus plan with credit packs', function airoPlusUpgrade() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.AiroPlus })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // AiroPlus treated as non-paid, so shows Upgrade like Free plan
      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
    });

    it('should NOT show any buttons for AiroPlus plan without credit packs', function airoPlusNoPacksNoButtons() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.AiroPlus })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: true }}
          onDowngradeClick={vi.fn()}
          isGrantsEnabled={true}
        />
      );

      // Like Free plan without credit packs, no buttons shown
      expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_manageplan_buy_credits')).not.toBeInTheDocument();
      expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
    });
  });

  describe('button click handlers', function buttonClickTests() {
    it('should call openPaywall with upgrade when Upgrade clicked', async function clickUpgrade() {
      const { user } = renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      await user.click(screen.getByText('builder_manageplan_upgrade'));

      expect(mockOpenPaywall).toHaveBeenCalledWith('manage_plan.upgrade', 'upgrade', PAYWALL_ITC.UPGRADE);
    });

    it('should call openPaywall with credits when Buy Credits clicked', async function clickBuyCredits() {
      const { user } = renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      await user.click(screen.getByText('builder_manageplan_buy_credits'));

      expect(mockOpenPaywall).toHaveBeenCalledWith('manage_plan.buy_credits', 'credits', PAYWALL_ITC.CREDITS);
    });

    it('should call onDowngradeClick when Downgrade button is clicked', async function clickDowngrade() {
      const mockOnDowngradeClick = vi.fn();
      const { user } = renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: true }}
          onDowngradeClick={mockOnDowngradeClick}
          isGrantsEnabled={true}
        />
      );

      await user.click(screen.getByText('builder_manageplan_downgrade_plan'));

      expect(mockOnDowngradeClick).toHaveBeenCalledTimes(1);
    });

    it('should NOT show Downgrade button when onDowngradeClick is not provided', function noDowngradeWithoutCallback() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          autoRenewStatus={{ autoRenew: true }}
          isGrantsEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
    });
  });

  describe('button visibility with higher plans flag', function higherPlansButtonTests() {
    it('should show Upgrade button for Starter plan when higher plans flag is on', function starterUpgradeWithFlag() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
          isHigherPlansEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
    });

    it('should show Upgrade button for Professional plan when higher plans flag is on', function professionalUpgradeWithFlag() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Professional })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
          isHigherPlansEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
    });

    it('should NOT show Upgrade button for Ultimate plan when higher plans flag is on', function ultimateNoUpgrade() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Ultimate })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
          isHigherPlansEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
    });

    it('should show Downgrade button for Ultimate plan when higher plans flag is on', function ultimateShowsDowngrade() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Ultimate })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
          isHigherPlansEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_downgrade')).toBeInTheDocument();
    });

    it('should NOT show higher plans Upgrade button when flag is off', function noUpgradeWhenFlagOff() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
          isHigherPlansEnabled={false}
        />
      );

      expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
    });

    it('should call openPaywall with upgrade_plan when higher plans Upgrade is clicked', async function clickHigherPlansUpgrade() {
      const { user } = renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
          isHigherPlansEnabled={true}
        />
      );

      await user.click(screen.getByText('builder_manageplan_upgrade'));

      expect(mockOpenPaywall).toHaveBeenCalledWith('manage_plan.upgrade_plan', 'upgrade', PAYWALL_ITC.UPGRADE);
    });
  });

  describe('free plan with credit packs message', function freeWithPacksMessageTests() {
    it('should show plan description message for free plan with credit packs', function showPlanDescription() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Free })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_creditpacks_empty_plan_description')).toBeInTheDocument();
    });

    it('should NOT show plan description message for paid plan', function noMessageForPaidPlan() {
      renderWithProviders(
        <PlanCreditsCard
          subscription={createMockSubscription({ plan: SubscriptionPlan.Starter })}
          planGrant={createMockPlanGrant()}
          creditPacks={[createMockCreditPack()]}
          openPaywall={mockOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.queryByText('builder_manageplan_creditpacks_empty_plan_description')).not.toBeInTheDocument();
    });
  });
});
