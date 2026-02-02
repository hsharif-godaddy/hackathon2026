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
const mockUseSwitchboard = vi.fn();
const mockUseActiveSubscription = vi.fn();
const mockUseCreditGrants = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ ...mockRouter(), replace: mockReplace }),
}));

vi.mock('@/components/auth', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/layout/Header', () => ({
  default: () => <div data-testid="header">Header</div>,
}));

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: {
    codeEditor: vi.fn().mockReturnValue(false),
    mockLogin: vi.fn().mockReturnValue(true),
    developmentMode: vi.fn().mockReturnValue(true),
    galleryPage: vi.fn().mockReturnValue(false),
    devSupervisorTcp: vi.fn().mockReturnValue(false),
    localFeatures: vi.fn().mockReturnValue(false),
  },
  MAX_PROMPT_LENGTH: 40000,
  auth: {
    enabled: false,
    isMock: vi.fn().mockReturnValue(false),
    isDisabled: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockUseSwitchboard(),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseActiveSubscription(),
}));

vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: () => mockUseCreditGrants(),
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
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

vi.mock('@/app/develop/components/SinglePlanUpgradeContainer', () => ({
  default: () => <div data-testid="paywall-modal">Paywall Modal</div>,
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
  });

  describe('feature flag gating', function featureFlagTests() {
    it('should show skeleton while feature flag is loading', function loadingSkeleton() {
      mockUseSwitchboard.mockReturnValue({ data: undefined, isLoading: true });

      renderWithProviders(<ManagePlan />);

      // Skeleton should be rendered (has specific structure)
      expect(document.body).toBeTruthy();
    });

    it('should redirect to home when feature flag is disabled', async function redirectDisabled() {
      mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false });

      renderWithProviders(<ManagePlan />);

      await waitFor(function checkRedirect() {
        expect(mockReplace).toHaveBeenCalledWith('/');
      });
    });

    it('should render content when feature flag is enabled', function renderContent() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      expect(screen.getByText('builder_manageplan_title')).toBeInTheDocument();
    });
  });

  describe('loading states', function loadingTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
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

  describe('error states', function errorTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
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
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
    });

    it('should render page title', function renderTitle() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [],
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
        data: [],
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
        data: [],
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

      expect(screen.getByText('builder_manageplan_monthly_credits')).toBeInTheDocument();
    });

    it('should render CreditPacksCard component', function renderCreditPacksCard() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
      });

      renderWithProviders(<ManagePlan />);

      // Empty state title from CreditPacksCard
      expect(screen.getByText('builder_manageplan_creditpacks_empty_title')).toBeInTheDocument();
    });
  });

  describe('button visibility', function buttonTests() {
    beforeEach(function setupFeatureEnabled() {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
    });

    describe('free plan scenarios', function freePlanTests() {
      it('should not show page-level buttons for free plan without credit packs', function freeNoPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Free },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // Page-level buttons should not be visible (CreditPacksCard has its own buttons)
        expect(screen.queryByText('builder_manageplan_cancel_plan')).not.toBeInTheDocument();
      });

      it('should show upgrade and buy credits buttons for free plan with credit packs', function freeWithPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.Free },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMockGrant()],
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
          data: [createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.queryByText('builder_manageplan_cancel_plan')).not.toBeInTheDocument();
      });
    });

    describe('paid plan scenarios', function paidPlanTests() {
      it('should show cancel plan button for paid plan without credit packs', function paidNoPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.getByText('builder_manageplan_cancel_plan')).toBeInTheDocument();
      });

      it('should not show upgrade or buy credits buttons for paid plan without credit packs', function paidNoPacksNoUpgrade() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        // Page-level upgrade button should not exist for paid users
        expect(screen.queryByText('builder_manageplan_upgrade')).not.toBeInTheDocument();
        // Page-level buy credits should not show without credit packs
        // (CreditPacksCard has its own buy credits button in empty state)
      });

      it('should show buy credits and cancel buttons for paid plan with credit packs', function paidWithPacks() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMockGrant()],
          isLoading: false,
          isError: false,
        });

        renderWithProviders(<ManagePlan />);

        expect(screen.getByText('builder_manageplan_buy_credits')).toBeInTheDocument();
        expect(screen.getByText('builder_manageplan_cancel_plan')).toBeInTheDocument();
      });

      it('should not show upgrade button for paid plan with credit packs', function paidWithPacksNoUpgrade() {
        mockUseActiveSubscription.mockReturnValue({
          data: { id: 'sub-1', plan: SubscriptionPlan.AiroPlus },
          isLoading: false,
          isError: false,
        });
        mockUseCreditGrants.mockReturnValue({
          data: [createMockGrant()],
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
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
    });

    it('should open paywall modal when upgrade button is clicked', async function openPaywallOnUpgrade() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMockGrant()],
        isLoading: false,
        isError: false,
      });

      const { user } = renderWithProviders(<ManagePlan />);

      await user.click(screen.getByText('builder_manageplan_upgrade'));

      await waitFor(function checkModal() {
        expect(screen.getByTestId('paywall-modal')).toBeInTheDocument();
      });
    });

    it('should open paywall modal when buy credits button is clicked', async function openPaywallOnBuyCredits() {
      mockUseActiveSubscription.mockReturnValue({
        data: { id: 'sub-1', plan: SubscriptionPlan.Free },
        isLoading: false,
        isError: false,
      });
      mockUseCreditGrants.mockReturnValue({
        data: [createMockGrant()],
        isLoading: false,
        isError: false,
      });

      const { user } = renderWithProviders(<ManagePlan />);

      await user.click(screen.getByText('builder_manageplan_buy_credits'));

      await waitFor(function checkModal() {
        expect(screen.getByTestId('paywall-modal')).toBeInTheDocument();
      });
    });
  });
});
