/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/tests/test-utils';
import StatusIndicator from './StatusIndicator';

describe('StatusIndicator', () => {
  it('should render without crashing', () => {
    const { container } = renderWithProviders(<StatusIndicator status="running" />);

    expect(container).toBeTruthy();
  });

  it('should render spinner icon when status is running', () => {
    const { container } = renderWithProviders(<StatusIndicator status="running" />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('animate-spin');
  });

  it('should render alert icon when status is error', () => {
    const { container } = renderWithProviders(<StatusIndicator status="error" />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should render nothing when status is completed', () => {
    const { container } = renderWithProviders(<StatusIndicator status="completed" />);

    expect(container.firstChild).toBeNull();
  });

  it('should apply muted foreground color for running status', () => {
    const { container } = renderWithProviders(<StatusIndicator status="running" />);

    const span = container.querySelector('span');
    expect(span).toHaveClass('text-muted-foreground');
  });

  it('should apply destructive color for error status', () => {
    const { container } = renderWithProviders(<StatusIndicator status="error" />);

    const span = container.querySelector('span');
    expect(span).toHaveClass('text-destructive');
  });

  it('should apply custom className', () => {
    const { container } = renderWithProviders(
      <StatusIndicator status="running" className="custom-class" />
    );

    const span = container.querySelector('span');
    expect(span).toHaveClass('custom-class');
  });

  it('should apply inline-flex display', () => {
    const { container } = renderWithProviders(<StatusIndicator status="running" />);

    const span = container.querySelector('span');
    expect(span).toHaveClass('inline-flex');
  });

  it('should handle different status values', () => {
    const { rerender, container } = renderWithProviders(<StatusIndicator status="running" />);
    expect(container.querySelector('svg')).toHaveClass('animate-spin');

    rerender(<StatusIndicator status="error" />);
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin');

    rerender(<StatusIndicator status="completed" />);
    expect(container.firstChild).toBeNull();
  });

  it('should render alert icon when status is incomplete', () => {
    const { container } = renderWithProviders(<StatusIndicator status="incomplete" />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).not.toHaveClass('animate-spin');
  });

  it('should apply destructive color for incomplete status', () => {
    const { container } = renderWithProviders(<StatusIndicator status="incomplete" />);

    const span = container.querySelector('span');
    expect(span).toHaveClass('text-destructive');
  });
});
