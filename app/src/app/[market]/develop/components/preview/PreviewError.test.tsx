/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import PreviewError from './PreviewError';

describe('PreviewError', () => {
  const defaultProps = {
    title: 'Error Title',
    error: 'Something went wrong',
    buttonText: 'Retry',
    buttonOnClick: vi.fn(),
  };

  it('should render without crashing', () => {
    renderWithProviders(<PreviewError {...defaultProps} />);

    expect(screen.getByText('Error Title')).toBeInTheDocument();
  });

  it('should display title', () => {
    renderWithProviders(<PreviewError {...defaultProps} />);

    expect(screen.getByText('Error Title')).toBeInTheDocument();
  });

  it('should display error message', () => {
    renderWithProviders(<PreviewError {...defaultProps} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('should display button with correct text', () => {
    renderWithProviders(<PreviewError {...defaultProps} />);

    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('should call buttonOnClick when button clicked', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <PreviewError {...defaultProps} buttonOnClick={onClick} />
    );

    const button = screen.getByRole('button', { name: /Retry/i });
    await user.click(button);

    await waitFor(() => {
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  it('should render with different title and error', () => {
    renderWithProviders(
      <PreviewError
        {...defaultProps}
        title="Loading Failed"
        error="Unable to load preview"
      />
    );

    expect(screen.getByText('Loading Failed')).toBeInTheDocument();
    expect(screen.getByText('Unable to load preview')).toBeInTheDocument();
  });

  it('should render with different button text', () => {
    renderWithProviders(
      <PreviewError {...defaultProps} buttonText="Refresh Preview" />
    );

    expect(screen.getByRole('button', { name: /Refresh Preview/i })).toBeInTheDocument();
  });

  it('should have centered layout', () => {
    const { container } = renderWithProviders(<PreviewError {...defaultProps} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center');
  });
});
