/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => {
    // Return human-readable text for testing purposes
    const translations: Record<string, string> = {
      'builder_unpublish_modal_title': 'Unpublish this app?',
      'builder_unpublish_retry': 'Retry',
      'builder_unpublish_contact_support': 'Contact Support',
      'builder_unpublish_error': 'Failed to unpublish. Please try again.',
      'builder_unpublish_confirm': 'Unpublish',
      'builder_unpublish_disconnect_and_unpublish': 'Disconnect and Unpublish',
      'builder_unpublish_cancel': 'Cancel',
      'builder_unpublish_processing': 'Unpublishing...',
    };
    return translations[key] || key;
  },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomain: () => 'godaddy.com',
}));

// Mock @ux/modal to avoid Disrupt rendering issues in test environment
vi.mock('@ux/modal', () => ({
  default: ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Close">Close</button>
      <div>{children}</div>
    </div>
  ),
}));

// Mock @ux/radio
vi.mock('@ux/radio', () => ({
  default: ({
    id,
    label,
    checked,
    onChange,
  }: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }) => (
    <label htmlFor={id}>
      <input
        type="radio"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  ),
}));

import UnpublishConfirmationModal from './UnpublishConfirmationModal';

describe('UnpublishConfirmationModal', function unpublishModalTests() {
  const defaultProps = {
    appName: 'My Test App',
    publishedUrl: 'https://mytestapp.airoapp.ai',
    customDomain: null,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    isLoading: false,
    error: null,
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe('renders correctly', function renderTests() {
    it('should render the modal', function renderModal() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render the modal title', function renderTitle() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      expect(screen.getByRole('heading', { name: 'Unpublish this app?' })).toBeInTheDocument();
    });

    it('should render the modal dialog', function renderConfirmation() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      // Modal dialog is rendered with the right title
      expect(screen.getByRole('dialog', { name: 'Unpublish this app?' })).toBeInTheDocument();
    });

    it('should render info section', function renderInfo() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      // Info section with icon exists (FormattedMessage renders the content).
      // Sheet/modal content may portal outside the RTL container.
      expect(document.querySelector('[class*="bg-ai-light"]')).toBeInTheDocument();
    });

    it('should render cancel and confirm buttons', function renderButtons() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    });
  });

  describe('custom domain options', function customDomainTests() {
    it('should show disconnect button when custom domain is provided', function showsDisconnectButton() {
      renderWithProviders(
        <UnpublishConfirmationModal {...defaultProps} customDomain="example.com" />
      );

      expect(screen.getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Disconnect and Unpublish' })).toBeInTheDocument();
    });

    it('should not show disconnect button when no custom domain', function noDisconnectButton() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      expect(screen.queryByRole('button', { name: 'Disconnect and Unpublish' })).not.toBeInTheDocument();
    });

    it('should show cancel button when no custom domain', function showsCancelButton() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });

  describe('button interactions', function buttonTests() {
    it('should call onClose when cancel button is clicked', function callsOnClose() {
      const onClose = vi.fn();
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onConfirm with false when unpublish button is clicked', function callsOnConfirmFalse() {
      const onConfirm = vi.fn();
      renderWithProviders(
        <UnpublishConfirmationModal {...defaultProps} onConfirm={onConfirm} customDomain="example.com" />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));

      expect(onConfirm).toHaveBeenCalledWith(false);
    });

    it('should call onConfirm with true when disconnect and unpublish button is clicked', function callsOnConfirmTrue() {
      const onConfirm = vi.fn();
      renderWithProviders(
        <UnpublishConfirmationModal {...defaultProps} onConfirm={onConfirm} customDomain="example.com" />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Disconnect and Unpublish' }));

      expect(onConfirm).toHaveBeenCalledWith(true);
    });
  });

  describe('loading state', function loadingTests() {
    it('should show loading text on confirm button when isLoading', function showsLoadingText() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('button', { name: 'Unpublishing...' })).toBeInTheDocument();
    });

    it('should disable buttons when isLoading', function disablesButtons() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Unpublishing...' })).toBeDisabled();
    });
  });

  describe('error state', function errorTests() {
    it('should show error alert when error is provided', function showsErrorAlert() {
      const error = new Error('Something went wrong');
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} error={error} />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should show retry button when onRetry is provided', function showsRetryButton() {
      const error = new Error('Something went wrong');
      const onRetry = vi.fn();
      renderWithProviders(
        <UnpublishConfirmationModal {...defaultProps} error={error} onRetry={onRetry} />
      );

      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('should call onRetry when retry button is clicked', function callsOnRetry() {
      const error = new Error('Something went wrong');
      const onRetry = vi.fn();
      renderWithProviders(
        <UnpublishConfirmationModal {...defaultProps} error={error} onRetry={onRetry} />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should show contact support button', function showsContactSupport() {
      const error = new Error('Something went wrong');
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} error={error} />);

      expect(screen.getByRole('button', { name: 'Contact Support' })).toBeInTheDocument();
    });

    it('should not show error alert when error is null', function noErrorAlert() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} error={null} />);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('data attributes', function dataAttributeTests() {
    it('should have data-eid attributes on buttons', function hasDataEid() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      const confirmButton = screen.getByRole('button', { name: 'Unpublish' });

      expect(cancelButton).toHaveAttribute('data-eid');
      expect(confirmButton).toHaveAttribute('data-eid');
    });

    it('should have data-partial attribute on buttons', function hasDataPartial() {
      renderWithProviders(<UnpublishConfirmationModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      const confirmButton = screen.getByRole('button', { name: 'Unpublish' });

      expect(cancelButton).toHaveAttribute('data-partial', 'componentAiro');
      expect(confirmButton).toHaveAttribute('data-partial', 'componentAiro');
    });
  });
});
