import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import HeaderUpgradeButton from './HeaderUpgradeButton';

const mockOpenUpgradeModal = vi.fn();
const mockShipAnalyticsLog = vi.fn();

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: true, isLoading: false, isError: false, error: null })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((flag: string) => {
    // Default: upgrade button enabled, grants enabled
    if (flag === 'appbuilder-airoplus-upgrade-button' || flag === 'app-builder-grants') {
      return { data: true, isLoading: false };
    }
    return { data: false, isLoading: false };
  }),
}));

vi.mock('@/hooks/useResponsive', () => ({
  useResponsive: vi.fn(() => ({ isMobile: false })),
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
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });
    });

    it('should not render when user has Airo Plus', async function noRenderWithAiroPlus() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });

      const { container } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      expect(container.firstChild).toBeNull();
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
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      vi.mocked(nextNavigation).usePathname.mockReturnValue('/apps');

      const { container } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      expect(container.firstChild).toBeNull();
    });

    it('should show text on desktop', async function showTextOnDesktop() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useResponsive } = await import('@/hooks/useResponsive');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      vi.mocked(useResponsive).mockReturnValue({ isMobile: false } as ReturnType<typeof useResponsive>);

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForText() {
        expect(screen.getByText('builder_upgrade_button')).toBeInTheDocument();
      });
    });

    it('should not show text on mobile', async function noTextOnMobile() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useResponsive } = await import('@/hooks/useResponsive');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      vi.mocked(useResponsive).mockReturnValue({ isMobile: true } as ReturnType<typeof useResponsive>);

      renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });

      expect(screen.queryByText('builder_upgrade_button')).not.toBeInTheDocument();
    });
  });

  describe('popover interactions', function popoverTests() {
    it('should open popover when button is clicked', async function openPopover() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      await waitFor(function waitForButton() {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForPopover() {
        // When grants is enabled, shows "plans" title
        expect(screen.getByText('builder_upgrade_plans_popover_title')).toBeInTheDocument();
      });
    });

    it('should display credits text when grants feature is enabled', async function displayBenefitsWithGrants() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForTitleAndBenefits() {
        // When grants is enabled, shows "plans" title and credits benefit
        expect(screen.getByText('builder_upgrade_plans_popover_title')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_code')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_credits')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_publish')).toBeInTheDocument();
      });
    });

    it('should display legacy payments text when grants feature is disabled', async function displayBenefitsWithoutGrants() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForTitleAndBenefits() {
        // When grants is disabled, shows non-plans title and payments benefit
        expect(screen.getByText('builder_upgrade_popover_title')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_code')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_payments')).toBeInTheDocument();
        expect(screen.getByText('builder_upgrade_benefit_publish')).toBeInTheDocument();
      });
    });

    it('should call openUpgradeModal when CTA is clicked', async function clickCta() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      // Open popover
      await user.click(screen.getByRole('button'));

      await waitFor(function waitForCta() {
        // When grants is enabled, shows "plans" CTA
        expect(screen.getByText('builder_upgrade_plans_popover_cta')).toBeInTheDocument();
      });

      // Click the CTA button using accessible name
      await user.click(screen.getByRole('button', { name: 'builder_upgrade_plans_popover_cta' }));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('header.upgrade_button', PAYWALL_ITC.UPGRADE);
    });

    it('should call shipAnalyticsLog when CTA is clicked', async function logAnalytics() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="header" />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForCta() {
        // When grants is enabled, shows "plans" CTA
        expect(screen.getByText('builder_upgrade_plans_popover_cta')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_upgrade_plans_popover_cta' }));

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('header.upgrade_button.clicked', {
        appId: 'test-app-id',
        location: 'header',
      });
    });

    it('should call openUpgradeModal with legacy CTA when grants is disabled', async function clickLegacyCta() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-button') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'app-builder-grants') return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton location="test" />);

      // Open popover
      await user.click(screen.getByRole('button'));

      await waitFor(function waitForCta() {
        // When grants is disabled, shows legacy CTA
        expect(screen.getByText('builder_upgrade_popover_cta')).toBeInTheDocument();
      });

      // Click the legacy CTA button
      await user.click(screen.getByRole('button', { name: 'builder_upgrade_popover_cta' }));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('header.upgrade_button', PAYWALL_ITC.UPGRADE);
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('header.upgrade_button.clicked', {
        appId: 'test-app-id',
        location: 'test',
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
        if (flag === 'app-builder-grants') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });

      const { user } = renderWithProviders(<HeaderUpgradeButton />);

      await user.click(screen.getByRole('button'));

      await waitFor(function waitForCta() {
        // When grants is enabled, shows "plans" CTA
        expect(screen.getByText('builder_upgrade_plans_popover_cta')).toBeInTheDocument();
      });

      // Click the CTA button using accessible name
      await user.click(screen.getByRole('button', { name: 'builder_upgrade_plans_popover_cta' }));

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('header.upgrade_button.clicked', {
        appId: 'test-app-id',
        location: 'unknown',
      });
    });
  });
});
