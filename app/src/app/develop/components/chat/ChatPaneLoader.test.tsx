import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import ChatPaneLoader from './ChatPaneLoader';
import { SiteCreationPhase } from '@/stores/useSiteCreationStore';

describe('ChatPaneLoader', () => {
  const defaultProps = {
    phase: 'initializing' as SiteCreationPhase,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    onRetry: vi.fn(),
    onCancel: vi.fn(),
  };

  it('should render without crashing', () => {
    renderWithProviders(<ChatPaneLoader {...defaultProps} />);

    expect(screen.getByText('Convincing the servers to cooperate...')).toBeInTheDocument();
  });

  it('should display phase message for initializing', () => {
    renderWithProviders(<ChatPaneLoader {...defaultProps} phase="initializing" />);

    expect(screen.getByText('Convincing the servers to cooperate...')).toBeInTheDocument();
  });

  it('should display phase message for deploying', () => {
    renderWithProviders(<ChatPaneLoader {...defaultProps} phase="deploying" />);

    expect(screen.getByText('Teaching your code how to fly...')).toBeInTheDocument();
  });

  it('should display phase message for polling', () => {
    renderWithProviders(<ChatPaneLoader {...defaultProps} phase="polling" />);

    expect(screen.getByText('Adding a bit of magic...')).toBeInTheDocument();
  });

  it('should display phase message for verifying-agent', () => {
    renderWithProviders(<ChatPaneLoader {...defaultProps} phase="verifying-agent" />);

    expect(screen.getByText("Making sure the AI didn't break anything...")).toBeInTheDocument();
  });

  it('should display phase message for complete', () => {
    renderWithProviders(<ChatPaneLoader {...defaultProps} phase="complete" />);

    expect(screen.getByText('Your building environment is ready!')).toBeInTheDocument();
  });

  it('should display loading indicators', () => {
    const { container } = renderWithProviders(<ChatPaneLoader {...defaultProps} />);

    const dots = container.querySelectorAll('.animate-bounce');
    expect(dots).toHaveLength(3);
  });

  it('should display timing information', () => {
    renderWithProviders(<ChatPaneLoader {...defaultProps} />);

    expect(screen.getByText('This usually takes 30-60 seconds')).toBeInTheDocument();
    expect(screen.getByText("Please don't close this page")).toBeInTheDocument();
  });

  it('should render error state when error is provided', () => {
    renderWithProviders(
      <ChatPaneLoader {...defaultProps} error="Something went wrong" />
    );

    expect(screen.getByText('Setup Failed')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('should render cancel button in error state', () => {
    renderWithProviders(
      <ChatPaneLoader {...defaultProps} error="Something went wrong" />
    );

    expect(screen.getByRole('button', { name: /Go Back/i })).toBeInTheDocument();
  });

  it('should render retry button in error state when retries available', () => {
    renderWithProviders(
      <ChatPaneLoader {...defaultProps} error="Something went wrong" retryCount={1} maxRetries={3} />
    );

    expect(screen.getByRole('button', { name: /Retry \(1\/3\)/i })).toBeInTheDocument();
  });

  it('should not render retry button when max retries reached', () => {
    renderWithProviders(
      <ChatPaneLoader {...defaultProps} error="Something went wrong" retryCount={3} maxRetries={3} />
    );

    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
  });

  it('should call onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn();
    const { user } = renderWithProviders(
      <ChatPaneLoader {...defaultProps} error="Something went wrong" onCancel={onCancel} />
    );

    const cancelButton = screen.getByRole('button', { name: /Go Back/i });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  it('should call onRetry when retry button clicked', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <ChatPaneLoader
        {...defaultProps}
        error="Something went wrong"
        retryCount={1}
        onRetry={onRetry}
      />
    );

    const retryButton = screen.getByRole('button', { name: /Retry/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(onRetry).toHaveBeenCalledOnce();
    });
  });
});
