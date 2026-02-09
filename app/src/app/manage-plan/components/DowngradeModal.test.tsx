import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
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

import DowngradeModal from './DowngradeModal';

describe('DowngradeModal', function downgradeModalTests() {
  const defaultProps = {
    planName: 'Starter',
    planCreditsMax: 150,
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
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render the modal title', function renderTitle() {
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      expect(screen.getByRole('heading', { name: 'builder_manageplan_downgrade_title' })).toBeInTheDocument();
    });

    it('should render loss items', function renderLossItems() {
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      expect(screen.getByText('builder_manageplan_downgrade_lose_publishing')).toBeInTheDocument();
      expect(screen.getByText('builder_manageplan_downgrade_lose_domains')).toBeInTheDocument();
    });

    it('should render loss title', function renderLossTitle() {
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      expect(screen.getByText('builder_manageplan_downgrade_lose_title')).toBeInTheDocument();
    });

    it('should render keep plan button', function renderKeepButton() {
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'builder_manageplan_downgrade_keep' })).toBeInTheDocument();
    });

    it('should render confirm button', function renderConfirmButton() {
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'builder_manageplan_downgrade_confirm' })).toBeInTheDocument();
    });
  });

  describe('button interactions', function buttonTests() {
    it('should call onClose when keep button is clicked', function callsOnClose() {
      const onClose = vi.fn();
      renderWithProviders(<DowngradeModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'builder_manageplan_downgrade_keep' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onConfirm when confirm button is clicked', function callsOnConfirm() {
      const onConfirm = vi.fn();
      renderWithProviders(<DowngradeModal {...defaultProps} onConfirm={onConfirm} />);

      fireEvent.click(screen.getByRole('button', { name: 'builder_manageplan_downgrade_confirm' }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('loading state', function loadingTests() {
    it('should show loading text on confirm button when isLoading', function showsLoadingText() {
      renderWithProviders(<DowngradeModal {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('button', { name: 'builder_manageplan_downgrade_switching' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'builder_manageplan_downgrade_confirm' })).not.toBeInTheDocument();
    });

    it('should disable buttons when isLoading', function disablesButtons() {
      renderWithProviders(<DowngradeModal {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('button', { name: 'builder_manageplan_downgrade_keep' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'builder_manageplan_downgrade_switching' })).toBeDisabled();
    });
  });

  describe('error state', function errorTests() {
    it('should show error alert when error is provided', function showsErrorAlert() {
      const error = new Error('Something went wrong');
      renderWithProviders(<DowngradeModal {...defaultProps} error={error} />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should not show error alert when error is null', function noErrorAlert() {
      renderWithProviders(<DowngradeModal {...defaultProps} error={null} />);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('data attributes', function dataAttributeTests() {
    it('should have data-eid attributes on buttons', function hasDataEid() {
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      const keepButton = screen.getByRole('button', { name: 'builder_manageplan_downgrade_keep' });
      const confirmButton = screen.getByRole('button', { name: 'builder_manageplan_downgrade_confirm' });

      expect(keepButton).toHaveAttribute('data-eid');
      expect(confirmButton).toHaveAttribute('data-eid');
    });

    it('should have data-partial attribute on buttons', function hasDataPartial() {
      renderWithProviders(<DowngradeModal {...defaultProps} />);

      const keepButton = screen.getByRole('button', { name: 'builder_manageplan_downgrade_keep' });
      const confirmButton = screen.getByRole('button', { name: 'builder_manageplan_downgrade_confirm' });

      expect(keepButton).toHaveAttribute('data-partial', 'componentAiro');
      expect(confirmButton).toHaveAttribute('data-partial', 'componentAiro');
    });
  });
});
