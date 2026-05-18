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

  it('should render only the primary button when no secondary button props are provided', () => {
    renderWithProviders(<PreviewError {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/Retry/i);
  });

  it('should render both buttons and wire their clicks when secondary props are provided', async () => {
    const primaryClick = vi.fn();
    const secondaryClick = vi.fn();
    const { user } = renderWithProviders(
      <PreviewError
        {...defaultProps}
        buttonOnClick={primaryClick}
        secondaryButtonText="Ask Airo to fix"
        secondaryButtonOnClick={secondaryClick}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    const primary = screen.getByRole('button', { name: /Retry/i });
    const secondary = screen.getByRole('button', { name: /Ask Airo to fix/i });

    await user.click(primary);
    await user.click(secondary);

    await waitFor(() => {
      expect(primaryClick).toHaveBeenCalledOnce();
      expect(secondaryClick).toHaveBeenCalledOnce();
    });
  });

  it('disables the secondary button when secondaryButtonDisabled is true', () => {
    renderWithProviders(
      <PreviewError
        {...defaultProps}
        secondaryButtonText="Ask Airo to fix"
        secondaryButtonOnClick={vi.fn()}
        secondaryButtonDisabled={true}
      />
    );

    const secondary = screen.getByRole('button', { name: /Ask Airo to fix/i });
    expect(secondary).toBeDisabled();
  });
});
