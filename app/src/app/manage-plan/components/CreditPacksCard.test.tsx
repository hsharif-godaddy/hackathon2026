import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import CreditPacksCard from './CreditPacksCard';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((event: string) => `${event}.click`),
}));

function createMockGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'grant-1',
    subscriptionId: 'sub-1',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'user-1',
    llmBudgetId: 'budget-1',
    creditsMax: 5000,
    creditsSpent: 3491,
    isAvailable: true,
    finalState: null,
    useBefore: '2026-02-04T00:00:00.000Z',
    consumedAt: null,
    createdAt: '2026-01-04T00:00:00.000Z',
    updatedAt: '2026-01-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('CreditPacksCard', function creditPacksCardTests() {
  const mockOnOpenPaywall = vi.fn();

  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders with credit packs', function withPacksTests() {
    it('should render description text', function renderDescription() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
    });

    it('should render all credit pack rows', function renderAllRows() {
      const packs = [
        createMockGrant({ id: 'pack-1' }),
        createMockGrant({ id: 'pack-2' }),
        createMockGrant({ id: 'pack-3' }),
      ];

      renderWithProviders(
        <CreditPacksCard creditPacks={packs} onOpenPaywall={mockOnOpenPaywall} />
      );

      // Each pack should be rendered - check for pack names
      const packNames = screen.getAllByText('builder_manageplan_pack');
      expect(packNames).toHaveLength(3);
    });

    it('should pass activeGrantId to rows', function passActiveId() {
      const packs = [
        createMockGrant({ id: 'pack-1' }),
        createMockGrant({ id: 'pack-2' }),
      ];

      renderWithProviders(
        <CreditPacksCard
          creditPacks={packs}
          activeGrantId="pack-1"
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      // The active tag should be shown for the active grant
      expect(screen.getByText('builder_manageplan_active')).toBeInTheDocument();
    });
  });

  describe('zero state: no plan and no credits (Free plan, zero packs)', function zeroPlanZeroPacksTests() {
    it('should render empty state title', function renderEmptyTitle() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_creditpacks_empty_title')).toBeInTheDocument();
    });

    it('should render plan-specific description', function renderPlanDescription() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_creditpacks_empty_plan_description')).toBeInTheDocument();
    });

    it('should show both Upgrade and Buy Credits buttons', function showBothButtons() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
    });

    it('should render RidingArrow SVG', function renderRidingArrow() {
      const { container } = renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      // RidingArrow is rendered
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should call onOpenPaywall with upgrade source when Upgrade clicked', async function clickUpgrade() {
      const { user } = renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      await user.click(screen.getByText('builder_manageplan_upgrade'));

      expect(mockOnOpenPaywall).toHaveBeenCalledWith('manage_plan.upgrade', 'upgrade');
    });

    it('should call onOpenPaywall with credits type when Buy Credits clicked and grants enabled', async function clickBuyCreditsGrantsEnabled() {
      const { user } = renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      await user.click(screen.getByText('builder_manageplan_buy_credits'));

      expect(mockOnOpenPaywall).toHaveBeenCalledWith('manage_plan.buy_credits', 'credits');
    });

    it('should call onOpenPaywall with upgrade type when Buy Credits clicked and grants disabled', async function clickBuyCreditsGrantsDisabled() {
      const { user } = renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={false}
        />
      );

      await user.click(screen.getByText('builder_manageplan_buy_credits'));

      expect(mockOnOpenPaywall).toHaveBeenCalledWith('manage_plan.buy_credits', 'upgrade');
    });
  });

  describe('zero state: None plan with zero packs', function zeroNonePlanTests() {
    it('should show both buttons for None plan with no packs', function nonePlanButtons() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.None}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
    });
  });

  describe('zero state: has plan but no credit packs (Starter/AiroPlus)', function hasPlanZeroPacksTests() {
    it('should render empty state for Starter plan with no packs', function starterNoPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_creditpacks_empty_title')).toBeInTheDocument();
      // Should show generic description, not plan-specific
      expect(screen.getByText('builder_manageplan_creditpacks_empty_description')).toBeInTheDocument();
    });

    it('should only show Buy Credits button for paid plan with no packs', function paidPlanOnlyBuyCredits() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
    });

    it('should render SiteBuild SVG for paid plan empty state', function renderSiteBuild() {
      const { container } = renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      // SiteBuild SVG should be rendered (different from RidingArrow)
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render empty state for AiroPlus plan with no packs', function airoPlusNoPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.AiroPlus}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_creditpacks_empty_title')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_creditpacks_empty_description')).toBeInTheDocument();
    });
  });

  describe('handles different plan types with credit packs', function planTypesWithPacksTests() {
    it('should render packs for Free plan', function freeWithPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_pack')).toBeInTheDocument();
    });

    it('should render packs for Starter plan', function starterWithPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
    });

    it('should render packs for AiroPlus plan', function airoPlusWithPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          subscriptionPlan={SubscriptionPlan.AiroPlus}
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
    });
  });

  describe('handles locale', function localeTests() {
    it('should pass locale to CreditGrantRow', function passLocale() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          locale="de-DE"
          onOpenPaywall={mockOnOpenPaywall}
        />
      );

      // The component should render without errors with locale
      expect(screen.getByText('builder_manageplan_pack')).toBeInTheDocument();
    });
  });
});
