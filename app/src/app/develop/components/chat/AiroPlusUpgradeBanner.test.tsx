import '@testing-library/jest-dom';

import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/tests/test-utils';
import AiroPlusUpgradeBanner from './AiroPlusUpgradeBanner';

// Custom render with i18n messages for testing link interactions
function renderWithMessages(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const messages = {
    builder_airoplus_upgrade_message: '{link} to publish your app and get other cool features.',
  };

  return {
    user: userEvent.setup(),
    ...render(
      <IntlProvider locale="en" messages={messages}>
        <QueryClientProvider client={queryClient}>
          {ui}
        </QueryClientProvider>
      </IntlProvider>
    ),
  };
}

const mockOpenUpgradeModal = vi.fn();

vi.mock('@/hooks/usePaywallEligibility', () => ({
  usePaywallEligibility: vi.fn(() => ({ showPaywall: true, isError: false, error: null })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true, isLoading: false })),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({ openUpgradeModal: mockOpenUpgradeModal }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

describe('AiroPlusUpgradeBanner', function airoPlusUpgradeBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('rendering', function renderingTests() {
    it('should render when user does not have Airo Plus', async function renderWithoutAiroPlus() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<AiroPlusUpgradeBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });
    });

    it('should not render when user has Airo Plus', async function noRenderWithAiroPlus() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isError: false, error: null });

      const { container } = renderWithProviders(<AiroPlusUpgradeBanner appId="test-app" />);

      expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
    });

    it('should not render when feature flag is disabled', async function noRenderWhenFlagDisabled() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<AiroPlusUpgradeBanner appId="test-app" />);

      expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
    });

    it('should not render when already dismissed today', async function noRenderWhenDismissedToday() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      // Mark as dismissed today
      const today = new Date().toISOString().split('T')[0];
      localStorage.setItem('airoplus_upgrade_banner_dismissed', today);

      const { container } = renderWithProviders(<AiroPlusUpgradeBanner appId="test-app" />);

      expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
    });

    it('should render upgrade message', async function renderMessage() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      renderWithProviders(<AiroPlusUpgradeBanner appId="test-app" />);

      await waitFor(function waitForMessage() {
        // FormattedMessage renders the message ID when no translations are provided
        expect(screen.getByText('builder_airoplus_upgrade_message')).toBeInTheDocument();
      });
    });
  });

  describe('interactions', function interactionTests() {
    it('should dismiss when close button is clicked', async function dismissOnClose() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<AiroPlusUpgradeBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      await waitFor(function waitForDismiss() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
      });
    });

    it('should call openUpgradeModal when upgrade link is clicked', async function clickUpgradeLink() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { user } = renderWithMessages(<AiroPlusUpgradeBanner appId="test-app" />);

      await waitFor(function waitForLink() {
        expect(screen.getByRole('link')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('link'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('airoplus_upgrade_banner.upgrade');
    });
  });
});
