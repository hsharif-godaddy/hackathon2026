import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import UsageWarningBanner from './UsageWarningBanner';

const mockOpenUpgradeModal = vi.fn();
const mockSetActiveSettingsSection = vi.fn();

vi.mock('@/hooks/useDailyUsage', () => ({
  useDailyUsage: vi.fn(() => ({
    isWarningBannerActive: true,
  })),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: false })),
}));

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveSettingsSection: mockSetActiveSettingsSection,
  }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({ openUpgradeModal: mockOpenUpgradeModal }),
}));

describe('UsageWarningBanner', function usageWarningBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render when usage is above threshold', async function renderAboveThreshold() {
      const { container } = renderWithProviders(<UsageWarningBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });
    });

    it('should not render when isWarningBannerActive is false', async function notActive() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({
        isWarningBannerActive: false,
      } as ReturnType<typeof useDailyUsage>);

      const { container } = renderWithProviders(<UsageWarningBanner appId="test-app" />);

      expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).not.toBeInTheDocument();
    });
  });

  describe('dismissal', function dismissalTests() {
    it('should dismiss when close button is clicked', async function dismissOnClose() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      vi.mocked(useDailyUsage).mockReturnValue({
        isWarningBannerActive: true,
      } as ReturnType<typeof useDailyUsage>);

      const { user, container } = renderWithProviders(<UsageWarningBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      await waitFor(function waitForDismiss() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).not.toBeInTheDocument();
      });
    });
  });

  describe('message display', function messageDisplayTests() {
    it('should render message when purchase is disabled', async function messageDisabled() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        isWarningBannerActive: true,
      } as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<UsageWarningBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });

      // FormattedMessage renders the message ID when no translations are provided
      expect(screen.getByText('builder_usage_warning_message_no_purchase')).toBeInTheDocument();
    });

    it('should render message when purchase is enabled', async function messageEnabled() {
      const { useDailyUsage } = await import('@/hooks/useDailyUsage');
      const { useSwitchboard } = await import('@/hooks/useSwitchboard');

      vi.mocked(useDailyUsage).mockReturnValue({
        isWarningBannerActive: true,
      } as ReturnType<typeof useDailyUsage>);
      vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false, error: null } as ReturnType<typeof useSwitchboard>);

      const { container } = renderWithProviders(<UsageWarningBanner appId="test-app" />);

      await waitFor(function waitForBanner() {
        expect(container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor')).toBeInTheDocument();
      });

      // FormattedMessage renders the message ID when no translations are provided
      expect(screen.getByText('builder_usage_warning_message')).toBeInTheDocument();
    });
  });
});
