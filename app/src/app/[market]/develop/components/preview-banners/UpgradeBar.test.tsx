/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { renderWithProviders } from '@/tests/test-utils';
import UpgradeBar from './UpgradeBar';

function renderWithMessages(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const messages = {
    builder_airoplus_upgrade_message: '{link} to publish your app and get other cool features.',
    builder_airoplus_upgrade_link: 'Upgrade now',
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
const mockDismiss = vi.fn();

// Mock the centralized hook
const mockUseUpgradeBannerExperiment = vi.fn(function () {
  return { showChatBanner: false, showPreviewBar: true, dismiss: mockDismiss };
});

vi.mock('@/hooks/useUpgradeBannerExperiment', () => ({
  useUpgradeBannerExperiment: (...args: any[]) => mockUseUpgradeBannerExperiment(...args),
  markDismissedToday: vi.fn(),
}));

vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: (selector: any) => selector({ openUpgradeModal: mockOpenUpgradeModal }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: vi.fn(function () {
    return function (key: string, _values?: any, fallback?: string) { return fallback ?? key; };
  }),
}));

const mockLogImpressionEvent = vi.fn(function (_eid: string) { return vi.fn(); });
const mockLogClickEvent = vi.fn(function (_eid: string) { return vi.fn(); });

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (eid: string) => mockLogImpressionEvent(eid) as unknown,
  logClickEvent: (eid: string) => mockLogClickEvent(eid) as unknown,
  generateClickEID: (eid: string) => eid,
}));

describe('UpgradeBar', function upgradeBarTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockUseUpgradeBannerExperiment.mockReturnValue({
      showChatBanner: false,
      showPreviewBar: true,
      dismiss: mockDismiss,
    });
  });

  describe('rendering', function renderingTests() {
    it('should render when showPreviewBar is true', function renderForTreatment() {
      const { container } = renderWithProviders(<UpgradeBar />);

      expect(container.querySelector('.bg-ai')).toBeInTheDocument();
    });

    it('should not render when showPreviewBar is false', function noRenderForControl() {
      mockUseUpgradeBannerExperiment.mockReturnValue({
        showChatBanner: true,
        showPreviewBar: false,
        dismiss: mockDismiss,
      });

      const { container } = renderWithProviders(<UpgradeBar />);

      expect(container.querySelector('.bg-ai')).not.toBeInTheDocument();
    });

    it('should not render when dismissed (showPreviewBar false)', function noRenderWhenDismissed() {
      mockUseUpgradeBannerExperiment.mockReturnValue({
        showChatBanner: false,
        showPreviewBar: false,
        dismiss: mockDismiss,
      });

      const { container } = renderWithProviders(<UpgradeBar />);

      expect(container.querySelector('.bg-ai')).not.toBeInTheDocument();
    });
  });

  describe('interactions', function interactionTests() {
    it('should call dismiss when close button is clicked', async function dismissOnClose() {
      const { user } = renderWithProviders(<UpgradeBar />);

      const closeButton = screen.getByRole('button', { name: /dismiss/i });
      await user.click(closeButton);

      expect(mockDismiss).toHaveBeenCalled();
    });

    it('should call openUpgradeModal when upgrade link is clicked', async function clickUpgradeLink() {
      const { user } = renderWithMessages(<UpgradeBar />);

      await waitFor(function waitForLink() {
        expect(screen.getByText('Upgrade now')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Upgrade now'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('airobuilder_upgrade_banner.upgrade', PAYWALL_ITC.UPGRADE);
    });
  });

  describe('analytics', function analyticsTests() {
    it('should log impression event when banner is shown', function logImpressionOnShow() {
      renderWithProviders(<UpgradeBar />);

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('preview.upgradeBanner.view');
    });

    it('should log click event when close button is clicked', async function logClickOnClose() {
      const { user } = renderWithProviders(<UpgradeBar />);

      const closeButton = screen.getByRole('button', { name: /dismiss/i });
      await user.click(closeButton);

      expect(mockLogClickEvent).toHaveBeenCalledWith('preview.upgradeBanner.close');
    });

    it('should log click event when upgrade link is clicked', async function logClickOnUpgrade() {
      const { user } = renderWithMessages(<UpgradeBar />);

      await waitFor(function waitForLink() {
        expect(screen.getByText('Upgrade now')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Upgrade now'));

      expect(mockLogClickEvent).toHaveBeenCalledWith('preview.upgradeBanner.upgrade');
    });
  });
});
