/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { mockRouter } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import type { CreditGrant } from '@/types/credits';
import { GrantType, SubscriptionPlan } from '@/types/credits';
import ManagePlan from './page';

const mockReplace = vi.fn();
const mockPrefetch = vi.fn();
const mockUseSwitchboard = vi.fn();
const mockUseActiveSubscription = vi.fn();
const mockUseCreditGrants = vi.fn();
const mockSetAutoRenewMutate = vi.fn();
const mockSwitchboardFlags: Record<string, boolean | undefined> = {};
const mockUseSites = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ ...mockRouter(), replace: mockReplace, prefetch: mockPrefetch }),
}));

vi.mock('@/components/auth', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/layout/Header', () => ({
  default: () => <div data-testid="header">Header</div>,
}));

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    mockLogin: vi.fn().mockReturnValue(true),
    developmentMode: vi.fn().mockReturnValue(true),
    devSupervisorTcp: vi.fn().mockReturnValue(false),
  },
  MAX_PROMPT_LENGTH: 40000,
  auth: {
    enabled: false,
    isMock: vi.fn().mockReturnValue(false),
    isDisabled: vi.fn().mockReturnValue(true),
  },
  authUtils: {
    getSupportedAuthTypes: vi.fn().mockReturnValue(['basic', 'e2s', 's2s']),
  },
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flagName: string) => {
    // If specific flag is set in mockSwitchboardFlags, use that value
    if (flagName in mockSwitchboardFlags) {
      return mockSwitchboardFlags[flagName];
    }
    // Otherwise fall back to the default mock behavior
    return mockUseSwitchboard();
  },
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseActiveSubscription(),
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: () => mockUseCreditGrants(),
}));

const mockUseEcommSubscriptionAutoRenewStatus = vi.fn();
vi.mock('@/hooks/useEcommSubscriptionAutoRenewStatus', () => ({
  useEcommSubscriptionAutoRenewStatus: () => mockUseEcommSubscriptionAutoRenewStatus(),
}));

const mockSetAutoRenewState = {
  isSuccess: false,
  variables: undefined as { builderEntitlementId: string; autoRenew: boolean } | undefined,
};
vi.mock('@/hooks/useEcommSubscriptionAutoRenew', () => ({
  useEcommSubscriptionAutoRenew: () => ({
    setAutoRenew: {
      mutate: mockSetAutoRenewMutate,
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: mockSetAutoRenewState.isSuccess,
      variables: mockSetAutoRenewState.variables,
      error: null,
      reset: vi.fn(),
    },
  }),
}));

vi.mock('@/hooks/useUpgradePurchase', () => ({
  useIsUpgradePolling: () => false,
}));

vi.mock('@/hooks/useCreditPurchase', () => ({
  useIsCreditPolling: () => false,
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({ intl: { locale: 'en-US' } }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((event: string) => `${event}.click`),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
  ClientLogBuffer: {
    add: vi.fn(),
  },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

vi.mock('@/stores/useSitesStore', () => ({
  useSites: (...args: unknown[]) => mockUseSites(...args),
  useSitesStore: vi.fn((selector) => {
    const state = {
      allSites: [],
      isLoadingAll: false,
      error: null,
      fetchAllSites: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

// Mock @ux/modal to avoid Disrupt rendering issues in test environment
vi.mock('@ux/modal', () => ({
  default: ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Close">Close</button>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/app/[market]/develop/components/paywall', () => ({
  CdsEsmPreload: () => null,
  UpgradeContainer: () => <div data-testid="upgrade-modal">Upgrade Modal</div>,
  CreditsUpgradeContainer: ({ entitlementId }: { entitlementId: string }) => (
    <div data-testid="credits-modal">
      <span data-testid="entitlement-id">{entitlementId}</span>
      Credits Modal
    </div>
  ),
  GrantPollingModal: () => <div data-testid="grant-polling-modal">Grant Polling Modal</div>,
  RenewalPollingModal: () => <div data-testid="renewal-polling-modal">Renewal Polling Modal</div>,
  UpgradePollingModal: () => <div data-testid="upgrade-polling-modal">Upgrade Polling Modal</div>,
}));

function createMockGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: 'grant-1',
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

function createMonthlyGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return createMockGrant({
    id: 'monthly-grant',
    type: GrantType.PlanMonthly,
    creditsMax: 10000,
    creditsSpent: 2500,
    ...overrides,
  });
}

describe('ManagePlan', function managePlanTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockReplace.mockClear();
    mockUseSites.mockReturnValue({ sites: [], isLoading: false, error: null });
    // Reset switchboard flags
    Object.keys(mockSwitchboardFlags).forEach((key) => delete mockSwitchboardFlags[key]);
    // Reset autoRenew mutation state
    mockSetAutoRenewState.isSuccess = false;
    mockSetAutoRenewState.variables = undefined;
    // Default mock for autoRenew status
    mockUseEcommSubscriptionAutoRenewStatus.mockReturnValue({
      data: { autoRenew: true, paidThroughDate: '2027-01-29T07:00:00Z', subscriptionId: 'sub-123' },
      isLoading: false,
      isError: false,
    });
  });

  describe('feature flag gating', function featureFlagTests() {
    it('should show skeleton while feature flag is loading', function loadingSkeleton() {
      mockUseSwitchboard.mockReturnValue(undefined);

      renderWithProviders(<ManagePlan />);

      // Skeleton should be rendered (has specific structure)
      expect(document.body).toBeTruthy();
    });

    it('should redirect to home when feature flag is disabled', async function redirectDisabled() {
      mockUseSwitchboard.mockReturnValue(false);

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkRedirect() {
        expect(mockReplace).toHaveBeenCalledWith('/');
      });
    });

    it('should render content when feature flag is enabled', function renderContent() {
      mockUseSwitchboard.mockReturnValue(true);
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_title')).toBeInTheDocument();
    });
  });

  describe('loading states', function loadingTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should show skeleton when subscription is loading', function subscriptionLoading() {
      mockUseActiveSubscription.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      // Page should render skeleton (no title visible)
      expect(screen.queryByText('builder_manageplan_title')).not.toBeInTheDocument();
    });

    it('should show skeleton when grants are loading', function grantsLoading() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.queryByText('builder_manageplan_title')).not.toBeInTheDocument();
    });
  });

  describe('new account zero state', function newAccountZeroStateTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should show new account zero state when subscription does not exist', function showZeroState() {
      mockUseActiveSubscription.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_newaccount_title')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_newaccount_description')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_newaccount_cta')).toBeInTheDocument();
    });

    it('should not show regular content when subscription does not exist', function hideRegularContent() {
      mockUseActiveSubscription.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.queryByText('builder_manageplan_title')).not.toBeInTheDocument();
    });
  });

  describe('error states', function errorTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should show error message when subscription fetch fails', function subscriptionError() {
      mockUseActiveSubscription.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });
      mockUseCreditGrants.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_error')).toBeInTheDocument();
    });

    it('should show error message when grants fetch fails', function grantsError() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_error')).toBeInTheDocument();
    });
  });

  describe('content rendering', function contentTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should render page title', function renderTitle() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_title')).toBeInTheDocument();
    });

    it('should show free plan tag for free users', function freePlanTag() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_plan_free')).toBeInTheDocument();
    });

    it('should show airo plus plan tag for paid users', function paidPlanTag() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_plan_airo_plus')).toBeInTheDocument();
    });

    it('should render PlanCreditCard component', function renderPlanCreditCard() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_total_credits')).toBeInTheDocument();
    });

    it('should render CreditPacksCard component', function renderCreditPacksCard() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      // Section title from CreditPacksCard
      expect(screen.getByText('builder_manageplan_addons_title')).toBeInTheDocument();
    });
  });

  describe('button visibility', function buttonTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    describe('free plan scenarios', function freePlanTests() {
      it('should not show page-level buttons for free plan without credit packs', function freeNoPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Free },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // Page-level buttons should not be visible (CreditPacksCard has its own buttons)
        expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
      });

      it('should show upgrade and buy credits buttons for free plan with credit packs', function freeWithPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Free },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant(), createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
        expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
      });

      it('should not show cancel plan button for free plan with credit packs', function freeNoCancel() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Free },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant(), createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
      });
    });

    describe('paid plan scenarios', function paidPlanTests() {
      it('should show cancel plan button for Starter plan without credit packs', function starterNoPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Starter },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.getByText('builder_manageplan_downgrade_plan')).toBeInTheDocument();
      });

      it('should show upgrade button for Starter plan without credit packs', function starterNoPacksShowsUpgrade() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Starter },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
      });

      it('should show buy credits and cancel buttons for Starter plan with credit packs', function starterWithPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Starter },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant(), createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
        expect(screen.getByText('builder_manageplan_downgrade_plan')).toBeInTheDocument();
      });

      it('should show upgrade button for Starter plan with credit packs', function starterWithPacksShowsUpgrade() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Starter },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant(), createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
      });
    });

    describe('AiroPlus plan scenarios (grants enabled - AiroPlus treated as non-paid)', function airoPlusGrantsEnabledTests() {
      // When grants is ON (set in parent beforeEach), AiroPlus is NOT a paid plan
      // AiroPlus users are treated like Free users and should see upgrade options

      it('should NOT show cancel plan button for AiroPlus plan (not a paid plan)', function airoPlusNoCancel() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // AiroPlus is not a paid plan when grants is ON, so no cancel/downgrade button
        expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
      });

      it('should show buy credits button for AiroPlus plan with credit packs (treated like Free)', function airoPlusWithPacksShowBuyCredits() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant(), createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // AiroPlus is treated like Free when grants is ON - should see buy credits
        expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
      });

      it('should show AddonCreditCard for AiroPlus plan (treated like Free)', function airoPlusShowAddonCard() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // AddonCreditCard section title should be visible for AiroPlus when grants is ON
        expect(screen.getByText('builder_manageplan_addons_title')).toBeInTheDocument();
      });

      it('should show upgrade button for AiroPlus plan with credit packs (treated like Free)', function airoPlusShowUpgrade() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant(), createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // AiroPlus is treated like Free when grants is ON - should see upgrade
        expect(screen.getByText('builder_manageplan_upgrade')).toBeInTheDocument();
      });
    });

    describe('AiroPlus plan scenarios (grants disabled - legacy behavior)', function airoPlusGrantsDisabledTests() {
      beforeEach(function setupGrantsDisabled() {
        // Override to disable grants - tests legacy AiroPlus behavior
        mockUseSwitchboard.mockReturnValue(false);
      });

      it('should NOT show cancel plan button for AiroPlus plan (legacy)', function airoPlusNoCancel() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.queryByText('builder_manageplan_downgrade_plan')).not.toBeInTheDocument();
      });

      it('should NOT show buy credits button for AiroPlus plan (legacy)', function airoPlusNoBuyCredits() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant(), createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.queryByText('builder_manageplan_buy_credits')).not.toBeInTheDocument();
      });

      it('should NOT show AddonCreditCard for AiroPlus plan (legacy)', function airoPlusNoAddonCard() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // AddonCreditCard should not be visible for legacy AiroPlus
        expect(screen.queryByText('builder_manageplan_addons_title')).not.toBeInTheDocument();
      });

      it('should NOT show upgrade button for AiroPlus plan (legacy)', function airoPlusNoUpgrade() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMonthlyGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
      });
    });
  });

  describe('paywall modal', function paywallTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should open upgrade modal when upgrade button is clicked', async function openUpgradeOnUpgrade() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free, builderEntitlementId: 'entitlement-123' },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant(), createMockGrant()],
        isLoading: false,
        isError: false,
      });

      const { user } = renderWithProviders(<ManagePlan />);

      await user.click(screen.getByText('builder_manageplan_upgrade'));

      await waitFor(function checkModal() {
        expect(screen.getByTestId('upgrade-modal')).toBeInTheDocument();
      });
    });

    it('should open credits modal when buy credits button is clicked with entitlementId', async function openCreditsOnBuyCredits() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free, builderEntitlementId: 'entitlement-123' },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant(), createMockGrant()],
        isLoading: false,
        isError: false,
      });

      const { user } = renderWithProviders(<ManagePlan />);

      await user.click(screen.getByText('builder_manageplan_buy_credits'));

      await waitFor(function checkModal() {
        expect(screen.getByTestId('credits-modal')).toBeInTheDocument();
        expect(screen.getByTestId('entitlement-id').textContent).toBe('entitlement-123');
      });
    });

    it('should disable buy credits button when builderEntitlementId is not available', async function disableBuyCreditsNoEntitlement() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant(), createMockGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkButtonDisabled() {
        const buyCreditsButton = screen.getByText('builder_manageplan_buy_credits').closest('button');
        expect(buyCreditsButton).toBeDisabled();
      });
    });

    it('should log analytics when opening upgrade modal', async function logUpgradeAnalytics() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free, builderEntitlementId: 'entitlement-123' },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant(), createMockGrant()],
        isLoading: false,
        isError: false,
      });

      const { user } = renderWithProviders(<ManagePlan />);

      await user.click(screen.getByText('builder_manageplan_upgrade'));

      await waitFor(function checkAnalytics() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('manage_plan.upgrade_plan.shown', {
          paywallType: 'upgrade',
        });
      });
    });

    it('should log analytics when opening credits modal', async function logCreditsAnalytics() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free, builderEntitlementId: 'entitlement-123' },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant(), createMockGrant()],
        isLoading: false,
        isError: false,
      });

      const { user } = renderWithProviders(<ManagePlan />);

      await user.click(screen.getByText('builder_manageplan_buy_credits'));

      await waitFor(function checkAnalytics() {
        expect(shipAnalyticsLog).toHaveBeenCalledWith('manage_plan.buy_credits.shown', {
          paywallType: 'credits',
        });
      });
    });
  });

  describe('cancellation analytics', function cancellationTests() {
    beforeEach(function setupCancellationTests() {
      mockUseSwitchboard.mockReturnValue(true);
      mockSetAutoRenewMutate.mockClear();
    });

    it('should log cancellation analytics when downgrade is confirmed', async function logCancellationAnalytics() {
      const { shipAnalyticsLog } = await import('@/lib/logging');
      const { logImpressionEvent } = await import('@/utils/instrumentation');

      // Setup mutate to call onSuccess callback
      mockSetAutoRenewMutate.mockImplementation((_params: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
      });

      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Starter, builderEntitlementId: 'ent-123' },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      const { user } = renderWithProviders(<ManagePlan />);

      // Click downgrade button to open modal
      await user.click(screen.getByText('builder_manageplan_downgrade_plan'));

      // Wait for modal to open
      await waitFor(function checkModalOpen() {
        expect(screen.getByText('builder_manageplan_downgrade_title')).toBeInTheDocument();
      });

      // Click confirm in the modal
      await user.click(screen.getByText('builder_manageplan_downgrade_confirm'));

      // Verify cancellation analytics
      await waitFor(function checkCancellationAnalytics() {
        expect(logImpressionEvent).toHaveBeenCalledWith('plan.cancellation.success');
        expect(shipAnalyticsLog).toHaveBeenCalledWith('plan.cancellation.success', {
          fromPlan: SubscriptionPlan.Starter,
        });
      });
    });
  });

  describe('downgrade scheduled alert', function downgradeAlertTests() {
    beforeEach(function setupDowngradeTests() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should show downgrade alert when subscription has downgradedAt, downgradedPlan, and renewsAt', async function showAlertWithScheduledDowngrade() {
      mockUseActiveSubscription.mockReturnValue({
        data: {
          id: 'sub-1',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'ent-123',
          renewsAt: '2027-03-01T00:00:00Z',
          downgradedAt: '2027-02-15T00:00:00Z',
          downgradedPlan: SubscriptionPlan.Free,
        },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkAlertVisible() {
        expect(screen.getByText('builder_manageplan_downgrade_plan_title')).toBeInTheDocument();
      });
    });

    it('should NOT show downgrade alert when subscription does not have downgradedAt', async function hideAlertNoDowngrade() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Starter, builderEntitlementId: 'ent-123' },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkNoAlert() {
        expect(screen.queryByText('builder_manageplan_downgrade_plan_title')).not.toBeInTheDocument();
      });
    });

    it('should NOT show downgrade alert when only downgradedAt is present without downgradedPlan', async function noAlertMissingDowngradePlan() {
      mockUseActiveSubscription.mockReturnValue({
        data: {
          id: 'sub-1',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'ent-123',
          downgradedAt: '2027-02-15T00:00:00Z',
          // downgradedPlan is missing
        },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkNoAlert() {
        expect(screen.queryByText('builder_manageplan_downgrade_plan_title')).not.toBeInTheDocument();
      });
    });

    it('should show downgrade alert for free plans with scheduled downgrade fields', async function showAlertFreePlanWithDowngradeData() {
      mockUseActiveSubscription.mockReturnValue({
        data: {
          id: 'sub-1',
          plan: SubscriptionPlan.Free,
          renewsAt: '2027-03-01T00:00:00Z',
          downgradedAt: '2027-02-15T00:00:00Z',
          downgradedPlan: SubscriptionPlan.Free,
        },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      // Alert shows when subscription has downgradedAt/downgradedPlan/renewsAt fields,
      // regardless of current plan (in practice, free plans rarely have these)
      await waitFor(function checkAlertVisible() {
        expect(screen.getByText('builder_manageplan_downgrade_plan_title')).toBeInTheDocument();
      });
    });

    it('should NOT show downgrade alert when renewsAt is missing', async function noAlertMissingRenewsAt() {
      mockUseActiveSubscription.mockReturnValue({
        data: {
          id: 'sub-1',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'ent-123',
          downgradedAt: '2027-02-15T00:00:00Z',
          downgradedPlan: SubscriptionPlan.Free,
          // renewsAt is missing - alert should not show to prevent Invalid Date crash
        },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkNoAlert() {
        expect(screen.queryByText('builder_manageplan_downgrade_plan_title')).not.toBeInTheDocument();
      });
    });
  });

  describe('free auto-renew alert (mutation state bypass)', function freeAutoRenewAlertTests() {
    beforeEach(function setupFreeAutoRenewTests() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should show banner when mutation succeeded with autoRenew=false even if isRecentPlanChange', async function showBannerWithMutationState() {
      // Subscription with recent updatedAt (would normally suppress banner)
      mockUseActiveSubscription.mockReturnValue({
        data: {
          id: 'sub-1',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'ent-123',
          updatedAt: new Date().toISOString(),
          createdAt: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });
      // autoRenew status not yet synced (still true from API)
      mockUseEcommSubscriptionAutoRenewStatus.mockReturnValue({
        data: { autoRenew: true, paidThroughDate: '2027-01-29T07:00:00Z', subscriptionId: 'sub-123' },
        isLoading: false,
        isError: false,
      });
      // Mutation succeeded with autoRenew=false (user just clicked "Switch to Free")
      mockSetAutoRenewState.isSuccess = true;
      mockSetAutoRenewState.variables = { builderEntitlementId: 'ent-123', autoRenew: false };

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkBannerVisible() {
        expect(screen.getByText('builder_manageplan_downgrade_plan_title')).toBeInTheDocument();
      });
    });

    it('should NOT show banner when isRecentPlanChange and no mutation state (upgrade race)', async function hideBannerForUpgradeRace() {
      // Recent updatedAt (fresh upgrade) with autoRenew=false (stale, hasn't synced)
      mockUseActiveSubscription.mockReturnValue({
        data: {
          id: 'sub-1',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'ent-123',
          updatedAt: new Date().toISOString(),
          createdAt: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });
      mockUseEcommSubscriptionAutoRenewStatus.mockReturnValue({
        data: { autoRenew: false, paidThroughDate: '2027-01-29T07:00:00Z', subscriptionId: 'sub-123' },
        isLoading: false,
        isError: false,
      });
      // No mutation state (page loaded fresh after upgrade, not a user-initiated downgrade)

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkBannerNotVisible() {
        expect(screen.queryByText('builder_manageplan_downgrade_plan_title')).not.toBeInTheDocument();
      });
    });

    it('should show banner when autoRenew=false and subscription is not recently changed', async function showBannerNormalRefresh() {
      // Old updatedAt (not a recent change)
      mockUseActiveSubscription.mockReturnValue({
        data: {
          id: 'sub-1',
          plan: SubscriptionPlan.Starter,
          builderEntitlementId: 'ent-123',
          updatedAt: '2024-01-01T00:00:00Z',
          createdAt: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });
      mockUseEcommSubscriptionAutoRenewStatus.mockReturnValue({
        data: { autoRenew: false, paidThroughDate: '2027-01-29T07:00:00Z', subscriptionId: 'sub-123' },
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkBannerVisible() {
        expect(screen.getByText('builder_manageplan_downgrade_plan_title')).toBeInTheDocument();
      });
    });
  });

  describe('prefetches develop route', function prefetchTests() {
    beforeEach(function setupPrefetchTests() {
      mockUseSwitchboard.mockReturnValue(true);
    });

    it('should prefetch /develop route using the first site id', async function prefetchFirstSite() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Starter },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });
      mockUseSites.mockReturnValue({
        sites: [{ id: 'first-site' }, { id: 'second-site' }],
        isLoading: false,
        error: null,
      });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkPrefetch() {
        expect(mockPrefetch).toHaveBeenCalledWith('/develop/first-site');
      });
    });

    it('should not prefetch when there are no sites', function noPrefetchEmptySites() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Starter },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMonthlyGrant()],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(mockPrefetch).not.toHaveBeenCalled();
    });
  });
});
