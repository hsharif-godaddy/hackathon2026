import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/tests/test-utils';
import ManagePlanSkeleton from './ManagePlanSkeleton';

describe('ManagePlanSkeleton', function managePlanSkeletonTests() {
  describe('renders correctly', function renderTests() {
    it('should render skeleton container', function renderContainer() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      const skeletonContainer = container.firstChild as HTMLElement;
      expect(skeletonContainer.className).toContain('bg-intents-ux-box-backgroundColor');
      expect(skeletonContainer.className).toContain('rounded-xl');
    });

    it('should render header skeletons', function renderHeader() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Header row with title and tag placeholders
      const skeletons = container.querySelectorAll('[class*="skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('should render action button skeletons', function renderActionButtons() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Check for button-sized skeletons (128px width)
      const buttonSkeletons = container.querySelectorAll('[style*="width: 128px"]');
      expect(buttonSkeletons.length).toBeGreaterThanOrEqual(2);
    });

    it('should render grid layout', function renderGrid() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      const grid = container.querySelector('[class*="grid"]');
      expect(grid).toBeInTheDocument();
      expect(grid?.className).toContain('grid-cols-1');
    });

    it('should render circular gauge skeleton', function renderGaugeSkeleton() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Check for the circular skeleton (120x120)
      const circularSkeleton = container.querySelector('[style*="width: 120px"][style*="height: 120px"]');
      expect(circularSkeleton).toBeInTheDocument();
    });

    it('should render credit list skeletons', function renderCreditListSkeletons() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Should render 2 credit card skeletons
      const creditCardSkeletons = container.querySelectorAll('[class*="border-b"]');
      expect(creditCardSkeletons.length).toBeGreaterThanOrEqual(2);
    });

    it('should have proper responsive classes', function responsiveClasses() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      const grid = container.querySelector('[class*="md:grid-cols-3"]');
      expect(grid).toBeInTheDocument();
    });
  });
});
