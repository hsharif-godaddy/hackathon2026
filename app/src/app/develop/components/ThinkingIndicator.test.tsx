import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import ThinkingIndicator from '@/app/develop/components/ThinkingIndicator';
import { renderWithProviders } from '@/tests/test-utils';

describe('ThinkingIndicator', () => {
  it('should render without crashing', function render() {
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('builder_agent_done')).toBeInTheDocument();
  });

  it('should display "Done" by default when inactive', function defaultDone() {
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('builder_agent_done')).toBeInTheDocument();
  });

  it('should display "Thinking ..." when active', function activeThinking() {
    renderWithProviders(<ThinkingIndicator active />);

    expect(screen.getByText('builder_agent_thinking')).toBeInTheDocument();
  });

  it('should display custom activeLabel when provided', function customActiveLabel() {
    renderWithProviders(<ThinkingIndicator active activeLabel="Processing..." />);

    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('should display custom label when provided', function customLabel() {
    renderWithProviders(<ThinkingIndicator label="Custom label" />);

    expect(screen.getByText('Custom label')).toBeInTheDocument();
  });

  it('should render pulse rings when active', function pulseRings() {
    const { container } = renderWithProviders(<ThinkingIndicator active />);

    const pulseRings = container.querySelectorAll('.animate-agent-pulse');
    expect(pulseRings.length).toBe(1);
  });

  it('should not render pulse rings when inactive', function noPulseRings() {
    const { container } = renderWithProviders(<ThinkingIndicator />);

    const pulseRings = container.querySelectorAll('.animate-agent-pulse');
    expect(pulseRings.length).toBe(0);
  });

  it('should render with correct structure', function structure() {
    const { container } = renderWithProviders(<ThinkingIndicator />);

    const brainIcon = container.querySelector('svg');
    expect(brainIcon).toBeInTheDocument();
  });

  it('should apply custom className', function customClassName() {
    const { container } = renderWithProviders(
      <ThinkingIndicator className="custom-class" />
    );

    const mainContainer = container.querySelector('.custom-class');
    expect(mainContainer).toBeInTheDocument();
  });

  it('should display formatted duration in MM:SS format', function durationFormat() {
    renderWithProviders(<ThinkingIndicator duration={500} />);

    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('should display formatted duration in seconds', function durationSeconds() {
    renderWithProviders(<ThinkingIndicator duration={2500} />);

    expect(screen.getByText('00:02')).toBeInTheDocument();
  });

  it('should display formatted duration in minutes and seconds', function durationMinutes() {
    renderWithProviders(<ThinkingIndicator duration={125000} />);

    expect(screen.getByText('02:05')).toBeInTheDocument();
  });

  it('should format duration correctly for edge cases', function edgeCases() {
    const { rerender } = renderWithProviders(<ThinkingIndicator duration={999} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();

    rerender(<ThinkingIndicator duration={1000} />);
    expect(screen.getByText('00:01')).toBeInTheDocument();

    rerender(<ThinkingIndicator duration={59999} />);
    expect(screen.getByText('00:59')).toBeInTheDocument();

    rerender(<ThinkingIndicator duration={60000} />);
    expect(screen.getByText('01:00')).toBeInTheDocument();
  });

  it('should display max duration of 99:59+', function maxDuration() {
    const maxMs = 99 * 60 * 1000 + 59 * 1000; // 99:59 in milliseconds
    renderWithProviders(<ThinkingIndicator duration={maxMs} />);

    expect(screen.getByText('99:59')).toBeInTheDocument();
  });

  it('should display 99:59+ for durations exceeding max', function exceedMax() {
    const exceedMs = 100 * 60 * 1000; // 100 minutes
    renderWithProviders(<ThinkingIndicator duration={exceedMs} />);

    expect(screen.getByText('99:59+')).toBeInTheDocument();
  });
});
