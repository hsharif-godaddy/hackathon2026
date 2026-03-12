import '@testing-library/jest-dom';

import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import UpgradeBanner from './UpgradeBanner';

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
  usePaywallEligibility: vi.fn(() => ({ showPaywall: true, isLoading: false, isError: false, error: null })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: true, isLoading: false })),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({
    data: null,
    subscriptions: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({ openUpgradeModal: mockOpenUpgradeModal }),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

const mockLogImpressionEvent = vi.fn((_eid: string) => vi.fn());
const mockLogClickEvent = vi.fn((_eid: string) => vi.fn());

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string) => mockLogImpressionEvent(eid) as unknown,
  logClickEvent: (eid: string) => mockLogClickEvent(eid) as unknown,
}));

describe('UpgradeBanner', function upgradeBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    localStorage.clear();
    mockLogImpressionEvent.mockClear();
    mockLogClickEvent.mockClear();
  });

  describe('rendering', function renderingTests() {
    it('should render when user does not have Airo Plus', async function renderWithoutAiroPlus() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<UpgradeBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });
    });

    it('should not render when user has Airo Plus and higher plans is disabled', async function noRenderWithAiroPlusLegacy() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');
      const { useSubscription } = await import('@/hooks/useSubscription');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: false, isLoading: false, isError: false, error: null });
      // Mock both flags - feature enabled but higher plans disabled
      vi.mocked(useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'appbuilder-airoplus-upgrade-banner') return { data: true, isLoading: false } as ReturnType<typeof useSwitchboard>;
        if (flag === 'appbuilder-higher-plans') return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
        return { data: false, isLoading: false } as ReturnType<typeof useSwitchboard>;
      });
      // Mock subscription with AiroPlus plan - should not show upgrade when higher plans disabled
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

      const { container } = renderWithProviders(<UpgradeBanner appId="test-app" />);

      expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
    });

    it('should not render when feature flag is disabled', async function noRenderWhenFlagDisabled() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<UpgradeBanner appId="test-app" />);

      expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
    });

    it('should not render when already dismissed today', async function noRenderWhenDismissedToday() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      // Mark as dismissed today (using same format as component: local date in YYYY-MM-DD)
      const today = new Date().toLocaleDateString('en-CA');
      localStorage.setItem('airoplus_upgrade_banner_dismissed', today);

      const { container } = renderWithProviders(<UpgradeBanner appId="test-app" />);

      expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).not.toBeInTheDocument();
    });

    it('should render upgrade message', async function renderMessage() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      renderWithProviders(<UpgradeBanner appId="test-app" />);

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

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UpgradeBanner appId="test-app" />);

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

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { user } = renderWithMessages(<UpgradeBanner appId="test-app" />);

      await waitFor(function waitForLink() {
        expect(screen.getByRole('link')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('link'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('airoplus_upgrade_banner.upgrade', PAYWALL_ITC.UPGRADE);
    });
  });

  describe('analytics', function analyticsTests() {
    it('should log impression event when banner is shown', async function logImpressionOnShow() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<UpgradeBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('chat.upgradeBanner.view');
    });

    it('should log click event when close button is clicked', async function logClickOnClose() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { user, container } = renderWithProviders(<UpgradeBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.upgradeBanner.close');
    });

    it('should log click event when upgrade link is clicked', async function logClickOnUpgrade() {
      const { usePaywallEligibility } = await import('@/hooks/usePaywallEligibility');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(usePaywallEligibility).mockReturnValue({ showPaywall: true, isLoading: false, isError: false, error: null });
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

      const { user } = renderWithMessages(<UpgradeBanner appId="test-app" />);

      await waitFor(function waitForLink() {
        expect(screen.getByRole('link')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('link'));

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.upgradeBanner.upgrade');
    });
  });
});
