import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/tests/test-utils';
import SpinnerIcon from './SpinnerIcon';

describe('SpinnerIcon', () => {
  it('should render without crashing', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('should render SVG element', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should have animate-spin class', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('animate-spin');
  });

  it('should have default size classes', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-1.5');
    expect(svg).toHaveClass('h-1.5');
  });

  it('should apply custom className', () => {
    const { container } = renderWithProviders(<SpinnerIcon className="w-4 h-4" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-4');
    expect(svg).toHaveClass('h-4');
    expect(svg).toHaveClass('animate-spin');
  });

  it('should have correct viewBox', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('should render circle element', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const circle = container.querySelector('circle');
    expect(circle).toBeInTheDocument();
  });

  it('should render path element', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const path = container.querySelector('path');
    expect(path).toBeInTheDocument();
  });

  it('should have opacity classes on circle', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const circle = container.querySelector('circle');
    expect(circle).toHaveClass('opacity-25');
  });

  it('should have opacity classes on path', () => {
    const { container } = renderWithProviders(<SpinnerIcon />);

    const path = container.querySelector('path');
    expect(path).toHaveClass('opacity-75');
  });

  it('should render with different custom sizes', () => {
    const { rerender, container } = renderWithProviders(<SpinnerIcon className="w-2 h-2" />);

    let svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-2');
    expect(svg).toHaveClass('h-2');

    rerender(<SpinnerIcon className="w-8 h-8" />);

    svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-8');
    expect(svg).toHaveClass('h-8');
  });
});
