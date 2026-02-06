import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import PageLayout from './PageLayout';

vi.mock('@/components/layout/Header', () => ({
  default: ({ location }: { location: string }) => (
    <header data-testid="header" data-location={location}>
      Header
    </header>
  ),
}));

describe('PageLayout', function pageLayoutTests() {
  describe('renders correctly', function renderTests() {
    it('should render Header component', function renderHeader() {
      renderWithProviders(
        <PageLayout>
          <div>Content</div>
        </PageLayout>
      );

      expect(screen.getByTestId('header')).toBeInTheDocument();
    });

    it('should pass manage-plan location to Header', function passLocation() {
      renderWithProviders(
        <PageLayout>
          <div>Content</div>
        </PageLayout>
      );

      expect(screen.getByTestId('header')).toHaveAttribute('data-location', 'manage-plan');
    });

    it('should render children content', function renderChildren() {
      renderWithProviders(
        <PageLayout>
          <div data-testid="child-content">Test Content</div>
        </PageLayout>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should render main element with proper styling', function renderMain() {
      const { container } = renderWithProviders(
        <PageLayout>
          <div>Content</div>
        </PageLayout>
      );

      const main = container.querySelector('main');
      expect(main).toBeInTheDocument();
      expect(main?.className).toContain('max-w-6xl');
      expect(main?.className).toContain('mx-auto');
    });

    it('should have min-height screen on wrapper', function minHeightScreen() {
      const { container } = renderWithProviders(
        <PageLayout>
          <div>Content</div>
        </PageLayout>
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('min-h-screen');
    });
  });

  describe('handles multiple children', function multipleChildrenTests() {
    it('should render multiple children', function renderMultipleChildren() {
      renderWithProviders(
        <PageLayout>
          <div data-testid="child-1">First</div>
          <div data-testid="child-2">Second</div>
          <div data-testid="child-3">Third</div>
        </PageLayout>
      );

      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
      expect(screen.getByTestId('child-3')).toBeInTheDocument();
    });
  });
});
