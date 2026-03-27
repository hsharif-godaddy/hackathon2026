/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import SuspendedNonPaymentBanner from './SuspendedNonPaymentBanner';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock FormattedMessage to render values for testing
vi.mock('react-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-intl')>();
  return {
    ...actual,
    FormattedMessage: ({ id, values }: { id: string; values?: Record<string, React.ReactNode | ((chunks: React.ReactNode) => React.ReactNode)> }) => (
      <span data-testid={id}>
        {id}
        {values && Object.entries(values).map(([key, value]) => {
          // Skip function values (like strong callback) - they're for rich text formatting
          if (typeof value === 'function') return null;
          return <span key={key} data-testid={`value-${key}`}>{value}</span>;
        })}
      </span>
    ),
  };
});

const mockLogImpressionEvent = vi.fn(() => vi.fn());
const mockLogClickEvent = vi.fn(() => vi.fn());

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (name: string) => mockLogImpressionEvent(name),
  logClickEvent: (name: string) => mockLogClickEvent(name),
  generateClickEID: (name: string) => `eid-${name}`,
}));

const mockRenewSubscription = vi.fn();
vi.mock('@/hooks/useSubscriptionRenewal', () => ({
  useSubscriptionRenewal: () => ({
    renewSubscription: mockRenewSubscription,
    isRenewing: false,
  }),
}));

const mockAutoRenewStatus = {
  subscriptionId: 'sub-123',
};
vi.mock('@/hooks/useEcommSubscriptionAutoRenewStatus', () => ({
  useEcommSubscriptionAutoRenewStatus: () => ({
    data: mockAutoRenewStatus,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({ intl: { locale: 'en-US' } }),
}));

const defaultProps = {
  builderEntitlementId: 'ent-123',
  renewsAt: '2027-01-29T07:00:00Z',
};

describe('SuspendedNonPaymentBanner', function SuspendedNonPaymentBannerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the banner with translated message', function renderBanner() {
      renderWithProviders(<SuspendedNonPaymentBanner {...defaultProps} />);

      // The message ID should be present via FormattedMessage
      expect(screen.getByTestId('builder_chat_suspended_message')).toBeInTheDocument();
    });

    it('should render the renew button', function renderRenewButton() {
      renderWithProviders(<SuspendedNonPaymentBanner {...defaultProps} />);

      // The link value contains the renew button
      expect(screen.getByText('builder_chat_suspended_renew_button')).toBeInTheDocument();
    });

    it('should log impression on mount', function logsImpression() {
      renderWithProviders(<SuspendedNonPaymentBanner {...defaultProps} />);

      expect(mockLogImpressionEvent).toHaveBeenCalledWith('chat.suspendedNonPaymentBanner.view');
    });
  });

  describe('renew functionality', function renewTests() {
    it('should call renewSubscription when renew button is clicked', async function callsRenew() {
      renderWithProviders(<SuspendedNonPaymentBanner {...defaultProps} />);

      // Find the button by its text (rendered inside the link value)
      const renewButton = screen.getByText('builder_chat_suspended_renew_button');
      fireEvent.click(renewButton);

      await waitFor(() => {
        expect(mockRenewSubscription).toHaveBeenCalledWith('sub-123');
      });
    });

    it('should have data-eid on renew button for click tracking', function hasDataEidOnRenew() {
      renderWithProviders(<SuspendedNonPaymentBanner {...defaultProps} />);

      const renewButton = screen.getByText('builder_chat_suspended_renew_button').closest('button');
      expect(renewButton).toHaveAttribute('data-eid', 'eid-chat.suspendedNonPaymentBanner.renew');
    });
  });

  describe('dismiss functionality', function dismissTests() {
    it('should log click event when close button is clicked', function logsCloseClick() {
      renderWithProviders(<SuspendedNonPaymentBanner {...defaultProps} />);

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockLogClickEvent).toHaveBeenCalledWith('chat.suspendedNonPaymentBanner.close');
    });
  });

  describe('styling', function stylingTests() {
    it('should use warning variant', function warningVariant() {
      const { container } = renderWithProviders(<SuspendedNonPaymentBanner {...defaultProps} />);

      // ChatBanner with warning variant has specific background class
      // The first child of the container div is the svg container, second is the actual banner
      const banner = container.querySelector('.bg-intents-ux-feedbackWarning-feedbackColor');
      expect(banner).toBeInTheDocument();
    });
  });
});
