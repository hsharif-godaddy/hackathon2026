/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import CreditPacksCard from './AddonCreditCard';

/**
 * Helper to collapse the card by clicking the chevron button (card starts expanded)
 */
function collapseCard() {
  const collapseButton = screen.getByRole('button', { name: /Collapse/i });
  fireEvent.click(collapseButton);
}

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
    it('should render description text when expanded', function renderDescription() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );
      // Card starts expanded by default

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
    });

    it('should render all credit pack rows when expanded', function renderAllRows() {
      const packs = [
        createMockGrant({ id: 'pack-1' }),
        createMockGrant({ id: 'pack-2' }),
        createMockGrant({ id: 'pack-3' }),
      ];

      renderWithProviders(
        <CreditPacksCard creditPacks={packs} onOpenPaywall={mockOnOpenPaywall} isGrantsEnabled={true} />
      );
      // Card starts expanded by default

      // Each pack should be rendered - check for pack names
      const packNames = screen.getAllByText('builder_manageplan_pack');
      expect(packNames).toHaveLength(3);
    });

    it('should pass activeGrantId to rows when expanded', function passActiveId() {
      const packs = [
        createMockGrant({ id: 'pack-1' }),
        createMockGrant({ id: 'pack-2' }),
      ];

      renderWithProviders(
        <CreditPacksCard
          creditPacks={packs}
          activeGrantId="pack-1"
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );
      // Card starts expanded by default

      // The active tag should be shown for the active grant
      // Two ActiveTags are rendered (mobile and desktop versions)
      const activeTags = screen.getAllByText('builder_manageplan_active');
      expect(activeTags.length).toBe(2);
    });

    it('should show credits count in header when collapsed', function showsCreditsCount() {
      const packs = [
        createMockGrant({ id: 'pack-1', creditsSpent: 1000, creditsMax: 2000 }),
        createMockGrant({ id: 'pack-2', creditsSpent: 500, creditsMax: 3000 }),
      ];

      renderWithProviders(
        <CreditPacksCard creditPacks={packs} onOpenPaywall={mockOnOpenPaywall} isGrantsEnabled={true} />
      );

      // Collapse the card first (it starts expanded)
      collapseCard();

      // Should show total credits used / max in header when collapsed (text is split across elements for styling)
      expect(screen.getByText((content, element) => {
        return element?.textContent === '1500/5000';
      })).toBeInTheDocument();
    });

    it('should be expanded by default', function expandedByDefault() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Description should be visible when expanded (default)
      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
    });
  });

  describe('zero state: no plan and no credits (Free plan, zero packs)', function zeroPlanZeroPacksTests() {
    it('should render section title', function renderSectionTitle() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_addons_title')).toBeInTheDocument();
    });

    it('should render plan-specific description', function renderPlanDescription() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
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
          isGrantsEnabled={true}
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
          isGrantsEnabled={true}
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
          isGrantsEnabled={true}
          builderEntitlementId="test-entitlement-123"
        />
      );

      await user.click(screen.getByText('builder_manageplan_upgrade'));

      expect(mockOnOpenPaywall).toHaveBeenCalledWith('manage_plan.upgrade', 'upgrade', PAYWALL_ITC.UPGRADE);
    });

    it('should call onOpenPaywall with credits type when Buy Credits clicked', async function clickBuyCredits() {
      const { user } = renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
          builderEntitlementId="test-entitlement-123"
        />
      );

      await user.click(screen.getByText('builder_manageplan_buy_credits'));

      expect(mockOnOpenPaywall).toHaveBeenCalledWith('manage_plan.buy_credits', 'credits', PAYWALL_ITC.CREDITS);
    });

    it('should disable buttons when builderEntitlementId is missing', function disableWithoutEntitlement() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_upgrade').closest('button')).toBeDisabled();
      expect(screen.getByText('builder_manageplan_buy_credits').closest('button')).toBeDisabled();
    });

    it('should toggle content visibility when collapse button is clicked', function toggleZeroStateContent() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // Content should be visible by default (expanded)
      expect(screen.getByText('builder_manageplan_creditpacks_empty_plan_description')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();

      // Click collapse button
      collapseCard();

      expect(screen.getByRole('button', { name: /Expand/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );

      // Click expand button to show content again
      const expandButton = screen.getByRole('button', { name: /Expand/i });
      fireEvent.click(expandButton);

      // Content should be visible again
      expect(screen.getByText('builder_manageplan_creditpacks_empty_plan_description')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
    });
  });

  describe('zero state: None plan with zero packs', function zeroNonePlanTests() {
    it('should show both buttons for None plan with no packs', function nonePlanButtons() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.None}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
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
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_addons_title')).toBeInTheDocument();
      // Should show generic description, not plan-specific
      expect(screen.getByText('builder_manageplan_creditpacks_empty_description')).toBeInTheDocument();
    });

    it('should only show Buy Credits button for paid plan with no packs', function paidPlanOnlyBuyCredits() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
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
          isGrantsEnabled={true}
        />
      );

      // SiteBuild SVG should be rendered (different from RidingArrow)
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render empty state for AiroPlus plan with no packs (treated as non-paid)', function airoPlusNoPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.AiroPlus}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      expect(screen.getByText('builder_manageplan_addons_title')).toBeInTheDocument();
      // AiroPlus is now treated as non-paid plan, so shows plan-specific description
      expect(screen.getByText('builder_manageplan_creditpacks_empty_plan_description')).toBeInTheDocument();
    });

    it('should show both buttons for AiroPlus plan with no packs (treated as non-paid)', function airoPlusBothButtons() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[]}
          subscriptionPlan={SubscriptionPlan.AiroPlus}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );

      // AiroPlus is now treated as non-paid, so shows both buttons like Free plan
      expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
    });
  });

  describe('handles different plan types with credit packs', function planTypesWithPacksTests() {
    it('should render packs for Free plan when expanded', function freeWithPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          subscriptionPlan={SubscriptionPlan.Free}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );
      // Card starts expanded by default

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_pack')).toBeInTheDocument();
    });

    it('should render packs for Starter plan when expanded', function starterWithPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          subscriptionPlan={SubscriptionPlan.Starter}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );
      // Card starts expanded by default

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
    });

    it('should render packs for AiroPlus plan when expanded', function airoPlusWithPacks() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          subscriptionPlan={SubscriptionPlan.AiroPlus}
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );
      // Card starts expanded by default

      expect(screen.getByText('builder_manageplan_credits_description')).toBeInTheDocument();
    });
  });

  describe('handles locale', function localeTests() {
    it('should pass locale to CreditGrantRow when expanded', function passLocale() {
      renderWithProviders(
        <CreditPacksCard
          creditPacks={[createMockGrant()]}
          locale="de-DE"
          onOpenPaywall={mockOnOpenPaywall}
          isGrantsEnabled={true}
        />
      );
      // Card starts expanded by default

      // The component should render without errors with locale
      expect(screen.getByText('builder_manageplan_pack')).toBeInTheDocument();
    });
  });
});
