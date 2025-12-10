import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import Footer from './Footer';

describe('Footer', () => {
  it('should render without crashing', () => {
    renderWithProviders(<Footer />);

    expect(screen.getByText(/Airo AI Builder/i)).toBeInTheDocument();
  });

  it('should display copyright text', () => {
    renderWithProviders(<Footer />);

    expect(screen.getByText(/© 2025 Airo AI Builder/i)).toBeInTheDocument();
  });

  it('should display tagline', () => {
    renderWithProviders(<Footer />);

    expect(screen.getByText(/Built with AI for the future/i)).toBeInTheDocument();
  });

  it('should render as footer element', () => {
    const { container } = renderWithProviders(<Footer />);

    const footer = container.querySelector('footer');
    expect(footer).toBeInTheDocument();
  });

  it('should have high contrast styling', () => {
    const { container } = renderWithProviders(<Footer />);

    const footer = container.querySelector('footer');
    expect(footer).toHaveClass('bg-intents-ux-boxHighContrast-backgroundColor');
    expect(footer).toHaveClass('text-intents-ux-boxHighContrast-foregroundColor');
  });

  it('should have centered text', () => {
    const { container } = renderWithProviders(<Footer />);

    const textContainer = container.querySelector('.text-center');
    expect(textContainer).toBeInTheDocument();
  });

  it('should have responsive padding', () => {
    const { container } = renderWithProviders(<Footer />);

    const innerContainer = container.querySelector('.max-w-7xl');
    expect(innerContainer).toBeInTheDocument();
  });
});
