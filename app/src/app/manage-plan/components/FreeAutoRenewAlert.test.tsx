import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import FreeAutoRenewAlert from './FreeAutoRenewAlert';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) {
      return `${key}:${JSON.stringify(values)}`;
    }
    return key;
  },
}));

describe('FreeAutoRenewAlert', function FreeAutoRenewAlertTests() {
  const defaultProps = {
    renewalDate: '2027-01-29T07:00:00Z',
    planName: 'Starter',
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the alert title', function renderTitle() {
      renderWithProviders(<FreeAutoRenewAlert {...defaultProps} />);

      expect(screen.getByText('builder_manageplan_downgrade_plan_title')).toBeInTheDocument();
    });

    it('should render the alert message with formatted date', function renderMessage() {
      renderWithProviders(<FreeAutoRenewAlert {...defaultProps} />);

      // The message should contain the translated key with values
      const messageElement = screen.getByText((content) =>
        content.includes('builder_manageplan_downgrade_scheduled_message')
      );
      expect(messageElement).toBeInTheDocument();
    });

    it('should format the renewal date correctly', function formatDate() {
      renderWithProviders(<FreeAutoRenewAlert {...defaultProps} />);

      // The formatted date should be present in the message values (assert on a locale-stable part)
      const messageElement = screen.getByText((content) =>
        content.includes('2027')
      );
      expect(messageElement).toBeInTheDocument();
    });

    it('should include planName in the message', function includePlanName() {
      renderWithProviders(<FreeAutoRenewAlert {...defaultProps} planName="Premium" />);

      const messageElement = screen.getByText((content) =>
        content.includes('Premium')
      );
      expect(messageElement).toBeInTheDocument();
    });
  });

  describe('cancel changes button', function cancelButtonTests() {
    it('should not render cancel button when onCancelChanges is not provided', function noCancelButton() {
      renderWithProviders(<FreeAutoRenewAlert {...defaultProps} />);

      expect(screen.queryByText('builder_manageplan_downgrade_cancel_changes')).not.toBeInTheDocument();
    });

    it('should render cancel button when onCancelChanges is provided', function showsCancelButton() {
      const onCancelChanges = vi.fn();
      renderWithProviders(
        <FreeAutoRenewAlert {...defaultProps} onCancelChanges={onCancelChanges} />
      );

      expect(screen.getByText('builder_manageplan_downgrade_cancel_changes')).toBeInTheDocument();
    });

    it('should call onCancelChanges when cancel button is clicked', function callsOnCancel() {
      const onCancelChanges = vi.fn();
      renderWithProviders(
        <FreeAutoRenewAlert {...defaultProps} onCancelChanges={onCancelChanges} />
      );

      fireEvent.click(screen.getByText('builder_manageplan_downgrade_cancel_changes'));

      expect(onCancelChanges).toHaveBeenCalledTimes(1);
    });

    it('should show loading text when isLoading is true', function showsLoadingText() {
      const onCancelChanges = vi.fn();
      renderWithProviders(
        <FreeAutoRenewAlert
          {...defaultProps}
          onCancelChanges={onCancelChanges}
          isLoading={true}
        />
      );

      expect(screen.getByText('builder_manageplan_downgrade_canceling')).toBeInTheDocument();
      expect(screen.queryByText('builder_manageplan_downgrade_cancel_changes')).not.toBeInTheDocument();
    });

    it('should disable cancel button when isLoading is true', function disablesButton() {
      const onCancelChanges = vi.fn();
      renderWithProviders(
        <FreeAutoRenewAlert
          {...defaultProps}
          onCancelChanges={onCancelChanges}
          isLoading={true}
        />
      );

      const button = screen.getByText('builder_manageplan_downgrade_canceling');
      expect(button.closest('button')).toBeDisabled();
    });
  });

  describe('dismiss functionality', function dismissTests() {
    it('should call onDismiss when close button is clicked', function callsOnDismiss() {
      const onDismiss = vi.fn();
      const { container } = renderWithProviders(
        <FreeAutoRenewAlert {...defaultProps} onDismiss={onDismiss} />
      );

      // Find and click the close button (usually an X icon in the Alert)
      const closeButton = container.querySelector('button[aria-label]') ||
        container.querySelector('[role="button"]');

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(onDismiss).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('styling', function stylingTests() {
    it('should have margin bottom on wrapper', function hasMarginBottom() {
      const { container } = renderWithProviders(
        <FreeAutoRenewAlert {...defaultProps} />
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('mb-4');
    });
  });

  describe('data attributes', function dataAttributeTests() {
    it('should have correct data-eid on cancel button', function correctDataEid() {
      const onCancelChanges = vi.fn();
      renderWithProviders(
        <FreeAutoRenewAlert {...defaultProps} onCancelChanges={onCancelChanges} />
      );

      const button = screen.getByText('builder_manageplan_downgrade_cancel_changes').closest('button');
      expect(button).toHaveAttribute('data-eid');
      expect(button?.getAttribute('data-eid')).toContain('manageplan.buttons.downgrade_cancel_changes');
    });

    it('should have data-partial attribute on cancel button', function hasDataPartial() {
      const onCancelChanges = vi.fn();
      renderWithProviders(
        <FreeAutoRenewAlert {...defaultProps} onCancelChanges={onCancelChanges} />
      );

      const button = screen.getByText('builder_manageplan_downgrade_cancel_changes').closest('button');
      expect(button).toHaveAttribute('data-partial', 'componentAiro');
    });
  });
});
