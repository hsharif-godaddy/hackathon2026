import '@testing-library/jest-dom';

import { describe, expect,it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ThinkingIndicator from './ThinkingIndicator';

describe('ThinkingIndicator', () => {
  it('should render without crashing', () => {
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('Airo Developer is thinking')).toBeInTheDocument();
  });

  it('should display thinking message', () => {
    renderWithProviders(<ThinkingIndicator />);

    expect(screen.getByText('Airo Developer is thinking')).toBeInTheDocument();
  });

  it('should render animated dots', () => {
    const { container } = renderWithProviders(<ThinkingIndicator />);

    // Should have 3 animated dots
    const dots = container.querySelectorAll('.animate-bounce');
    expect(dots.length).toBe(3);
  });

  it('should have correct animation delays on dots', () => {
    const { container } = renderWithProviders(<ThinkingIndicator />);

    const dots = container.querySelectorAll('.animate-bounce');

    // First dot has no delay
    expect(dots[0]).not.toHaveStyle({ animationDelay: '0.1s' });

    // Second dot has 0.1s delay
    expect(dots[1]).toHaveStyle({ animationDelay: '0.1s' });

    // Third dot has 0.2s delay
    expect(dots[2]).toHaveStyle({ animationDelay: '0.2s' });
  });

  it('should render with correct structure', () => {
    const { container } = renderWithProviders(<ThinkingIndicator />);

    // Should have main container
    const mainContainer = container.querySelector('.flex.items-center.gap-2');
    expect(mainContainer).toBeInTheDocument();

    // Should have message container
    const messageContainer = container.querySelector('.bg-ai-light\\/40');
    expect(messageContainer).toBeInTheDocument();
  });
});
