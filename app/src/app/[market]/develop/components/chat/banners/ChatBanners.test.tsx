/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { WarningLevel } from '@/types/usage';
import ChatBanners from './ChatBanners';

// Mock hooks that child components use
vi.mock('@/hooks/useUsage', () => ({
  useUsage: vi.fn(() => ({
    isWarningBannerActive: false,
    percentage: 0,
    warningLevel: 'none',
    isLoading: false,
  })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => (true)),
}));

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: true, isLoading: false, isError: false, error: null })),
}));

// Create a mocked store state that can be updated in tests
const mockStoreState = {
  openFeedbackModal: vi.fn(),
  showFeedbackBanner: false,
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn((selector: any) => selector(mockStoreState)),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  logClickEvent: vi.fn(() => vi.fn()),
}));

describe('ChatBanners', function chatBannersTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    // Reset store state
    mockStoreState.showFeedbackBanner = false;
  });

  describe('banner priority', function priorityTests() {
    it('should show UsageWarningBanner when usage warning is active', async function showWarningBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: true,
        percentage: 92,
        warningLevel: WarningLevel.WARNING,
        isLoading: false,

      });
      vi.mocked(useSwitchboard).mockReturnValue(false);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        // UsageWarningBanner renders its message ID when no translations provided
        expect(screen.getByText('builder_usage_warning_message_no_purchase')).toBeInTheDocument();
      });
    });

    it('should show UpgradeBanner when usage warning is not active and user should see paywall', async function showUpgradeBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 50,
        warningLevel: WarningLevel.CAUTION,
        isLoading: false,

      });
      vi.mocked(useSwitchboard).mockReturnValue(true);
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        // UpgradeBanner renders its message ID when no translations provided
        expect(screen.getByText('builder_airoplus_upgrade_message')).toBeInTheDocument();
      });
    });

    it('should show FeedbackBanner when no higher priority banners are active', async function showFeedbackBanner() {
      const { useUsage } = await import('@/hooks/useUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');

      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 50,
        warningLevel: WarningLevel.CAUTION,
        isLoading: false,

      });

      // Mock switchboard to return false for upgrade banner and true for feedback banner
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-banner') {
          return false;
        }
        if (flag === 'appbuilder-feedback-banner') {
          return true;
        }
        return false;
      });

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });

      // Set store state to show feedback banner
      mockStoreState.showFeedbackBanner = true;

      renderWithProviders(<ChatBanners appId="test-app" />);

      await waitFor(function waitForBanner() {
        // FeedbackBanner renders its message ID when no translations provided
        expect(screen.getByText('builder_feedback_banner_message')).toBeInTheDocument();
      });
    });

    it('should pass appId to useUsage hook', async function passAppId() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 0,
        warningLevel: WarningLevel.NONE,
        isLoading: false,

      });

      renderWithProviders(<ChatBanners appId="my-app-id" />);

      expect(useUsage).toHaveBeenCalledWith({ appId: 'my-app-id', enabled: true });
    });

    it('should disable useUsage when appId is null', async function disableWithNullAppId() {
      const { useUsage } = await import('@/hooks/useUsage');
      vi.mocked(useUsage).mockReturnValue({
        isWarningBannerActive: false,
        percentage: 0,
        warningLevel: WarningLevel.NONE,
        isLoading: false,

      });

      renderWithProviders(<ChatBanners appId={null} />);

      expect(useUsage).toHaveBeenCalledWith({ appId: null, enabled: false });
    });
  });
});
