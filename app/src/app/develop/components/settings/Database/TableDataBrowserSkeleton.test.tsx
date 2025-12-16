import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { TableDataBrowserSkeleton } from './TableDataBrowserSkeleton';

vi.mock('./utils', () => ({
  formatColumnName: (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
}));

describe('TableDataBrowserSkeleton', () => {
  const defaultProps = {
    tableName: 'users_table',
    onBack: vi.fn(),
  };

  it('should render without crashing', () => {
    renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('should display formatted table name', () => {
    renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    expect(screen.getByText('Users Table')).toBeInTheDocument();
  });

  it('should render back button', () => {
    renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    expect(screen.getByRole('button', { name: /Back/i })).toBeInTheDocument();
  });

  it('should call onBack when back button clicked', async () => {
    const onBack = vi.fn();
    const { user } = renderWithProviders(
      <TableDataBrowserSkeleton {...defaultProps} onBack={onBack} />
    );

    const backButton = screen.getByRole('button', { name: /Back/i });
    await user.click(backButton);

    await waitFor(() => {
      expect(onBack).toHaveBeenCalledOnce();
    });
  });

  it('should render disabled add row button', () => {
    renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    const addButton = screen.getByRole('button', { name: /Add Row/i });
    expect(addButton).toBeInTheDocument();
    expect(addButton).toBeDisabled();
  });

  it('should render skeleton table headers', () => {
    const { container } = renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    // Should have skeleton elements in the table header
    const skeletons = container.querySelectorAll('thead [class*="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should render skeleton table rows', () => {
    const { container } = renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    // Should have skeleton elements in the table body
    const skeletons = container.querySelectorAll('tbody [class*="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should render correct number of skeleton columns', () => {
    const { container } = renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    // Should have 7 columns (6 data + 1 actions)
    const headerCells = container.querySelectorAll('thead th');
    expect(headerCells.length).toBe(7);
  });

  it('should render correct number of skeleton rows', () => {
    const { container } = renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} />);

    // Should have 10 rows
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(10);
  });

  it('should render with different table name', () => {
    renderWithProviders(<TableDataBrowserSkeleton {...defaultProps} tableName="products_catalog" />);

    expect(screen.getByText('Products Catalog')).toBeInTheDocument();
  });
});
