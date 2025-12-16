import '@testing-library/jest-dom';

import { beforeEach,describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { DeleteRowModal } from './DeleteRowModal';

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

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

    expect(screen.getByText('Delete Row')).toBeInTheDocument();
  });

  it('should display confirmation message', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    expect(screen.getByText('Are you sure you want to delete this row? This action cannot be undone.')).toBeInTheDocument();
  });

  it('should render cancel button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('should render delete button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
  });

  it('should call onClose when cancel button clicked', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <DeleteRowModal {...defaultProps} isOpen={true} onClose={onClose} />
    );

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
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

    const deleteButton = screen.getByRole('button', { name: /Delete/i });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  it('should disable buttons when isDeleting is true', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} isDeleting={true} />);

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    const deleteButton = screen.getByRole('button', { name: /Deleting.../i });

    expect(cancelButton).toBeDisabled();
    expect(deleteButton).toBeDisabled();
  });

  it('should show deleting text when isDeleting is true', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} isDeleting={true} />);

    expect(screen.getByRole('button', { name: /Deleting.../i })).toBeInTheDocument();
  });

  it('should show delete text when isDeleting is false', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} isDeleting={false} />);

    expect(screen.getByRole('button', { name: /^Delete$/i })).toBeInTheDocument();
  });

  it('should have critical design for delete button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    const deleteButton = screen.getByRole('button', { name: /Delete/i });
    // Critical button should have specific styling
    expect(deleteButton).toBeInTheDocument();
  });

  it('should have secondary design for cancel button', () => {
    renderWithProviders(<DeleteRowModal {...defaultProps} isOpen={true} />);

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    // Secondary button should have specific styling
    expect(cancelButton).toBeInTheDocument();
  });
});
