/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import HeaderUpgradeButton from './HeaderUpgradeButton';

const mockOpenUpgradeModal = vi.fn();
const mockShipAnalyticsLog = vi.fn();
const mockLogClickEvent = vi.fn(() => vi.fn());

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: (...args: unknown[]) => {
    mockLogClickEvent(...args);
    return vi.fn();
  },
}));

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: true, isLoading: false, isError: false, error: null })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((flag: string) => {
    if (flag === 'appbuilder-airoplus-upgrade-button') {
      return { data: true, isLoading: false };
    }
    return { data: false, isLoading: false };
  }),
}));

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: vi.fn(() => ({ isBelowSmBreakpoint: false, isSmBreakpoint: false, isMdBreakpoint: false, isLgBreakpoint: false })),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({
    currentAppId: 'test-app-id',
    openUpgradeModal: mockOpenUpgradeModal,
  }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: any[]) => mockShipAnalyticsLog(...args),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/develop/test-app'),
}));

describe('HeaderUpgradeButton', function headerUpgradeButtonTests() {
  beforeEach(async function setup() {
    vi.clearAllMocks();
    // Reset pathname mock to develop page for each test
    const nextNavigation = await import('next/navigation');
    vi.mocked(nextNavigation).usePathname.mockReturnValue('/develop/test-app');
  });

  describe('rendering conditions', function renderingTests() {
    it('should render when user does not have Airo Plus and feature is enabled', async function renderWithoutAiroPlus() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });
    });

    it('should render when user has Airo Plus since they can upgrade to Starter/Professional/Ultimate', async function renderWithAiroPlus() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      // Mock subscription with AiroPlus plan
      vi.mocked(useSubscription).mockReturnValue({
        data: {
          id: 'sub-123',
          productId: 'aab-v1',
          customerId: 'cust-123',
          plan: SubscriptionPlan.AiroPlus,
          status: 'active',
          isTrial: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        subscriptions: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });
    });

    it('should not render when feature flag is disabled', async function noRenderWhenFlagDisabled() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { container } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render while feature flag is loading', async function noRenderWhileFeatureLoading() {
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: undefined, isLoading: true } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { container } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render while paywall eligibility is loading', async function noRenderWhilePaywallLoading() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: true, isError: false, error: null });

      const { container } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render when not on develop page', async function noRenderOutsideDevelop() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const nextNavigation = await import('next/navigation');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      vi.mocked(nextNavigation).usePathname.mockReturnValue('/apps');

      const { container } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      expect(container.firstChild).toBeNull();
    });

    it('should show text on desktop', async function showTextOnDesktop() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useBreakpoints } = await import('@/hooks/useBreakpoints');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      vi.mocked(useBreakpoints).mockReturnValue({ isBelowSmBreakpoint: false } as ReturnType<typeof useBreakpoints>);

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForText() {
        expect(screen.getByText('builder_upgrade_button')).toBeInTheDocument();
      });
    });

    it('should show text on mobile', async function showTextOnMobile() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useBreakpoints } = await import('@/hooks/useBreakpoints');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      vi.mocked(useBreakpoints).mockReturnValue({ isBelowSmBreakpoint: true } as ReturnType<typeof useBreakpoints>);

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForText() {
        expect(screen.getByText('builder_upgrade_button')).toBeInTheDocument();
      });
    });
  });

  describe('popover interactions', function popoverTests() {
    it('should open popover when button is clicked', async function openPopover() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button'));

      expect(mockLogClickEvent).toHaveBeenCalledWith('test.header.upgrade', { appId: 'test-app-id' });

      await waitFor(function waitForPopover() {
        expect(screen.getByText('builder_upgrade_plans_popover_title')).toBeInTheDocument();
      });
    });

    it('should display credits text in popover', async function displayBenefits() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForTitleAndBenefits() {
        expect(screen.getByText('builder_upgrade_plans_popover_title')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_code')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_credits')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_publish')).toBeInTheDocument();
      });
    });

    it('should call openUpgradeModal when CTA is clicked', async function clickCta() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      // Open popover
      await user.click(screen.getByRole('button'));

      await waitFor(function waitForCta() {
        expect(screen.getByText('builder_upgrade_plans_popover_cta')).toBeInTheDocument();
      });

      // Click the CTA button using accessible name
      await user.click(screen.getByRole('button', { name: 'builder_upgrade_plans_popover_cta' }));

      expect(mockLogClickEvent).toHaveBeenCalledWith('test.header.upgrade_popover', { appId: 'test-app-id' });
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('header.upgrade_button', PAYWALL_ITC.UPGRADE);
    });

    it('should call shipAnalyticsLog when CTA is clicked', async function logAnalytics() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="apps" />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForCta() {
        expect(screen.getByText('builder_upgrade_plans_popover_cta')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_upgrade_plans_popover_cta' }));

      expect(mockLogClickEvent).toHaveBeenCalledWith('apps.header.upgrade_popover', { appId: 'test-app-id' });
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('header.upgrade_button.clicked', {
        appId: 'test-app-id',
        location: 'apps',
      });
    });

  });

  describe('plan-based visibility', function planBasedVisibilityTests() {
    it('should render for Starter user when showPaywall is false', async function starterCanUpgrade() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });
      vi.mocked(useSubscription).mockReturnValue({ data: { id: 'sub-1', plan: SubscriptionPlan.Starter, builderEntitlementId: 'ent-1' }, isLoading: false } as ReturnType<typeof useSubscription>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });
    });

    it('should not render for Ultimate user', async function ultimateNoRender() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });
      vi.mocked(useSubscription).mockReturnValue({ data: { id: 'sub-1', plan: SubscriptionPlan.Ultimate, builderEntitlementId: 'ent-1' }, isLoading: false } as ReturnType<typeof useSubscription>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { container } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      expect(container.firstChild).toBeNull();
    });

    it('should display paid plan content for Starter user', async function starterPaidPlanContent() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });
      vi.mocked(useSubscription).mockReturnValue({ data: { id: 'sub-1', plan: SubscriptionPlan.Starter, builderEntitlementId: 'ent-1' }, isLoading: false } as ReturnType<typeof useSubscription>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForPaidPlanContent() {
        expect(screen.getByText('builder_upgrade_paid_plan_title')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_code')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_paid_plan_benefit_apps')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_paid_plan_benefit_credits')).toBeInTheDocument();
      });
    });

    it('should display paid plan content for Professional user', async function professionalPaidPlanContent() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });
      vi.mocked(useSubscription).mockReturnValue({ data: { id: 'sub-1', plan: SubscriptionPlan.Professional, builderEntitlementId: 'ent-1' }, isLoading: false } as ReturnType<typeof useSubscription>);
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForPaidPlanContent() {
        expect(screen.getByText('builder_upgrade_paid_plan_title')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_code')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_paid_plan_benefit_apps')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_paid_plan_benefit_credits')).toBeInTheDocument();
      });
    });

  });

  describe('location prop', function locationTests() {
    it('should use default location when not provided', async function defaultLocation() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForCta() {
        expect(screen.getByText('builder_upgrade_plans_popover_cta')).toBeInTheDocument();
      });

      // Click the CTA button using accessible name
      await user.click(screen.getByRole('button', { name: 'builder_upgrade_plans_popover_cta' }));

      expect(mockLogClickEvent).toHaveBeenCalledWith('unknown.header.upgrade_popover', { appId: 'test-app-id' });
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('header.upgrade_button.clicked', {
        appId: 'test-app-id',
        location: 'unknown',
      });
    });
  });
});
