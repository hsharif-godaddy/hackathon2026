import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import EmptyStateCard from './EmptyStateCard';

describe('EmptyStateCard', () => {
  const defaultProps = {
    title: 'Feature Locked',
    description: 'This feature requires publishing',
    ctaLabel: 'Publish Now',
    onCtaClick: vi.fn(),
  };

  it('should render without crashing', () => {
    renderWithProviders(<EmptyStateCard {...defaultProps} />);

    expect(screen.getByText('Feature Locked')).toBeInTheDocument();
  });

  it('should render title and description', () => {
    renderWithProviders(<EmptyStateCard {...defaultProps} />);

    expect(screen.getByText('Feature Locked')).toBeInTheDocument();
    expect(screen.getByText('This feature requires publishing')).toBeInTheDocument();
  });

  it('should render primary CTA button', () => {
    renderWithProviders(<EmptyStateCard {...defaultProps} />);

    const ctaButton = screen.getByRole('button', { name: /Publish Now/i });
    expect(ctaButton).toBeInTheDocument();
  });

  it('should call onCtaClick when primary button clicked', async () => {
    const onCtaClick = vi.fn();
    const { user } = renderWithProviders(
      <EmptyStateCard {...defaultProps} onCtaClick={onCtaClick} />
    );

    const ctaButton = screen.getByRole('button', { name: /Publish Now/i });
    await user.click(ctaButton);

    await waitFor(() => {
      expect(onCtaClick).toHaveBeenCalledOnce();
    });
  });

  it('should disable primary button when ctaDisabled is true', () => {
    renderWithProviders(<EmptyStateCard {...defaultProps} ctaDisabled={true} />);

    const ctaButton = screen.getByRole('button', { name: /Publish Now/i });
    expect(ctaButton).toBeDisabled();
  });

  it('should render secondary CTA button when provided', () => {
    renderWithProviders(
      <EmptyStateCard
        {...defaultProps}
        secondaryCtaLabel="Learn More"
        onSecondaryCtaClick={vi.fn()}
      />
    );

    const secondaryButton = screen.getByRole('button', { name: /Learn More/i });
    expect(secondaryButton).toBeInTheDocument();
  });

  it('should call onSecondaryCtaClick when secondary button clicked', async () => {
    const onSecondaryCtaClick = vi.fn();
    const { user } = renderWithProviders(
      <EmptyStateCard
        {...defaultProps}
        secondaryCtaLabel="Learn More"
        onSecondaryCtaClick={onSecondaryCtaClick}
      />
    );

    const secondaryButton = screen.getByRole('button', { name: /Learn More/i });
    await user.click(secondaryButton);

    await waitFor(() => {
      expect(onSecondaryCtaClick).toHaveBeenCalledOnce();
    });
  });

  it('should not render secondary button when only label provided', () => {
    renderWithProviders(
      <EmptyStateCard {...defaultProps} secondaryCtaLabel="Learn More" />
    );

    expect(screen.queryByRole('button', { name: /Learn More/i })).not.toBeInTheDocument();
  });

  it('should not render secondary button when only callback provided', () => {
    renderWithProviders(
      <EmptyStateCard {...defaultProps} onSecondaryCtaClick={vi.fn()} />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
  });

  it('should render icon when provided', () => {
    renderWithProviders(
      <EmptyStateCard
        {...defaultProps}
        icon={<div data-testid="custom-icon">Icon</div>}
      />
    );

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('should not render icon when not provided', () => {
    renderWithProviders(<EmptyStateCard {...defaultProps} />);

    expect(screen.queryByTestId('custom-icon')).not.toBeInTheDocument();
  });
});
