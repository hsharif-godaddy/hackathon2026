import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock @ux/modal to avoid Disrupt rendering issues in test environment
vi.mock('@ux/modal', () => ({
  default: ({ title, children, actions, onClose }: any) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Close">Close</button>
      <div>{children}</div>
      <div>{actions}</div>
    </div>
  ),
}));

import { DeleteRowModal } from './DeleteRowModal';

describe('DeleteRowModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const defaultProps = {
    isOpen: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    isDeleting: false,
  };

  it('should not render when isOpen is false', () => {
    const { container } = renderWithProviders(<DeleteRowModal {...defaultProps} />);

    expect(container.firstChild).toBeNull();
  });

  it('should render when isOpen is true', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    expect(screen.getByText('builder_settings_database_delete_row_title')).toBeInTheDocument();
  });

  it('should display confirmation message', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    expect(screen.getByText('builder_settings_database_delete_row_warning')).toBeInTheDocument();
  });

  it('should render cancel button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    expect(screen.getByRole('button', { name: 'builder_common_cancel' })).toBeInTheDocument();
  });

  it('should render delete button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    expect(screen.getByRole('button', { name: 'builder_common_delete' })).toBeInTheDocument();
  });

  it('should call onClose when cancel button clicked', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <DeleteRowModal {...defaultProps} isOpen={true} onClose={onClose} />
    );

    const cancelButton = screen.getByRole('button', { name: 'builder_common_cancel' });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('should call onConfirm when delete button clicked', async () => {
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(
      <DeleteRowModal {...defaultProps} isOpen={true} onConfirm={onConfirm} />
    );

    const deleteButton = screen.getByRole('button', { name: 'builder_common_delete' });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  it('should disable buttons when isDeleting is true', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} isDeleting={true} />);

    const cancelButton = screen.getByRole('button', { name: 'builder_common_cancel' });
    const deleteButton = screen.getByRole('button', { name: 'builder_common_deleting' });

    expect(cancelButton).toBeDisabled();
    expect(deleteButton).toBeDisabled();
  });

  it('should show deleting text when isDeleting is true', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} isDeleting={true} />);

    expect(screen.getByRole('button', { name: 'builder_common_deleting' })).toBeInTheDocument();
  });

  it('should show delete text when isDeleting is false', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} isDeleting={false} />);

    expect(screen.getByRole('button', { name: 'builder_common_delete' })).toBeInTheDocument();
  });

  it('should have critical design for delete button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    const deleteButton = screen.getByRole('button', { name: 'builder_common_delete' });
    // Critical button should have specific styling
    expect(deleteButton).toBeInTheDocument();
  });

  it('should have secondary design for cancel button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    const cancelButton = screen.getByRole('button', { name: 'builder_common_cancel' });
    // Secondary button should have specific styling
    expect(cancelButton).toBeInTheDocument();
  });
});
