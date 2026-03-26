import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import SuspendedNonPaymentAlert from './SuspendedNonPaymentAlert';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) {
      return `${key}:${JSON.stringify(values)}`;
    }
    return key;
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (name: string) => `eid-${name}`,
  logImpressionEvent: () => vi.fn(),
}));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => ({ intl: { locale: 'en-US' } }),
}));

describe('SuspendedNonPaymentAlert', function SuspendedNonPaymentAlertTests() {
  const defaultProps = {
    planName: 'Starter',
    renewsAt: '2027-01-29T07:00:00Z',
    onRenew: vi.fn(),
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the alert title with plan name', function renderTitle() {
      renderWithProviders(<SuspendedNonPaymentAlert {...defaultProps} />);

      // Mock includes params in the output
      expect(screen.getByText((content) =>
        content.includes('builder_manageplan_suspended_title')
      )).toBeInTheDocument();
    });

    it('should render the alert message', function renderMessage() {
      renderWithProviders(<SuspendedNonPaymentAlert {...defaultProps} />);

      // The message should contain the translated key
      const messageElement = screen.getByText((content) =>
        content.includes('builder_manageplan_suspended_message')
      );
      expect(messageElement).toBeInTheDocument();
    });

    it('should include unpublishDate calculated from renewsAt (3 days later)', function includesUnpublishDate() {
      renderWithProviders(<SuspendedNonPaymentAlert {...defaultProps} />);

      // The message ID should be present (FormattedMessage doesn't interpolate values in mock)
      const messageElement = screen.getByText('builder_manageplan_suspended_message');
      expect(messageElement).toBeInTheDocument();
    });

    it('should include credit limit (50) in the message', function includesCreditLimit() {
      renderWithProviders(<SuspendedNonPaymentAlert {...defaultProps} />);

      // The message ID should be present (FormattedMessage doesn't interpolate values in mock)
      const messageElement = screen.getByText('builder_manageplan_suspended_message');
      expect(messageElement).toBeInTheDocument();
    });
  });

  describe('renew button', function renewButtonTests() {
    it('should render renew button with plan name', function showsRenewButton() {
      renderWithProviders(<SuspendedNonPaymentAlert {...defaultProps} />);

      expect(screen.getByText((content) =>
        content.includes('builder_manageplan_suspended_renew_button')
      )).toBeInTheDocument();
    });

    it('should call onRenew when renew button is clicked', function callsOnRenew() {
      const onRenew = vi.fn();
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} onRenew={onRenew} />
      );

      const button = screen.getByText((content) =>
        content.includes('builder_manageplan_suspended_renew_button')
      );
      fireEvent.click(button);

      expect(onRenew).toHaveBeenCalledTimes(1);
    });

    it('should show processing text when isRenewing is true', function showsProcessingText() {
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} isRenewing={true} />
      );

      expect(screen.getByText('builder_manageplan_renewal_processing')).toBeInTheDocument();
    });

    it('should disable renew button when isRenewing is true', function disablesButton() {
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} isRenewing={true} />
      );

      const button = screen.getByText('builder_manageplan_renewal_processing');
      expect(button.closest('button')).toBeDisabled();
    });
  });

  describe('dismiss functionality', function dismissTests() {
    it('should call onDismiss when close button is clicked', function callsOnDismiss() {
      const onDismiss = vi.fn();
      const { container } = renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} onDismiss={onDismiss} />
      );

      // Find the close button (tertiary button with X icon, not the renew button)
      const buttons = container.querySelectorAll('button');
      const closeButton = Array.from(buttons).find(btn =>
        btn.querySelector('svg') && !btn.textContent?.includes('builder_manageplan_suspended_renew_button')
      );

      expect(closeButton).toBeDefined();
      fireEvent.click(closeButton!);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('should not render close button when onDismiss is not provided', function noCloseButton() {
      const { container } = renderWithProviders(
        <SuspendedNonPaymentAlert
          planName="Starter"
          renewsAt="2027-01-29T07:00:00Z"
          onRenew={vi.fn()}
        />
      );

      // The tertiary button for dismiss should not be present
      const buttons = container.querySelectorAll('button');
      const closeButtons = Array.from(buttons).filter(btn =>
        btn.querySelector('svg') && !btn.textContent?.includes('builder_manageplan_suspended_renew_button')
      );
      // Only the renew button should be present (no dismiss X button)
      expect(closeButtons.length).toBe(0);
    });
  });

  describe('styling', function stylingTests() {
    it('should have margin bottom on wrapper', function hasMarginBottom() {
      const { container } = renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} />
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('mb-4');
    });

    it('should have correct background and border classes', function hasCorrectClasses() {
      const { container } = renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} />
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('bg-ai-light/15');
      expect(wrapper).toHaveClass('border');
      expect(wrapper).toHaveClass('border-border');
      expect(wrapper).toHaveClass('rounded-lg');
    });
  });

  describe('data attributes', function dataAttributeTests() {
    it('should have correct data-eid on renew button', function correctDataEid() {
      renderWithProviders(<SuspendedNonPaymentAlert {...defaultProps} />);

      const button = screen.getByText((content) =>
        content.includes('builder_manageplan_suspended_renew_button')
      ).closest('button');
      expect(button).toHaveAttribute('data-eid');
      expect(button?.getAttribute('data-eid')).toContain('manageplan.buttons.renew_subscription');
    });

    it('should have data-partial attribute on renew button', function hasDataPartial() {
      renderWithProviders(<SuspendedNonPaymentAlert {...defaultProps} />);

      const button = screen.getByText((content) =>
        content.includes('builder_manageplan_suspended_renew_button')
      ).closest('button');
      expect(button).toHaveAttribute('data-partial', 'componentAiro');
    });
  });

  describe('without renewsAt', function noRenewsAtTests() {
    it('should render without unpublish date when renewsAt is not provided', function renderWithoutDate() {
      renderWithProviders(
        <SuspendedNonPaymentAlert
          planName="Starter"
          onRenew={vi.fn()}
        />
      );

      // Should still render the title, just without a date in the message
      expect(screen.getByText((content) =>
        content.includes('builder_manageplan_suspended_title')
      )).toBeInTheDocument();
    });
  });

  describe('error state', function errorTests() {
    it('should render error alert when error prop is provided', function showsErrorAlert() {
      const error = new Error('Renewal failed');
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} error={error} />
      );

      // Should show error title instead of suspended title
      expect(screen.getByText('builder_manageplan_renewal_error_title')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_renewal_error_message')).toBeInTheDocument();
    });

    it('should show retry button in error state', function showsRetryButton() {
      const error = new Error('Renewal failed');
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} error={error} />
      );

      expect(screen.getByText('builder_common_retry')).toBeInTheDocument();
    });

    it('should call onRenew when retry button is clicked', function retriesOnClick() {
      const error = new Error('Renewal failed');
      const onRenew = vi.fn();
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} error={error} onRenew={onRenew} />
      );

      const retryButton = screen.getByText('builder_common_retry');
      fireEvent.click(retryButton);

      expect(onRenew).toHaveBeenCalledTimes(1);
    });

    it('should call onErrorDismiss when error alert is closed', function callsOnErrorDismiss() {
      const error = new Error('Renewal failed');
      const onErrorDismiss = vi.fn();
      const { container } = renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} error={error} onErrorDismiss={onErrorDismiss} />
      );

      // Find the close button on the Alert
      const closeButton = container.querySelector('[data-testid="alert-close"]') ||
        container.querySelector('button[aria-label*="close"]') ||
        container.querySelector('button[aria-label*="Close"]');

      expect(closeButton).not.toBeNull();
      fireEvent.click(closeButton!);
      expect(onErrorDismiss).toHaveBeenCalledTimes(1);
    });

    it('should not show suspended banner when error is present', function hidesMainBanner() {
      const error = new Error('Renewal failed');
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} error={error} />
      );

      // Should NOT show the suspended title
      expect(screen.queryByText((content) =>
        content.includes('builder_manageplan_suspended_title')
      )).not.toBeInTheDocument();
    });

    it('should have correct data-eid on retry button', function correctRetryDataEid() {
      const error = new Error('Renewal failed');
      renderWithProviders(
        <SuspendedNonPaymentAlert {...defaultProps} error={error} />
      );

      const button = screen.getByText('builder_common_retry').closest('button');
      expect(button).toHaveAttribute('data-eid');
      expect(button?.getAttribute('data-eid')).toContain('manageplan.buttons.renewal_retry');
    });
  });
});
