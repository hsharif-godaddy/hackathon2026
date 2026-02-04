import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import Features from './Features';

describe('Features', () => {
  const mockFeatures = [
    {
      title: 'Feature 1',
      description: 'Description for feature 1',
    },
    {
      title: 'Feature 2',
      description: 'Description for feature 2',
    },
    {
      title: 'Feature 3',
      description: 'Description for feature 3',
    },
  ];

  it('should render without crashing', () => {
    renderWithProviders(<Features features={mockFeatures} />);

    expect(screen.getByText('Feature 1')).toBeInTheDocument();
  });

  it('should render all features', () => {
    renderWithProviders(<Features features={mockFeatures} />);

    expect(screen.getByText('Feature 1')).toBeInTheDocument();
    expect(screen.getByText('Feature 2')).toBeInTheDocument();
    expect(screen.getByText('Feature 3')).toBeInTheDocument();
  });

  it('should render feature titles', () => {
    renderWithProviders(<Features features={mockFeatures} />);

    mockFeatures.forEach(feature => {
      expect(screen.getByText(feature.title)).toBeInTheDocument();
    });
  });

  it('should render feature descriptions', () => {
    renderWithProviders(<Features features={mockFeatures} />);

    mockFeatures.forEach(feature => {
      expect(screen.getByText(feature.description)).toBeInTheDocument();
    });
  });

  it('should render empty when no features provided', () => {
    const { container } = renderWithProviders(<Features features={[]} />);

    const grid = container.querySelector('.grid');
    expect(grid?.children).toHaveLength(0);
  });

  it('should render single feature', () => {
    const singleFeature = [mockFeatures[0]];

    renderWithProviders(<Features features={singleFeature} />);

    expect(screen.getByText('Feature 1')).toBeInTheDocument();
    expect(screen.queryByText('Feature 2')).not.toBeInTheDocument();
  });

  it('should apply grid layout classes', () => {
    const { container } = renderWithProviders(<Features features={mockFeatures} />);

    const grid = container.querySelector('.grid');
    expect(grid).toHaveClass('grid-cols-1', 'md:grid-cols-3', 'gap-6');
  });
});
