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
import UpgradeBanner from './UpgradeBanner';

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
const mockOnDismiss = vi.fn();

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
}));

describe('UpgradeBanner', function upgradeBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('rendering', function renderingTests() {
    it('should render the upgrade message', function renderMessage() {
      renderWithProviders(<UpgradeBanner />);

      expect(screen.getByText('builder_airoplus_upgrade_message')).toBeInTheDocument();
    });

    it('should render with info variant styling', function renderInfoVariant() {
      const { container } = renderWithProviders(<UpgradeBanner />);

      expect(container.querySelector('.bg-intents-ux-feedbackInfo-feedbackColor')).toBeInTheDocument();
    });
  });

  describe('interactions', function interactionTests() {
    it('should call onDismiss when close button is clicked', async function dismissOnClose() {
      const { user } = renderWithProviders(<UpgradeBanner onDismiss={mockOnDismiss} />);

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      expect(mockOnDismiss).toHaveBeenCalled();
    });

    it('should call openUpgradeModal when upgrade link is clicked', async function clickUpgradeLink() {
      const { user } = renderWithMessages(<UpgradeBanner />);

      await waitFor(function waitForLink() {
        expect(screen.getByRole('link')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('link'));

      expect(mockOpenUpgradeModal).toHaveBeenCalledWith('airoplus_upgrade_banner.upgrade', PAYWALL_ITC.UPGRADE);
    });
  });

  describe('analytics', function analyticsTests() {
    it('should log impression event on mount', function logImpressionOnMount() {
      renderWithProviders(<UpgradeBanner />);

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('chat.upgradeBanner.view');
    });

    it('should log click event when close button is clicked', async function logClickOnClose() {
      const { user } = renderWithProviders(<UpgradeBanner onDismiss={mockOnDismiss} />);

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.upgradeBanner.close');
    });

    it('should log click event when upgrade link is clicked', async function logClickOnUpgrade() {
      const { user } = renderWithMessages(<UpgradeBanner />);

      await waitFor(function waitForLink() {
        expect(screen.getByRole('link')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('link'));

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.upgradeBanner.upgrade');
    });
  });
});
